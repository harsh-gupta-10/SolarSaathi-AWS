import { createHash, randomUUID } from "node:crypto";
import { policySourceSchema, validateOfficialSourceRecord } from "@solarsaathi/policy";
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

  async listSources(requestId: string) {
    try {
      const sources = (await this.workflow.listSources(50)).map(value => validateOfficialSourceRecord(value));
      const states = await Promise.all(sources.map(source => this.workflow.getCrawlState(source.sourceId)));
      const sourceStates = sources.map((source, index) => {
        const crawlState = states[index];
        const sourceFresh = crawlState?.lastCheckedAt ?
          this.now().getTime() - Date.parse(crawlState.lastCheckedAt) <= source.freshnessWindowHours * 3_600_000 : false;
        return { sourceId: source.sourceId, crawlState, sourceFresh };
      });
      return { schemaVersion: 1 as const, sources, sourceStates, requestId };
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
    const limit = limitInput === undefined ? 20 : Number(limitInput);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) throw new RequestError(400, "INVALID_LIMIT", "Queue limit must be from 1 to 50.");
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
      const sourceFresh = crawlState?.lastCheckedAt ?
        this.now().getTime() - Date.parse(crawlState.lastCheckedAt) <= verifiedSource.freshnessWindowHours * 3_600_000 : false;
      const [currentPreview, previousDocument] = await Promise.all([
        this.documentPreview(document),
        document.version > 1 ? this.records.getDocument(record.sourceId, record.documentId, document.version - 1) : undefined,
      ]);
      if (record.assessment.previousRawSha256 &&
        (previousDocument?.sha256 !== record.assessment.previousRawSha256 ||
          previousDocument.normalizedTextSha256 !== record.assessment.previousNormalizedTextSha256)) throw unavailable();
      const previousPreview = previousDocument ? await this.documentPreview(previousDocument) : undefined;
      return { schemaVersion: 1 as const, change: record, source: verifiedSource, document,
        crawlState, sourceFresh,
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
      const freshness = crawlState?.lastCheckedAt ?
        this.now().getTime() - Date.parse(crawlState.lastCheckedAt) <= verifiedSource.freshnessWindowHours * 3_600_000 : false;
      return { schemaVersion: 1 as const, candidate: review, source: verifiedSource, document,
        crawlState, sourceFresh: freshness, audit: events, requestId };
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
