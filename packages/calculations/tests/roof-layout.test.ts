import type { NormalizedRoofV1, RoofPoint } from "@solarsaathi/types";
import { describe, expect, it } from "vitest";
import { planRoofLayout, type RoofLayoutAssumptions } from "../src";

const METRES_PER_DEGREE = 6_371_000 * Math.PI / 180;
const location = (eastMeters: number, northMeters: number): RoofPoint => ({
  latitude: northMeters / METRES_PER_DEGREE, longitude: eastMeters / METRES_PER_DEGREE,
});
const assumptions: RoofLayoutAssumptions = {
  schemaVersion: 1, panelWidthMeters: 1, panelHeightMeters: 2, panelCapacityWatts: 500,
  edgeSetbackMeters: 0.5, panelGapMeters: 0.1, servicePathWidthMeters: 1,
  mountingOffsetMeters: 0.1, manualAreaToleranceFraction: 0.05, maxModeledPitchDegrees: 85, maxPanels: 300,
};
const googleRoof = (panelPositions: Array<[number, number]> | null = [[-2, -2], [2, -2], [-2, 2], [2, 2]]): NormalizedRoofV1 => ({
  schemaVersion: 1, source: "GOOGLE_SOLAR", measuredAt: "2026-10-08T10:00:00.000Z",
  roofAreaSquareMeters: 100, groundAreaSquareMeters: 100, segmentCount: 1,
  segments: [{ segmentId: "segment-0", areaSquareMeters: 100, groundAreaSquareMeters: 100,
    pitchDegrees: 0, azimuthDegrees: 180, planeHeightAtCenterMeters: 9,
    center: location(0, 0), bounds: { southwest: location(-5, -5), northeast: location(5, 5) } }],
  center: location(0, 0), buildingId: "buildings/example", panelWidthMeters: 1, panelHeightMeters: 2,
  panelCapacityWatts: 500,
  ...(panelPositions === null ? {} : { panelSuggestions: panelPositions.map(([east, north]) => ({
    center: location(east, north), orientation: "PORTRAIT" as const, segmentIndex: 0,
    yearlyEnergyDcKwh: 600,
  })) }),
});
const manualRoof = (dimensions: { lengthMeters?: number; widthMeters?: number } | null =
  { lengthMeters: 10, widthMeters: 8 }): NormalizedRoofV1 => ({
  schemaVersion: 1, source: "MANUAL", measuredAt: "2026-10-08T10:00:00.000Z",
  roofAreaSquareMeters: 80, segmentCount: 1,
  segments: [{ segmentId: "manual-segment-0", areaSquareMeters: 80 }],
  ...(dimensions ? { manualDimensions: dimensions } : {}),
});

describe("deterministic roof geometry and layout", () => {
  it("projects Google coordinates to east/up/north metres and preserves measured plane height", () => {
    const result = planRoofLayout(googleRoof(), assumptions);
    expect(result.coordinateSystem).toBe("LOCAL_EAST_UP_NORTH_METERS");
    expect(result.fitStatus).toBe("MODELED_APPROXIMATE");
    expect(result.segments[0].geometryKind).toBe("GOOGLE_BOUNDS_APPROXIMATE");
    expect(result.segments[0].center).toMatchObject({ x: expect.closeTo(0, 5), y: 9, z: expect.closeTo(0, 5) });
    expect(result.bounds?.min.x).toBeCloseTo(-5, 1);
    expect(result.bounds?.max.z).toBeCloseTo(5, 1);
    expect(result.panels[0].center.x).toBeCloseTo(-2, 1);
    expect(result.panels[0].center.y).toBeCloseTo(9.1, 1);
    expect(result.panels[0].center.z).toBeCloseTo(-2, 1);
    expect(result.panelCount).toBe(4);
    expect(result.dcCapacityKw).toBe(2);
    expect(result.warnings).toContain("GOOGLE_BOUNDS_ARE_APPROXIMATE");
  });

  it("uses pitch and azimuth to tilt the modeled plane without AI geometry", () => {
    const roof = googleRoof([]);
    roof.segments[0].pitchDegrees = 45;
    roof.segments[0].azimuthDegrees = 180;
    roof.segments[0].groundAreaSquareMeters = 50;
    const segment = planRoofLayout(roof, assumptions).segments[0];
    const south = segment.corners[0], north = segment.corners[3];
    expect(north.y).toBeGreaterThan(south.y);
    expect(north.y - south.y).toBeCloseTo(north.z - south.z, 5);
  });

  it("filters suggested panels that cross modeled setbacks, aisle or another panel", () => {
    const roof = googleRoof([[-2, -2], [-2, -2], [4.7, 3], [0, 0], [2, 2]]);
    const result = planRoofLayout(roof, assumptions);
    expect(result.panelCount).toBe(2);
    expect(result.panels.map(panel => panel.panelId)).toEqual(["google-1", "google-5"]);
    expect(result.warnings).toContain("PANELS_FILTERED_FOR_CLEARANCE");
    for (const panel of result.panels) {
      expect(panel.corners.every(corner => Math.abs(corner.x) <= 4.5 && Math.abs(corner.z) <= 4.5)).toBe(true);
      expect(panel.corners.every(corner => corner.z <= -0.5 || corner.z >= 0.5)).toBe(true);
    }
  });

  it("keeps a Google fit indeterminate when suggestions or segment bounds are unavailable", () => {
    const noSuggestions = planRoofLayout(googleRoof(null), assumptions);
    expect(noSuggestions.panelCount).toBeNull();
    expect(noSuggestions.fitStatus).toBe("UNDETERMINED");
    expect(noSuggestions.warnings).toContain("PANEL_SUGGESTIONS_MISSING");
    const noBounds = googleRoof();
    noBounds.segments[0].bounds = undefined;
    const indeterminate = planRoofLayout(noBounds, assumptions);
    expect(indeterminate.panelCount).toBeNull();
    expect(indeterminate.panels).toEqual([]);
    expect(indeterminate.warnings).toContain("SEGMENT_BOUNDS_MISSING");
    expect(indeterminate.warnings).toContain("NO_USABLE_GEOMETRY");
  });

  it("distinguishes an explicit zero-panel provider result from unavailable suggestions", () => {
    const result = planRoofLayout(googleRoof([]), assumptions);
    expect(result.fitStatus).toBe("MODELED_APPROXIMATE");
    expect(result.panelCount).toBe(0);
    expect(result.dcCapacityKw).toBe(0);
  });

  it("does not carry Google's per-panel energy estimate into a different panel specification", () => {
    const result = planRoofLayout(googleRoof(), { ...assumptions, panelCapacityWatts: 550 });
    expect(result.panelCount).toBe(4);
    expect(result.dcCapacityKw).toBe(2.2);
    expect(result.panels.every(panel => panel.yearlyEnergyDcKwh === undefined)).toBe(true);
    expect(result.warnings).toContain("PANEL_SPECS_DIFFER_FROM_GOOGLE_MODEL");
    expect(planRoofLayout(googleRoof(), assumptions).panels[0].yearlyEnergyDcKwh).toBe(600);
  });

  it("packs manual dimensions conservatively around a full-length service path", () => {
    const result = planRoofLayout(manualRoof(), assumptions);
    expect(result.fitStatus).toBe("SPACE_FEASIBLE");
    expect(result.segments[0].geometryKind).toBe("MANUAL_RECTANGLE");
    expect(result.panelCount).toBe(16);
    expect(result.dcCapacityKw).toBe(8);
    expect(result.panels).toHaveLength(16);
    for (const panel of result.panels) {
      expect(panel.corners.every(corner => Math.abs(corner.x) <= 3.5 && Math.abs(corner.z) <= 4.5)).toBe(true);
      expect(panel.corners.every(corner => corner.x <= -0.5 || corner.x >= 0.5)).toBe(true);
    }
  });

  it("shows an area-only manual plane without claiming a panel fit", () => {
    const result = planRoofLayout(manualRoof(null), assumptions);
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0].geometryKind).toBe("AREA_ONLY_ILLUSTRATION");
    expect(result.panels).toEqual([]);
    expect(result.panelCount).toBeNull();
    expect(result.dcCapacityKw).toBeNull();
    expect(result.fitStatus).toBe("UNDETERMINED");
    expect(result.warnings).toContain("AREA_ONLY_MANUAL_ROOF");
    const pitched = manualRoof(null);
    pitched.segments[0].pitchDegrees = 60;
    const modeled = planRoofLayout(pitched, assumptions);
    expect((modeled.bounds?.max.x ?? 0) - (modeled.bounds?.min.x ?? 0)).toBeCloseTo(Math.sqrt(40));
    expect(modeled.panelCount).toBeNull();
  });

  it("interprets manual length and width as ground-plan dimensions on a pitched roof", () => {
    const roof = manualRoof();
    roof.roofAreaSquareMeters = 160;
    roof.segments[0].areaSquareMeters = 160;
    roof.segments[0].pitchDegrees = 60;
    roof.segments[0].azimuthDegrees = 180;
    const result = planRoofLayout(roof, assumptions);
    expect(result.warnings).not.toContain("MANUAL_AREA_DIFFERS_FROM_DIMENSIONS");
    expect(result.segments[0].corners[3].y).toBeGreaterThan(result.segments[0].corners[0].y);
    expect(result.panelCount).toBeGreaterThan(0);
    const rounded = manualRoof();
    rounded.roofAreaSquareMeters = 100;
    rounded.segments[0].areaSquareMeters = 100;
    rounded.manualDimensions = { lengthMeters: 10, widthMeters: 10 };
    rounded.segments[0].pitchDegrees = 8;
    expect(planRoofLayout(rounded, assumptions).warnings).not.toContain("MANUAL_AREA_DIFFERS_FROM_DIMENSIONS");
  });

  it("leaves near-vertical segments unmodeled instead of producing unbounded heights", () => {
    const manual = manualRoof(); manual.segments[0].pitchDegrees = 89;
    const result = planRoofLayout(manual, assumptions);
    expect(result.panelCount).toBeNull();
    expect(result.bounds).toBeNull();
    expect(result.warnings).toContain("NEAR_VERTICAL_SEGMENT");
    const google = googleRoof(); google.segments[0].pitchDegrees = 90;
    expect(planRoofLayout(google, assumptions).panelCount).toBeNull();
  });

  it("reports zero where a dimensioned roof cannot fit the explicit setbacks", () => {
    const result = planRoofLayout(manualRoof({ lengthMeters: 2, widthMeters: 2 }), assumptions);
    expect(result.fitStatus).toBe("SPACE_FEASIBLE");
    expect(result.panelCount).toBe(0);
    expect(result.warnings).toContain("MANUAL_AREA_DIFFERS_FROM_DIMENSIONS");
  });

  it("caps selected panels and reports when an explicit limit is reached", () => {
    const result = planRoofLayout(manualRoof(), { ...assumptions, maxPanels: 3 });
    expect(result.panelCount).toBe(3);
    expect(result.warnings).toContain("PANEL_LIMIT_REACHED");
    const exact = planRoofLayout(manualRoof({ lengthMeters: 2, widthMeters: 2 }), {
      ...assumptions, edgeSetbackMeters: 0, panelGapMeters: 0, servicePathWidthMeters: 0, maxPanels: 2,
    });
    expect(exact.panelCount).toBe(2);
    expect(exact.warnings).not.toContain("PANEL_LIMIT_REACHED");
  });

  it("rejects non-finite, negative and unsupported modeling inputs", () => {
    for (const changed of [
      { edgeSetbackMeters: -1 }, { panelGapMeters: Number.NaN }, { panelCapacityWatts: 0 },
      { servicePathWidthMeters: -0.1 }, { mountingOffsetMeters: -0.1 }, { maxPanels: 1.5 },
      { maxModeledPitchDegrees: 90 },
      { manualAreaToleranceFraction: -0.1 },
      { schemaVersion: 2 as 1 },
    ]) expect(() => planRoofLayout(manualRoof(), { ...assumptions, ...changed })).toThrow(RangeError);
    const invalidRoof = manualRoof(); invalidRoof.roofAreaSquareMeters = Infinity;
    expect(() => planRoofLayout(invalidRoof, assumptions)).toThrow(RangeError);
  });
});
