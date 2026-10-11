// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { NormalizedRoofV1 } from "@solarsaathi/types";
import { SatelliteBuildingMap } from "../src/components/satellite-building-map";

afterEach(() => { cleanup(); Reflect.deleteProperty(window, "google"); });

const roof: NormalizedRoofV1 = {
  schemaVersion: 1, source: "GOOGLE_SOLAR", measuredAt: "2026-10-08T10:00:00.000Z", roofAreaSquareMeters: 30,
  segmentCount: 1, imageryDate: "2025-06-14", imageryQuality: "MEDIUM",
  center: { latitude: 19.07601, longitude: 72.87771 },
  bounds: { southwest: { latitude: 19.076, longitude: 72.8777 }, northeast: { latitude: 19.07603, longitude: 72.87773 } },
  segments: [{ segmentId: "segment-0", areaSquareMeters: 30, groundAreaSquareMeters: 28, pitchDegrees: 0, azimuthDegrees: 180,
    center: { latitude: 19.076015, longitude: 72.877715 },
    bounds: { southwest: { latitude: 19.076, longitude: 72.8777 }, northeast: { latitude: 19.07603, longitude: 72.87773 } } }],
};

describe("satellite building map", () => {
  it("shows separate device and house markers, locks a top-down view and overlays an approximate outline", async () => {
    let click: ((event: { latLng?: { lat(): number; lng(): number } }) => void) | undefined;
    const setCenter = vi.fn();
    const circles: Record<string, unknown>[] = [];
    const polygons: Record<string, unknown>[] = [];
    const mapOptions: Record<string, unknown>[] = [];
    class MapStub {
      constructor(_element: HTMLElement, options: Record<string, unknown>) { mapOptions.push(options); }
      setCenter = setCenter;
      addListener(_name: string, callback: typeof click) { click = callback; return { remove: vi.fn() }; }
    }
    class CircleStub {
      constructor(options: Record<string, unknown>) { circles.push(options); }
      setCenter = vi.fn();
      setMap = vi.fn();
    }
    class PolygonStub {
      constructor(options: Record<string, unknown>) { polygons.push(options); }
      setMap = vi.fn();
    }
    Object.defineProperty(window, "google", { configurable: true, value: { maps: {
      Map: MapStub, Circle: CircleStub, Polygon: PolygonStub,
    } } });
    const selected = { latitude: 19.076, longitude: 72.8777 };
    const current = { latitude: 19.07602, longitude: 72.87772 };
    const onPointChange = vi.fn();
    const view = render(<SatelliteBuildingMap apiKey="public-map-key" center={selected} point={selected}
      onPointChange={onPointChange} />);
    await screen.findByText(/Amber: selected house/);
    expect(circles).toHaveLength(1);
    expect(mapOptions[0]).toMatchObject({ tilt: 0, heading: 0, rotateControl: false });
    click?.({ latLng: { lat: () => 19.07601, lng: () => 72.87771 } });
    expect(onPointChange).toHaveBeenCalledWith({ latitude: 19.07601, longitude: 72.87771 });

    view.rerender(<SatelliteBuildingMap apiKey="public-map-key" center={current} point={selected}
      deviceLocation={{ point: current, accuracyMeters: 14 }}
      roof={roof} onPointChange={onPointChange} />);
    await waitFor(() => expect(setCenter).toHaveBeenCalledWith({ lat: current.latitude, lng: current.longitude }));
    expect(circles.some(options => options.radius === 14 && options.fillColor === "#2563eb")).toBe(true);
    expect(polygons).toHaveLength(1);
    expect(polygons[0]?.fillOpacity).toBe(0.16);
    expect(polygons[0]?.paths).toHaveLength(4);
    expect(screen.getByText(/approximate building outline/)).toBeTruthy();
    expect(screen.getByText(/modeled from Google Solar roof planes \(imagery 2025-06-14, medium quality\)/)).toBeTruthy();
    expect(screen.queryByText(/from where you tapped/)).toBeNull();

    const far = { latitude: 19.0764, longitude: 72.8777 };
    view.rerender(<SatelliteBuildingMap apiKey="public-map-key" center={current} point={far} roof={roof}
      onPointChange={onPointChange} />);
    expect(screen.getByText(/about 4\d m from where you tapped/)).toBeTruthy();
  });
  it("offers a retry after the map script fails without losing coordinate selection", async () => {
    const selected = { latitude: 19.076, longitude: 72.8777 };
    render(<SatelliteBuildingMap apiKey="public-map-key" center={selected} point={selected} onPointChange={vi.fn()} />);
    const script = document.querySelector<HTMLScriptElement>('script[src^="https://maps.googleapis.com/maps/api/js"]');
    expect(script).toBeTruthy();
    fireEvent.error(script!);
    expect(await screen.findByRole("button", { name: "Retry satellite map" })).toBeTruthy();
    expect(screen.getByText(/enter coordinates below/)).toBeTruthy();

    Object.defineProperty(window, "google", { configurable: true, value: { maps: {
      Map: class { setCenter() {} addListener() { return { remove() {} }; } },
      Circle: class { setCenter() {} setMap() {} },
      Polygon: class { setMap() {} },
    } } });
    await userEvent.click(screen.getByRole("button", { name: "Retry satellite map" }));
    expect(await screen.findByText(/Amber: selected house/)).toBeTruthy();
  });
});
