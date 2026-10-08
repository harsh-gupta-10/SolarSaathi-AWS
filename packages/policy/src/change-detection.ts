import { z } from "zod";
import { policyCandidateClaimKeyV1 } from "./candidate-extraction";
import type { IngestedPolicyDocument } from "./document-ingestion";
import { policyCandidateFactSchema, policyChangeAssessmentSchema, type PolicyCandidateFactV1,
  type PolicyChangeAssessmentV1, type PolicyMaterialChangeKindV1 } from "./phase9-schema";
import { policyDocumentSchema, type PolicyDocumentV1 } from "./schema";

const hash = z.string().regex(/^[a-f0-9]{64}$/);

export interface PreviousPolicyExtractionV1 {
  sha256: string;
  normalizedTextSha256: string;
  candidates: readonly PolicyCandidateFactV1[];
}

export interface CurrentPolicyExtractionV1 {
  document: PolicyDocumentV1;
  ingested: IngestedPolicyDocument;
  candidates: readonly PolicyCandidateFactV1[];
}

function grouped(candidates: readonly PolicyCandidateFactV1[]): Map<string, PolicyCandidateFactV1[]> {
  const result = new Map<string, PolicyCandidateFactV1[]>();
  for (const candidate of candidates) {
    const group = result.get(candidate.claimKey) ?? [];
    group.push(candidate);
    result.set(candidate.claimKey, group);
  }
  return result;
}

function serializedMentions(candidates: PolicyCandidateFactV1[],
  field: "amountMentions" | "dateMentions" | "capacityMentions"): string {
  return JSON.stringify(candidates.flatMap(candidate => candidate[field]).sort());
}

function fieldChanged(left: PolicyCandidateFactV1[], right: PolicyCandidateFactV1[],
  field: "categoryHint" | "quotedText"): boolean {
  return JSON.stringify(left.map(candidate => candidate[field]).sort()) !==
    JSON.stringify(right.map(candidate => candidate[field]).sort());
}

/** Raw HTML/PDF changes are distinguished from normalized text and claim-level changes. */
export function detectPolicyChangeV1(previous: PreviousPolicyExtractionV1 | undefined,
  current: CurrentPolicyExtractionV1): PolicyChangeAssessmentV1 {
  const document = policyDocumentSchema.parse(current.document);
  const ingested = current.ingested;
  if (ingested.sha256 !== document.sha256 ||
    (document.normalizedTextSha256 && document.normalizedTextSha256 !== ingested.normalizedTextSha256) ||
    current.candidates.length > 100) {
    throw new RangeError("Current policy extraction does not match its document hashes or candidate bound.");
  }
  const candidates = current.candidates.map(value => policyCandidateFactSchema.parse(value));
  for (const candidate of candidates) {
    const citedChunk = ingested.chunks.find(chunk => chunk.chunkId === candidate.chunkId);
    if (candidate.sourceId !== document.sourceId || candidate.documentId !== document.documentId ||
      candidate.documentVersion !== document.version || candidate.citation.documentSha256 !== document.sha256 ||
      candidate.citation.documentVersion !== document.version ||
      candidate.claimKey !== policyCandidateClaimKeyV1(candidate.quotedText) ||
      !citedChunk || candidate.quotedText !== citedChunk.text ||
      JSON.stringify(candidate.citation.locator) !== JSON.stringify(citedChunk.locator)) {
      throw new RangeError("Candidate is not bound to the current policy document.");
    }
  }
  const previousCandidates = previous?.candidates.map(value => policyCandidateFactSchema.parse(value)) ?? [];
  if (previous) {
    hash.parse(previous.sha256); hash.parse(previous.normalizedTextSha256);
    if (previous.sha256 === document.sha256 &&
      previous.normalizedTextSha256 !== ingested.normalizedTextSha256) {
      throw new RangeError("Identical raw policy bytes cannot produce a different normalized text hash.");
    }
    if (previousCandidates.length > 100 || previousCandidates.some(candidate => candidate.sourceId !== document.sourceId ||
      candidate.documentId !== document.documentId)) {
      throw new RangeError("Previous policy extraction belongs to a different document or exceeds bounds.");
    }
  }
  const materialChanges: Array<{ claimKey: string; kind: PolicyMaterialChangeKindV1 }> = [];
  if (previous) {
    const oldClaims = grouped(previousCandidates), newClaims = grouped(candidates);
    for (const key of [...new Set([...oldClaims.keys(), ...newClaims.keys()])].sort()) {
      const oldGroup = oldClaims.get(key), newGroup = newClaims.get(key);
      if (!oldGroup) { materialChanges.push({ claimKey: key, kind: "CLAIM_ADDED" }); continue; }
      if (!newGroup) { materialChanges.push({ claimKey: key, kind: "CLAIM_REMOVED" }); continue; }
      if (fieldChanged(oldGroup, newGroup, "categoryHint")) materialChanges.push({ claimKey: key, kind: "CATEGORY_CHANGED" });
      if (serializedMentions(oldGroup, "amountMentions") !== serializedMentions(newGroup, "amountMentions")) {
        materialChanges.push({ claimKey: key, kind: "AMOUNT_TEXT_CHANGED" });
      }
      if (serializedMentions(oldGroup, "dateMentions") !== serializedMentions(newGroup, "dateMentions")) {
        materialChanges.push({ claimKey: key, kind: "DATE_TEXT_CHANGED" });
      }
      if (serializedMentions(oldGroup, "capacityMentions") !== serializedMentions(newGroup, "capacityMentions")) {
        materialChanges.push({ claimKey: key, kind: "CAPACITY_TEXT_CHANGED" });
      }
      if (oldGroup.length !== newGroup.length || fieldChanged(oldGroup, newGroup, "quotedText")) {
        materialChanges.push({ claimKey: key, kind: "QUOTE_CHANGED" });
      }
    }
  }
  const status: PolicyChangeAssessmentV1["status"] = !previous ? "INITIAL_REVIEW_REQUIRED" :
    materialChanges.length ? "MATERIAL_REVIEW_REQUIRED" :
      previous.sha256 === document.sha256 ? "RAW_UNCHANGED" :
        previous.normalizedTextSha256 === ingested.normalizedTextSha256 ? "COSMETIC_ONLY" :
          "TEXT_REVIEW_REQUIRED";
  return policyChangeAssessmentSchema.parse({
    schemaVersion: 1, sourceId: document.sourceId, documentId: document.documentId,
    documentVersion: document.version,
    ...(previous ? { previousRawSha256: previous.sha256,
      previousNormalizedTextSha256: previous.normalizedTextSha256 } : {}),
    currentRawSha256: document.sha256, currentNormalizedTextSha256: ingested.normalizedTextSha256,
    status, reviewStatus: status === "RAW_UNCHANGED" || status === "COSMETIC_ONLY" ?
      "NOT_REQUIRED" : "PENDING_APPROVAL",
    candidateCount: candidates.length, materialChanges,
  });
}
