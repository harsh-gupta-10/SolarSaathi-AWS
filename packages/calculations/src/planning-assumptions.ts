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
