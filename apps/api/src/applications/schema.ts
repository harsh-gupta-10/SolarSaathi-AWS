import { benefitEvaluationContextSchema, policyCitationSchema, type PolicyCitationV1 } from "@solarsaathi/policy";
import { z } from "zod";
import { identifier } from "../data/schemas";
import { systemDemandSchema } from "../systems/schema";
import { DOCUMENT_CONTENT_TYPES, MAX_DOCUMENT_BYTES } from "./documents";

const text = (max: number) => z.string().trim().min(1).max(max);
const applicationId = identifier;
const stepId = z.string().regex(/^[A-Z][A-Z0-9_]{1,63}$/);
const applicantFacts = benefitEvaluationContextSchema.omit({ systemWatts: true, eligibleQuotedCostPaise: true });

export const createApplicationSchema = z.object({
  propertyId: identifier, analysisId: identifier, policyId: z.string().regex(/^POLICY#[A-Za-z0-9_#-]{1,120}$/),
  demand: systemDemandSchema, generationKwhPerKwYear: z.number().finite().min(500).max(2_500),
  nominalKw: z.number().finite().min(0.1).max(100),
  eligibleQuotedCostPaise: z.number().int().safe().positive().max(1_000_000_000_000).optional(),
  applicantFacts,
}).strict();
export const transitionStepSchema = z.object({
  propertyId: identifier, expectedRevision: z.number().int().positive(),
  status: z.enum(["PENDING", "IN_PROGRESS", "COMPLETED", "BLOCKED", "NOT_APPLICABLE"]),
  note: text(1_000).optional(),
}).strict();
export const updateDetailsSchema = z.object({
  propertyId: identifier, expectedRevision: z.number().int().positive(),
  referenceNumber: text(120).nullable().optional(), vendorName: text(160).nullable().optional(),
}).strict().refine(value => value.referenceNumber !== undefined || value.vendorName !== undefined);
const contentType = z.enum(DOCUMENT_CONTENT_TYPES);
const sizeBytes = z.number().int().min(1).max(MAX_DOCUMENT_BYTES);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
export const addDocumentSchema = z.object({
  propertyId: identifier, expectedRevision: z.number().int().positive(),
  documentType: z.string().regex(/^[A-Z][A-Z0-9_]{1,63}$/), label: text(120),
  obtainedOn: z.iso.date().optional(),
  // Optional file: the API returns a short-lived upload URL; the file is not stored until confirmed.
  file: z.object({ contentType, sizeBytes, sha256 }).strict().optional(),
}).strict();
export const documentActionSchema = z.object({
  propertyId: identifier, expectedRevision: z.number().int().positive(),
  /** Confirm only: when no file has arrived, return a fresh upload link for the same entry instead of an error. */
  reissueUpload: z.boolean().optional(),
}).strict();
export const chatUpdateSchema = z.object({
  propertyId: identifier, stepId,
  message: text(500),
}).strict();

export type ApplicationStepStatus = z.infer<typeof transitionStepSchema>["status"];
export interface ApplicationStepV1 {
  stepId: string; order: number; title: string; description: string; required: boolean;
  citations: PolicyCitationV1[]; status: ApplicationStepStatus; verificationStatus: "USER_REPORTED";
  updatedAt: string; startedAt?: string; completedAt?: string; note?: string;
}
export interface ApplicationDocumentFileV1 {
  objectKey: string; contentType: z.infer<typeof contentType>; sizeBytes: number;
  /** Client-computed SHA-256 (hex), recorded as reported; not verified by the server. */
  sha256Reported: string;
  status: "PENDING_UPLOAD" | "UPLOADED"; uploadedAt?: string; expiresAt?: string;
}
export interface ApplicationDocumentMetadataV1 {
  documentId: string; documentType: string; label: string; obtainedOn?: string;
  recordedAt: string; verificationStatus: "USER_REPORTED"; file?: ApplicationDocumentFileV1;
}
export interface SolarApplicationV1 {
  schemaVersion: 1; applicationId: string; propertyId: string; analysisId: string; createdByUserId: string;
  policyId: string; policyVersion: number; benefitId: string; ruleId: string; jurisdiction: string;
  system: { nominalKw: number; actualDcKw: number }; benefitEvaluatedAt: string;
  benefitCountedAmountPaise: number; lastVerifiedAt: string; policyCitations: PolicyCitationV1[];
  sourceChecks: Array<{ sourceId: string; lastCheckedAt: string | null; fresh: boolean; status: string }>;
  processSource: "VERIFIED_POLICY_SNAPSHOT"; progressSource: "USER_REPORTED";
  status: "IN_PROGRESS" | "BLOCKED" | "COMPLETED"; expectedNextStepId: string | null;
  referenceNumber?: string; vendorName?: string;
  steps: ApplicationStepV1[]; documents: ApplicationDocumentMetadataV1[];
  revision: number; createdAt: string; updatedAt: string;
}
export interface ApplicationEventV1 {
  schemaVersion: 1; eventId: string; applicationId: string; propertyId: string; actorId: string; occurredAt: string;
  action: "CREATED" | "STEP_TRANSITION" | "DETAILS_UPDATED" | "DOCUMENT_RECORDED" | "DOCUMENT_UPLOADED" | "DOCUMENT_DELETED";
  stepId?: string; fromStatus?: ApplicationStepStatus; toStatus?: ApplicationStepStatus;
  note?: string; changedFields?: string[]; documentId?: string;
}

export const storedApplicationSchema: z.ZodType<SolarApplicationV1> = z.object({
  schemaVersion: z.literal(1), applicationId, propertyId: identifier, analysisId: identifier,
  createdByUserId: text(256), policyId: createApplicationSchema.shape.policyId,
  policyVersion: z.number().int().positive(), benefitId: text(128), ruleId: text(128),
  jurisdiction: text(128), system: z.object({ nominalKw: z.number().positive(), actualDcKw: z.number().positive() }).strict(),
  benefitEvaluatedAt: z.iso.datetime({ offset: true }), benefitCountedAmountPaise: z.number().int().nonnegative(),
  lastVerifiedAt: z.iso.datetime({ offset: true }), policyCitations: z.array(policyCitationSchema).min(1).max(50),
  sourceChecks: z.array(z.object({ sourceId: text(128), lastCheckedAt: z.iso.datetime({ offset: true }).nullable(),
    fresh: z.boolean(), status: text(32) }).strict()).min(1).max(50),
  processSource: z.literal("VERIFIED_POLICY_SNAPSHOT"), progressSource: z.literal("USER_REPORTED"),
  status: z.enum(["IN_PROGRESS", "BLOCKED", "COMPLETED"]), expectedNextStepId: stepId.nullable(),
  referenceNumber: text(120).optional(), vendorName: text(160).optional(),
  steps: z.array(z.object({ stepId, order: z.number().int().nonnegative(), title: text(120), description: text(1_000),
    required: z.boolean(), citations: z.array(policyCitationSchema).min(1).max(20),
    status: transitionStepSchema.shape.status, verificationStatus: z.literal("USER_REPORTED"),
    updatedAt: z.iso.datetime({ offset: true }), startedAt: z.iso.datetime({ offset: true }).optional(),
    completedAt: z.iso.datetime({ offset: true }).optional(), note: text(1_000).optional() }).strict()).min(1).max(20),
  documents: z.array(z.object({ documentId: identifier, documentType: addDocumentSchema.shape.documentType,
    label: text(120), obtainedOn: z.iso.date().optional(), recordedAt: z.iso.datetime({ offset: true }),
    verificationStatus: z.literal("USER_REPORTED"), file: z.object({
      objectKey: z.string().regex(/^applications\/[a-f0-9]{32}\/[A-Za-z0-9][A-Za-z0-9_-]{0,127}\/[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/),
      contentType, sizeBytes, sha256Reported: sha256, status: z.enum(["PENDING_UPLOAD", "UPLOADED"]),
      uploadedAt: z.iso.datetime({ offset: true }).optional(), expiresAt: z.iso.datetime({ offset: true }).optional(),
    }).strict().optional() }).strict()).max(30),
  revision: z.number().int().positive(), createdAt: z.iso.datetime({ offset: true }), updatedAt: z.iso.datetime({ offset: true }),
}).strict();
