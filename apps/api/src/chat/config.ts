/** Single source for chat limits. Tuned for cost control; override only through code review. */
export const CHAT_CONFIG = Object.freeze({
  messageMinChars: 1,
  messageMaxChars: 2_000,
  /** Retention of stored conversations, proposals and counters (DynamoDB TTL attribute expiresAtEpochSeconds). */
  conversationTtlDays: 90,
  maxChatsPerUser: 50,
  maxMessagesPerChat: 80,
  historyMessagesForModel: 12,
  historyCharsPerMessage: 1_500,
  titleMaxChars: 60,
  listPageSize: 20,
  messagePageSize: 80,
  /** Per-user turn limits (token-bucket style fixed windows). */
  turnsPerHour: 30,
  turnsPerDay: 200,
  /** Hard daily Bedrock token budget per user (input + output). */
  dailyTokenBudget: 400_000,
  /** Agent loop limits. */
  maxToolIterations: 8,
  maxOutputTokens: 1_500,
  turnTimeoutMs: 100_000,
  modelCallTimeoutMs: 60_000,
  maxToolResultChars: 6_000,
  /** Proposals. */
  proposalTtlSeconds: 600,
  idempotencyTtlSeconds: 86_400,
  /** Retries after which a repeated pending idempotency claim is considered abandoned. */
  idempotencyPendingSeconds: 120,
  /** Brave research: bounded per turn. */
  researchMaxPages: 3,
  researchQueriesPerTurn: 1,
  researchPerDay: 5,
} as const);

export const CHAT_REFUSAL_MESSAGE =
  "I can help with rooftop solar, electricity bills, subsidies, installation and using SolarSaathi. I can't help with that request.";
