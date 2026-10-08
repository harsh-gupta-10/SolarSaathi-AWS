export type SolarAssumptions = {
  generationKwhPerKwYear: number;
  installedCostPerKw: number;
  panelWattage: number;
  degradationRate: number;
  tariffEscalationRate: number;
  startingTariffPerKwh: number;
  systemLifeYears: number;
};

export type FinancialResult = {
  grossCost: number;
  subsidy: number;
  netCost: number;
  annualGenerationKwh: number;
  annualSavings: number;
  paybackYears: number;
  twentyFiveYearSavings: number;
};
