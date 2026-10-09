import { fetchAuthSession } from "aws-amplify/auth";
import { z } from "zod";
import { getPublicEnvironment } from "./env";

const timestamp = z.iso.datetime({ offset: true });
const httpsUrl = z.url().refine(value => {
  const url = new URL(value);
  return url.protocol === "https:" && !url.username && !url.password && !url.hash;
}, "A clean HTTPS source address is required.");
const citation = z.object({
  sourceId: z.string().min(1), sourceRegistryVersion: z.number().int().positive(),
  documentId: z.string().min(1), documentVersion: z.number().int().positive(),
  documentSha256: z.string().regex(/^[a-f0-9]{64}$/), publisherName: z.string().min(1),
  documentTitle: z.string().min(1), sourceUrl: httpsUrl, retrievedAt: timestamp,
  publishedAt: z.iso.date().optional(), effectiveFrom: z.iso.date().optional(),
  locator: z.object({ pageNumber: z.number().int().positive().optional(),
    section: z.string().optional(), fragment: z.string().optional(),
    charStart: z.number().int().nonnegative().optional(), charEnd: z.number().int().nonnegative().optional() }),
});
const candidateFact = z.object({
  schemaVersion: z.literal(1), candidateId: z.string().regex(/^CAND#[a-f0-9]{32}$/),
  sourceId: z.string().min(1), documentId: z.string().min(1), documentVersion: z.number().int().positive(),
  chunkId: z.string().min(1), claimKey: z.string().min(1), jurisdiction: z.string().min(2),
  categoryHint: z.string().min(1), quotedText: z.string().min(1).max(1_600), citation,
  amountMentions: z.array(z.string()), dateMentions: z.array(z.string()),
  capacityMentions: z.array(z.string()), verificationStatus: z.literal("UNVERIFIED"),
  reviewStatus: z.literal("PENDING_APPROVAL"), extractedAt: timestamp,
});
const reviewRecord = z.object({
  schemaVersion: z.literal(1), candidate: candidateFact,
  reviewStatus: z.enum(["PENDING_APPROVAL", "APPROVED", "REJECTED"]),
  revision: z.number().int().positive(), detectedAt: timestamp,
  sourceCuratorId: z.string().min(1), detectedBy: z.literal("SYSTEM_CRAWLER"),
  changeStatus: z.string().min(1), conflictFlags: z.array(z.string()),
  reviewedAt: timestamp.optional(), reviewedBy: z.string().optional(), reviewReason: z.string().optional(),
});
const changeAssessment = z.object({
  schemaVersion: z.literal(1), sourceId: z.string().min(1), documentId: z.string().min(1),
  documentVersion: z.number().int().positive(), previousRawSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  currentRawSha256: z.string().regex(/^[a-f0-9]{64}$/),
  previousNormalizedTextSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  currentNormalizedTextSha256: z.string().regex(/^[a-f0-9]{64}$/),
  status: z.enum(["RAW_UNCHANGED", "COSMETIC_ONLY", "INITIAL_REVIEW_REQUIRED", "TEXT_REVIEW_REQUIRED", "MATERIAL_REVIEW_REQUIRED"]),
  reviewStatus: z.enum(["NOT_REQUIRED", "PENDING_APPROVAL"]),
  candidateCount: z.number().int().nonnegative(),
  materialChanges: z.array(z.object({ claimKey: z.string().min(1), kind: z.enum([
    "CLAIM_ADDED", "CLAIM_REMOVED", "CATEGORY_CHANGED", "AMOUNT_TEXT_CHANGED", "DATE_TEXT_CHANGED",
    "CAPACITY_TEXT_CHANGED", "QUOTE_CHANGED",
  ]) })),
});
const changeRecord = z.object({
  schemaVersion: z.literal(1), changeId: z.string().regex(/^CHANGE#[a-f0-9]{32}$/),
  sourceId: z.string().min(1), documentId: z.string().min(1), documentVersion: z.number().int().positive(),
  detectedAt: timestamp, runId: z.string().uuid(), assessment: changeAssessment,
  reviewStatus: z.enum(["PENDING_APPROVAL", "APPROVED", "REJECTED"]), revision: z.number().int().positive(),
  detectedBy: z.literal("SYSTEM_CRAWLER"), sourceCuratorId: z.string().min(1),
  reviewedAt: timestamp.optional(), reviewedBy: z.string().optional(), reviewReason: z.string().optional(),
});
const source = z.object({
  schemaVersion: z.literal(1), sourceId: z.string().min(1), registryVersion: z.number().int().positive(),
  name: z.string().min(1), publisherName: z.string().min(1), jurisdiction: z.string().min(2),
  sourceType: z.string().min(1), canonicalUrl: httpsUrl, authorityTier: z.number().int().min(1).max(4),
  registryStatus: z.enum(["PROPOSED", "CURATED", "SUSPENDED"]),
  healthStatus: z.enum(["UNKNOWN", "HEALTHY", "DEGRADED", "STALE", "FAILED"]),
  crawlFrequency: z.enum(["DAILY", "WEEKLY", "MONTHLY", "ON_DEMAND"]), enabled: z.boolean(),
  freshnessWindowHours: z.number().int().positive(),
  lastCheckedAt: timestamp.optional(), lastChangedAt: timestamp.optional(),
});
const crawlState = z.object({ schemaVersion: z.literal(1), sourceId: z.string().min(1), status: z.enum(["READY", "RUNNING", "ERROR"]),
  lastCheckedAt: timestamp.optional(), lastChangedAt: timestamp.optional(), lastErrorCode: z.string().optional() });
const sourceState = z.object({ sourceId: z.string().min(1), crawlState: crawlState.optional(), sourceFresh: z.boolean(),
  healthStatus: z.enum(["PROPOSED", "DISABLED", "UNCHECKED", "HEALTHY", "STALE", "ERROR"]),
  warnings: z.array(z.string().min(1)).max(20) });
const document = z.object({
  schemaVersion: z.literal(1), documentId: z.string().min(1), version: z.number().int().positive(),
  title: z.string().min(1), canonicalUrl: httpsUrl, sha256: z.string().regex(/^[a-f0-9]{64}$/),
  retrievedAt: timestamp, publishedAt: z.iso.date().optional(), effectiveFrom: z.iso.date().optional(),
});
const auditEvent = z.object({
  schemaVersion: z.literal(1), eventId: z.string().min(1), action: z.string().min(1), occurredAt: timestamp,
  actorId: z.string().min(1), sourceId: z.string().min(1), candidateId: z.string().optional(),
  detailCode: z.string().optional(),
});
const queueResponse = z.object({ schemaVersion: z.literal(1), items: z.array(reviewRecord).max(100),
  changes: z.array(changeRecord).max(100), nextCursor: z.string().optional(), requestId: z.string().min(1) });
const registerableHost = z.object({ host: z.string().regex(/^[a-z0-9.-]+$/), sourceType: z.enum([
  "GOVERNMENT", "MNRE", "SCHEME_PORTAL", "STATE_ENERGY_DEPARTMENT", "DISCOM", "REGULATOR",
  "RENEWABLE_AGENCY", "OFFICIAL_NOTIFICATION", "GOVERNMENT_TECHNICAL", "OFFICIAL_INSTITUTION",
]), jurisdiction: z.string().regex(/^[A-Z]{2}(?:-[A-Z0-9]{1,8}){0,3}$/) });
const sourceListResponse = z.object({ schemaVersion: z.literal(1), sources: z.array(source).max(50),
  sourceStates: z.array(sourceState).max(50), hostRegistryVersion: z.literal(1),
  registerableHosts: z.array(registerableHost).max(50),
  nextCursor: z.string().min(1).optional(), requestId: z.string().min(1) });
const sourceRegisterResponse = z.object({ source, created: z.boolean(), requestId: z.string().min(1) });
const detailResponse = z.object({ candidate: reviewRecord, source, document,
  crawlState: crawlState.optional(),
  sourceFresh: z.boolean(), sourceHealthStatus: sourceState.shape.healthStatus,
  sourceWarnings: z.array(z.string().min(1)).max(20), audit: z.array(auditEvent), requestId: z.string().min(1) });
const changeDetailResponse = z.object({ schemaVersion: z.literal(1), change: changeRecord, source, document,
  crawlState: crawlState.optional(),
  sourceFresh: z.boolean(), sourceHealthStatus: sourceState.shape.healthStatus,
  sourceWarnings: z.array(z.string().min(1)).max(20), textPreview: z.string().max(4_000).optional(),
  textTruncated: z.boolean().optional(), previousTextPreview: z.string().max(4_000).optional(),
  previousTextTruncated: z.boolean().optional(), audit: z.array(auditEvent), requestId: z.string().min(1) });
const reviewResponse = z.object({ candidate: reviewRecord, requestId: z.string().min(1) });
const changeReviewResponse = z.object({ schemaVersion: z.literal(1), change: changeRecord, requestId: z.string().min(1) });
const curateResponse = z.object({ source, createdVersion: z.number().int().positive(), requestId: z.string().min(1) });
const crawlResponse = z.object({ schemaVersion: z.literal(1), queued: z.boolean(), dueAt: timestamp,
  requestId: z.string().min(1) });

export type PolicyReviewRecord = z.infer<typeof reviewRecord>;
export type PolicyChangeRecord = z.infer<typeof changeRecord>;
export type PolicyReviewSource = z.infer<typeof source>;
export type PolicyReviewSourceState = z.infer<typeof sourceState>;
export type PolicyRegisterableHost = z.infer<typeof sourceListResponse>["registerableHosts"][number];
export type PolicyReviewDetail = z.infer<typeof detailResponse>;
export type PolicyChangeDetail = z.infer<typeof changeDetailResponse>;
export interface RegisterPolicySourceInput { name: string; publisherName: string; jurisdiction: string;
  sourceType: "GOVERNMENT" | "MNRE" | "SCHEME_PORTAL" | "STATE_ENERGY_DEPARTMENT" | "DISCOM" | "REGULATOR" |
    "RENEWABLE_AGENCY" | "OFFICIAL_NOTIFICATION" | "GOVERNMENT_TECHNICAL" | "OFFICIAL_INSTITUTION";
  canonicalUrl: string; crawlFrequency: "DAILY" | "WEEKLY" | "MONTHLY" | "ON_DEMAND";
  freshnessWindowHours: number; }

export class PolicyReviewError extends Error {
  constructor(public readonly code: string, message: string) { super(message); }
}

function endpoint(path: string): string {
  const base = getPublicEnvironment().NEXT_PUBLIC_API_BASE_URL;
  if (!base) throw new PolicyReviewError("API_NOT_CONFIGURED", "Policy review is not connected in this deployment.");
  const url = new URL(base);
  if (url.search || url.hash || url.username || url.password) throw new PolicyReviewError("API_NOT_CONFIGURED", "The policy API address is invalid.");
  const [pathname, search] = path.split("?", 2);
  url.pathname = `${url.pathname.replace(/\/+$/, "")}${pathname}`;
  if (search) url.search = search;
  return url.toString();
}

function sameHost(left: string, right: string): boolean {
  return new URL(left).host === new URL(right).host;
}

async function request<T>(expectedUserId: string, path: string, method: "GET" | "POST",
  schema: z.ZodType<T>, body?: unknown, signal?: AbortSignal, timeoutMs = 10_000): Promise<T> {
  const url = endpoint(path);
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal?.addEventListener("abort", cancel, { once: true });
  if (signal?.aborted) controller.abort();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  try {
    if (controller.signal.aborted) throw new PolicyReviewError("CANCELLED", "The request was cancelled.");
    const session = await fetchAuthSession();
    if (controller.signal.aborted) throw new PolicyReviewError("CANCELLED", "The request was cancelled.");
    const access = session.tokens?.accessToken;
    const groups = access?.payload["cognito:groups"];
    if (access?.payload.sub !== expectedUserId || access.payload.token_use !== "access" ||
      !Array.isArray(groups) || !groups.some(group => group === "ADMIN_POLICY" || group === "ADMIN")) {
      throw new PolicyReviewError("POLICY_ADMIN_REQUIRED", "A policy administrator account is required.");
    }
    const response = await fetch(url, { method,
      headers: { authorization: `Bearer ${access.toString()}`, accept: "application/json",
        ...(method === "POST" ? { "content-type": "application/json" } : {}) },
      ...(method === "POST" ? { body: JSON.stringify(body ?? {}) } : {}),
      credentials: "omit", cache: "no-store", redirect: "error", signal: controller.signal });
    if (response.status === 401 || response.status === 403) {
      throw new PolicyReviewError("POLICY_ADMIN_REQUIRED", "Your policy review access could not be verified. Sign in again.");
    }
    let payload: unknown;
    try { payload = await response.json(); }
    catch { throw new PolicyReviewError("INVALID_RESPONSE", "The policy service returned an unreadable response."); }
    if (!response.ok) {
      const error = z.object({ error: z.object({ code: z.string(), message: z.string() }) }).safeParse(payload);
      throw new PolicyReviewError(error.success ? error.data.error.code : "SERVICE_UNAVAILABLE",
        error.success ? error.data.error.message : "The policy service is unavailable. Try again.");
    }
    const parsed = schema.safeParse(payload);
    if (!parsed.success) throw new PolicyReviewError("INVALID_RESPONSE", "The policy service returned unexpected data.");
    return parsed.data;
  } catch (error) {
    if (timedOut) throw new PolicyReviewError("TIMEOUT", "The policy request took too long. Try again.");
    if (controller.signal.aborted) throw new PolicyReviewError("CANCELLED", "The request was cancelled.");
    if (error instanceof PolicyReviewError) throw error;
    throw new PolicyReviewError("SERVICE_UNAVAILABLE", "The policy service could not be reached. Check your connection and try again.");
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", cancel);
  }
}

export { request as policyReviewRequest };

export const policyReviewApi = {
  queue: (userId: string, signal?: AbortSignal, cursor?: string) => request(userId,
    `/admin/policy/queue?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
    "GET", queueResponse, undefined, signal),
  sources: (userId: string, signal?: AbortSignal, cursor?: string) => request(userId,
    `/admin/policy/sources?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
    "GET", sourceListResponse, undefined, signal),
  registerSource: (userId: string, input: RegisterPolicySourceInput, signal?: AbortSignal) => request(userId,
    "/admin/policy/sources", "POST", sourceRegisterResponse, input, signal),
  detail: (userId: string, candidateId: string, signal?: AbortSignal) => request(userId,
    `/admin/policy/candidates/${encodeURIComponent(candidateId)}`, "GET", detailResponse, undefined, signal)
    .then(result => {
      if (result.candidate.candidate.candidateId !== candidateId ||
        result.candidate.candidate.sourceId !== result.source.sourceId ||
        result.candidate.candidate.documentId !== result.document.documentId ||
        result.candidate.candidate.documentVersion !== result.document.version ||
        result.candidate.candidate.citation.documentSha256 !== result.document.sha256 ||
        result.candidate.candidate.citation.sourceId !== result.source.sourceId ||
        result.candidate.candidate.citation.documentId !== result.document.documentId ||
        result.candidate.candidate.citation.documentVersion !== result.document.version ||
        result.candidate.candidate.citation.sourceUrl !== result.document.canonicalUrl ||
        result.candidate.candidate.citation.publisherName !== result.source.publisherName ||
        result.candidate.candidate.citation.documentTitle !== result.document.title ||
        result.candidate.candidate.citation.retrievedAt !== result.document.retrievedAt ||
        !sameHost(result.document.canonicalUrl, result.source.canonicalUrl)) {
        throw new PolicyReviewError("INVALID_RESPONSE", "The policy service returned mismatched evidence.");
      }
      return result;
    }),
  review: (userId: string, candidateId: string, decision: "approve" | "reject", expectedRevision: number,
    reason: string, signal?: AbortSignal) => request(userId,
    `/admin/policy/candidates/${encodeURIComponent(candidateId)}/${decision}`, "POST", reviewResponse,
    { expectedRevision, reason }, signal).then(result => {
      if (result.candidate.candidate.candidateId !== candidateId) {
        throw new PolicyReviewError("INVALID_RESPONSE", "The policy service returned mismatched evidence.");
      }
      return result;
    }),
  changeDetail: (userId: string, changeId: string, signal?: AbortSignal) => request(userId,
    `/admin/policy/changes/${encodeURIComponent(changeId)}`, "GET", changeDetailResponse, undefined, signal)
    .then(result => {
      if (result.change.changeId !== changeId || result.change.sourceId !== result.source.sourceId ||
        result.change.documentId !== result.document.documentId ||
        result.change.documentVersion !== result.document.version ||
        result.change.assessment.currentRawSha256 !== result.document.sha256 ||
        !sameHost(result.document.canonicalUrl, result.source.canonicalUrl)) {
        throw new PolicyReviewError("INVALID_RESPONSE", "The policy service returned mismatched document evidence.");
      }
      return result;
    }),
  changeReview: (userId: string, changeId: string, decision: "approve" | "reject", expectedRevision: number,
    reason: string, signal?: AbortSignal) => request(userId,
    `/admin/policy/changes/${encodeURIComponent(changeId)}/${decision}`, "POST", changeReviewResponse,
    { expectedRevision, reason }, signal).then(result => {
      if (result.change.changeId !== changeId) {
        throw new PolicyReviewError("INVALID_RESPONSE", "The policy service returned mismatched document evidence.");
      }
      return result;
    }),
  curate: (userId: string, sourceId: string, expectedRegistryVersion: number, signal?: AbortSignal) =>
    request(userId, "/admin/policy/sources/curate", "POST", curateResponse,
      { sourceId, expectedRegistryVersion }, signal),
  crawl: (userId: string, sourceId: string, rateLimitClearanceReason?: string, signal?: AbortSignal) =>
    request(userId, "/admin/policy/sources/crawl", "POST", crawlResponse,
      { sourceId, ...(rateLimitClearanceReason ? { rateLimitClearanceReason } : {}) }, signal),
};
