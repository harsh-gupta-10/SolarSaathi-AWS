import type { SolarAssumptions } from "./types";

export function annualGeneration(systemKw: number, assumptions: SolarAssumptions): number {
  return systemKw * assumptions.generationKwhPerKwYear;
}

export function panelCount(systemKw: number, assumptions: SolarAssumptions): number {
  const watts = systemKw * 1000;
  return Math.ceil(watts / assumptions.panelWattage);
}
