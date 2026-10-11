import { randomBytes, randomUUID } from "node:crypto";
import type { ChatCard, ChatProposal, ChatStoredMessage, ChatSummary } from "@solarsaathi/types";
import { RequestError } from "../lib/http";
import type { Item, ItemKey, ItemTable } from "../lib/item-table";
import { CHAT_CONFIG } from "./config";
import { chatKey, chatPartition, messageKey, messagePrefix } from "./keys";

interface StoredChat extends Item {
  entityType: "CHAT"; chatId: string; title: string; propertyId?: string; createdAt: string; updatedAt: string;
  messageCount: number; expiresAtEpochSeconds: number;
}
interface StoredMessage extends Item {
  entityType: "CHAT_MESSAGE"; chatId: string; messageId: string; role: "user" | "assistant"; createdAt: string;
  text: string; cards?: ChatCard[]; proposals?: ChatProposal[]; toolSummaries?: string[]; expiresAtEpochSeconds: number;
}
export interface StoredTurnMessage extends ChatStoredMessage { toolSummaries?: string[] }

const notFound = () => new RequestError(404, "CHAT_NOT_FOUND", "The conversation was not found.");
const epoch = (date: Date) => Math.floor(date.getTime() / 1_000);

function encodeCursor(userId: string, kind: "chats" | "messages", chatId: string, key: ItemKey | undefined) {
  return key ? Buffer.from(JSON.stringify({ v: 1, u: userId, k: kind, c: chatId, key })).toString("base64url") : undefined;
}

function decodeCursor(cursor: string | undefined, userId: string, kind: "chats" | "messages", chatId: string,
  prefix: string): ItemKey | undefined {
  if (cursor === undefined) return undefined;
  const invalid = () => new RequestError(400, "INVALID_CURSOR", "Use a pagination cursor from this listing.");
  if (cursor.length > 2_048 || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw invalid();
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Record<string, unknown>;
    const key = parsed.key as Record<string, unknown> | undefined;
    if (parsed.v !== 1 || parsed.u !== userId || parsed.k !== kind || parsed.c !== chatId || !key ||
      key.PK !== chatPartition(userId) || typeof key.SK !== "string" || !key.SK.startsWith(prefix) ||
      Object.keys(key).length !== 2) throw invalid();
    return { PK: key.PK as string, SK: key.SK };
  } catch (error) { throw error instanceof RequestError ? error : invalid(); }
}

/** Sortable, unguessable chat id: 13-digit epoch milliseconds + 64 random bits. Matches the shared identifier schema. */
export function newChatId(now: Date, random: () => string = () => randomBytes(8).toString("hex")) {
  return `c${String(now.getTime()).padStart(13, "0")}-${random()}`;
}

export class ChatStore {
  constructor(private readonly table: ItemTable, private readonly now: () => Date = () => new Date(),
    private readonly createId: () => string = randomUUID) {}

  private expiry() { return epoch(this.now()) + CHAT_CONFIG.conversationTtlDays * 86_400; }
  private summary(chat: StoredChat): ChatSummary {
    return { chatId: chat.chatId, title: chat.title, ...(chat.propertyId ? { propertyId: chat.propertyId } : {}),
      updatedAt: chat.updatedAt };
  }

  async getChat(userId: string, chatId: string): Promise<ChatSummary | undefined> {
    const item = await this.table.get(chatKey(userId, chatId));
    return item ? this.summary(item as StoredChat) : undefined;
  }

  async requireChat(userId: string, chatId: string): Promise<StoredChat> {
    const item = await this.table.get(chatKey(userId, chatId));
    if (!item || item.entityType !== "CHAT") throw notFound();
    return item as StoredChat;
  }

  async createChat(userId: string, input: { title: string; propertyId?: string }): Promise<ChatSummary> {
    const existing = await this.table.queryPrefix({ pk: chatPartition(userId), skPrefix: "CHAT#",
      limit: CHAT_CONFIG.maxChatsPerUser + 1 });
    if (existing.items.length >= CHAT_CONFIG.maxChatsPerUser) {
      throw new RequestError(409, "CHAT_LIMIT", "You have reached the saved conversation limit. Delete an old conversation to start a new one.");
    }
    const at = this.now().toISOString();
    const chatId = newChatId(this.now());
    const chat: StoredChat = { ...chatKey(userId, chatId), entityType: "CHAT", chatId,
      title: input.title.slice(0, CHAT_CONFIG.titleMaxChars), ...(input.propertyId ? { propertyId: input.propertyId } : {}),
      createdAt: at, updatedAt: at, messageCount: 0, expiresAtEpochSeconds: this.expiry() };
    await this.table.put(chat, { ifAbsent: true });
    return this.summary(chat);
  }

  async appendMessage(userId: string, chatId: string, message: Omit<StoredTurnMessage, "messageId" | "createdAt"> &
    { messageId?: string; createdAt?: string }): Promise<StoredTurnMessage> {
    const chat = await this.requireChat(userId, chatId);
    if (chat.messageCount >= CHAT_CONFIG.maxMessagesPerChat) {
      throw new RequestError(409, "CHAT_FULL", "This conversation is full. Start a new conversation to continue.");
    }
    const createdAt = message.createdAt ?? this.now().toISOString();
    const messageId = message.messageId ?? this.createId();
    const record: StoredMessage = { ...messageKey(userId, chatId, createdAt, messageId), entityType: "CHAT_MESSAGE",
      chatId, messageId, role: message.role, createdAt, text: message.text,
      ...(message.cards?.length ? { cards: message.cards } : {}),
      ...(message.proposals?.length ? { proposals: message.proposals } : {}),
      ...(message.toolSummaries?.length ? { toolSummaries: message.toolSummaries } : {}),
      expiresAtEpochSeconds: this.expiry() };
    await this.table.put(record, { ifAbsent: true });
    await this.table.put({ ...chat, updatedAt: createdAt, messageCount: chat.messageCount + 1,
      expiresAtEpochSeconds: this.expiry() });
    return { messageId, role: message.role, createdAt, text: message.text, ...(message.cards?.length ? { cards: message.cards } : {}),
      ...(message.proposals?.length ? { proposals: message.proposals } : {}),
      ...(message.toolSummaries?.length ? { toolSummaries: message.toolSummaries } : {}) };
  }

  /** Oldest-first messages for a chat. Internal `toolSummaries` are included only when `internal` is true. */
  async listMessages(userId: string, chatId: string, options: { limit?: number; cursor?: string; internal?: boolean } = {}) {
    await this.requireChat(userId, chatId);
    const prefix = messagePrefix(chatId);
    const page = await this.table.queryPrefix({ pk: chatPartition(userId), skPrefix: prefix,
      limit: options.limit ?? CHAT_CONFIG.messagePageSize,
      startKey: decodeCursor(options.cursor, userId, "messages", chatId, prefix) });
    const messages = page.items.filter(item => item.entityType === "CHAT_MESSAGE").map(item => {
      const message = item as StoredMessage;
      return { messageId: message.messageId, role: message.role, createdAt: message.createdAt, text: message.text,
        ...(message.cards ? { cards: message.cards } : {}), ...(message.proposals ? { proposals: message.proposals } : {}),
        ...(options.internal && message.toolSummaries ? { toolSummaries: message.toolSummaries } : {}) } as StoredTurnMessage;
    });
    return { messages, nextCursor: encodeCursor(userId, "messages", chatId, page.lastKey) };
  }

  /** Most recent N messages, oldest first (model context window). */
  async recentMessages(userId: string, chatId: string, count: number): Promise<StoredTurnMessage[]> {
    await this.requireChat(userId, chatId);
    const page = await this.table.queryPrefix({ pk: chatPartition(userId), skPrefix: messagePrefix(chatId),
      limit: count, descending: true });
    return page.items.reverse().map(item => {
      const message = item as StoredMessage;
      return { messageId: message.messageId, role: message.role, createdAt: message.createdAt, text: message.text,
        ...(message.toolSummaries ? { toolSummaries: message.toolSummaries } : {}) };
    });
  }

  async listChats(userId: string, options: { limit?: number; cursor?: string } = {}) {
    const prefix = "CHAT#";
    const page = await this.table.queryPrefix({ pk: chatPartition(userId), skPrefix: prefix,
      limit: options.limit ?? CHAT_CONFIG.listPageSize, descending: true,
      startKey: decodeCursor(options.cursor, userId, "chats", "", prefix) });
    return { chats: page.items.filter(item => item.entityType === "CHAT").map(item => this.summary(item as StoredChat)),
      nextCursor: encodeCursor(userId, "chats", "", page.lastKey) };
  }

  async deleteChat(userId: string, chatId: string): Promise<void> {
    await this.requireChat(userId, chatId);
    const keys: ItemKey[] = [chatKey(userId, chatId)];
    let startKey: ItemKey | undefined;
    do {
      const page = await this.table.queryPrefix({ pk: chatPartition(userId), skPrefix: messagePrefix(chatId), limit: 100, startKey });
      keys.push(...page.items.map(item => ({ PK: item.PK, SK: item.SK })));
      startKey = page.lastKey;
    } while (startKey);
    // Messages first; the header goes last so a partial failure can be retried through the same delete call.
    await this.table.deleteMany([...keys.slice(1), keys[0]!]);
  }

  async deleteAll(userId: string): Promise<{ deletedChats: number }> {
    const keys: ItemKey[] = [];
    let chats = 0;
    for (const prefix of ["MSG#", "CHAT#", "PROPOSAL#"]) {
      let startKey: ItemKey | undefined;
      do {
        const page = await this.table.queryPrefix({ pk: chatPartition(userId), skPrefix: prefix, limit: 100, startKey });
        for (const item of page.items) { keys.push({ PK: item.PK, SK: item.SK }); if (prefix === "CHAT#") chats++; }
        startKey = page.lastKey;
      } while (startKey);
    }
    await this.table.deleteMany(keys);
    return { deletedChats: chats };
  }
}
