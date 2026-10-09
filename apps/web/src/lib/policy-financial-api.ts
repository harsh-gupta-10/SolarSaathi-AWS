import { z } from "zod";
import type { SystemDemand } from "@solarsaathi/calculations";
import { postAuthenticated, RoofRequestError } from "./roof-api";
import { baseFinancialResultSchema, baseFinancialYearSchema, type FinancialInputs } from "./financial-api";
import { benefitEvaluationResponseSchema, type BenefitApplicantFacts } from "./benefits-api";
import { systemCandidateSchema } from "./system-api";

const finite = z.number().finite();
const paise = z.number().int().safe().nonnegative().max(1_000_000_000_000);
const identifier = z.string().regex(/^(?:BENEFIT|RULE|POLICY|SRC)#[A-Za-z0-9][A-Za-z0-9#_-]{0,127}$/);
const code = z.string().regex(/^[A-Z0-9][A-Z0-9_-]{0,63}$/);
const projectedSchema = z.object({
  schemaVersion: z.literal(1), source: z.literal("DETERMINISTIC_POLICY_FINANCIAL_V1"),
  status: z.enum(["PARTIAL", "COMPLETE"]), timingAssumption: z.literal("BENEFITS_MODELED_UPFRONT"),
  policyBenefitsEvaluated: z.literal(true), financingModeled: z.literal(false), horizonYears: z.literal(25),
  grossCostPaise: paise, selectedByScopePaise: z.object({ CENTRAL: paise, STATE: paise, DISCOM: paise,
    LOCAL: paise, OTHER: paise }), totalEligibleBenefitPaise: paise, modeledUpfrontBenefitPaise: paise,
  excessBenefitPaise: paise, nonUpfrontBenefitPaise: paise, netUpfrontCostPaise: paise, initialCashFlowRupees: finite,
  annualRows: z.array(baseFinancialYearSchema.extend({ baseCumulativeCashFlowRupees: finite })).length(25),
  totals: z.object({ paybackYears: finite.nonnegative().nullable(), netSavingsOver25YearsRupees: finite,
    yearOneNetCashFlowRupees: finite }), coverageComplete: z.boolean(),
  provenance: z.object({ benefitEvaluatedAt: z.iso.datetime({ offset: true }), optimalWithinVerifiedRules: z.literal(true),
    selectedPolicies: z.array(z.object({ benefitId: identifier, ruleId: identifier, policyId: identifier,
      policyVersion: z.number().int().positive(), sourceIds: z.array(identifier).min(1),
      lastVerifiedAt: z.iso.datetime({ offset: true }) })).min(1).max(16) }),
  baseWarnings: z.array(z.enum(["AVOIDABLE_IMPORT_TARIFF_ASSUMED", "EXPORT_SETTLEMENT_UNVERIFIED",
    "ANNUAL_CONSUMPTION_HELD_FLAT", "GENERATION_USES_ASSUMED_YIELD", "NO_PAYBACK_WITHIN_25_YEARS"])),
  warnings: z.array(z.enum(["BENEFIT_PAYMENT_TIMING_UNVERIFIED", "POLICY_COVERAGE_INCOMPLETE",
    "BENEFIT_AMOUNT_UNKNOWN", "BENEFITS_EXCEED_GROSS_QUOTE", "NO_PAYBACK_WITHIN_25_YEARS",
    "OTHER_BENEFITS_NOT_MODELED_UPFRONT"])),
});
export const policyFinancialEstimateResponseSchema = z.object({
  schemaVersion: z.literal(1), source: z.literal("DETERMINISTIC_POLICY_FINANCIAL_V1"),
  status: z.enum(["AVAILABLE", "UNAVAILABLE"]), requestId: z.string().min(1),
  propertyId: z.string().min(1), analysisId: z.string().min(1), roofSource: z.enum(["GOOGLE_SOLAR", "MANUAL"]),
  system: systemCandidateSchema, systemDesignWarnings: z.array(z.enum(["LOCAL_RULES_NOT_CHECKED",
    "SANCTIONED_LOAD_NOT_PROVIDED", "SANCTIONED_LOAD_REVIEW_NEEDED", "BILL_TO_KWH_IS_APPROXIMATE",
    "GOOGLE_ROOF_FIT_APPROXIMATE", "MANUAL_FIT_NEEDS_SITE_SURVEY", "ASSUMED_YIELD_USED",
    "GOOGLE_DC_TO_AC_FACTOR_ASSUMED"])),
  base: baseFinancialResultSchema, benefits: benefitEvaluationResponseSchema,
  projection: projectedSchema.optional(), reasonCodes: z.array(code).optional(),
}).superRefine((value, context) => {
  if ((value.status === "AVAILABLE") !== !!value.projection) context.addIssue({ code: "custom", path: ["projection"],
    message: "Available policy estimates require an adjusted projection." });
  if (value.status === "AVAILABLE" && value.benefits.status !== "AVAILABLE") context.addIssue({ code: "custom", path: ["benefits"],
    message: "An adjusted projection requires an available benefit evaluation." });
});

export type PolicyFinancialEstimateResponse = z.infer<typeof policyFinancialEstimateResponseSchema>;

export const policyFinancialApi = {
  estimate: async (propertyId: string, analysisId: string, demand: SystemDemand, generationKwhPerKwYear: number,
    nominalKw: number, financialInputs: FinancialInputs, eligibleQuotedCostPaise: number | undefined,
    applicantFacts: BenefitApplicantFacts, signal?: AbortSignal): Promise<PolicyFinancialEstimateResponse> => {
    const response = await postAuthenticated("/financials/policy-backed/estimate", {
      propertyId, analysisId, demand, generationKwhPerKwYear, nominalKw, financialInputs,
      ...(eligibleQuotedCostPaise === undefined ? {} : { eligibleQuotedCostPaise }), applicantFacts,
    }, policyFinancialEstimateResponseSchema, signal, 30_000);
    if (response.propertyId !== propertyId || response.analysisId !== analysisId ||
      response.system.nominalKw !== nominalKw || response.base.input.system.nominalKw !== nominalKw ||
      response.benefits.propertyId !== propertyId || response.benefits.analysisId !== analysisId ||
      response.benefits.system.nominalKw !== nominalKw ||
      response.benefits.system.actualDcKw !== response.system.actualDcKw ||
      response.benefits.result && response.benefits.result.evaluatedAt !== response.benefits.evaluatedAt ||
      response.projection && (!response.benefits.result ||
        response.projection.provenance.benefitEvaluatedAt !== response.benefits.result.evaluatedAt ||
        response.projection.totalEligibleBenefitPaise !== response.benefits.result.totalEligibleBenefitPaise) ||
      response.base.input.quote.grossSystemCostRupees !== financialInputs.grossSystemCostRupees) {
      throw new RoofRequestError("INVALID_RESPONSE", "The policy financial service returned a different analysis, system or quote. Try again.");
    }
    return response;
  },
};
