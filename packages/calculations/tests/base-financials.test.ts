import { describe, expect, it } from "vitest";
import { BASE_FINANCIAL_ASSUMPTIONS_V1, BASE_FINANCIAL_SENSITIVITY_V1,
  calculateBaseFinancialsV1, type BaseFinancialInputV1 } from "../src";

const input = (): BaseFinancialInputV1 => ({
  schemaVersion: 1,
  system: { nominalKw: 2, actualDcKw: 2.2, yearOneGenerationKwh: 3_000,
    generationBasis: "ASSUMED_YIELD" },
  quote: { grossSystemCostRupees: 10_000 },
  usage: { annualConsumptionKwh: 2_000, selfConsumptionFraction: 0.8,
    importTariffRupeesPerKwh: 5, exportRateRupeesPerKwh: 2 },
  assumptions: { annualDegradationFraction: 0.1, annualImportTariffEscalationFraction: 0.1,
    annualExportRateEscalationFraction: 0, annualMaintenanceRupees: 100,
    annualMaintenanceEscalationFraction: 0 },
  sensitivity: { generationVariationFraction: 0.1, tariffVariationFraction: 0.2,
    systemCostVariationFraction: 0.1 },
});

describe("versioned 25-year base financial model", () => {
  it("derives annual cash flow with demand-capped self-use and separately valued export", () => {
    const result = calculateBaseFinancialsV1(input());
    expect(result).toMatchObject({ schemaVersion: 1, source: "DETERMINISTIC_BASE_FINANCIAL_V1",
      policyBenefitsEvaluated: false, financingModeled: false, horizonYears: 25,
      initialCashFlowRupees: -10_000 });
    expect(result.annualRows).toHaveLength(25);
    expect(result.annualRows[0]).toEqual({ year: 1, generationKwh: 3_000,
      selfConsumedKwh: 2_000, exportedKwh: 1_000, annualConsumptionKwh: 2_000,
      importTariffRupeesPerKwh: 5, exportRateRupeesPerKwh: 2,
      selfConsumptionValueRupees: 10_000, exportValueRupees: 2_000,
      grossSavingsRupees: 12_000, maintenanceCostRupees: 100,
      netCashFlowRupees: 11_900, cumulativeCashFlowRupees: 1_900 });
    expect(result.annualRows[1]).toMatchObject({ year: 2, generationKwh: 2_700,
      selfConsumedKwh: 2_000, exportedKwh: 700, importTariffRupeesPerKwh: 5.5,
      exportRateRupeesPerKwh: 2, selfConsumptionValueRupees: 11_000,
      exportValueRupees: 1_400, grossSavingsRupees: 12_400,
      maintenanceCostRupees: 100, netCashFlowRupees: 12_300,
      cumulativeCashFlowRupees: 14_200 });
    expect(result.annualRows.every(row => row.selfConsumedKwh <= row.annualConsumptionKwh)).toBe(true);
    expect(result.annualRows[24].generationKwh).toBeCloseTo(3_000 * Math.pow(0.9, 24));
    expect(result.totals.paybackYears).toBeCloseTo(10_000 / 11_900);
    expect(result.totals.netSavingsOver25YearsRupees).toBeCloseTo(result.annualRows[24].cumulativeCashFlowRupees);
    expect(result.totals.totalGrossSavingsRupees - result.totals.totalMaintenanceCostRupees -
      result.input.quote.grossSystemCostRupees).toBeCloseTo(result.totals.netSavingsOver25YearsRupees);
  });

  it("models escalation and degradation without an off-by-one year", () => {
    const values = input();
    values.usage.annualConsumptionKwh = 10_000;
    values.usage.selfConsumptionFraction = 0.5;
    values.assumptions.annualExportRateEscalationFraction = 0.05;
    values.assumptions.annualMaintenanceEscalationFraction = 0.2;
    const result = calculateBaseFinancialsV1(values);
    expect(result.annualRows[0]).toMatchObject({ generationKwh: 3_000, selfConsumedKwh: 1_500,
      exportedKwh: 1_500, importTariffRupeesPerKwh: 5, exportRateRupeesPerKwh: 2,
      maintenanceCostRupees: 100 });
    expect(result.annualRows[1]).toMatchObject({ generationKwh: 2_700, selfConsumedKwh: 1_350,
      exportedKwh: 1_350, importTariffRupeesPerKwh: 5.5, exportRateRupeesPerKwh: 2.1,
      maintenanceCostRupees: 120 });
  });

  it("uses null payback when annual benefits never recover the quoted gross cost", () => {
    const values = input();
    values.quote.grossSystemCostRupees = 1_000_000;
    values.system.yearOneGenerationKwh = 100;
    values.usage.annualConsumptionKwh = 1_000;
    values.usage.selfConsumptionFraction = 1;
    values.usage.importTariffRupeesPerKwh = 1;
    values.usage.exportRateRupeesPerKwh = 0;
    values.assumptions = { annualDegradationFraction: 0, annualImportTariffEscalationFraction: 0,
      annualExportRateEscalationFraction: 0, annualMaintenanceRupees: 50,
      annualMaintenanceEscalationFraction: 0 };
    const result = calculateBaseFinancialsV1(values);
    expect(result.annualRows[0].netCashFlowRupees).toBe(50);
    expect(result.totals.paybackYears).toBeNull();
    expect(result.totals.netSavingsOver25YearsRupees).toBe(-998_750);
    expect(result.warnings).toContain("NO_PAYBACK_WITHIN_25_YEARS");
  });

  it("interpolates payback when recovery happens after a full year", () => {
    const values = input();
    values.quote.grossSystemCostRupees = 15_000;
    values.assumptions = { annualDegradationFraction: 0, annualImportTariffEscalationFraction: 0,
      annualExportRateEscalationFraction: 0, annualMaintenanceRupees: 2_000,
      annualMaintenanceEscalationFraction: 0 };
    const result = calculateBaseFinancialsV1(values);
    expect(result.annualRows[0].netCashFlowRupees).toBe(10_000);
    expect(result.totals.paybackYears).toBe(1.5);
  });

  it("varies generation, avoided import tariff and quote cost one axis at a time", () => {
    const result = calculateBaseFinancialsV1(input());
    expect(result.sensitivity.generation.low.yearOneGenerationKwh).toBe(2_700);
    expect(result.sensitivity.generation.low.importTariffRupeesPerKwh).toBe(5);
    expect(result.sensitivity.generation.high.yearOneGenerationKwh).toBeCloseTo(3_300);
    expect(result.sensitivity.importTariff.low.importTariffRupeesPerKwh).toBe(4);
    expect(result.sensitivity.importTariff.low.exportRateRupeesPerKwh).toBe(2);
    expect(result.sensitivity.importTariff.high.importTariffRupeesPerKwh).toBe(6);
    expect(result.sensitivity.systemCost.low.grossSystemCostRupees).toBe(9_000);
    expect(result.sensitivity.systemCost.high.grossSystemCostRupees).toBe(11_000);
    expect(result.sensitivity.generation.base.totals).toEqual(result.totals);
    expect(result.sensitivity.importTariff.base.totals).toEqual(result.totals);
    expect(result.sensitivity.systemCost.base.totals).toEqual(result.totals);
    expect(result.sensitivity.systemCost.low.totals.netSavingsOver25YearsRupees)
      .toBeGreaterThan(result.sensitivity.systemCost.high.totals.netSavingsOver25YearsRupees);
  });

  it("keeps a complete assumption echo and explicitly labels model limits", () => {
    const values = input();
    const result = calculateBaseFinancialsV1(values);
    expect(result.input).toEqual(values);
    expect(result.input).not.toBe(values);
    expect(result.warnings).toEqual(expect.arrayContaining([
      "AVOIDABLE_IMPORT_TARIFF_ASSUMED", "EXPORT_SETTLEMENT_UNVERIFIED",
      "ANNUAL_CONSUMPTION_HELD_FLAT", "GENERATION_USES_ASSUMED_YIELD",
    ]));
    expect(result.input.assumptions).not.toBe(values.assumptions);
    expect(BASE_FINANCIAL_ASSUMPTIONS_V1).toMatchObject({ annualDegradationFraction: 0.005,
      annualImportTariffEscalationFraction: 0.04 });
    expect(BASE_FINANCIAL_SENSITIVITY_V1).toMatchObject({ generationVariationFraction: 0.1,
      tariffVariationFraction: 0.1, systemCostVariationFraction: 0.1 });
  });

  it("allows explicit zero export value and zero generation without inventing a benefit", () => {
    const values = input();
    values.system.yearOneGenerationKwh = 0;
    values.system.generationBasis = "GOOGLE_DC_DERATED";
    values.usage.exportRateRupeesPerKwh = 0;
    const result = calculateBaseFinancialsV1(values);
    expect(result.annualRows.every(row => row.grossSavingsRupees === 0 && row.exportedKwh === 0)).toBe(true);
    expect(result.totals.paybackYears).toBeNull();
    expect(result.warnings).not.toContain("GENERATION_USES_ASSUMED_YIELD");
  });

  it("rejects invalid and non-finite inputs", () => {
    const invalid: Array<(values: BaseFinancialInputV1) => void> = [
      values => { values.quote.grossSystemCostRupees = 0; },
      values => { values.usage.annualConsumptionKwh = 0; },
      values => { values.usage.selfConsumptionFraction = 1.01; },
      values => { values.usage.importTariffRupeesPerKwh = -1; },
      values => { values.usage.exportRateRupeesPerKwh = -1; },
      values => { values.assumptions.annualDegradationFraction = 1.1; },
      values => { values.assumptions.annualImportTariffEscalationFraction = -1; },
      values => { values.assumptions.annualMaintenanceRupees = Infinity; },
      values => { values.sensitivity.systemCostVariationFraction = 1; },
      values => { values.system.yearOneGenerationKwh = Number.NaN; },
    ];
    for (const change of invalid) {
      const values = input(); change(values);
      expect(() => calculateBaseFinancialsV1(values)).toThrow(RangeError);
    }
  });
});
