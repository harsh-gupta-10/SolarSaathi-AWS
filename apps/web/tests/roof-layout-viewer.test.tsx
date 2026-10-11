// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { NormalizedRoofV1 } from "@solarsaathi/types";
import Roof3dDemoPage from "../src/app/demo/roof-3d/page";
import { getRoofLayoutAssumptionsV1, planRoofLayout } from "@solarsaathi/calculations";
import { RoofLayoutViewer } from "../src/components/roof-layout-viewer";
import { planeOf, toSceneFrame } from "../src/components/roof-layout-scene";

const manualRoof: NormalizedRoofV1 = {
  schemaVersion: 1, source: "MANUAL", measuredAt: "2026-01-01T00:00:00.000Z",
  roofAreaSquareMeters: 100, segmentCount: 1,
  segments: [{ segmentId: "test-roof", areaSquareMeters: 100, pitchDegrees: 8, azimuthDegrees: 180 }],
  manualDimensions: { lengthMeters: 10, widthMeters: 10 },
};

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("deterministic roof viewer", () => {
  it("shows a keyboard-accessible plan and planning limits when WebGL is unavailable", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => null);
    render(<RoofLayoutViewer roof={manualRoof} analysisId="test-analysis" />);
    expect(screen.getByRole("img", { name: /Schematic top-down roof plan/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "3D view" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Plan view" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText(/3D is unavailable on this device/)).toBeTruthy();
    expect(screen.getByText(/site survey and installer review are required/)).toBeTruthy();
    expect(screen.getByText(/Space-feasible plan/)).toBeTruthy();
  });

  it("does not invent a panel count for an area-only manual roof", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => null);
    render(<RoofLayoutViewer roof={{ ...manualRoof, manualDimensions: undefined }} analysisId="area-only" />);
    expect(screen.getAllByText("Undetermined")).toHaveLength(2);
    expect(screen.getByText(/Roof shape is symbolic/)).toBeTruthy();
    expect(screen.getByText(/Area alone cannot determine roof shape or panel fit/)).toBeTruthy();
  });

  it("labels the public 3D route as a synthetic, offline fixture", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => null);
    render(<Roof3dDemoPage />);
    expect(screen.getByText(/Demo fixture/)).toBeTruthy();
    expect(screen.getByText(/No live API data is used/)).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Explore your roof in 3D" })).toBeTruthy();
  });

  it("shows the planner's own fit with the building outline, without a panel re-arrangement toggle", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => null);
    const { container } = render(<RoofLayoutViewer roof={manualRoof} analysisId="outline" />);
    expect(screen.queryByRole("button", { name: /Professional Array|Raw Suggestions/ })).toBeNull();
    expect(container.querySelector("polygon[stroke-dasharray]")).toBeTruthy();
  });

  it("mirrors north to −z for three.js so east stays east and the plan is not shown reversed", () => {
    const layout = planRoofLayout(manualRoof, getRoofLayoutAssumptionsV1(manualRoof));
    const scene = toSceneFrame(layout);
    const northWest = layout.segments[0].corners[3], sceneNorthWest = scene.segments[0].corners[3];
    expect(northWest.z).toBeGreaterThan(0);
    expect(sceneNorthWest).toEqual({ ...northWest, z: -northWest.z });
    expect(scene.bounds?.min.z).toBeCloseTo(-(layout.bounds?.max.z ?? 0), 9);
    expect(scene.footprint.every((point, index) => point.x === layout.footprint[index].x && point.z === -layout.footprint[index].z)).toBe(true);
    const plane = planeOf(scene.segments[0].corners);
    for (const corner of scene.segments[0].corners) {
      expect(plane.contains(corner.x, corner.z)).toBe(true);
      expect(plane.heightAt(corner.x, corner.z)).toBeCloseTo(corner.y, 9);
    }
    expect(plane.contains(100, 100)).toBe(false);
    for (const panel of scene.panels) {
      for (const corner of panel.corners) expect(corner.y - plane.heightAt(corner.x, corner.z)).toBeCloseTo(0.1, 6);
    }
  });

  it("fills a Google plane with whole panels, shows a count equal to the panels drawn, and honours a traced outline", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => null);
    const metres = 6_371_000 * Math.PI / 180;
    const at = (east: number, north: number) => ({ latitude: 19 + north / metres, longitude: 72.8 + east / (metres * Math.cos(19 * Math.PI / 180)) });
    const googleRoof: NormalizedRoofV1 = {
      schemaVersion: 1, source: "GOOGLE_SOLAR", measuredAt: "2026-01-01T00:00:00.000Z", roofAreaSquareMeters: 80, groundAreaSquareMeters: 80,
      segmentCount: 1, center: at(0, 0), panelWidthMeters: 1.045, panelHeightMeters: 1.879, panelCapacityWatts: 400,
      segments: [{ segmentId: "g0", areaSquareMeters: 80, groundAreaSquareMeters: 80, pitchDegrees: 0, azimuthDegrees: 180,
        planeHeightAtCenterMeters: 20, center: at(0, 0), bounds: { southwest: at(-5, -4), northeast: at(5, 4) } }],
      panelSuggestions: [{ center: at(0, 0), orientation: "PORTRAIT", segmentIndex: 0, yearlyEnergyDcKwh: 600 }],
    };
    const assumptions = getRoofLayoutAssumptionsV1(googleRoof);
    const grid = planRoofLayout(googleRoof, assumptions, { panelFill: "REGULAR_GRID" });
    const sized = planRoofLayout(googleRoof, assumptions);
    expect(grid.panelCount).toBeGreaterThan(sized.panelCount as number);
    const { container, rerender } = render(<RoofLayoutViewer roof={googleRoof} analysisId="g" />);
    expect(container.querySelectorAll("svg.roof-plan-svg polygon[fill='#17475b']")).toHaveLength(grid.panelCount as number);
    expect(screen.getByText(String(grid.panelCount))).toBeTruthy();
    const outline = [at(-5, -4), at(0, -4), at(0, 4), at(-5, 4)];
    rerender(<RoofLayoutViewer roof={googleRoof} analysisId="g" footprintOverride={outline} />);
    const clipped = container.querySelectorAll("svg.roof-plan-svg polygon[fill='#17475b']").length;
    expect(clipped).toBeGreaterThan(0);
    expect(clipped).toBeLessThan(grid.panelCount as number);
    expect(screen.getByText(/Your traced outline sets the walls and where panels may sit in this view only/)).toBeTruthy();
  });
});
