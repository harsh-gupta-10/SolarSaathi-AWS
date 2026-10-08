import { describe, expect, it } from "vitest";
import {
  applyPolicyVersionEvent, buildPolicyCitation, canonicalizePolicyUrl, comparePolicyEvidence, compareSourceAuthority,
  isPolicyEvidencePublishable, isPolicyVersionTransitionAllowed, policyDocumentSchema, policyFactSchema,
  policySourceSchema, sourceIsStale, STARTER_POLICY_SOURCE_INTENTS_V1, validateNewPolicyVersion, validateOfficialSourceRecord,
  validateOfficialSourceUrl, validateSourceDocumentBinding,
  verifiedStarterSourceIntentsV1,
  type PolicyDocumentV1, type PolicyEvidenceV1, type PolicyFactV1,
  type PolicySourceV1, type PolicyVersionEventV1, type PolicyVersionV1,
} from "../src";

const NOW = "2026-10-08T12:00:00.000Z";
const at = new Date(NOW);
const hash = (char: string) => char.repeat(64);

const source = (changed: Partial<PolicySourceV1> = {}): PolicySourceV1 => ({
  schemaVersion: 1, sourceId: "SRC#MNRE#ROOFTOP", registryVersion: 1,
  name: "Synthetic MNRE registry fixture", publisherName: "MNRE", jurisdiction: "IN",
  sourceType: "MNRE", authorityTier: 1, registryStatus: "CURATED", healthStatus: "HEALTHY",
  canonicalUrl: "https://mnre.gov.in/en/grid-connected-solar-rooftop-programme/",
  allowedHosts: ["mnre.gov.in"], crawlFrequency: "DAILY", enabled: true,
  freshnessWindowHours: 48, lastCheckedAt: NOW, curatedAt: NOW, curatorId: "reviewer-fixture",
  createdAt: "2026-10-01T00:00:00.000Z", updatedAt: NOW, ...changed,
});

const document = (owner = source(), changed: Partial<PolicyDocumentV1> = {}): PolicyDocumentV1 => ({
  schemaVersion: 1, documentId: "DOC#ROOFTOP", sourceId: owner.sourceId,
  sourceRegistryVersion: owner.registryVersion, version: 1, title: "Synthetic policy document fixture",
  documentType: "GUIDELINE", mimeType: "text/html", canonicalUrl: owner.canonicalUrl,
  sha256: hash("a"), retrievedAt: NOW, publishedAt: "2026-10-01", effectiveFrom: "2026-10-01", ...changed,
});

const version = (changed: Partial<PolicyVersionV1> = {}): PolicyVersionV1 => ({
  schemaVersion: 1, policyId: "POLICY#SYNTHETIC", version: 1,
  category: "CENTRAL_SUBSIDY", jurisdiction: "IN", status: "ACTIVE", verificationStatus: "VERIFIED",
  effectiveFrom: "2026-10-01", factIds: ["FACT#AMOUNT"], documentRefs: [{ sourceId: "SRC#MNRE#ROOFTOP",
    documentId: "DOC#ROOFTOP", documentVersion: 1, sha256: hash("a") }],
  contentHash: hash("b"), createdAt: "2026-10-01T00:00:00.000Z", createdBy: "extractor-fixture",
  lastVerifiedAt: "2026-10-07T00:00:00.000Z", verifiedBy: "reviewer-fixture",
  approvedAt: "2026-10-07T00:00:00.000Z", approvedBy: "reviewer-fixture", activatedAt: "2026-10-08T00:00:00.000Z",
  ...changed,
});

const evidence = (owner = source(), doc = document(owner), changed: Partial<PolicyFactV1> = {}): PolicyEvidenceV1 => {
  const fact: PolicyFactV1 = { schemaVersion: 1, factId: "FACT#AMOUNT", policyId: "POLICY#SYNTHETIC",
    policyVersion: 1, category: "CENTRAL_SUBSIDY", jurisdiction: "IN", claimKey: "benefit.amount",
    statement: "Synthetic amount in test fixture only", value: { kind: "NUMBER", amount: 100, unit: "INR" },
    effectiveFrom: "2026-10-01", citation: buildPolicyCitation(owner, doc, { section: "Fixture section" }),
    verificationStatus: "VERIFIED", lastVerifiedAt: NOW, verifiedBy: "reviewer-fixture", recordedAt: NOW, ...changed };
  return { source: owner, document: doc, version: version({
    factIds: [fact.factId], documentRefs: [{ sourceId: doc.sourceId, documentId: doc.documentId,
      documentVersion: doc.version, sha256: doc.sha256 }],
  }), fact };
};

const transition = (fromStatus: PolicyVersionEventV1["fromStatus"],
  toStatus: PolicyVersionEventV1["toStatus"], occurredAt = NOW): PolicyVersionEventV1 => ({
  schemaVersion: 1, eventId: "11111111-1111-4111-8111-111111111111", policyId: "POLICY#SYNTHETIC",
  policyVersion: 1, fromStatus, toStatus, actorId: "reviewer-fixture", occurredAt,
});

describe("policy source registry and provenance", () => {
  it("offers only disabled discovery intents on verified official starter hosts", () => {
    const intents = verifiedStarterSourceIntentsV1();
    expect(intents).toHaveLength(6);
    expect(intents).toEqual(STARTER_POLICY_SOURCE_INTENTS_V1);
    expect(intents.every(intent => intent.registryStatus === "PROPOSED" && !intent.enabled &&
      intent.hostVerifiedAt === "2026-10-08")).toBe(true);
    expect(JSON.stringify(intents)).not.toMatch(/amount|eligibility|benefitRupees|VERIFIED_POLICY/i);
  });

  it("binds official source identity to exact verified host, type and jurisdiction", () => {
    expect(validateOfficialSourceUrl(source().canonicalUrl, "MNRE", "IN")).toMatchObject({ host: "mnre.gov.in",
      hostRegistryVersion: 1 });
    expect(validateOfficialSourceRecord(source()).sourceId).toBe("SRC#MNRE#ROOFTOP");
    expect(canonicalizePolicyUrl("https://mnre.gov.in/path#heading")).toBe("https://mnre.gov.in/path");
    for (const url of ["http://mnre.gov.in/path", "https://mnre.gov.in.evil.example/path",
      "https://user:secret@mnre.gov.in/path", "https://127.0.0.1/path"]) {
      expect(() => validateOfficialSourceUrl(url, "MNRE", "IN")).toThrow(RangeError);
    }
    expect(() => validateOfficialSourceUrl(source().canonicalUrl, "DISCOM", "IN-MH")).toThrow(RangeError);
    expect(() => validateOfficialSourceRecord(source({ canonicalUrl: "https://example.org/",
      allowedHosts: ["example.org"] }))).toThrow(RangeError);
  });

  it("keeps source curation separate from fact verification and checks freshness", () => {
    expect(policySourceSchema.safeParse(source({ authorityTier: 4 })).success).toBe(false);
    expect(policySourceSchema.safeParse(source({ registryStatus: "PROPOSED", enabled: true })).success).toBe(false);
    expect(policySourceSchema.safeParse(source({ registryStatus: "CURATED", curatorId: undefined })).success).toBe(false);
    expect(sourceIsStale(source(), at)).toBe(false);
    expect(sourceIsStale(source({ lastCheckedAt: undefined }), at)).toBe(true);
    expect(sourceIsStale(source({ lastCheckedAt: "2026-10-01T00:00:00.000Z" }), at)).toBe(true);
    expect(isPolicyEvidencePublishable(evidence(), at)).toBe(true);
    expect(isPolicyEvidencePublishable(evidence(source({ registryStatus: "PROPOSED", enabled: false,
      curatedAt: undefined, curatorId: undefined })), at)).toBe(false);
  });

  it("pins immutable document metadata and citations to the registered source version", () => {
    const owner = source(), doc = document(owner, { s3Key: "raw/fixture", s3VersionId: "v1",
      derivedS3Key: "derived/fixture", derivedS3VersionId: "v2" });
    expect(validateSourceDocumentBinding(owner, doc).document).toEqual(doc);
    expect(policyDocumentSchema.safeParse(doc).success).toBe(true);
    const citation = buildPolicyCitation(owner, doc, { pageNumber: 4, section: "4.1" });
    expect(citation).toMatchObject({ sourceId: owner.sourceId, sourceRegistryVersion: 1,
      documentId: doc.documentId, documentVersion: 1, documentSha256: hash("a"),
      sourceUrl: doc.canonicalUrl, publisherName: "MNRE", locator: { pageNumber: 4, section: "4.1" } });
    expect(() => validateSourceDocumentBinding(owner, { ...doc, sourceRegistryVersion: 2 })).toThrow(RangeError);
    expect(() => buildPolicyCitation(owner, { ...doc, canonicalUrl: "https://example.org/document" },
      { pageNumber: 1 })).toThrow(RangeError);
    expect(() => comparePolicyEvidence(evidence(), evidence(source(), document(), {
      citation: { ...citation, documentSha256: hash("f") },
    }), at)).toThrow(RangeError);
  });

  it("requires verified facts to have explicit reviewer and time", () => {
    expect(policyFactSchema.safeParse(evidence().fact).success).toBe(true);
    expect(policyFactSchema.safeParse({ ...evidence().fact, verifiedBy: undefined }).success).toBe(false);
    expect(policyFactSchema.safeParse({ ...evidence().fact, effectiveTo: "2026-09-01" }).success).toBe(false);
  });
});

describe("source precedence and conflicts", () => {
  it("never lets an industry discovery source override a current verified official fact", () => {
    const industry = source({ sourceId: "SRC#INDUSTRY", name: "Synthetic industry fixture", publisherName: "Industry fixture",
      sourceType: "INDUSTRY", authorityTier: 3, canonicalUrl: "https://example.org/policy",
      allowedHosts: ["example.org"] });
    const other = evidence(industry, document(industry, { documentId: "DOC#INDUSTRY", sha256: hash("c") }),
      { value: { kind: "NUMBER", amount: 999, unit: "INR" } });
    expect(compareSourceAuthority(source(), industry)).toBe(-1);
    expect(compareSourceAuthority(industry, source())).toBe(1);
    expect(compareSourceAuthority(source(), source())).toBe(0);
    expect(isPolicyEvidencePublishable(other, at)).toBe(false);
    expect(comparePolicyEvidence(evidence(), other, at)).toMatchObject({ outcome: "PREFER_LEFT",
      reasonCode: "CURRENT_VERIFIED_SOURCE", publishable: true, requiresReview: true });
  });

  it("agrees on an identical claim value, but does not publish two unverified copies", () => {
    expect(comparePolicyEvidence(evidence(), evidence(), at)).toMatchObject({ outcome: "AGREE",
      publishable: true, requiresReview: false });
    const unverified = evidence(source({ registryStatus: "PROPOSED", enabled: false,
      curatedAt: undefined, curatorId: undefined }));
    expect(comparePolicyEvidence(unverified, unverified, at)).toMatchObject({ outcome: "AGREE",
      publishable: false });
  });

  it("flags equal-authority contradictory current facts unless explicit precedence exists", () => {
    const portal = source({ sourceId: "SRC#PORTAL", name: "Synthetic national portal fixture",
      publisherName: "National portal fixture", sourceType: "SCHEME_PORTAL", authorityTier: 1,
      canonicalUrl: "https://solarrooftop.pmsuryaghar.gov.in/",
      allowedHosts: ["solarrooftop.pmsuryaghar.gov.in"] });
    const portalDocument = document(portal, { documentId: "DOC#PORTAL", sha256: hash("c") });
    const other = evidence(portal, portalDocument, { value: { kind: "NUMBER", amount: 200, unit: "INR" } });
    expect(comparePolicyEvidence(evidence(), other, at)).toMatchObject({ outcome: "POLICY_CONFLICT",
      reasonCode: "UNRESOLVED_CONFLICT", publishable: false, requiresReview: true });
    const amendment = evidence(portal, { ...portalDocument, documentType: "AMENDMENT",
      amendsDocumentId: "DOC#ROOFTOP" }, { value: { kind: "NUMBER", amount: 200, unit: "INR" } });
    expect(comparePolicyEvidence(evidence(), amendment, at)).toMatchObject({ outcome: "PREFER_RIGHT",
      reasonCode: "EXPLICIT_AMENDMENT" });
  });

  it("keeps different claims or jurisdictions incomparable", () => {
    const otherClaim = evidence(source(), document(), { claimKey: "eligibility.residential" });
    expect(comparePolicyEvidence(evidence(), otherClaim, at).outcome).toBe("INCOMPARABLE");
    const expired = evidence(source(), document(), { effectiveTo: "2026-10-07",
      value: { kind: "NUMBER", amount: 200, unit: "INR" } });
    expect(comparePolicyEvidence(evidence(), expired, at)).toMatchObject({ outcome: "PREFER_LEFT",
      reasonCode: "CURRENT_VERIFIED_SOURCE" });
  });
});

describe("immutable policy version transitions", () => {
  const draft = (): PolicyVersionV1 => version({ status: "DETECTED", verificationStatus: "UNVERIFIED",
    lastVerifiedAt: undefined, verifiedBy: undefined, approvedAt: undefined, approvedBy: undefined, activatedAt: undefined });

  it("requires consecutive, materially different append-only versions", () => {
    const first = draft();
    expect(validateNewPolicyVersion(first)).toEqual(first);
    expect(() => validateNewPolicyVersion(version())).toThrow(RangeError);
    const next = { ...first, version: 2, previousVersion: 1, contentHash: hash("c"),
      createdAt: "2026-10-09T00:00:00.000Z" };
    expect(validateNewPolicyVersion(next, first).version).toBe(2);
    expect(() => validateNewPolicyVersion({ ...next, contentHash: first.contentHash }, first)).toThrow(RangeError);
    expect(() => validateNewPolicyVersion({ ...next, version: 3, previousVersion: 2 }, first)).toThrow(RangeError);
    expect(first.version).toBe(1);
  });

  it("enforces review and approval gates with a separate audit event", () => {
    let current = draft();
    for (const [from, to] of [["DETECTED", "EXTRACTED"], ["EXTRACTED", "VALIDATED"],
      ["VALIDATED", "PENDING_APPROVAL"]] as const) {
      const prior = current;
      current = applyPolicyVersionEvent(current, transition(from, to)).version;
      expect(prior.status).toBe(from);
      expect(current.status).toBe(to);
    }
    expect(() => applyPolicyVersionEvent(current, transition("PENDING_APPROVAL", "APPROVED"))).toThrow(RangeError);
    current = { ...current, verificationStatus: "VERIFIED", lastVerifiedAt: NOW, verifiedBy: "reviewer-fixture" };
    current = applyPolicyVersionEvent(current, transition("PENDING_APPROVAL", "APPROVED")).version;
    expect(current).toMatchObject({ status: "APPROVED", approvedAt: NOW, approvedBy: "reviewer-fixture" });
    current = applyPolicyVersionEvent(current, transition("APPROVED", "ACTIVE")).version;
    expect(current).toMatchObject({ status: "ACTIVE", activatedAt: NOW });
    expect(isPolicyVersionTransitionAllowed("ACTIVE", "REJECTED")).toBe(false);
    expect(() => applyPolicyVersionEvent(current, transition("ACTIVE", "REJECTED"))).toThrow(RangeError);
    expect(() => applyPolicyVersionEvent(draft(), transition("DETECTED", "EXTRACTED",
      "2026-09-30T00:00:00.000Z"))).toThrow(RangeError);
  });
});
