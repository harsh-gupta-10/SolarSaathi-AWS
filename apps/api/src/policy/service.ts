import { createHash } from "node:crypto";
import {
  DOCUMENT_INGESTION_LIMITS, DocumentIngestionError, SOURCE_TYPE_AUTHORITY_TIER_V1,
  canonicalizePolicyUrl,
  ingestPolicyDocument, policyDocumentSchema, validateOfficialSourceRecord,
  validateOfficialSourceUrl, validateSourceDocumentBinding,
  type PolicyDocumentV1, type PolicySourceV1,
} from "@solarsaathi/policy";
import { RequestError } from "../lib/http";
import { ingestDocumentRequestSchema, parsePolicyRequest, registerSourceRequestSchema } from "./schema";
import type { PolicyObjectStore, PolicyRepository } from "./storage";

const MAX_DOCUMENT_BYTES = 2_000_000;
const sha256 = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");
const conditional = (error: unknown) => {
  if (!(error instanceof Error)) return false;
  if (error.name === "ConditionalCheckFailedException") return true;
  if (error.name !== "TransactionCanceledException" || !("CancellationReasons" in error)) return false;
  const reasons = error.CancellationReasons;
  return Array.isArray(reasons) && reasons.some(reason => reason?.Code === "ConditionalCheckFailed") &&
    reasons.every(reason => ["None", "ConditionalCheckFailed"].includes(reason?.Code));
};
const unavailable = () => new RequestError(503, "POLICY_STORAGE_UNAVAILABLE", "The policy archive is temporarily unavailable.");
const conflict = () => new RequestError(409, "POLICY_VERSION_CONFLICT", "An immutable policy record already exists with different content.");

function sourceMatches(existing: PolicySourceV1, proposed: PolicySourceV1): boolean {
  return existing.canonicalUrl === proposed.canonicalUrl && existing.name === proposed.name &&
    existing.publisherName === proposed.publisherName && existing.jurisdiction === proposed.jurisdiction &&
    existing.sourceType === proposed.sourceType && existing.crawlFrequency === proposed.crawlFrequency &&
    existing.freshnessWindowHours === proposed.freshnessWindowHours;
}

function documentMatches(existing: PolicyDocumentV1, proposed: PolicyDocumentV1): boolean {
  return existing.sourceId === proposed.sourceId && existing.documentId === proposed.documentId &&
    existing.sourceRegistryVersion === proposed.sourceRegistryVersion && existing.version === proposed.version &&
    existing.sha256 === proposed.sha256 && existing.normalizedTextSha256 === proposed.normalizedTextSha256 &&
    existing.chunkCount === proposed.chunkCount && existing.title === proposed.title &&
    existing.documentType === proposed.documentType && existing.mimeType === proposed.mimeType &&
    existing.canonicalUrl === proposed.canonicalUrl && existing.publishedAt === proposed.publishedAt &&
    existing.effectiveFrom === proposed.effectiveFrom && existing.effectiveTo === proposed.effectiveTo &&
    existing.s3Key === proposed.s3Key && existing.derivedS3Key === proposed.derivedS3Key &&
    !!existing.s3VersionId && !!existing.derivedS3VersionId;
}

export class PolicyService {
  constructor(
    private readonly repository: PolicyRepository,
    private readonly objects: PolicyObjectStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async registerSource(body: unknown, requestId: string) {
    const input = parsePolicyRequest(registerSourceRequestSchema, body);
    let verified: ReturnType<typeof validateOfficialSourceUrl>;
    try { verified = validateOfficialSourceUrl(input.canonicalUrl, input.sourceType, input.jurisdiction); }
    catch { throw new RequestError(400, "SOURCE_NOT_ALLOWLISTED", "Register an exact official source URL from the supported source registry."); }
    const now = this.now().toISOString();
    const source = validateOfficialSourceRecord({
      schemaVersion: 1, sourceId: `SRC#${sha256(verified.canonicalUrl).slice(0, 32)}`, registryVersion: 1,
      name: input.name, publisherName: input.publisherName, jurisdiction: input.jurisdiction,
      sourceType: input.sourceType, authorityTier: SOURCE_TYPE_AUTHORITY_TIER_V1[input.sourceType],
      registryStatus: "PROPOSED", healthStatus: "UNKNOWN", canonicalUrl: verified.canonicalUrl,
      allowedHosts: [verified.host], crawlFrequency: input.crawlFrequency, enabled: false,
      freshnessWindowHours: input.freshnessWindowHours, createdAt: now, updatedAt: now,
    });
    let existing: PolicySourceV1 | undefined;
    try { existing = await this.repository.getSource(source.sourceId); }
    catch { throw unavailable(); }
    if (existing) {
      if (!sourceMatches(existing, source)) throw conflict();
      return { source: validateOfficialSourceRecord(existing), created: false, requestId };
    }
    try { await this.repository.putSource(source); }
    catch (error) {
      if (!conditional(error)) throw unavailable();
      try { existing = await this.repository.getSource(source.sourceId); }
      catch { throw unavailable(); }
      if (!existing || !sourceMatches(existing, source)) throw conflict();
      return { source: validateOfficialSourceRecord(existing), created: false, requestId };
    }
    return { source, created: true, requestId };
  }

  async ingestDocument(body: unknown, requestId: string) {
    const input = parsePolicyRequest(ingestDocumentRequestSchema, body);
    const bytes = Buffer.from(input.contentBase64, "base64");
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_DOCUMENT_BYTES ||
      bytes.toString("base64") !== input.contentBase64) {
      throw new RequestError(413, "DOCUMENT_SIZE_LIMIT", "Upload a valid HTML or PDF document no larger than 2 MB.");
    }
    let source: PolicySourceV1 | undefined;
    try { source = await this.repository.getSource(input.sourceId); }
    catch { throw unavailable(); }
    if (!source) throw new RequestError(404, "SOURCE_NOT_FOUND", "The registered source was not found.");
    try { source = validateOfficialSourceRecord(source); }
    catch { throw unavailable(); }
    let documentUrl: string;
    try {
      documentUrl = input.documentUrl ? canonicalizePolicyUrl(input.documentUrl) : source.canonicalUrl;
      if (new URL(documentUrl).hostname !== new URL(source.canonicalUrl).hostname) {
        throw new RangeError("Different policy document host.");
      }
    } catch {
      throw new RequestError(400, "INVALID_DOCUMENT_URL", "The document URL must use the registered official source host.");
    }
    const documentId = `DOC#${sha256(documentUrl).slice(0, 32)}`;
    let ingested: Awaited<ReturnType<typeof ingestPolicyDocument>>;
    try {
      ingested = await ingestPolicyDocument({ sourceId: source.sourceId, documentId,
        documentVersion: input.version, mimeType: input.mimeType, bytes },
      { maxHtmlBytes: MAX_DOCUMENT_BYTES, maxPdfBytes: MAX_DOCUMENT_BYTES,
        maxPages: Math.min(80, DOCUMENT_INGESTION_LIMITS.maxPages) });
    } catch (error) {
      if (error instanceof DocumentIngestionError) {
        const tooLarge = ["BYTE_LIMIT", "PAGE_LIMIT", "TEXT_LIMIT", "CHUNK_LIMIT"].includes(error.code);
        throw new RequestError(tooLarge ? 413 : 400, error.code, "The document could not be safely extracted within archive limits.");
      }
      throw new RequestError(400, "MALFORMED_DOCUMENT", "The document could not be safely extracted.");
    }
    const now = this.now().toISOString();
    const versionKey = String(input.version).padStart(8, "0");
    const rawKey = `raw/${source.sourceId.slice(4)}/${documentId.slice(4)}/v${versionKey}/${ingested.sha256}${input.mimeType === "application/pdf" ? ".pdf" : ".html"}`;
    const derived = Buffer.from(JSON.stringify({ schemaVersion: 1, sourceId: source.sourceId, documentId,
      documentVersion: input.version, rawSha256: ingested.sha256,
      normalizedTextSha256: ingested.normalizedTextSha256, normalizedText: ingested.normalizedText,
      chunks: ingested.chunks }));
    const derivedHash = sha256(derived);
    const derivedKey = `derived/${source.sourceId.slice(4)}/${documentId.slice(4)}/v${versionKey}/${derivedHash}.json`;
    const provisional = policyDocumentSchema.parse({
      schemaVersion: 1, documentId, sourceId: source.sourceId, sourceRegistryVersion: source.registryVersion,
      version: input.version, title: input.title, documentType: input.documentType, mimeType: input.mimeType,
      canonicalUrl: documentUrl, sha256: ingested.sha256,
      normalizedTextSha256: ingested.normalizedTextSha256, retrievedAt: now,
      publishedAt: input.publishedAt, effectiveFrom: input.effectiveFrom, effectiveTo: input.effectiveTo,
      chunkCount: ingested.chunks.length, s3Key: rawKey, derivedS3Key: derivedKey,
    });
    try { validateSourceDocumentBinding(source, provisional); }
    catch { throw new RequestError(400, "INVALID_DOCUMENT_BINDING", "The document does not match its registered source."); }
    let existing: PolicyDocumentV1 | undefined;
    try { existing = await this.repository.getDocument(source.sourceId, documentId, input.version); }
    catch { throw unavailable(); }
    if (existing) {
      if (!documentMatches(existing, provisional)) throw conflict();
      return { document: policyDocumentSchema.parse(existing), created: false, requestId };
    }
    let rawVersionId: string;
    let derivedVersionId: string;
    try {
      rawVersionId = await this.objects.putImmutable(rawKey, bytes, input.mimeType, ingested.sha256);
      derivedVersionId = await this.objects.putImmutable(derivedKey, derived, "application/json", derivedHash);
    } catch { throw unavailable(); }
    const document = policyDocumentSchema.parse({ ...provisional,
      s3VersionId: rawVersionId, derivedS3VersionId: derivedVersionId });
    try { await this.repository.putDocument(document); }
    catch (error) {
      if (!conditional(error)) throw unavailable();
      try { existing = await this.repository.getDocument(source.sourceId, documentId, input.version); }
      catch { throw unavailable(); }
      if (!existing || !documentMatches(existing, document)) throw conflict();
      return { document: policyDocumentSchema.parse(existing), created: false, requestId };
    }
    return { document, created: true, requestId };
  }
}
