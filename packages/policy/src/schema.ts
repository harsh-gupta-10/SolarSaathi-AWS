import { z } from "zod";

const identifier = (prefix: string) => z.string().regex(new RegExp(`^${prefix}#[A-Za-z0-9][A-Za-z0-9#_-]{0,127}$`));
const timestamp = z.iso.datetime({ offset: true });
const date = z.iso.date();
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const hostname = z.string().regex(/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/).max(253);
const httpsUrl = z.url().refine(raw => {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && !url.username && !url.password && !url.hash && hostname.safeParse(url.hostname).success;
  } catch { return false; }
}, "A public HTTPS URL without credentials or fragment is required.");

export const policyJurisdictionSchema = z.string().regex(/^[A-Z]{2}(?:-[A-Z0-9]{1,8}){0,3}$/);
export const policyCategorySchema = z.enum([
  "CENTRAL_SUBSIDY", "STATE_SUBSIDY", "DISCOM_INCENTIVE", "LOCAL_BODY_INCENTIVE", "REGULATORY_BENEFIT",
  "NET_METERING", "FINANCING", "TAX_OR_FINANCIAL_BENEFIT", "VENDOR_REQUIREMENT", "ELIGIBILITY",
  "DOCUMENT_REQUIREMENT", "APPLICATION_PROCESS", "DEADLINE", "CAPACITY_LIMIT", "EQUIPMENT_REQUIREMENT", "OTHER",
]);
export const policySourceTypeSchema = z.enum([
  "GOVERNMENT", "MNRE", "SCHEME_PORTAL", "STATE_ENERGY_DEPARTMENT", "DISCOM", "REGULATOR",
  "RENEWABLE_AGENCY", "OFFICIAL_NOTIFICATION", "GOVERNMENT_TECHNICAL", "OFFICIAL_INSTITUTION",
  "INDUSTRY", "NEWS", "BLOG", "FORUM", "OTHER",
]);
export const policyVerificationStatusSchema = z.enum([
  "UNVERIFIED", "REVIEWED", "VERIFIED", "CONFLICTED", "STALE", "REJECTED",
]);
export const policySourceRegistryStatusSchema = z.enum(["PROPOSED", "CURATED", "SUSPENDED"]);
export const policySourceHealthStatusSchema = z.enum(["UNKNOWN", "HEALTHY", "DEGRADED", "STALE", "FAILED"]);
export const policyDocumentTypeSchema = z.enum([
  "STATUTE", "SCHEME_NOTIFICATION", "GUIDELINE", "CIRCULAR", "AMENDMENT", "OFFICIAL_WEBPAGE",
  "TECHNICAL_DOCUMENT", "ARTICLE", "OTHER",
]);
export const policyVersionStatusSchema = z.enum([
  "DETECTED", "EXTRACTED", "VALIDATED", "PENDING_APPROVAL", "APPROVED", "ACTIVE", "REJECTED", "SUPERSEDED",
]);

export type PolicySourceType = z.infer<typeof policySourceTypeSchema>;
export type PolicyCategory = z.infer<typeof policyCategorySchema>;
export type PolicyVerificationStatus = z.infer<typeof policyVerificationStatusSchema>;
export type PolicyVersionStatus = z.infer<typeof policyVersionStatusSchema>;

/** Source type fixes the tier; an API caller cannot self-assign a stronger tier. */
export const SOURCE_TYPE_AUTHORITY_TIER_V1: Readonly<Record<PolicySourceType, 1 | 2 | 3 | 4>> = Object.freeze({
  GOVERNMENT: 1, MNRE: 1, SCHEME_PORTAL: 1, STATE_ENERGY_DEPARTMENT: 1, DISCOM: 1,
  REGULATOR: 1, RENEWABLE_AGENCY: 1, OFFICIAL_NOTIFICATION: 1,
  GOVERNMENT_TECHNICAL: 2, OFFICIAL_INSTITUTION: 2,
  INDUSTRY: 3, NEWS: 4, BLOG: 4, FORUM: 4, OTHER: 4,
});

export const policySourceSchema = z.object({
  schemaVersion: z.literal(1), sourceId: identifier("SRC"), registryVersion: z.number().int().positive(),
  name: z.string().trim().min(1).max(200), publisherName: z.string().trim().min(1).max(200),
  jurisdiction: policyJurisdictionSchema, sourceType: policySourceTypeSchema,
  authorityTier: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  registryStatus: policySourceRegistryStatusSchema, healthStatus: policySourceHealthStatusSchema,
  canonicalUrl: httpsUrl, allowedHosts: z.array(hostname).min(1).max(20),
  crawlFrequency: z.enum(["DAILY", "WEEKLY", "MONTHLY", "ON_DEMAND"]),
  enabled: z.boolean(), freshnessWindowHours: z.number().int().min(1).max(8_760),
  lastCheckedAt: timestamp.optional(), lastChangedAt: timestamp.optional(), contentHash: sha256.optional(),
  curatedAt: timestamp.optional(), curatorId: z.string().min(1).max(128).optional(),
  createdAt: timestamp, updatedAt: timestamp,
}).strict().superRefine((source, context) => {
  if (source.authorityTier !== SOURCE_TYPE_AUTHORITY_TIER_V1[source.sourceType]) {
    context.addIssue({ code: "custom", path: ["authorityTier"], message: "Authority tier does not match source type." });
  }
  if (!source.allowedHosts.includes(new URL(source.canonicalUrl).hostname)) {
    context.addIssue({ code: "custom", path: ["allowedHosts"], message: "Canonical URL host must be allowed." });
  }
  if (source.registryStatus === "CURATED" && (!source.curatedAt || !source.curatorId)) {
    context.addIssue({ code: "custom", path: ["curatedAt"], message: "Curation must identify reviewer and time." });
  }
  if (source.enabled && source.registryStatus !== "CURATED") {
    context.addIssue({ code: "custom", path: ["enabled"], message: "Only curated sources may be enabled." });
  }
});

export const policyLocatorSchema = z.object({
  pageNumber: z.number().int().positive().optional(), section: z.string().trim().min(1).max(200).optional(),
  fragment: z.string().trim().min(1).max(200).optional(),
  charStart: z.number().int().nonnegative().optional(), charEnd: z.number().int().nonnegative().optional(),
}).strict().refine(value => value.pageNumber !== undefined || value.section !== undefined ||
  value.fragment !== undefined || value.charStart !== undefined, "A source locator is required.")
  .refine(value => value.charStart === undefined || value.charEnd === undefined || value.charEnd > value.charStart,
    "Character end must follow start.");

export const policyDocumentSchema = z.object({
  schemaVersion: z.literal(1), documentId: identifier("DOC"), sourceId: identifier("SRC"),
  sourceRegistryVersion: z.number().int().positive(), version: z.number().int().positive(),
  title: z.string().trim().min(1).max(300), documentType: policyDocumentTypeSchema,
  mimeType: z.enum(["text/html", "application/pdf"]), canonicalUrl: httpsUrl,
  sha256, normalizedTextSha256: sha256.optional(), retrievedAt: timestamp,
  publishedAt: date.optional(), effectiveFrom: date.optional(), effectiveTo: date.optional(),
  amendsDocumentId: identifier("DOC").optional(), s3Key: z.string().min(1).max(1_024).optional(),
  s3VersionId: z.string().min(1).max(1_024).optional(),
  derivedS3Key: z.string().min(1).max(1_024).optional(), derivedS3VersionId: z.string().min(1).max(1_024).optional(),
  chunkCount: z.number().int().nonnegative().optional(),
}).strict().refine(value => !value.effectiveTo || !value.effectiveFrom || value.effectiveFrom <= value.effectiveTo,
  "Document effective range is inverted.");

export const policyDocumentChunkSchema = z.object({
  schemaVersion: z.literal(1), chunkId: identifier("CHUNK"), sourceId: identifier("SRC"),
  documentId: identifier("DOC"), documentVersion: z.number().int().positive(), index: z.number().int().nonnegative(),
  text: z.string().trim().min(1).max(20_000), sha256, locator: policyLocatorSchema,
}).strict();

export const policyCitationSchema = z.object({
  schemaVersion: z.literal(1), sourceId: identifier("SRC"), sourceRegistryVersion: z.number().int().positive(),
  documentId: identifier("DOC"), documentVersion: z.number().int().positive(), documentSha256: sha256,
  publisherName: z.string().trim().min(1).max(200), documentTitle: z.string().trim().min(1).max(300),
  sourceUrl: httpsUrl, retrievedAt: timestamp, publishedAt: date.optional(), effectiveFrom: date.optional(),
  locator: policyLocatorSchema,
}).strict();

export const policyFactValueSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("NUMBER"), amount: z.number().finite(), unit: z.enum([
    "INR", "INR_PER_KW", "PERCENT", "KW", "KWH", "DAYS", "YEARS", "COUNT",
  ]) }).strict(),
  z.object({ kind: z.literal("TEXT"), text: z.string().trim().min(1).max(2_000) }).strict(),
  z.object({ kind: z.literal("BOOLEAN"), value: z.boolean() }).strict(),
  z.object({ kind: z.literal("DATE"), value: date }).strict(),
]);

export const policyFactSchema = z.object({
  schemaVersion: z.literal(1), factId: identifier("FACT"), policyId: identifier("POLICY"),
  policyVersion: z.number().int().positive(), category: policyCategorySchema, jurisdiction: policyJurisdictionSchema,
  claimKey: z.string().regex(/^[a-z][a-z0-9_.-]{1,120}$/),
  statement: z.string().trim().min(1).max(4_000), value: policyFactValueSchema.optional(),
  effectiveFrom: date, effectiveTo: date.optional(), citation: policyCitationSchema,
  verificationStatus: policyVerificationStatusSchema, confidence: z.number().finite().min(0).max(1).optional(),
  lastVerifiedAt: timestamp.optional(), verifiedBy: z.string().min(1).max(128).optional(),
  recordedAt: timestamp,
}).strict().superRefine((fact, context) => {
  if (fact.effectiveTo && fact.effectiveTo < fact.effectiveFrom) {
    context.addIssue({ code: "custom", path: ["effectiveTo"], message: "Fact effective range is inverted." });
  }
  if (fact.verificationStatus === "VERIFIED" && (!fact.lastVerifiedAt || !fact.verifiedBy)) {
    context.addIssue({ code: "custom", path: ["verificationStatus"], message: "Verified facts require reviewer and time." });
  }
});

export const policyVersionSchema = z.object({
  schemaVersion: z.literal(1), policyId: identifier("POLICY"), version: z.number().int().positive(),
  previousVersion: z.number().int().positive().optional(), category: policyCategorySchema,
  jurisdiction: policyJurisdictionSchema, status: policyVersionStatusSchema,
  verificationStatus: policyVerificationStatusSchema, effectiveFrom: date, effectiveTo: date.optional(),
  factIds: z.array(identifier("FACT")).max(500), documentRefs: z.array(z.object({
    sourceId: identifier("SRC"), documentId: identifier("DOC"), documentVersion: z.number().int().positive(),
    sha256,
  }).strict()).min(1).max(100), contentHash: sha256,
  createdAt: timestamp, createdBy: z.string().min(1).max(128),
  lastVerifiedAt: timestamp.optional(), verifiedBy: z.string().min(1).max(128).optional(),
  approvedAt: timestamp.optional(), approvedBy: z.string().min(1).max(128).optional(),
  activatedAt: timestamp.optional(),
}).strict().superRefine((version, context) => {
  if (version.previousVersion !== undefined && version.previousVersion !== version.version - 1) {
    context.addIssue({ code: "custom", path: ["previousVersion"], message: "Previous version must be consecutive." });
  }
  if (version.version > 1 && version.previousVersion === undefined) {
    context.addIssue({ code: "custom", path: ["previousVersion"], message: "Later versions need a predecessor." });
  }
  if (version.effectiveTo && version.effectiveTo < version.effectiveFrom) {
    context.addIssue({ code: "custom", path: ["effectiveTo"], message: "Policy effective range is inverted." });
  }
  if (version.verificationStatus === "VERIFIED" && (!version.lastVerifiedAt || !version.verifiedBy)) {
    context.addIssue({ code: "custom", path: ["verificationStatus"], message: "Verified versions require reviewer and time." });
  }
  if (["APPROVED", "ACTIVE", "SUPERSEDED"].includes(version.status) && (!version.approvedAt || !version.approvedBy)) {
    context.addIssue({ code: "custom", path: ["approvedAt"], message: "Approval requires reviewer and time." });
  }
  if (["ACTIVE", "SUPERSEDED"].includes(version.status) && !version.activatedAt) {
    context.addIssue({ code: "custom", path: ["activatedAt"], message: "Activation time is required." });
  }
});

export const policyVersionEventSchema = z.object({
  schemaVersion: z.literal(1), eventId: z.string().uuid(), policyId: identifier("POLICY"),
  policyVersion: z.number().int().positive(), fromStatus: policyVersionStatusSchema,
  toStatus: policyVersionStatusSchema, actorId: z.string().min(1).max(128), occurredAt: timestamp,
  reason: z.string().trim().min(1).max(1_000).optional(),
}).strict();

export type PolicySourceV1 = z.infer<typeof policySourceSchema>;
export type PolicyDocumentV1 = z.infer<typeof policyDocumentSchema>;
export type PolicyDocumentChunkV1 = z.infer<typeof policyDocumentChunkSchema>;
export type PolicyLocatorV1 = z.infer<typeof policyLocatorSchema>;
export type PolicyCitationV1 = z.infer<typeof policyCitationSchema>;
export type PolicyFactV1 = z.infer<typeof policyFactSchema>;
export type PolicyVersionV1 = z.infer<typeof policyVersionSchema>;
export type PolicyVersionEventV1 = z.infer<typeof policyVersionEventSchema>;
