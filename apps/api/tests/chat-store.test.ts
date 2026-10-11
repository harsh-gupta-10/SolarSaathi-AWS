import { describe, expect, it } from "vitest";
import { CHAT_CONFIG } from "../src/chat/config";
import { idempotencyHeader, runIdempotent } from "../src/chat/idempotency";
import { ChatLimits } from "../src/chat/limits";
import { ProposalStore } from "../src/chat/proposals";
import { maskSensitive } from "../src/chat/redact";
import { chatStreamRequestSchema } from "../src/chat/schema";
import { ChatStore } from "../src/chat/store";
import { RequestError } from "../src/lib/http";
import { counterId, fixedClock, MemoryItemTable } from "./chat-fixtures";

const userA = "11111111-1111-4111-8111-111111111111", userB = "22222222-2222-4222-8222-222222222222";

describe("conversation store", () => {
  const setup = () => { const table = new MemoryItemTable(); let tick = 0;
    const now = () => new Date(fixedClock().getTime() + (tick++) * 1000);
    return { table, store: new ChatStore(table, now, counterId("m")) }; };

  it("stores chats and messages with a 90-day TTL, paginates and isolates users", async () => {
    const { table, store } = setup();
    const chat = await store.createChat(userA, { title: "Solar for my Pune house" });
    await store.appendMessage(userA, chat.chatId, { role: "user", text: "hi" });
    await store.appendMessage(userA, chat.chatId, { role: "assistant", text: "hello", cards: [] });
    const header = [...table.items.values()].find(item => item.entityType === "CHAT")!;
    expect(Number(header.expiresAtEpochSeconds) - Math.floor(fixedClock().getTime() / 1000)).toBeGreaterThanOrEqual(90 * 86_400);
    const first = await store.listMessages(userA, chat.chatId, { limit: 1 });
    expect(first.messages.map(item => item.text)).toEqual(["hi"]);
    const second = await store.listMessages(userA, chat.chatId, { limit: 1, cursor: first.nextCursor });
    expect(second.messages.map(item => item.text)).toEqual(["hello"]);
    expect((await store.listChats(userA)).chats).toHaveLength(1);
    expect((await store.listChats(userB)).chats).toHaveLength(0);
    await expect(store.listMessages(userB, chat.chatId)).rejects.toMatchObject({ code: "CHAT_NOT_FOUND" });
    await expect(store.deleteChat(userB, chat.chatId)).rejects.toMatchObject({ code: "CHAT_NOT_FOUND" });
  });

  it("rejects a cursor from another user or listing", async () => {
    const { store } = setup();
    const chat = await store.createChat(userA, { title: "a" });
    await store.appendMessage(userA, chat.chatId, { role: "user", text: "1" });
    await store.appendMessage(userA, chat.chatId, { role: "user", text: "2" });
    const page = await store.listMessages(userA, chat.chatId, { limit: 1 });
    const other = await store.createChat(userB, { title: "b" });
    await expect(store.listMessages(userB, other.chatId, { cursor: page.nextCursor })).rejects.toMatchObject({ code: "INVALID_CURSOR" });
    await expect(store.listChats(userA, { cursor: page.nextCursor })).rejects.toMatchObject({ code: "INVALID_CURSOR" });
  });

  it("deletes one chat and all chats without touching counters", async () => {
    const { table, store } = setup();
    const limits = new ChatLimits(table, fixedClock);
    await limits.startTurn(userA);
    const one = await store.createChat(userA, { title: "one" }); const two = await store.createChat(userA, { title: "two" });
    await store.appendMessage(userA, one.chatId, { role: "user", text: "x" });
    await store.deleteChat(userA, one.chatId);
    expect((await store.listChats(userA)).chats.map(item => item.chatId)).toEqual([two.chatId]);
    expect([...table.items.values()].some(item => String(item.SK).startsWith(`MSG#${one.chatId}`))).toBe(false);
    expect((await store.deleteAll(userA)).deletedChats).toBe(1);
    expect((await store.listChats(userA)).chats).toEqual([]);
    expect([...table.items.values()].some(item => String(item.SK).startsWith("RL#"))).toBe(true);
  });

  it("caps chats per user and messages per chat", async () => {
    const { store } = setup();
    for (let index = 0; index < CHAT_CONFIG.maxChatsPerUser; index++) await store.createChat(userA, { title: String(index) });
    await expect(store.createChat(userA, { title: "extra" })).rejects.toMatchObject({ code: "CHAT_LIMIT" });
    const chat = await store.createChat(userB, { title: "b" });
    for (let index = 0; index < CHAT_CONFIG.maxMessagesPerChat; index++) await store.appendMessage(userB, chat.chatId, { role: "user", text: String(index) });
    await expect(store.appendMessage(userB, chat.chatId, { role: "user", text: "overflow" })).rejects.toMatchObject({ code: "CHAT_FULL" });
  });
});

describe("limits and input schema", () => {
  it("rate limits per hour, then enforces the daily token budget", async () => {
    const table = new MemoryItemTable();
    const limits = new ChatLimits(table, fixedClock);
    for (let index = 0; index < CHAT_CONFIG.turnsPerHour; index++) expect((await limits.startTurn(userA)).allowed).toBe(true);
    expect(await limits.startTurn(userA)).toMatchObject({ allowed: false, code: "RATE_LIMITED" });
    expect((await limits.startTurn(userB)).allowed).toBe(true);
    await limits.recordTokens(userB, CHAT_CONFIG.dailyTokenBudget);
    expect(await limits.startTurn(userB)).toMatchObject({ allowed: false, code: "BUDGET_EXCEEDED" });
  });

  it("validates messages strictly", () => {
    expect(chatStreamRequestSchema.safeParse({ message: "  hello  " }).data?.message).toBe("hello");
    for (const bad of [{ message: "" }, { message: "x".repeat(2_001) }, { message: "ok", extra: 1 }, { message: "a\u0000b" }, { message: "ok", chatId: "../x" }]) {
      expect(chatStreamRequestSchema.safeParse(bad).success).toBe(false);
    }
    expect(chatStreamRequestSchema.safeParse({ message: "x".repeat(2_000), reply: { cardId: "c", value: "OWNER" } }).success).toBe(true);
  });
});

describe("sensitive text masking", () => {
  it("masks Aadhaar, PAN, IFSC, cards, OTP, passwords, accounts and consumer numbers", () => {
    const text = "Aadhaar 2345 6789 0123, PAN ABCDE1234F, IFSC SBIN0001234, card 4111 1111 1111 1111, OTP is 482913, password: hunter2, account number 123456789012, consumer number 1234567890";
    const result = maskSensitive(text);
    for (const secret of ["2345 6789 0123", "ABCDE1234F", "SBIN0001234", "4111 1111 1111 1111", "482913", "hunter2", "123456789012", "1234567890"]) {
      expect(result.text).not.toContain(secret);
    }
    expect(result.kinds).toEqual(expect.arrayContaining(["AADHAAR", "PAN", "IFSC", "CARD", "OTP", "PASSWORD", "BANK_ACCOUNT", "CONSUMER_NUMBER"]));
  });
  it("leaves ordinary solar figures alone", () => {
    expect(maskSensitive("My bill is 4500 rupees for 600 units, 3 kW, roof 80 sqm").masked).toBe(0);
  });
});

describe("proposals", () => {
  const setup = () => { const table = new MemoryItemTable(); let now = fixedClock();
    return { table, advance: (ms: number) => { now = new Date(now.getTime() + ms); },
      store: new ProposalStore(table, () => now, counterId("a".repeat(3))) }; };
  const execute = () => { const calls: unknown[] = []; return { calls, run: async (action: string, params: unknown) => { calls.push([action, params]); return {}; } }; };

  it("executes only after confirm and only once", async () => {
    const { store } = setup(); const exec = execute();
    const proposal = await store.create(userA, { action: "CREATE_PROPERTY", params: { label: "Home", address: "12 Main Road Pune" }, summary: "s" });
    expect(exec.calls).toHaveLength(0);
    expect(await store.confirm(userA, proposal.proposalId, exec.run)).toMatchObject({ status: "EXECUTED" });
    expect(await store.confirm(userA, proposal.proposalId, exec.run)).toMatchObject({ status: "ALREADY_EXECUTED" });
    expect(exec.calls).toHaveLength(1);
  });

  it("expires after ten minutes without executing", async () => {
    const { store, advance } = setup(); const exec = execute();
    const proposal = await store.create(userA, { action: "CREATE_PROPERTY", params: {}, summary: "s" });
    advance(CHAT_CONFIG.proposalTtlSeconds * 1000 + 1_000);
    expect(await store.confirm(userA, proposal.proposalId, exec.run)).toMatchObject({ status: "EXPIRED" });
    expect(exec.calls).toHaveLength(0);
  });

  it("rejects another user's proposal id and tampered stored params", async () => {
    const { store, table } = setup(); const exec = execute();
    const proposal = await store.create(userA, { action: "CREATE_PROPERTY", params: { label: "Home" }, summary: "s" });
    await expect(store.confirm(userB, proposal.proposalId, exec.run)).rejects.toMatchObject({ code: "PROPOSAL_NOT_FOUND" });
    const stored = [...table.items.values()].find(item => item.entityType === "CHAT_PROPOSAL")!;
    (stored.params as Record<string, unknown>).label = "Tampered";
    await expect(store.confirm(userA, proposal.proposalId, exec.run)).rejects.toMatchObject({ code: "PROPOSAL_INTEGRITY" });
    expect(exec.calls).toHaveLength(0);
  });

  it("allows a retry after a server failure but not after a rejected request", async () => {
    const { store } = setup();
    const server = await store.create(userA, { action: "CREATE_PROPERTY", params: {}, summary: "s" });
    await expect(store.confirm(userA, server.proposalId, async () => { throw new RequestError(503, "DATABASE_UNAVAILABLE", "x"); })).rejects.toBeInstanceOf(RequestError);
    expect(await store.confirm(userA, server.proposalId, async () => ({}))).toMatchObject({ status: "EXECUTED" });
    const bad = await store.create(userA, { action: "CREATE_PROPERTY", params: {}, summary: "s" });
    await expect(store.confirm(userA, bad.proposalId, async () => { throw new RequestError(400, "INVALID_REQUEST", "x"); })).rejects.toBeInstanceOf(RequestError);
    expect(await store.confirm(userA, bad.proposalId, async () => ({}))).toMatchObject({ status: "EXPIRED" });
  });

  it("claims atomically so concurrent confirms execute once", async () => {
    const { store } = setup(); const exec = execute();
    const proposal = await store.create(userA, { action: "CREATE_PROPERTY", params: {}, summary: "s" });
    const results = await Promise.allSettled([store.confirm(userA, proposal.proposalId, exec.run), store.confirm(userA, proposal.proposalId, exec.run)]);
    expect(exec.calls).toHaveLength(1);
    expect(results.filter(item => item.status === "fulfilled" && item.value.status === "EXECUTED")).toHaveLength(1);
  });
});

describe("idempotency", () => {
  it("runs a create once per key, replays the result and releases failed claims", async () => {
    const table = new MemoryItemTable(); let runs = 0;
    const create = async () => { runs++; return { propertyId: `p${runs}` }; };
    const first = await runIdempotent(table, userA, "CREATE_PROPERTY", "key-12345678", create, fixedClock);
    const again = await runIdempotent(table, userA, "CREATE_PROPERTY", "key-12345678", create, fixedClock);
    expect(again).toEqual({ value: { propertyId: "p1" }, replayed: true });
    expect(first.replayed).toBe(false); expect(runs).toBe(1);
    expect((await runIdempotent(table, userB, "CREATE_PROPERTY", "key-12345678", create, fixedClock)).replayed).toBe(false);
    await expect(runIdempotent(table, userA, "CREATE_PROPERTY", "key-failing01", async () => { throw new Error("boom"); }, fixedClock)).rejects.toThrow("boom");
    expect((await runIdempotent(table, userA, "CREATE_PROPERTY", "key-failing01", create, fixedClock)).replayed).toBe(false);
  });
  it("rejects a concurrent duplicate and malformed keys; no key means no dedupe", async () => {
    const table = new MemoryItemTable(); let release!: () => void;
    const slow = runIdempotent(table, userA, "S", "key-concurrent", () => new Promise<string>(resolve => { release = () => resolve("done"); }), fixedClock);
    await new Promise(resolve => setTimeout(resolve, 5));
    await expect(runIdempotent(table, userA, "S", "key-concurrent", async () => "second", fixedClock)).rejects.toMatchObject({ code: "IDEMPOTENCY_IN_PROGRESS" });
    release(); await slow;
    expect(() => idempotencyHeader({ "Idempotency-Key": "short" })).toThrow();
    expect(idempotencyHeader({ "idempotency-key": "valid-key-123" })).toBe("valid-key-123");
    expect(idempotencyHeader({})).toBeUndefined();
    let runs = 0; await runIdempotent(table, userA, "S", undefined, async () => ++runs); await runIdempotent(table, userA, "S", undefined, async () => ++runs);
    expect(runs).toBe(2);
  });
});
