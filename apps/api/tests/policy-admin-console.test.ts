import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { OFFICIAL_POLICY_HOSTS_V1, policySourceSchema, type PolicySourceV1 } from "@solarsaathi/policy";
import { describe, expect, it, vi } from "vitest";
import { PolicyCrawler } from "../src/policy/crawler";
import type { PolicyRepository } from "../src/policy/storage";
import { PolicyWorkflowService } from "../src/policy/workflow-service";
import { DynamoPolicyWorkflowRepository, type PolicyWorkflowRepository } from "../src/policy/workflow-storage";
import type { PolicyCrawlerRunV1, PolicyCrawlStateV1, PolicyReviewRecordV1 } from "../src/policy/workflow-types";

const now = new Date("2026-10-10T10:00:00.000Z");
const id = `SRC#${"a".repeat(32)}`;
const source: PolicySourceV1 = policySourceSchema.parse({ schemaVersion: 1, sourceId: id,
  registryVersion: 2, name: "Official source", publisherName: "MNRE", jurisdiction: "IN", sourceType: "MNRE",
  authorityTier: 1, registryStatus: "CURATED", healthStatus: "UNKNOWN", canonicalUrl: "https://mnre.gov.in/solar/",
  allowedHosts: ["mnre.gov.in"], crawlFrequency: "DAILY", enabled: true, freshnessWindowHours: 24,
  curatorId: "curator", curatedAt: now.toISOString(), createdAt: now.toISOString(), updatedAt: now.toISOString() });
const oldState: PolicyCrawlStateV1 = { schemaVersion: 1, sourceId: id, revision: 3, status: "ERROR",
  nextDueAtEpochSeconds: Math.floor(now.getTime() / 1_000), failureCount: 2,
  lastCheckedAt: "2026-10-08T10:00:00.000Z", lastErrorCode: "ROBOTS_UNAVAILABLE" };
const sourceCursor = { PK: `SOURCE#${id}`, SK: "CURRENT", GSI4PK: "POLICY_SOURCES",
  GSI4SK: `${now.toISOString()}#${id}` };
const run: PolicyCrawlerRunV1 = { schemaVersion: 1, runId: "11111111-1111-4111-8111-111111111111",
  startedAt: now.toISOString(), finishedAt: now.toISOString(), status: "PARTIAL",
  checked: 1, changed: 1, failed: 1, skipped: 0, backlog: false,
  sourceOutcomes: [{ sourceId: id, outcome: "CHANGED" }, { sourceId: id, outcome: "FAILED" }] };
const runCursor = { PK: "POLICY_CRAWLER_RUNS", SK: `RUN#${run.startedAt}#${run.runId}` };
const records = { getSource: async () => source } as unknown as PolicyRepository;

function consoleService(overrides: Partial<PolicyWorkflowRepository> = {}) {
  const workflow = {
    listSources: async () => ({ items: [source], cursor: sourceCursor }),
    getCrawlState: async () => oldState,
    listRuns: async () => ({ items: [run], cursor: runCursor }),
    listQueue: async () => ({ items: [], changes: [] }),
    getCandidate: async () => undefined,
    ...overrides,
  } as unknown as PolicyWorkflowRepository;
  return new PolicyWorkflowService(records, workflow, () => now);
}

describe("admin policy source health and run listing", () => {
  it("paginates source records and warns on both failed and stale checks", async () => {
    const listSources = vi.fn().mockResolvedValue({ items: [source], cursor: sourceCursor });
    const service = consoleService({ listSources });
    const first = await service.listSources("req-1", "1");
    expect(first).toMatchObject({ sources: [source], sourceStates: [{ sourceId: id, sourceFresh: false,
      healthStatus: "ERROR", warnings: ["SOURCE_CHECK_STALE", "SOURCE_LAST_ERROR", "SOURCE_CRAWL_ERROR"] }],
    nextCursor: expect.any(String) });
    expect(first.hostRegistryVersion).toBe(1);
    expect(first.registerableHosts).toEqual(OFFICIAL_POLICY_HOSTS_V1.map(({ host, sourceType, jurisdiction }) =>
      ({ host, sourceType, jurisdiction })));
    expect(first.registerableHosts).toHaveLength(10);
    await service.listSources("req-2", "1", first.nextCursor);
    expect(listSources).toHaveBeenLastCalledWith(1, sourceCursor);
    await expect(service.listSources("req", "51")).rejects.toMatchObject({ code: "INVALID_LIMIT" });
    await expect(service.listSources("req", "1", Buffer.from(JSON.stringify({ ...sourceCursor,
      GSI4PK: "OTHER" })).toString("base64url"))).rejects.toMatchObject({ code: "INVALID_CURSOR" });
    await expect(service.listSources("req", "1", Buffer.from(JSON.stringify({ ...sourceCursor,
      GSI4SK: `not-a-time#${id}` })).toString("base64url"))).rejects.toMatchObject({ code: "INVALID_CURSOR" });
  });

  it("does not label an in-progress or previously failed source as healthy", async () => {
    const running = consoleService({ getCrawlState: async () => ({ ...oldState,
      status: "RUNNING", lastCheckedAt: now.toISOString(), lastErrorCode: undefined }) });
    expect((await running.listSources("req")).sourceStates[0]).toMatchObject({
      sourceFresh: false, healthStatus: "STALE", warnings: ["SOURCE_CHECK_IN_PROGRESS"],
    });
    const failed = consoleService({ getCrawlState: async () => ({ ...oldState,
      status: "READY", lastCheckedAt: now.toISOString(), lastErrorCode: "RATE_LIMITED_MANUAL_REVIEW" }) });
    expect((await failed.listSources("req")).sourceStates[0]).toMatchObject({
      sourceFresh: false, healthStatus: "ERROR",
      warnings: ["SOURCE_LAST_ERROR", "SOURCE_CRAWL_ERROR"],
    });
  });

  it("lists only durable bounded run summaries through a scoped cursor", async () => {
    const listRuns = vi.fn().mockResolvedValue({ items: [run], cursor: runCursor });
    const service = consoleService({ listRuns });
    const first = await service.listRuns("req", "1");
    expect(first).toMatchObject({ runs: [run], nextCursor: expect.any(String) });
    await service.listRuns("req", "1", first.nextCursor);
    expect(listRuns).toHaveBeenLastCalledWith(1, runCursor);
    await expect(service.listRuns("req", "1", Buffer.from(JSON.stringify({ PK: "SOURCE#foo",
      SK: runCursor.SK })).toString("base64url"))).rejects.toMatchObject({ code: "INVALID_CURSOR" });
    await expect(service.listRuns("req", "1", "%%%"))
      .rejects.toMatchObject({ code: "INVALID_CURSOR" });
  });

  it("projects unresolved candidate conflict flags without calling all pending evidence conflicts", async () => {
    const candidate = { schemaVersion: 1, reviewStatus: "PENDING_APPROVAL", detectedAt: now.toISOString(),
      conflictFlags: ["VERIFIED_FACT_COMPARISON_PENDING", "POTENTIAL_CROSS_SOURCE_CONFLICT"],
      candidate: { candidateId: `CAND#${"b".repeat(32)}`, sourceId: id, jurisdiction: "IN",
        categoryHint: "STATE_SUBSIDY", claimKey: `claim.${"c".repeat(32)}` } } as PolicyReviewRecordV1;
    const queueCursor = { PK: `CANDIDATE#${candidate.candidate.candidateId}`, SK: "CURRENT",
      GSI1PK: "POLICY_REVIEW_PENDING", GSI1SK: `${now.toISOString()}#${candidate.candidate.candidateId}` };
    const listQueue = vi.fn().mockResolvedValue({ items: [candidate], changes: [], cursor: queueCursor });
    const getCandidate = vi.fn().mockResolvedValue(candidate);
    const service = consoleService({ listQueue, getCandidate });
    const first = await service.listConflicts("req", "1");
    expect(first).toMatchObject({ conflicts: [{ candidateId: candidate.candidate.candidateId,
      resolutionStatus: "UNRESOLVED", reviewStatus: "PENDING_APPROVAL",
      flags: expect.arrayContaining(["POTENTIAL_CROSS_SOURCE_CONFLICT"]) }], nextCursor: expect.any(String) });
    const nonConflict = { ...candidate, conflictFlags: ["VERIFIED_FACT_COMPARISON_PENDING"] };
    getCandidate.mockResolvedValue(nonConflict);
    const empty = await service.listConflicts("req", "1", first.nextCursor);
    expect(empty).toMatchObject({ conflicts: [], nextCursor: expect.any(String) });
    expect(listQueue).toHaveBeenLastCalledWith(1, queueCursor);
  });
});

describe("durable bounded crawler runs", () => {
  it("records per-source outcomes before returning a partial run", async () => {
    const states = ["a", "b", "c"].map(letter => ({ ...oldState,
      sourceId: `SRC#${letter.repeat(32)}` }));
    const recordRun = vi.fn().mockResolvedValue(undefined);
    const workflow = { listDue: async () => states, recordRun } as unknown as PolicyWorkflowRepository;
    const crawler = new PolicyCrawler(records, workflow, {} as never, undefined, () => now);
    vi.spyOn(crawler, "processSource").mockImplementation(async state => {
      if (state.sourceId === states[0]!.sourceId) return "CHANGED";
      if (state.sourceId === states[1]!.sourceId) return "SKIPPED";
      throw new Error("OFFICIAL_FETCH_FAILED");
    });
    const result = await crawler.runDue();
    expect(result).toMatchObject({ status: "PARTIAL", checked: 1, changed: 1, failed: 1, skipped: 1,
      sourceOutcomes: [{ outcome: "CHANGED" }, { outcome: "SKIPPED" }, { outcome: "FAILED" }] });
    expect(recordRun).toHaveBeenCalledWith(result);
    expect(result.runId).not.toBe(oldState.sourceId);
  });

  it("persists a failed source-list attempt and fails if durable history cannot be written", async () => {
    const recordRun = vi.fn().mockResolvedValue(undefined);
    const workflow = { listDue: async () => { throw new Error("Dynamo offline"); }, recordRun } as unknown as PolicyWorkflowRepository;
    await expect(new PolicyCrawler(records, workflow, {} as never, undefined, () => now).runDue())
      .rejects.toThrow("POLICY_CRAWLER_SOURCE_LIST_FAILED");
    expect(recordRun).toHaveBeenCalledWith(expect.objectContaining({ status: "FAILED", errorCode: "SOURCE_LIST_FAILED" }));
    const noHistory = { listDue: async () => [], recordRun: async () => { throw new Error("Dynamo offline"); } } as unknown as PolicyWorkflowRepository;
    await expect(new PolicyCrawler(records, noHistory, {} as never, undefined, () => now).runDue())
      .rejects.toThrow("POLICY_CRAWLER_RUN_PERSIST_FAILED");
  });

  it("uses immutable run writes, consistent pagination and the source GSI cursor", async () => {
    const send = vi.fn(async command => {
      if (command instanceof QueryCommand && command.input.IndexName === "GSI4") return {
        Items: [{ entityType: "POLICY_SOURCE_CURRENT", value: source }], LastEvaluatedKey: sourceCursor,
      };
      if (command instanceof QueryCommand) return { Items: [{ ...runCursor, entityType: "POLICY_CRAWLER_RUN", value: run }],
        LastEvaluatedKey: runCursor };
      return {};
    });
    const repository = new DynamoPolicyWorkflowRepository("policy", "ap-south-1",
      { send } as unknown as DynamoDBDocumentClient);
    await repository.recordRun(run);
    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(PutCommand);
    expect(send.mock.calls[0]?.[0].input).toMatchObject({ ConditionExpression:
      "attribute_not_exists(PK) AND attribute_not_exists(SK)", Item: { PK: "POLICY_CRAWLER_RUNS", value: run } });
    expect((await repository.listRuns(1, runCursor)).items).toEqual([run]);
    expect(send.mock.calls[1]?.[0].input).toMatchObject({ ConsistentRead: true, Limit: 1,
      ExclusiveStartKey: runCursor });
    expect((await repository.listSources(1, sourceCursor)).items).toEqual([source]);
    expect(send.mock.calls[2]?.[0].input).toMatchObject({ IndexName: "GSI4", Limit: 1,
      ExclusiveStartKey: sourceCursor });
  });
});
