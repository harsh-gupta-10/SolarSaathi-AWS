import { describe, expect, it } from "vitest";
import { annualGeneration, calculateFinancials, calculateSubsidy, panelCount } from "../src";
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

  it("preserves existing baseline financial arithmetic", () => {
    expect(calculateFinancials(1, 20, assumptions)).toEqual({
      grossCost: 100, subsidy: 20, netCost: 80,
      annualGenerationKwh: 1_000, annualSavings: 1_000,
      paybackYears: 0.08, twentyFiveYearSavings: 24_920,
    });
  });

  it("applies explicit degradation and tariff escalation", () => {
    const result = calculateFinancials(1, 0, {
      ...assumptions, systemLifeYears: 2, degradationRate: 0.1, tariffEscalationRate: 0.2,
    });
    expect(result.twentyFiveYearSavings).toBeCloseTo(1_000 + 900 * 1.2 - 100);
  });

  it("clamps net cost and reports no finite payback without generation", () => {
    expect(calculateFinancials(1, 150, assumptions).netCost).toBe(0);
    expect(calculateFinancials(1, 0, { ...assumptions, generationKwhPerKwYear: 0 }).paybackYears).toBe(Infinity);
  });

  it("uses caller-provided slab fixtures and caps, not government constants", () => {
    const input = { systemKw: 2, slabs: [{ maxKw: 3, amount: 40 }, { maxKw: 2, amount: 25 }], maximumAmount: 30 };
    expect(calculateSubsidy(input)).toBe(25);
    expect(calculateSubsidy({ ...input, systemKw: 3 })).toBe(30);
    expect(input.slabs[0].maxKw).toBe(3);
  });
});
