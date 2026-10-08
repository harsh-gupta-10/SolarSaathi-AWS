import { z } from "zod";
import type { SystemDemand } from "@solarsaathi/calculations";
import { postAuthenticated, RoofRequestError } from "./roof-api";

const identifier = z.string().regex(/^(?:BENEFIT|RULE|POLICY|FACT|SRC|DOC)#[A-Za-z0-9][A-Za-z0-9#_-]{0,127}$/);
const timestamp = z.iso.datetime({ offset: true });
const code = z.string().regex(/^[A-Z0-9][A-Z0-9_-]{0,63}$/);
const paise = z.number().int().safe().nonnegative().max(1_000_000_000_000);
const citation = z.object({
  schemaVersion: z.literal(1), sourceId: identifier, sourceRegistryVersion: z.number().int().positive(),
  documentId: identifier, documentVersion: z.number().int().positive(),
  documentSha256: z.string().regex(/^[a-f0-9]{64}$/), publisherName: z.string().min(1),
  documentTitle: z.string().min(1), sourceUrl: z.url().refine(value => {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.hash;
  }), retrievedAt: timestamp, publishedAt: z.iso.date().optional(), effectiveFrom: z.iso.date().optional(),
  locator: z.object({ pageNumber: z.number().int().positive().optional(), section: z.string().optional(),
    fragment: z.string().optional(), charStart: z.number().int().nonnegative().optional(),
    charEnd: z.number().int().nonnegative().optional() }),
});
const decision = z.object({
  benefitId: identifier, ruleId: identifier, scope: z.enum(["CENTRAL", "STATE", "DISCOM", "LOCAL", "OTHER"]),
  jurisdiction: z.string().regex(/^[A-Z]{2}(?:-[A-Z0-9]{1,8}){0,3}$/),
  effectiveFrom: z.iso.date(), effectiveTo: z.iso.date().optional(),
  status: z.enum(["SELECTED", "INELIGIBLE", "UNKNOWN", "EXCLUDED"]), reasonCodes: z.array(code).max(30),
  calculatedAmountPaise: paise.optional(), countedAmountPaise: paise.optional(), policyId: identifier,
  policyVersion: z.number().int().positive(), factIds: z.array(identifier).min(1).max(50),
  citations: z.array(citation).min(1).max(50), sourceChecks: z.array(z.object({
    sourceId: identifier, lastCheckedAt: timestamp.nullable(), fresh: z.boolean(),
    status: z.enum(["HEALTHY", "DEGRADED", "STALE", "FAILED", "UNKNOWN"]),
  })).min(1), verificationStatus: z.literal("VERIFIED"), lastVerifiedAt: timestamp,
});
const stackResult = z.object({
  schemaVersion: z.literal(1), source: z.literal("DETERMINISTIC_BENEFIT_STACK_V1"),
  evaluatedAt: timestamp, totalEligibleBenefitPaise: paise, coverageComplete: z.boolean(),
  optimalWithinVerifiedRules: z.boolean(), decisions: z.array(decision).max(16),
  warnings: z.array(code).max(30),
});
const coverage = z.object({ central: z.boolean(), state: z.boolean(), discom: z.boolean(),
  local: z.boolean(), other: z.boolean() });
export const benefitEvaluationResponseSchema = z.object({
  schemaVersion: z.literal(1), source: z.literal("DETERMINISTIC_BENEFIT_STACK_V1"),
  status: z.enum(["AVAILABLE", "UNAVAILABLE"]), requestId: z.string().min(1),
  applicantFactsSource: z.literal("USER_DECLARED"), eligibilityNotGuaranteed: z.literal(true),
  propertyId: z.string().min(1), analysisId: z.string().min(1),
  system: z.object({ nominalKw: z.number().finite().positive(), actualDcKw: z.number().finite().positive() }),
  evaluatedAt: timestamp, coverage, result: stackResult.optional(), reasonCodes: z.array(code).optional(),
}).superRefine((value, context) => {
  if ((value.status === "AVAILABLE") !== !!value.result) context.addIssue({ code: "custom", path: ["result"],
    message: "Available evaluations require a result, unavailable ones cannot contain one." });
});

export type BenefitEvaluationResponse = z.infer<typeof benefitEvaluationResponseSchema>;
export interface BenefitApplicantFacts {
  country: "IN";
  state?: string;
  district?: string;
  localBody?: string;
  discom?: string;
  customerType?: "RESIDENTIAL" | "COMMERCIAL" | "INDUSTRIAL" | "AGRICULTURAL" | "OTHER";
  propertyType?: "INDIVIDUAL_HOME" | "APARTMENT" | "HOUSING_SOCIETY" | "BUSINESS" | "OTHER";
  ownership?: "OWNER" | "TENANT" | "SOCIETY" | "OTHER";
  gridConnected?: boolean;
  priorSubsidyReceived?: boolean;
  vendorApproved?: boolean;
  equipmentApproved?: boolean;
  sanctionedLoadWatts?: number;
  installationDate?: string;
  applicationDate?: string;
  participatingSchemeIds?: string[];
}

export const benefitsApi = {
  evaluate: async (propertyId: string, analysisId: string, demand: SystemDemand,
    generationKwhPerKwYear: number, nominalKw: number, eligibleQuotedCostPaise: number | undefined,
    applicantFacts: BenefitApplicantFacts, signal?: AbortSignal): Promise<BenefitEvaluationResponse> => {
    const response = await postAuthenticated("/benefits/evaluate", {
      propertyId, analysisId, demand, generationKwhPerKwYear, nominalKw,
      ...(eligibleQuotedCostPaise === undefined ? {} : { eligibleQuotedCostPaise }), applicantFacts,
    }, benefitEvaluationResponseSchema, signal);
    if (response.propertyId !== propertyId || response.analysisId !== analysisId ||
      response.system.nominalKw !== nominalKw || response.result?.evaluatedAt !== undefined &&
      response.result.evaluatedAt !== response.evaluatedAt) {
      throw new RoofRequestError("INVALID_RESPONSE", "The benefit service returned a different analysis or system. Try again.");
    }
    return response;
  },
};
