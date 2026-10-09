// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { UserProfile } from "@solarsaathi/types";
import { AccessoriesWorkspace, AccessoriesResult } from "../src/components/accessories-workspace";
import type { AccessoriesResponse } from "../src/lib/accessories-api";

const identity = vi.hoisted(() => ({ status: "signedIn" as "signedIn" | "signedOut", profile: {
  userId: "owner-1", cognitoSub: "owner-1", email: "owner@example.com", name: "Owner", role: "HOMEOWNER",
} as UserProfile | null }));
const api = vi.hoisted(() => ({ properties: vi.fn(), analyses: vi.fn(), recommend: vi.fn() }));
vi.mock("../src/auth/auth-provider", () => ({ useAuth: () => identity }));
vi.mock("../src/lib/applications-api", () => ({ applicationsApi: { properties: api.properties } }));
vi.mock("../src/lib/advisor-api", () => ({ advisorApi: { analyses: api.analyses } }));
vi.mock("../src/lib/accessories-api", () => ({ accessoriesApi: { recommend: api.recommend } }));

const response: AccessoriesResponse = { schemaVersion: 1, source: "DETERMINISTIC_ACCESSORY_ADVISOR_V1", requestId: "r1",
  propertyId: "property-1", analysisId: "analysis-1", system: { nominalKw: 3, actualDcKw: 3.2,
    minimumInverterAcKw: 2.5, roofSource: "MANUAL", generationBasis: "ASSUMED_YIELD" },
  recommendations: [
    { id: "monitor", title: "Production monitoring", category: "MONITORING", classification: "RECOMMENDED",
      score: 82, reason: "It matches a stated goal.", compatibility: "REQUIRES_REVIEW", safetyNotes: ["Check the inverter."],
      policyRelevance: { status: "NOT_EVALUATED", note: "No rule evaluated." },
      costRange: { status: "UNAVAILABLE", currency: "INR", note: "No sourced price." } },
    { id: "battery", title: "Battery storage", category: "BACKUP", classification: "NOT_RECOMMENDED",
      score: 0, reason: "No backup goal stated.", compatibility: "NOT_RECOMMENDED", safetyNotes: ["Requires installer design."],
      policyRelevance: { status: "NOT_EVALUATED", note: "No rule evaluated." },
      costRange: { status: "UNAVAILABLE", currency: "INR", note: "No sourced price." } },
  ], warnings: ["Site review needed."],
  financialIntegration: { includedInBaseEstimate: false, benefitEligibilityEvaluated: false } };

beforeEach(() => {
  identity.status = "signedIn";
  identity.profile = { userId: "owner-1", cognitoSub: "owner-1", email: "owner@example.com", name: "Owner", role: "HOMEOWNER" };
  for (const mock of Object.values(api)) mock.mockReset();
  api.properties.mockResolvedValue({ schemaVersion: 1, source: "DYNAMODB", requestId: "p1",
    properties: [{ propertyId: "property-1", label: "Home", address: "Example Road" }] });
  api.analyses.mockResolvedValue({ schemaVersion: 1, source: "DYNAMODB", requestId: "a1",
    analyses: [{ propertyId: "property-1", analysisId: "analysis-1", source: "MANUAL",
      measuredAt: "2026-10-09T08:00:00.000Z", roofAreaSquareMeters: 42, segmentCount: 1 }] });
  api.recommend.mockResolvedValue(response);
});
afterEach(cleanup);

describe("accessory workspace", () => {
  it("does not load records when signed out", () => {
    identity.status = "signedOut"; identity.profile = null;
    render(<AccessoriesWorkspace />);
    expect(screen.getByRole("heading", { name: "Sign in to review equipment for your roof" })).toBeTruthy();
    expect(api.properties).not.toHaveBeenCalled();
  });
  it("requires explicit system inputs, sends user goals, and renders server advice", async () => {
    const user = userEvent.setup();
    render(<AccessoriesWorkspace />);
    await screen.findByRole("combobox", { name: "Confirmed roof assessment" });
    await waitFor(() => expect((screen.getByRole("button", { name: /Review accessories/ }) as HTMLButtonElement).disabled).toBe(false));
    await user.click(screen.getByRole("button", { name: /Review accessories/ }));
    expect(screen.getByRole("alert").textContent).toContain("Enter a planning system size");
    expect(api.recommend).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText("Monthly electricity use (kWh)"), "300");
    await user.selectOptions(screen.getByLabelText("Planning system size"), "3");
    await user.type(screen.getByLabelText("Annual generation assumption (kWh per kW)"), "1500");
    await user.click(screen.getByLabelText("Seeing production and use"));
    await user.click(screen.getByRole("button", { name: /Review accessories/ }));
    await screen.findByText("Production monitoring");
    expect(api.recommend).toHaveBeenCalledWith(expect.objectContaining({ propertyId: "property-1",
      analysisId: "analysis-1", nominalKw: 3, demand: { kind: "CONSUMPTION", monthlyConsumptionKwh: 300 },
      generationKwhPerKwYear: 1500, goals: expect.objectContaining({ monitoring: true }) }), expect.any(AbortSignal));
    expect(screen.getByText("No sourced price.")).toBeTruthy();
    expect(screen.queryByText("Battery storage")).toBeNull();
    await user.click(screen.getByRole("button", { name: /Show full review/ }));
    expect(screen.getByText("Battery storage")).toBeTruthy();
    await user.type(screen.getByLabelText("Monthly electricity use (kWh)"), "0");
    expect(screen.queryByText("Production monitoring")).toBeNull();
  });
  it("hides a pending answer immediately when the account signs out", async () => {
    const user = userEvent.setup();
    let resolveResult: ((value: AccessoriesResponse) => void) | undefined;
    api.recommend.mockImplementation(() => new Promise<AccessoriesResponse>(resolve => { resolveResult = resolve; }));
    const view = render(<AccessoriesWorkspace />);
    await screen.findByRole("combobox", { name: "Confirmed roof assessment" });
    await waitFor(() => expect((screen.getByRole("button", { name: /Review accessories/ }) as HTMLButtonElement).disabled).toBe(false));
    await user.type(screen.getByLabelText("Monthly electricity use (kWh)"), "300");
    await user.selectOptions(screen.getByLabelText("Planning system size"), "3");
    await user.type(screen.getByLabelText("Annual generation assumption (kWh per kW)"), "1500");
    await user.click(screen.getByRole("button", { name: /Review accessories/ }));
    identity.status = "signedOut"; identity.profile = null; view.rerender(<AccessoriesWorkspace />);
    expect(screen.getByRole("heading", { name: "Sign in to review equipment for your roof" })).toBeTruthy();
    resolveResult?.(response);
    expect(screen.queryByText("Production monitoring")).toBeNull();
  });
  it("does not request the same property or assessment page twice while loading", async () => {
    const user = userEvent.setup();
    const nextProperties = { schemaVersion: 1, source: "DYNAMODB", requestId: "p2",
      properties: [{ propertyId: "property-2", label: "Second home", address: "Example Lane" }] };
    const nextAnalyses = { schemaVersion: 1, source: "DYNAMODB", requestId: "a2",
      analyses: [{ propertyId: "property-1", analysisId: "analysis-2", source: "MANUAL",
        measuredAt: "2026-10-09T09:00:00.000Z", roofAreaSquareMeters: 48, segmentCount: 1 }] };
    let resolveProperties!: (page: typeof nextProperties) => void;
    let resolveAnalyses!: (page: typeof nextAnalyses) => void;
    const propertyPage = new Promise<typeof nextProperties>(resolve => { resolveProperties = resolve; });
    const analysisPage = new Promise<typeof nextAnalyses>(resolve => { resolveAnalyses = resolve; });
    api.properties.mockImplementation((cursor?: string) => cursor ? propertyPage : Promise.resolve({
      schemaVersion: 1, source: "DYNAMODB", requestId: "p1", nextCursor: "p-next",
      properties: [{ propertyId: "property-1", label: "Home", address: "Example Road" }],
    }));
    api.analyses.mockImplementation((_propertyId: string, cursor?: string) => cursor ? analysisPage : Promise.resolve({
      schemaVersion: 1, source: "DYNAMODB", requestId: "a1", nextCursor: "a-next",
      analyses: [{ propertyId: "property-1", analysisId: "analysis-1", source: "MANUAL",
        measuredAt: "2026-10-09T08:00:00.000Z", roofAreaSquareMeters: 42, segmentCount: 1 }],
    }));
    render(<AccessoriesWorkspace />);
    await screen.findByRole("button", { name: "Load more properties" });
    await screen.findByRole("button", { name: "Load more assessments" });
    await user.click(screen.getByRole("button", { name: "Load more properties" }));
    await user.click(screen.getByRole("button", { name: "Loading more properties…" }));
    await user.click(screen.getByRole("button", { name: "Load more assessments" }));
    await user.click(screen.getByRole("button", { name: "Loading more assessments…" }));
    expect(api.properties).toHaveBeenCalledTimes(2);
    expect(api.analyses).toHaveBeenCalledTimes(2);
    await act(async () => { resolveProperties(nextProperties); resolveAnalyses(nextAnalyses); });
    expect(screen.queryByRole("button", { name: "Load more properties" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Load more assessments" })).toBeNull();
    expect(screen.getByRole("option", { name: "Second home" })).toBeTruthy();
    expect(screen.getByRole("option", { name: /48 m² · manual/ })).toBeTruthy();
  });
  it("marks each demo recommendation as fictional", () => {
    render(<AccessoriesResult response={response} demo />);
    expect(screen.getByText("Monitoring · Fictional fixture")).toBeTruthy();
    expect(screen.queryByText("Battery storage")).toBeNull();
  });
});
