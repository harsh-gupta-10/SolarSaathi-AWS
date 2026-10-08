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
const api = vi.hoisted(() => ({
  bootstrap: vi.fn(), createCustomer: vi.fn(), createProperty: vi.fn(), geocode: vi.fn(),
  insights: vi.fn(), confirmBuilding: vi.fn(), confirmRoof: vi.fn(), confirmManualRoof: vi.fn(),
}));
vi.mock("../src/auth/auth-provider", () => ({ useAuth: () => identity }));
vi.mock("../src/lib/roof-api", () => ({ roofApi: api, RoofRequestError: class extends Error {} }));
vi.mock("../src/lib/env", () => ({ getPublicEnvironment: () => ({ NEXT_PUBLIC_GOOGLE_MAPS_KEY: undefined }) }));
vi.mock("../src/components/satellite-building-map", () => ({ SatelliteBuildingMap: () => <div>Satellite map</div> }));

const roof = { schemaVersion: 1, source: "GOOGLE_SOLAR", measuredAt: "2026-10-08T10:00:00.000Z",
  roofAreaSquareMeters: 42, segmentCount: 1, segments: [{ segmentId: "roof-1", areaSquareMeters: 42 }],
  buildingId: "buildings/test", imageryDate: "2025-06-01", imageryQuality: "HIGH" };
const candidate = { placeId: "place-1", address: "Example Road, Mumbai 400001",
  location: { latitude: 19.076, longitude: 72.8777 }, locationType: "ROOFTOP", partialMatch: false };

beforeEach(() => {
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
});
