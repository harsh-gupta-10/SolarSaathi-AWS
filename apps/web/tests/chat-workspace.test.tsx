// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ChatStreamEvent } from "@solarsaathi/types";
import { ChatWorkspace } from "../src/components/chat/chat-workspace";

const api = vi.hoisted(() => ({ configured: vi.fn(() => true), list: vi.fn(), get: vi.fn(), remove: vi.fn(), removeAll: vi.fn(), confirm: vi.fn(), stream: vi.fn() }));
vi.mock("../src/lib/chat-api", () => ({ chatApi: api }));
const auth = vi.hoisted(() => ({ value: { status: "signedIn" } as { status: string } }));
vi.mock("../src/auth/auth-provider", () => ({ useAuth: () => auth.value }));

function streams(events: ChatStreamEvent[]) {
  api.stream.mockImplementation(async (_request: unknown, onEvent: (event: ChatStreamEvent) => void) => { for (const event of events) onEvent(event); });
}

beforeEach(() => {
  sessionStorage.clear();
  auth.value = { status: "signedIn" };
  api.list.mockResolvedValue({ chats: [] });
  Element.prototype.scrollTo = vi.fn();
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("chat workspace", () => {
  it("asks signed-out visitors to sign in", () => {
    auth.value = { status: "signedOut" };
    render(<ChatWorkspace />);
    expect(screen.getByRole("heading", { name: "Sign in to chat with SolarSaathi" })).toBeTruthy();
    expect(api.stream).not.toHaveBeenCalled();
  });

  it("sends a question and renders streamed text, a card with its source, and a proposal that needs confirmation", async () => {
    streams([
      { type: "meta", chatId: "c1", messageId: "m1" },
      { type: "text", delta: "Here is a cost range." },
      { type: "card", card: { cardId: "k1", kind: "QUOTE", title: "Indicative cost", data: { rows: [{ label: "Typical", value: "₹1,80,000", emphasis: true }],
        disclaimer: "Indicative estimate, not an offer." }, provenance: { source: "PRICE_BENCHMARK@v2", verificationStatus: "INDICATIVE" } } },
      { type: "proposal", proposal: { proposalId: "p1", action: "CREATE_APPLICATION", summary: "Create your application checklist", expiresAt: "2026-10-11T01:00:00Z" } },
      { type: "done" },
    ]);
    api.confirm.mockResolvedValue({ proposalId: "p1", status: "EXECUTED" });
    const user = userEvent.setup();
    render(<ChatWorkspace />);
    await user.type(screen.getByLabelText("Message SolarSaathi"), "What will 3 kW cost?");
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("Here is a cost range.")).toBeTruthy();
    expect(api.stream).toHaveBeenCalledWith({ message: "What will 3 kW cost?" }, expect.any(Function), expect.any(AbortSignal));
    expect(screen.getAllByText("₹1,80,000").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Indicative").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Source: PRICE_BENCHMARK@v2/).length).toBeGreaterThan(0);
    expect(api.confirm).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(api.confirm).toHaveBeenCalledWith("p1"));
    expect(await screen.findByText("Done.")).toBeTruthy();
  });

  it("shows a helpful message for a guardrail block and a rate limit", async () => {
    streams([{ type: "error", code: "GUARDRAIL_BLOCKED", message: "blocked" }]);
    const user = userEvent.setup();
    render(<ChatWorkspace />);
    await user.type(screen.getByLabelText("Message SolarSaathi"), "write me a poem");
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText(/I can only help with rooftop solar/)).toBeTruthy();
  });

  it("explains a model-access failure and shows the support reference", async () => {
    streams([{ type: "error", code: "MODEL_ACCESS_DENIED", message: "not enabled", requestId: "req-abc" }]);
    const user = userEvent.setup();
    render(<ChatWorkspace />);
    await user.type(screen.getByLabelText("Message SolarSaathi"), "hello");
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText(/has not been switched on for this deployment/)).toBeTruthy();
    expect(screen.getByText("Reference for support: req-abc")).toBeTruthy();
  });

  it("answers a question card by posting the chosen reply back", async () => {
    streams([{ type: "card", card: { cardId: "q1", kind: "QUESTION", title: "One more thing", data: { question: { text: "Do you own the house?", options: [{ label: "Yes", value: "OWNER" }, { label: "No", value: "TENANT" }] } } } }, { type: "done" }]);
    const user = userEvent.setup();
    render(<ChatWorkspace />);
    await user.type(screen.getByLabelText("Message SolarSaathi"), "Am I eligible?");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await user.click(await screen.findByRole("button", { name: "Yes" }));
    await waitFor(() => expect(api.stream).toHaveBeenCalledTimes(2));
    expect(api.stream.mock.calls[1]![0]).toEqual({ chatId: undefined, message: "Yes", reply: { cardId: "q1", value: "OWNER" } });
  });

  it("starts with the question carried over from the marketing page", async () => {
    sessionStorage.setItem("solarsaathi.pendingQuestion", "Am I eligible for PM Surya Ghar?");
    streams([{ type: "done" }]);
    render(<ChatWorkspace />);
    await waitFor(() => expect(api.stream).toHaveBeenCalled());
    expect(api.stream.mock.calls[0]![0]).toEqual({ message: "Am I eligible for PM Surya Ghar?" });
    expect(sessionStorage.getItem("solarsaathi.pendingQuestion")).toBeNull();
  });
});
