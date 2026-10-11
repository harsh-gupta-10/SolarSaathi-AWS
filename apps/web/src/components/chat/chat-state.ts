import type { ChatCard, ChatErrorCode, ChatProposal, ChatQuickReply, ChatStoredMessage, ChatStreamEvent } from "@solarsaathi/types";

export interface UiMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  cards: ChatCard[];
  proposals: ChatProposal[];
  quickReplies: ChatQuickReply[];
  tools: Array<{ name: string; state: "started" | "finished" | "failed" }>;
  error?: { code: ChatErrorCode | "CLIENT"; message: string; requestId?: string };
  groundingReplaced?: number;
  streaming: boolean;
}

export interface ChatState { chatId?: string; messages: UiMessage[] }

export const emptyChat: ChatState = { messages: [] };

let counter = 0;
export const localId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(counter += 1)}`;

export function userMessage(text: string): UiMessage {
  return { id: localId("u"), role: "user", text, cards: [], proposals: [], quickReplies: [], tools: [], streaming: false };
}
export function assistantPlaceholder(): UiMessage {
  return { id: localId("a"), role: "assistant", text: "", cards: [], proposals: [], quickReplies: [], tools: [], streaming: true };
}

export function fromStored(messages: ChatStoredMessage[]): UiMessage[] {
  return messages.map(message => ({ id: message.messageId, role: message.role, text: message.text, cards: message.cards ?? [],
    proposals: message.proposals ?? [], quickReplies: [], tools: [], streaming: false }));
}

function updateLast(state: ChatState, change: (message: UiMessage) => UiMessage): ChatState {
  const index = state.messages.length - 1;
  const last = state.messages[index];
  if (!last || last.role !== "assistant") return state;
  return { ...state, messages: [...state.messages.slice(0, index), change(last)] };
}

/** Applies one stream event to the in-progress assistant message. Pure, so it is unit-tested without a network. */
export function applyStreamEvent(state: ChatState, event: ChatStreamEvent): ChatState {
  switch (event.type) {
    case "meta": return { ...state, chatId: event.chatId };
    case "text": return updateLast(state, message => ({ ...message, text: message.text + event.delta }));
    case "tool": return updateLast(state, message => {
      const others = message.tools.filter(tool => tool.name !== event.name);
      return { ...message, tools: [...others, { name: event.name, state: event.state }] };
    });
    case "card": return updateLast(state, message => ({ ...message,
      cards: [...message.cards.filter(card => card.cardId !== event.card.cardId), event.card] }));
    case "quick_replies": return updateLast(state, message => ({ ...message, quickReplies: event.replies }));
    case "proposal": return updateLast(state, message => ({ ...message,
      proposals: [...message.proposals.filter(item => item.proposalId !== event.proposal.proposalId), event.proposal] }));
    case "grounding": return updateLast(state, message => ({ ...message, groundingReplaced: event.replaced }));
    case "error": return updateLast(state, message => ({ ...message, streaming: false, error: { code: event.code, message: event.message, ...(event.requestId ? { requestId: event.requestId } : {}) } }));
    case "done": return updateLast(state, message => ({ ...message, streaming: false }));
  }
}

export function failLast(state: ChatState, message: string): ChatState {
  return updateLast(state, last => last.error ? { ...last, streaming: false } : { ...last, streaming: false, error: { code: "CLIENT", message } });
}

/** Cards worth pinning in the side panel: the newest card of each decision kind. */
export const PINNED_KINDS = ["ROOF_SUMMARY", "SYSTEM_OPTIONS", "SAVINGS", "QUOTE", "BENEFITS", "CHECKLIST"] as const;
export function pinnedCards(messages: UiMessage[]): ChatCard[] {
  const latest = new Map<string, ChatCard>();
  for (const message of messages) for (const card of message.cards) latest.set(card.kind, card);
  return PINNED_KINDS.flatMap(kind => latest.get(kind) ?? []);
}
