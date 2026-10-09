import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { policyOperationsApi } from "../src/lib/policy-operations-api";

const session = vi.hoisted(() => vi.fn());
vi.mock("../src/lib/env", () => ({ getPublicEnvironment: () => ({ NEXT_PUBLIC_API_BASE_URL: "https://api.example.com/v1" }) }));
vi.mock("aws-amplify/auth", () => ({ fetchAuthSession: session }));
const at = "2026-10-09T10:00:00.000Z";
const rollback = { schemaVersion: 1, rollbackId: "ROLLBACK#synthetic", policyId: "POLICY#synthetic",
  targetVersion: 2, expectedActiveVersion: 3, status: "PENDING_APPROVAL", revision: 1,
  requestedAt: at, requestedBy: "proposer-1", requestReason: "Verified historical correction",
  targetSourceId: "SRC#synthetic", targetSourceCuratorId: "curator-1", targetVersionAuthorId: "author-1" };
beforeEach(() => session.mockResolvedValue({ tokens: { accessToken: { payload: {
  sub: "admin-1", token_use: "access", "cognito:groups": ["ADMIN_POLICY"],
}, toString: () => "test-access-token" } } }));
afterEach(() => { vi.unstubAllGlobals(); session.mockReset(); });
function response(payload: unknown) { return { ok: true, status: 200, json: async () => payload }; }

describe("policy operations API client", () => {
  it("uses scoped cursor routes for runs and rejects a mismatched active jurisdiction", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response({ schemaVersion: 1, runs: [{ schemaVersion: 1,
      runId: "run-1", startedAt: at, finishedAt: at, status: "PARTIAL", checked: 1, changed: 0,
      failed: 1, skipped: 0, backlog: false, sourceOutcomes: [{ sourceId: "SRC#one", outcome: "FAILED" }] }],
      nextCursor: "opaque-next", requestId: "request-1" }))
      .mockResolvedValueOnce(response({ schemaVersion: 1, jurisdiction: "IN", items: [], hasMore: false,
        requestId: "request-2" }));
    vi.stubGlobal("fetch", fetcher);
    await expect(policyOperationsApi.runs("admin-1", undefined, "opaque-cursor"))
      .resolves.toMatchObject({ runs: [{ runId: "run-1" }], nextCursor: "opaque-next" });
    expect(fetcher.mock.calls[0]?.[0]).toContain("/admin/policy/crawler-runs?limit=20&cursor=opaque-cursor");
    await expect(policyOperationsApi.active("admin-1", "IN-MH")).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    expect(fetcher.mock.calls[1]?.[0]).toContain("jurisdiction=IN-MH");
  });

  it("sends revision and audit reason to the reviewed rollback route", async () => {
    const fetcher = vi.fn().mockResolvedValue(response({ schemaVersion: 1,
      rollback: { ...rollback, status: "REJECTED", revision: 2, reviewedAt: at, reviewedBy: "admin-1",
        reviewReason: "Source document changed after request" }, requestId: "request-1" }));
    vi.stubGlobal("fetch", fetcher);
    await expect(policyOperationsApi.reviewRollback("admin-1", rollback.rollbackId, "reject", 1,
      "Source document changed after request")).resolves.toMatchObject({ rollback: { status: "REJECTED" } });
    expect(fetcher.mock.calls[0]?.[0]).toContain(`/admin/policy/benefits/rollbacks/${encodeURIComponent(rollback.rollbackId)}/reject`);
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ method: "POST",
      body: JSON.stringify({ expectedRevision: 1, reason: "Source document changed after request" }) });
  });
});
