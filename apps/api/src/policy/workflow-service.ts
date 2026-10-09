import { createHash, randomUUID } from "node:crypto";
import { OFFICIAL_POLICY_HOSTS_V1, policySourceSchema, validateOfficialSourceRecord } from "@solarsaathi/policy";
import { z } from "zod";
import { RequestError } from "../lib/http";
import type { PolicyRepository } from "./storage";
import type { PolicyWorkflowRepository } from "./workflow-storage";
import type { PolicyChangeRecordV1, PolicyCrawlStateV1, PolicyReviewRecordV1, PolicyWorkflowAuditV1 } from "./workflow-types";

const sourceId = z.string().regex(/^SRC#[a-f0-9]{32}$/);
const candidateId = z.string().regex(/^CAND#[a-f0-9]{32}$/);
const changeId = z.string().regex(/^CHANGE#[a-f0-9]{32}$/);
const curateRequest = z.object({ sourceId, expectedRegistryVersion: z.number().int().positive() }).strict();
const crawlRequest = z.object({ sourceId, rateLimitClearanceReason: z.string().trim().min(10).max(500).optional() }).strict();
const reviewRequest = z.object({ expectedRevision: z.number().int().positive(), reason: z.string().trim().min(1).max(1_000).optional() }).strict();
const registerableHosts = OFFICIAL_POLICY_HOSTS_V1.map(({ host, sourceType, jurisdiction }) =>
  ({ host, sourceType, jurisdiction }));
if (registerableHosts.length > 50) throw new Error("The policy host registry exceeds the bounded admin response.");
const unavailable = () => new RequestError(503, "POLICY_STORAGE_UNAVAILABLE", "The policy registry is temporarily unavailable.");
const changed = () => new RequestError(409, "POLICY_STATE_CHANGED", "This policy record changed. Refresh and retry.");
const conditional = (error: unknown) => {
  if (!(error instanceof Error)) return false;
  if (error.name === "ConditionalCheckFailedException") return true;
  if (error.name !== "TransactionCanceledException" || !("CancellationReasons" in error)) return false;
  const reasons = error.CancellationReasons;
  return Array.isArray(reasons) && reasons.some(reason => reason?.Code === "ConditionalCheckFailed") &&
    reasons.every(reason => ["None", "ConditionalCheckFailed"].includes(reason?.Code));
};

function parsed<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) throw new RequestError(400, "INVALID_REQUEST", "The policy review request contains invalid fields.");
  return result.data;
}

function audit(action: PolicyWorkflowAuditV1["action"], actorId: string, sourceIdValue: string,
  at: string, candidateIdValue?: string, detailCode?: string): PolicyWorkflowAuditV1 {
  return { schemaVersion: 1, eventId: randomUUID(), action, actorId, sourceId: sourceIdValue,
    occurredAt: at, ...(candidateIdValue ? { candidateId: candidateIdValue } : {}),
    ...(detailCode ? { detailCode } : {}) };
}

function decodeCursor(raw: string | undefined): Record<string, unknown> | undefined {
  if (!raw) return undefined;
  if (raw.length > 1_024 || !/^[A-Za-z0-9_-]+$/.test(raw)) throw new RequestError(400, "INVALID_CURSOR", "The queue cursor is invalid.");
  try {
    const value: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    const keys = ["PK", "SK", "GSI1PK", "GSI1SK"];
    if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).some(key => !keys.includes(key)) || keys.some(key => typeof (value as Record<string, unknown>)[key] !== "string")) {
      throw new Error("invalid cursor");
    }
    const result = value as Record<string, string>;
    if (!/^(?:CANDIDATE#CAND#|CHANGE#CHANGE#)[a-f0-9]{32}$/.test(result.PK) || result.SK !== "CURRENT" ||
      result.GSI1PK !== "POLICY_REVIEW_PENDING" || result.GSI1SK.length > 128) throw new Error("invalid cursor");
    return result;
  } catch { throw new RequestError(400, "INVALID_CURSOR", "The queue cursor is invalid."); }
}

type PageKind = "sources" | "runs";
function decodePageCursor(raw: string | undefined, kind: PageKind): Record<string, string> | undefined {
  if (!raw) return undefined;
  if (raw.length > 1_024 || !/^[A-Za-z0-9_-]+$/.test(raw)) {
    throw new RequestError(400, "INVALID_CURSOR", "The policy listing cursor is invalid.");
  }
  try {
    const bytes = Buffer.from(raw, "base64url");
    if (bytes.toString("base64url") !== raw) throw new Error("Noncanonical cursor.");
    const value: unknown = JSON.parse(bytes.toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid cursor.");
    const record = value as Record<string, unknown>;
    const keys = kind === "sources" ? ["PK", "SK", "GSI4PK", "GSI4SK"] : ["PK", "SK"];
    if (Object.keys(record).length !== keys.length || keys.some(key => typeof record[key] !== "string")) {
      throw new Error("Invalid cursor fields.");
    }
    if (kind === "sources") {
      const id = String(record.PK).slice(7);
      if (!sourceId.safeParse(id).success || record.PK !== `SOURCE#${id}` || record.SK !== "CURRENT" ||
        record.GSI4PK !== "POLICY_SOURCES" ||
        typeof record.GSI4SK !== "string" || !record.GSI4SK.endsWith(`#${id}`) ||
        !z.iso.datetime({ offset: true }).safeParse(record.GSI4SK.slice(0, -id.length - 1)).success) {
        throw new Error("Invalid source cursor.");
      }
    } else if (record.PK !== "POLICY_CRAWLER_RUNS" || typeof record.SK !== "string" ||
      !/^RUN#\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z#[0-9a-f-]{36}$/.test(record.SK)) {
      throw new Error("Invalid run cursor.");
    }
    return record as Record<string, string>;
  } catch { throw new RequestError(400, "INVALID_CURSOR", "The policy listing cursor is invalid."); }
}

function encodePageCursor(value: Record<string, unknown> | undefined, kind: PageKind): string | undefined {
  if (!value) return undefined;
  const encoded = Buffer.from(JSON.stringify(value)).toString("base64url");
  decodePageCursor(encoded, kind);
  return encoded;
}

function pageLimit(value: string | undefined): number {
  const limit = value === undefined ? 20 : Number(value);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
    throw new RequestError(400, "INVALID_LIMIT", "Listing limit must be from 1 to 50.");
  }
  return limit;
}

function sourceHealth(source: ReturnType<typeof validateOfficialSourceRecord>, state: PolicyCrawlStateV1 | undefined,
  now: Date) {
  const warnings: string[] = [];
  let healthStatus: "PROPOSED" | "DISABLED" | "UNCHECKED" | "HEALTHY" | "STALE" | "ERROR";
  const checkedMs = state?.lastCheckedAt ? Date.parse(state.lastCheckedAt) : NaN;
  const ageMs = now.getTime() - checkedMs;
  const sourceFresh = source.registryStatus === "CURATED" && source.enabled &&
    state?.status === "READY" && !state.lastErrorCode && Number.isFinite(checkedMs) && ageMs >= 0 &&
    ageMs <= source.freshnessWindowHours * 3_600_000;
  if (state?.lastCheckedAt && (!Number.isFinite(checkedMs) || ageMs < 0)) warnings.push("SOURCE_CHECK_TIME_INVALID");
  else if (state?.lastCheckedAt && ageMs > source.freshnessWindowHours * 3_600_000) warnings.push("SOURCE_CHECK_STALE");
  if (state?.status === "RUNNING") warnings.push("SOURCE_CHECK_IN_PROGRESS");
  if (state?.lastErrorCode) warnings.push("SOURCE_LAST_ERROR");
  if (source.registryStatus !== "CURATED") { healthStatus = "PROPOSED"; warnings.push("SOURCE_NOT_CURATED"); }
  else if (!source.enabled) { healthStatus = "DISABLED"; warnings.push("SOURCE_DISABLED"); }
  else if (state?.status === "ERROR" || state?.lastErrorCode) { healthStatus = "ERROR"; warnings.push("SOURCE_CRAWL_ERROR"); }
  else if (!state?.lastCheckedAt) { healthStatus = "UNCHECKED"; warnings.push("SOURCE_NEVER_CHECKED"); }
  else if (!sourceFresh) healthStatus = "STALE";
  else healthStatus = "HEALTHY";
  return { sourceId: source.sourceId, ...(state ? { crawlState: state } : {}), sourceFresh, healthStatus, warnings };
}

export class PolicyWorkflowService {
  constructor(private readonly records: PolicyRepository, private readonly workflow: PolicyWorkflowRepository,
    private readonly now: () => Date = () => new Date(),
    private readonly derived?: { getDerived(key: string, versionId: string): Promise<Uint8Array> }) {}

  private async documentPreview(document: { sourceId: string; documentId: string; version: number;
    sha256: string; normalizedTextSha256?: string; derivedS3Key?: string; derivedS3VersionId?: string }):
    Promise<{ text: string; truncated: boolean } | undefined> {
    if (!this.derived || !document.derivedS3Key || !document.derivedS3VersionId ||
      !document.normalizedTextSha256) return undefined;
    const bytes = await this.derived.getDerived(document.derivedS3Key, document.derivedS3VersionId);
    const parsed: unknown = JSON.parse(Buffer.from(bytes).toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw unavailable();
    const record = parsed as Record<string, unknown>;
    const normalizedText = record.normalizedText;
    if (record.sourceId !== document.sourceId || record.documentId !== document.documentId ||
      record.documentVersion !== document.version || record.rawSha256 !== document.sha256 ||
      record.normalizedTextSha256 !== document.normalizedTextSha256 ||
      typeof normalizedText !== "string" || normalizedText.length > 500_000 ||
      createHash("sha256").update(normalizedText).digest("hex") !== document.normalizedTextSha256) throw unavailable();
    return { text: normalizedText.slice(0, 4_000), truncated: normalizedText.length > 4_000 };
  }

  async listSources(requestId: string, limitInput?: string, cursorInput?: string) {
    const limit = pageLimit(limitInput);
    const cursor = decodePageCursor(cursorInput, "sources");
    try {
      const page = await this.workflow.listSources(limit, cursor);
      const sources = page.items.map(value => validateOfficialSourceRecord(value));
      const states = await Promise.all(sources.map(source => this.workflow.getCrawlState(source.sourceId)));
      const now = this.now();
      const sourceStates = sources.map((source, index) => sourceHealth(source, states[index], now));
      const nextCursor = encodePageCursor(page.cursor, "sources");
      return { schemaVersion: 1 as const, hostRegistryVersion: 1 as const, registerableHosts,
        sources, sourceStates,
        ...(nextCursor ? { nextCursor } : {}), requestId };
    } catch { throw unavailable(); }
  }

  async listRuns(requestId: string, limitInput?: string, cursorInput?: string) {
    const limit = pageLimit(limitInput);
    const cursor = decodePageCursor(cursorInput, "runs");
    try {
      const page = await this.workflow.listRuns(limit, cursor);
      const nextCursor = encodePageCursor(page.cursor, "runs");
      return { schemaVersion: 1 as const, runs: page.items,
        ...(nextCursor ? { nextCursor } : {}), requestId };
    } catch { throw unavailable(); }
  }

  async listConflicts(requestId: string, limitInput?: string, cursorInput?: string) {
    const limit = pageLimit(limitInput);
    const cursor = decodeCursor(cursorInput);
    try {
      const page = await this.workflow.listQueue(limit, cursor);
      const current = await Promise.all(page.items.map(item => this.workflow.getCandidate(item.candidate.candidateId)));
      const conflicts = current.filter((item): item is PolicyReviewRecordV1 => !!item &&
        item.reviewStatus === "PENDING_APPROVAL" && item.conflictFlags.some(flag =>
          flag === "POTENTIAL_CROSS_SOURCE_CONFLICT" || flag === "POTENTIAL_POLICY_CONFLICT"))
        .map(item => ({ candidateId: item.candidate.candidateId, sourceId: item.candidate.sourceId,
          jurisdiction: item.candidate.jurisdiction, categoryHint: item.candidate.categoryHint,
          claimKey: item.candidate.claimKey, detectedAt: item.detectedAt,
          reviewStatus: "PENDING_APPROVAL" as const, resolutionStatus: "UNRESOLVED" as const,
          flags: item.conflictFlags }));
      return { schemaVersion: 1 as const, conflicts,
        ...(page.cursor ? { nextCursor: Buffer.from(JSON.stringify(page.cursor)).toString("base64url") } : {}), requestId };
    } catch { throw unavailable(); }
  }

  async curateSource(body: unknown, actorId: string, requestId: string) {
    const input = parsed(curateRequest, body);
    let previous;
    try { previous = await this.records.getSource(input.sourceId); }
    catch { throw unavailable(); }
    if (!previous) throw new RequestError(404, "SOURCE_NOT_FOUND", "The policy source was not found.");
    try { previous = validateOfficialSourceRecord(previous); }
    catch { throw unavailable(); }
    if (previous.registryVersion !== input.expectedRegistryVersion || previous.registryStatus !== "PROPOSED") throw changed();
    const now = this.now();
    const at = now.toISOString();
    const source = policySourceSchema.parse({ ...previous, registryVersion: previous.registryVersion + 1,
      registryStatus: "CURATED", enabled: true, curatedAt: at, curatorId: actorId, updatedAt: at });
    const state: PolicyCrawlStateV1 = { schemaVersion: 1, sourceId: source.sourceId, revision: 1,
      status: "READY", nextDueAtEpochSeconds: Math.floor(now.getTime() / 1_000), failureCount: 0 };
    try { await this.workflow.curateSource(previous, source, state, audit("SOURCE_CURATED", actorId, source.sourceId, at)); }
    catch (error) { throw conditional(error) ? changed() : unavailable(); }
    return { schemaVersion: 1 as const, source, createdVersion: source.registryVersion, requestId };
  }

  async queue(limitInput: string | undefined, cursorInput: string | undefined, requestId: string) {
    const limit = pageLimit(limitInput);
    const cursor = decodeCursor(cursorInput);
    try {
      const page = await this.workflow.listQueue(limit, cursor);
      const current = await Promise.all(page.items.map(item => this.workflow.getCandidate(item.candidate.candidateId)));
      const items = current.filter((item): item is PolicyReviewRecordV1 => !!item && item.reviewStatus === "PENDING_APPROVAL");
      const checkedChanges = await Promise.all(page.changes.map(item => this.workflow.getChange(item.changeId)));
      const changes = checkedChanges.filter((item): item is PolicyChangeRecordV1 => !!item && item.reviewStatus === "PENDING_APPROVAL");
      return { schemaVersion: 1 as const, items, changes,
        ...(page.cursor ? { nextCursor: Buffer.from(JSON.stringify(page.cursor)).toString("base64url") } : {}), requestId };
    } catch { throw unavailable(); }
  }

  async change(changeIdInput: string, requestId: string) {
    const id = parsed(changeId, changeIdInput);
    let record: PolicyChangeRecordV1 | undefined;
    try { record = await this.workflow.getChange(id); }
    catch { throw unavailable(); }
    if (!record) throw new RequestError(404, "CHANGE_NOT_FOUND", "The policy change was not found.");
    try {
      const [source, crawlState, document, events] = await Promise.all([
        this.records.getSource(record.sourceId), this.workflow.getCrawlState(record.sourceId),
        this.records.getDocument(record.sourceId, record.documentId, record.documentVersion),
        this.workflow.listChangeAudit(id, 50),
      ]);
      if (!source || !document) throw unavailable();
      if (record.assessment.currentRawSha256 !== document.sha256 ||
        record.assessment.currentNormalizedTextSha256 !== document.normalizedTextSha256) throw unavailable();
      const verifiedSource = validateOfficialSourceRecord(source);
      const health = sourceHealth(verifiedSource, crawlState, this.now());
      const [currentPreview, previousDocument] = await Promise.all([
        this.documentPreview(document),
        document.version > 1 ? this.records.getDocument(record.sourceId, record.documentId, document.version - 1) : undefined,
      ]);
      if (record.assessment.previousRawSha256 &&
        (previousDocument?.sha256 !== record.assessment.previousRawSha256 ||
          previousDocument.normalizedTextSha256 !== record.assessment.previousNormalizedTextSha256)) throw unavailable();
      const previousPreview = previousDocument ? await this.documentPreview(previousDocument) : undefined;
      return { schemaVersion: 1 as const, change: record, source: verifiedSource, document,
        crawlState, sourceFresh: health.sourceFresh, sourceHealthStatus: health.healthStatus,
        sourceWarnings: health.warnings,
        ...(currentPreview ? { textPreview: currentPreview.text, textTruncated: currentPreview.truncated } : {}),
        ...(previousPreview ? { previousTextPreview: previousPreview.text,
          previousTextTruncated: previousPreview.truncated } : {}),
        audit: events, requestId };
    } catch { throw unavailable(); }
  }

  async reviewChange(changeIdInput: string, decision: "APPROVED" | "REJECTED", body: unknown,
    actorId: string, requestId: string) {
    const id = parsed(changeId, changeIdInput);
    const input = parsed(reviewRequest, body);
    let current: PolicyChangeRecordV1 | undefined;
    try { current = await this.workflow.getChange(id); }
    catch { throw unavailable(); }
    if (!current) throw new RequestError(404, "CHANGE_NOT_FOUND", "The policy change was not found.");
    if (current.reviewStatus !== "PENDING_APPROVAL" || current.revision !== input.expectedRevision) throw changed();
    if (actorId === current.sourceCuratorId || actorId === current.detectedBy) {
      throw new RequestError(403, "SEPARATE_REVIEWER_REQUIRED", "A different policy administrator must review this change.");
    }
    const at = this.now().toISOString();
    const next: PolicyChangeRecordV1 = { ...current, revision: current.revision + 1,
      reviewStatus: decision, reviewedAt: at, reviewedBy: actorId,
      ...(input.reason ? { reviewReason: input.reason } : {}) };
    const event: PolicyWorkflowAuditV1 = { ...audit(decision === "APPROVED" ? "CHANGE_APPROVED" : "CHANGE_REJECTED",
      actorId, current.sourceId, at, undefined, input.reason), changeId: id };
    try { await this.workflow.reviewChange(current, next, event); }
    catch (error) { throw conditional(error) ? changed() : unavailable(); }
    return { schemaVersion: 1 as const, change: next, requestId };
  }

  async candidate(candidateIdInput: string, requestId: string) {
    const id = parsed(candidateId, candidateIdInput);
    let review: PolicyReviewRecordV1 | undefined;
    try { review = await this.workflow.getCandidate(id); }
    catch { throw unavailable(); }
    if (!review) throw new RequestError(404, "CANDIDATE_NOT_FOUND", "The policy candidate was not found.");
    try {
      const [source, crawlState, document, events] = await Promise.all([
        this.records.getSource(review.candidate.sourceId), this.workflow.getCrawlState(review.candidate.sourceId),
        this.records.getDocument(review.candidate.sourceId, review.candidate.documentId, review.candidate.documentVersion),
        this.workflow.listCandidateAudit(id, 50),
      ]);
      if (!source || !document) throw unavailable();
      const verifiedSource = validateOfficialSourceRecord(source);
      const health = sourceHealth(verifiedSource, crawlState, this.now());
      return { schemaVersion: 1 as const, candidate: review, source: verifiedSource, document,
        crawlState, sourceFresh: health.sourceFresh, sourceHealthStatus: health.healthStatus,
        sourceWarnings: health.warnings, audit: events, requestId };
    } catch { throw unavailable(); }
  }

  async review(candidateIdInput: string, decision: "APPROVED" | "REJECTED", body: unknown,
    actorId: string, requestId: string) {
    const id = parsed(candidateId, candidateIdInput);
    const input = parsed(reviewRequest, body);
    let current: PolicyReviewRecordV1 | undefined;
    try { current = await this.workflow.getCandidate(id); }
    catch { throw unavailable(); }
    if (!current) throw new RequestError(404, "CANDIDATE_NOT_FOUND", "The policy candidate was not found.");
    if (current.reviewStatus !== "PENDING_APPROVAL" || current.revision !== input.expectedRevision) throw changed();
    if (actorId === current.sourceCuratorId || actorId === current.detectedBy) {
      throw new RequestError(403, "SEPARATE_REVIEWER_REQUIRED", "A different policy administrator must review this evidence.");
    }
    const at = this.now().toISOString();
    const next: PolicyReviewRecordV1 = { ...current, revision: current.revision + 1,
      reviewStatus: decision, reviewedAt: at, reviewedBy: actorId,
      ...(input.reason ? { reviewReason: input.reason } : {}) };
    const event = audit(decision === "APPROVED" ? "EVIDENCE_APPROVED" : "EVIDENCE_REJECTED", actorId,
      current.candidate.sourceId, at, id, input.reason);
    try { await this.workflow.reviewCandidate(current, next, event); }
    catch (error) { throw conditional(error) ? changed() : unavailable(); }
    return { schemaVersion: 1 as const, candidate: next, requestId };
  }

  async requestCrawl(body: unknown, actorId: string, requestId: string) {
    const input = parsed(crawlRequest, body);
    let source;
    let state;
    try { [source, state] = await Promise.all([this.records.getSource(input.sourceId), this.workflow.getCrawlState(input.sourceId)]); }
    catch { throw unavailable(); }
    if (!source || !state) throw new RequestError(404, "SOURCE_NOT_FOUND", "The curated policy source was not found.");
    try { source = validateOfficialSourceRecord(source); }
    catch { throw unavailable(); }
    if (source.registryStatus !== "CURATED" || !source.enabled) throw new RequestError(409, "SOURCE_NOT_CURATED", "Curate and enable this source before crawling.");
    if (state.status === "RUNNING") throw changed();
    const now = this.now();
    const at = now.toISOString();
    const nowEpoch = Math.floor(now.getTime() / 1_000);
    if (state.lastErrorCode === "RATE_LIMITED" && state.nextDueAtEpochSeconds > nowEpoch) {
      throw new RequestError(429, "SOURCE_RATE_LIMITED", "This official source requested a later retry. Wait for the scheduled check.");
    }
    if (state.lastErrorCode === "RATE_LIMITED_MANUAL_REVIEW" && !input.rateLimitClearanceReason) {
      throw new RequestError(429, "RATE_LIMIT_CLEARANCE_REQUIRED", "This source requires documented administrator review before another check.");
    }
    if (state.nextDueAtEpochSeconds <= nowEpoch) return { schemaVersion: 1 as const, queued: false, dueAt: at, requestId };
    if (state.lastCheckedAt && now.getTime() - Date.parse(state.lastCheckedAt) < 15 * 60_000) {
      throw new RequestError(429, "CRAWL_COOLDOWN", "This source was checked recently. Retry later.");
    }
    const next = { ...state, revision: state.revision + 1, status: "READY" as const,
      nextDueAtEpochSeconds: nowEpoch, lastErrorCode: undefined };
    const detail = state.lastErrorCode === "RATE_LIMITED_MANUAL_REVIEW" ?
      `RATE_LIMIT_CLEARANCE: ${input.rateLimitClearanceReason}` : undefined;
    try { await this.workflow.requestCrawl(state, next, audit("CRAWL_QUEUED", actorId, source.sourceId, at, undefined, detail)); }
    catch (error) { throw conditional(error) ? changed() : unavailable(); }
    return { schemaVersion: 1 as const, queued: true, dueAt: at, requestId };
  }
}
