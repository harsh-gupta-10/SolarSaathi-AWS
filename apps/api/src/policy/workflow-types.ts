import type { PolicyCandidateFactV1, PolicyChangeAssessmentV1 } from "@solarsaathi/policy";

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
