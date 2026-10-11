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
    expect(screen.getByText("Automatic outline (approximate)")).toBeTruthy();
    expect(screen.getByText(/imagery 2025-06-14, medium quality/)).toBeTruthy();
    expect(screen.getByText(/system sizing still uses Google's modeled roof or your measurements/)).toBeTruthy();
    expect(screen.queryByText(/from where you tapped/)).toBeNull();

    const far = { latitude: 19.0764, longitude: 72.8777 };
    view.rerender(<SatelliteBuildingMap apiKey="public-map-key" center={current} point={far} roof={roof}
      onPointChange={onPointChange} />);
    expect(screen.getByText(/about 4\d m from where you tapped/)).toBeTruthy();
  });

  it("starts from Google's building box and lets the user drag, nudge and reset the outline", async () => {
    const polygons: { paths: unknown[]; setPath: ReturnType<typeof vi.fn> }[] = [];
    const markers: { options: Record<string, unknown>; listeners: Record<string, (event: { latLng?: { lat(): number; lng(): number } }) => void>; setPosition: ReturnType<typeof vi.fn> }[] = [];
    class PolygonStub {
      setMap = vi.fn(); setPath = vi.fn();
      constructor(options: { paths: unknown[] }) { polygons.push(Object.assign(this, { paths: options.paths })); }
    }
    class MarkerStub {
      listeners: Record<string, (event: { latLng?: { lat(): number; lng(): number } }) => void> = {};
      setPosition = vi.fn(); setMap = vi.fn();
      options: Record<string, unknown>;
      constructor(options: Record<string, unknown>) { this.options = options; markers.push(this); }
      addListener(name: string, callback: (event: { latLng?: { lat(): number; lng(): number } }) => void) { this.listeners[name] = callback; return { remove: vi.fn() }; }
    }
    Object.defineProperty(window, "google", { configurable: true, value: { maps: {
      Map: class { setCenter() {} addListener() { return { remove() {} }; } },
      Circle: class { setCenter() {} setMap() {} }, Polygon: PolygonStub, Marker: MarkerStub,
    } } });
    const selected = { latitude: 19.076, longitude: 72.8777 };
    const onOutlineChange = vi.fn();
    const view = render(<SatelliteBuildingMap apiKey="public-map-key" center={selected} point={selected} roof={roof}
      onOutlineChange={onOutlineChange} onPointChange={vi.fn()} />);
    await waitFor(() => expect(markers).toHaveLength(4));
    expect(markers.map(marker => marker.options.draggable)).toEqual([true, true, true, true]);
    expect(polygons.at(-1)?.paths).toHaveLength(4);
    expect(screen.getByText("Automatic outline (approximate)")).toBeTruthy();
    expect(screen.getByText(/about \d+ m² on the ground/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Reset to automatic outline" }) as HTMLButtonElement).disabled).toBe(true);

    // Dragging corner 3 inward commits an adjusted outline.
    markers[2].listeners.dragend({ latLng: { lat: () => 19.076025, lng: () => 72.877725 } });
    expect(onOutlineChange).toHaveBeenCalledTimes(1);
    const adjusted = onOutlineChange.mock.calls[0][0] as { latitude: number; longitude: number }[];
    expect(adjusted[2]).toEqual({ latitude: 19.076025, longitude: 72.877725 });
    expect(adjusted[0]).toEqual({ latitude: 19.076, longitude: 72.8777 });
    // A move that flattens the outline is refused and the handle snaps back.
    markers[2].listeners.dragend({ latLng: { lat: () => 19.076, lng: () => 72.8777 } });
    expect(onOutlineChange).toHaveBeenCalledTimes(2);

    view.rerender(<SatelliteBuildingMap apiKey="public-map-key" center={selected} point={selected} roof={roof}
      outline={adjusted as never} onOutlineChange={onOutlineChange} onPointChange={vi.fn()} />);
    expect(screen.getByText("Outline adjusted by you")).toBeTruthy();
    // Keyboard nudge for corner 2, then reset.
    await userEvent.selectOptions(screen.getByLabelText("Corner to move"), "1");
    await userEvent.click(screen.getByRole("button", { name: "North 1 m" }));
    const nudged = onOutlineChange.mock.calls.at(-1)?.[0] as { latitude: number }[];
    expect(nudged[1].latitude).toBeGreaterThan(adjusted[1].latitude);
    expect(screen.getByRole("status", { hidden: true }).textContent).toMatch(/Corner 2 moved/);
    await userEvent.click(screen.getByRole("button", { name: "Reset to automatic outline" }));
    expect(onOutlineChange).toHaveBeenLastCalledWith(undefined);
  });

  it("shows no editing controls without an outline change handler", async () => {
    Object.defineProperty(window, "google", { configurable: true, value: { maps: {
      Map: class { setCenter() {} addListener() { return { remove() {} }; } },
      Circle: class { setCenter() {} setMap() {} }, Polygon: class { setMap() {} },
    } } });
    const selected = { latitude: 19.076, longitude: 72.8777 };
    render(<SatelliteBuildingMap apiKey="public-map-key" center={selected} point={selected} roof={roof} onPointChange={vi.fn()} />);
    await screen.findByText("Automatic outline (approximate)");
    expect(screen.queryByLabelText("Corner to move")).toBeNull();
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
