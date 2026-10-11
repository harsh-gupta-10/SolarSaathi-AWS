import { z } from "zod";
import { identifier } from "../data/schemas";
import { CHAT_CONFIG } from "./config";

const noControlCharacters = (value: string) =>
  !Array.from(value).some(character => {
    const code = character.charCodeAt(0);
    return (code < 32 && code !== 10 && code !== 9) || code === 127;
  });

export const chatMessageSchema = z.string().trim()
  .min(CHAT_CONFIG.messageMinChars).max(CHAT_CONFIG.messageMaxChars).refine(noControlCharacters);

/** Wire request for the streaming endpoint (`ChatStreamRequest`). Unknown fields are rejected. */
export const chatStreamRequestSchema = z.object({
  chatId: identifier.optional(),
  message: chatMessageSchema,
  propertyId: identifier.optional(),
  reply: z.object({ cardId: z.string().min(1).max(128), value: z.string().min(1).max(500) }).strict().optional(),
}).strict();
export type ChatStreamRequestInput = z.infer<typeof chatStreamRequestSchema>;

export const chatConfirmRequestSchema = z.object({ proposalId: z.string().regex(/^[a-f0-9]{32}$/) }).strict();
export const chatListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(CHAT_CONFIG.listPageSize),
  cursor: z.string().min(1).max(2_048).optional(),
}).strict();
