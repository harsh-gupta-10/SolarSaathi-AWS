/**
 * Chat assistant wire contract (see docs/chat-assistant-plan.md and docs/chat-api-contract.md).
 * Every money figure, kW, payback, subsidy and eligibility value travels in a `ChatCard`, which the backend builds
 * from deterministic tool results. Model prose (`text` events) never carries authoritative numbers.
 */

export type ChatCardKind =
  | "ADDRESS_PROMPT"      // ask the user for an address / GPS
  | "BUILDING_PICK"       // candidate buildings to choose from (needs user pick)
  | "ROOF_SUMMARY"
  | "SYSTEM_OPTIONS"
  | "SAVINGS"
  | "BENEFITS"
  | "QUOTE"
  | "QUESTION"            // missing fact -> quick-reply chips
  | "CHECKLIST"
  | "PRICE_RESEARCH"      // unapproved web candidates, never part of QUOTE
  | "NOTICE"              // guardrail / limit / unavailable explanations
  | "PROPERTY_LIST";      // the user's saved roofs (data.properties[])

export interface ChatProvenance {
  source: string;               // e.g. "DETERMINISTIC_FINANCIALS_V1", "POLICY:PM_SURYA_GHAR@v3"
  verificationStatus?: "VERIFIED" | "INDICATIVE" | "UNVERIFIED" | "DEMO";
  jurisdiction?: string;
  effectiveDate?: string;
  policyVersion?: number;
  lastCheckedAt?: string;
  links?: Array<{ label: string; url: string }>;
}

/**
 * Presentation-ready card payload. The backend formats every value as display text (e.g. "₹1,80,000", "3.2 kW") from
 * deterministic tool results, so the web app renders cards generically and never recomputes or reformats numbers.
 * All fields are optional; a card shows whichever are present, in this order.
 */
export interface ChatCardData {
  summary?: string;
  /** Key/value facts, e.g. { label: "Typical cost", value: "₹1,80,000", note: "Illustrative" }. */
  rows?: Array<{ label: string; value: string; note?: string; emphasis?: boolean }>;
  /** Comparison table, e.g. system options or 25-year milestones. */
  table?: { columns: string[]; rows: string[][] };
  bullets?: string[];
  /** Checklist items. `done` is user-reported progress. */
  items?: Array<{ label: string; detail?: string; done?: boolean }>;
  /** One missing fact the user can answer with a tap. Replies post back as ChatStreamRequest.reply. */
  question?: { text: string; options: ChatQuickReply[] };
  /** Disclaimer shown under the card (indicative / not an offer / not engineering approval). */
  disclaimer?: string;
  /** Primary deep link into a full page (e.g. roof analysis with the map). */
  action?: { label: string; href: string };
}

export interface ChatCard {
  cardId: string;
  kind: ChatCardKind;
  title: string;
  data: ChatCardData;
  provenance?: ChatProvenance;
  /** Deep link into the full page for this card (e.g. /app/analyze?propertyId=...). */
  href?: string;
}

export interface ChatQuickReply { label: string; value: string }

export interface ChatProposal {
  proposalId: string;
  action: "CREATE_PROPERTY" | "CONFIRM_ROOF" | "CREATE_APPLICATION" | "UPDATE_APPLICATION_STEP" | "DELETE_PROPERTY";
  summary: string;              // human description of exactly what will happen on confirm
  expiresAt: string;            // ISO, 10 minutes
}

/** Server-sent events on POST {chatStreamUrl}. */
export type ChatStreamEvent =
  | { type: "meta"; chatId: string; messageId: string }
  | { type: "text"; delta: string }
  | { type: "tool"; name: string; state: "started" | "finished" | "failed" }
  | { type: "card"; card: ChatCard }
  | { type: "quick_replies"; replies: ChatQuickReply[] }
  | { type: "proposal"; proposal: ChatProposal }
  | { type: "grounding"; replaced: number }   // ungrounded figures were removed from model text
  | { type: "error"; code: ChatErrorCode; message: string; requestId?: string } // requestId lets support find the CloudWatch log line
  | { type: "done"; usage?: { inputTokens: number; outputTokens: number } };

export type ChatErrorCode =
  | "UNAUTHENTICATED" | "RATE_LIMITED" | "BUDGET_EXCEEDED" | "GUARDRAIL_BLOCKED"
  | "MODEL_UNAVAILABLE" | "MODEL_ACCESS_DENIED" | "MODEL_TIMEOUT" | "MODEL_BUSY" | "MODEL_REFUSED" | "TOOL_FAILED" | "INVALID_REQUEST" | "INTERNAL";

export interface ChatStreamRequest {
  chatId?: string;              // omit to start a new chat
  message: string;              // 1..2000 chars
  propertyId?: string;          // optional context: the roof the user is working on
  /** Quick-reply / card interaction answered by the user, e.g. { cardId, value }. */
  reply?: { cardId: string; value: string };
}

export interface ChatSummary { chatId: string; title: string; propertyId?: string; updatedAt: string }

export interface ChatStoredMessage {
  messageId: string;
  role: "user" | "assistant";
  createdAt: string;
  text: string;
  cards?: ChatCard[];
  proposals?: ChatProposal[];
}

export interface ChatListResponse { chats: ChatSummary[]; nextCursor?: string }
export interface ChatDetailResponse { chat: ChatSummary; messages: ChatStoredMessage[] }
export interface ChatConfirmRequest { proposalId: string }
export interface ChatConfirmResponse { proposalId: string; status: "EXECUTED" | "EXPIRED" | "ALREADY_EXECUTED"; card?: ChatCard }
