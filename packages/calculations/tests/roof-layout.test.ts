import type { NormalizedRoofV1, RoofPoint } from "@solarsaathi/types";
import { describe, expect, it } from "vitest";
import { convexHull, fitRotatedRectangle, googleBuildingOutline, planRoofLayout, segmentPlanRotationDegrees, type RoofLayoutAssumptions, type RoofLayoutOptions, type RoofLayoutSegment } from "../src";

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
  it("projects Google coordinates to east/up/north metres with heights relative to the lowest plane", () => {
    const result = planRoofLayout(googleRoof(), assumptions);
    expect(result.coordinateSystem).toBe("LOCAL_EAST_UP_NORTH_METERS");
    expect(result.fitStatus).toBe("MODELED_APPROXIMATE");
    expect(result.segments[0].geometryKind).toBe("GOOGLE_BOUNDS_APPROXIMATE");
    expect(result.segments[0].center).toMatchObject({ x: expect.closeTo(0, 5), y: 0, z: expect.closeTo(0, 5) });
    expect(result.bounds?.min.x).toBeCloseTo(-5, 1);
    expect(result.bounds?.max.z).toBeCloseTo(5, 1);
    expect(result.panels[0].center.x).toBeCloseTo(-2, 1);
    expect(result.panels[0].center.y).toBeCloseTo(0.1, 5);
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

  it("folds azimuths into a plan rotation and fits a rotated rectangle to its bounding box", () => {
    expect(segmentPlanRotationDegrees(180)).toBe(0);
    expect(segmentPlanRotationDegrees(30)).toBe(30);
    expect(segmentPlanRotationDegrees(120)).toBe(30);
    expect(segmentPlanRotationDegrees(80)).toBe(-10);
    expect(segmentPlanRotationDegrees(315)).toBe(-45);
    const angle = 30 * Math.PI / 180;
    const width = 10 * Math.cos(angle) + 6 * Math.sin(angle), depth = 10 * Math.sin(angle) + 6 * Math.cos(angle);
    const exact = fitRotatedRectangle(width, depth, 60, 30);
    expect(exact.along).toBeCloseTo(10, 6);
    expect(exact.across).toBeCloseTo(6, 6);
    const irregular = fitRotatedRectangle(width, depth, 30, 30);
    expect(irregular.along * irregular.across).toBeCloseTo(30, 6);
    expect(irregular.along / irregular.across).toBeCloseTo(10 / 6, 6);
    expect(fitRotatedRectangle(10, 10, 50, 0)).toEqual({ along: Math.sqrt(50), across: Math.sqrt(50) });
  });

  it("models a rotated plane as a rotated rectangle and keeps every panel inside its setbacks", () => {
    const angle = 30 * Math.PI / 180;
    const width = 12 * Math.cos(angle) + 8 * Math.sin(angle), depth = 12 * Math.sin(angle) + 8 * Math.cos(angle);
    const along = { x: Math.cos(angle), z: -Math.sin(angle) }, across = { x: Math.sin(angle), z: Math.cos(angle) };
    const grid: Array<[number, number]> = [];
    for (const u of [-3.5, -1.2, 1.2, 3.5]) for (const v of [-2.2, 2.2]) grid.push([u * along.x + v * across.x, u * along.z + v * across.z]);
    const roof = googleRoof(grid);
    Object.assign(roof.segments[0], { azimuthDegrees: 30, groundAreaSquareMeters: 96,
      bounds: { southwest: location(-width / 2, -depth / 2), northeast: location(width / 2, depth / 2) } });
    roof.panelWidthMeters = 1; roof.panelHeightMeters = 2;
    const result = planRoofLayout(roof, assumptions);
    const [c0, c1, , c3] = result.segments[0].corners;
    expect(Math.hypot(c1.x - c0.x, c1.z - c0.z)).toBeCloseTo(12, 4);
    expect(Math.hypot(c3.x - c0.x, c3.z - c0.z)).toBeCloseTo(8, 4);
    expect(result.panelCount).toBe(8);
    const local = (point: { x: number; z: number }) => ({ u: point.x * along.x + point.z * along.z, v: point.x * across.x + point.z * across.z });
    for (const panel of result.panels) {
      for (const corner of panel.corners) {
        const { u, v } = local(corner);
        expect(Math.abs(u)).toBeLessThanOrEqual(6 - assumptions.edgeSetbackMeters + 1e-6);
        expect(Math.abs(v)).toBeLessThanOrEqual(4 - assumptions.edgeSetbackMeters + 1e-6);
      }
    }
  });

  it("joins the two planes of a gable roof at the ridge and outlines one building footprint", () => {
    const pitch = 30, rise = 2 * Math.tan(pitch * Math.PI / 180);
    const plane = (id: string, azimuthDegrees: number, south: number, north: number) => ({
      segmentId: id, areaSquareMeters: 40 / Math.cos(pitch * Math.PI / 180), groundAreaSquareMeters: 40,
      pitchDegrees: pitch, azimuthDegrees, planeHeightAtCenterMeters: 312,
      center: location(0, (south + north) / 2), bounds: { southwest: location(-5, south), northeast: location(5, north) },
    });
    const roof: NormalizedRoofV1 = { ...googleRoof([]), segmentCount: 2,
      segments: [plane("south", 180, -4, 0), plane("north", 0, 0, 4)] };
    const result = planRoofLayout(roof, assumptions);
    const ridgeHeights = result.segments.flatMap(segment => segment.corners.filter(corner => Math.abs(corner.z) < 1e-6).map(corner => corner.y));
    expect(ridgeHeights).toHaveLength(4);
    for (const height of ridgeHeights) expect(height).toBeCloseTo(rise, 6);
    expect(result.footprint).toHaveLength(4);
    const xs = result.footprint.map(point => point.x), zs = result.footprint.map(point => point.z);
    expect(Math.min(...xs)).toBeCloseTo(-5, 4); expect(Math.max(...xs)).toBeCloseTo(5, 4);
    expect(Math.min(...zs)).toBeCloseTo(-4, 4); expect(Math.max(...zs)).toBeCloseTo(4, 4);
    const outline = googleBuildingOutline(roof, assumptions);
    expect(outline).toHaveLength(4);
    expect(Math.min(...outline!.map(point => point.latitude)) * METRES_PER_DEGREE).toBeCloseTo(-4, 3);
    expect(Math.max(...outline!.map(point => point.longitude)) * METRES_PER_DEGREE).toBeCloseTo(5, 3);
    expect(googleBuildingOutline(manualRoof(), assumptions)).toBeNull();
  });

  it("keeps the east plane east and models all planes level when any plane height is missing", () => {
    const plane = (id: string, east: number, height?: number): RoofSegmentV1Like => ({
      segmentId: id, areaSquareMeters: 20, groundAreaSquareMeters: 20, pitchDegrees: 0, azimuthDegrees: 180,
      ...(height === undefined ? {} : { planeHeightAtCenterMeters: height }),
      center: location(east, 0), bounds: { southwest: location(east - 2.5, -2), northeast: location(east + 2.5, 2) },
    });
    const roof: NormalizedRoofV1 = { ...googleRoof([]), segmentCount: 2, segments: [plane("west", -3, 205), plane("east", 3, 208)] };
    const result = planRoofLayout(roof, assumptions);
    const byId = (id: string) => result.segments.find(segment => segment.segmentId === id) as RoofLayoutSegment;
    expect(byId("east").center.x).toBeGreaterThan(0);
    expect(byId("west").center.y).toBeCloseTo(0, 6);
    expect(byId("east").center.y).toBeCloseTo(3, 6);
    roof.segments[1] = plane("east", 3);
    const level = planRoofLayout(roof, assumptions);
    expect(level.segments.every(segment => segment.center.y === 0)).toBe(true);
  });

  it("ignores dropped near-vertical planes when choosing the height baseline", () => {
    const plane = (id: string, east: number, height: number, pitch = 0): RoofSegmentV1Like => ({
      segmentId: id, areaSquareMeters: 20, groundAreaSquareMeters: 20, pitchDegrees: pitch, azimuthDegrees: 180,
      planeHeightAtCenterMeters: height,
      center: location(east, 0), bounds: { southwest: location(east - 2.5, -2), northeast: location(east + 2.5, 2) },
    });
    const roof: NormalizedRoofV1 = { ...googleRoof([]), segmentCount: 2,
      segments: [plane("roof", 0, 210), plane("wall", 6, 200, 88)] };
    const result = planRoofLayout(roof, assumptions);
    expect(result.segments.map(segment => segment.segmentId)).toEqual(["roof"]);
    expect(result.segments[0]!.center.y).toBeCloseTo(0, 6);
  });

  it("computes a counter-clockwise convex hull without interior points", () => {
    const hull = convexHull([{ x: 0, z: 0 }, { x: 2, z: 0 }, { x: 1, z: 1 }, { x: 2, z: 2 }, { x: 0, z: 2 }, { x: 1, z: 0 }]);
    expect(hull).toEqual([{ x: 0, z: 0 }, { x: 2, z: 0 }, { x: 2, z: 2 }, { x: 0, z: 2 }]);
  });
  describe("regular grid fill for the 3D view", () => {
    const GRID: RoofLayoutOptions = { panelFill: "REGULAR_GRID" };

    it("fills a 10 m x 8 m south plane with a whole-panel grid inside the setbacks", () => {
      const roof = googleRoof([[0, 0]]);
      roof.segments[0].bounds = { southwest: location(-5, -4), northeast: location(5, 4) };
      roof.segments[0].groundAreaSquareMeters = 80; roof.segments[0].areaSquareMeters = 80; roof.roofAreaSquareMeters = 80;
      const result = planRoofLayout(roof, { ...assumptions, servicePathWidthMeters: 0 }, GRID);
      // Usable 9 × 7 m: portrait 1 × 2 m panels give 8 columns × 3 rows, landscape gives 4 × 6; both hold 24.
      expect(result.panelCount).toBe(24);
      expect(result.panels).toHaveLength(24);
      expect(result.dcCapacityKw).toBe(12);
      expect(result.warnings).toContain("PANELS_REGULAR_GRID");
      expect(new Set(result.panels.map(panel => panel.center.x.toFixed(3))).size).toBe(8);
      expect(new Set(result.panels.map(panel => panel.center.z.toFixed(3))).size).toBe(3);
      for (const panel of result.panels) {
        const edge = (i: number) => Math.hypot(panel.corners[(i + 1) % 4].x - panel.corners[i].x, panel.corners[(i + 1) % 4].z - panel.corners[i].z);
        expect(edge(0)).toBeCloseTo(1, 5); expect(edge(1)).toBeCloseTo(2, 5);
        for (const corner of panel.corners) {
          expect(Math.abs(corner.x)).toBeLessThanOrEqual(4.5 + 1e-6);
          expect(Math.abs(corner.z)).toBeLessThanOrEqual(3.5 + 1e-6);
        }
      }
    });

    it("splits the grid around the service path and reports exactly the panels it draws", () => {
      const result = planRoofLayout(googleRoof(), assumptions, GRID);
      // 10 × 10 m plane, 0.5 m setbacks, 1 m aisle: two 9 × 4 m bands hold 3 rows × 4 columns of 2 × 1 m panels.
      expect(result.panelCount).toBe(24);
      expect(result.panels).toHaveLength(result.panelCount as number);
      expect(result.panels.every(panel => panel.corners.every(corner => corner.z <= -0.5 + 1e-6 || corner.z >= 0.5 - 1e-6))).toBe(true);
    });

    it("keeps panels on a pitched plane one mounting offset above it, without overlap", () => {
      const roof = googleRoof([[0, 0]]);
      roof.segments[0].pitchDegrees = 40; roof.segments[0].groundAreaSquareMeters = 100;
      roof.segments[0].areaSquareMeters = 100 / Math.cos(40 * Math.PI / 180);
      const result = planRoofLayout(roof, assumptions, GRID);
      expect(result.panelCount).toBeGreaterThan(0);
      const segment = result.segments[0];
      for (const panel of result.panels) {
        expect(panel.corners.every(corner => Math.abs(corner.x) <= 4.5 + 1e-6 && Math.abs(corner.z) <= 4.5 + 1e-6)).toBe(true);
        for (const corner of panel.corners) {
          const t = (corner.z - segment.corners[0].z) / (segment.corners[3].z - segment.corners[0].z);
          expect(corner.y - (segment.corners[0].y + t * (segment.corners[3].y - segment.corners[0].y))).toBeCloseTo(0.1, 6);
        }
      }
      const boxes = result.panels.map(panel => ({ x0: Math.min(...panel.corners.map(c => c.x)), x1: Math.max(...panel.corners.map(c => c.x)),
        z0: Math.min(...panel.corners.map(c => c.z)), z1: Math.max(...panel.corners.map(c => c.z)) }));
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j];
        expect(a.x1 <= b.x0 + 1e-6 || b.x1 <= a.x0 + 1e-6 || a.z1 <= b.z0 + 1e-6 || b.z1 <= a.z0 + 1e-6).toBe(true);
      }
    });

    it("keeps a rotated plane's grid aligned to the plane and inside its setbacks", () => {
      const angle = 30 * Math.PI / 180;
      const width = 12 * Math.cos(angle) + 8 * Math.sin(angle), depth = 12 * Math.sin(angle) + 8 * Math.cos(angle);
      const along = { x: Math.cos(angle), z: -Math.sin(angle) }, across = { x: Math.sin(angle), z: Math.cos(angle) };
      const roof = googleRoof([[0, 0]]);
      Object.assign(roof.segments[0], { azimuthDegrees: 30, groundAreaSquareMeters: 96,
        bounds: { southwest: location(-width / 2, -depth / 2), northeast: location(width / 2, depth / 2) } });
      const result = planRoofLayout(roof, assumptions, GRID);
      expect(result.panelCount).toBe(20);
      expect(result.panels).toHaveLength(20);
      for (const panel of result.panels) {
        const edge = { x: panel.corners[1].x - panel.corners[0].x, z: panel.corners[1].z - panel.corners[0].z };
        const length = Math.hypot(edge.x, edge.z);
        const alongPlane = Math.abs(edge.x * along.x + edge.z * along.z) / length;
        const acrossPlane = Math.abs(edge.x * across.x + edge.z * across.z) / length;
        expect(Math.max(alongPlane, acrossPlane)).toBeCloseTo(1, 5);
        for (const corner of panel.corners) {
          expect(Math.abs(corner.x * along.x + corner.z * along.z)).toBeLessThanOrEqual(6 - assumptions.edgeSetbackMeters + 1e-6);
          expect(Math.abs(corner.x * across.x + corner.z * across.z)).toBeLessThanOrEqual(4 - assumptions.edgeSetbackMeters + 1e-6);
        }
      }
    });

    it("leaves a plane without any Google suggestion empty and puts suggested energy first", () => {
      const plane = (id: string, east: number) => ({
        segmentId: id, areaSquareMeters: 36, groundAreaSquareMeters: 36, pitchDegrees: 0, azimuthDegrees: 180,
        planeHeightAtCenterMeters: 9, center: location(east, 0), bounds: { southwest: location(east - 3, -3), northeast: location(east + 3, 3) },
      });
      const roof: NormalizedRoofV1 = { ...googleRoof([]), segmentCount: 2, segments: [plane("a", -5), plane("b", 5)],
        panelSuggestions: [
          { center: location(-5.5, -1.5), orientation: "PORTRAIT", segmentIndex: 0, yearlyEnergyDcKwh: 500 },
          { center: location(-4.2, -1.5), orientation: "PORTRAIT", segmentIndex: 0, yearlyEnergyDcKwh: 650 },
        ] };
      const result = planRoofLayout(roof, { ...assumptions, servicePathWidthMeters: 0 }, GRID);
      expect(result.panels.every(panel => panel.segmentId === "a")).toBe(true);
      expect(result.panels[0].yearlyEnergyDcKwh).toBe(650);
      expect(result.panels[1].yearlyEnergyDcKwh).toBe(500);
      expect(result.panels.slice(2).every(panel => panel.yearlyEnergyDcKwh === undefined)).toBe(true);
      expect(result.panelCount).toBe(result.panels.length);
    });

    it("never lets a hand-drawn outline change the sizing (provider-suggestion) path", () => {
      const roof = googleRoof([[0, 0]]);
      const outline = [location(-5, -5), location(0, -5), location(0, 5), location(-5, 5)];
      const base = planRoofLayout(roof, assumptions);
      const withOutline = planRoofLayout(roof, assumptions, { footprintOverride: outline });
      expect(withOutline.panelCount).toBe(base.panelCount);
      expect(withOutline.footprint).toEqual(base.footprint);
      expect(withOutline.warnings).not.toContain("PANELS_CLIPPED_TO_OUTLINE");
    });

    it("limits panels to a user outline and draws that outline as the footprint", () => {
      const roof = googleRoof([[0, 0]]);
      const flat = { ...assumptions, servicePathWidthMeters: 0 };
      const full = planRoofLayout(roof, flat, GRID);
      const outline = [location(-5, -5), location(0, -5), location(0, 5), location(-5, 5)];
      const clipped = planRoofLayout(roof, flat, { ...GRID, footprintOverride: outline });
      expect(clipped.panelCount).toBeLessThan(full.panelCount as number);
      expect(clipped.panelCount).toBeGreaterThan(0);
      expect(clipped.panelCount).toBe(clipped.panels.length);
      expect(clipped.warnings).toContain("PANELS_CLIPPED_TO_OUTLINE");
      expect(clipped.footprint).toHaveLength(4);
      expect(Math.max(...clipped.footprint.map(point => point.x))).toBeCloseTo(0, 3);
      for (const panel of clipped.panels) {
        for (const corner of panel.corners) {
          expect(corner.x).toBeLessThanOrEqual(-assumptions.edgeSetbackMeters + 1e-3);
          expect(corner.x).toBeGreaterThanOrEqual(-5 + assumptions.edgeSetbackMeters - 1e-3);
        }
      }
      // Sizing (no override, default provider fill) is unaffected when no outline is passed.
      expect(planRoofLayout(roof, flat).panelCount).toBe(1);
    });

    it("ignores a collapsed outline with a warning instead of removing every panel", () => {
      const roof = googleRoof([[0, 0]]);
      const collapsed = planRoofLayout(roof, assumptions, { ...GRID, footprintOverride: [location(0, 0), location(1, 0), location(2, 0)] });
      expect(collapsed.warnings).toContain("OUTLINE_OVERRIDE_UNUSABLE");
      expect(collapsed.panelCount).toBe(planRoofLayout(roof, assumptions, GRID).panelCount);
    });
  });

});

type RoofSegmentV1Like = NormalizedRoofV1["segments"][number];
