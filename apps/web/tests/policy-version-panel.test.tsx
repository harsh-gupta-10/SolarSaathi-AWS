// @vitest-environment jsdom
import React from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PolicyVersionPanel } from "../src/components/policy-version-panel";

const api = vi.hoisted(() => ({ active: vi.fn(), rollbackQueue: vi.fn(), versions: vi.fn(), version: vi.fn(),
  requestRollback: vi.fn(), rollbackDetail: vi.fn(), reviewRollback: vi.fn() }));
vi.mock("../src/lib/policy-operations-api", () => ({ policyOperationsApi: api }));
const at = "2026-10-09T10:00:00.000Z";
const policyId = "POLICY#synthetic";
const active = { policyId, benefitId: "BENEFIT#synthetic", version: 3, scope: "STATE", jurisdiction: "IN-XX",
  effectiveFrom: "2026-01-01", activatedAt: at, sourceId: "SRC#synthetic", sourceUrl: "https://example.invalid/policy",
  lastCheckedAt: at, sourceFresh: true };
const versions = [3, 2].map(version => ({ version, isCurrent: version === 3, contentHash: "a".repeat(64),
  effectiveFrom: "2026-01-01", verifiedAt: at, activatedAt: at, sourceId: "SRC#synthetic",
  sourceUrl: "https://example.invalid/policy", verificationStatus: "VERIFIED" }));
function detail(version: number, sourceFresh = true, targetDocumentCurrent = true) {
  return { schemaVersion: 1, policyId, currentVersion: 3, isCurrent: version === 3,
    bundle: { schemaVersion: 1, policyId, benefitId: active.benefitId, activatedAt: at,
      version: { version, contentHash: "a".repeat(64), effectiveFrom: "2026-01-01", verificationStatus: "VERIFIED",
        documentRefs: [{ sourceId: "SRC#synthetic", documentId: "DOC#synthetic", documentVersion: version, sha256: "b".repeat(64) }] },
      facts: [{ factId: "FACT#synthetic", citation: { sourceUrl: "https://example.invalid/policy",
        publisherName: "Fictional authority", retrievedAt: at } }],
      rule: { scope: "STATE", jurisdiction: "IN-XX", effectiveFrom: "2026-01-01",
        amount: { kind: version === 3 ? "PERCENT_ELIGIBLE_COST" : "FIXED" }, eligibility: { allOf: [], anyOf: [] },
        compatibility: [], capPaise: 0 } }, sourceFresh, targetDocumentCurrent, lastCheckedAt: at, requestId: "request-1" };
}
const rollback = { schemaVersion: 1, rollbackId: "ROLLBACK#synthetic", policyId,
  targetVersion: 2, expectedActiveVersion: 3, status: "PENDING_APPROVAL", revision: 1,
  requestedAt: at, requestedBy: "requester-1", requestReason: "Fictional source correction request",
  targetSourceId: "SRC#synthetic", targetSourceCuratorId: "curator-1", targetVersionAuthorId: "author-1" };
function deferred<T>() { let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
function setup() {
  api.active.mockResolvedValue({ jurisdiction: "IN", items: [active], hasMore: false });
  api.rollbackQueue.mockResolvedValue({ items: [rollback], hasMore: false });
  api.versions.mockResolvedValue({ policyId, currentVersion: 3, items: versions, hasMore: false });
  api.version.mockImplementation((_user: string, _policy: string, version: number) => Promise.resolve(detail(version)));
  api.rollbackDetail.mockResolvedValue({ rollback, currentVersion: 3, sourceFresh: true,
    targetDocumentCurrent: true, lastCheckedAt: at });
}
beforeEach(() => { Object.values(api).forEach(mock => mock.mockReset()); setup(); });
afterEach(cleanup);

describe("published policy version console", () => {
  it("requires an exact jurisdiction selection and compares current pointer with historical rule terms", async () => {
    render(<PolicyVersionPanel userId="reviewer-1" demo={false} />);
    await userEvent.click(await screen.findByRole("button", { name: /BENEFIT#synthetic/ }));
    expect(await screen.findByText("Published, not current")).toBeTruthy();
    expect(screen.getByText("Current ACTIVE pointer")).toBeTruthy();
    expect(screen.getAllByText(/Rule form|Amount rule/).length).toBeGreaterThan(0);
    await userEvent.clear(screen.getByLabelText("Find active policies by jurisdiction"));
    await userEvent.type(screen.getByLabelText("Find active policies by jurisdiction"), "IN-MH");
    api.active.mockResolvedValue({ jurisdiction: "IN-MH", items: [], hasMore: false });
    await userEvent.click(screen.getByRole("button", { name: "Show jurisdiction" }));
    await waitFor(() => expect(api.active).toHaveBeenCalledWith("reviewer-1", "IN-MH", expect.any(AbortSignal)));
    expect(await screen.findByText("Active benefit policies · IN-MH")).toBeTruthy();
  });

  it("keeps approval blocked for stale, changed targets while permitting reasoned rejection", async () => {
    api.rollbackDetail.mockResolvedValue({ rollback, currentVersion: 4, sourceFresh: false,
      targetDocumentCurrent: false, lastCheckedAt: at });
    api.reviewRollback.mockResolvedValue({ rollback: { ...rollback, status: "REJECTED", revision: 2 } });
    const view = render(<PolicyVersionPanel userId="reviewer-1" demo={false} />);
    await userEvent.click(await screen.findByRole("button", { name: /POLICY#synthetic/ }));
    expect(await screen.findByText(/Current crawled document differs from the rollback target/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Review approval" }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(screen.getByRole("button", { name: "Review rejection" }));
    await userEvent.type(screen.getByLabelText("Review reason"), "Active pointer moved and document changed");
    await userEvent.click(screen.getByRole("button", { name: "Confirm reject" }));
    await waitFor(() => expect(api.reviewRollback).toHaveBeenCalledWith("reviewer-1", rollback.rollbackId,
      "reject", 1, "Active pointer moved and document changed", expect.any(AbortSignal)));
    expect(await screen.findByText(/Active policy is unchanged/)).toBeTruthy();
    view.unmount();
  });

  it("submits a revision-bound rollback request only after comparing verified versions and entering a reason", async () => {
    api.requestRollback.mockResolvedValue({ rollback });
    render(<PolicyVersionPanel userId="requester-2" demo={false} />);
    await userEvent.click(await screen.findByRole("button", { name: /BENEFIT#synthetic/ }));
    const action = await screen.findByRole("button", { name: "Request separate rollback review" }) as HTMLButtonElement;
    expect(action.disabled).toBe(true);
    await userEvent.type(screen.getByLabelText("Reason for rollback request"), "Official archived version should be restored");
    await userEvent.click(action);
    await waitFor(() => expect(api.requestRollback).toHaveBeenCalledWith("requester-2", {
      policyId, targetVersion: 2, expectedActiveVersion: 3,
      reason: "Official archived version should be restored",
    }, expect.any(AbortSignal)));
    expect(await screen.findByText(/No active rule changed/)).toBeTruthy();
  });

  it("shows a fictional read-only comparison without loading account data", async () => {
    render(<PolicyVersionPanel userId="SYNTHETIC_DEMO" demo />);
    expect(screen.getByText("Example v3")).toBeTruthy();
    expect(screen.getByText("Example v2")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Request rollback (demo only)" }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => undefined);
    expect(api.active).not.toHaveBeenCalled();
  });

  it("never shows an old rollback detail after switching queue items", async () => {
    const second = { ...rollback, rollbackId: "ROLLBACK#second", requestReason: "Another fictional request reason" };
    const late = deferred<{ rollback: typeof rollback; currentVersion: number; sourceFresh: boolean;
      targetDocumentCurrent: boolean; lastCheckedAt: string }>();
    api.rollbackQueue.mockResolvedValue({ items: [rollback, second], hasMore: false });
    api.rollbackDetail.mockImplementation((_user: string, id: string) => id === rollback.rollbackId ? late.promise :
      Promise.resolve({ rollback: second, currentVersion: 3, sourceFresh: true, targetDocumentCurrent: true, lastCheckedAt: at }));
    render(<PolicyVersionPanel userId="reviewer-1" demo={false} />);
    const choices = await screen.findAllByRole("button", { name: /POLICY#synthetic/ });
    await userEvent.click(choices[0]!);
    await userEvent.click(choices[1]!);
    expect(await screen.findByText("Another fictional request reason")).toBeTruthy();
    await act(async () => late.resolve({ rollback, currentVersion: 3, sourceFresh: true,
      targetDocumentCurrent: true, lastCheckedAt: at }));
    expect(screen.queryByText("Fictional source correction request")).toBeNull();
  });
});
