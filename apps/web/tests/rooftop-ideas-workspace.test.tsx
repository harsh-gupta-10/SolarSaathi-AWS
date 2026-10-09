// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { UserProfile } from "@solarsaathi/types";
import { RooftopIdeasWorkspace, RooftopIdeasResult } from "../src/components/rooftop-ideas-workspace";
import type { DesignsResponse } from "../src/lib/designs-api";
import { RoofRequestError } from "../src/lib/roof-api";

const identity = vi.hoisted(() => ({ status: "signedIn" as "signedIn" | "signedOut", profile: {
  userId: "owner-1", cognitoSub: "owner-1", email: "owner@example.com", name: "Owner", role: "HOMEOWNER",
} as UserProfile | null }));
const api = vi.hoisted(() => ({ properties: vi.fn(), analyses: vi.fn(), recommend: vi.fn(), generate: vi.fn() }));
vi.mock("../src/auth/auth-provider", () => ({ useAuth: () => identity }));
vi.mock("../src/lib/applications-api", () => ({ applicationsApi: { properties: api.properties } }));
vi.mock("../src/lib/advisor-api", () => ({ advisorApi: { analyses: api.analyses } }));
vi.mock("../src/lib/designs-api", () => ({ designsApi: { recommend: api.recommend, generate: api.generate } }));
vi.mock("../src/components/remaining-roof-viewer", () => ({ RemainingRoofViewer: () => <div>Roof viewer fallback</div> }));

const corners = [{ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }, { x: 4, y: 0, z: 4 }, { x: 0, y: 0, z: 4 }] as
  DesignsResponse["geometry"]["segments"][number]["corners"];
const fingerprint = "c".repeat(64);
const response: DesignsResponse = { schemaVersion: 1, source: "DETERMINISTIC_REMAINING_SPACE_V1", requestId: "r1",
  propertyId: "property-1", analysisId: "analysis-1", system: { nominalKw: 3, actualDcKw: 3.2, panelCount: 3 },
  planning: { fitStatus: "SPACE_FEASIBLE", roofAreaSquareMeters: 80, modeledUsableProjectedAreaSquareMeters: 30,
    reservedSolarProjectedAreaSquareMeters: 24, remainingProjectedAreaSquareMeters: 6,
    assumptions: { edgeSetbackMeters: 0.5, servicePathWidthMeters: 0.8, solarBufferMeters: 0.75 } },
  geometry: { coordinateSystem: "LOCAL_EAST_UP_NORTH_METERS", segments: [{ segmentId: "segment-1", corners }], panels: [],
    freeZones: [{ zoneId: "zone-1", segmentId: "segment-1", corners, areaSquareMeters: 16 }], totalFreeZoneCount: 1 },
  candidates: [{ candidateId: "drying", category: "DRYING", title: "Drying corner", status: "SPACE_FEASIBLE",
    reason: "Modeled zone fits.", requiredAreaSquareMeters: 4, modeledAreaSquareMeters: 16,
    placement: { zoneId: "zone-1", corners, areaSquareMeters: 4 }, requiresStructuralReview: true,
    safetyNotes: ["Site review required."], fingerprint,
    template: { status: "DETERMINISTIC_FALLBACK" }, image: { status: "NOT_REQUESTED" } }],
  warnings: ["Concepts are alternatives."] };
const input = { propertyId: "property-1", analysisId: "analysis-1", nominalKw: 3,
  demand: { kind: "CONSUMPTION" as const, monthlyConsumptionKwh: 300 }, generationKwhPerKwYear: 1500 };

beforeEach(() => {
  identity.status = "signedIn";
  identity.profile = { userId: "owner-1", cognitoSub: "owner-1", email: "owner@example.com", name: "Owner", role: "HOMEOWNER" };
  for (const mock of Object.values(api)) mock.mockReset();
  api.properties.mockResolvedValue({ schemaVersion: 1, source: "DYNAMODB", requestId: "p1",
    properties: [{ propertyId: "property-1", label: "Home", address: "Example Road" }] });
  api.analyses.mockResolvedValue({ schemaVersion: 1, source: "DYNAMODB", requestId: "a1",
    analyses: [{ propertyId: "property-1", analysisId: "analysis-1", source: "MANUAL",
      measuredAt: "2026-10-09T08:00:00.000Z", roofAreaSquareMeters: 80, segmentCount: 1 }] });
  api.recommend.mockResolvedValue(response);
});
afterEach(cleanup);

describe("rooftop ideas workspace", () => {
  it("keeps owned roof records behind sign-in", () => {
    identity.status = "signedOut"; identity.profile = null;
    render(<RooftopIdeasWorkspace />);
    expect(screen.getByRole("heading", { name: "Sign in to explore the space after solar" })).toBeTruthy();
    expect(api.properties).not.toHaveBeenCalled();
  });
  it("requires explicit demand and system inputs before showing space-feasible concepts", async () => {
    const user = userEvent.setup();
    render(<RooftopIdeasWorkspace />);
    await screen.findByRole("combobox", { name: "Confirmed roof assessment" });
    await waitFor(() => expect((screen.getByRole("button", { name: /Explore remaining space/ }) as HTMLButtonElement).disabled).toBe(false));
    await user.click(screen.getByRole("button", { name: /Explore remaining space/ }));
    expect(screen.getByRole("alert").textContent).toContain("Enter valid electricity demand");
    expect(api.recommend).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText("Monthly electricity use (kWh)"), "300");
    await user.selectOptions(screen.getByLabelText("Planning solar system"), "3");
    await user.type(screen.getByLabelText("Annual generation assumption (kWh per kW)"), "1500");
    await user.click(screen.getByLabelText("Light garden"));
    await user.click(screen.getByRole("button", { name: /Explore remaining space/ }));
    await screen.findByText("Room beyond the solar layout");
    expect(api.recommend).toHaveBeenCalledWith({ ...input, preferences: { categories: ["GARDEN"] } }, expect.any(AbortSignal));
    expect(screen.getByText("6.0 m²")).toBeTruthy();
    expect(screen.getByText("Roof viewer fallback")).toBeTruthy();
    await user.type(screen.getByLabelText("Monthly electricity use (kWh)"), "0");
    expect(screen.queryByText("Room beyond the solar layout")).toBeNull();
  });
  it("directs area-only roofs back to measured dimensions", async () => {
    const user = userEvent.setup();
    api.recommend.mockRejectedValue(new RoofRequestError("ROOF_GEOMETRY_UNDETERMINED", "No geometry"));
    render(<RooftopIdeasWorkspace />);
    await screen.findByRole("combobox", { name: "Confirmed roof assessment" });
    await waitFor(() => expect((screen.getByRole("button", { name: /Explore remaining space/ }) as HTMLButtonElement).disabled).toBe(false));
    await user.type(screen.getByLabelText("Monthly electricity use (kWh)"), "300");
    await user.selectOptions(screen.getByLabelText("Planning solar system"), "3");
    await user.type(screen.getByLabelText("Annual generation assumption (kWh per kW)"), "1500");
    await user.click(screen.getByRole("button", { name: /Explore remaining space/ }));
    await screen.findByText(/This confirmed roof has only an area/);
    expect(screen.getByRole("link", { name: /Return to roof analysis/ }).getAttribute("href")).toBe("/app/analyze");
  });
  it("requests an image at most once for the selected roof concept", async () => {
    const user = userEvent.setup();
    const twoConcepts = { ...response, candidates: [response.candidates[0], { ...response.candidates[0],
      candidateId: "garden", category: "GARDEN" as const, title: "Garden corner" }] };
    api.generate.mockResolvedValue({ schemaVersion: 1, source: "ROOFTOP_DESIGN_CONCEPT_V1", requestId: "g1",
      propertyId: "property-1", analysisId: "analysis-1", candidate: response.candidates[0],
      concept: { template: { status: "DETERMINISTIC_FALLBACK", fingerprint },
        image: { status: "UNAVAILABLE", propertyScoped: false, visualAccuracy: "INSPIRATIONAL_ONLY", reason: "Model unavailable." } }, warnings: [] });
    render(<RooftopIdeasResult response={twoConcepts} input={input} />);
    await user.click(screen.getByRole("button", { name: "Request inspirational image" }));
    await screen.findByText("Model unavailable.");
    const button = screen.getByRole("button", { name: "Image request used for this roof concept" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    await user.click(screen.getByRole("button", { name: "Inspect this idea" }));
    await user.click(screen.getByRole("button", { name: "Inspect this idea" }));
    expect((screen.getByRole("button", { name: "Image request used for this roof concept" }) as HTMLButtonElement).disabled).toBe(true);
    expect(api.generate).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Reusable templates are generic/)).toBeTruthy();
  });
  it("keeps the synthetic preview visibly fictional and read only", () => {
    render(<RooftopIdeasResult response={response} demo />);
    expect(screen.getByText("Fictional geometry preview")).toBeTruthy();
    expect(screen.getByText("Drying corner · Fictional fixture")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Request inspirational image" })).toBeNull();
  });
  it("discloses when area totals include zones omitted from the bounded scene", () => {
    render(<RooftopIdeasResult response={{ ...response,
      geometry: { ...response.geometry, totalFreeZoneCount: 42 } }} demo />);
    expect(screen.getByText("Area includes all 42 modeled zones; the scene shows 1.")).toBeTruthy();
  });
});
