import { describe, expect, it } from "vitest";
import type { ChatCard } from "@solarsaathi/types";
import { parseSseChunk } from "../src/lib/chat-api";
import { applyStreamEvent, assistantPlaceholder, failLast, pinnedCards, userMessage, type ChatState } from "../src/components/chat/chat-state";

const card = (cardId: string, kind: ChatCard["kind"]): ChatCard => ({ cardId, kind, title: cardId, data: { summary: "x" } });
const start = (): ChatState => ({ messages: [userMessage("hi"), assistantPlaceholder()] });

describe("chat stream state", () => {
  it("accumulates text, tools, cards, proposals and finishes on done", () => {
    let state = start();
    state = applyStreamEvent(state, { type: "meta", chatId: "c1", messageId: "m1" });
    state = applyStreamEvent(state, { type: "text", delta: "Hello " });
    state = applyStreamEvent(state, { type: "text", delta: "there" });
    state = applyStreamEvent(state, { type: "tool", name: "estimate_savings", state: "started" });
    state = applyStreamEvent(state, { type: "tool", name: "estimate_savings", state: "finished" });
    state = applyStreamEvent(state, { type: "card", card: card("k1", "SAVINGS") });
    state = applyStreamEvent(state, { type: "proposal", proposal: { proposalId: "p1", action: "CREATE_PROPERTY", summary: "Add it", expiresAt: "2026-10-11T00:10:00Z" } });
    state = applyStreamEvent(state, { type: "done" });
    const last = state.messages.at(-1)!;
    expect(state.chatId).toBe("c1");
    expect(last.text).toBe("Hello there");
    expect(last.tools).toEqual([{ name: "estimate_savings", state: "finished" }]);
    expect(last.cards).toHaveLength(1);
    expect(last.proposals).toHaveLength(1);
    expect(last.streaming).toBe(false);
  });

  it("replaces a card with the same id instead of duplicating it", () => {
    let state = start();
    state = applyStreamEvent(state, { type: "card", card: { ...card("k1", "QUOTE"), title: "old" } });
    state = applyStreamEvent(state, { type: "card", card: { ...card("k1", "QUOTE"), title: "new" } });
    expect(state.messages.at(-1)!.cards.map(item => item.title)).toEqual(["new"]);
  });

  it("records server errors and client failures without losing the text so far", () => {
    let state = applyStreamEvent(start(), { type: "text", delta: "Partial" });
    state = applyStreamEvent(state, { type: "error", code: "RATE_LIMITED", message: "slow down" });
    expect(state.messages.at(-1)).toMatchObject({ text: "Partial", streaming: false, error: { code: "RATE_LIMITED" } });
    const failed = failLast(start(), "network");
    expect(failed.messages.at(-1)!.error).toEqual({ code: "CLIENT", message: "network" });
    expect(failLast(state, "ignored").messages.at(-1)!.error?.code).toBe("RATE_LIMITED");
  });

  it("ignores stream events when there is no assistant message in progress", () => {
    const state: ChatState = { messages: [userMessage("hi")] };
    expect(applyStreamEvent(state, { type: "text", delta: "x" })).toBe(state);
  });

  it("pins the newest card of each decision kind in a stable order", () => {
    const messages = [{ ...assistantPlaceholder(), cards: [card("q1", "QUOTE"), card("r1", "ROOF_SUMMARY")] },
      { ...assistantPlaceholder(), cards: [card("q2", "QUOTE"), card("n1", "NOTICE")] }];
    expect(pinnedCards(messages).map(item => item.cardId)).toEqual(["r1", "q2"]);
  });
});

describe("SSE parsing", () => {
  it("parses complete frames, keeps a partial frame, and counts invalid ones", () => {
    const first = parseSseChunk('data: {"type":"text","delta":"a"}\n\ndata: {"type":"nope"}\n\ndata: {"type":"te');
    expect(first.events).toEqual([{ type: "text", delta: "a" }]);
    expect(first.invalid).toBe(1);
    const second = parseSseChunk(`${first.rest}xt","delta":"b"}\n\n`);
    expect(second.events).toEqual([{ type: "text", delta: "b" }]);
    expect(second.rest).toBe("");
  });
  it("ignores comments and joins multi-line data", () => {
    const parsed = parseSseChunk(': keepalive\n\ndata: {"type":"done"}\n\n');
    expect(parsed.events).toEqual([{ type: "done" }]);
  });
});
