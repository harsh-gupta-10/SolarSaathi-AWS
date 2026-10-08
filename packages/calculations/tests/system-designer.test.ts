import type { NormalizedRoofV1, RoofPoint } from "@solarsaathi/types";
import { describe, expect, it } from "vitest";
import { designSolarSystem, getRoofLayoutAssumptionsV1, getSystemDesignAssumptionsV1 } from "../src";

const METRES_PER_DEGREE = 6_371_000 * Math.PI / 180;
const location = (eastMeters: number, northMeters: number): RoofPoint => ({
  latitude: northMeters / METRES_PER_DEGREE, longitude: eastMeters / METRES_PER_DEGREE,
});

const manualRoof = (dimensions: { lengthMeters: number; widthMeters: number } | null =
  { lengthMeters: 10, widthMeters: 8 }): NormalizedRoofV1 => ({
  schemaVersion: 1, source: "MANUAL", measuredAt: "2026-10-08T10:00:00.000Z",
  roofAreaSquareMeters: 80, segmentCount: 1,
  segments: [{ segmentId: "manual-0", areaSquareMeters: 80 }],
  ...(dimensions ? { manualDimensions: dimensions } : {}),
});

const googleRoof = (energyPerPanelKwh = 600): NormalizedRoofV1 => ({
  schemaVersion: 1, source: "GOOGLE_SOLAR", measuredAt: "2026-10-08T10:00:00.000Z",
  roofAreaSquareMeters: 100, groundAreaSquareMeters: 100, segmentCount: 1,
  segments: [{ segmentId: "segment-0", areaSquareMeters: 100, groundAreaSquareMeters: 100,
    pitchDegrees: 0, azimuthDegrees: 180, center: location(0, 0),
    bounds: { southwest: location(-5, -5), northeast: location(5, 5) } }],
  center: location(0, 0), panelWidthMeters: 1, panelHeightMeters: 2, panelCapacityWatts: 500,
  panelSuggestions: [[-2, -2], [2, 2]].map(([east, north]) => ({
    center: location(east, north), orientation: "PORTRAIT" as const, segmentIndex: 0,
    yearlyEnergyDcKwh: energyPerPanelKwh,
  })),
});

describe("deterministic system designer", () => {
  it("uses versioned shared layout assumptions and integer panel DC sizing", () => {
    const roof = manualRoof();
    const assumptions = getSystemDesignAssumptionsV1(roof);
    expect(assumptions.roofLayout).toEqual(getRoofLayoutAssumptionsV1(roof));
    expect(assumptions.candidateNominalKw).toEqual([1, 2, 3, 5, 7.5, 10]);
    const result = designSolarSystem(roof, { kind: "CONSUMPTION", monthlyConsumptionKwh: 250 }, assumptions);
    expect(result.roof.fitStatus).toBe("SPACE_FEASIBLE");
    expect(result.roof.maxPanelCount).toBe(16);
    expect(result.candidates[0]).toMatchObject({ nominalKw: 1, panelCount: 2,
      actualDcKw: 1.1, generationBasis: "ASSUMED_YIELD" });
    expect(result.candidates[0].estimatedAnnualGenerationKwh).toBeCloseTo(1_650);
    expect(result.candidates[1].panelCount).toBe(4);
    expect(result.candidates[1].actualDcKw).toBe(2.2);
    expect(result.candidates[1].minimumInverterAcKw).toBeCloseTo(2.2 / 1.2);
    expect(result.recommendation?.nominalKw).toBe(2);
    expect(result.recommendation?.estimatedAnnualGenerationKwh).toBeCloseTo(3_300);
    expect(result.candidates.at(-1)?.reasonCodes).toContain("EXCEEDS_MODELED_ROOF");
    expect(result.warnings).toContain("LOCAL_RULES_NOT_CHECKED");
    expect(result.warnings).toContain("SANCTIONED_LOAD_NOT_PROVIDED");
    expect(result.warnings).toContain("MANUAL_FIT_NEEDS_SITE_SURVEY");
  });

  it("converts a bill only with an explicit tariff and labels the approximate demand", () => {
    const roof = manualRoof();
    const result = designSolarSystem(roof, { kind: "BILL", monthlyBillRupees: 1_200,
      tariffRupeesPerKwh: 6 }, getSystemDesignAssumptionsV1(roof));
    expect(result.demand).toMatchObject({ source: "BILL_ESTIMATE", monthlyConsumptionKwh: 200,
      annualConsumptionKwh: 2_400, tariffRupeesPerKwh: 6 });
    expect(result.warnings).toContain("BILL_TO_KWH_IS_APPROXIMATE");
    expect(result.recommendation?.nominalKw).toBe(1);
    expect(result.candidates[1].reasonCodes).toContain("EXCEEDS_DEMAND_LIMIT");
  });

  it("does not roof-qualify an area-only manual roof", () => {
    const roof = manualRoof(null);
    const result = designSolarSystem(roof, { kind: "CONSUMPTION", monthlyConsumptionKwh: 250 },
      getSystemDesignAssumptionsV1(roof));
    expect(result.roof.maxPanelCount).toBeNull();
    expect(result.recommendation).toBeNull();
    expect(result.decisionCode).toBe("ROOF_FIT_UNDETERMINED");
    expect(result.candidates.every(candidate => candidate.roofFit === "UNDETERMINED" &&
      !candidate.recommendationEligible)).toBe(true);
  });

  it("uses Google's per-panel DC energy with an explicit derate only for matching panel specs", () => {
    const roof = googleRoof();
    const assumptions = getSystemDesignAssumptionsV1(roof);
    expect(assumptions.roofLayout).toMatchObject({ panelWidthMeters: 1, panelHeightMeters: 2,
      panelCapacityWatts: 500 });
    const result = designSolarSystem(roof, { kind: "CONSUMPTION", monthlyConsumptionKwh: 85 }, assumptions);
    expect(result.roof.maxPanelCount).toBe(2);
    expect(result.candidates[0]).toMatchObject({ panelCount: 2, actualDcKw: 1,
      generationBasis: "GOOGLE_DC_DERATED", estimatedAnnualGenerationKwh: 1_020 });
    expect(result.recommendation?.nominalKw).toBe(1);
    expect(result.warnings).toContain("GOOGLE_DC_TO_AC_FACTOR_ASSUMED");
    expect(result.warnings).toContain("GOOGLE_ROOF_FIT_APPROXIMATE");

    const differentPanel = designSolarSystem(roof, { kind: "CONSUMPTION", monthlyConsumptionKwh: 140 },
      { ...assumptions, roofLayout: { ...assumptions.roofLayout, panelCapacityWatts: 550 } });
    expect(differentPanel.candidates[0].generationBasis).toBe("ASSUMED_YIELD");
    expect(differentPanel.candidates[0].estimatedAnnualGenerationKwh).toBeCloseTo(1_650);
    expect(differentPanel.roof.layoutWarnings).toContain("PANEL_SPECS_DIFFER_FROM_GOOGLE_MODEL");
  });

  it("falls back from schema-valid but implausible Google panel specifications", () => {
    const roof = googleRoof();
    roof.panelCapacityWatts = 10_000;
    const assumptions = getSystemDesignAssumptionsV1(roof);
    expect(assumptions.roofLayout).toMatchObject({ panelWidthMeters: 1.1,
      panelHeightMeters: 2, panelCapacityWatts: 550 });
    const result = designSolarSystem(roof, { kind: "CONSUMPTION", monthlyConsumptionKwh: 140 }, assumptions);
    expect(result.candidates[0]).toMatchObject({ nominalKw: 1, panelCount: 2,
      actualDcKw: 1.1, generationBasis: "ASSUMED_YIELD" });
    expect(result.roof.layoutWarnings).toContain("PANEL_SPECS_DIFFER_FROM_GOOGLE_MODEL");
    expect(result.warnings).toContain("ASSUMED_YIELD_USED");

    const oversized = googleRoof();
    oversized.panelWidthMeters = 10;
    expect(getRoofLayoutAssumptionsV1(oversized).panelWidthMeters).toBe(1.1);
    const excessiveDensity = googleRoof();
    excessiveDensity.panelWidthMeters = 0.5;
    excessiveDensity.panelHeightMeters = 2;
    excessiveDensity.panelCapacityWatts = 800;
    expect(getRoofLayoutAssumptionsV1(excessiveDensity).panelCapacityWatts).toBe(550);
  });

  it("flags above-sanctioned-load candidates for local review without imposing a legal cap", () => {
    const roof = manualRoof();
    const result = designSolarSystem(roof, { kind: "CONSUMPTION", monthlyConsumptionKwh: 250,
      sanctionedLoadKw: 1 }, getSystemDesignAssumptionsV1(roof));
    expect(result.recommendation?.nominalKw).toBe(2);
    expect(result.recommendation?.recommendationEligible).toBe(true);
    expect(result.recommendation?.reasonCodes).toContain("SANCTIONED_LOAD_REVIEW_NEEDED");
    expect(result.warnings).toContain("SANCTIONED_LOAD_REVIEW_NEEDED");
    expect(result.warnings).not.toContain("SANCTIONED_LOAD_NOT_PROVIDED");
  });

  it("returns explicit decisions for no-fit and zero-generation roofs", () => {
    const small = manualRoof({ lengthMeters: 2, widthMeters: 2 });
    const noFit = designSolarSystem(small, { kind: "CONSUMPTION", monthlyConsumptionKwh: 100 },
      getSystemDesignAssumptionsV1(small));
    expect(noFit.recommendation).toBeNull();
    expect(noFit.decisionCode).toBe("NO_CANDIDATE_WITHIN_ROOF");

    const shaded = googleRoof(0);
    const noGeneration = designSolarSystem(shaded, { kind: "CONSUMPTION", monthlyConsumptionKwh: 100 },
      getSystemDesignAssumptionsV1(shaded));
    expect(noGeneration.recommendation).toBeNull();
    expect(noGeneration.decisionCode).toBe("NO_CANDIDATE_WITH_MODELED_GENERATION");
    expect(noGeneration.candidates[0].reasonCodes).toContain("ZERO_MODELED_GENERATION");
  });

  it("rejects invalid demand and assumptions rather than returning misleading sizes", () => {
    const roof = manualRoof();
    const assumptions = getSystemDesignAssumptionsV1(roof);
    for (const badDemand of [
      { kind: "CONSUMPTION" as const, monthlyConsumptionKwh: 0 },
      { kind: "CONSUMPTION" as const, monthlyConsumptionKwh: Number.NaN },
      { kind: "BILL" as const, monthlyBillRupees: 1_000, tariffRupeesPerKwh: 0 },
      { kind: "CONSUMPTION" as const, monthlyConsumptionKwh: 100, sanctionedLoadKw: -1 },
    ]) expect(() => designSolarSystem(roof, badDemand, assumptions)).toThrow(RangeError);
    for (const badAssumptions of [
      { candidateNominalKw: [1, 1] }, { candidateNominalKw: [1, Infinity] },
      { googleDcToAcEnergyFactor: 1.1 }, { inverterDcAcRatio: 0 },
      { generationKwhPerKwYear: 0 }, { roofLayout: { ...assumptions.roofLayout, panelCapacityWatts: 0 } },
    ]) expect(() => designSolarSystem(roof, { kind: "CONSUMPTION", monthlyConsumptionKwh: 100 },
      { ...assumptions, ...badAssumptions })).toThrow(RangeError);
  });
});
