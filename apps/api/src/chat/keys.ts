import type { ItemKey } from "../lib/item-table";

/**
 * Chat items live in the core table under their own partition prefix (not `USER#`), so the chat Lambdas' IAM
 * `dynamodb:LeadingKeys` condition can grant them write access without letting them touch account profile items.
 * Item layout under PK `CHAT#{userId}`:
 *   SK `CHAT#{chatId}`                  conversation header
 *   SK `MSG#{chatId}#{ts}#{messageId}`  messages (time ordered)
 *   SK `PROPOSAL#{proposalId}`          single-use proposals
 *   SK `RL#H#{hour}` / `RL#D#{day}` / `TOK#D#{day}`  rate-limit and token counters
 * Idempotency claims use PK `IDEMPOTENCY#{userId}`.
 */
export const chatPartition = (userId: string) => `CHAT#${userId}`;
export const chatKey = (userId: string, chatId: string): ItemKey => ({ PK: chatPartition(userId), SK: `CHAT#${chatId}` });
export const messagePrefix = (chatId: string) => `MSG#${chatId}#`;
export const messageKey = (userId: string, chatId: string, createdAt: string, messageId: string): ItemKey =>
  ({ PK: chatPartition(userId), SK: `${messagePrefix(chatId)}${createdAt}#${messageId}` });
export const proposalKey = (userId: string, proposalId: string): ItemKey =>
  ({ PK: chatPartition(userId), SK: `PROPOSAL#${proposalId}` });
export const hourlyKey = (userId: string, hour: string): ItemKey => ({ PK: chatPartition(userId), SK: `RL#H#${hour}` });
export const dailyKey = (userId: string, day: string): ItemKey => ({ PK: chatPartition(userId), SK: `RL#D#${day}` });
export const researchKey = (userId: string, day: string): ItemKey => ({ PK: chatPartition(userId), SK: `RL#R#${day}` });
export const tokenKey = (userId: string, day: string): ItemKey => ({ PK: chatPartition(userId), SK: `TOK#D#${day}` });
export const idempotencyKey = (userId: string, scope: string, key: string): ItemKey =>
  ({ PK: `IDEMPOTENCY#${userId}`, SK: `${scope}#${key}` });
