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
});
