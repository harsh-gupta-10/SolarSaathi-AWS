import { describe, expect, it } from "vitest";
import {
  INDICATIVE_BUDGET_TIERS_V1,
  FINANCIAL_INPUT_PRESETS_V1,
  getIndicativeBudgetRangesV1,
} from "../src";

describe("indicative budget tiers and financial presets", () => {
  it("computes proportional budget ranges for 1 kW", () => {
    const ranges = getIndicativeBudgetRangesV1(1);
    expect(ranges).toHaveLength(3);
    const [economy, standard, premium] = ranges;
    expect(economy.minTotalRupees).toBe(50_000);
    expect(economy.maxTotalRupees).toBe(58_000);
    expect(economy.typicalTotalRupees).toBe(54_000);
    expect(standard.minTotalRupees).toBe(60_000);
    expect(standard.maxTotalRupees).toBe(68_000);
    expect(standard.typicalTotalRupees).toBe(64_000);
    expect(premium.minTotalRupees).toBe(70_000);
    expect(premium.maxTotalRupees).toBe(82_000);
    expect(premium.typicalTotalRupees).toBe(75_000);
  });

  it("computes scaled budget ranges for 2 kW and 3 kW", () => {
    const ranges2kw = getIndicativeBudgetRangesV1(2);
    expect(ranges2kw[0].minTotalRupees).toBe(100_000);
    expect(ranges2kw[0].maxTotalRupees).toBe(116_000);
    expect(ranges2kw[0].typicalTotalRupees).toBe(108_000);
    expect(ranges2kw[1].typicalTotalRupees).toBe(128_000);

    const ranges3kw = getIndicativeBudgetRangesV1(3);
    expect(ranges3kw[0].minTotalRupees).toBe(150_000);
    expect(ranges3kw[0].maxTotalRupees).toBe(174_000);
    expect(ranges3kw[0].typicalTotalRupees).toBe(162_000);
    expect(ranges3kw[1].typicalTotalRupees).toBe(192_000);
    expect(ranges3kw[2].typicalTotalRupees).toBe(225_000);
  });

  it("handles non-positive or fallback capacity safely", () => {
    const ranges = getIndicativeBudgetRangesV1(0);
    expect(ranges[0].minTotalRupees).toBe(50_000);
  });

  it("exports valid financial input presets with positive ranges", () => {
    expect(FINANCIAL_INPUT_PRESETS_V1.selfConsumption.length).toBeGreaterThan(0);
    expect(FINANCIAL_INPUT_PRESETS_V1.importTariff.length).toBeGreaterThan(0);
    expect(FINANCIAL_INPUT_PRESETS_V1.exportRate.length).toBeGreaterThan(0);
    expect(FINANCIAL_INPUT_PRESETS_V1.maintenance.length).toBeGreaterThan(0);
    expect(INDICATIVE_BUDGET_TIERS_V1.every(t => t.minPerKwRupees < t.maxPerKwRupees)).toBe(true);
  });
});
