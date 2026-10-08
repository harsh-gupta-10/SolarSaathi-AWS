import { createHash } from "node:crypto";
import type { IngestedPolicyDocument } from "./document-ingestion";
import { buildPolicyCitation } from "./precedence";
import { policyCandidateFactSchema, type PolicyCandidateFactV1 } from "./phase9-schema";
import { policyDocumentChunkSchema, type PolicyDocumentV1, type PolicySourceV1 } from "./schema";
import { validateSourceDocumentBinding } from "./sources";

const amountPattern = /(?:₹|\bINR\b|\bRs\.?)(?:\s|\u00a0)*[0-9०-९,]+(?:\.[0-9०-९]+)?(?:\s*(?:lakh|crore|लाख|कोटी|करोड़))?/giu;
const datePattern = /(?:[0-9०-९]{4}-[0-9०-९]{1,2}-[0-9०-९]{1,2}|[0-9०-९]{1,2}[/-][0-9०-९]{1,2}[/-][0-9०-९]{2,4}|\b\d{1,2}\s+(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{4}\b)/giu;
const capacityPattern = /[0-9०-९]+(?:\.[0-9०-९]+)?\s*(?:kW|MW|kWp|MWp)\b/giu;
const policySignal = /\b(?:subsid(?:y|ies)|incentive|benefit|eligib(?:le|ility)|net[ -]?metering|financ(?:e|ing)|loan|tariff|capacity|kilowatt|vendor|installer|application|document|deadline|scheme|regulation|reimbursement|grant)\b|\u20b9|अनुदान|सब्सिडी|पात्रता|योजना|अर्ज|तारीख|अंतिम\s+दिनांक|क्षमता|कर्ज|ऋण|लाभ|निव्वळ\s+मापन|नेट\s+मीटरिंग/iu;

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 32);
}

function mentions(text: string, pattern: RegExp): string[] {
  return [...new Set(text.match(pattern) ?? [])].slice(0, 20);
}

function categoryHint(text: string): PolicyCandidateFactV1["categoryHint"] {
  if (/\bnet[ -]?metering\b/iu.test(text)) return "NET_METERING";
  if (/\bcentral\s+subsid/iu.test(text)) return "CENTRAL_SUBSIDY";
  if (/\bstate\s+subsid/iu.test(text)) return "STATE_SUBSIDY";
  if (/\b(?:discom|distribution company|utility)\s+(?:incentive|benefit)/iu.test(text)) return "DISCOM_INCENTIVE";
  if (/\b(?:municipal|local body)\s+(?:incentive|benefit)/iu.test(text)) return "LOCAL_BODY_INCENTIVE";
  if (/\b(?:subsid|incentive|grant|reimbursement)/iu.test(text) || /अनुदान|सब्सिडी/.test(text)) return "OTHER";
  if (/\b(?:deadline|last date|due date)\b/iu.test(text) || /तारीख|अंतिम\s+दिनांक/.test(text)) return "DEADLINE";
  if (/\b(?:capacity|kilowatt|kWp)\b/iu.test(text) || /क्षमता/.test(text)) return "CAPACITY_LIMIT";
  if (/\b(?:loan|financing|finance)\b/iu.test(text)) return "FINANCING";
  if (/\b(?:vendor|installer)\b/iu.test(text)) return "VENDOR_REQUIREMENT";
  if (/\b(?:document|certificate)\b/iu.test(text)) return "DOCUMENT_REQUIREMENT";
  if (/\b(?:application|apply|portal)\b/iu.test(text)) return "APPLICATION_PROCESS";
  if (/\b(?:eligible|eligibility)\b/iu.test(text)) return "ELIGIBILITY";
  return "OTHER";
}

/** Stable for a textual claim when only its stated amount, date, capacity or category qualifier changes. */
export function policyCandidateClaimKeyV1(quote: string): string {
  const skeleton = quote.normalize("NFC")
    .replace(amountPattern, " <amount> ")
    .replace(datePattern, " <date> ")
    .replace(capacityPattern, " <capacity> ")
    .replace(/\b(?:central|state|discom|municipal|local body)\s+(?=(?:subsid|incentive|benefit))/giu, "")
    .replace(/[0-9०-९]+(?:[,.][0-9०-९]+)*/gu, "<number>")
    .replace(/\s+/gu, " ").trim().toLowerCase();
  return `claim.${digest(skeleton)}`;
}

/** Review candidates are exact source quotations and never interpreted policy facts. */
export function extractPolicyCandidatesV1(sourceInput: PolicySourceV1, documentInput: PolicyDocumentV1,
  ingested: IngestedPolicyDocument): PolicyCandidateFactV1[] {
  const { source, document } = validateSourceDocumentBinding(sourceInput, documentInput);
  if (ingested.schemaVersion !== 1 || ingested.mimeType !== document.mimeType ||
    ingested.sha256 !== document.sha256 ||
    (document.normalizedTextSha256 && ingested.normalizedTextSha256 !== document.normalizedTextSha256) ||
    (document.chunkCount !== undefined && ingested.chunks.length !== document.chunkCount) ||
    ingested.chunks.length > 1_000 || ingested.normalizedText.length > 500_000 ||
    createHash("sha256").update(ingested.normalizedText).digest("hex") !== ingested.normalizedTextSha256) {
    throw new RangeError("Extracted document hashes, media type or bounds do not match immutable metadata.");
  }
  const candidates: PolicyCandidateFactV1[] = [];
  for (const [index, unparsed] of ingested.chunks.entries()) {
    const chunk = policyDocumentChunkSchema.parse(unparsed);
    if (chunk.sourceId !== source.sourceId || chunk.documentId !== document.documentId ||
      chunk.documentVersion !== document.version || chunk.index !== index || chunk.text.length > 1_600 ||
      createHash("sha256").update(chunk.text).digest("hex") !== chunk.sha256 ||
      chunk.locator.charStart === undefined || chunk.locator.charEnd === undefined ||
      ingested.normalizedText.slice(chunk.locator.charStart, chunk.locator.charEnd) !== chunk.text) {
      throw new RangeError("Policy chunk is not bound to its normalized document and locator.");
    }
    if (!policySignal.test(chunk.text)) continue;
    const quote = chunk.text;
    candidates.push(policyCandidateFactSchema.parse({
      schemaVersion: 1,
      candidateId: `CAND#${digest(`${source.sourceId}\0${document.documentId}\0${document.version}\0${chunk.chunkId}\0${quote}`)}`,
      sourceId: source.sourceId, documentId: document.documentId, documentVersion: document.version,
      chunkId: chunk.chunkId, claimKey: policyCandidateClaimKeyV1(quote),
      jurisdiction: source.jurisdiction, categoryHint: categoryHint(quote), quotedText: quote,
      citation: buildPolicyCitation(source, document, chunk.locator),
      amountMentions: mentions(quote, amountPattern), dateMentions: mentions(quote, datePattern),
      capacityMentions: mentions(quote, capacityPattern),
      verificationStatus: "UNVERIFIED", reviewStatus: "PENDING_APPROVAL", extractedAt: document.retrievedAt,
    }));
    if (candidates.length > 100) throw new RangeError("Policy candidate limit exceeded; split the document for review.");
  }
  return candidates;
}
