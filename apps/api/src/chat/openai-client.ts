import type { ConverseStreamCommand, ConverseStreamCommandOutput, ConverseStreamOutput, ContentBlock, Message } from "@aws-sdk/client-bedrock-runtime";

/**
 * OpenAI Chat Completions behind the same narrow interface the chat agent uses for Bedrock ConverseStream.
 *
 * The agent hands over a Bedrock-style request (system, messages, tool specs). This adapter converts it to an OpenAI
 * streaming request and converts the stream back into Bedrock-shaped events, so the agent, its tools, its grounding
 * filter and its tests are unchanged. OpenAI is an external provider: chat text leaves AWS. The API key is supplied by
 * `getApiKey` (Secrets Manager at runtime) and is never logged, returned or placed in an error message.
 *
 * Not supported here, by design: Bedrock Guardrails (they are a Bedrock feature), prompt-cache checkpoints (ignored)
 * and reasoning blocks (none are produced).
 */
export interface OpenAiClientOptions {
  getApiKey: () => Promise<string>;
  baseUrl?: string;
  fetcher?: typeof fetch;
}

type OpenAiMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[] }
  | { role: "tool"; tool_call_id: string; content: string };

const BASE_URL = "https://api.openai.com/v1";
const MAX_ERROR_BYTES = 4_096;

const textOf = (blocks: readonly ContentBlock[] | undefined) => (blocks ?? []).flatMap(block => "text" in block && block.text ? [block.text] : []).join("\n");

export function toOpenAiMessages(system: readonly { text?: string }[] | undefined, messages: readonly Message[] | undefined): OpenAiMessage[] {
  const out: OpenAiMessage[] = [];
  const systemText = (system ?? []).flatMap(block => block.text ? [block.text] : []).join("\n\n");
  if (systemText) out.push({ role: "system", content: systemText });
  for (const message of messages ?? []) {
    const blocks = message.content ?? [];
    if (message.role === "assistant") {
      const calls = blocks.flatMap(block => "toolUse" in block && block.toolUse ? [{ id: String(block.toolUse.toolUseId), type: "function" as const,
        function: { name: String(block.toolUse.name), arguments: JSON.stringify(block.toolUse.input ?? {}) } }] : []);
      const text = textOf(blocks);
      out.push({ role: "assistant", content: text || (calls.length ? null : ""), ...(calls.length ? { tool_calls: calls } : {}) });
      continue;
    }
    // Tool results must directly follow the assistant message that requested them, before any new user text.
    for (const block of blocks) {
      if ("toolResult" in block && block.toolResult) {
        const body = textOf(block.toolResult.content as ContentBlock[] | undefined);
        out.push({ role: "tool", tool_call_id: String(block.toolResult.toolUseId), content: block.toolResult.status === "error" ? `Error: ${body}` : body });
      }
    }
    const text = textOf(blocks);
    if (text) out.push({ role: "user", content: text });
  }
  return out;
}

export function toOpenAiTools(toolConfig: { tools?: readonly unknown[] } | undefined) {
  const tools = (toolConfig?.tools ?? []).flatMap(tool => {
    const spec = (tool as { toolSpec?: { name?: string; description?: string; inputSchema?: { json?: unknown } } }).toolSpec;
    return spec?.name ? [{ type: "function" as const, function: { name: spec.name, ...(spec.description ? { description: spec.description } : {}),
      parameters: spec.inputSchema?.json ?? { type: "object", properties: {} } } }] : [];
  });
  return tools;
}

/** An error whose `name` maps onto the agent's existing failure classification, with safe diagnostic metadata only. */
export class OpenAiError extends Error {
  readonly $metadata: { httpStatusCode: number; requestId?: string };
  constructor(name: string, message: string, status: number, requestId?: string) {
    super(message); this.name = name; this.$metadata = { httpStatusCode: status, ...(requestId ? { requestId } : {}) };
  }
}

async function readError(response: Response): Promise<{ code?: string; message?: string }> {
  try {
    const text = (await response.text()).slice(0, MAX_ERROR_BYTES);
    const parsed = JSON.parse(text) as { error?: { code?: unknown; type?: unknown; message?: unknown } };
    const code = typeof parsed.error?.code === "string" ? parsed.error.code : typeof parsed.error?.type === "string" ? parsed.error.type : undefined;
    // The provider's message describes the request problem and never includes the API key; it is truncated by the caller.
    return { code, message: typeof parsed.error?.message === "string" ? parsed.error.message : undefined };
  } catch { return {}; }
}

function failure(status: number, detail: { code?: string; message?: string }, requestId?: string): OpenAiError {
  const label = [detail.code, detail.message].filter(Boolean).join(": ").slice(0, 240) || `HTTP ${status}`;
  if (status === 429 && detail.code === "insufficient_quota") return new OpenAiError("OpenAiInsufficientQuota", label, status, requestId);
  if (status === 429) return new OpenAiError("ThrottlingException", label, status, requestId);
  if (status === 401 || status === 403) return new OpenAiError("AccessDeniedException", label, status, requestId);
  if (status === 404) return new OpenAiError("ResourceNotFoundException", label, status, requestId);
  if (status >= 500) return new OpenAiError("ServiceUnavailableException", label, status, requestId);
  return new OpenAiError("OpenAiBadRequest", label, status, requestId);
}

const STOP_REASONS: Record<string, string> = { stop: "end_turn", tool_calls: "tool_use", length: "max_tokens", content_filter: "content_filtered" };

interface Chunk {
  choices?: { delta?: { content?: string | null; tool_calls?: { index: number; id?: string; function?: { name?: string; arguments?: string } }[] }; finish_reason?: string | null }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
}

async function* sseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).replace(/\r$/, ""); buffer = buffer.slice(newline + 1);
        if (line.startsWith("data:")) yield line.slice(5).trim();
      }
    }
    if (buffer.startsWith("data:")) yield buffer.slice(5).trim();
  } finally { reader.releaseLock(); }
}

/** Converts OpenAI stream chunks into the Bedrock events the agent consumes. Text is block 0; tool call n is block n + 1. */
export async function* toConverseEvents(chunks: AsyncIterable<string>): AsyncGenerator<ConverseStreamOutput> {
  const started = new Set<number>();
  let stopReason: string | undefined;
  let usage: { inputTokens: number; outputTokens: number } | undefined;
  for await (const data of chunks) {
    if (!data || data === "[DONE]") continue;
    let chunk: Chunk;
    try { chunk = JSON.parse(data) as Chunk; } catch { continue; }
    if (chunk.usage) usage = { inputTokens: chunk.usage.prompt_tokens ?? 0, outputTokens: chunk.usage.completion_tokens ?? 0 };
    const choice = chunk.choices?.[0];
    if (!choice) continue;
    const delta = choice.delta;
    if (delta?.content) yield { contentBlockDelta: { contentBlockIndex: 0, delta: { text: delta.content } } } as ConverseStreamOutput;
    for (const call of delta?.tool_calls ?? []) {
      const block = 1 + call.index;
      if (!started.has(call.index)) {
        started.add(call.index);
        yield { contentBlockStart: { contentBlockIndex: block, start: { toolUse: { toolUseId: call.id ?? `call_${call.index}`, name: call.function?.name ?? "" } } } } as ConverseStreamOutput;
      }
      if (call.function?.arguments) yield { contentBlockDelta: { contentBlockIndex: block, delta: { toolUse: { input: call.function.arguments } } } } as ConverseStreamOutput;
    }
    if (choice.finish_reason) stopReason = STOP_REASONS[choice.finish_reason] ?? "end_turn";
  }
  yield { messageStop: { stopReason: stopReason ?? "end_turn" } } as ConverseStreamOutput;
  if (usage) yield { metadata: { usage: { ...usage, totalTokens: usage.inputTokens + usage.outputTokens }, metrics: { latencyMs: 0 } } } as ConverseStreamOutput;
}

/** Reasoning models refuse function tools on Chat Completions unless reasoning_effort is "none". */
const NEEDS_NO_REASONING = /reasoning_effort to ['"]none['"]/i;

export class OpenAiConverseClient {
  private readonly fetcher: typeof fetch;
  private readonly baseUrl: string;
  /** Learned from the provider's own error so later turns on this instance do not repeat the failed attempt. */
  private forceNoReasoning = false;
  constructor(private readonly options: OpenAiClientOptions) {
    this.fetcher = options.fetcher ?? fetch;
    this.baseUrl = (options.baseUrl ?? BASE_URL).replace(/\/+$/, "");
  }

  async send(command: ConverseStreamCommand, options: { abortSignal: AbortSignal }): Promise<Pick<ConverseStreamCommandOutput, "stream">> {
    const input = command.input;
    const tools = toOpenAiTools(input.toolConfig as { tools?: readonly unknown[] } | undefined);
    const body: Record<string, unknown> = {
      // Deployment-specific passthrough (e.g. reasoning effort) can never override the fields below.
      ...((input.additionalModelRequestFields ?? {}) as Record<string, unknown>),
      ...(this.forceNoReasoning && tools.length ? { reasoning_effort: "none" } : {}),
      model: input.modelId,
      messages: toOpenAiMessages(input.system as { text?: string }[] | undefined, input.messages),
      stream: true, stream_options: { include_usage: true },
      ...(input.inferenceConfig?.maxTokens ? { max_completion_tokens: input.inferenceConfig.maxTokens } : {}),
      ...(tools.length ? { tools, tool_choice: "auto" } : {}),
    };
    const apiKey = await this.options.getApiKey();
    const post = (payload: Record<string, unknown>) => this.fetcher(`${this.baseUrl}/chat/completions`, { method: "POST", signal: options.abortSignal, redirect: "error",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json", accept: "text/event-stream" }, body: JSON.stringify(payload) });
    let response = await post(body);
    if (!response.ok) {
      const detail = await readError(response);
      if (response.status === 400 && tools.length && !("reasoning_effort" in body) && NEEDS_NO_REASONING.test(detail.message ?? "")) {
        this.forceNoReasoning = true;
        response = await post({ ...body, reasoning_effort: "none" });
        if (!response.ok) throw failure(response.status, await readError(response), response.headers.get("x-request-id") ?? undefined);
      } else throw failure(response.status, detail, response.headers.get("x-request-id") ?? undefined);
    }
    const requestId = response.headers.get("x-request-id") ?? undefined;
    if (!response.body) throw new OpenAiError("ServiceUnavailableException", "NO_STREAM", 502, requestId);
    return { stream: toConverseEvents(sseData(response.body)) };
  }
}
