import { createHash, randomUUID } from "node:crypto";
import {
  detectPolicyChangeV1, extractPolicyCandidatesV1,
  fetchOfficialPolicyDocument, ingestPolicyDocument, OfficialFetchError,
  policyCandidateFactSchema, policyDocumentChunkSchema, policyDocumentSchema,
  validateOfficialSourceRecord,
  type IngestedPolicyDocument, type PolicyCandidateFactV1, type PolicyDocumentV1,
  type PolicySourceV1,
} from "@solarsaathi/policy";
import type { PolicyObjectStore, PolicyRepository } from "./storage";
import type { PolicyWorkflowRepository } from "./workflow-storage";
import { policyCrawlerRunSchema, type PolicyCrawlerRunV1, type PolicyChangeRecordV1,
  type PolicyCrawlStateV1, type PolicyReviewRecordV1, type PolicyWorkflowAuditV1 } from "./workflow-types";

const hash = (input: string | Uint8Array) => createHash("sha256").update(input).digest("hex");
const MAX_DUE_SOURCES = 10;
const LEASE_SECONDS = 5 * 60;
const MANUAL_REVIEW_DUE_EPOCH = 253402300799;

export interface CrawlerObjectStore extends PolicyObjectStore {
  getDerived(key: string, versionId: string): Promise<Uint8Array>;
}

export type OfficialFetcher = typeof fetchOfficialPolicyDocument;

function conditional(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === "ConditionalCheckFailedException") return true;
  if (error.name !== "TransactionCanceledException" || !("CancellationReasons" in error)) return false;
  const reasons = error.CancellationReasons;
  return Array.isArray(reasons) && reasons.some(reason => reason?.Code === "ConditionalCheckFailed") &&
    reasons.every(reason => ["None", "ConditionalCheckFailed"].includes(reason?.Code));
}

function intervalSeconds(source: PolicySourceV1): number {
  switch (source.crawlFrequency) {
    case "DAILY": return 86_400;
    case "WEEKLY": return 7 * 86_400;
    case "MONTHLY": return 30 * 86_400;
    case "ON_DEMAND": return 365 * 86_400;
  }
}

function audit(sourceId: string, action: PolicyWorkflowAuditV1["action"], at: string,
  runId: string, detailCode?: string): PolicyWorkflowAuditV1 {
  return { schemaVersion: 1, eventId: randomUUID(), actorId: "SYSTEM_CRAWLER", action,
    occurredAt: at, sourceId, runId, ...(detailCode ? { detailCode } : {}) };
}

function parsedPrevious(bytes: Uint8Array, source: PolicySourceV1, document: PolicyDocumentV1):
  { ingested: IngestedPolicyDocument; candidates: PolicyCandidateFactV1[] } {
  const raw: unknown = JSON.parse(Buffer.from(bytes).toString("utf8"));
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Invalid prior policy archive.");
  const record = raw as Record<string, unknown>;
  if (record.sourceId !== source.sourceId || record.documentId !== document.documentId ||
    record.documentVersion !== document.version || record.rawSha256 !== document.sha256 ||
    record.normalizedTextSha256 !== document.normalizedTextSha256 ||
    typeof record.normalizedText !== "string" || record.normalizedText.length > 500_000 ||
    !Array.isArray(record.chunks) || record.chunks.length > 1_000) {
    throw new Error("Prior policy archive binding failed.");
  }
  const chunks = record.chunks.map(value => policyDocumentChunkSchema.parse(value));
  const ingested: IngestedPolicyDocument = { schemaVersion: 1, mimeType: document.mimeType,
    sha256: document.sha256, normalizedTextSha256: document.normalizedTextSha256!,
    normalizedText: record.normalizedText, chunks };
  const candidates = Array.isArray(record.candidates) ? record.candidates.map(value => policyCandidateFactSchema.parse(value)) :
    extractPolicyCandidatesV1(source, document, ingested);
  if (candidates.length > 100) throw new Error("Prior policy candidate limit exceeded.");
  return { ingested, candidates };
}

export class PolicyCrawler {
  constructor(private readonly records: PolicyRepository, private readonly workflow: PolicyWorkflowRepository,
    private readonly objects: CrawlerObjectStore, private readonly fetcher: OfficialFetcher = fetchOfficialPolicyDocument,
    private readonly now: () => Date = () => new Date()) {}

  private async queueChange(source: PolicySourceV1, document: PolicyDocumentV1,
    assessment: ReturnType<typeof detectPolicyChangeV1>, candidates: PolicyCandidateFactV1[],
    at: string, runId: string): Promise<void> {
    const changeId = `CHANGE#${hash(`${source.sourceId}\0${document.documentId}\0${document.version}\0${document.sha256}`).slice(0, 32)}`;
    const change: PolicyChangeRecordV1 = { schemaVersion: 1, changeId, sourceId: source.sourceId,
      documentId: document.documentId, documentVersion: document.version, detectedAt: at, runId,
      assessment, reviewStatus: "PENDING_APPROVAL", revision: 1, detectedBy: "SYSTEM_CRAWLER",
      sourceCuratorId: source.curatorId! };
    try { await this.workflow.putChange(change); }
    catch (error) {
      if (!conditional(error)) throw error;
      const existing = await this.workflow.getChange(changeId);
      if (!existing || existing.assessment.currentRawSha256 !== assessment.currentRawSha256) throw error;
    }
    for (const candidate of candidates) {
      const approved = await this.workflow.findApprovedClaim(candidate.claimKey, 20);
      const flags: string[] = assessment.materialChanges.filter(value => value.claimKey === candidate.claimKey)
        .map(value => value.kind);
      // Approved evidence is still unverified. This flags a possible discrepancy for a human reviewer.
      flags.push("VERIFIED_FACT_COMPARISON_PENDING");
      if (approved.truncated) flags.push("APPROVED_EVIDENCE_LOOKUP_TRUNCATED");
      if (approved.items.some(item => item.candidate.sourceId !== candidate.sourceId &&
        item.candidate.jurisdiction === candidate.jurisdiction &&
        item.candidate.categoryHint === candidate.categoryHint &&
        (item.candidate.quotedText !== candidate.quotedText ||
          JSON.stringify(item.candidate.amountMentions) !== JSON.stringify(candidate.amountMentions) ||
          JSON.stringify(item.candidate.dateMentions) !== JSON.stringify(candidate.dateMentions) ||
          JSON.stringify(item.candidate.capacityMentions) !== JSON.stringify(candidate.capacityMentions)))) {
        flags.push("POTENTIAL_CROSS_SOURCE_CONFLICT");
      }
      const review: PolicyReviewRecordV1 = { schemaVersion: 1, candidate,
        reviewStatus: "PENDING_APPROVAL", revision: 1, detectedAt: at, detectedBy: "SYSTEM_CRAWLER",
        sourceCuratorId: source.curatorId!, changeStatus: assessment.status, conflictFlags: [...new Set(flags)] };
      try { await this.workflow.putCandidate(review); }
      catch (error) {
        if (!conditional(error)) throw error;
        const existing = await this.workflow.getCandidate(candidate.candidateId);
        if (!existing || existing.candidate.citation.documentSha256 !== candidate.citation.documentSha256) throw error;
      }
    }
  }

  async runDue(): Promise<PolicyCrawlerRunV1> {
    const runId = randomUUID(); // Distinct from each source's claim/audit run ID.
    const startedAt = this.now().toISOString();
    const nowEpoch = Math.floor(Date.parse(startedAt) / 1_000);
    let due: PolicyCrawlStateV1[] = [];
    let listFailed = false;
    try { due = await this.workflow.listDue(nowEpoch, MAX_DUE_SOURCES + 1); }
    catch { listFailed = true; }
    const backlog = due.length > MAX_DUE_SOURCES;
    let checked = 0, changed = 0, failed = 0, skipped = 0;
    const sourceOutcomes: PolicyCrawlerRunV1["sourceOutcomes"] = [];
    for (const state of due.slice(0, MAX_DUE_SOURCES)) {
      try {
        const outcome = await this.processSource(state);
        sourceOutcomes.push({ sourceId: state.sourceId, outcome });
        if (outcome === "SKIPPED") { skipped++; continue; }
        checked++;
        if (outcome === "CHANGED") changed++;
      } catch { failed++; sourceOutcomes.push({ sourceId: state.sourceId, outcome: "FAILED" }); }
    }
    const status = listFailed || failed > 0 && checked === 0 ? "FAILED" :
      failed > 0 || backlog ? "PARTIAL" : "COMPLETED";
    const summary = policyCrawlerRunSchema.parse({ schemaVersion: 1, runId, startedAt,
      finishedAt: this.now().toISOString(), status, checked, changed, failed, skipped,
      backlog, sourceOutcomes, ...(listFailed ? { errorCode: "SOURCE_LIST_FAILED" } : {}) });
    // A scheduled invocation must fail if its operational history cannot be persisted.
    try { await this.workflow.recordRun(summary); }
    catch { throw new Error("POLICY_CRAWLER_RUN_PERSIST_FAILED"); }
    if (listFailed) throw new Error("POLICY_CRAWLER_SOURCE_LIST_FAILED");
    return summary;
  }

  async processSource(dueState: PolicyCrawlStateV1): Promise<"SKIPPED" | "UNCHANGED" | "CHANGED"> {
    let source: PolicySourceV1 | undefined;
    try { source = await this.records.getSource(dueState.sourceId); }
    catch { throw new Error("SOURCE_READ_FAILED"); }
    if (!source) throw new Error("SOURCE_MISSING");
    source = validateOfficialSourceRecord(source);
    if (source.registryStatus !== "CURATED" || !source.enabled) return "SKIPPED";
    const nowEpoch = Math.floor(this.now().getTime() / 1_000);
    const crawlRunId = randomUUID();
    let claimed: PolicyCrawlStateV1;
    try { claimed = await this.workflow.claimCrawl(dueState, nowEpoch, nowEpoch + LEASE_SECONDS,
      audit(source.sourceId, "CRAWL_STARTED", this.now().toISOString(), crawlRunId)); }
    catch (error) { if (conditional(error)) return "SKIPPED"; throw error; }
    try {
      let result = await this.fetcher({ source, ...(claimed.etag ? { etag: claimed.etag } : {}),
        ...(claimed.lastModified ? { lastModified: claimed.lastModified } : {}) });
      let documentId = `DOC#${hash(result.finalUrl).slice(0, 32)}`;
      if (result.status === "NOT_MODIFIED" && documentId !== claimed.lastDocumentId) {
        // A redirect can change the cited document while the origin returns 304.
        result = await this.fetcher({ source });
        if (result.status === "NOT_MODIFIED") throw new RangeError("Unconditional official fetch returned 304.");
        documentId = `DOC#${hash(result.finalUrl).slice(0, 32)}`;
      }
      if (result.status === "CHANGED" && hash(result.bytes) !== result.sha256) {
        throw new RangeError("Official fetch body and digest differ.");
      }
      const at = this.now().toISOString();
      const nextDue = Math.floor(this.now().getTime() / 1_000) + intervalSeconds(source);
      if (result.status === "NOT_MODIFIED" || result.status === "CHANGED" &&
        result.sha256 === claimed.lastObservedSha256 && documentId === claimed.lastDocumentId) {
        const next: PolicyCrawlStateV1 = { ...claimed, revision: claimed.revision + 1, status: "READY",
          lastErrorCode: undefined,
          nextDueAtEpochSeconds: nextDue, lastCheckedAt: at, failureCount: 0,
          ...(result.etag ? { etag: result.etag } : {}),
          ...(result.lastModified ? { lastModified: result.lastModified } : {}) };
        await this.workflow.completeCrawl(claimed, next, audit(source.sourceId, "CRAWL_CHECKED", at, crawlRunId, "NOT_MODIFIED"));
        return "UNCHANGED";
      }
      const previousDocument = await this.workflow.latestDocument(source.sourceId, documentId);
      if (previousDocument?.sha256 === result.sha256 && claimed.lastDocumentId === documentId &&
        claimed.lastDocumentVersion === previousDocument.version) {
        const next: PolicyCrawlStateV1 = { ...claimed, revision: claimed.revision + 1, status: "READY",
          lastErrorCode: undefined,
          nextDueAtEpochSeconds: nextDue, lastCheckedAt: at, lastObservedSha256: result.sha256,
          lastNormalizedTextSha256: previousDocument.normalizedTextSha256,
          lastDocumentId: documentId, lastDocumentVersion: previousDocument.version, failureCount: 0,
          ...(result.etag ? { etag: result.etag } : {}),
          ...(result.lastModified ? { lastModified: result.lastModified } : {}) };
        await this.workflow.completeCrawl(claimed, next, audit(source.sourceId, "CRAWL_CHECKED", at, crawlRunId, "RAW_UNCHANGED"));
        return "UNCHANGED";
      }
      if (previousDocument?.sha256 === result.sha256) {
        if (!previousDocument.derivedS3Key || !previousDocument.derivedS3VersionId ||
          !previousDocument.normalizedTextSha256) throw new Error("PREVIOUS_ARCHIVE_INCOMPLETE");
        const previousSource = await this.workflow.getSourceVersion(source.sourceId, previousDocument.sourceRegistryVersion);
        if (!previousSource) throw new Error("PREVIOUS_SOURCE_VERSION_MISSING");
        const recovered = parsedPrevious(await this.objects.getDerived(previousDocument.derivedS3Key,
          previousDocument.derivedS3VersionId), previousSource, previousDocument);
        const assessment = detectPolicyChangeV1(undefined, { document: previousDocument,
          ingested: recovered.ingested, candidates: recovered.candidates });
        await this.queueChange(source, previousDocument, assessment, recovered.candidates, at, crawlRunId);
        const next: PolicyCrawlStateV1 = { ...claimed, revision: claimed.revision + 1, status: "READY",
          lastErrorCode: undefined,
          nextDueAtEpochSeconds: nextDue, lastCheckedAt: at, lastChangedAt: at,
          lastObservedSha256: result.sha256, lastNormalizedTextSha256: previousDocument.normalizedTextSha256,
          lastDocumentId: documentId, lastDocumentVersion: previousDocument.version, failureCount: 0,
          ...(result.etag ? { etag: result.etag } : {}),
          ...(result.lastModified ? { lastModified: result.lastModified } : {}) };
        await this.workflow.completeCrawl(claimed, next, audit(source.sourceId, "DOCUMENT_CHANGED", at, crawlRunId, assessment.status));
        return "CHANGED";
      }
      const documentVersion = (previousDocument?.version ?? 0) + 1;
      const ingested = await ingestPolicyDocument({ sourceId: source.sourceId, documentId,
        documentVersion, mimeType: result.mimeType, bytes: result.bytes }, { maxHtmlBytes: 2_000_000,
        maxPdfBytes: 2_000_000, maxPages: 50 });
      const provisional = policyDocumentSchema.parse({ schemaVersion: 1, documentId, sourceId: source.sourceId,
        sourceRegistryVersion: source.registryVersion, version: documentVersion, title: ingested.title ??
          new URL(result.finalUrl).pathname.split("/").filter(Boolean).at(-1)?.slice(0, 300) ?? "Official source document",
        documentType: result.mimeType === "application/pdf" ? "CIRCULAR" : "OFFICIAL_WEBPAGE",
        mimeType: result.mimeType, canonicalUrl: result.finalUrl, sha256: ingested.sha256,
        normalizedTextSha256: ingested.normalizedTextSha256, retrievedAt: at, chunkCount: ingested.chunks.length });
      const candidates = extractPolicyCandidatesV1(source, provisional, ingested);
      let previous: { sha256: string; normalizedTextSha256: string; candidates: PolicyCandidateFactV1[] } | undefined;
      if (previousDocument) {
        if (!previousDocument.derivedS3Key || !previousDocument.derivedS3VersionId || !previousDocument.normalizedTextSha256) {
          throw new Error("PREVIOUS_ARCHIVE_INCOMPLETE");
        }
        const previousSource = await this.workflow.getSourceVersion(source.sourceId, previousDocument.sourceRegistryVersion);
        if (!previousSource) throw new Error("PREVIOUS_SOURCE_VERSION_MISSING");
        const bytes = await this.objects.getDerived(previousDocument.derivedS3Key, previousDocument.derivedS3VersionId);
        const recovered = parsedPrevious(bytes, previousSource, previousDocument);
        previous = { sha256: previousDocument.sha256, normalizedTextSha256: previousDocument.normalizedTextSha256,
          candidates: recovered.candidates };
      }
      const assessment = detectPolicyChangeV1(previous, { document: provisional, ingested, candidates });
      if (assessment.reviewStatus === "NOT_REQUIRED") {
        const next: PolicyCrawlStateV1 = { ...claimed, revision: claimed.revision + 1, status: "READY",
          lastErrorCode: undefined,
          nextDueAtEpochSeconds: nextDue, lastCheckedAt: at, lastObservedSha256: result.sha256,
          lastNormalizedTextSha256: ingested.normalizedTextSha256, failureCount: 0,
          ...(result.etag ? { etag: result.etag } : {}),
          ...(result.lastModified ? { lastModified: result.lastModified } : {}) };
        await this.workflow.completeCrawl(claimed, next, audit(source.sourceId, "CRAWL_CHECKED", at, crawlRunId, assessment.status));
        return "UNCHANGED";
      }
      const versionKey = String(documentVersion).padStart(8, "0");
      const rawKey = `raw/${source.sourceId.slice(4)}/${documentId.slice(4)}/v${versionKey}/${ingested.sha256}${result.mimeType === "application/pdf" ? ".pdf" : ".html"}`;
      const derived = Buffer.from(JSON.stringify({ schemaVersion: 1, sourceId: source.sourceId,
        documentId, documentVersion, rawSha256: ingested.sha256,
        normalizedTextSha256: ingested.normalizedTextSha256, normalizedText: ingested.normalizedText,
        chunks: ingested.chunks, candidates }));
      const derivedHash = hash(derived);
      const derivedKey = `derived/${source.sourceId.slice(4)}/${documentId.slice(4)}/v${versionKey}/${derivedHash}.json`;
      const rawVersionId = await this.objects.putImmutable(rawKey, result.bytes, result.mimeType, ingested.sha256);
      const derivedVersionId = await this.objects.putImmutable(derivedKey, derived, "application/json", derivedHash);
      const document = policyDocumentSchema.parse({ ...provisional, s3Key: rawKey, s3VersionId: rawVersionId,
        derivedS3Key: derivedKey, derivedS3VersionId: derivedVersionId });
      try { await this.records.putDocument(document); }
      catch (error) {
        if (!conditional(error)) throw error;
        const existing = await this.records.getDocument(source.sourceId, documentId, documentVersion);
        if (!existing || existing.sha256 !== document.sha256 || existing.derivedS3Key !== document.derivedS3Key) throw error;
      }
      await this.queueChange(source, document, assessment, candidates, at, crawlRunId);
      const next: PolicyCrawlStateV1 = { ...claimed, revision: claimed.revision + 1, status: "READY",
        lastErrorCode: undefined,
        nextDueAtEpochSeconds: nextDue, lastCheckedAt: at, lastChangedAt: at,
        lastObservedSha256: ingested.sha256, lastNormalizedTextSha256: ingested.normalizedTextSha256,
        lastDocumentId: documentId, lastDocumentVersion: documentVersion, failureCount: 0,
        ...(result.etag ? { etag: result.etag } : {}),
        ...(result.lastModified ? { lastModified: result.lastModified } : {}) };
      await this.workflow.completeCrawl(claimed, next, audit(source.sourceId, "DOCUMENT_CHANGED", at, crawlRunId, assessment.status));
      return "CHANGED";
    } catch (error) {
      const at = this.now().toISOString();
      const code = error instanceof OfficialFetchError ? error.code :
        error instanceof RangeError ? "VALIDATION_FAILED" : "INGEST_FAILED";
      const manualRateLimitReview = error instanceof OfficialFetchError && error.code === "RATE_LIMITED" &&
        error.retryAfterExceedsCap;
      const retrySeconds = error instanceof OfficialFetchError && error.code === "RATE_LIMITED" ?
        Math.max(3_600, error.retryAfterSeconds ?? 0) : 3_600;
      const retryEpoch = manualRateLimitReview ? MANUAL_REVIEW_DUE_EPOCH :
        Math.floor(this.now().getTime() / 1_000) + retrySeconds;
      const failed: PolicyCrawlStateV1 = { ...claimed, revision: claimed.revision + 1, status: "ERROR",
        nextDueAtEpochSeconds: retryEpoch, lastErrorCode: manualRateLimitReview ? "RATE_LIMITED_MANUAL_REVIEW" : code,
        failureCount: claimed.failureCount + 1 };
      try { await this.workflow.completeCrawl(claimed, failed, audit(source.sourceId, "CRAWL_FAILED", at, crawlRunId, code)); }
      catch { /* Preserve the original failure; the lease expires and the worker retries. */ }
      throw new Error("POLICY_CRAWL_FAILED");
    }
  }
}
