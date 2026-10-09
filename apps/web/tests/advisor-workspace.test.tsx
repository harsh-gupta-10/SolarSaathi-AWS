// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { UserProfile } from "@solarsaathi/types";
import { AdvisorWorkspace } from "../src/components/advisor-workspace";

const identity = vi.hoisted(() => ({ status: "signedIn" as "signedIn" | "signedOut", profile: {
  userId: "owner-1", cognitoSub: "owner-1", email: "owner@example.com", name: "Owner", role: "HOMEOWNER",
} as UserProfile | null }));
const api = vi.hoisted(() => ({ properties: vi.fn(), list: vi.fn(), analyses: vi.fn(), ask: vi.fn() }));
vi.mock("../src/auth/auth-provider", () => ({ useAuth: () => identity }));
vi.mock("../src/lib/applications-api", () => ({ applicationsApi: { properties: api.properties, list: api.list } }));
vi.mock("../src/lib/advisor-api", () => ({ advisorApi: { analyses: api.analyses, ask: api.ask } }));

const response = { schemaVersion: 1, source: "GROUNDED_ADVISOR_V1", requestId: "request-1",
  propertyId: "property-1", analysisId: "analysis-1", status: "ANSWERED",
  mode: "DETERMINISTIC_FALLBACK", answer: "The stored roof has 42 m² of user-entered area.",
  cards: [{ id: "roof", kind: "ROOF", statement: "User entered 42 m² of roof area.", provenance: "USER_MEASURED" }],
  selectedCardIds: ["roof"], caveats: ["A site survey is still needed."], missingContext: [] };

beforeEach(() => {
  identity.status = "signedIn";
  identity.profile = { userId: "owner-1", cognitoSub: "owner-1", email: "owner@example.com", name: "Owner", role: "HOMEOWNER" };
  for (const mock of Object.values(api)) mock.mockReset();
  api.properties.mockResolvedValue({ schemaVersion: 1, source: "DYNAMODB", requestId: "r1", properties: [
    { propertyId: "property-1", label: "Home", address: "Example Road, Mumbai" }],
  });
  api.analyses.mockResolvedValue({ schemaVersion: 1, source: "DYNAMODB", requestId: "r2", analyses: [{
    analysisId: "analysis-1", propertyId: "property-1", source: "MANUAL", measuredAt: "2026-10-09T08:00:00.000Z",
    roofAreaSquareMeters: 42, segmentCount: 1,
  }] });
  api.list.mockResolvedValue({ schemaVersion: 1, source: "DYNAMODB_APPLICATION_TRACKER_V1", requestId: "r3", applications: [] });
  api.ask.mockResolvedValue(response);
});
afterEach(() => { cleanup(); });

describe("grounded advisor workspace", () => {
  it("does not load property records while signed out", () => {
    identity.status = "signedOut"; identity.profile = null;
    render(<AdvisorWorkspace />);
    expect(screen.getByRole("heading", { name: "Sign in to ask about your solar plan" })).toBeTruthy();
    expect(api.properties).not.toHaveBeenCalled();
  });
  it("selects an owned roof, asks once, and shows only the returned cards and caveats", async () => {
    const user = userEvent.setup();
    render(<AdvisorWorkspace />);
    await screen.findByRole("combobox", { name: "Confirmed roof assessment" });
    await user.click(screen.getByRole("button", { name: /What does my roof assessment tell me/ }));
    await user.click(screen.getByRole("button", { name: "Explain from my records" }));
    await screen.findByText("The stored roof has 42 m² of user-entered area.");
    expect(api.ask).toHaveBeenCalledWith({ propertyId: "property-1", analysisId: "analysis-1",
      question: "What does my roof assessment tell me?" }, expect.any(AbortSignal));
    expect(screen.getByText("User entered 42 m² of roof area.")).toBeTruthy();
    expect(screen.getByText("A site survey is still needed.")).toBeTruthy();
    await user.type(screen.getByLabelText("Your question"), " More detail?");
    expect(screen.queryByText("The stored roof has 42 m² of user-entered area.")).toBeNull();
  });
  it("requires explicit complete scenario inputs and sends no invented prices", async () => {
    const user = userEvent.setup();
    render(<AdvisorWorkspace />);
    await screen.findByRole("combobox", { name: "Confirmed roof assessment" });
    await user.type(screen.getByLabelText("Your question"), "What is my planning payback?");
    await user.click(screen.getByLabelText("Include a cost and benefit scenario"));
    await user.click(screen.getByRole("button", { name: "Explain from my records" }));
    expect(screen.getByRole("alert").textContent).toContain("All required numbers must be valid");
    expect(api.ask).not.toHaveBeenCalled();
    const values = [
      ["Monthly electricity use (kWh)", "300"], ["Assumed annual generation (kWh per kW)", "1500"],
      ["Planning system size (kW)", "2"], ["Your gross system quote (₹)", "100000"],
      ["Energy used at home (%)", "70"], ["Avoidable import tariff (₹/kWh)", "8"],
      ["Assumed export value (₹/kWh)", "0"], ["Annual maintenance (₹)", "3000"],
    ];
    for (const [label, value] of values) await user.type(screen.getByLabelText(label), value);
    await user.type(screen.getByLabelText("State or UT code (optional)"), "MH");
    await user.selectOptions(screen.getByLabelText("Electricity customer type (optional)"), "RESIDENTIAL");
    await user.click(screen.getByRole("button", { name: "Explain from my records" }));
    await waitFor(() => expect(api.ask).toHaveBeenCalledWith(expect.objectContaining({ scenario: {
      demand: { kind: "CONSUMPTION", monthlyConsumptionKwh: 300 }, generationKwhPerKwYear: 1500,
      nominalKw: 2, financialInputs: { grossSystemCostRupees: 100000, selfConsumptionFraction: 0.7,
        importTariffRupeesPerKwh: 8, exportRateRupeesPerKwh: 0, annualMaintenanceRupees: 3000 },
      applicantFacts: { country: "IN", state: "MH", customerType: "RESIDENTIAL" },
    } }), expect.any(AbortSignal)));
  });
  it("hides a pending answer immediately when the account signs out", async () => {
    const user = userEvent.setup();
    let resolveAnswer: ((value: typeof response) => void) | undefined;
    api.ask.mockImplementation(() => new Promise<typeof response>(resolve => { resolveAnswer = resolve; }));
    const view = render(<AdvisorWorkspace />);
    await screen.findByRole("combobox", { name: "Confirmed roof assessment" });
    await user.type(screen.getByLabelText("Your question"), "What does my roof show?");
    await user.click(screen.getByRole("button", { name: "Explain from my records" }));
    identity.status = "signedOut"; identity.profile = null;
    view.rerender(<AdvisorWorkspace />);
    expect(screen.getByRole("heading", { name: "Sign in to ask about your solar plan" })).toBeTruthy();
    resolveAnswer?.(response);
    expect(screen.queryByText(response.answer)).toBeNull();
  });
});
