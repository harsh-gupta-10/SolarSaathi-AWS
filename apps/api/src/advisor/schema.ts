import { z } from "zod";
import type { PolicyCitationV1 } from "@solarsaathi/policy";
import { identifier } from "../data/schemas";
import { policyFinancialEstimateRequestSchema } from "../financials/policy-schema";

export const advisorRequestSchema = z.object({
  propertyId: identifier, analysisId: identifier,
  question: z.string().trim().min(3).max(500),
  applicationId: identifier.optional(),
  scenario: z.object({
    demand: policyFinancialEstimateRequestSchema.shape.demand,
    generationKwhPerKwYear: policyFinancialEstimateRequestSchema.shape.generationKwhPerKwYear,
    nominalKw: policyFinancialEstimateRequestSchema.shape.nominalKw,
    financialInputs: policyFinancialEstimateRequestSchema.shape.financialInputs,
    applicantFacts: policyFinancialEstimateRequestSchema.shape.applicantFacts,
    eligibleQuotedCostPaise: policyFinancialEstimateRequestSchema.shape.eligibleQuotedCostPaise,
  }).strict().superRefine((value, context) => {
    if (value.eligibleQuotedCostPaise !== undefined &&
      value.eligibleQuotedCostPaise / 100 > value.financialInputs.grossSystemCostRupees) {
      context.addIssue({ code: "custom", path: ["eligibleQuotedCostPaise"],
        message: "The policy-eligible cost cannot exceed the gross quote." });
    }
  }).optional(),
}).strict();

export type AdvisorRequest = z.infer<typeof advisorRequestSchema>;
export type AdvisorCardKind = "ROOF" | "SYSTEM" | "FINANCIAL" | "BENEFIT" | "APPLICATION";
export type AdvisorProvenance = "GOOGLE_SOLAR" | "USER_MEASURED" | "DETERMINISTIC_CALCULATION" |
  "VERIFIED_POLICY" | "USER_REPORTED";
export interface AdvisorCardV1 {
  id: string;
  kind: AdvisorCardKind;
  statement: string;
  provenance: AdvisorProvenance;
  citations?: PolicyCitationV1[];
  policyId?: string;
  policyVersion?: number;
  jurisdiction?: string;
  effectiveFrom?: string;
  effectiveTo?: string;
  verificationStatus?: "VERIFIED";
  lastVerifiedAt?: string;
  sourceChecks?: Array<{ sourceId: string; lastCheckedAt: string | null; fresh: boolean; status: string }>;
}
export interface AdvisorResponseV1 {
  schemaVersion: 1;
  source: "GROUNDED_ADVISOR_V1";
  requestId: string;
  propertyId: string;
  analysisId: string;
  status: "ANSWERED" | "INSUFFICIENT_CONTEXT";
  mode: "BEDROCK_FACT_SELECTION" | "DETERMINISTIC_FALLBACK";
  answer: string;
  cards: AdvisorCardV1[];
  selectedCardIds: string[];
  caveats: string[];
  missingContext: string[];
}
