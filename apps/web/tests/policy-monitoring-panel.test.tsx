// @vitest-environment jsdom
import React from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PolicyMonitoringPanel } from "../src/components/policy-monitoring-panel";

const operations = vi.hoisted(() => ({ runs: vi.fn(), conflicts: vi.fn() }));
const evidence = vi.hoisted(() => ({ detail: vi.fn(), review: vi.fn() }));
vi.mock("../src/lib/policy-operations-api", () => ({ policyOperationsApi: operations }));
vi.mock("../src/lib/policy-review-api", () => ({ policyReviewApi: evidence }));
const at = "2026-10-09T10:00:00.000Z";
const id = `CAND#${"a".repeat(32)}`;
const conflict = { candidateId: id, sourceId: "SRC#test", jurisdiction: "IN-XX", categoryHint: "STATE_SUBSIDY",
  claimKey: "claim.test", detectedAt: at, reviewStatus: "PENDING_APPROVAL", resolutionStatus: "UNRESOLVED",
  flags: ["POTENTIAL_CROSS_SOURCE_CONFLICT"] };
const detail = { candidate: { schemaVersion: 1, revision: 1, sourceCuratorId: "curator-1", conflictFlags: conflict.flags,
  candidate: { candidateId: id, categoryHint: "STATE_SUBSIDY", quotedText: "Fictional source quotation for a test.",
    claimKey: "claim.test", citation: { sourceUrl: "https://example.invalid/source" } } },
  source: { publisherName: "Example authority" }, document: { version: 1, retrievedAt: at },
  sourceFresh: true, sourceHealthStatus: "HEALTHY", sourceWarnings: [] };
function deferred<T>() { let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
beforeEach(() => { Object.values(operations).forEach(mock => mock.mockReset());
  Object.values(evidence).forEach(mock => mock.mockReset()); });
afterEach(cleanup);

describe("policy monitoring console", () => {
  it("shows crawler run outcomes and backlog without implying benefit approval", async () => {
    operations.runs.mockResolvedValue({ runs: [{ schemaVersion: 1, runId: "run-example", startedAt: at,
      finishedAt: at, status: "PARTIAL", checked: 2, changed: 1, failed: 1, skipped: 0, backlog: true,
      sourceOutcomes: [{ sourceId: "SRC#test", outcome: "FAILED" }] }], nextCursor: undefined });
    render(<PolicyMonitoringPanel userId="admin-1" demo={false} mode="runs" />);
    expect(await screen.findByText("Partial run")).toBeTruthy();
    expect(screen.getByText(/Backlog remains/)).toBeTruthy();
    expect(screen.getByText(/successful crawl does not verify benefit rules/)).toBeTruthy();
    expect(evidence.review).not.toHaveBeenCalled();
  });

  it("keeps an empty conflict page pageable, then requires a confirmation before reviewing evidence", async () => {
    operations.conflicts.mockResolvedValueOnce({ conflicts: [], nextCursor: "opaque-next" })
      .mockResolvedValueOnce({ conflicts: [conflict], nextCursor: undefined })
      .mockResolvedValueOnce({ conflicts: [], nextCursor: undefined });
    evidence.detail.mockResolvedValue(detail);
    evidence.review.mockResolvedValue({ candidate: { ...detail.candidate, reviewStatus: "APPROVED" } });
    render(<PolicyMonitoringPanel userId="reviewer-1" demo={false} mode="conflicts" />);
    await userEvent.click(await screen.findByRole("button", { name: "Load more conflicts" }));
    expect(operations.conflicts.mock.calls[1][2]).toBe("opaque-next");
    await userEvent.click(await screen.findByRole("button", { name: /State subsidy/ }));
    expect(await screen.findByText("Fictional source quotation for a test.")).toBeTruthy();
    await userEvent.type(screen.getByLabelText("Evidence review reason"), "Checked the conflicting official quotation");
    await userEvent.click(screen.getByRole("button", { name: "Review approval" }));
    expect(evidence.review).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Confirm evidence approval" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Confirm approve" }));
    await waitFor(() => expect(evidence.review).toHaveBeenCalledWith("reviewer-1", id, "approve", 1,
      "Checked the conflicting official quotation", expect.any(AbortSignal)));
    expect(await screen.findByText(/No benefit was published/)).toBeTruthy();
  });

  it("drops a pending run response on account change", async () => {
    const late = deferred<{ runs: typeof demoRuns; nextCursor?: string }>();
    const demoRuns = [{ schemaVersion: 1, runId: "old-run", startedAt: at, finishedAt: at,
      status: "COMPLETED", checked: 1, changed: 0, failed: 0, skipped: 0, backlog: false, sourceOutcomes: [] }];
    operations.runs.mockReturnValueOnce(late.promise).mockResolvedValueOnce({ runs: [], nextCursor: undefined });
    const view = render(<PolicyMonitoringPanel userId="admin-a" demo={false} mode="runs" />);
    const oldSignal = operations.runs.mock.calls[0][1] as AbortSignal;
    view.rerender(<PolicyMonitoringPanel userId="admin-b" demo={false} mode="runs" />);
    expect(oldSignal.aborted).toBe(true);
    await act(async () => late.resolve({ runs: demoRuns }));
    expect(screen.queryByText("old-run")).toBeNull();
  });
});
