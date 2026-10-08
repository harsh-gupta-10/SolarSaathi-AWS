import { describe, expect, it } from "vitest";
import { assessCandidateConflictV1, detectPolicyChangeV1, extractPolicyCandidatesV1,
  ingestPolicyDocument, policyCandidateClaimKeyV1, policyCandidateFactSchema,
  policyCrawlerAuditEventSchema, type IngestedPolicyDocument, type PolicyDocumentV1,
  type PolicyEvidenceV1, type PolicySourceV1 } from "../src";

const NOW = "2026-10-08T12:00:00.000Z";
const source: PolicySourceV1 = {
  schemaVersion: 1, sourceId: "SRC#SYNTHETIC", registryVersion: 1, name: "Synthetic official fixture",
  publisherName: "Synthetic ministry", jurisdiction: "IN", sourceType: "MNRE", authorityTier: 1,
  registryStatus: "CURATED", healthStatus: "HEALTHY", canonicalUrl: "https://mnre.gov.in/fixture",
  allowedHosts: ["mnre.gov.in"], crawlFrequency: "DAILY", enabled: true, freshnessWindowHours: 48,
  lastCheckedAt: NOW, curatedAt: NOW, curatorId: "fixture-curator", createdAt: NOW, updatedAt: NOW,
};

async function extraction(html: string, version = 1) {
  const ingested = await ingestPolicyDocument({ sourceId: source.sourceId, documentId: "DOC#SYNTHETIC",
    documentVersion: version, mimeType: "text/html", bytes: new TextEncoder().encode(html) });
  const document: PolicyDocumentV1 = {
    schemaVersion: 1, documentId: "DOC#SYNTHETIC", sourceId: source.sourceId,
    sourceRegistryVersion: 1, version, title: "Synthetic notice", documentType: "OFFICIAL_WEBPAGE",
    mimeType: "text/html", canonicalUrl: source.canonicalUrl, sha256: ingested.sha256,
    normalizedTextSha256: ingested.normalizedTextSha256, chunkCount: ingested.chunks.length, retrievedAt: NOW,
  };
  const candidates = extractPolicyCandidatesV1(source, document, ingested);
  return { document, ingested, candidates };
}

const html = (body: string) => `<html><body><p>${body}</p></body></html>`;

describe("Phase 9 policy candidates", () => {
  it("quotes exact English and Indic source text with immutable chunk locators and no verified policy value", async () => {
    for (const statement of [
      "Synthetic central subsidy ₹12,000 for 2 kW until 12/10/2026; test fixture only.",
      "योजना अनुदान ₹१२,००० आणि पात्रता २ kW, अंतिम तारीख १२/१०/२०२६; चाचणी मजकूर.",
    ]) {
      const result = await extraction(html(statement));
      expect(result.candidates).toHaveLength(1);
      const candidate = result.candidates[0]!;
      const chunk = result.ingested.chunks.find(value => value.chunkId === candidate.chunkId)!;
      expect(candidate.quotedText).toBe(chunk.text);
      expect(result.ingested.normalizedText.slice(candidate.citation.locator.charStart,
        candidate.citation.locator.charEnd)).toBe(candidate.quotedText);
      expect(candidate.citation.documentSha256).toBe(result.ingested.sha256);
      expect(candidate.amountMentions).toHaveLength(1);
      expect(candidate.dateMentions).toHaveLength(1);
      expect(candidate.capacityMentions).toHaveLength(1);
      expect(candidate).toMatchObject({ verificationStatus: "UNVERIFIED", reviewStatus: "PENDING_APPROVAL" });
      expect(policyCandidateFactSchema.safeParse({ ...candidate, verificationStatus: "VERIFIED" }).success).toBe(false);
      expect(JSON.stringify(candidate)).not.toMatch(/"value"|"amountRupees"|"active"/);
    }
  });

  it("rejects mismatched chunks, text, and document hashes before queuing", async () => {
    const current = await extraction(html("Synthetic subsidy ₹1,000."));
    const changedChunk: IngestedPolicyDocument = { ...current.ingested,
      chunks: current.ingested.chunks.map(chunk => ({ ...chunk, text: "Forged subsidy ₹999." })) };
    expect(() => extractPolicyCandidatesV1(source, current.document, changedChunk)).toThrow(RangeError);
    expect(() => extractPolicyCandidatesV1(source, { ...current.document, sha256: "0".repeat(64) },
      current.ingested)).toThrow(RangeError);
    expect(() => extractPolicyCandidatesV1({ ...source, allowedHosts: ["example.org"] }, current.document,
      current.ingested)).toThrow();
    expect(() => detectPolicyChangeV1(undefined, { ...current, candidates: [{ ...current.candidates[0]!,
      quotedText: "Synthetic subsidy ₹999." }] })).toThrow(RangeError);
  });

  it("rejects more than 100 review candidates without truncating the source", async () => {
    // Separate headings force independently reviewable chunks.
    const ingested = await ingestPolicyDocument({ sourceId: source.sourceId, documentId: "DOC#SYNTHETIC",
      documentVersion: 1, mimeType: "text/html", bytes: new TextEncoder().encode(
        `<html><body>${Array.from({ length: 101 }, (_, index) =>
          `<h2>Clause ${index}</h2><p>Synthetic subsidy ${index}.</p>`).join("")}</body></html>`) });
    const document: PolicyDocumentV1 = { schemaVersion: 1, documentId: "DOC#SYNTHETIC",
      sourceId: source.sourceId, sourceRegistryVersion: 1, version: 1, title: "Long synthetic notice",
      documentType: "OFFICIAL_WEBPAGE", mimeType: "text/html", canonicalUrl: source.canonicalUrl,
      sha256: ingested.sha256, normalizedTextSha256: ingested.normalizedTextSha256,
      chunkCount: ingested.chunks.length, retrievedAt: NOW };
    expect(ingested.chunks.length).toBeGreaterThan(100);
    expect(() => extractPolicyCandidatesV1(source, document, ingested)).toThrow(/candidate limit/i);
  });

  it("separates raw cosmetic changes from material amount, date and category changes", async () => {
    const first = await extraction(html("Synthetic central subsidy ₹1,000 for 2 kW until 12/10/2026."));
    const cosmetic = await extraction("<html><body><p class='decorative'>Synthetic central subsidy ₹1,000 for 2 kW until 12/10/2026.</p></body></html>", 2);
    expect(detectPolicyChangeV1({ sha256: first.document.sha256,
      normalizedTextSha256: first.ingested.normalizedTextSha256, candidates: first.candidates },
    cosmetic)).toMatchObject({ status: "COSMETIC_ONLY", reviewStatus: "NOT_REQUIRED", materialChanges: [] });
    expect(detectPolicyChangeV1({ sha256: first.document.sha256,
      normalizedTextSha256: first.ingested.normalizedTextSha256, candidates: first.candidates },
    first)).toMatchObject({ status: "RAW_UNCHANGED", reviewStatus: "NOT_REQUIRED" });
    const second = await extraction(html("Synthetic state subsidy ₹2,000 for 2 kW until 13/10/2026."), 2);
    expect(policyCandidateClaimKeyV1(first.candidates[0]!.quotedText)).toBe(
      policyCandidateClaimKeyV1(second.candidates[0]!.quotedText));
    const assessment = detectPolicyChangeV1({ sha256: first.document.sha256,
      normalizedTextSha256: first.ingested.normalizedTextSha256, candidates: first.candidates }, second);
    expect(assessment).toMatchObject({ status: "MATERIAL_REVIEW_REQUIRED", reviewStatus: "PENDING_APPROVAL" });
    expect(assessment.materialChanges.map(change => change.kind)).toEqual(expect.arrayContaining([
      "CATEGORY_CHANGED", "AMOUNT_TEXT_CHANGED", "DATE_TEXT_CHANGED", "QUOTE_CHANGED",
    ]));
  });

  it("requires review of new or unclassified changed text and never activates it", async () => {
    const first = await extraction(html("Synthetic subsidy ₹1,000."));
    expect(detectPolicyChangeV1(undefined, first)).toMatchObject({ status: "INITIAL_REVIEW_REQUIRED",
      reviewStatus: "PENDING_APPROVAL" });
    const changed = await extraction(html("Synthetic subsidy ₹1,000. Additional context."), 2);
    const assessment = detectPolicyChangeV1({ sha256: first.document.sha256,
      normalizedTextSha256: first.ingested.normalizedTextSha256, candidates: [] },
    { ...changed, candidates: [] });
    expect(assessment).toMatchObject({ status: "TEXT_REVIEW_REQUIRED", reviewStatus: "PENDING_APPROVAL" });
  });

  it("flags differences against a current verified fact without publishing the candidate", async () => {
    const current = await extraction(html("Synthetic central subsidy ₹1,000."));
    const candidate = current.candidates[0]!;
    const fact = {
      schemaVersion: 1 as const, factId: "FACT#SYNTHETIC", policyId: "POLICY#SYNTHETIC", policyVersion: 1,
      category: candidate.categoryHint, jurisdiction: "IN", claimKey: candidate.claimKey,
      statement: "Synthetic central subsidy ₹900.", effectiveFrom: "2026-10-01",
      citation: candidate.citation, verificationStatus: "VERIFIED" as const,
      lastVerifiedAt: NOW, verifiedBy: "independent-reviewer", recordedAt: NOW,
    };
    const evidence: PolicyEvidenceV1 = { source, document: current.document, fact,
      version: { schemaVersion: 1, policyId: fact.policyId, version: 1, category: fact.category,
        jurisdiction: fact.jurisdiction, status: "ACTIVE", verificationStatus: "VERIFIED",
        effectiveFrom: "2026-10-01", factIds: [fact.factId],
        documentRefs: [{ sourceId: source.sourceId, documentId: current.document.documentId,
          documentVersion: 1, sha256: current.document.sha256 }], contentHash: "a".repeat(64),
        createdAt: NOW, createdBy: "fixture", lastVerifiedAt: NOW, verifiedBy: "independent-reviewer",
        approvedAt: NOW, approvedBy: "independent-reviewer", activatedAt: NOW },
    };
    expect(assessCandidateConflictV1(candidate, [evidence], new Date(NOW))).toMatchObject({
      status: "POTENTIAL_POLICY_CONFLICT", matchedVerifiedFactIds: [fact.factId], reviewStatus: "PENDING_APPROVAL",
    });
    expect(assessCandidateConflictV1(candidate, [{ ...evidence, fact: { ...fact,
      statement: candidate.quotedText } }], new Date(NOW)).status).toBe("MATCHES_CURRENT_VALUE");
    expect(assessCandidateConflictV1(candidate, [], new Date(NOW)).status).toBe("NO_MATCHING_CURRENT");
  });

  it("validates a bounded immutable crawl audit event", () => {
    const audit = { schemaVersion: 1, eventId: "11111111-1111-4111-8111-111111111111",
      runId: "22222222-2222-4222-8222-222222222222", sourceId: source.sourceId,
      eventType: "CHANGE_ASSESSMENT", outcome: "REVIEW_REQUIRED", occurredAt: NOW,
      changeStatus: "MATERIAL_REVIEW_REQUIRED", candidateCount: 1 };
    expect(policyCrawlerAuditEventSchema.safeParse(audit).success).toBe(true);
    expect(policyCrawlerAuditEventSchema.safeParse({ ...audit, outcome: "FAILED" }).success).toBe(false);
    expect(policyCrawlerAuditEventSchema.safeParse({ ...audit, errorCode: "UNKNOWN" }).success).toBe(false);
  });
});
