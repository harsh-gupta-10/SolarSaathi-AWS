import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { policyReviewApi } from "../src/lib/policy-review-api";

const mocks = vi.hoisted(() => ({ session: vi.fn() }));
vi.mock("../src/lib/env", () => ({ getPublicEnvironment: () => ({ NEXT_PUBLIC_API_BASE_URL: "https://api.example.com/v1" }) }));
vi.mock("aws-amplify/auth", () => ({ fetchAuthSession: mocks.session }));

const at = "2026-10-08T10:30:00.000Z";
const id = `CAND#${"1".repeat(32)}`;
const sha = "a".repeat(64);
const source = {
  schemaVersion: 1, sourceId: "SRC#official", registryVersion: 2, name: "Illustrative official source",
  publisherName: "Illustrative office", jurisdiction: "IN-XX", sourceType: "STATE_ENERGY_DEPARTMENT",
  canonicalUrl: "https://example.invalid/source", authorityTier: 1, registryStatus: "CURATED",
  healthStatus: "HEALTHY", crawlFrequency: "DAILY", enabled: true, freshnessWindowHours: 48,
};
const candidate = {
  schemaVersion: 1, candidateId: id, sourceId: source.sourceId, documentId: "DOC#1", documentVersion: 1,
  chunkId: "CHUNK#1", claimKey: "claim.1", jurisdiction: "IN-XX", categoryHint: "PROCEDURE",
  quotedText: "An illustrative document phrase.",
  citation: { sourceId: source.sourceId, sourceRegistryVersion: 2, documentId: "DOC#1", documentVersion: 1,
    documentSha256: sha, publisherName: source.publisherName, documentTitle: "Illustrative note",
    sourceUrl: "https://example.invalid/source", retrievedAt: at, locator: { section: "Example" } },
  amountMentions: [], dateMentions: [], capacityMentions: [], verificationStatus: "UNVERIFIED",
  reviewStatus: "PENDING_APPROVAL", extractedAt: at,
};
const record = { schemaVersion: 1, candidate, reviewStatus: "PENDING_APPROVAL", revision: 1,
  detectedAt: at, detectedBy: "SYSTEM_CRAWLER", sourceCuratorId: "curator-1",
  changeStatus: "INITIAL_REVIEW_REQUIRED", conflictFlags: [] };
const detail = { schemaVersion: 1, candidate: record, source,
  document: { schemaVersion: 1, documentId: "DOC#1", version: 1, title: "Illustrative note",
    canonicalUrl: "https://example.invalid/source", sha256: sha, retrievedAt: at },
  sourceFresh: true, sourceHealthStatus: "HEALTHY", sourceWarnings: [], audit: [], requestId: "request-1" };

beforeEach(() => {
  mocks.session.mockReset();
  mocks.session.mockResolvedValue({ tokens: { accessToken: { payload: {
    sub: "admin-1", token_use: "access", "cognito:groups": ["ADMIN_POLICY"],
  }, toString: () => "secret-access-token" } } });
});
afterEach(() => vi.unstubAllGlobals());

describe("policy review API client", () => {
  it("blocks non-admin and another account before sending a request", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    await expect(policyReviewApi.queue("another-user")).rejects.toMatchObject({ code: "POLICY_ADMIN_REQUIRED" });
    mocks.session.mockResolvedValueOnce({ tokens: { accessToken: { payload: {
      sub: "admin-1", token_use: "access", "cognito:groups": "ADMIN_POLICY",
    } } } });
    await expect(policyReviewApi.queue("admin-1")).rejects.toMatchObject({ code: "POLICY_ADMIN_REQUIRED" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("uses the access token and sends a revision-bound review reason", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, status: 200,
      json: async () => ({ schemaVersion: 1, candidate: { ...record, reviewStatus: "APPROVED", revision: 2 }, requestId: "request-1" }) });
    vi.stubGlobal("fetch", fetcher);
    await expect(policyReviewApi.review("admin-1", id, "approve", 1, "Checked official source"))
      .resolves.toMatchObject({ candidate: { reviewStatus: "APPROVED" } });
    expect(fetcher).toHaveBeenCalledWith(`https://api.example.com/v1/admin/policy/candidates/${encodeURIComponent(id)}/approve`,
      expect.objectContaining({ method: "POST", credentials: "omit", cache: "no-store", redirect: "error",
        body: JSON.stringify({ expectedRevision: 1, reason: "Checked official source" }),
        headers: expect.objectContaining({ authorization: "Bearer secret-access-token" }) }));
  });

  it("rejects mismatched evidence provenance before displaying it", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200,
      json: async () => ({ ...detail, document: { ...detail.document, sha256: "b".repeat(64) } }) }));
    await expect(policyReviewApi.detail("admin-1", id)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("rejects non-HTTPS and cross-host official links", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, status: 200,
      json: async () => ({ ...detail, document: { ...detail.document, canonicalUrl: "javascript:alert(1)" } }) });
    vi.stubGlobal("fetch", fetcher);
    await expect(policyReviewApi.detail("admin-1", id)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    fetcher.mockResolvedValueOnce({ ok: true, status: 200,
      json: async () => ({ ...detail, document: { ...detail.document, canonicalUrl: "https://elsewhere.invalid/source" },
        candidate: { ...record, candidate: { ...candidate,
          citation: { ...candidate.citation, sourceUrl: "https://elsewhere.invalid/source" } } } }) });
    await expect(policyReviewApi.detail("admin-1", id)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("uses a bounded queue cursor and rejects malformed service data", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, status: 200,
      json: async () => ({ schemaVersion: 1, items: [record], changes: [], nextCursor: "opaque_cursor", requestId: "request-1" }) });
    vi.stubGlobal("fetch", fetcher);
    await expect(policyReviewApi.queue("admin-1", undefined, "opaque_cursor")).resolves.toMatchObject({ items: [record] });
    expect(fetcher.mock.calls[0]?.[0]).toContain("cursor=opaque_cursor");
    fetcher.mockResolvedValueOnce({ ok: true, status: 200,
      json: async () => ({ schemaVersion: 1, items: [{ ...record, candidate: { ...candidate, verificationStatus: "VERIFIED" } }], changes: [], requestId: "request-1" }) });
    await expect(policyReviewApi.queue("admin-1")).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("sends an explicit reason only for reviewed rate-limit clearance", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, status: 202,
      json: async () => ({ schemaVersion: 1, queued: true, dueAt: at, requestId: "request-1" }) });
    vi.stubGlobal("fetch", fetcher);
    await expect(policyReviewApi.crawl("admin-1", source.sourceId, "Official host approved retry"))
      .resolves.toMatchObject({ queued: true });
    expect(fetcher.mock.calls[0]?.[1]?.body).toBe(JSON.stringify({ sourceId: source.sourceId,
      rateLimitClearanceReason: "Official host approved retry" }));
    await policyReviewApi.crawl("admin-1", source.sourceId);
    expect(fetcher.mock.calls[1]?.[1]?.body).toBe(JSON.stringify({ sourceId: source.sourceId }));
  });

  it("parses paged source health and the server-reviewed registration host list", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, status: 200,
      json: async () => ({ schemaVersion: 1, sources: [source], sourceStates: [{ sourceId: source.sourceId,
        sourceFresh: false, healthStatus: "STALE", warnings: ["SOURCE_CHECK_OVERDUE"] }],
      hostRegistryVersion: 1, registerableHosts: [{ host: "official.example.gov",
        sourceType: "STATE_ENERGY_DEPARTMENT", jurisdiction: "IN-MH" }],
      nextCursor: "next-page", requestId: "request-1" }) });
    vi.stubGlobal("fetch", fetcher);
    await expect(policyReviewApi.sources("admin-1", undefined, "opaque-source"))
      .resolves.toMatchObject({ sourceStates: [{ healthStatus: "STALE" }], nextCursor: "next-page" });
    expect(fetcher.mock.calls[0]?.[0]).toContain("cursor=opaque-source");
  });
});
