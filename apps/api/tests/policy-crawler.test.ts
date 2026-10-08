import { describe, expect, it } from "vitest";
import { OfficialFetchError, policySourceSchema, type PolicyDocumentV1, type PolicySourceV1 } from "@solarsaathi/policy";
import { PolicyCrawler } from "../src/policy/crawler";
import type { PolicyObjectStore, PolicyRepository } from "../src/policy/storage";
import type { PolicyWorkflowRepository } from "../src/policy/workflow-storage";
import type { PolicyChangeRecordV1, PolicyCrawlStateV1, PolicyReviewRecordV1, PolicyWorkflowAuditV1 } from "../src/policy/workflow-types";

const at = new Date("2026-10-08T10:00:00.000Z");
const source: PolicySourceV1 = policySourceSchema.parse({
  schemaVersion: 1, sourceId: `SRC#${"a".repeat(32)}`, registryVersion: 2,
  name: "Official source", publisherName: "MNRE", jurisdiction: "IN", sourceType: "MNRE",
  authorityTier: 1, registryStatus: "CURATED", healthStatus: "UNKNOWN",
  canonicalUrl: "https://mnre.gov.in/solar/", allowedHosts: ["mnre.gov.in"],
  crawlFrequency: "DAILY", enabled: true, freshnessWindowHours: 24,
  curatorId: "admin-curator", curatedAt: at.toISOString(),
  createdAt: at.toISOString(), updatedAt: at.toISOString(),
});
const initialState: PolicyCrawlStateV1 = { schemaVersion: 1, sourceId: source.sourceId,
  revision: 1, status: "READY", nextDueAtEpochSeconds: Math.floor(at.getTime() / 1_000), failureCount: 0 };
const html = (text: string) => Buffer.from(`<html><body><p>${text}</p></body></html>`);

class MemoryArchive implements PolicyObjectStore {
  readonly bodies = new Map<string, Uint8Array>();
  writes = 0;
  async putImmutable(key: string, body: Uint8Array) {
    if (!this.bodies.has(key)) { this.bodies.set(key, body); this.writes++; }
    return "v-1";
  }
  async getDerived(key: string) {
    const value = this.bodies.get(key);
    if (!value) throw new Error("missing derived archive");
    return value;
  }
}

function setup() {
  let currentState = { ...initialState };
  const documents = new Map<string, PolicyDocumentV1>();
  const candidates = new Map<string, PolicyReviewRecordV1>();
  const approved: PolicyReviewRecordV1[] = [];
  const changes: PolicyChangeRecordV1[] = [];
  const audits: PolicyWorkflowAuditV1[] = [];
  const records = {
    getSource: async () => source,
    putSource: async () => { throw new Error("not used by crawler"); },
    putDocument: async (document: PolicyDocumentV1) => {
      const key = `${document.documentId}:${document.version}`;
      if (documents.has(key)) throw Object.assign(new Error("duplicate"), { name: "ConditionalCheckFailedException" });
      documents.set(key, document);
    },
    getDocument: async (_sourceId: string, documentId: string, version: number) => documents.get(`${documentId}:${version}`),
  } as PolicyRepository;
  const workflow = {
    listDue: async () => [currentState],
    claimCrawl: async (_state: PolicyCrawlStateV1, _now: number, lease: number, audit: PolicyWorkflowAuditV1) => {
      currentState = { ...currentState, revision: currentState.revision + 1,
        status: "RUNNING", nextDueAtEpochSeconds: lease };
      audits.push(audit);
      return currentState;
    },
    completeCrawl: async (_previous: PolicyCrawlStateV1, next: PolicyCrawlStateV1, audit: PolicyWorkflowAuditV1) => {
      currentState = next; audits.push(audit);
    },
    latestDocument: async (_sourceId: string, documentId: string) =>
      [...documents.values()].filter(item => item.documentId === documentId).sort((a, b) => b.version - a.version)[0],
    getSourceVersion: async () => source,
    putChange: async (change: PolicyChangeRecordV1) => { changes.push(change); },
    putCandidate: async (candidate: PolicyReviewRecordV1) => { candidates.set(candidate.candidate.candidateId, candidate); },
    getCandidate: async (candidateId: string) => candidates.get(candidateId),
    findApprovedClaim: async (claimKey: string) => ({
      items: approved.filter(item => item.candidate.claimKey === claimKey), truncated: false,
    }),
  } as unknown as PolicyWorkflowRepository;
  const objects = new MemoryArchive();
  return { records, workflow, objects, documents, candidates, approved, changes, audits,
    getState: () => currentState, setState: (next: PolicyCrawlStateV1) => { currentState = next; } };
}

describe("bounded official policy crawler", () => {
  it("archives first meaningful document with unverified candidate and citation, then ignores cosmetic text", async () => {
    const memory = setup();
    let bytes = html("Central subsidy ₹100 for solar systems.");
    const fetcher = async () => ({ status: "CHANGED" as const, finalUrl: source.canonicalUrl,
      mimeType: "text/html" as const, bytes, sha256: "", redirectTrace: [], robotsCrawlDelaySeconds: 0 });
    const crawler = new PolicyCrawler(memory.records, memory.workflow, memory.objects,
      async () => ({ ...await fetcher(), sha256: await import("node:crypto").then(crypto =>
        crypto.createHash("sha256").update(bytes).digest("hex")) }), () => at);
    expect(await crawler.processSource(initialState)).toBe("CHANGED");
    expect(memory.documents.size).toBe(1);
    expect(memory.objects.writes).toBe(2);
    expect(memory.candidates.size).toBe(1);
    const review = [...memory.candidates.values()][0]!;
    expect(review).toMatchObject({ reviewStatus: "PENDING_APPROVAL", sourceCuratorId: "admin-curator",
      candidate: { verificationStatus: "UNVERIFIED", reviewStatus: "PENDING_APPROVAL",
        quotedText: expect.stringContaining("subsidy"), citation: { sourceId: source.sourceId } } });
    expect(review.conflictFlags).toContain("VERIFIED_FACT_COMPARISON_PENDING");
    expect(memory.changes[0]?.assessment.status).toBe("INITIAL_REVIEW_REQUIRED");
    expect(memory.audits[0]?.action).toBe("CRAWL_STARTED");
    expect(memory.audits[0]?.runId).toBe(memory.audits[1]?.runId);
    bytes = html("Central subsidy   ₹100 for solar systems.");
    expect(await crawler.processSource(memory.getState())).toBe("UNCHANGED");
    expect(memory.documents.size).toBe(1);
    expect(memory.objects.writes).toBe(2);
    expect(memory.getState().lastCheckedAt).toBe(at.toISOString());
  });

  it("keeps prior document and candidate when a later official fetch fails", async () => {
    const memory = setup();
    const valid = html("Central subsidy ₹100 for solar systems.");
    const digest = await import("node:crypto").then(crypto => crypto.createHash("sha256").update(valid).digest("hex"));
    const crawler = new PolicyCrawler(memory.records, memory.workflow, memory.objects,
      async () => ({ status: "CHANGED", finalUrl: source.canonicalUrl,
        mimeType: "text/html", bytes: valid, sha256: digest, redirectTrace: [], robotsCrawlDelaySeconds: 0 }), () => at);
    await crawler.processSource(initialState);
    const failing = new PolicyCrawler(memory.records, memory.workflow, memory.objects,
      async () => { throw new OfficialFetchError("ROBOTS_DISALLOWED"); }, () => at);
    await expect(failing.processSource(memory.getState())).rejects.toThrow("POLICY_CRAWL_FAILED");
    expect(memory.getState()).toMatchObject({ status: "ERROR", lastErrorCode: "ROBOTS_DISALLOWED", failureCount: 1 });
    expect(memory.documents.size).toBe(1);
    expect(memory.candidates.size).toBe(1);
    expect(memory.audits.at(-1)?.action).toBe("CRAWL_FAILED");
  });

  it("honors a 48-hour official rate limit and requires manual review when the requested delay exceeds 30 days", async () => {
    const limited = setup();
    const crawler = new PolicyCrawler(limited.records, limited.workflow, limited.objects,
      async () => { throw new OfficialFetchError("RATE_LIMITED", 429, 172_800); }, () => at);
    await expect(crawler.processSource(initialState)).rejects.toThrow("POLICY_CRAWL_FAILED");
    expect(limited.getState()).toMatchObject({ lastErrorCode: "RATE_LIMITED",
      nextDueAtEpochSeconds: initialState.nextDueAtEpochSeconds + 172_800 });
    const manual = setup();
    const longDelay = new PolicyCrawler(manual.records, manual.workflow, manual.objects,
      async () => { throw new OfficialFetchError("RATE_LIMITED", 429, 30 * 86_400, true); }, () => at);
    await expect(longDelay.processSource(initialState)).rejects.toThrow("POLICY_CRAWL_FAILED");
    expect(manual.getState()).toMatchObject({ lastErrorCode: "RATE_LIMITED_MANUAL_REVIEW",
      nextDueAtEpochSeconds: 253402300799 });
  });

  it("queues a changed official document even when extraction finds no policy snippet", async () => {
    const memory = setup();
    const neutral = html("Updated office opening hours.");
    const digest = await import("node:crypto").then(crypto => crypto.createHash("sha256").update(neutral).digest("hex"));
    const crawler = new PolicyCrawler(memory.records, memory.workflow, memory.objects,
      async () => ({ status: "CHANGED", finalUrl: source.canonicalUrl,
        mimeType: "text/html", bytes: neutral, sha256: digest, redirectTrace: [], robotsCrawlDelaySeconds: 0 }), () => at);
    expect(await crawler.processSource(initialState)).toBe("CHANGED");
    expect(memory.candidates.size).toBe(0);
    expect(memory.changes).toMatchObject([{ reviewStatus: "PENDING_APPROVAL",
      assessment: { candidateCount: 0, status: "INITIAL_REVIEW_REQUIRED" } }]);
  });

  it("recovers review records from an already archived matching document without another S3 write", async () => {
    const memory = setup();
    const bytes = html("Central subsidy ₹100 for solar systems.");
    const digest = await import("node:crypto").then(crypto => crypto.createHash("sha256").update(bytes).digest("hex"));
    const crawler = new PolicyCrawler(memory.records, memory.workflow, memory.objects,
      async () => ({ status: "CHANGED", finalUrl: source.canonicalUrl,
        mimeType: "text/html", bytes, sha256: digest, redirectTrace: [], robotsCrawlDelaySeconds: 0 }), () => at);
    await crawler.processSource(initialState);
    memory.changes.length = 0;
    memory.candidates.clear();
    memory.setState({ ...initialState });
    expect(await crawler.processSource(initialState)).toBe("CHANGED");
    expect(memory.objects.writes).toBe(2);
    expect(memory.documents.size).toBe(1);
    expect(memory.changes).toHaveLength(1);
    expect(memory.candidates.size).toBe(1);
  });

  it("flags differing approved evidence from another source as tentative, without verifying the new candidate", async () => {
    const memory = setup();
    const bytes = html("Central subsidy ₹200 for solar systems.");
    const digest = await import("node:crypto").then(crypto => crypto.createHash("sha256").update(bytes).digest("hex"));
    const earlier = html("Central subsidy ₹100 for solar systems.");
    const earlierDigest = await import("node:crypto").then(crypto => crypto.createHash("sha256").update(earlier).digest("hex"));
    const earlierCrawler = new PolicyCrawler(memory.records, memory.workflow, memory.objects,
      async () => ({ status: "CHANGED", finalUrl: source.canonicalUrl,
        mimeType: "text/html", bytes: earlier, sha256: earlierDigest, redirectTrace: [], robotsCrawlDelaySeconds: 0 }), () => at);
    await earlierCrawler.processSource(initialState);
    const original = [...memory.candidates.values()][0]!;
    memory.approved.push({ ...original, reviewStatus: "APPROVED", revision: 2,
      candidate: { ...original.candidate, candidateId: `CAND#${"f".repeat(32)}`,
        sourceId: `SRC#${"b".repeat(32)}` } });
    const crawler = new PolicyCrawler(memory.records, memory.workflow, memory.objects,
      async () => ({ status: "CHANGED", finalUrl: source.canonicalUrl,
        mimeType: "text/html", bytes, sha256: digest, redirectTrace: [], robotsCrawlDelaySeconds: 0 }), () => at);
    await crawler.processSource(memory.getState());
    const latest = [...memory.candidates.values()].find(item => item.candidate.documentVersion === 2)!;
    expect(latest.conflictFlags).toContain("POTENTIAL_CROSS_SOURCE_CONFLICT");
    expect(latest.conflictFlags).toContain("VERIFIED_FACT_COMPARISON_PENDING");
    expect(latest.candidate.verificationStatus).toBe("UNVERIFIED");
  });

  it("archives a changed same-host redirect target even when its body is identical", async () => {
    const memory = setup();
    const bytes = html("Central subsidy ₹100 for solar systems.");
    const digest = await import("node:crypto").then(crypto => crypto.createHash("sha256").update(bytes).digest("hex"));
    let finalUrl = source.canonicalUrl;
    const crawler = new PolicyCrawler(memory.records, memory.workflow, memory.objects,
      async () => ({ status: "CHANGED", finalUrl, mimeType: "text/html", bytes, sha256: digest,
        redirectTrace: [], robotsCrawlDelaySeconds: 0 }), () => at);
    await crawler.processSource(initialState);
    finalUrl = "https://mnre.gov.in/new-circular/";
    expect(await crawler.processSource(memory.getState())).toBe("CHANGED");
    expect(new Set([...memory.documents.values()].map(item => item.documentId)).size).toBe(2);
    expect(memory.changes).toHaveLength(2);
  });

  it("refetches a moved 304 response without validators before accepting its new document identity", async () => {
    const memory = setup();
    const bytes = html("Central subsidy ₹100 for solar systems.");
    const digest = await import("node:crypto").then(crypto => crypto.createHash("sha256").update(bytes).digest("hex"));
    let first = true;
    const requests: Array<{ etag?: string }> = [];
    const crawler = new PolicyCrawler(memory.records, memory.workflow, memory.objects,
      async input => {
        requests.push(input);
        if (first) { first = false; return { status: "CHANGED", finalUrl: source.canonicalUrl,
          mimeType: "text/html", bytes, sha256: digest, etag: "v1", redirectTrace: [], robotsCrawlDelaySeconds: 0 }; }
        if (input.etag) return { status: "NOT_MODIFIED", finalUrl: "https://mnre.gov.in/new-circular/",
          redirectTrace: [], robotsCrawlDelaySeconds: 0 };
        return { status: "CHANGED", finalUrl: "https://mnre.gov.in/new-circular/", mimeType: "text/html",
          bytes, sha256: digest, redirectTrace: [], robotsCrawlDelaySeconds: 0 };
      }, () => at);
    await crawler.processSource(initialState);
    expect(await crawler.processSource(memory.getState())).toBe("CHANGED");
    expect(requests).toHaveLength(3);
    expect(requests[1]?.etag).toBe("v1");
    expect(requests[2]?.etag).toBeUndefined();
    expect(memory.documents.size).toBe(2);
  });
});
