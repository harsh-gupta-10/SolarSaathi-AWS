export type SolarAssumptions = {
  generationKwhPerKwYear: number;
  installedCostPerKw: number;
  panelWattage: number;
  degradationRate: number;
  tariffEscalationRate: number;
  startingTariffPerKwh: number;
  systemLifeYears: number;
};
