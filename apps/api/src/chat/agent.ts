import {
  ConverseStreamCommand, type ContentBlock, type ConverseStreamCommandInput, type ConverseStreamCommandOutput, type Message,
  type SystemContentBlock, type ToolConfiguration,
} from "@aws-sdk/client-bedrock-runtime";
import type { ChatCard, ChatProposal, ChatStreamEvent, CurrentIdentityResponse } from "@solarsaathi/types";
import { RequestError } from "../lib/http";
import { CHAT_CONFIG, CHAT_REFUSAL_MESSAGE } from "./config";
import { GroundingContext, GroundingStream } from "./grounding";
import { SYSTEM_PROMPT } from "./prompt";
import type { ChatServices } from "./services";
import type { StoredTurnMessage } from "./store";
import { toolSpecs, toolsForRole } from "./tools";
import { toolFailure } from "./tools/support";
import type { ChatTool, ToolContext } from "./tools/types";

export interface BedrockStreamClient {
  send(command: ConverseStreamCommand, options: { abortSignal: AbortSignal }): Promise<Pick<ConverseStreamCommandOutput, "stream">>;
}
export interface AgentConfig {
  modelId: string;
  guardrail?: { id: string; version: string };
  /** Adds prompt-cache checkpoints after the tools and the system prompt. Disabled automatically if the model rejects them. */
  promptCache?: boolean;
  /** Passed through verbatim, e.g. an effort setting. Model specific, so configured by deployment, not hardcoded. */
  additionalModelRequestFields?: Record<string, unknown>;
  log?: (event: Record<string, unknown>) => void;
}
export interface TurnParams {
  identity: CurrentIdentityResponse; requestId: string; chatId: string; userMessage: string; propertyId?: string;
  reply?: { cardId: string; value: string }; history: readonly StoredTurnMessage[]; services: ChatServices;
  now?: () => Date; createId?: () => string; signal?: AbortSignal;
}
export interface TurnResult {
  text: string; cards: ChatCard[]; proposals: ChatProposal[]; toolSummaries: string[];
  usage: { inputTokens: number; outputTokens: number }; replaced: number; stopReason: string; ok: boolean;
}

const NUMBER = /\d{1,3}(?:,\d{2,3})+(?:\.\d+)?|\d+(?:\.\d+)?/g;
/** Numbers the user typed, including "4.5k", "1.2 lakh" and "2 crore" forms. */
export function extractUserFigures(text: string): Set<number> {
  const figures = new Set<number>();
  for (const match of text.matchAll(new RegExp(`(${NUMBER.source})\\s*(lakhs?|lacs?|crores?|cr|k|thousand)?\\b`, "gi"))) {
    const base = Number(match[1]!.replace(/,/g, ""));
    const unit = match[2]?.toLowerCase();
    figures.add(base);
    if (unit) figures.add(base * (unit.startsWith("lakh") || unit.startsWith("lac") ? 100_000 : unit.startsWith("cr") ? 10_000_000 : 1_000));
  }
  return figures;
}

const escapeTags = (text: string) => text.replace(/</g, "‹").replace(/>/g, "›");

function buildMessages(params: TurnParams, role: string): Message[] {
  const priorSummaries = params.history.flatMap(message => message.toolSummaries ?? []).slice(-6).join("\n").slice(-3_000);
  const context = [`role: ${role}`, ...(params.propertyId ? [`selected_property_id: ${params.propertyId}`] : []),
    ...(priorSummaries ? [`earlier_tool_results (data):\n${escapeTags(priorSummaries)}`] : []),
    ...(params.reply ? [`the user tapped card ${params.reply.cardId} answering: ${escapeTags(params.reply.value).slice(0, 200)}`] : [])].join("\n");
  const turns: Message[] = [];
  const push = (role2: "user" | "assistant", text: string) => {
    const last = turns.at(-1);
    if (last && last.role === role2) (last.content![0] as { text: string }).text += `\n${text}`;
    else turns.push({ role: role2, content: [{ text }] });
  };
  for (const message of params.history.slice(-CHAT_CONFIG.historyMessagesForModel)) {
    if (message.text.trim()) push(message.role, message.text.slice(0, CHAT_CONFIG.historyCharsPerMessage));
  }
  if (turns[0]?.role === "assistant") turns.shift();
  push("user", `<context>\n${context}\n</context>\n<user_message>\n${escapeTags(params.userMessage)}\n</user_message>`);
  return turns;
}

interface Assembled { blocks: ContentBlock[]; stopReason: string; inputTokens: number; outputTokens: number }

let cacheUnsupported = false;
export const resetPromptCacheState = () => { cacheUnsupported = false; };

export async function* runTurn(client: BedrockStreamClient, config: AgentConfig, params: TurnParams): AsyncGenerator<ChatStreamEvent, TurnResult> {
  const now = params.now ?? (() => new Date());
  const createId = params.createId ?? (() => crypto.randomUUID());
  const log = config.log ?? (() => undefined);
  const role = params.identity.profile.role;
  const tools = toolsForRole(role);
  const byName = new Map(tools.map(tool => [tool.name, tool]));
  const grounding = new GroundingContext();
  for (const message of params.history) for (const summary of message.toolSummaries ?? []) grounding.addText(summary);
  const userFigures = new Set<number>();
  for (const message of [...params.history.filter(item => item.role === "user").map(item => item.text), params.userMessage,
    params.reply?.value ?? ""]) for (const figure of extractUserFigures(message)) userFigures.add(figure);
  const toolContext: ToolContext = { identity: params.identity, requestId: params.requestId, chatId: params.chatId,
    ...(params.propertyId ? { propertyId: params.propertyId } : {}), services: params.services, userFigures, grounding, now, createId };

  const result: TurnResult = { text: "", cards: [], proposals: [], toolSummaries: [], usage: { inputTokens: 0, outputTokens: 0 },
    replaced: 0, stopReason: "end_turn", ok: true };
  const deadline = AbortSignal.timeout(CHAT_CONFIG.turnTimeoutMs);
  const turnSignal = params.signal ? AbortSignal.any([deadline, params.signal]) : deadline;
  const messages = buildMessages(params, role);
  const specs = toolSpecs(tools);
  const cache = (config.promptCache ?? true) && !cacheUnsupported;
  const guardrailConfig = config.guardrail ? { guardrailIdentifier: config.guardrail.id, guardrailVersion: config.guardrail.version,
    trace: "disabled" as const, streamProcessingMode: "sync" as const } : undefined;
  if (!guardrailConfig) log({ event: "chat_guardrail_not_configured", requestId: params.requestId });

  const fail = (code: Extract<ChatStreamEvent, { type: "error" }>["code"], message: string): ChatStreamEvent => {
    result.ok = false; return { type: "error", code, message, requestId: params.requestId };
  };

  for (let iteration = 0; iteration <= CHAT_CONFIG.maxToolIterations; iteration++) {
    if (iteration === CHAT_CONFIG.maxToolIterations) {
      const note = " I could not finish that in one go. Please ask me to continue or narrow the question.";
      result.text += note; result.stopReason = "max_iterations"; yield { type: "text", delta: note }; break;
    }
    const withCache = cache && !cacheUnsupported;
    const input: ConverseStreamCommandInput = {
      modelId: config.modelId,
      system: [{ text: SYSTEM_PROMPT }, ...(withCache ? [{ cachePoint: { type: "default" } } as SystemContentBlock] : [])],
      messages,
      toolConfig: { tools: [...specs, ...(withCache ? [{ cachePoint: { type: "default" } }] : [])] } as ToolConfiguration,
      inferenceConfig: { maxTokens: CHAT_CONFIG.maxOutputTokens },
      ...(guardrailConfig ? { guardrailConfig } : {}),
      ...(config.additionalModelRequestFields ? { additionalModelRequestFields: config.additionalModelRequestFields as never } : {}),
    };
    let assembled: Assembled;
    const stream = new GroundingStream(grounding);
    try {
      assembled = yield* callModel(client, input, stream, turnSignal, result);
    } catch (error) {
      const retryWithoutCache = withCache && error instanceof Error && error.name === "ValidationException" && /cache/i.test(error.message);
      if (retryWithoutCache) {
        cacheUnsupported = true; log({ event: "chat_prompt_cache_disabled", requestId: params.requestId });
        iteration--; continue;
      }
      const failure = classifyModelError(error, turnSignal.aborted);
      log({ event: "chat_model_error", requestId: params.requestId, code: failure.code, ...modelErrorDetails(error) });
      yield fail(failure.code, failure.message);
      return result;
    }
    const tail = stream.flush();
    if (tail) { result.text += tail; yield { type: "text", delta: tail }; }
    result.replaced += stream.replaced;
    result.usage.inputTokens += assembled.inputTokens; result.usage.outputTokens += assembled.outputTokens;
    result.stopReason = assembled.stopReason;

    if (["guardrail_intervened", "content_filtered"].includes(assembled.stopReason)) {
      result.text += CHAT_REFUSAL_MESSAGE; yield { type: "text", delta: CHAT_REFUSAL_MESSAGE };
      yield fail("GUARDRAIL_BLOCKED", CHAT_REFUSAL_MESSAGE); return result;
    }
    if (assembled.stopReason === "refusal") { yield fail("MODEL_REFUSED", CHAT_REFUSAL_MESSAGE); return result; }
    const toolUses = assembled.blocks.flatMap(block => block.toolUse ? [block.toolUse] : []);
    if (assembled.stopReason !== "tool_use" || !toolUses.length) {
      if (assembled.stopReason === "max_tokens") {
        const note = " (I ran out of space. Ask me to continue.)"; result.text += note; yield { type: "text", delta: note };
      }
      break;
    }
    messages.push({ role: "assistant", content: assembled.blocks });
    const toolResults: ContentBlock[] = [];
    for (const use of toolUses.slice(0, 4)) {
      const output = yield* runTool(byName.get(use.name ?? ""), use.name ?? "", use.input, toolContext, result);
      toolResults.push({ toolResult: { toolUseId: use.toolUseId, status: output.ok ? "success" : "error",
        content: [{ text: output.text.slice(0, CHAT_CONFIG.maxToolResultChars) }] } });
    }
    // Any tool_use beyond the per-message cap still needs a result block.
    for (const use of toolUses.slice(4)) toolResults.push({ toolResult: { toolUseId: use.toolUseId, status: "error", content: [{ text: "Too many tool calls in one step." }] } });
    messages.push({ role: "user", content: toolResults });
  }
  if (result.replaced > 0) yield { type: "grounding", replaced: result.replaced };
  yield { type: "done", usage: result.usage };
  return result;
}

type ModelFailureCode = "MODEL_ACCESS_DENIED" | "MODEL_TIMEOUT" | "MODEL_BUSY" | "MODEL_UNAVAILABLE";
const ACCESS_ERRORS = new Set(["AccessDeniedException", "ResourceNotFoundException", "UnrecognizedClientException"]);
const BUSY_ERRORS = new Set(["ThrottlingException", "ServiceQuotaExceededException", "ServiceUnavailableException", "ModelNotReadyException", "TooManyRequestsException"]);
const TIMEOUT_ERRORS = new Set(["TimeoutError", "AbortError", "ModelTimeoutException", "RequestTimeout"]);

/** Maps a Bedrock failure to a user-facing code. The message never includes provider error text. */
export function classifyModelError(error: unknown, turnAborted: boolean): { code: ModelFailureCode; message: string } {
  const name = error instanceof Error ? error.name : "";
  const text = error instanceof Error ? error.message : "";
  if (turnAborted || TIMEOUT_ERRORS.has(name)) return { code: "MODEL_TIMEOUT", message: "The assistant took too long to answer. Please try again." };
  // OpenAI answers HTTP 429 insufficient_quota when the account has no credit: retrying will not help.
  if (name === "OpenAiInsufficientQuota") return { code: "MODEL_ACCESS_DENIED", message: "The assistant is not available right now. The AI provider account needs attention from the site owner." };
  if (BUSY_ERRORS.has(name)) return { code: "MODEL_BUSY", message: "The assistant is busy right now. Please try again in a minute." };
  // Bedrock reports missing model access / use-case approval as ValidationException "Operation not allowed".
  if (ACCESS_ERRORS.has(name) || (name === "ValidationException" && /not allowed|not authori[sz]ed|access|model identifier is invalid|use case/i.test(text))) {
    return { code: "MODEL_ACCESS_DENIED", message: "The assistant is not available in this deployment yet. The AI model has not been enabled for this account." };
  }
  return { code: "MODEL_UNAVAILABLE", message: "The assistant is unavailable right now. Please try again shortly." };
}

/** Safe diagnostic fields: provider error text and HTTP metadata, never prompt or user content. */
export function modelErrorDetails(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) return { name: "unknown" };
  const meta = (error as { $metadata?: { httpStatusCode?: number; requestId?: string }; $fault?: string });
  return { name: error.name, message: error.message.slice(0, 300), httpStatusCode: meta.$metadata?.httpStatusCode,
    bedrockRequestId: meta.$metadata?.requestId, fault: meta.$fault };
}

async function* callModel(client: BedrockStreamClient, input: ConverseStreamCommandInput, stream: GroundingStream,
  turnSignal: AbortSignal, result: TurnResult): AsyncGenerator<ChatStreamEvent, Assembled> {
  const signal = AbortSignal.any([turnSignal, AbortSignal.timeout(CHAT_CONFIG.modelCallTimeoutMs)]);
  const response = await client.send(new ConverseStreamCommand(input), { abortSignal: signal });
  if (!response.stream) throw new Error("NO_STREAM");
  const blocks = new Map<number, { type: "text" | "toolUse" | "reasoning"; text: string; id?: string; name?: string; signature?: string; redacted?: Uint8Array }>();
  let stopReason = "end_turn", inputTokens = 0, outputTokens = 0;
  for await (const event of response.stream) {
    if (event.contentBlockStart?.start?.toolUse) {
      const start = event.contentBlockStart.start.toolUse;
      blocks.set(event.contentBlockStart.contentBlockIndex ?? 0, { type: "toolUse", text: "", id: start.toolUseId, name: start.name });
    } else if (event.contentBlockDelta) {
      const index = event.contentBlockDelta.contentBlockIndex ?? 0;
      const delta = event.contentBlockDelta.delta;
      if (delta?.text !== undefined) {
        const block = blocks.get(index) ?? { type: "text" as const, text: "" };
        block.text += delta.text; blocks.set(index, block);
        const released = stream.push(delta.text);
        if (released) { result.text += released; yield { type: "text", delta: released }; }
      } else if (delta?.toolUse) {
        const block = blocks.get(index);
        if (block) block.text += delta.toolUse.input ?? "";
      } else if (delta?.reasoningContent) {
        // Reasoning is never shown. It is replayed verbatim so tool-use continuation stays valid.
        const block = blocks.get(index) ?? { type: "reasoning" as const, text: "" };
        block.text += delta.reasoningContent.text ?? "";
        if (delta.reasoningContent.signature) block.signature = delta.reasoningContent.signature;
        if (delta.reasoningContent.redactedContent) block.redacted = delta.reasoningContent.redactedContent;
        blocks.set(index, block);
      }
    } else if (event.messageStop?.stopReason) stopReason = event.messageStop.stopReason;
    else if (event.metadata?.usage) {
      inputTokens = (event.metadata.usage.inputTokens ?? 0) + (event.metadata.usage.cacheWriteInputTokens ?? 0);
      outputTokens = event.metadata.usage.outputTokens ?? 0;
    }
  }
  const ordered = [...blocks.entries()].sort(([a], [b]) => a - b).map(([, block]): ContentBlock | undefined => {
    if (block.type === "text") return block.text ? { text: block.text } : undefined;
    if (block.type === "toolUse") {
      let parsed: unknown = {};
      try { parsed = block.text ? JSON.parse(block.text) : {}; } catch { parsed = { __invalid: true }; }
      return { toolUse: { toolUseId: block.id, name: block.name, input: parsed as never } };
    }
    return block.redacted ? { reasoningContent: { redactedContent: block.redacted } } :
      { reasoningContent: { reasoningText: { text: block.text, signature: block.signature } } };
  }).filter((block): block is ContentBlock => !!block);
  return { blocks: ordered, stopReason, inputTokens, outputTokens };
}

async function* runTool(tool: ChatTool | undefined, name: string, rawInput: unknown, context: ToolContext, result: TurnResult):
AsyncGenerator<ChatStreamEvent, { ok: boolean; text: string }> {
  if (!tool) return { ok: false, text: "Unknown tool." };
  yield { type: "tool", name, state: "started" };
  const parsed = tool.schema.safeParse(rawInput);
  if (!parsed.success) {
    yield { type: "tool", name, state: "failed" };
    return { ok: false, text: `Invalid arguments: ${parsed.error.issues.slice(0, 3).map(issue => `${issue.path.join(".") || "input"} ${issue.message}`).join("; ")}` };
  }
  try {
    const output = await tool.run(parsed.data, context);
    context.grounding.addText(output.modelSummary);
    for (const card of output.cards) {
      context.grounding.addText(card.title);
      context.grounding.addData(card.data);
      result.cards.push(card); yield { type: "card", card };
    }
    if (output.quickReplies?.length) yield { type: "quick_replies", replies: output.quickReplies };
    if (output.proposal) { result.proposals.push(output.proposal); yield { type: "proposal", proposal: output.proposal }; }
    result.toolSummaries.push(`${name}: ${output.modelSummary}`.slice(0, 1_200));
    yield { type: "tool", name, state: "finished" };
    return { ok: true, text: output.modelSummary };
  } catch (error) {
    const failure = toolFailure(error);
    if (!(error instanceof RequestError)) console.error(JSON.stringify({ event: "chat_tool_error", tool: name, requestId: context.requestId,
      name: error instanceof Error ? error.name : "unknown" }));
    yield { type: "tool", name, state: "failed" };
    return { ok: false, text: `${failure.code}: ${failure.message}` };
  }
}
