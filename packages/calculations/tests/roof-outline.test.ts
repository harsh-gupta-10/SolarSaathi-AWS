import type { NormalizedRoofV1, RoofPoint } from "@solarsaathi/types";
import { describe, expect, it } from "vitest";
import {
  autoBuildingOutline, decodeRoofOutline, encodeRoofOutline, moveOutlineCorner, nudgeOutlineCorner, outlineAreaSquareMeters,
  outlineHull, type RoofOutline,
} from "../src";

const METRES_PER_DEGREE = 6_371_000 * Math.PI / 180;
const at = (east: number, north: number): RoofPoint => ({ latitude: 19 + north / METRES_PER_DEGREE,
  longitude: 72.8 + east / (METRES_PER_DEGREE * Math.cos(19 * Math.PI / 180)) });
const outline = (): RoofOutline => [at(-6, -5), at(6, -5), at(6, 5), at(-6, 5)];
const roof = (bounds = { southwest: at(-6, -5), northeast: at(6, 5) }): NormalizedRoofV1 => ({
  schemaVersion: 1, source: "GOOGLE_SOLAR", measuredAt: "2026-10-08T10:00:00.000Z", roofAreaSquareMeters: 100, segmentCount: 1,
  segments: [{ segmentId: "s", areaSquareMeters: 100, bounds }], bounds });

describe("roof outline helpers", () => {
  it("starts from Google's building bounding box, south-west first and counter-clockwise", () => {
    const auto = autoBuildingOutline(roof())!;
    expect(auto).toHaveLength(4);
    expect(auto[0].latitude).toBeLessThan(auto[3].latitude);
    expect(auto[0].longitude).toBeLessThan(auto[1].longitude);
    expect(outlineAreaSquareMeters(auto)).toBeCloseTo(120, 0);
    const withoutBuildingBox = roof(); delete withoutBuildingBox.bounds;
    expect(autoBuildingOutline(withoutBuildingBox)).toHaveLength(4);
    expect(autoBuildingOutline({ ...withoutBuildingBox, segments: [{ segmentId: "s", areaSquareMeters: 1 }] })).toBeUndefined();
  });

  it("round-trips through a compact draft value and rejects malformed text", () => {
    const text = encodeRoofOutline(outline());
    expect(text.length).toBeLessThanOrEqual(110);
    expect(text.split(";")).toHaveLength(4);
    const decoded = decodeRoofOutline(text)!;
    decoded.forEach((point, index) => {
      expect(point.latitude).toBeCloseTo(outline()[index].latitude, 6);
      expect(point.longitude).toBeCloseTo(outline()[index].longitude, 6);
    });
    for (const bad of [undefined, "", "1,2;3,4;5,6", "a,b;c,d;e,f;g,h", "95,10;95,11;96,11;96,10", "19,72;19,72;19,72;19,72",
      `${text};19,72`, "x".repeat(300)]) expect(decodeRoofOutline(bad)).toBeUndefined();
  });

  it("moves a dragged corner and keeps the others in place", () => {
    const start = outline();
    const target = at(4, 8);
    const moved = moveOutlineCorner(start, 2, target);
    expect(moved[2].latitude).toBeCloseTo(target.latitude, 6);
    expect(moved[2].longitude).toBeCloseTo(target.longitude, 6);
    expect([0, 1, 3].every(index => moved[index] === start[index])).toBe(true);
    expect(start[2]).toEqual(at(6, 5));
    expect(outlineAreaSquareMeters(moved)).not.toBeCloseTo(outlineAreaSquareMeters(start), 0);
  });

  it("refuses moves that collapse the outline, fly away or use invalid input", () => {
    const start = outline();
    const thin: RoofOutline = [at(-6, -5), at(6, -5), at(6, -4.6), at(-6, -4.6)];
    expect(moveOutlineCorner(thin, 2, at(6, -5))).toBe(thin); // would flatten the outline onto a line
    expect(moveOutlineCorner(start, 1, at(1_000, 0))).toBe(start);
    // The limit is measured from a fixed anchor, so repeated drags cannot walk the outline away.
    const anchor = at(0, 0);
    expect(moveOutlineCorner(start, 1, at(150, 0), anchor)).not.toBe(start);
    expect(moveOutlineCorner(start, 1, at(250, 0), anchor)).toBe(start);
    expect(moveOutlineCorner(start, 9, at(0, 0))).toBe(start);
    expect(moveOutlineCorner(start, 0, { latitude: Number.NaN, longitude: 1 })).toBe(start);
  });

  it("nudges a corner by metres east and north for keyboard users", () => {
    const start = outline();
    const moved = nudgeOutlineCorner(start, 1, -2, 1);
    expect((moved[1].longitude - start[1].longitude) * METRES_PER_DEGREE * Math.cos(19 * Math.PI / 180)).toBeCloseTo(-2, 1);
    expect((moved[1].latitude - start[1].latitude) * METRES_PER_DEGREE).toBeCloseTo(1, 1);
    expect(nudgeOutlineCorner(start, 1, Number.NaN, 0)).toBe(start);
    // five one-metre nudges stay valid and accumulate
    let current = start;
    for (let step = 0; step < 5; step++) current = nudgeOutlineCorner(current, 0, 1, 0);
    expect((current[0].longitude - start[0].longitude) * METRES_PER_DEGREE * Math.cos(19 * Math.PI / 180)).toBeCloseTo(5, 3);
  });

  it("reports the area of the convex hull so a crossed quad is still valid", () => {
    const crossed: RoofOutline = [at(0, 0), at(10, 10), at(10, 0), at(0, 10)];
    expect(outlineHull(crossed)).toHaveLength(4);
    expect(outlineAreaSquareMeters(crossed)).toBeCloseTo(100, 0);
  });
});
