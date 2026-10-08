import { policyCitationSchema, policyDocumentSchema, policyFactSchema, policyLocatorSchema,
  policySourceSchema, policyVersionSchema,
  type PolicyCitationV1, type PolicyDocumentV1, type PolicyFactV1, type PolicyLocatorV1,
  type PolicySourceV1, type PolicyVersionV1 } from "./schema";
import { sourceIsStale, validateOfficialSourceUrl } from "./sources";

export interface PolicyEvidenceV1 {
  source: PolicySourceV1;
  document: PolicyDocumentV1;
  version: PolicyVersionV1;
  fact: PolicyFactV1;
}

export type PolicyPrecedenceOutcomeV1 = "AGREE" | "PREFER_LEFT" | "PREFER_RIGHT" | "POLICY_CONFLICT" | "INCOMPARABLE";
export type PolicyPrecedenceReasonV1 =
  | "SAME_CLAIM_VALUE" | "DIFFERENT_CLAIM" | "CURRENT_VERIFIED_SOURCE" | "HIGHER_SOURCE_AUTHORITY"
  | "EXPLICIT_AMENDMENT" | "STRONGER_DOCUMENT_TYPE" | "UNRESOLVED_CONFLICT";

export interface PolicyPrecedenceResultV1 {
  outcome: PolicyPrecedenceOutcomeV1;
  reasonCode: PolicyPrecedenceReasonV1;
  /** Whether the chosen evidence meets the current, curated and verified display gate. */
  publishable: boolean;
  requiresReview: boolean;
}

function parseEvidence(input: PolicyEvidenceV1): PolicyEvidenceV1 {
  const source = policySourceSchema.parse(input.source);
  const document = policyDocumentSchema.parse(input.document);
  const version = policyVersionSchema.parse(input.version);
  const fact = policyFactSchema.parse(input.fact);
  const citation = policyCitationSchema.parse(fact.citation);
  if (document.sourceId !== source.sourceId || document.sourceRegistryVersion !== source.registryVersion ||
    new URL(document.canonicalUrl).hostname !== new URL(source.canonicalUrl).hostname ||
    fact.policyId !== version.policyId || fact.policyVersion !== version.version ||
    fact.category !== version.category || fact.jurisdiction !== version.jurisdiction ||
    !version.factIds.includes(fact.factId) ||
    !version.documentRefs.some(ref => ref.sourceId === source.sourceId && ref.documentId === document.documentId &&
      ref.documentVersion === document.version && ref.sha256 === document.sha256) ||
    citation.sourceId !== source.sourceId || citation.sourceRegistryVersion !== source.registryVersion ||
    citation.documentId !== document.documentId || citation.documentVersion !== document.version ||
    citation.documentSha256 !== document.sha256 || citation.sourceUrl !== document.canonicalUrl ||
    citation.publisherName !== source.publisherName || citation.documentTitle !== document.title ||
    citation.retrievedAt !== document.retrievedAt) {
    throw new RangeError("Policy evidence provenance does not match its source, document and version.");
  }
  return { source, document, version, fact };
}

/** Citation data is copied from validated immutable records, never accepted as a free-form display string. */
export function buildPolicyCitation(sourceInput: PolicySourceV1, documentInput: PolicyDocumentV1,
  locatorInput: PolicyLocatorV1): PolicyCitationV1 {
  const source = policySourceSchema.parse(sourceInput);
  const document = policyDocumentSchema.parse(documentInput);
  const locator = policyLocatorSchema.parse(locatorInput);
  if (document.sourceId !== source.sourceId || document.sourceRegistryVersion !== source.registryVersion ||
    new URL(document.canonicalUrl).hostname !== new URL(source.canonicalUrl).hostname) {
    throw new RangeError("Policy citation source and document do not match.");
  }
  return policyCitationSchema.parse({ schemaVersion: 1, sourceId: source.sourceId,
    sourceRegistryVersion: source.registryVersion, documentId: document.documentId,
    documentVersion: document.version, documentSha256: document.sha256,
    publisherName: source.publisherName, documentTitle: document.title,
    sourceUrl: document.canonicalUrl, retrievedAt: document.retrievedAt,
    ...(document.publishedAt ? { publishedAt: document.publishedAt } : {}),
    ...(document.effectiveFrom ? { effectiveFrom: document.effectiveFrom } : {}), locator });
}

function effective(from: string, to: string | undefined, date: string): boolean {
  return from <= date && (to === undefined || date <= to);
}

/** The display gate is stricter than source-domain verification or extraction confidence. */
export function isPolicyEvidencePublishable(evidenceInput: PolicyEvidenceV1, at: Date): boolean {
  const evidence = parseEvidence(evidenceInput);
  if (!Number.isFinite(at.getTime())) throw new RangeError("Invalid policy evaluation time.");
  const { source, version, fact } = evidence;
  const today = at.toISOString().slice(0, 10);
  if (source.authorityTier > 2 || source.registryStatus !== "CURATED" || !source.enabled ||
    source.healthStatus !== "HEALTHY" || sourceIsStale(source, at) ||
    version.status !== "ACTIVE" || version.verificationStatus !== "VERIFIED" ||
    fact.verificationStatus !== "VERIFIED" || !effective(version.effectiveFrom, version.effectiveTo, today) ||
    !effective(fact.effectiveFrom, fact.effectiveTo, today)) return false;
  try { validateOfficialSourceUrl(source.canonicalUrl, source.sourceType, source.jurisdiction); }
  catch { return false; }
  return true;
}

function sameClaim(left: PolicyEvidenceV1, right: PolicyEvidenceV1): boolean {
  return left.fact.policyId === right.fact.policyId && left.fact.category === right.fact.category &&
    left.fact.jurisdiction === right.fact.jurisdiction && left.fact.claimKey === right.fact.claimKey;
}

function sameValue(left: PolicyFactV1, right: PolicyFactV1): boolean {
  if (left.value && right.value) return JSON.stringify(left.value) === JSON.stringify(right.value);
  if (left.value || right.value) return false;
  return left.statement.replace(/\s+/g, " ").trim().toLowerCase() ===
    right.statement.replace(/\s+/g, " ").trim().toLowerCase();
}

const DOCUMENT_AUTHORITY: Readonly<Record<PolicyDocumentV1["documentType"], number>> = Object.freeze({
  STATUTE: 1, SCHEME_NOTIFICATION: 2, GUIDELINE: 3, CIRCULAR: 4, AMENDMENT: 5,
  OFFICIAL_WEBPAGE: 6, TECHNICAL_DOCUMENT: 7, ARTICLE: 8, OTHER: 9,
});

/** Negative means the left registry source has stronger curated authority. */
export function compareSourceAuthority(leftInput: PolicySourceV1, rightInput: PolicySourceV1): -1 | 0 | 1 {
  const left = policySourceSchema.parse(leftInput), right = policySourceSchema.parse(rightInput);
  return left.authorityTier < right.authorityTier ? -1 : left.authorityTier > right.authorityTier ? 1 : 0;
}

function prefer(left: boolean, reasonCode: PolicyPrecedenceReasonV1,
  publishable: boolean): PolicyPrecedenceResultV1 {
  return { outcome: left ? "PREFER_LEFT" : "PREFER_RIGHT", reasonCode, publishable, requiresReview: true };
}

/** Conservative precedence: unresolved equal-authority conflicts are never silently published. */
export function comparePolicyEvidence(leftInput: PolicyEvidenceV1, rightInput: PolicyEvidenceV1,
  at: Date): PolicyPrecedenceResultV1 {
  const left = parseEvidence(leftInput), right = parseEvidence(rightInput);
  if (!sameClaim(left, right)) return { outcome: "INCOMPARABLE", reasonCode: "DIFFERENT_CLAIM",
    publishable: false, requiresReview: false };
  const leftReady = isPolicyEvidencePublishable(left, at);
  const rightReady = isPolicyEvidencePublishable(right, at);
  if (sameValue(left.fact, right.fact)) return { outcome: "AGREE", reasonCode: "SAME_CLAIM_VALUE",
    publishable: leftReady || rightReady, requiresReview: false };
  if (leftReady !== rightReady) return prefer(leftReady, "CURRENT_VERIFIED_SOURCE", true);
  if (!leftReady) return { outcome: "POLICY_CONFLICT", reasonCode: "UNRESOLVED_CONFLICT",
    publishable: false, requiresReview: true };
  const sourceOrder = compareSourceAuthority(left.source, right.source);
  if (sourceOrder !== 0) {
    return prefer(sourceOrder < 0, "HIGHER_SOURCE_AUTHORITY", true);
  }
  const leftAmends = left.document.amendsDocumentId === right.document.documentId;
  const rightAmends = right.document.amendsDocumentId === left.document.documentId;
  if (leftAmends !== rightAmends) return prefer(leftAmends, "EXPLICIT_AMENDMENT", true);
  const leftRank = DOCUMENT_AUTHORITY[left.document.documentType];
  const rightRank = DOCUMENT_AUTHORITY[right.document.documentType];
  if (leftRank !== rightRank && left.document.documentType !== "AMENDMENT" &&
    right.document.documentType !== "AMENDMENT") {
    return prefer(leftRank < rightRank, "STRONGER_DOCUMENT_TYPE", true);
  }
  return { outcome: "POLICY_CONFLICT", reasonCode: "UNRESOLVED_CONFLICT", publishable: false, requiresReview: true };
}
