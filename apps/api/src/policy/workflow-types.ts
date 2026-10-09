import type { PolicyCandidateFactV1, PolicyChangeAssessmentV1 } from "@solarsaathi/policy";
import { z } from "zod";

export const policyCrawlerRunSchema = z.strictObject({
  schemaVersion: z.literal(1), runId: z.uuid(),
  startedAt: z.iso.datetime({ offset: true }), finishedAt: z.iso.datetime({ offset: true }),
  status: z.enum(["COMPLETED", "PARTIAL", "FAILED"]),
  checked: z.number().int().nonnegative().max(10), changed: z.number().int().nonnegative().max(10),
  failed: z.number().int().nonnegative().max(10), skipped: z.number().int().nonnegative().max(10),
  backlog: z.boolean(),
  sourceOutcomes: z.array(z.strictObject({ sourceId: z.string().regex(/^SRC#[a-f0-9]{32}$/),
    outcome: z.enum(["CHANGED", "UNCHANGED", "SKIPPED", "FAILED"]) })).max(10),
  errorCode: z.enum(["SOURCE_LIST_FAILED"]).optional(),
});

export type PolicyCrawlerRunV1 = z.infer<typeof policyCrawlerRunSchema>;

export interface PolicyCrawlStateV1 {
  schemaVersion: 1;
  sourceId: string;
  revision: number;
  status: "READY" | "RUNNING" | "ERROR";
  nextDueAtEpochSeconds: number;
  lastCheckedAt?: string;
  lastChangedAt?: string;
  lastObservedSha256?: string;
  lastNormalizedTextSha256?: string;
  lastDocumentId?: string;
  lastDocumentVersion?: number;
  etag?: string;
  lastModified?: string;
  lastErrorCode?: string;
  failureCount: number;
}

export interface PolicyReviewRecordV1 {
  schemaVersion: 1;
  candidate: PolicyCandidateFactV1;
  reviewStatus: "PENDING_APPROVAL" | "APPROVED" | "REJECTED";
  revision: number;
  detectedAt: string;
  detectedBy: "SYSTEM_CRAWLER";
  sourceCuratorId: string;
  changeStatus: PolicyChangeAssessmentV1["status"];
  conflictFlags: string[];
  reviewedAt?: string;
  reviewedBy?: string;
  reviewReason?: string;
}

export interface PolicyChangeRecordV1 {
  schemaVersion: 1;
  changeId: string;
  sourceId: string;
  documentId: string;
  documentVersion: number;
  detectedAt: string;
  runId: string;
  assessment: PolicyChangeAssessmentV1;
  reviewStatus: "PENDING_APPROVAL" | "APPROVED" | "REJECTED";
  revision: number;
  detectedBy: "SYSTEM_CRAWLER";
  sourceCuratorId: string;
  reviewedAt?: string;
  reviewedBy?: string;
  reviewReason?: string;
}

export interface PolicyWorkflowAuditV1 {
  schemaVersion: 1;
  eventId: string;
  actorId: string;
  action: "SOURCE_CURATED" | "CRAWL_QUEUED" | "CRAWL_STARTED" | "CRAWL_CHECKED" | "CRAWL_FAILED" | "DOCUMENT_CHANGED" | "EVIDENCE_APPROVED" | "EVIDENCE_REJECTED" | "CHANGE_APPROVED" | "CHANGE_REJECTED";
  occurredAt: string;
  sourceId: string;
  candidateId?: string;
  changeId?: string;
  runId?: string;
  detailCode?: string;
}
