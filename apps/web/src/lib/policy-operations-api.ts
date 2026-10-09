import { z } from "zod";
import { policyReviewRequest, PolicyReviewError } from "./policy-review-api";

const timestamp = z.iso.datetime({ offset: true });
const date = z.iso.date();
const httpsUrl = z.url().refine(value => { const url = new URL(value);
  return url.protocol === "https:" && !url.username && !url.password && !url.hash; });
const page = { schemaVersion: z.literal(1), requestId: z.string().min(1), nextCursor: z.string().min(1).optional() };
const run = z.object({ schemaVersion: z.literal(1), runId: z.string().min(1), startedAt: timestamp,
  finishedAt: timestamp, status: z.enum(["COMPLETED", "PARTIAL", "FAILED"]),
  checked: z.number().int().nonnegative(), changed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(), skipped: z.number().int().nonnegative(), backlog: z.boolean(),
  sourceOutcomes: z.array(z.object({ sourceId: z.string().min(1),
    outcome: z.enum(["CHANGED", "UNCHANGED", "SKIPPED", "FAILED"]) })).max(200) });
const conflict = z.object({ candidateId: z.string().min(1), sourceId: z.string().min(1),
  jurisdiction: z.string().min(2), categoryHint: z.string().min(1), claimKey: z.string().min(1),
  detectedAt: timestamp, reviewStatus: z.literal("PENDING_APPROVAL"), resolutionStatus: z.literal("UNRESOLVED"),
  flags: z.array(z.string().min(1)).min(1).max(30) });
const active = z.object({ policyId: z.string().min(1), benefitId: z.string().min(1), version: z.number().int().positive(),
  scope: z.string().min(1), jurisdiction: z.string().min(2), effectiveFrom: date, effectiveTo: date.optional(),
  activatedAt: timestamp, sourceId: z.string().min(1), sourceUrl: httpsUrl,
  lastCheckedAt: timestamp.nullable(), sourceFresh: z.boolean() });
const version = z.object({ version: z.number().int().positive(), isCurrent: z.boolean(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/), effectiveFrom: date, effectiveTo: date.optional(),
  verifiedAt: timestamp, activatedAt: timestamp, sourceId: z.string().min(1), sourceUrl: httpsUrl,
  verificationStatus: z.literal("VERIFIED") });
const rule = z.object({ scope: z.string().min(1), jurisdiction: z.string().min(2),
  effectiveFrom: date, effectiveTo: date.optional(), amount: z.object({ kind: z.string().min(1) }).passthrough(),
  capPaise: z.number().int().nonnegative().optional(), minSystemWatts: z.number().int().nonnegative().optional(),
  maxSystemWatts: z.number().int().nonnegative().optional(), combinedCapPaise: z.number().int().nonnegative().optional(),
  overlapGroupId: z.string().optional(), combinedCapGroupId: z.string().optional(),
  compatibility: z.array(z.unknown()), eligibility: z.object({ allOf: z.array(z.unknown()), anyOf: z.array(z.unknown()) }),
  processSteps: z.array(z.unknown()).optional() }).passthrough();
const bundle = z.object({ schemaVersion: z.literal(1), policyId: z.string().min(1), benefitId: z.string().min(1),
  version: z.object({ version: z.number().int().positive(), contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    effectiveFrom: date, effectiveTo: date.optional(), verificationStatus: z.literal("VERIFIED"),
    documentRefs: z.array(z.object({ sourceId: z.string().min(1), documentId: z.string().min(1),
      documentVersion: z.number().int().positive(), sha256: z.string().regex(/^[a-f0-9]{64}$/) })) }).passthrough(),
  facts: z.array(z.object({ factId: z.string().min(1), citation: z.object({ sourceUrl: httpsUrl,
    publisherName: z.string().min(1), retrievedAt: timestamp }).passthrough() }).passthrough()),
  rule, activatedAt: timestamp });
const rollback = z.object({ schemaVersion: z.literal(1), rollbackId: z.string().min(1),
  policyId: z.string().min(1), targetVersion: z.number().int().positive(),
  expectedActiveVersion: z.number().int().positive(), status: z.enum(["PENDING_APPROVAL", "APPROVED", "REJECTED"]),
  revision: z.number().int().positive(), requestedAt: timestamp, requestedBy: z.string().min(1),
  requestReason: z.string().min(10), targetSourceId: z.string().min(1),
  targetSourceCuratorId: z.string().min(1), targetVersionAuthorId: z.string().min(1),
  reviewedAt: timestamp.optional(), reviewedBy: z.string().optional(), reviewReason: z.string().optional(),
  activatedVersion: z.number().int().positive().optional() });
const runsResponse = z.object({ ...page, runs: z.array(run).max(50) });
const conflictsResponse = z.object({ ...page, conflicts: z.array(conflict).max(50) });
const activeResponse = z.object({ ...page, jurisdiction: z.string().min(2), items: z.array(active).max(50),
  hasMore: z.boolean() }).refine(value => value.hasMore === !!value.nextCursor);
const versionsResponse = z.object({ ...page, policyId: z.string().min(1), currentVersion: z.number().int().positive().nullable(),
  items: z.array(version).max(50), hasMore: z.boolean() }).refine(value => value.hasMore === !!value.nextCursor);
const versionDetailResponse = z.object({ schemaVersion: z.literal(1), policyId: z.string().min(1),
  currentVersion: z.number().int().positive().nullable(), isCurrent: z.boolean(), bundle,
  sourceFresh: z.boolean(), targetDocumentCurrent: z.boolean(),
  lastCheckedAt: timestamp.nullable(), requestId: z.string().min(1) });
const rollbackResponse = z.object({ schemaVersion: z.literal(1), rollback, requestId: z.string().min(1) });
const rollbackQueueResponse = z.object({ ...page, items: z.array(rollback).max(50), hasMore: z.boolean() })
  .refine(value => value.hasMore === !!value.nextCursor);
const rollbackDetailResponse = z.object({ schemaVersion: z.literal(1), rollback,
  currentVersion: z.number().int().positive().nullable(), sourceFresh: z.boolean(), targetDocumentCurrent: z.boolean(),
  lastCheckedAt: timestamp.nullable(), requestId: z.string().min(1) });
const rollbackTransitionResponse = rollbackResponse.extend({ publishedVersion: z.object({ version: z.number().int().positive() }).passthrough().optional() });

export type PolicyCrawlerRun = z.infer<typeof run>;
export type PolicyConflict = z.infer<typeof conflict>;
export type ActivePolicySummary = z.infer<typeof active>;
export type PolicyVersionSummary = z.infer<typeof version>;
export type PolicyVersionDetail = z.infer<typeof versionDetailResponse>;
export type PolicyRollback = z.infer<typeof rollback>;

const cursorQuery = (cursor?: string) => cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
function checkedId(actual: string, expected: string) {
  if (actual !== expected) throw new PolicyReviewError("INVALID_RESPONSE", "The policy service returned a different record.");
}
export const policyOperationsApi = {
  runs: (userId: string, signal?: AbortSignal, cursor?: string) => policyReviewRequest(userId,
    `/admin/policy/crawler-runs?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
    "GET", runsResponse, undefined, signal),
  conflicts: (userId: string, signal?: AbortSignal, cursor?: string) => policyReviewRequest(userId,
    `/admin/policy/conflicts?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
    "GET", conflictsResponse, undefined, signal),
  active: (userId: string, jurisdiction: string, signal?: AbortSignal, cursor?: string) => policyReviewRequest(userId,
    `/admin/policy/benefits/active?jurisdiction=${encodeURIComponent(jurisdiction)}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
    "GET", activeResponse, undefined, signal).then(value => { checkedId(value.jurisdiction, jurisdiction); return value; }),
  versions: (userId: string, policyId: string, signal?: AbortSignal, cursor?: string) => policyReviewRequest(userId,
    `/admin/policy/benefits/versions/${encodeURIComponent(policyId)}${cursorQuery(cursor)}`,
    "GET", versionsResponse, undefined, signal).then(value => { checkedId(value.policyId, policyId); return value; }),
  version: (userId: string, policyId: string, number: number, signal?: AbortSignal) => policyReviewRequest(userId,
    `/admin/policy/benefits/versions/${encodeURIComponent(policyId)}/${number}`,
    "GET", versionDetailResponse, undefined, signal).then(value => {
    checkedId(value.policyId, policyId); checkedId(value.bundle.policyId, policyId);
    if (value.bundle.version.version !== number) throw new PolicyReviewError("INVALID_RESPONSE", "The policy service returned a different version.");
    return value;
  }),
  requestRollback: (userId: string, input: { policyId: string; targetVersion: number;
    expectedActiveVersion: number; reason: string }, signal?: AbortSignal) => policyReviewRequest(userId,
    "/admin/policy/benefits/rollbacks", "POST", rollbackResponse, input, signal, 25_000),
  rollbackQueue: (userId: string, signal?: AbortSignal, cursor?: string) => policyReviewRequest(userId,
    `/admin/policy/benefits/rollbacks/queue${cursorQuery(cursor)}`,
    "GET", rollbackQueueResponse, undefined, signal),
  rollbackDetail: (userId: string, rollbackId: string, signal?: AbortSignal) => policyReviewRequest(userId,
    `/admin/policy/benefits/rollbacks/${encodeURIComponent(rollbackId)}`,
    "GET", rollbackDetailResponse, undefined, signal).then(value => { checkedId(value.rollback.rollbackId, rollbackId); return value; }),
  reviewRollback: (userId: string, rollbackId: string, action: "approve" | "reject", expectedRevision: number,
    reason: string, signal?: AbortSignal) => policyReviewRequest(userId,
    `/admin/policy/benefits/rollbacks/${encodeURIComponent(rollbackId)}/${action}`,
    "POST", rollbackTransitionResponse, { expectedRevision, reason }, signal, 25_000).then(value => {
    checkedId(value.rollback.rollbackId, rollbackId); return value;
  }),
};
