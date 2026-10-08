import type { SystemGenerationBasis } from "./system-designer";

export interface BaseFinancialInputV1 {
  schemaVersion: 1;
  /** Trusted Phase 6 sizing and generation, recomputed server-side before this model is called. */
  system: {
    nominalKw: number;
    actualDcKw: number;
    yearOneGenerationKwh: number;
    generationBasis: SystemGenerationBasis;
  };
  /** An explicit user quote; no subsidy or policy benefit is deducted. */
  quote: { grossSystemCostRupees: number };
  usage: {
    /** Trusted Phase 6 annual demand, held flat in this version. */
    annualConsumptionKwh: number;
    /** Desired share of generated energy consumed on site, capped by annual demand. */
    selfConsumptionFraction: number;
    importTariffRupeesPerKwh: number;
    /** Explicit assumed export settlement value; zero is allowed. */
    exportRateRupeesPerKwh: number;
  };
  assumptions: BaseFinancialAssumptionsV1;
  sensitivity: BaseFinancialSensitivityAssumptionsV1;
}

export interface BaseFinancialAssumptionsV1 {
  annualDegradationFraction: number;
  annualImportTariffEscalationFraction: number;
  annualExportRateEscalationFraction: number;
  annualMaintenanceRupees: number;
  annualMaintenanceEscalationFraction: number;
}

export interface BaseFinancialSensitivityAssumptionsV1 {
  generationVariationFraction: number;
  tariffVariationFraction: number;
  systemCostVariationFraction: number;
}

/** Explicit illustrative rates, never prices or a local DISCOM settlement rule. */
export const BASE_FINANCIAL_ASSUMPTIONS_V1 = Object.freeze({
  annualDegradationFraction: 0.005,
  annualImportTariffEscalationFraction: 0.04,
  annualExportRateEscalationFraction: 0,
  annualMaintenanceEscalationFraction: 0.04,
});

/** One-variable-at-a-time sensitivity widths; all other inputs remain at base. */
export const BASE_FINANCIAL_SENSITIVITY_V1: Readonly<BaseFinancialSensitivityAssumptionsV1> = Object.freeze({
  generationVariationFraction: 0.1,
  tariffVariationFraction: 0.1,
  systemCostVariationFraction: 0.1,
});

export interface BaseFinancialYearV1 {
  year: number;
  generationKwh: number;
  selfConsumedKwh: number;
  exportedKwh: number;
  annualConsumptionKwh: number;
  importTariffRupeesPerKwh: number;
  exportRateRupeesPerKwh: number;
  selfConsumptionValueRupees: number;
  exportValueRupees: number;
  grossSavingsRupees: number;
  maintenanceCostRupees: number;
  netCashFlowRupees: number;
  cumulativeCashFlowRupees: number;
}

export interface BaseFinancialTotalsV1 {
  paybackYears: number | null;
  netSavingsOver25YearsRupees: number;
  yearOneGrossSavingsRupees: number;
  yearOneNetCashFlowRupees: number;
  totalGenerationKwh: number;
  totalSelfConsumedKwh: number;
  totalExportedKwh: number;
  totalSelfConsumptionValueRupees: number;
  totalExportValueRupees: number;
  totalGrossSavingsRupees: number;
  totalMaintenanceCostRupees: number;
}

export interface BaseFinancialSensitivityCaseV1 {
  /** 1 means the base input; low/high move only the named axis. */
  inputFactor: number;
  grossSystemCostRupees: number;
  yearOneGenerationKwh: number;
  importTariffRupeesPerKwh: number;
  exportRateRupeesPerKwh: number;
  totals: BaseFinancialTotalsV1;
}

export interface BaseFinancialSensitivityTripletV1 {
  low: BaseFinancialSensitivityCaseV1;
  base: BaseFinancialSensitivityCaseV1;
  high: BaseFinancialSensitivityCaseV1;
}

export type BaseFinancialWarningV1 =
  | "AVOIDABLE_IMPORT_TARIFF_ASSUMED"
  | "EXPORT_SETTLEMENT_UNVERIFIED"
  | "ANNUAL_CONSUMPTION_HELD_FLAT"
  | "GENERATION_USES_ASSUMED_YIELD"
  | "NO_PAYBACK_WITHIN_25_YEARS";

export interface BaseFinancialResultV1 {
  schemaVersion: 1;
  source: "DETERMINISTIC_BASE_FINANCIAL_V1";
  policyBenefitsEvaluated: false;
  financingModeled: false;
  horizonYears: 25;
  input: BaseFinancialInputV1;
  initialCashFlowRupees: number;
  annualRows: BaseFinancialYearV1[];
  totals: BaseFinancialTotalsV1;
  /** Tariff axis varies the import tariff only; the separately entered export value stays fixed. */
  sensitivity: {
    generation: BaseFinancialSensitivityTripletV1;
    importTariff: BaseFinancialSensitivityTripletV1;
    systemCost: BaseFinancialSensitivityTripletV1;
  };
  warnings: BaseFinancialWarningV1[];
}

const HORIZON_YEARS = 25;

function finite(value: number, label: string): void {
  if (!Number.isFinite(value)) throw new RangeError(`Invalid ${label}.`);
}

function nonnegative(value: number, label: string): void {
  finite(value, label);
  if (value < 0) throw new RangeError(`Invalid ${label}.`);
}

function positive(value: number, label: string): void {
  finite(value, label);
  if (value <= 0) throw new RangeError(`Invalid ${label}.`);
}

function fraction(value: number, label: string, maximum = 1): void {
  finite(value, label);
  if (value < 0 || value > maximum) throw new RangeError(`Invalid ${label}.`);
}

function escalation(value: number, label: string): void {
  finite(value, label);
  if (value <= -1 || value > 1) throw new RangeError(`Invalid ${label}.`);
}

function validate(input: BaseFinancialInputV1): void {
  if (input.schemaVersion !== 1 || !input.system || !input.quote || !input.usage || !input.assumptions || !input.sensitivity ||
    !["GOOGLE_DC_DERATED", "ASSUMED_YIELD"].includes(input.system.generationBasis)) {
    throw new RangeError("Unsupported base financial input.");
  }
  positive(input.system.nominalKw, "nominal system size");
  positive(input.system.actualDcKw, "actual DC system size");
  nonnegative(input.system.yearOneGenerationKwh, "year-one generation");
  positive(input.quote.grossSystemCostRupees, "quoted gross system cost");
  positive(input.usage.annualConsumptionKwh, "annual consumption");
  fraction(input.usage.selfConsumptionFraction, "self-consumption fraction");
  positive(input.usage.importTariffRupeesPerKwh, "import tariff");
  nonnegative(input.usage.exportRateRupeesPerKwh, "export rate");
  fraction(input.assumptions.annualDegradationFraction, "annual degradation");
  escalation(input.assumptions.annualImportTariffEscalationFraction, "import tariff escalation");
  escalation(input.assumptions.annualExportRateEscalationFraction, "export rate escalation");
  nonnegative(input.assumptions.annualMaintenanceRupees, "annual maintenance");
  escalation(input.assumptions.annualMaintenanceEscalationFraction, "maintenance escalation");
  fraction(input.sensitivity.generationVariationFraction, "generation sensitivity");
  fraction(input.sensitivity.tariffVariationFraction, "tariff sensitivity");
  fraction(input.sensitivity.systemCostVariationFraction, "cost sensitivity", 0.999999);
}

interface ScenarioInput {
  grossSystemCostRupees: number;
  yearOneGenerationKwh: number;
  importTariffRupeesPerKwh: number;
  exportRateRupeesPerKwh: number;
}

function calculateScenario(input: BaseFinancialInputV1, scenario: ScenarioInput):
  { annualRows: BaseFinancialYearV1[]; totals: BaseFinancialTotalsV1 } {
  const { usage, assumptions } = input;
  const rows: BaseFinancialYearV1[] = [];
  let cumulativeCashFlowRupees = -scenario.grossSystemCostRupees;
  let paybackYears: number | null = null;
  let totalGenerationKwh = 0, totalSelfConsumedKwh = 0, totalExportedKwh = 0;
  let totalSelfConsumptionValueRupees = 0, totalExportValueRupees = 0;
  let totalGrossSavingsRupees = 0, totalMaintenanceCostRupees = 0;
  for (let year = 1; year <= HORIZON_YEARS; year++) {
    const index = year - 1;
    const generationKwh = scenario.yearOneGenerationKwh * Math.pow(1 - assumptions.annualDegradationFraction, index);
    const selfConsumedKwh = Math.min(generationKwh * usage.selfConsumptionFraction, usage.annualConsumptionKwh);
    const exportedKwh = generationKwh - selfConsumedKwh;
    const importTariffRupeesPerKwh = scenario.importTariffRupeesPerKwh *
      Math.pow(1 + assumptions.annualImportTariffEscalationFraction, index);
    const exportRateRupeesPerKwh = scenario.exportRateRupeesPerKwh *
      Math.pow(1 + assumptions.annualExportRateEscalationFraction, index);
    const selfConsumptionValueRupees = selfConsumedKwh * importTariffRupeesPerKwh;
    const exportValueRupees = exportedKwh * exportRateRupeesPerKwh;
    const grossSavingsRupees = selfConsumptionValueRupees + exportValueRupees;
    const maintenanceCostRupees = assumptions.annualMaintenanceRupees *
      Math.pow(1 + assumptions.annualMaintenanceEscalationFraction, index);
    const netCashFlowRupees = grossSavingsRupees - maintenanceCostRupees;
    const beforeYearRupees = cumulativeCashFlowRupees;
    cumulativeCashFlowRupees += netCashFlowRupees;
    for (const [label, value] of Object.entries({ generationKwh, selfConsumedKwh, exportedKwh,
      importTariffRupeesPerKwh, exportRateRupeesPerKwh, selfConsumptionValueRupees, exportValueRupees,
      grossSavingsRupees, maintenanceCostRupees, netCashFlowRupees, cumulativeCashFlowRupees })) finite(value, label);
    if (paybackYears === null && beforeYearRupees < 0 && cumulativeCashFlowRupees >= 0 && netCashFlowRupees > 0) {
      paybackYears = index + -beforeYearRupees / netCashFlowRupees;
    }
    rows.push({ year, generationKwh, selfConsumedKwh, exportedKwh, annualConsumptionKwh: usage.annualConsumptionKwh,
      importTariffRupeesPerKwh, exportRateRupeesPerKwh, selfConsumptionValueRupees, exportValueRupees,
      grossSavingsRupees, maintenanceCostRupees, netCashFlowRupees, cumulativeCashFlowRupees });
    totalGenerationKwh += generationKwh;
    totalSelfConsumedKwh += selfConsumedKwh;
    totalExportedKwh += exportedKwh;
    totalSelfConsumptionValueRupees += selfConsumptionValueRupees;
    totalExportValueRupees += exportValueRupees;
    totalGrossSavingsRupees += grossSavingsRupees;
    totalMaintenanceCostRupees += maintenanceCostRupees;
  }
  for (const [label, value] of Object.entries({ totalGenerationKwh, totalSelfConsumedKwh, totalExportedKwh,
    totalSelfConsumptionValueRupees, totalExportValueRupees, totalGrossSavingsRupees, totalMaintenanceCostRupees })) finite(value, label);
  return { annualRows: rows, totals: {
    paybackYears, netSavingsOver25YearsRupees: cumulativeCashFlowRupees,
    yearOneGrossSavingsRupees: rows[0].grossSavingsRupees,
    yearOneNetCashFlowRupees: rows[0].netCashFlowRupees,
    totalGenerationKwh, totalSelfConsumedKwh, totalExportedKwh,
    totalSelfConsumptionValueRupees, totalExportValueRupees, totalGrossSavingsRupees, totalMaintenanceCostRupees,
  } };
}

/** Pure 25-year base case. Export settlement remains a user assumption until local rules are verified. */
export function calculateBaseFinancialsV1(input: BaseFinancialInputV1): BaseFinancialResultV1 {
  validate(input);
  const base: ScenarioInput = { grossSystemCostRupees: input.quote.grossSystemCostRupees,
    yearOneGenerationKwh: input.system.yearOneGenerationKwh,
    importTariffRupeesPerKwh: input.usage.importTariffRupeesPerKwh,
    exportRateRupeesPerKwh: input.usage.exportRateRupeesPerKwh };
  const result = calculateScenario(input, base);
  const scenario = (axis: keyof ScenarioInput, factor: number): BaseFinancialSensitivityCaseV1 => {
    const values = { ...base, [axis]: base[axis] * factor };
    const totals = factor === 1 ? result.totals : calculateScenario(input, values).totals;
    return { inputFactor: factor, ...values, totals };
  };
  const triplet = (axis: keyof ScenarioInput, variation: number): BaseFinancialSensitivityTripletV1 => ({
    low: scenario(axis, 1 - variation), base: scenario(axis, 1), high: scenario(axis, 1 + variation),
  });
  const warnings: BaseFinancialWarningV1[] = ["AVOIDABLE_IMPORT_TARIFF_ASSUMED",
    "EXPORT_SETTLEMENT_UNVERIFIED", "ANNUAL_CONSUMPTION_HELD_FLAT"];
  if (input.system.generationBasis === "ASSUMED_YIELD") warnings.push("GENERATION_USES_ASSUMED_YIELD");
  if (result.totals.paybackYears === null) warnings.push("NO_PAYBACK_WITHIN_25_YEARS");
  return { schemaVersion: 1, source: "DETERMINISTIC_BASE_FINANCIAL_V1", policyBenefitsEvaluated: false,
    financingModeled: false, horizonYears: HORIZON_YEARS,
    input: { schemaVersion: 1, system: { ...input.system }, quote: { ...input.quote }, usage: { ...input.usage },
      assumptions: { ...input.assumptions }, sensitivity: { ...input.sensitivity } },
    initialCashFlowRupees: -base.grossSystemCostRupees, annualRows: result.annualRows, totals: result.totals,
    sensitivity: {
      generation: triplet("yearOneGenerationKwh", input.sensitivity.generationVariationFraction),
      importTariff: triplet("importTariffRupeesPerKwh", input.sensitivity.tariffVariationFraction),
      systemCost: triplet("grossSystemCostRupees", input.sensitivity.systemCostVariationFraction),
    }, warnings };
}
