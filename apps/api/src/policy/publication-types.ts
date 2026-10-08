import type { PolicyBenefitRuleV1, PolicyCitationV1, PolicyFactV1, PolicyVersionV1 } from "@solarsaathi/policy";

export interface PolicyPublicationDraftV1 {
  schemaVersion: 1;
  draftId: string;
  policyId: string;
  benefitId: string;
  version: number;
  status: "DRAFT" | "PENDING_APPROVAL" | "PUBLISHED" | "REJECTED";
  revision: number;
  createdAt: string;
  authoredBy: string;
  sourceCuratorId: string;
  citation: PolicyCitationV1;
  quotedEvidence: string;
  clauseEvidence: Array<{ clauseKey: string; quotedEvidence: string; citation: PolicyCitationV1 }>;
  rule: PolicyBenefitRuleV1;
  submittedAt?: string;
  reviewedAt?: string;
  reviewedBy?: string;
  reviewReason?: string;
}

export interface ActivePolicyBundleV1 {
  schemaVersion: 1;
  policyId: string;
  benefitId: string;
  version: PolicyVersionV1;
  facts: PolicyFactV1[];
  rule: PolicyBenefitRuleV1;
  activatedAt: string;
}

export interface PublicationAuditV1 {
  schemaVersion: 1;
  eventId: string;
  draftId: string;
  policyId: string;
  action: "DRAFT_CREATED" | "DRAFT_SUBMITTED" | "DRAFT_PUBLISHED" | "DRAFT_REJECTED";
  actorId: string;
  occurredAt: string;
  reason?: string;
  precedenceDecision?: "SAME_SOURCE" | "REVIEWED_OFFICIAL_REPLACEMENT";
  precedenceReasonCode?: string;
  supersededSourceId?: string;
  supersededSourceAuthorityTier?: number;
  replacementSourceAuthorityTier?: number;
}
