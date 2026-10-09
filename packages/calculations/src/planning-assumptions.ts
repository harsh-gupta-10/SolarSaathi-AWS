import type { NormalizedRoofV1 } from "@solarsaathi/types";
import type { RoofLayoutAssumptions } from "./roof-layout";
import type { SystemDesignAssumptionsV1 } from "./system-designer";

/** Versioned, illustrative geometry inputs. They are not regulatory setback requirements. */
export const ROOF_LAYOUT_BASELINE_V1: Readonly<RoofLayoutAssumptions> = Object.freeze({
  schemaVersion: 1,
  panelWidthMeters: 1.1,
  panelHeightMeters: 2,
  panelCapacityWatts: 550,
  edgeSetbackMeters: 0.5,
  panelGapMeters: 0.05,
  servicePathWidthMeters: 0.75,
  mountingOffsetMeters: 0.1,
  maxModeledPitchDegrees: 85,
  manualAreaToleranceFraction: 0.05,
  maxPanels: 300,
});

/** Modeling guardrails for one module, not product certification or an official panel standard. */
export const GOOGLE_PANEL_SPEC_GUARDRAILS_V1 = Object.freeze({
  minimumSideMeters: 0.5,
  maximumSideMeters: 3,
  minimumAreaSquareMeters: 1,
  maximumAreaSquareMeters: 3.5,
  minimumCapacityWatts: 150,
  maximumCapacityWatts: 800,
  minimumPowerDensityWattsPerSquareMeter: 100,
  maximumPowerDensityWattsPerSquareMeter: 400,
});

function plausibleGooglePanelSpec(roof: NormalizedRoofV1): roof is NormalizedRoofV1 & {
  panelWidthMeters: number; panelHeightMeters: number; panelCapacityWatts: number;
} {
  if (roof.source !== "GOOGLE_SOLAR") return false;
  const width = roof.panelWidthMeters, height = roof.panelHeightMeters, capacity = roof.panelCapacityWatts;
  if (width === undefined || height === undefined || capacity === undefined ||
    !Number.isFinite(width) || !Number.isFinite(height) || !Number.isFinite(capacity)) return false;
  const guardrails = GOOGLE_PANEL_SPEC_GUARDRAILS_V1;
  const area = width * height;
  const powerDensity = capacity / area;
  return width >= guardrails.minimumSideMeters && width <= guardrails.maximumSideMeters &&
    height >= guardrails.minimumSideMeters && height <= guardrails.maximumSideMeters &&
    area >= guardrails.minimumAreaSquareMeters && area <= guardrails.maximumAreaSquareMeters &&
    capacity >= guardrails.minimumCapacityWatts && capacity <= guardrails.maximumCapacityWatts &&
    powerDensity >= guardrails.minimumPowerDensityWattsPerSquareMeter &&
    powerDensity <= guardrails.maximumPowerDensityWattsPerSquareMeter;
}

export function getRoofLayoutAssumptionsV1(roof: NormalizedRoofV1): RoofLayoutAssumptions {
  if (!plausibleGooglePanelSpec(roof)) return { ...ROOF_LAYOUT_BASELINE_V1 };
  return {
    ...ROOF_LAYOUT_BASELINE_V1,
    panelWidthMeters: roof.panelWidthMeters,
    panelHeightMeters: roof.panelHeightMeters,
    panelCapacityWatts: roof.panelCapacityWatts,
  };
}

/** Engineering estimates; each value is echoed in the designer result. */
export const SYSTEM_DESIGN_BASELINE_V1 = Object.freeze({
  candidateNominalKw: Object.freeze([1, 2, 3, 5, 7.5, 10]),
  generationKwhPerKwYear: 1_500,
  googleDcToAcEnergyFactor: 0.85,
  inverterDcAcRatio: 1.2,
  targetCoverageFraction: 1,
  maximumGenerationToDemandRatio: 1.25,
});

export function getSystemDesignAssumptionsV1(roof: NormalizedRoofV1): SystemDesignAssumptionsV1 {
  return { schemaVersion: 1, roofLayout: getRoofLayoutAssumptionsV1(roof), ...SYSTEM_DESIGN_BASELINE_V1 };
}

export type IndicativeBudgetTierIdV1 = "ECONOMY" | "STANDARD" | "PREMIUM";

export interface IndicativeBudgetTierV1 {
  id: IndicativeBudgetTierIdV1;
  label: string;
  minPerKwRupees: number;
  maxPerKwRupees: number;
  typicalPerKwRupees: number;
  description: string;
}

/** Prevailing Indian rooftop solar benchmark ranges (pre-subsidy gross cost per kW). */
export const INDICATIVE_BUDGET_TIERS_V1: readonly IndicativeBudgetTierV1[] = Object.freeze([
  {
    id: "ECONOMY",
    label: "Economy tier",
    minPerKwRupees: 50_000,
    maxPerKwRupees: 58_000,
    typicalPerKwRupees: 54_000,
    description: "Standard string inverter & conventional poly/mono-PERC panels.",
  },
  {
    id: "STANDARD",
    label: "Standard / Mid tier",
    minPerKwRupees: 60_000,
    maxPerKwRupees: 68_000,
    typicalPerKwRupees: 64_000,
    description: "High-efficiency mono PERC / TOPCon DCR panels & reliable tier-1 inverter.",
  },
  {
    id: "PREMIUM",
    label: "Premium tier",
    minPerKwRupees: 70_000,
    maxPerKwRupees: 82_000,
    typicalPerKwRupees: 75_000,
    description: "Bifacial / high-wattage modules, microinverters, or hybrid-ready systems.",
  },
]);

export interface IndicativeBudgetRangeOptionV1 {
  tier: IndicativeBudgetTierIdV1;
  label: string;
  description: string;
  minPerKwRupees: number;
  maxPerKwRupees: number;
  typicalPerKwRupees: number;
  minTotalRupees: number;
  maxTotalRupees: number;
  typicalTotalRupees: number;
  perKwRangeLabel: string;
}

export function getIndicativeBudgetRangesV1(nominalKw: number): IndicativeBudgetRangeOptionV1[] {
  const safeKw = Number.isFinite(nominalKw) && nominalKw > 0 ? nominalKw : 1;
  return INDICATIVE_BUDGET_TIERS_V1.map(tier => ({
    tier: tier.id,
    label: tier.label,
    description: tier.description,
    minPerKwRupees: tier.minPerKwRupees,
    maxPerKwRupees: tier.maxPerKwRupees,
    typicalPerKwRupees: tier.typicalPerKwRupees,
    minTotalRupees: Math.round(tier.minPerKwRupees * safeKw),
    maxTotalRupees: Math.round(tier.maxPerKwRupees * safeKw),
    typicalTotalRupees: Math.round(tier.typicalPerKwRupees * safeKw),
    perKwRangeLabel: `₹${(tier.minPerKwRupees / 1000).toFixed(0)}k–₹${(tier.maxPerKwRupees / 1000).toFixed(0)}k/kW`,
  }));
}

export const FINANCIAL_INPUT_PRESETS_V1 = Object.freeze({
  selfConsumption: Object.freeze([
    { value: 90, label: "90% — Typical residential net-metering default" },
    { value: 80, label: "80% — Moderate daytime home presence" },
    { value: 70, label: "70% — Working household (evening peak)" },
    { value: 100, label: "100% — Full self-use (heavy daytime appliances/EV)" },
  ]),
  importTariff: Object.freeze([
    { value: 7.5, label: "₹7.50/kWh — Average domestic DISCOM tariff (Standard slab)" },
    { value: 6.0, label: "₹6.00/kWh — Lower consumption slab" },
    { value: 9.0, label: "₹9.00/kWh — High-tier consumption / Metro slab" },
    { value: 11.0, label: "₹11.00/kWh — Commercial / Peak slab" },
  ]),
  exportRate: Object.freeze([
    { value: 0, label: "₹0.00/kWh — No export credit / Self-use only (Conservative)" },
    { value: 2.5, label: "₹2.50/kWh — Average DISCOM APPC feed-in rate" },
    { value: 3.5, label: "₹3.50/kWh — Favorable state solar feed-in tariff" },
  ]),
  maintenance: Object.freeze([
    { value: 0, label: "₹0/yr — Covered by installer warranty / 5-yr free AMC" },
    { value: 1500, label: "₹1,500/yr — Basic cleaning & electrical inspection" },
    { value: 3000, label: "₹3,000/yr — Comprehensive annual maintenance contract (AMC)" },
  ]),
});

