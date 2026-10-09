// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { UserProfile } from "@solarsaathi/types";
import { AnalyzeStart } from "../src/components/analyze-start";
import { ADDRESS_DRAFT_KEY } from "../src/lib/address-draft";

const identity = vi.hoisted(() => ({ status: "signedIn" as "signedIn" | "signedOut", profile: {
  userId: "owner-1", cognitoSub: "owner-1", email: "owner@example.com", name: "Owner", role: "HOMEOWNER",
} as UserProfile | null }));
const mapEnvironment = vi.hoisted(() => ({ key: undefined as string | undefined }));
const api = vi.hoisted(() => ({
  bootstrap: vi.fn(), createCustomer: vi.fn(), createProperty: vi.fn(), geocode: vi.fn(),
  insights: vi.fn(), confirmBuilding: vi.fn(), confirmRoof: vi.fn(), confirmManualRoof: vi.fn(),
}));
vi.mock("../src/auth/auth-provider", () => ({ useAuth: () => identity }));
vi.mock("../src/lib/roof-api", () => ({ roofApi: api, RoofRequestError: class extends Error {} }));
vi.mock("../src/lib/env", () => ({ getPublicEnvironment: () => ({ NEXT_PUBLIC_GOOGLE_MAPS_KEY: mapEnvironment.key }) }));
vi.mock("../src/components/satellite-building-map", () => ({ SatelliteBuildingMap: ({ center, deviceLocation, roofBounds, onPointChange }: {
  center: { latitude: number; longitude: number };
  deviceLocation?: { point: { latitude: number; longitude: number }; accuracyMeters: number };
  roofBounds?: object;
  onPointChange: (point: { latitude: number; longitude: number }) => void;
}) => <div data-testid="satellite-map" data-center={JSON.stringify(center)} data-device={JSON.stringify(deviceLocation)}
  data-overlay={Boolean(roofBounds)}><button onClick={() => onPointChange({ latitude: 19.07601, longitude: 72.87771 })}>Select house on map</button></div> }));

const roof = { schemaVersion: 1, source: "GOOGLE_SOLAR", measuredAt: "2026-10-08T10:00:00.000Z",
  roofAreaSquareMeters: 42, segmentCount: 1, segments: [{ segmentId: "roof-1", areaSquareMeters: 42 }],
  buildingId: "buildings/test", imageryDate: "2025-06-01", imageryQuality: "HIGH" };
const candidate = { placeId: "place-1", address: "Example Road, Mumbai 400001",
  location: { latitude: 19.076, longitude: 72.8777 }, locationType: "ROOFTOP", partialMatch: false };

beforeEach(() => {
  mapEnvironment.key = undefined;
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => null);
  sessionStorage.clear();
  sessionStorage.setItem(ADDRESS_DRAFT_KEY, JSON.stringify({ version: 1, address: candidate.address }));
  identity.status = "signedIn";
  identity.profile = { userId: "owner-1", cognitoSub: "owner-1", email: "owner@example.com", name: "Owner", role: "HOMEOWNER" };
  for (const mock of Object.values(api)) mock.mockReset();
  api.bootstrap.mockResolvedValue({ schemaVersion: 1, source: "DYNAMODB", requestId: "request-1" });
  api.createProperty.mockResolvedValue("property-1");
  api.geocode.mockResolvedValue({ schemaVersion: 1, source: "GOOGLE_GEOCODING", requestId: "request-2", candidates: [candidate] });
  api.insights.mockResolvedValue({ schemaVersion: 1, source: "GOOGLE_SOLAR", requestId: "request-3", previewId: "preview-1", roof });
  api.confirmBuilding.mockResolvedValue({ schemaVersion: 1, source: "GOOGLE_SOLAR", requestId: "request-4", previewId: "preview-1", roof });
  api.confirmRoof.mockResolvedValue({ schemaVersion: 1, source: "GOOGLE_SOLAR", requestId: "request-5", analysisId: "analysis-1", roof });
  api.confirmManualRoof.mockResolvedValue({ schemaVersion: 1, source: "MANUAL", requestId: "request-6", analysisId: "analysis-2",
    roof: { schemaVersion: 1, source: "MANUAL", measuredAt: "2026-10-08T10:00:00.000Z", roofAreaSquareMeters: 35,
      segmentCount: 1, segments: [{ segmentId: "manual-segment-0", areaSquareMeters: 35 }] } });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("roof analysis flow", () => {
  it("keeps signed-out addresses as drafts without calling the backend", async () => {
    identity.status = "signedOut"; identity.profile = null;
    render(<AnalyzeStart />);
    expect(await screen.findByText(candidate.address)).toBeTruthy();
    expect(screen.getByText(/Sign in to save a roof assessment/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Explore 3D demo" }).getAttribute("href")).toBe("/demo/roof-3d");
    expect(screen.getByRole("link", { name: "Try system designer demo" }).getAttribute("href")).toBe("/demo/system-designer");
    expect(screen.queryByRole("button", { name: "Find my building" })).toBeNull();
    expect(api.bootstrap).not.toHaveBeenCalled();
  });
  it("requires explicit building and roof confirmation before saving Google measurements", async () => {
    const user = userEvent.setup();
    render(<AnalyzeStart />);
    await screen.findByText(candidate.address);
    await user.click(screen.getByRole("button", { name: "Find my building" }));
    await screen.findByRole("button", { name: "Inspect roof at this point" });
    expect(api.createProperty).toHaveBeenCalledWith(candidate.address, undefined, expect.any(AbortSignal));
    expect(api.geocode).toHaveBeenCalledWith("property-1", expect.any(AbortSignal));
    expect(screen.getByText(/Satellite map is not configured/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Inspect roof at this point" }));
    await screen.findByText("Is this the correct building?");
    expect(screen.getByText(/Includes solar data from Google/)).toBeTruthy();
    expect(api.confirmRoof).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Yes, this is my building" }));
    await screen.findByText("Are these roof measurements right?");
    await user.click(screen.getByRole("button", { name: "Yes, save these measurements" }));
    await screen.findByText("Roof measurements saved");
    expect(api.confirmBuilding).toHaveBeenCalledWith("property-1", "preview-1", expect.any(AbortSignal));
    expect(api.confirmRoof).toHaveBeenCalledWith("property-1", "preview-1", expect.any(AbortSignal));
  });
  it("validates manual measurements and saves them without Google lookup", async () => {
    const user = userEvent.setup();
    render(<AnalyzeStart />);
    await screen.findByText(candidate.address);
    await user.click(screen.getByRole("button", { name: "Enter roof measurements manually" }));
    await user.click(screen.getByRole("button", { name: "Confirm and save my measurements" }));
    expect(screen.getByRole("alert").textContent).toContain("positive area");
    expect(api.confirmManualRoof).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText("Roof surface area (m²)"), "35");
    await user.click(screen.getByRole("button", { name: "Confirm and save my measurements" }));
    await waitFor(() => expect(api.confirmManualRoof).toHaveBeenCalledWith("property-1", { roofAreaSquareMeters: 35 }, expect.any(AbortSignal)));
    await screen.findByText("Roof measurements saved");
    expect(api.geocode).not.toHaveBeenCalled();
  });
  it("clears saved measurements when the account signs out", async () => {
    const user = userEvent.setup();
    const view = render(<AnalyzeStart />);
    await screen.findByText(candidate.address);
    await user.click(screen.getByRole("button", { name: "Enter roof measurements manually" }));
    await user.type(screen.getByLabelText("Roof surface area (m²)"), "35");
    await user.click(screen.getByRole("button", { name: "Confirm and save my measurements" }));
    await screen.findByText("Roof measurements saved");
    identity.status = "signedOut"; identity.profile = null;
    view.rerender(<AnalyzeStart />);
    expect(screen.queryByText("Roof measurements saved")).toBeNull();
    expect(screen.queryByText(/Assessment ID:/)).toBeNull();
    identity.status = "signedIn";
    identity.profile = { userId: "owner-2", cognitoSub: "owner-2", email: "other@example.com", name: "Other", role: "HOMEOWNER" };
    view.rerender(<AnalyzeStart />);
    expect(screen.queryByText("Roof measurements saved")).toBeNull();
    await user.click(await screen.findByRole("button", { name: "Find my building" }));
    await waitFor(() => expect(api.createProperty).toHaveBeenCalledTimes(2));
  });
  it("rejects inconsistent horizontal dimensions before submitting manual measurements", async () => {
    const user = userEvent.setup();
    render(<AnalyzeStart />);
    await screen.findByText(candidate.address);
    await user.click(screen.getByRole("button", { name: "Enter roof measurements manually" }));
    await user.type(screen.getByLabelText("Roof surface area (m²)"), "35");
    await user.type(screen.getByLabelText("Horizontal length (m, optional)"), "10");
    await user.type(screen.getByLabelText("Horizontal width (m, optional)"), "10");
    await user.click(screen.getByRole("button", { name: "Confirm and save my measurements" }));
    expect(screen.getByRole("alert").textContent).toContain("within 15%");
    expect(api.confirmManualRoof).not.toHaveBeenCalled();
  });
  it("reuses the created property when address lookup fails and manual entry is chosen", async () => {
    const user = userEvent.setup();
    api.geocode.mockRejectedValue(new Error("provider unavailable"));
    render(<AnalyzeStart />);
    await screen.findByText(candidate.address);
    await user.click(screen.getByRole("button", { name: "Find my building" }));
    await screen.findByRole("alert");
    await user.click(screen.getByRole("button", { name: "Enter roof measurements manually" }));
    await user.type(screen.getByLabelText("Roof surface area (m²)"), "35");
    await user.click(screen.getByRole("button", { name: "Confirm and save my measurements" }));
    await screen.findByText("Roof measurements saved");
    expect(api.createProperty).toHaveBeenCalledTimes(1);
    expect(api.confirmManualRoof).toHaveBeenCalledWith("property-1", { roofAreaSquareMeters: 35 }, expect.any(AbortSignal));
  });
  it("discards a roof preview when the selected building point changes", async () => {
    const user = userEvent.setup();
    render(<AnalyzeStart />);
    await screen.findByText(candidate.address);
    await user.click(screen.getByRole("button", { name: "Find my building" }));
    await screen.findByRole("button", { name: "Inspect roof at this point" });
    await user.click(screen.getByRole("button", { name: "Inspect roof at this point" }));
    await screen.findByText("Is this the correct building?");
    await user.clear(screen.getByLabelText("Latitude"));
    await user.type(screen.getByLabelText("Latitude"), "19.076001");
    await user.click(screen.getByRole("button", { name: "Use coordinates" }));
    expect(screen.queryByText("Is this the correct building?")).toBeNull();
    expect(api.confirmBuilding).not.toHaveBeenCalled();
  });
  it("requests device location only on click, recenters the map, and previews a selected house without saving it", async () => {
    mapEnvironment.key = "public-browser-map-key";
    const getCurrentPosition = vi.fn((success: PositionCallback, error?: PositionErrorCallback, options?: PositionOptions) => {
      void error; void options;
      success({ coords: { latitude: 19.07602, longitude: 72.87772, accuracy: 14 } } as GeolocationPosition);
    });
    const previous = Object.getOwnPropertyDescriptor(navigator, "geolocation");
    Object.defineProperty(navigator, "geolocation", { configurable: true, value: { getCurrentPosition } });
    try {
      const user = userEvent.setup();
      api.insights.mockResolvedValue({ schemaVersion: 1, source: "GOOGLE_SOLAR", requestId: "request-3",
        previewId: "preview-1", roof: { ...roof, center: { latitude: 19.07601, longitude: 72.87771 },
          bounds: { southwest: { latitude: 19.076, longitude: 72.8777 }, northeast: { latitude: 19.07603, longitude: 72.87773 } } } });
      render(<AnalyzeStart />);
      await screen.findByText(candidate.address);
      await user.click(screen.getByRole("button", { name: "Find my building" }));
      await screen.findByRole("button", { name: "Show my current location on the map" });
      expect(getCurrentPosition).not.toHaveBeenCalled();
      await user.click(screen.getByRole("button", { name: "Show my current location on the map" }));
      expect(getCurrentPosition).toHaveBeenCalledTimes(1);
      expect(getCurrentPosition.mock.calls[0]?.[2]).toEqual({ enableHighAccuracy: true, maximumAge: 0, timeout: 10_000 });
      expect(screen.getByRole("status").textContent).toContain("Device location shown in blue");
      expect(screen.getByTestId("satellite-map").getAttribute("data-center")).toBe(JSON.stringify({ latitude: 19.07602, longitude: 72.87772 }));
      expect(api.insights).not.toHaveBeenCalled();
      await user.click(screen.getByRole("button", { name: "Select house on map" }));
      await screen.findByText("Is this the correct building?");
      expect(api.insights).toHaveBeenCalledWith("property-1", candidate,
        { latitude: 19.07601, longitude: 72.87771 }, expect.any(AbortSignal));
      expect(screen.getByTestId("satellite-map").getAttribute("data-overlay")).toBe("true");
      expect(api.confirmBuilding).not.toHaveBeenCalled();
      expect(api.confirmRoof).not.toHaveBeenCalled();
    } finally {
      if (previous) Object.defineProperty(navigator, "geolocation", previous);
      else Reflect.deleteProperty(navigator, "geolocation");
    }
  });
  it("explains denied location permission and keeps manual selection available", async () => {
    mapEnvironment.key = "public-browser-map-key";
    const previous = Object.getOwnPropertyDescriptor(navigator, "geolocation");
    Object.defineProperty(navigator, "geolocation", { configurable: true, value: {
      getCurrentPosition: (_success: PositionCallback, error: PositionErrorCallback) => error({ code: 1 } as GeolocationPositionError),
    } });
    try {
      const user = userEvent.setup();
      render(<AnalyzeStart />);
      await screen.findByText(candidate.address);
      await user.click(screen.getByRole("button", { name: "Find my building" }));
      await user.click(await screen.findByRole("button", { name: "Show my current location on the map" }));
      expect(screen.getByRole("alert").textContent).toContain("Location permission was denied");
      expect(screen.getByRole("button", { name: "Select house on map" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Inspect roof at this point" })).toBeTruthy();
    } finally {
      if (previous) Object.defineProperty(navigator, "geolocation", previous);
      else Reflect.deleteProperty(navigator, "geolocation");
    }
  });
  it("ignores a device location result that arrives after sign-out", async () => {
    mapEnvironment.key = "public-browser-map-key";
    let resolveLocation: PositionCallback | undefined;
    const previous = Object.getOwnPropertyDescriptor(navigator, "geolocation");
    Object.defineProperty(navigator, "geolocation", { configurable: true, value: {
      getCurrentPosition: (success: PositionCallback) => { resolveLocation = success; },
    } });
    try {
      const user = userEvent.setup();
      const view = render(<AnalyzeStart />);
      await screen.findByText(candidate.address);
      await user.click(screen.getByRole("button", { name: "Find my building" }));
      await user.click(await screen.findByRole("button", { name: "Show my current location on the map" }));
      identity.status = "signedOut"; identity.profile = null;
      view.rerender(<AnalyzeStart />);
      resolveLocation?.({ coords: { latitude: 19.07602, longitude: 72.87772, accuracy: 12 } } as GeolocationPosition);
      expect(screen.queryByText(/Device location shown in blue/)).toBeNull();
      expect(screen.queryByTestId("satellite-map")).toBeNull();
    } finally {
      if (previous) Object.defineProperty(navigator, "geolocation", previous);
      else Reflect.deleteProperty(navigator, "geolocation");
    }
  });
});
