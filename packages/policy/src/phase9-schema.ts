import { z } from "zod";
import { policyCategorySchema, policyCitationSchema, policyJurisdictionSchema } from "./schema";

const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const sourceId = z.string().regex(/^SRC#[A-Za-z0-9][A-Za-z0-9#_-]{0,127}$/);
const documentId = z.string().regex(/^DOC#[A-Za-z0-9][A-Za-z0-9#_-]{0,127}$/);
const chunkId = z.string().regex(/^CHUNK#[A-Za-z0-9][A-Za-z0-9#_-]{0,127}$/);

export const policyCandidateFactSchema = z.object({
  schemaVersion: z.literal(1), candidateId: z.string().regex(/^CAND#[a-f0-9]{32}$/),
  sourceId, documentId, documentVersion: z.number().int().positive(), chunkId,
  claimKey: z.string().regex(/^claim\.[a-f0-9]{32}$/),
  jurisdiction: policyJurisdictionSchema, categoryHint: policyCategorySchema,
  quotedText: z.string().min(1).max(1_600), citation: policyCitationSchema,
  amountMentions: z.array(z.string().min(1).max(80)).max(20),
  dateMentions: z.array(z.string().min(1).max(80)).max(20),
  capacityMentions: z.array(z.string().min(1).max(80)).max(20),
  verificationStatus: z.literal("UNVERIFIED"), reviewStatus: z.literal("PENDING_APPROVAL"),
  extractedAt: z.iso.datetime({ offset: true }),
}).strict();

export const policyChangeStatusSchema = z.enum([
  "RAW_UNCHANGED", "COSMETIC_ONLY", "INITIAL_REVIEW_REQUIRED", "TEXT_REVIEW_REQUIRED", "MATERIAL_REVIEW_REQUIRED",
]);
export const policyMaterialChangeKindSchema = z.enum([
  "CLAIM_ADDED", "CLAIM_REMOVED", "CATEGORY_CHANGED", "AMOUNT_TEXT_CHANGED", "DATE_TEXT_CHANGED",
  "CAPACITY_TEXT_CHANGED", "QUOTE_CHANGED",
]);
export const policyChangeAssessmentSchema = z.object({
  schemaVersion: z.literal(1), sourceId, documentId, documentVersion: z.number().int().positive(),
  previousRawSha256: sha256.optional(), currentRawSha256: sha256,
  previousNormalizedTextSha256: sha256.optional(), currentNormalizedTextSha256: sha256,
  status: policyChangeStatusSchema, reviewStatus: z.enum(["NOT_REQUIRED", "PENDING_APPROVAL"]),
  candidateCount: z.number().int().nonnegative().max(1_000),
  materialChanges: z.array(z.object({ claimKey: z.string().regex(/^claim\.[a-f0-9]{32}$/),
    kind: policyMaterialChangeKindSchema }).strict()).max(2_000),
}).strict();

export const policyCandidateConflictSchema = z.object({
  schemaVersion: z.literal(1), candidateId: z.string().regex(/^CAND#[a-f0-9]{32}$/),
  status: z.enum(["NO_MATCHING_CURRENT", "MATCHES_CURRENT_VALUE", "POTENTIAL_POLICY_CONFLICT"]),
  matchedVerifiedFactIds: z.array(z.string().regex(/^FACT#[A-Za-z0-9][A-Za-z0-9#_-]{0,127}$/)).max(500),
  reviewStatus: z.literal("PENDING_APPROVAL"),
}).strict();

export const policyCrawlerAuditEventSchema = z.object({
  schemaVersion: z.literal(1), eventId: z.string().uuid(), runId: z.string().uuid(), sourceId,
  documentId: documentId.optional(), documentVersion: z.number().int().positive().optional(),
  eventType: z.enum(["SOURCE_CHECK", "FETCH", "INGEST", "CHANGE_ASSESSMENT", "CANDIDATE_QUEUED", "CONFLICT_FLAGGED"]),
  outcome: z.enum(["SUCCESS", "NOT_MODIFIED", "REVIEW_REQUIRED", "FAILED"]),
  occurredAt: z.iso.datetime({ offset: true }),
  rawSha256: sha256.optional(), normalizedTextSha256: sha256.optional(),
  changeStatus: policyChangeStatusSchema.optional(), candidateCount: z.number().int().nonnegative().optional(),
  errorCode: z.enum(["FETCH_FAILED", "INGEST_FAILED", "VALIDATION_FAILED", "STORAGE_FAILED", "UNKNOWN"]).optional(),
}).strict().superRefine((event, context) => {
  if (event.outcome === "FAILED" && !event.errorCode) {
    context.addIssue({ code: "custom", path: ["errorCode"], message: "Failed audits require a bounded error code." });
  }
  if (event.outcome !== "FAILED" && event.errorCode) {
    context.addIssue({ code: "custom", path: ["errorCode"], message: "Only failed audits may carry an error code." });
  }
});

export type PolicyCandidateFactV1 = z.infer<typeof policyCandidateFactSchema>;
export type PolicyChangeStatusV1 = z.infer<typeof policyChangeStatusSchema>;
export type PolicyMaterialChangeKindV1 = z.infer<typeof policyMaterialChangeKindSchema>;
export type PolicyChangeAssessmentV1 = z.infer<typeof policyChangeAssessmentSchema>;
export type PolicyCandidateConflictV1 = z.infer<typeof policyCandidateConflictSchema>;
export type PolicyCrawlerAuditEventV1 = z.infer<typeof policyCrawlerAuditEventSchema>;
