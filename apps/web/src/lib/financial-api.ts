import { z } from "zod";
import type { BaseFinancialResultV1, SystemCandidate, SystemDemand, SystemDesignWarning } from "@solarsaathi/calculations";
import { postAuthenticated, RoofRequestError } from "./roof-api";
import { systemCandidateSchema } from "./system-api";

export interface FinancialInputs {
  grossSystemCostRupees: number;
  selfConsumptionFraction: number;
  importTariffRupeesPerKwh: number;
  exportRateRupeesPerKwh: number;
  annualMaintenanceRupees: number;
}

const finite = z.number().finite();
const totals = z.object({
  paybackYears: finite.nonnegative().nullable(), netSavingsOver25YearsRupees: finite,
  yearOneGrossSavingsRupees: finite.nonnegative(), yearOneNetCashFlowRupees: finite,
  totalGenerationKwh: finite.nonnegative(), totalSelfConsumedKwh: finite.nonnegative(),
  totalExportedKwh: finite.nonnegative(), totalSelfConsumptionValueRupees: finite.nonnegative(),
  totalExportValueRupees: finite.nonnegative(), totalGrossSavingsRupees: finite.nonnegative(),
  totalMaintenanceCostRupees: finite.nonnegative(),
});
const annualRow = z.object({
  year: z.number().int().min(1).max(25), generationKwh: finite.nonnegative(),
  selfConsumedKwh: finite.nonnegative(), exportedKwh: finite.nonnegative(), annualConsumptionKwh: finite.positive(),
  importTariffRupeesPerKwh: finite.nonnegative(), exportRateRupeesPerKwh: finite.nonnegative(),
  selfConsumptionValueRupees: finite.nonnegative(), exportValueRupees: finite.nonnegative(),
  grossSavingsRupees: finite.nonnegative(), maintenanceCostRupees: finite.nonnegative(),
  netCashFlowRupees: finite, cumulativeCashFlowRupees: finite,
});
const sensitivityCase = z.object({
  inputFactor: finite.positive(), grossSystemCostRupees: finite.positive(),
  yearOneGenerationKwh: finite.nonnegative(), importTariffRupeesPerKwh: finite.nonnegative(),
  exportRateRupeesPerKwh: finite.nonnegative(), totals,
});
const sensitivityTriplet = z.object({ low: sensitivityCase, base: sensitivityCase, high: sensitivityCase });
const financialSchema: z.ZodType<BaseFinancialResultV1> = z.object({
  schemaVersion: z.literal(1), source: z.literal("DETERMINISTIC_BASE_FINANCIAL_V1"),
  policyBenefitsEvaluated: z.literal(false), financingModeled: z.literal(false), horizonYears: z.literal(25),
  input: z.object({
    schemaVersion: z.literal(1),
    system: z.object({ nominalKw: finite.positive(), actualDcKw: finite.positive(),
      yearOneGenerationKwh: finite.nonnegative(), generationBasis: z.enum(["GOOGLE_DC_DERATED", "ASSUMED_YIELD"]) }),
    quote: z.object({ grossSystemCostRupees: finite.positive() }),
    usage: z.object({ annualConsumptionKwh: finite.positive(), selfConsumptionFraction: finite.min(0).max(1),
      importTariffRupeesPerKwh: finite.positive(), exportRateRupeesPerKwh: finite.nonnegative() }),
    assumptions: z.object({ annualDegradationFraction: finite.min(0).max(1),
      annualImportTariffEscalationFraction: finite, annualExportRateEscalationFraction: finite,
      annualMaintenanceRupees: finite.nonnegative(), annualMaintenanceEscalationFraction: finite }),
    sensitivity: z.object({ generationVariationFraction: finite.min(0).max(1),
      tariffVariationFraction: finite.min(0).max(1), systemCostVariationFraction: finite.min(0).max(1) }),
  }),
  initialCashFlowRupees: finite, annualRows: z.array(annualRow).length(25), totals,
  sensitivity: z.object({ generation: sensitivityTriplet, importTariff: sensitivityTriplet, systemCost: sensitivityTriplet }),
  warnings: z.array(z.enum(["AVOIDABLE_IMPORT_TARIFF_ASSUMED", "EXPORT_SETTLEMENT_UNVERIFIED",
    "ANNUAL_CONSUMPTION_HELD_FLAT", "GENERATION_USES_ASSUMED_YIELD", "NO_PAYBACK_WITHIN_25_YEARS"])),
});
const responseSchema = z.object({
  schemaVersion: z.literal(1), source: z.literal("DETERMINISTIC_BASE_FINANCIAL_V1"), requestId: z.string().min(1),
  propertyId: z.string().min(1), analysisId: z.string().min(1), roofSource: z.enum(["GOOGLE_SOLAR", "MANUAL"]),
  policyBenefitsEvaluated: z.literal(false), financingModeled: z.literal(false),
  system: systemCandidateSchema,
  systemDesignWarnings: z.array(z.enum(["LOCAL_RULES_NOT_CHECKED", "SANCTIONED_LOAD_NOT_PROVIDED",
    "SANCTIONED_LOAD_REVIEW_NEEDED", "BILL_TO_KWH_IS_APPROXIMATE", "GOOGLE_ROOF_FIT_APPROXIMATE",
    "MANUAL_FIT_NEEDS_SITE_SURVEY", "ASSUMED_YIELD_USED", "GOOGLE_DC_TO_AC_FACTOR_ASSUMED"])),
  financial: financialSchema,
});

export interface FinancialEstimateResponse {
  schemaVersion: 1;
  source: "DETERMINISTIC_BASE_FINANCIAL_V1";
  requestId: string;
  propertyId: string;
  analysisId: string;
  roofSource: "GOOGLE_SOLAR" | "MANUAL";
  policyBenefitsEvaluated: false;
  financingModeled: false;
  system: SystemCandidate;
  systemDesignWarnings: SystemDesignWarning[];
  financial: BaseFinancialResultV1;
}

export const financialApi = {
  estimate: async (propertyId: string, analysisId: string, demand: SystemDemand, generationKwhPerKwYear: number,
    nominalKw: number, financialInputs: FinancialInputs, signal?: AbortSignal): Promise<FinancialEstimateResponse> => {
    const response = await postAuthenticated("/financials/estimate",
      { propertyId, analysisId, demand, generationKwhPerKwYear, nominalKw, financialInputs }, responseSchema, signal);
    if (response.propertyId !== propertyId || response.analysisId !== analysisId || response.system.nominalKw !== nominalKw ||
      response.financial.input.system.nominalKw !== nominalKw) {
      throw new RoofRequestError("INVALID_RESPONSE", "The financial service returned a different analysis or system. Try again.");
    }
    return response;
  },
};
