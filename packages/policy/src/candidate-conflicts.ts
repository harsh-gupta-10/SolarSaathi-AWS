import { isPolicyEvidencePublishable, type PolicyEvidenceV1 } from "./precedence";
import { policyCandidateConflictSchema, policyCandidateFactSchema,
  type PolicyCandidateConflictV1, type PolicyCandidateFactV1 } from "./phase9-schema";

function equivalentText(left: string, right: string): boolean {
  return left.normalize("NFC").replace(/\s+/gu, " ").trim().toLowerCase() ===
    right.normalize("NFC").replace(/\s+/gu, " ").trim().toLowerCase();
}

/** Candidates only flag possible conflicts; this does not verify, supersede or activate a fact. */
export function assessCandidateConflictV1(candidateInput: PolicyCandidateFactV1,
  currentVerifiedEvidence: readonly PolicyEvidenceV1[], at: Date): PolicyCandidateConflictV1 {
  const candidate = policyCandidateFactSchema.parse(candidateInput);
  if (!Number.isFinite(at.getTime()) || currentVerifiedEvidence.length > 500) {
    throw new RangeError("Invalid conflict evaluation time or evidence bound.");
  }
  const matching = currentVerifiedEvidence.filter(evidence =>
    isPolicyEvidencePublishable(evidence, at) &&
    evidence.fact.claimKey === candidate.claimKey && evidence.fact.jurisdiction === candidate.jurisdiction);
  const sameValue = matching.length > 0 && matching.every(evidence =>
    evidence.fact.category === candidate.categoryHint &&
    equivalentText(evidence.fact.statement, candidate.quotedText));
  return policyCandidateConflictSchema.parse({
    schemaVersion: 1, candidateId: candidate.candidateId,
    status: matching.length === 0 ? "NO_MATCHING_CURRENT" :
      sameValue ? "MATCHES_CURRENT_VALUE" : "POTENTIAL_POLICY_CONFLICT",
    matchedVerifiedFactIds: [...new Set(matching.map(evidence => evidence.fact.factId))].sort(),
    reviewStatus: "PENDING_APPROVAL",
  });
}
