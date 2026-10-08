import type { FinancialResult, SolarAssumptions } from "./types";

export function calculateFinancials(
  systemKw: number,
  subsidy: number,
  assumptions: SolarAssumptions,
): FinancialResult {
  const grossCost = systemKw * assumptions.installedCostPerKw;
  const netCost = Math.max(0, grossCost - subsidy);
  const annualGenerationKwh = systemKw * assumptions.generationKwhPerKwYear;
  const annualSavings = annualGenerationKwh * assumptions.startingTariffPerKwh;
  const paybackYears = annualSavings > 0 ? netCost / annualSavings : Infinity;

  let cumulativeSavings = 0;
  for (let year = 1; year <= assumptions.systemLifeYears; year++) {
    const generation =
      annualGenerationKwh * Math.pow(1 - assumptions.degradationRate, year - 1);
    const tariff =
      assumptions.startingTariffPerKwh *
      Math.pow(1 + assumptions.tariffEscalationRate, year - 1);
    cumulativeSavings += generation * tariff;
  }

  return {
    grossCost,
    subsidy,
    netCost,
    annualGenerationKwh,
    annualSavings,
    paybackYears,
    twentyFiveYearSavings: cumulativeSavings - netCost,
  };
}
