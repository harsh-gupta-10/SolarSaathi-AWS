import { createHash } from "node:crypto";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { GetCommand, QueryCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { describe, expect, it, vi } from "vitest";
import { policySourceSchema, type PolicyDocumentV1, type PolicySourceV1 } from "@solarsaathi/policy";
import { PolicyWorkflowService } from "../src/policy/workflow-service";
import type { PolicyRepository } from "../src/policy/storage";
import { DynamoPolicyWorkflowRepository, type PolicyWorkflowRepository } from "../src/policy/workflow-storage";
import type { PolicyChangeRecordV1, PolicyCrawlStateV1, PolicyReviewRecordV1, PolicyWorkflowAuditV1 } from "../src/policy/workflow-types";

const at = new Date("2026-10-08T10:00:00.000Z");
const curator = "11111111-1111-4111-8111-111111111111";
const reviewer = "22222222-2222-4222-8222-222222222222";
const source: PolicySourceV1 = policySourceSchema.parse({ schemaVersion: 1,
  sourceId: `SRC#${"a".repeat(32)}`, registryVersion: 1,
  name: "Official source", publisherName: "MNRE", jurisdiction: "IN", sourceType: "MNRE",
  authorityTier: 1, registryStatus: "PROPOSED", healthStatus: "UNKNOWN",
  canonicalUrl: "https://mnre.gov.in/solar/", allowedHosts: ["mnre.gov.in"],
  crawlFrequency: "DAILY", enabled: false, freshnessWindowHours: 24,
  createdAt: at.toISOString(), updatedAt: at.toISOString(),
});

function setup(derived?: { getDerived(key: string, versionId: string): Promise<Uint8Array> }) {
  let currentSource = source;
  let state: PolicyCrawlStateV1 | undefined;
  let candidate: PolicyReviewRecordV1 | undefined;
  let change: PolicyChangeRecordV1 | undefined;
  const documents = new Map<number, PolicyDocumentV1>();
  const audits: PolicyWorkflowAuditV1[] = [];
  const records = {
    getSource: async () => currentSource,
    putSource: async () => { throw new Error("not used"); },
    getDocument: async (_sourceId: string, _documentId: string, version: number) => documents.get(version),
    putDocument: async () => { throw new Error("not used"); },
  } as PolicyRepository;
  const workflow = {
    curateSource: async (_previous: PolicySourceV1, next: PolicySourceV1, nextState: PolicyCrawlStateV1,
      audit: PolicyWorkflowAuditV1) => { currentSource = next; state = nextState; audits.push(audit); },
    getCrawlState: async () => state,
    requestCrawl: async (_previous: PolicyCrawlStateV1, next: PolicyCrawlStateV1, audit: PolicyWorkflowAuditV1) => {
      state = next; audits.push(audit);
    },
    getCandidate: async () => candidate,
    getChange: async () => change,
    reviewCandidate: async (_previous: PolicyReviewRecordV1, next: PolicyReviewRecordV1,
      audit: PolicyWorkflowAuditV1) => { candidate = next; audits.push(audit); },
    reviewChange: async (_previous: PolicyChangeRecordV1, next: PolicyChangeRecordV1,
      audit: PolicyWorkflowAuditV1) => { change = next; audits.push(audit); },
    listQueue: async () => ({ items: candidate ? [candidate] : [], changes: change ? [change] : [] }),
    listCandidateAudit: async () => audits.filter(value => value.candidateId),
    listChangeAudit: async () => audits.filter(value => value.changeId),
    listSources: async () => [currentSource],
  } as unknown as PolicyWorkflowRepository;
  return { service: new PolicyWorkflowService(records, workflow, () => at, derived),
    setCandidate: (value: PolicyReviewRecordV1) => { candidate = value; },
    setChange: (value: PolicyChangeRecordV1) => { change = value; },
    setDocument: (value: PolicyDocumentV1) => { documents.set(value.version, value); },
    getChange: () => change,
    getCandidate: () => candidate, getSource: () => currentSource, getState: () => state,
    setState: (value: PolicyCrawlStateV1) => { state = value; }, audits };
}

describe("policy curation and separate evidence review", () => {
  it("creates an enabled curated source version and due crawler state without changing history", async () => {
    const test = setup();
    const response = await test.service.curateSource({ sourceId: source.sourceId, expectedRegistryVersion: 1 }, curator, "req");
    expect(response).toMatchObject({ createdVersion: 2, source: { registryStatus: "CURATED",
      enabled: true, curatorId: curator, registryVersion: 2 } });
    expect(test.getState()).toMatchObject({ status: "READY", revision: 1,
      nextDueAtEpochSeconds: Math.floor(at.getTime() / 1_000) });
    expect(await test.service.listSources("req")).toMatchObject({
      sources: [{ registryVersion: 2 }],
      sourceStates: [{ sourceId: source.sourceId, crawlState: { status: "READY" }, sourceFresh: false }],
    });
    expect(test.audits[0]?.action).toBe("SOURCE_CURATED");
    await expect(test.service.curateSource({ sourceId: source.sourceId, expectedRegistryVersion: 1 }, curator, "req"))
      .rejects.toMatchObject({ statusCode: 409 });
  });

  it("blocks source curator self-review and conditionally approves only unverified evidence", async () => {
    const test = setup();
    await test.service.curateSource({ sourceId: source.sourceId, expectedRegistryVersion: 1 }, curator, "req");
    const id = `CAND#${"b".repeat(32)}`;
    test.setCandidate({ schemaVersion: 1, revision: 1, reviewStatus: "PENDING_APPROVAL",
      detectedAt: at.toISOString(), detectedBy: "SYSTEM_CRAWLER", sourceCuratorId: curator,
      changeStatus: "INITIAL_REVIEW_REQUIRED", conflictFlags: [],
      candidate: { schemaVersion: 1, candidateId: id, sourceId: source.sourceId,
        documentId: `DOC#${"c".repeat(32)}`, documentVersion: 1, chunkId: "CHUNK#0000#0123456789abcdef",
        claimKey: `claim.${"d".repeat(32)}`, jurisdiction: "IN", categoryHint: "OTHER",
        quotedText: "Synthetic test subsidy", citation: {} as PolicyReviewRecordV1["candidate"]["citation"],
        amountMentions: [], dateMentions: [], capacityMentions: [],
        verificationStatus: "UNVERIFIED", reviewStatus: "PENDING_APPROVAL", extractedAt: at.toISOString() } });
    await expect(test.service.review(id, "APPROVED", { expectedRevision: 1 }, curator, "req"))
      .rejects.toMatchObject({ statusCode: 403, code: "SEPARATE_REVIEWER_REQUIRED" });
    const approved = await test.service.review(id, "APPROVED", { expectedRevision: 1, reason: "Evidence checked" }, reviewer, "req");
    expect(approved.candidate).toMatchObject({ revision: 2, reviewStatus: "APPROVED", reviewedBy: reviewer,
      candidate: { verificationStatus: "UNVERIFIED" } });
    expect(test.audits.at(-1)?.action).toBe("EVIDENCE_APPROVED");
    await expect(test.service.review(id, "REJECTED", { expectedRevision: 1 }, reviewer, "req"))
      .rejects.toMatchObject({ statusCode: 409 });
  });

  it("shows document-level changes with zero snippets and requires a separate change reviewer", async () => {
    const test = setup();
    await test.service.curateSource({ sourceId: source.sourceId, expectedRegistryVersion: 1 }, curator, "req");
    const id = `CHANGE#${"e".repeat(32)}`;
    test.setChange({ schemaVersion: 1, changeId: id, sourceId: source.sourceId,
      documentId: `DOC#${"c".repeat(32)}`, documentVersion: 1,
      detectedAt: at.toISOString(), runId: "run", detectedBy: "SYSTEM_CRAWLER",
      sourceCuratorId: curator, reviewStatus: "PENDING_APPROVAL", revision: 1,
      assessment: { schemaVersion: 1, sourceId: source.sourceId,
        documentId: `DOC#${"c".repeat(32)}`, documentVersion: 1,
        currentRawSha256: "a".repeat(64), currentNormalizedTextSha256: "b".repeat(64),
        status: "INITIAL_REVIEW_REQUIRED", reviewStatus: "PENDING_APPROVAL",
        candidateCount: 0, materialChanges: [] } });
    const queue = await test.service.queue(undefined, undefined, "req");
    expect(queue.items).toHaveLength(0);
    expect(queue.changes).toMatchObject([{ changeId: id, assessment: { candidateCount: 0 } }]);
    await expect(test.service.reviewChange(id, "APPROVED", { expectedRevision: 1 }, curator, "req"))
      .rejects.toMatchObject({ statusCode: 403 });
    const approved = await test.service.reviewChange(id, "APPROVED", { expectedRevision: 1 }, reviewer, "req");
    expect(approved.change).toMatchObject({ reviewStatus: "APPROVED", revision: 2, reviewedBy: reviewer });
    expect(test.audits.at(-1)).toMatchObject({ action: "CHANGE_APPROVED", changeId: id });
    await expect(test.service.reviewChange(id, "REJECTED", { expectedRevision: 1 }, reviewer, "req"))
      .rejects.toMatchObject({ statusCode: 409 });
  });

  it("atomically writes immutable source, crawl and audit records under one version condition", async () => {
    const send = vi.fn().mockResolvedValue({});
    const repository = new DynamoPolicyWorkflowRepository("test-policy", "ap-south-1",
      { send } as unknown as DynamoDBDocumentClient);
    const next = policySourceSchema.parse({ ...source, registryVersion: 2, registryStatus: "CURATED",
      enabled: true, curatorId: curator, curatedAt: at.toISOString() });
    const state: PolicyCrawlStateV1 = { schemaVersion: 1, sourceId: source.sourceId,
      revision: 1, status: "READY", nextDueAtEpochSeconds: Math.floor(at.getTime() / 1_000), failureCount: 0 };
    const audit: PolicyWorkflowAuditV1 = { schemaVersion: 1,
      eventId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", actorId: curator,
      action: "SOURCE_CURATED", occurredAt: at.toISOString(), sourceId: source.sourceId };
    await repository.curateSource(source, next, state, audit);
    const command = send.mock.calls[0]?.[0];
    expect(command).toBeInstanceOf(TransactWriteCommand);
    expect(command.input.TransactItems).toHaveLength(4);
    const puts = command.input.TransactItems.map((entry: { Put?: { Item?: { SK: string }; ConditionExpression?: string } }) => entry.Put);
    expect(puts.map((entry: { Item?: { SK: string } }) => entry.Item?.SK)).toEqual([
      "CURRENT", "VERSION#00000002", "CRAWL_STATE", expect.stringMatching(/^AUDIT#/),
    ]);
    expect(puts[0]?.ConditionExpression).toContain("#value.#registryVersion = :previousVersion");
    expect(puts.slice(1).every((entry: { ConditionExpression?: string }) =>
      entry.ConditionExpression === "attribute_not_exists(PK) AND attribute_not_exists(SK)")).toBe(true);
  });

  it("prevents early recrawl of a rate-limited host and audits explicit long-delay clearance", async () => {
    const test = setup();
    await test.service.curateSource({ sourceId: source.sourceId, expectedRegistryVersion: 1 }, curator, "req");
    const current = test.getState()!;
    test.setState({ ...current, status: "ERROR", lastErrorCode: "RATE_LIMITED",
      nextDueAtEpochSeconds: current.nextDueAtEpochSeconds + 172_800 });
    await expect(test.service.requestCrawl({ sourceId: source.sourceId }, reviewer, "req"))
      .rejects.toMatchObject({ statusCode: 429, code: "SOURCE_RATE_LIMITED" });
    test.setState({ ...current, status: "ERROR", lastErrorCode: "RATE_LIMITED_MANUAL_REVIEW",
      nextDueAtEpochSeconds: 253402300799 });
    await expect(test.service.requestCrawl({ sourceId: source.sourceId }, reviewer, "req"))
      .rejects.toMatchObject({ statusCode: 429, code: "RATE_LIMIT_CLEARANCE_REQUIRED" });
    expect(await test.service.requestCrawl({ sourceId: source.sourceId,
      rateLimitClearanceReason: "Official source cleared the delay." }, reviewer, "req"))
      .toMatchObject({ queued: true });
    expect(test.getState()).toMatchObject({ status: "READY", nextDueAtEpochSeconds: current.nextDueAtEpochSeconds });
    expect(test.audits.at(-1)).toMatchObject({ action: "CRAWL_QUEUED",
      detailCode: "RATE_LIMIT_CLEARANCE: Official source cleared the delay." });
  });

  it("atomically records crawl start and indexes only approved evidence for bounded comparison", async () => {
    const claimKey = `claim.${"d".repeat(32)}`;
    const candidateId = `CAND#${"b".repeat(32)}`;
    const approved = { schemaVersion: 1, revision: 2, reviewStatus: "APPROVED",
      reviewedAt: at.toISOString(), candidate: { candidateId, claimKey } } as PolicyReviewRecordV1;
    const send = vi.fn().mockImplementation(async command => {
      if (command instanceof QueryCommand) return { Items: [{ entityType: "POLICY_CANDIDATE", value: approved }] };
      if (command instanceof GetCommand) return { Item: { value: approved } };
      return {};
    });
    const repository = new DynamoPolicyWorkflowRepository("test-policy", "ap-south-1",
      { send } as unknown as DynamoDBDocumentClient);
    const state: PolicyCrawlStateV1 = { schemaVersion: 1, sourceId: source.sourceId,
      revision: 1, status: "READY", nextDueAtEpochSeconds: Math.floor(at.getTime() / 1_000), failureCount: 0 };
    const started: PolicyWorkflowAuditV1 = { schemaVersion: 1, eventId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      actorId: "SYSTEM_CRAWLER", action: "CRAWL_STARTED", occurredAt: at.toISOString(), sourceId: source.sourceId };
    await repository.claimCrawl(state, state.nextDueAtEpochSeconds, state.nextDueAtEpochSeconds + 300, started);
    const startCommand = send.mock.calls[0]?.[0];
    expect(startCommand).toBeInstanceOf(TransactWriteCommand);
    expect(startCommand.input.TransactItems).toHaveLength(2);
    expect(startCommand.input.TransactItems[1]?.Put?.Item).toMatchObject({ entityType: "POLICY_AUDIT",
      value: { action: "CRAWL_STARTED" } });
    send.mockClear();
    const pending = { ...approved, revision: 1, reviewStatus: "PENDING_APPROVAL" } as PolicyReviewRecordV1;
    await repository.reviewCandidate(pending, approved, started);
    expect(send.mock.calls[0]?.[0].input.TransactItems[0]?.Put?.Item).toMatchObject({
      GSI3PK: `POLICY_APPROVED_CLAIM#${claimKey}`,
      GSI3SK: `${at.toISOString()}#${candidateId}`,
    });
    send.mockClear();
    const matching = await repository.findApprovedClaim(claimKey, 20);
    expect(matching).toMatchObject({ items: [approved], truncated: false });
    expect(send.mock.calls[0]?.[0].input).toMatchObject({ IndexName: "GSI3", Limit: 20 });
  });

  it("serves only a hash-verified plain-text preview for document-change review", async () => {
    const normalizedText = "Synthetic policy document text for review.";
    const normalizedTextSha256 = createHash("sha256").update(normalizedText).digest("hex");
    const test = setup({ getDerived: async () => Buffer.from(JSON.stringify({
      sourceId: source.sourceId, documentId: `DOC#${"c".repeat(32)}`, documentVersion: 1,
      rawSha256: "a".repeat(64), normalizedTextSha256, normalizedText,
    })) });
    await test.service.curateSource({ sourceId: source.sourceId, expectedRegistryVersion: 1 }, curator, "req");
    const id = `CHANGE#${"e".repeat(32)}`;
    const documentId = `DOC#${"c".repeat(32)}`;
    test.setDocument({ schemaVersion: 1, sourceId: source.sourceId, sourceRegistryVersion: 2,
      documentId, version: 1, title: "Example", documentType: "OFFICIAL_WEBPAGE",
      mimeType: "text/html", canonicalUrl: source.canonicalUrl, sha256: "a".repeat(64),
      normalizedTextSha256, retrievedAt: at.toISOString(), derivedS3Key: "derived/key.json",
      derivedS3VersionId: "v-1" });
    test.setChange({ schemaVersion: 1, changeId: id, sourceId: source.sourceId,
      documentId, documentVersion: 1, detectedAt: at.toISOString(), runId: "run",
      detectedBy: "SYSTEM_CRAWLER", sourceCuratorId: curator, reviewStatus: "PENDING_APPROVAL", revision: 1,
      assessment: { schemaVersion: 1, sourceId: source.sourceId, documentId, documentVersion: 1,
        currentRawSha256: "a".repeat(64), currentNormalizedTextSha256: normalizedTextSha256,
        status: "INITIAL_REVIEW_REQUIRED", reviewStatus: "PENDING_APPROVAL", candidateCount: 0, materialChanges: [] } });
    const detail = await test.service.change(id, "req");
    expect(detail).toMatchObject({ textPreview: normalizedText, textTruncated: false,
      change: { changeId: id }, document: { normalizedTextSha256 } });
  });

  it("returns bounded pinned before-and-after text for a versioned document change", async () => {
    const documentId = `DOC#${"c".repeat(32)}`;
    const id = `CHANGE#${"e".repeat(32)}`;
    const text = ["Previous official notice.", "Updated official notice with a changed subsidy."];
    const hashes = text.map(value => createHash("sha256").update(value).digest("hex"));
    const test = setup({ getDerived: async key => {
      const version = key.includes("/v1/") ? 1 : 2;
      return Buffer.from(JSON.stringify({ sourceId: source.sourceId, documentId,
        documentVersion: version, rawSha256: "a".repeat(64),
        normalizedTextSha256: hashes[version - 1], normalizedText: text[version - 1] }));
    } });
    await test.service.curateSource({ sourceId: source.sourceId, expectedRegistryVersion: 1 }, curator, "req");
    for (const version of [1, 2]) test.setDocument({ schemaVersion: 1, sourceId: source.sourceId,
      sourceRegistryVersion: 2, documentId, version, title: "Example",
      documentType: "OFFICIAL_WEBPAGE", mimeType: "text/html", canonicalUrl: source.canonicalUrl,
      sha256: "a".repeat(64), normalizedTextSha256: hashes[version - 1], retrievedAt: at.toISOString(),
      derivedS3Key: `derived/v${version}/record.json`, derivedS3VersionId: `v-${version}` });
    test.setChange({ schemaVersion: 1, changeId: id, sourceId: source.sourceId,
      documentId, documentVersion: 2, detectedAt: at.toISOString(), runId: "run",
      detectedBy: "SYSTEM_CRAWLER", sourceCuratorId: curator, reviewStatus: "PENDING_APPROVAL", revision: 1,
      assessment: { schemaVersion: 1, sourceId: source.sourceId, documentId, documentVersion: 2,
        previousRawSha256: "a".repeat(64), previousNormalizedTextSha256: hashes[0]!,
        currentRawSha256: "a".repeat(64), currentNormalizedTextSha256: hashes[1]!,
        status: "TEXT_REVIEW_REQUIRED", reviewStatus: "PENDING_APPROVAL", candidateCount: 0, materialChanges: [] } });
    expect(await test.service.change(id, "req")).toMatchObject({
      previousTextPreview: text[0], previousTextTruncated: false,
      textPreview: text[1], textTruncated: false,
    });
  });
});
