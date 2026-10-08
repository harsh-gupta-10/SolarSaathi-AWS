import {
  BASE_FINANCIAL_ASSUMPTIONS_V1, BASE_FINANCIAL_SENSITIVITY_V1, calculateBaseFinancialsV1,
  designSolarSystem, getSystemDesignAssumptionsV1,
  type BaseFinancialResultV1, type SystemCandidate, type SystemDesignWarning,
} from "@solarsaathi/calculations";
import type { CurrentIdentityResponse, NormalizedRoofV1 } from "@solarsaathi/types";
import { CoreService } from "../data/service";
import { parseInput } from "../data/schemas";
import { RequestError } from "../lib/http";
import { financialEstimateRequestSchema } from "./schema";

export interface FinancialEstimateResponse {
  schemaVersion: 1;
  source: "DETERMINISTIC_BASE_FINANCIAL_V1";
  requestId: string;
  propertyId: string;
  analysisId: string;
  roofSource: NormalizedRoofV1["source"];
  policyBenefitsEvaluated: false;
  financingModeled: false;
  system: SystemCandidate;
  systemDesignWarnings: SystemDesignWarning[];
  financial: BaseFinancialResultV1;
}

export class FinancialsService {
  constructor(private readonly core: CoreService) {}

  async estimate(identity: CurrentIdentityResponse, body: unknown, requestId: string): Promise<FinancialEstimateResponse> {
    const input = parseInput(financialEstimateRequestSchema, body);
    const analysis = await this.core.getAnalysis(identity, input.propertyId, input.analysisId);
    if (!analysis.roofModel) {
      throw new RequestError(409, "ROOF_MODEL_REQUIRED", "Confirm a roof with dimensions or Google Solar data before estimating finances.");
    }
    const assumptions = { ...getSystemDesignAssumptionsV1(analysis.roofModel),
      generationKwhPerKwYear: input.generationKwhPerKwYear };
    let system: SystemCandidate;
    let systemDesignWarnings: SystemDesignWarning[];
    let annualConsumptionKwh: number;
    try {
      const design = designSolarSystem(analysis.roofModel, input.demand, assumptions);
      const selected = design.candidates.find(candidate => candidate.nominalKw === input.nominalKw);
      if (!selected) throw new RequestError(400, "INVALID_CANDIDATE", "Select a supported system size from the current roof design.");
      if (!selected.recommendationEligible || selected.estimatedAnnualGenerationKwh <= 0 ||
        selected.roofFit === "UNDETERMINED" || selected.roofFit === "EXCEEDS_MODELED_ROOF") {
        throw new RequestError(422, "CANDIDATE_UNFIT", "The selected system is not supported by this roof and demand estimate.");
      }
      system = selected;
      systemDesignWarnings = design.warnings;
      annualConsumptionKwh = design.demand.annualConsumptionKwh;
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
      throw new RequestError(503, "FINANCIAL_ESTIMATE_UNAVAILABLE", "The stored roof model could not be used for this estimate.");
    }
    let financial: BaseFinancialResultV1;
    try {
      financial = calculateBaseFinancialsV1({
        schemaVersion: 1,
        system: { nominalKw: system.nominalKw, actualDcKw: system.actualDcKw,
          yearOneGenerationKwh: system.estimatedAnnualGenerationKwh, generationBasis: system.generationBasis },
        quote: { grossSystemCostRupees: input.financialInputs.grossSystemCostRupees },
        usage: { annualConsumptionKwh, selfConsumptionFraction: input.financialInputs.selfConsumptionFraction,
          importTariffRupeesPerKwh: input.financialInputs.importTariffRupeesPerKwh,
          exportRateRupeesPerKwh: input.financialInputs.exportRateRupeesPerKwh },
        assumptions: { ...BASE_FINANCIAL_ASSUMPTIONS_V1,
          annualMaintenanceRupees: input.financialInputs.annualMaintenanceRupees },
        sensitivity: { ...BASE_FINANCIAL_SENSITIVITY_V1 },
      });
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
      throw new RequestError(503, "FINANCIAL_ESTIMATE_UNAVAILABLE", "The estimate could not be calculated from the supplied inputs.");
    }
    return { schemaVersion: 1, source: "DETERMINISTIC_BASE_FINANCIAL_V1", requestId,
      propertyId: input.propertyId, analysisId: input.analysisId, roofSource: analysis.roofModel.source,
      policyBenefitsEvaluated: false, financingModeled: false, system, systemDesignWarnings, financial };
  }
}
