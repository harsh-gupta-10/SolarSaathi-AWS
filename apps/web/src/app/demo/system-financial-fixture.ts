import { BASE_FINANCIAL_ASSUMPTIONS_V1, BASE_FINANCIAL_SENSITIVITY_V1,
  calculateBaseFinancialsV1, designSolarSystem, getSystemDesignAssumptionsV1 } from "@solarsaathi/calculations";
import type { FinancialEstimateResponse } from "../../lib/financial-api";
import { demoRoof } from "./fixtures";

/** Synthetic values for demo pages and tests only; never submitted to the live API. */
export const demoDesign = designSolarSystem(demoRoof,
  { kind: "CONSUMPTION", monthlyConsumptionKwh: 400, sanctionedLoadKw: 1.5 },
  getSystemDesignAssumptionsV1(demoRoof));
const demoSystem = demoDesign.recommendation!;
const demoFinancial = calculateBaseFinancialsV1({
  schemaVersion: 1,
  system: { nominalKw: demoSystem.nominalKw, actualDcKw: demoSystem.actualDcKw,
    yearOneGenerationKwh: demoSystem.estimatedAnnualGenerationKwh, generationBasis: demoSystem.generationBasis },
  quote: { grossSystemCostRupees: 200_000 },
  usage: { annualConsumptionKwh: demoDesign.demand.annualConsumptionKwh, selfConsumptionFraction: 0.7,
    importTariffRupeesPerKwh: 8, exportRateRupeesPerKwh: 0 },
  assumptions: { ...BASE_FINANCIAL_ASSUMPTIONS_V1, annualMaintenanceRupees: 3_000 },
  sensitivity: { ...BASE_FINANCIAL_SENSITIVITY_V1 },
});
export const demoFinancialResponse: FinancialEstimateResponse = {
  schemaVersion: 1, source: "DETERMINISTIC_BASE_FINANCIAL_V1", requestId: "synthetic-fixture",
  propertyId: "synthetic-property", analysisId: "synthetic-analysis", roofSource: "MANUAL",
  policyBenefitsEvaluated: false, financingModeled: false, system: demoSystem,
  systemDesignWarnings: demoDesign.warnings, financial: demoFinancial,
};
