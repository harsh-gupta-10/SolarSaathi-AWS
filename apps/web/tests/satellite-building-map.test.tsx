// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { SatelliteBuildingMap } from "../src/components/satellite-building-map";

afterEach(() => { cleanup(); Reflect.deleteProperty(window, "google"); });

describe("satellite building map", () => {
  it("shows separate device and house markers, updates the center, and overlays approximate returned bounds", async () => {
    let click: ((event: { latLng?: { lat(): number; lng(): number } }) => void) | undefined;
    const setCenter = vi.fn();
    const circles: Record<string, unknown>[] = [];
    const rectangles: Record<string, unknown>[] = [];
    class MapStub {
      setCenter = setCenter;
      addListener(_name: string, callback: typeof click) { click = callback; return { remove: vi.fn() }; }
    }
    class CircleStub {
      constructor(options: Record<string, unknown>) { circles.push(options); }
      setCenter = vi.fn();
      setMap = vi.fn();
    }
    class RectangleStub {
      constructor(options: Record<string, unknown>) { rectangles.push(options); }
      setMap = vi.fn();
    }
    Object.defineProperty(window, "google", { configurable: true, value: { maps: {
      Map: MapStub, Circle: CircleStub, Rectangle: RectangleStub,
    } } });
    const selected = { latitude: 19.076, longitude: 72.8777 };
    const current = { latitude: 19.07602, longitude: 72.87772 };
    const onPointChange = vi.fn();
    const view = render(<SatelliteBuildingMap apiKey="public-map-key" center={selected} point={selected}
      onPointChange={onPointChange} />);
    await screen.findByText(/Amber: selected house/);
    expect(circles).toHaveLength(1);
    click?.({ latLng: { lat: () => 19.07601, lng: () => 72.87771 } });
    expect(onPointChange).toHaveBeenCalledWith({ latitude: 19.07601, longitude: 72.87771 });

    view.rerender(<SatelliteBuildingMap apiKey="public-map-key" center={current} point={selected}
      deviceLocation={{ point: current, accuracyMeters: 14 }}
      roofCenter={{ latitude: 19.07601, longitude: 72.87771 }}
      roofBounds={{ southwest: { latitude: 19.076, longitude: 72.8777 },
        northeast: { latitude: 19.07603, longitude: 72.87773 } }} onPointChange={onPointChange} />);
    await waitFor(() => expect(setCenter).toHaveBeenCalledWith({ lat: current.latitude, lng: current.longitude }));
    expect(circles.some(options => options.radius === 14 && options.fillColor === "#2563eb")).toBe(true);
    expect(rectangles).toHaveLength(1);
    expect(rectangles[0]?.fillOpacity).toBe(0.16);
    expect(screen.getByText(/approximate Google building bounds/)).toBeTruthy();
  });
});
