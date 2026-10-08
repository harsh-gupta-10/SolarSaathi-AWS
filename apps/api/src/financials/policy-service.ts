import { calculatePolicyFinancialsV1, type PolicyFinancialResultV1 } from "@solarsaathi/calculations";
import type { CurrentIdentityResponse } from "@solarsaathi/types";
import { ZodError } from "zod";
import { BenefitsService } from "../benefits/service";
import { parseInput } from "../data/schemas";
import { RequestError } from "../lib/http";
import { FinancialsService, type FinancialEstimateResponse } from "./service";
import { policyFinancialEstimateRequestSchema } from "./policy-schema";

type BenefitEvaluationResponse = Awaited<ReturnType<BenefitsService["evaluate"]>>;

export interface PolicyFinancialEstimateResponse {
  schemaVersion: 1;
  source: "DETERMINISTIC_POLICY_FINANCIAL_V1";
  status: "AVAILABLE" | "UNAVAILABLE";
  requestId: string;
  propertyId: string;
  analysisId: string;
  roofSource: FinancialEstimateResponse["roofSource"];
  system: FinancialEstimateResponse["system"];
  systemDesignWarnings: FinancialEstimateResponse["systemDesignWarnings"];
  base: FinancialEstimateResponse["financial"];
  benefits: BenefitEvaluationResponse;
  projection?: PolicyFinancialResultV1;
  reasonCodes?: string[];
}

export class PolicyFinancialsService {
  constructor(private readonly financials: FinancialsService, private readonly benefits: BenefitsService) {}

  async estimate(identity: CurrentIdentityResponse, body: unknown, requestId: string): Promise<PolicyFinancialEstimateResponse> {
    const input = parseInput(policyFinancialEstimateRequestSchema, body);
    const base = await this.financials.estimate(identity, {
      propertyId: input.propertyId, analysisId: input.analysisId, demand: input.demand,
      generationKwhPerKwYear: input.generationKwhPerKwYear, nominalKw: input.nominalKw,
      financialInputs: input.financialInputs,
    }, requestId);
    // The owned roof was loaded and this candidate was recomputed above. Browser input has no trusted-system field.
    let benefits: BenefitEvaluationResponse;
    try {
      benefits = await this.benefits.evaluate(identity, {
        propertyId: input.propertyId, analysisId: input.analysisId, demand: input.demand,
        generationKwhPerKwYear: input.generationKwhPerKwYear, nominalKw: input.nominalKw,
        applicantFacts: input.applicantFacts,
        ...(input.eligibleQuotedCostPaise === undefined ? {} : { eligibleQuotedCostPaise: input.eligibleQuotedCostPaise }),
      }, requestId, { propertyId: base.propertyId, analysisId: base.analysisId, system: base.system });
    } catch (error) {
      if (!(error instanceof RequestError) || error.statusCode !== 503 ||
        error.code !== "BENEFIT_EVALUATION_UNAVAILABLE") throw error;
      // Policy storage/source failures must never erase the independently valid base estimate.
      benefits = { schemaVersion: 1, source: "DETERMINISTIC_BENEFIT_STACK_V1",
        status: "UNAVAILABLE", requestId, propertyId: base.propertyId, analysisId: base.analysisId,
        system: { nominalKw: base.system.nominalKw, actualDcKw: base.system.actualDcKw },
        evaluatedAt: new Date().toISOString(), coverage: { central: false, state: false,
          discom: false, local: false, other: false }, applicantFactsSource: "USER_DECLARED",
        eligibilityNotGuaranteed: true, reasonCodes: [error.code] };
    }
    if (benefits.requestId !== requestId || benefits.propertyId !== base.propertyId ||
      benefits.analysisId !== base.analysisId || benefits.system.nominalKw !== base.system.nominalKw ||
      benefits.system.actualDcKw !== base.system.actualDcKw) {
      throw new RequestError(503, "POLICY_FINANCIAL_MISMATCH", "The policy evaluation does not match this roof and system estimate.");
    }
    const common = { schemaVersion: 1 as const, source: "DETERMINISTIC_POLICY_FINANCIAL_V1" as const,
      requestId, propertyId: base.propertyId, analysisId: base.analysisId, roofSource: base.roofSource,
      system: base.system, systemDesignWarnings: base.systemDesignWarnings, base: base.financial, benefits };
    if (benefits.status === "UNAVAILABLE") {
      return { ...common, status: "UNAVAILABLE", reasonCodes: benefits.reasonCodes ?? ["BENEFIT_EVALUATION_UNAVAILABLE"] };
    }
    const selectedPositive = benefits.result.decisions.some(decision => decision.status === "SELECTED" &&
      (decision.countedAmountPaise ?? 0) > 0);
    const upfrontModelable = benefits.result.decisions.some(decision => decision.status === "SELECTED" &&
      decision.scope !== "OTHER" && (decision.countedAmountPaise ?? 0) > 0);
    if (!upfrontModelable) return { ...common, status: "UNAVAILABLE",
      reasonCodes: [selectedPositive ? "NO_UPFRONT_MODELABLE_BENEFITS" : "NO_CONFIRMED_ELIGIBLE_BENEFITS"] };
    try {
      const projection = calculatePolicyFinancialsV1({ base: base.financial, benefits: benefits.result });
      return { ...common, status: "AVAILABLE", projection };
    } catch (error) {
      if (!(error instanceof RangeError) && !(error instanceof ZodError)) throw error;
      throw new RequestError(503, "POLICY_FINANCIAL_CALCULATION_UNAVAILABLE",
        "The policy-adjusted scenario could not be calculated from the verified inputs.");
    }
  }
}
