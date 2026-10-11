// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AnalysisDraftProvider, DraftSaveIndicator, hasSavedDesignInputs, useDraftSection } from "../src/lib/analysis-draft";
import { clearStoredProperties } from "../src/lib/properties-store";

const api = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn() }));
vi.mock("../src/lib/drafts-api", () => ({ draftsApi: api }));

function QuoteField() {
  const [inputs, setInputs] = useDraftSection("financial", { quote: "", exportRate: "0" });
  return <label>Quote<input value={inputs.quote} onChange={event => setInputs({ quote: event.target.value })} /></label>;
}
const scope = { userId: "owner-1", propertyId: "property-1", analysisId: "analysis-1" };
const tree = () => <AnalysisDraftProvider {...scope}><QuoteField /><DraftSaveIndicator /></AnalysisDraftProvider>;

beforeEach(() => {
  localStorage.clear();
  api.get.mockReset().mockResolvedValue(undefined);
  api.save.mockReset().mockImplementation(async (_p: string, _a: string, draft: unknown) =>
    ({ schemaVersion: 1, requestId: "r", analysisId: "analysis-1", draft, updatedAt: "2026-10-11T10:00:00.000Z" }));
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("analysis form drafts", () => {
  it("keeps answers across unmounts and syncs them to the account", async () => {
    const user = userEvent.setup();
    const first = render(tree());
    await user.type(screen.getByLabelText("Quote"), "180000");
    await waitFor(() => expect(api.save).toHaveBeenCalled(), { timeout: 3_000 });
    expect(api.save).toHaveBeenLastCalledWith("property-1", "analysis-1",
      { schemaVersion: 1, financial: { quote: "180000" } }, expect.any(AbortSignal));
    expect(await screen.findByText("Answers saved to your account")).toBeTruthy();
    first.unmount();
    render(tree());
    expect((screen.getByLabelText("Quote") as HTMLInputElement).value).toBe("180000");
  });

  it("prefers a newer account copy and flushes a pending edit when the step closes", async () => {
    api.get.mockResolvedValue({ draft: { schemaVersion: 1, financial: { quote: "250000" } }, updatedAt: "2099-01-01T00:00:00.000Z" });
    const view = render(tree());
    await waitFor(() => expect((screen.getByLabelText("Quote") as HTMLInputElement).value).toBe("250000"));
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Quote"), "1");
    view.unmount();
    await waitFor(() => expect(api.save).toHaveBeenCalledWith("property-1", "analysis-1",
      { schemaVersion: 1, financial: { quote: "2500001" } }));
  });

  it("falls back to a device copy when the account cannot be reached, and clears it on sign-out", async () => {
    api.save.mockRejectedValue(new Error("offline"));
    const user = userEvent.setup();
    render(tree());
    await user.type(screen.getByLabelText("Quote"), "9");
    expect(await screen.findByText(/saved on this device/, undefined, { timeout: 3_000 })).toBeTruthy();
    expect(Object.keys(localStorage).some(key => key.startsWith("solarsaathi.draft.v1."))).toBe(true);
    act(() => clearStoredProperties());
    expect(Object.keys(localStorage).some(key => key.startsWith("solarsaathi.draft.v1."))).toBe(false);
  });

  it("never overwrites answers typed while the account copy is still loading", async () => {
    let resolve!: (value: unknown) => void;
    api.get.mockReturnValue(new Promise(done => { resolve = done; }));
    const user = userEvent.setup();
    render(tree());
    await user.type(screen.getByLabelText("Quote"), "42");
    await act(async () => resolve({ draft: { schemaVersion: 1, financial: { quote: "999" } }, updatedAt: "2099-01-01T00:00:00.000Z" }));
    expect((screen.getByLabelText("Quote") as HTMLInputElement).value).toBe("42");
    await waitFor(() => expect(api.save).toHaveBeenLastCalledWith("property-1", "analysis-1",
      { schemaVersion: 1, financial: { quote: "42" } }, expect.any(AbortSignal)), { timeout: 3_000 });
  });

  it("pushes unsynced offline answers instead of replacing them with the account copy", async () => {
    localStorage.setItem("solarsaathi.draft.v1.owner-1.property-1.analysis-1", JSON.stringify({
      draft: { schemaVersion: 1, financial: { quote: "7" } }, savedAt: "2000-01-01T00:00:00.000Z", synced: false }));
    api.get.mockResolvedValue({ draft: { schemaVersion: 1, financial: { quote: "999" } }, updatedAt: "2099-01-01T00:00:00.000Z" });
    render(tree());
    await waitFor(() => expect(api.save).toHaveBeenCalledWith("property-1", "analysis-1",
      { schemaVersion: 1, financial: { quote: "7" } }, expect.any(AbortSignal)));
    expect((screen.getByLabelText("Quote") as HTMLInputElement).value).toBe("7");
  });

  it("trims answers to the account's size limit", async () => {
    const user = userEvent.setup();
    render(tree());
    await user.click(screen.getByLabelText("Quote"));
    await user.paste("x".repeat(250));
    await waitFor(() => expect(api.save).toHaveBeenCalled(), { timeout: 3_000 });
    expect((api.save.mock.lastCall![2] as { financial: { quote: string } }).financial.quote).toHaveLength(200);
  });

  it("reports saved sizing answers so a reload can reopen the sizing step", async () => {
    expect(await hasSavedDesignInputs("owner-1", "property-1", "analysis-1")).toBe(false);
    api.get.mockResolvedValue({ draft: { schemaVersion: 1, design: { consumption: "320" } }, updatedAt: "2026-10-11T10:00:00.000Z" });
    expect(await hasSavedDesignInputs("owner-1", "property-1", "analysis-1")).toBe(true);
  });

  it("uses plain component state outside the live flow", async () => {
    const user = userEvent.setup();
    render(<QuoteField />);
    await user.type(screen.getByLabelText("Quote"), "5");
    expect((screen.getByLabelText("Quote") as HTMLInputElement).value).toBe("5");
    expect(api.save).not.toHaveBeenCalled();
  });
});
