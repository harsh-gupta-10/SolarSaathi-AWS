import { z } from "zod";
import { policyReviewRequest } from "./policy-review-api";

const timestamp = z.iso.datetime({ offset: true });
const httpsUrl = z.url().refine(value => {
  const url = new URL(value);
  return url.protocol === "https:" && !url.username && !url.password && !url.hash;
});
const citation = z.object({
  schemaVersion: z.literal(1), sourceId: z.string().min(1), sourceRegistryVersion: z.number().int().positive(),
  documentId: z.string().min(1), documentVersion: z.number().int().positive(),
  documentSha256: z.string().regex(/^[a-f0-9]{64}$/), publisherName: z.string().min(1),
  documentTitle: z.string().min(1), sourceUrl: httpsUrl, retrievedAt: timestamp,
  publishedAt: z.iso.date().optional(), effectiveFrom: z.iso.date().optional(),
  locator: z.object({ pageNumber: z.number().int().positive().optional(), section: z.string().optional(),
    fragment: z.string().optional(), charStart: z.number().int().nonnegative().optional(),
    charEnd: z.number().int().nonnegative().optional() }),
});
const rule = z.object({
  schemaVersion: z.literal(1), ruleId: z.string().min(1), benefitId: z.string().min(1),
  policyId: z.string().min(1), policyVersion: z.number().int().positive(),
  factIds: z.array(z.string().min(1)).min(1), scope: z.enum(["CENTRAL", "STATE", "DISCOM", "LOCAL", "OTHER"]),
  jurisdiction: z.string().min(2), effectiveFrom: z.iso.date(), effectiveTo: z.iso.date().optional(),
  amount: z.object({ kind: z.enum(["FIXED", "PER_KW", "TIERED_KW", "PERCENT_ELIGIBLE_COST"]) }).passthrough(),
  capPaise: z.number().int().nonnegative().optional(), minSystemWatts: z.number().int().nonnegative().optional(),
  maxSystemWatts: z.number().int().nonnegative().optional(),
  eligibility: z.object({ allOf: z.array(z.unknown()), anyOf: z.array(z.array(z.unknown())) }),
  compatibility: z.array(z.unknown()), overlapGroupId: z.string().optional(),
  combinedCapGroupId: z.string().optional(), combinedCapPaise: z.number().int().nonnegative().optional(),
});
const draftSchema = z.object({ schemaVersion: z.literal(1), draftId: z.string().min(1),
  policyId: z.string().min(1), benefitId: z.string().min(1), version: z.number().int().positive(),
  status: z.enum(["DRAFT", "PENDING_APPROVAL", "PUBLISHED", "REJECTED"]),
  revision: z.number().int().positive(), createdAt: timestamp, authoredBy: z.string().min(1),
  sourceCuratorId: z.string().min(1), citation, quotedEvidence: z.string().min(1),
  clauseEvidence: z.array(z.object({ clauseKey: z.string().min(1), quotedEvidence: z.string().min(1), citation })).min(1).max(50), rule,
  submittedAt: timestamp.optional(), reviewedAt: timestamp.optional(), reviewedBy: z.string().optional(),
  reviewReason: z.string().optional(),
});
const queue = z.object({ schemaVersion: z.literal(1), items: z.array(draftSchema).max(20),
  hasMore: z.boolean(), nextCursor: z.string().min(1).optional(), requestId: z.string().min(1) })
  .refine(value => value.hasMore === !!value.nextCursor);
const detail = z.object({ schemaVersion: z.literal(1), draft: draftSchema,
  source: z.object({ sourceId: z.string().min(1), publisherName: z.string().min(1),
    registryStatus: z.string().min(1), registryVersion: z.number().int().positive(),
    canonicalUrl: httpsUrl, freshnessWindowHours: z.number().int().positive() }).passthrough(),
  document: z.object({ documentId: z.string().min(1), version: z.number().int().positive(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/), title: z.string().min(1), canonicalUrl: httpsUrl }).passthrough(),
  crawlState: z.object({ lastCheckedAt: timestamp.optional() }).passthrough().optional(),
  sourceFresh: z.boolean(), requestId: z.string().min(1),
}).superRefine((value, context) => {
  if (value.draft.citation.sourceId !== value.source.sourceId ||
    value.draft.citation.documentId !== value.document.documentId ||
    value.draft.citation.documentVersion !== value.document.version ||
    value.draft.citation.documentSha256 !== value.document.sha256 ||
    value.draft.citation.sourceUrl !== value.document.canonicalUrl ||
    new URL(value.source.canonicalUrl).host !== new URL(value.document.canonicalUrl).host) {
    context.addIssue({ code: "custom", path: ["draft", "citation"], message: "Draft evidence mismatch." });
  }
});
const createResponse = z.object({ schemaVersion: z.literal(1), draft: draftSchema, requestId: z.string().min(1) });
const transitionResponse = z.object({ schemaVersion: z.literal(1), draft: draftSchema, requestId: z.string().min(1),
  publishedVersion: z.object({ version: z.number().int().positive(), status: z.literal("ACTIVE") }).passthrough().optional() });

export type PolicyPublicationDraft = z.infer<typeof draftSchema>;
export type PolicyPublicationDetail = z.infer<typeof detail>;
export interface CreatePublicationDraft {
  benefitId: string;
  sourceId: string;
  documentId: string;
  documentVersion: number;
  locator: { charStart: number; charEnd: number; pageNumber?: number; section?: string; fragment?: string };
  quotedEvidence: string;
  rule: unknown;
  clauseEvidence: Array<{ clauseKey: string;
    locator: { charStart: number; charEnd: number; pageNumber?: number; section?: string; fragment?: string };
    quotedEvidence: string }>;
}

export const policyPublicationApi = {
  queue: (userId: string, signal?: AbortSignal, cursor?: string) => policyReviewRequest(userId,
    `/admin/policy/benefits/queue${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
    "GET", queue, undefined, signal),
  detail: (userId: string, draftId: string, signal?: AbortSignal) => policyReviewRequest(userId,
    `/admin/policy/benefits/${encodeURIComponent(draftId)}`, "GET", detail, undefined, signal),
  create: (userId: string, input: CreatePublicationDraft, signal?: AbortSignal) => policyReviewRequest(userId,
    "/admin/policy/benefits/drafts", "POST", createResponse, input, signal, 25_000),
  transition: (userId: string, draftId: string, action: "submit" | "publish" | "reject",
    expectedRevision: number, reason?: string, signal?: AbortSignal) => policyReviewRequest(userId,
    `/admin/policy/benefits/${encodeURIComponent(draftId)}/${action}`, "POST", transitionResponse,
    { expectedRevision, ...(reason ? { reason } : {}) }, signal, action === "publish" ? 25_000 : 10_000),
};
