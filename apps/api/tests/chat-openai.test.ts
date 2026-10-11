import { ConverseStreamCommand } from "@aws-sdk/client-bedrock-runtime";
import type { ChatStreamEvent } from "@solarsaathi/types";
import { describe, expect, it, vi } from "vitest";
import { classifyModelError, modelErrorDetails, runTurn } from "../src/chat/agent";
import { OpenAiConverseClient, toConverseEvents, toOpenAiMessages, toOpenAiTools } from "../src/chat/openai-client";
import { createOpenAiKeyReader, parseOpenAiKey } from "../src/chat/openai-secret";
import { counterId, fakeServices, fixedClock, identity } from "./chat-fixtures";

// A syntactically valid but obviously fake key. No real credential appears in this repository.
const FAKE_KEY = "sk-test-0123456789abcdefghijklmnop";

const sse = (...chunks: unknown[]) => new Response(new ReadableStream({ start(controller) {
  const encoder = new TextEncoder();
  for (const chunk of chunks) controller.enqueue(encoder.encode(`data: ${typeof chunk === "string" ? chunk : JSON.stringify(chunk)}\n\n`));
  controller.close();
} }), { status: 200, headers: { "content-type": "text/event-stream", "x-request-id": "req_openai_1" } });
const delta = (content: string) => ({ choices: [{ delta: { content }, finish_reason: null }] });
const finish = (reason: string) => ({ choices: [{ delta: {}, finish_reason: reason }] });
const usage = { choices: [], usage: { prompt_tokens: 11, completion_tokens: 7 } };
const errorResponse = (status: number, error: Record<string, unknown>) => new Response(JSON.stringify({ error }), { status, headers: { "x-request-id": "req_err" } });

function client(fetcher: typeof fetch) { return new OpenAiConverseClient({ getApiKey: async () => FAKE_KEY, fetcher }); }
const command = (input: Partial<ConstructorParameters<typeof ConverseStreamCommand>[0]> = {}) => new ConverseStreamCommand({
  modelId: "gpt-test", system: [{ text: "You are SolarSaathi." }, { cachePoint: { type: "default" } } as never],
  messages: [{ role: "user", content: [{ text: "Hello" }] }], inferenceConfig: { maxTokens: 500 }, ...input });
async function drain(stream: AsyncIterable<unknown> | undefined) { const out: unknown[] = []; for await (const item of stream ?? []) out.push(item); return out; }

describe("OpenAI request conversion", () => {
  it("converts system, user, assistant tool calls and tool results in order", () => {
    const messages = toOpenAiMessages([{ text: "sys" }, { text: undefined }], [
      { role: "user", content: [{ text: "How big?" }] },
      { role: "assistant", content: [{ text: "Checking." }, { toolUse: { toolUseId: "t1", name: "get_roof", input: { a: 1 } } }] },
      { role: "user", content: [{ toolResult: { toolUseId: "t1", status: "success", content: [{ text: "80 m2" }] } },
        { toolResult: { toolUseId: "t2", status: "error", content: [{ text: "NOT_FOUND" }] } }] },
    ]);
    expect(messages).toEqual([
      { role: "system", content: "sys" },
      { role: "user", content: "How big?" },
      { role: "assistant", content: "Checking.", tool_calls: [{ id: "t1", type: "function", function: { name: "get_roof", arguments: "{\"a\":1}" } }] },
      { role: "tool", tool_call_id: "t1", content: "80 m2" },
      { role: "tool", tool_call_id: "t2", content: "Error: NOT_FOUND" },
    ]);
    expect(toOpenAiMessages(undefined, [{ role: "assistant", content: [{ toolUse: { toolUseId: "x", name: "n", input: {} } }] }])[0])
      .toMatchObject({ role: "assistant", content: null });
  });

  it("maps tool specs and skips cache checkpoints", () => {
    expect(toOpenAiTools({ tools: [{ toolSpec: { name: "get_roof", description: "Roof", inputSchema: { json: { type: "object", properties: {} } } } },
      { cachePoint: { type: "default" } }] })).toEqual([{ type: "function", function: { name: "get_roof", description: "Roof", parameters: { type: "object", properties: {} } } }]);
    expect(toOpenAiTools(undefined)).toEqual([]);
  });

  it("posts a streaming chat completion with the key only in the header and no cache or guardrail fields", async () => {
    const fetcher = vi.fn(async () => sse(delta("Hi"), finish("stop"), usage));
    await client(fetcher as unknown as typeof fetch).send(command({
      toolConfig: { tools: [{ toolSpec: { name: "t", inputSchema: { json: { type: "object" } } } }, { cachePoint: { type: "default" } } as never] },
      guardrailConfig: { guardrailIdentifier: "g", guardrailVersion: "1" },
      additionalModelRequestFields: { reasoning_effort: "low", model: "attacker-model", stream: false } as never,
    }), { abortSignal: new AbortController().signal });
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe(`Bearer ${FAKE_KEY}`);
    const body = JSON.parse(String(init.body));
    expect(JSON.stringify(body)).not.toContain(FAKE_KEY);
    expect(body).toMatchObject({ model: "gpt-test", stream: true, stream_options: { include_usage: true }, max_completion_tokens: 500,
      reasoning_effort: "low", tool_choice: "auto" });
    expect(body.tools).toHaveLength(1);
    expect(JSON.stringify(body)).not.toMatch(/cachePoint|guardrail/);
    expect(init.redirect).toBe("error");
  });
});

describe("OpenAI reasoning models", () => {
  const toolCommand = () => command({ toolConfig: { tools: [{ toolSpec: { name: "t", inputSchema: { json: { type: "object" } } } }] } });
  const refusal = () => errorResponse(400, { message: "Function tools with reasoning_effort are not supported for m in /v1/chat/completions. To use function tools, use /v1/responses or set reasoning_effort to 'none'.", type: "invalid_request_error" });

  it("retries once with reasoning_effort none when the provider requires it, then remembers", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(refusal())
      .mockImplementation(async () => sse(delta("ok"), finish("stop")));
    const openAi = client(fetcher as unknown as typeof fetch);
    await drain((await openAi.send(toolCommand(), { abortSignal: new AbortController().signal })).stream);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body))).not.toHaveProperty("reasoning_effort");
    expect(JSON.parse(String((fetcher.mock.calls[1] as unknown as [string, RequestInit])[1].body))).toMatchObject({ reasoning_effort: "none" });
    await drain((await openAi.send(toolCommand(), { abortSignal: new AbortController().signal })).stream);
    expect(fetcher).toHaveBeenCalledTimes(3); // learned: no repeat of the refused attempt
    expect(JSON.parse(String((fetcher.mock.calls[2] as unknown as [string, RequestInit])[1].body))).toMatchObject({ reasoning_effort: "none" });
  });

  it("does not retry other 400s and honours an explicit passthrough setting", async () => {
    const other = vi.fn(async () => errorResponse(400, { code: "invalid_request_error", message: "Unsupported parameter." }));
    await expect(client(other as unknown as typeof fetch).send(toolCommand(), { abortSignal: new AbortController().signal })).rejects.toMatchObject({ name: "OpenAiBadRequest" });
    expect(other).toHaveBeenCalledTimes(1);
    const explicit = vi.fn(async () => sse(delta("ok"), finish("stop")));
    await client(explicit as unknown as typeof fetch).send(command({ additionalModelRequestFields: { reasoning_effort: "none" } as never,
      toolConfig: { tools: [{ toolSpec: { name: "t", inputSchema: { json: { type: "object" } } } }] } }), { abortSignal: new AbortController().signal });
    expect(JSON.parse(String((explicit.mock.calls[0] as unknown as [string, RequestInit])[1].body))).toMatchObject({ reasoning_effort: "none" });
  });
});

describe("OpenAI stream conversion", () => {
  it("emits text deltas, the stop reason and usage", async () => {
    const events = await drain(toConverseEvents((async function* () { yield JSON.stringify(delta("Hel")); yield JSON.stringify(delta("lo")); yield JSON.stringify(finish("stop")); yield JSON.stringify(usage); yield "[DONE]"; })()));
    expect(events).toEqual([
      { contentBlockDelta: { contentBlockIndex: 0, delta: { text: "Hel" } } },
      { contentBlockDelta: { contentBlockIndex: 0, delta: { text: "lo" } } },
      { messageStop: { stopReason: "end_turn" } },
      { metadata: { usage: { inputTokens: 11, outputTokens: 7, totalTokens: 18 }, metrics: { latencyMs: 0 } } },
    ]);
  });

  it("assembles fragmented tool-call arguments and reports tool_use", async () => {
    const call = (index: number, fields: Record<string, unknown>) => JSON.stringify({ choices: [{ delta: { tool_calls: [{ index, ...fields }] }, finish_reason: null }] });
    const events = await drain(toConverseEvents((async function* () {
      yield call(0, { id: "call_a", function: { name: "get_roof", arguments: "" } });
      yield call(0, { function: { arguments: "{\"propertyId\":" } });
      yield call(0, { function: { arguments: "\"p1\"}" } });
      yield call(1, { id: "call_b", function: { name: "get_systems", arguments: "{}" } });
      yield JSON.stringify(finish("tool_calls"));
    })()));
    expect(events).toEqual([
      { contentBlockStart: { contentBlockIndex: 1, start: { toolUse: { toolUseId: "call_a", name: "get_roof" } } } },
      { contentBlockDelta: { contentBlockIndex: 1, delta: { toolUse: { input: "{\"propertyId\":" } } } },
      { contentBlockDelta: { contentBlockIndex: 1, delta: { toolUse: { input: "\"p1\"}" } } } },
      { contentBlockStart: { contentBlockIndex: 2, start: { toolUse: { toolUseId: "call_b", name: "get_systems" } } } },
      { contentBlockDelta: { contentBlockIndex: 2, delta: { toolUse: { input: "{}" } } } },
      { messageStop: { stopReason: "tool_use" } },
    ]);
  });

  it("maps length and content filter stops and ignores malformed chunks", async () => {
    expect(await drain(toConverseEvents((async function* () { yield "not json"; yield JSON.stringify(finish("length")); })()))).toEqual([{ messageStop: { stopReason: "max_tokens" } }]);
    expect(await drain(toConverseEvents((async function* () { yield JSON.stringify(finish("content_filter")); })()))).toEqual([{ messageStop: { stopReason: "content_filtered" } }]);
  });
});

describe("OpenAI failures map to the agent's user-facing codes without leaking the key", () => {
  const cases: [number, Record<string, unknown>, string][] = [
    [429, { code: "insufficient_quota", message: "You exceeded your current quota." }, "MODEL_ACCESS_DENIED"],
    [429, { code: "rate_limit_exceeded", message: "Slow down." }, "MODEL_BUSY"],
    [401, { code: "invalid_api_key", message: "Incorrect API key provided." }, "MODEL_ACCESS_DENIED"],
    [404, { code: "model_not_found", message: "The model does not exist." }, "MODEL_ACCESS_DENIED"],
    [500, { message: "server error" }, "MODEL_BUSY"],
    [400, { code: "invalid_request_error", message: "Unsupported parameter." }, "MODEL_UNAVAILABLE"],
  ];
  for (const [status, error, code] of cases) {
    it(`HTTP ${status} ${String(error.code ?? "")}`, async () => {
      const failure = await client((async () => errorResponse(status, error)) as unknown as typeof fetch)
        .send(command(), { abortSignal: new AbortController().signal }).catch(reason => reason);
      expect(classifyModelError(failure, false).code).toBe(code);
      const details = modelErrorDetails(failure);
      expect(details).toMatchObject({ httpStatusCode: status, bedrockRequestId: "req_err" });
      expect(JSON.stringify(details)).not.toContain(FAKE_KEY);
      expect(classifyModelError(failure, false).message).not.toMatch(/quota|api key|sk-/i);
    });
  }
});

describe("OpenAI behind the chat agent", () => {
  it("runs a full turn: streamed text, usage and done, with the key never in events", async () => {
    const fetcher = vi.fn(async () => sse(delta("Hello! "), delta("Ask me about solar."), finish("stop"), usage));
    const events: ChatStreamEvent[] = [];
    const generator = runTurn(client(fetcher as unknown as typeof fetch) as never, { modelId: "gpt-test", promptCache: false },
      { identity: identity(undefined, "HOMEOWNER"), requestId: "req-1", chatId: "chat-1", userMessage: "hello", history: [], services: fakeServices(),
        now: fixedClock, createId: counterId("c") });
    let next = await generator.next();
    while (!next.done) { events.push(next.value); next = await generator.next(); }
    expect(events.flatMap(event => event.type === "text" ? [event.delta] : []).join("")).toBe("Hello! Ask me about solar.");
    expect(events.at(-1)).toEqual({ type: "done", usage: { inputTokens: 11, outputTokens: 7 } });
    expect(JSON.stringify(events)).not.toContain(FAKE_KEY);
    expect(next.value.ok).toBe(true);
  });
});

describe("OpenAI key secret", () => {
  it("accepts the JSON secret shape and a bare key, rejects anything else without echoing it", () => {
    expect(parseOpenAiKey(JSON.stringify({ apiKey: FAKE_KEY }))).toBe(FAKE_KEY);
    expect(parseOpenAiKey(`  ${FAKE_KEY}\n`)).toBe(FAKE_KEY);
    for (const bad of [undefined, "", "{}", "{\"apiKey\":\"short\"}", "not-a-key", "{broken"]) {
      expect(() => parseOpenAiKey(bad)).toThrowError("OPENAI_KEY_INVALID");
    }
    try { parseOpenAiKey("sk-short"); } catch (error) { expect(String(error)).not.toContain("sk-short"); }
  });

  it("reads once per cache window and refreshes after it", async () => {
    const source = { getSecretString: vi.fn(async () => JSON.stringify({ apiKey: FAKE_KEY })) };
    let now = 1_000_000;
    const read = createOpenAiKeyReader("arn:aws:secretsmanager:ap-south-1:1:secret:openai", "ap-south-1", source, () => now);
    expect(await read()).toBe(FAKE_KEY); expect(await read()).toBe(FAKE_KEY);
    expect(source.getSecretString).toHaveBeenCalledTimes(1);
    now += 6 * 60_000;
    await read();
    expect(source.getSecretString).toHaveBeenCalledTimes(2);
  });
});
