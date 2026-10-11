import type { ChatStreamEvent, CurrentIdentityResponse } from "@solarsaathi/types";
import { RequestError } from "../lib/http";
import { runTurn, type AgentConfig, type BedrockStreamClient } from "./agent";
import { CHAT_CONFIG } from "./config";
import { maskSensitive } from "./redact";
import { chatStreamRequestSchema } from "./schema";
import type { ChatRuntime } from "./services";

export const SENSITIVE_NOTICE_CARD = (id: string): ChatStreamEvent => ({ type: "card", card: {
  cardId: `notice-${id.slice(0, 12)}`, kind: "NOTICE", title: "I removed sensitive details",
  data: { summary: "Your message looked like it contained an ID, bank, card, password, OTP or consumer number, so I removed it before reading it.",
    bullets: ["Please never share Aadhaar, bank details, consumer numbers, passwords or OTPs in this chat.", "Enter them only on the official government portal."] },
  provenance: { source: "SOLARSAATHI_PRIVACY_FILTER" } } });

export interface TurnRequest { identity: CurrentIdentityResponse; requestId: string; body: unknown; signal?: AbortSignal }

/** Everything between a verified identity and the SSE writer. Yields only wire events and ends with `done` or `error`. */
export async function* handleChatTurn(runtime: ChatRuntime, client: BedrockStreamClient | undefined, config: AgentConfig | undefined,
  request: TurnRequest, now: () => Date = () => new Date(), createId: () => string = () => crypto.randomUUID()): AsyncGenerator<ChatStreamEvent> {
  const userId = request.identity.profile.userId;
  const parsed = chatStreamRequestSchema.safeParse(request.body);
  if (!parsed.success) { yield { type: "error", code: "INVALID_REQUEST", message: "Send a message of 1 to 2000 characters." }; return; }
  const input = parsed.data;
  const decision = await runtime.limits.startTurn(userId);
  if (!decision.allowed) { yield { type: "error", code: decision.code!, message: decision.message! }; return; }
  if (!client || !config) { yield { type: "error", code: "MODEL_ACCESS_DENIED", message: "The assistant is not configured in this deployment yet.", requestId: request.requestId }; return; }

  const masked = maskSensitive(input.message);
  const reply = input.reply ? { cardId: input.reply.cardId, value: maskSensitive(input.reply.value).text } : undefined;
  try {
    if (input.propertyId) await runtime.services.core.getProperty(request.identity, input.propertyId);
    const chat = input.chatId ? await runtime.store.requireChat(userId, input.chatId) :
      await runtime.store.createChat(userId, { title: masked.text.replace(/\s+/g, " ").trim(), ...(input.propertyId ? { propertyId: input.propertyId } : {}) });
    const history = await runtime.store.recentMessages(userId, chat.chatId, CHAT_CONFIG.historyMessagesForModel);
    const assistantMessageId = createId();
    yield { type: "meta", chatId: chat.chatId, messageId: assistantMessageId };
    if (masked.masked > 0) yield SENSITIVE_NOTICE_CARD(assistantMessageId);
    await runtime.store.appendMessage(userId, chat.chatId, { role: "user", text: masked.text });

    const generator = runTurn(client, config, { identity: request.identity, requestId: request.requestId, chatId: chat.chatId,
      userMessage: masked.text, ...(input.propertyId ? { propertyId: input.propertyId } : {}), ...(reply ? { reply } : {}),
      history, services: runtime.services, now, createId, ...(request.signal ? { signal: request.signal } : {}) });
    let outcome;
    while (true) {
      const next = await generator.next();
      if (next.done) { outcome = next.value; break; }
      yield next.value;
    }
    await runtime.limits.recordTokens(userId, outcome.usage.inputTokens + outcome.usage.outputTokens).catch(() => undefined);
    config.log?.({ event: "chat_turn_completed", requestId: request.requestId, ok: outcome.ok, stopReason: outcome.stopReason,
      inputTokens: outcome.usage.inputTokens, outputTokens: outcome.usage.outputTokens, groundingReplaced: outcome.replaced,
      cards: outcome.cards.length, proposals: outcome.proposals.length, sensitiveMasked: masked.masked });
    if (outcome.text.trim() || outcome.cards.length || outcome.proposals.length) {
      await runtime.store.appendMessage(userId, chat.chatId, { role: "assistant", messageId: assistantMessageId, text: outcome.text,
        cards: outcome.cards, proposals: outcome.proposals, toolSummaries: outcome.toolSummaries });
    }
  } catch (error) {
    if (error instanceof RequestError) {
      yield { type: "error", code: error.statusCode === 404 || error.statusCode === 400 || error.statusCode === 409 ? "INVALID_REQUEST" : "INTERNAL",
        message: error.message, requestId: request.requestId };
    } else {
      console.error(JSON.stringify({ event: "chat_turn_failed", requestId: request.requestId, name: error instanceof Error ? error.name : "unknown",
        message: error instanceof Error ? error.message.slice(0, 300) : undefined }));
      yield { type: "error", code: "INTERNAL", message: "Something went wrong. Please try again.", requestId: request.requestId };
    }
  }
}
