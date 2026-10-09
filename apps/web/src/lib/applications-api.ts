import { z } from "zod";
import type { SystemDemand } from "@solarsaathi/calculations";
import { citationSchema, type BenefitApplicantFacts } from "./benefits-api";
import { getAuthenticated, postAuthenticated, RoofRequestError } from "./roof-api";

const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/);
const policyId = z.string().regex(/^POLICY#[A-Za-z0-9_#-]{1,120}$/);
const stepId = z.string().regex(/^[A-Z][A-Z0-9_]{1,63}$/);
const timestamp = z.iso.datetime({ offset: true });
const status = z.enum(["PENDING", "IN_PROGRESS", "COMPLETED", "BLOCKED", "NOT_APPLICABLE"]);
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
    obtainedOn: z.iso.date().optional(), recordedAt: timestamp, verificationStatus: z.literal("USER_REPORTED") })).max(30),
  revision: z.number().int().positive(), createdAt: timestamp, updatedAt: timestamp,
}).strict();
const envelope = { schemaVersion: z.literal(1), source: z.literal("DYNAMODB_APPLICATION_TRACKER_V1"),
  requestId: z.string().min(1) };
const one = z.object({ ...envelope, application: applicationSchema }).strict();
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
  document: async (application: SolarApplication, values: { documentType: string; label: string; obtainedOn?: string },
    signal?: AbortSignal) => check((await postAuthenticated(`${appPath(application.applicationId)}/documents`,
      { propertyId: application.propertyId, expectedRevision: application.revision, ...values }, one, signal)).application,
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
