import { z } from "zod";
import type { SystemDemand } from "@solarsaathi/calculations";
import { citationSchema, type BenefitApplicantFacts } from "./benefits-api";
import { deleteAuthenticated, getAuthenticated, postAuthenticated, RoofRequestError } from "./roof-api";

const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/);
const policyId = z.string().regex(/^POLICY#[A-Za-z0-9_#-]{1,120}$/);
const stepId = z.string().regex(/^[A-Z][A-Z0-9_]{1,63}$/);
const timestamp = z.iso.datetime({ offset: true });
const status = z.enum(["PENDING", "IN_PROGRESS", "COMPLETED", "BLOCKED", "NOT_APPLICABLE"]);
export const DOCUMENT_CONTENT_TYPES = ["application/pdf", "image/jpeg", "image/png"] as const;
export type DocumentContentType = typeof DOCUMENT_CONTENT_TYPES[number];
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
const documentFile = z.object({ objectKey: z.string().min(1), contentType: z.enum(DOCUMENT_CONTENT_TYPES),
  sizeBytes: z.number().int().positive().max(MAX_DOCUMENT_BYTES), sha256Reported: z.string().regex(/^[a-f0-9]{64}$/),
  status: z.enum(["PENDING_UPLOAD", "UPLOADED"]), uploadedAt: timestamp.optional(), expiresAt: timestamp.optional() }).strict();
const applicationSchema = z.object({
  schemaVersion: z.literal(1), applicationId: id, propertyId: id, analysisId: id,
  createdByUserId: z.string().min(1), policyId, policyVersion: z.number().int().positive(),
  benefitId: z.string().min(1), ruleId: z.string().min(1), jurisdiction: z.string().min(1),
  system: z.object({ nominalKw: z.number().positive(), actualDcKw: z.number().positive() }),
  benefitEvaluatedAt: timestamp, benefitCountedAmountPaise: z.number().int().nonnegative(),
  lastVerifiedAt: timestamp, policyCitations: z.array(citationSchema).min(1).max(50),
  sourceChecks: z.array(z.object({ sourceId: z.string().min(1), lastCheckedAt: timestamp.nullable(),
    fresh: z.boolean(), status: z.string().min(1) })).min(1).max(50),
  processSource: z.literal("VERIFIED_POLICY_SNAPSHOT"), progressSource: z.literal("USER_REPORTED"),
  status: z.enum(["IN_PROGRESS", "BLOCKED", "COMPLETED"]), expectedNextStepId: stepId.nullable(),
  referenceNumber: z.string().min(1).optional(), vendorName: z.string().min(1).optional(),
  steps: z.array(z.object({ stepId, order: z.number().int().positive(), title: z.string().min(1),
    description: z.string().min(1), required: z.boolean(), citations: z.array(citationSchema).min(1).max(20),
    status, verificationStatus: z.literal("USER_REPORTED"), updatedAt: timestamp,
    startedAt: timestamp.optional(), completedAt: timestamp.optional(), note: z.string().min(1).optional(),
  })).min(1).max(20),
  documents: z.array(z.object({ documentId: id, documentType: stepId, label: z.string().min(1),
    obtainedOn: z.iso.date().optional(), recordedAt: timestamp, verificationStatus: z.literal("USER_REPORTED"),
    file: documentFile.optional() })).max(30),
  revision: z.number().int().positive(), createdAt: timestamp, updatedAt: timestamp,
}).strict();
const envelope = { schemaVersion: z.literal(1), source: z.literal("DYNAMODB_APPLICATION_TRACKER_V1"),
  requestId: z.string().min(1) };
const one = z.object({ ...envelope, application: applicationSchema }).strict();
const uploadTicket = z.object({ url: z.url(), method: z.literal("PUT"), headers: z.record(z.string(), z.string()),
  expiresAt: timestamp }).strict();
const documentAdded = z.object({ ...envelope, application: applicationSchema, upload: uploadTicket.optional() }).strict();
const documentDownload = z.object({ ...envelope, download: z.object({ url: z.url(), expiresAt: timestamp }).strict() }).strict();
const list = z.object({ ...envelope, applications: z.array(applicationSchema).max(30),
  nextCursor: z.string().optional() }).strict();
const chatSuggestion = z.object({ ...envelope, action: z.literal("CONFIRMATION_REQUIRED"),
  requiresConfirmation: z.literal(true), messageStored: z.literal(false), applicationId: id,
  stepId, stepTitle: z.string().min(1), currentStatus: status, proposedStatus: status.nullable(),
  suggestedNote: z.string(), revision: z.number().int().positive(), allowedStatuses: z.array(status) }).strict();
const propertyList = z.object({ schemaVersion: z.literal(1), source: z.literal("DYNAMODB"),
  requestId: z.string().min(1), properties: z.array(z.object({ propertyId: id, label: z.string(),
    address: z.string() }).passthrough()), nextCursor: z.string().optional() });

export type SolarApplication = z.infer<typeof applicationSchema>;
export type UploadTicket = z.infer<typeof uploadTicket>;

/** Presigned URLs must point at S3 over HTTPS; anything else is refused rather than sent the file. */
function s3Url(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:" || !/(^|\.)amazonaws\.com$/.test(url.hostname)) {
    throw new RoofRequestError("INVALID_RESPONSE", "The document service returned an unexpected storage address.");
  }
  return url;
}
async function sha256Hex(file: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}
export function documentFileProblem(file: File): string | undefined {
  if (!(DOCUMENT_CONTENT_TYPES as readonly string[]).includes(file.type)) return "Choose a PDF, JPEG or PNG file.";
  if (file.size === 0) return "The selected file is empty.";
  if (file.size > MAX_DOCUMENT_BYTES) return "Choose a file of 10 MB or less.";
  return undefined;
}
export type ApplicationStepStatus = z.infer<typeof status>;
export type PropertyChoice = z.infer<typeof propertyList>["properties"][number];
export interface CreateApplicationInput {
  propertyId: string; analysisId: string; policyId: string; demand: SystemDemand;
  generationKwhPerKwYear: number; nominalKw: number; applicantFacts: BenefitApplicantFacts;
  eligibleQuotedCostPaise?: number;
}
function check(response: SolarApplication, propertyId: string, applicationId?: string) {
  if (response.propertyId !== propertyId || applicationId && response.applicationId !== applicationId) {
    throw new RoofRequestError("INVALID_RESPONSE", "The application service returned a different property or tracker.");
  }
  return response;
}
const appPath = (applicationId: string) => `/applications/${encodeURIComponent(applicationId)}`;
const propertyQuery = (propertyId: string, cursor?: string) => `?propertyId=${encodeURIComponent(propertyId)}` +
  (cursor ? `&cursor=${encodeURIComponent(cursor)}` : "");

async function putToS3(upload: UploadTicket, file: File, signal?: AbortSignal) {
  const failed = "The file could not be uploaded. The document is saved as unfinished; choose the file again to retry, or delete it.";
  let uploaded: Response;
  try {
    uploaded = await fetch(s3Url(upload.url), { method: "PUT", headers: upload.headers, body: file,
      credentials: "omit", redirect: "error", cache: "no-store", signal });
  } catch (error) {
    if (error instanceof RoofRequestError) throw error;
    throw new RoofRequestError("UPLOAD_FAILED", failed);
  }
  if (!uploaded.ok) throw new RoofRequestError("UPLOAD_FAILED", failed);
}

export const applicationsApi = {
  properties: (cursor?: string, signal?: AbortSignal) => getAuthenticated(`/properties?limit=50` +
    (cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""), propertyList, signal),
  list: async (propertyId: string, cursor?: string, signal?: AbortSignal) => {
    const response = await getAuthenticated(`/applications${propertyQuery(propertyId, cursor)}`, list, signal);
    if (response.applications.some(item => item.propertyId !== propertyId)) {
      throw new RoofRequestError("INVALID_RESPONSE", "The application list belongs to a different property.");
    }
    return response;
  },
  get: async (propertyId: string, applicationId: string, signal?: AbortSignal) =>
    check((await getAuthenticated(`${appPath(applicationId)}${propertyQuery(propertyId)}`, one, signal)).application,
      propertyId, applicationId),
  create: async (input: CreateApplicationInput, signal?: AbortSignal) =>
    check((await postAuthenticated("/applications", input, one, signal, 30_000)).application, input.propertyId),
  transition: async (application: SolarApplication, stepIdValue: string, next: ApplicationStepStatus,
    note?: string, signal?: AbortSignal) => check((await postAuthenticated(`${appPath(application.applicationId)}/steps/${encodeURIComponent(stepIdValue)}`,
      { propertyId: application.propertyId, expectedRevision: application.revision, status: next,
        ...(note ? { note } : {}) }, one, signal)).application, application.propertyId, application.applicationId),
  details: async (application: SolarApplication, values: { referenceNumber?: string | null; vendorName?: string | null },
    signal?: AbortSignal) => check((await postAuthenticated(`${appPath(application.applicationId)}/details`,
      { propertyId: application.propertyId, expectedRevision: application.revision, ...values }, one, signal)).application,
      application.propertyId, application.applicationId),
  document: async (application: SolarApplication, values: { documentType: string; label: string; obtainedOn?: string;
    file?: { contentType: DocumentContentType; sizeBytes: number; sha256: string } }, signal?: AbortSignal) => {
    const response = await postAuthenticated(`${appPath(application.applicationId)}/documents`,
      { propertyId: application.propertyId, expectedRevision: application.revision, ...values }, documentAdded, signal);
    return { application: check(response.application, application.propertyId, application.applicationId), upload: response.upload };
  },
  /** Records the document, sends the file straight to S3 with the short-lived URL, then asks the API to confirm it. */
  uploadDocument: async (application: SolarApplication, values: { documentType: string; label: string; obtainedOn?: string },
    file: File, signal?: AbortSignal) => {
    const problem = documentFileProblem(file);
    if (problem) throw new RoofRequestError("INVALID_FILE", problem);
    const contentType = file.type as DocumentContentType;
    const added = await applicationsApi.document(application, { ...values,
      file: { contentType, sizeBytes: file.size, sha256: await sha256Hex(file) } }, signal);
    const document = added.application.documents.at(-1);
    if (!added.upload || !document?.file) throw new RoofRequestError("INVALID_RESPONSE", "The document service did not return an upload address.");
    await putToS3(added.upload, file, signal);
    return applicationsApi.confirmDocument(added.application, document.documentId, signal);
  },
  /** Retries an unfinished upload for an existing pending entry with a fresh link. The file must match the entry. */
  retryUpload: async (application: SolarApplication, documentId: string, file: File, signal?: AbortSignal) => {
    const pending = application.documents.find(item => item.documentId === documentId)?.file;
    if (!pending || pending.status !== "PENDING_UPLOAD") throw new RoofRequestError("NO_PENDING_UPLOAD", "This document has no unfinished upload.");
    if (file.type !== pending.contentType || file.size !== pending.sizeBytes) {
      throw new RoofRequestError("INVALID_FILE", "Choose the same file you started uploading (same type and size), or delete this entry and add it again.");
    }
    const response = await postAuthenticated(`${appPath(application.applicationId)}/documents/${encodeURIComponent(documentId)}/confirm`,
      { propertyId: application.propertyId, expectedRevision: application.revision, reissueUpload: true }, documentAdded, signal, 20_000);
    const current = check(response.application, application.propertyId, application.applicationId);
    // No new link means the earlier upload did arrive and the entry is now confirmed.
    if (!response.upload) return current;
    await putToS3(response.upload, file, signal);
    return applicationsApi.confirmDocument(current, documentId, signal);
  },
  confirmDocument: async (application: SolarApplication, documentId: string, signal?: AbortSignal) =>
    check((await postAuthenticated(`${appPath(application.applicationId)}/documents/${encodeURIComponent(documentId)}/confirm`,
      { propertyId: application.propertyId, expectedRevision: application.revision }, documentAdded, signal, 20_000)).application,
    application.propertyId, application.applicationId),
  documentDownloadUrl: async (application: SolarApplication, documentId: string, signal?: AbortSignal) => {
    const response = await getAuthenticated(`${appPath(application.applicationId)}/documents/${encodeURIComponent(documentId)}/download${propertyQuery(application.propertyId)}`,
      documentDownload, signal);
    return s3Url(response.download.url).toString();
  },
  deleteDocument: async (application: SolarApplication, documentId: string, signal?: AbortSignal) =>
    check((await deleteAuthenticated(`${appPath(application.applicationId)}/documents/${encodeURIComponent(documentId)}` +
      `${propertyQuery(application.propertyId)}&expectedRevision=${application.revision}`, one, signal)).application,
    application.propertyId, application.applicationId),
  chatSuggestion: async (application: SolarApplication, stepIdValue: string, message: string,
    signal?: AbortSignal) => {
    const response = await postAuthenticated(`${appPath(application.applicationId)}/chat-update`,
      { propertyId: application.propertyId, stepId: stepIdValue, message }, chatSuggestion, signal);
    if (response.applicationId !== application.applicationId || response.stepId !== stepIdValue) {
      throw new RoofRequestError("INVALID_RESPONSE", "The update suggestion belongs to a different application step.");
    }
    return response;
  },
};
