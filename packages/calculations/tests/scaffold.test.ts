import { describe, expect, it } from "vitest";
import { annualGeneration, panelCount } from "../src";
import type { SolarAssumptions } from "../src";

const assumptions: SolarAssumptions = {
  generationKwhPerKwYear: 1_000,
  installedCostPerKw: 100,
  panelWattage: 400,
  degradationRate: 0,
  tariffEscalationRate: 0,
  startingTariffPerKwh: 1,
  systemLifeYears: 25,
};

describe("deterministic calculation scaffold", () => {
  it("uses explicit generation and panel assumptions", () => {
    expect(annualGeneration(3, assumptions)).toBe(3_000);
    expect(panelCount(3, assumptions)).toBe(8);
    expect(annualGeneration(0, assumptions)).toBe(0);
    expect(panelCount(0, assumptions)).toBe(0);
  });
});
