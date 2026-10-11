import { z } from "zod";
import { fetchAuthSession } from "aws-amplify/auth";
import type { ChatCard, ChatConfirmResponse, ChatDetailResponse, ChatListResponse, ChatStreamEvent, ChatStreamRequest } from "@solarsaathi/types";
import { getPublicEnvironment } from "./env";
import { deleteAuthenticated, getAuthenticated, postAuthenticated, RoofRequestError } from "./roof-api";

const timestamp = z.string().min(1);
const quickReply = z.object({ label: z.string(), value: z.string() });
const card: z.ZodType<ChatCard> = z.object({
  cardId: z.string(), kind: z.enum(["ADDRESS_PROMPT", "BUILDING_PICK", "ROOF_SUMMARY", "SYSTEM_OPTIONS", "SAVINGS", "BENEFITS",
    "QUOTE", "QUESTION", "CHECKLIST", "PRICE_RESEARCH", "NOTICE", "PROPERTY_LIST"]),
  title: z.string(),
  data: z.object({
    summary: z.string().optional(),
    rows: z.array(z.object({ label: z.string(), value: z.string(), note: z.string().optional(), emphasis: z.boolean().optional() })).optional(),
    table: z.object({ columns: z.array(z.string()), rows: z.array(z.array(z.string())) }).optional(),
    bullets: z.array(z.string()).optional(),
    items: z.array(z.object({ label: z.string(), detail: z.string().optional(), done: z.boolean().optional() })).optional(),
    question: z.object({ text: z.string(), options: z.array(quickReply) }).optional(),
    disclaimer: z.string().optional(),
    action: z.object({ label: z.string(), href: z.string() }).optional(),
  }),
  provenance: z.object({ source: z.string(), verificationStatus: z.enum(["VERIFIED", "INDICATIVE", "UNVERIFIED", "DEMO"]).optional(),
    jurisdiction: z.string().optional(), effectiveDate: z.string().optional(), policyVersion: z.number().optional(),
    lastCheckedAt: z.string().optional(), links: z.array(z.object({ label: z.string(), url: z.string() })).optional() }).optional(),
  href: z.string().optional(),
});
const proposal = z.object({ proposalId: z.string(), action: z.enum(["CREATE_PROPERTY", "CONFIRM_ROOF", "CREATE_APPLICATION",
  "UPDATE_APPLICATION_STEP", "DELETE_PROPERTY"]), summary: z.string(), expiresAt: z.string() });
const errorCode = z.enum(["UNAUTHENTICATED", "RATE_LIMITED", "BUDGET_EXCEEDED", "GUARDRAIL_BLOCKED", "MODEL_UNAVAILABLE",
  "MODEL_REFUSED", "TOOL_FAILED", "INVALID_REQUEST", "INTERNAL"]);
const streamEvent: z.ZodType<ChatStreamEvent> = z.discriminatedUnion("type", [
  z.object({ type: z.literal("meta"), chatId: z.string(), messageId: z.string() }),
  z.object({ type: z.literal("text"), delta: z.string() }),
  z.object({ type: z.literal("tool"), name: z.string(), state: z.enum(["started", "finished", "failed"]) }),
  z.object({ type: z.literal("card"), card }),
  z.object({ type: z.literal("quick_replies"), replies: z.array(quickReply) }),
  z.object({ type: z.literal("proposal"), proposal }),
  z.object({ type: z.literal("grounding"), replaced: z.number() }),
  z.object({ type: z.literal("error"), code: errorCode, message: z.string() }),
  z.object({ type: z.literal("done"), usage: z.object({ inputTokens: z.number(), outputTokens: z.number() }).optional() }),
]);

const summary = z.object({ chatId: z.string(), title: z.string(), propertyId: z.string().optional(), updatedAt: timestamp });
const listResponse: z.ZodType<ChatListResponse> = z.object({ chats: z.array(summary), nextCursor: z.string().optional() }).passthrough();
const detailResponse: z.ZodType<ChatDetailResponse> = z.object({ chat: summary, messages: z.array(z.object({
  messageId: z.string(), role: z.enum(["user", "assistant"]), createdAt: timestamp, text: z.string(),
  cards: z.array(card).optional(), proposals: z.array(proposal).optional() })) }).passthrough();
const confirmResponse: z.ZodType<ChatConfirmResponse> = z.object({ proposalId: z.string(),
  status: z.enum(["EXECUTED", "EXPIRED", "ALREADY_EXECUTED"]), card: card.optional() }).passthrough();
const deleted = z.object({}).passthrough();

/** Parses SSE `data:` lines out of a growing text buffer. Returns the events found and the unconsumed remainder. */
export function parseSseChunk(buffer: string): { events: ChatStreamEvent[]; rest: string; invalid: number } {
  const events: ChatStreamEvent[] = [];
  let invalid = 0;
  const frames = buffer.split(/\r?\n\r?\n/);
  const rest = frames.pop() ?? "";
  for (const frame of frames) {
    const data = frame.split(/\r?\n/).filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\n");
    if (!data) continue;
    try {
      const parsed = streamEvent.safeParse(JSON.parse(data));
      if (parsed.success) events.push(parsed.data); else invalid += 1;
    } catch { invalid += 1; }
  }
  return { events, rest, invalid };
}

export const chatApi = {
  configured: () => Boolean(getPublicEnvironment().NEXT_PUBLIC_CHAT_STREAM_URL),
  list: (signal?: AbortSignal) => getAuthenticated("/chats", listResponse, signal),
  get: (chatId: string, signal?: AbortSignal) => getAuthenticated(`/chats/${encodeURIComponent(chatId)}`, detailResponse, signal),
  remove: (chatId: string, signal?: AbortSignal) => deleteAuthenticated(`/chats/${encodeURIComponent(chatId)}`, deleted, signal),
  removeAll: (signal?: AbortSignal) => deleteAuthenticated("/chats", deleted, signal),
  confirm: (proposalId: string, signal?: AbortSignal) => postAuthenticated("/chat/confirm", { proposalId }, confirmResponse, signal, 20_000),

  /** Streams one assistant turn. Calls `onEvent` for each validated event; always settles with done/error handling by the caller. */
  async stream(request: ChatStreamRequest, onEvent: (event: ChatStreamEvent) => void, signal: AbortSignal): Promise<void> {
    const url = getPublicEnvironment().NEXT_PUBLIC_CHAT_STREAM_URL;
    if (!url) throw new RoofRequestError("CHAT_NOT_CONFIGURED", "The assistant is not connected in this deployment.");
    let token: string | undefined;
    try { token = (await fetchAuthSession()).tokens?.accessToken?.toString(); } catch { /* handled below */ }
    if (!token) throw new RoofRequestError("SESSION_UNAVAILABLE", "Sign in to chat with SolarSaathi.");
    const response = await fetch(url, { method: "POST", credentials: "omit", cache: "no-store", redirect: "error", signal,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "text/event-stream" },
      body: JSON.stringify(request) });
    if (response.status === 401 || response.status === 403) throw new RoofRequestError("UNAUTHORIZED", "Your session expired. Sign in again.");
    if (response.status === 429) throw new RoofRequestError("RATE_LIMITED", "You have reached the chat limit for now. Try again later.");
    if (!response.ok || !response.body) throw new RoofRequestError("SERVICE_UNAVAILABLE", "The assistant is unavailable. Try again.");
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      const parsed = parseSseChunk(buffer);
      buffer = parsed.rest;
      for (const event of parsed.events) onEvent(event);
    }
    const tail = parseSseChunk(`${buffer}\n\n`);
    for (const event of tail.events) onEvent(event);
  },
};
