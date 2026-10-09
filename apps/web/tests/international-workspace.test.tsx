// @vitest-environment jsdom
import React from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InternationalWorkspace } from "../src/components/international-workspace";
import type { InternationalResearchResponse } from "../src/lib/international-api";
import { RoofRequestError } from "../src/lib/roof-api";
import type { AuthProfile } from "../src/auth/auth-profile";

const auth = vi.hoisted(() => ({ status: "signedOut" as "signedOut" | "signedIn", profile: null as AuthProfile | null }));
const mocks = vi.hoisted(() => ({ research: vi.fn() }));
vi.mock("../src/auth/auth-provider", () => ({ useAuth: () => auth }));
vi.mock("../src/lib/international-api", () => ({ internationalApi: mocks }));

const researchedAt = "2026-10-09T08:00:00.000Z";
function response(changes: Partial<InternationalResearchResponse> = {}): InternationalResearchResponse {
  return { schemaVersion: 1, source: "LIVE_AUTHORITY_RESEARCH_V1", requestId: "synthetic-request",
    status: "LIVE_RESEARCHED", jurisdiction: { countryCode: "US", region: "California", utility: null, origin: "EXPLICIT" },
    researchedAt, expiresAt: "2026-10-09T09:00:00.000Z", cache: { status: "MISS", version: 1 },
    coverage: { complete: false, reasonCodes: ["SCOPED_POLICY_NOT_VERIFIED"] },
    sources: [{ title: "Example authority page", url: "https://www.energy.gov/example", authorityHost: "www.energy.gov",
      sourceDate: null, checkedAt: researchedAt, contentSha256: "a".repeat(64), verificationStatus: "LIVE_RESEARCHED" }],
    notCurated: true, eligibilityEvaluated: false, benefitAmountAvailable: false, ...changes };
}
function signIn(userId = "synthetic-user") {
  auth.status = "signedIn";
  auth.profile = { userId, cognitoSub: userId, email: `${userId}@example.com`, name: "Example user", role: "HOMEOWNER" };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
beforeEach(() => { auth.status = "signedOut"; auth.profile = null; mocks.research.mockReset(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("international source research", () => {
  it("requires sign-in and does not request location or research on mount", () => {
    const geolocate = vi.fn();
    vi.stubGlobal("navigator", { geolocation: { getCurrentPosition: geolocate } });
    render(<InternationalWorkspace />);
    expect(screen.getByRole("link", { name: "View fictional demo" }).getAttribute("href")).toBe("/demo/international");
    expect(mocks.research).not.toHaveBeenCalled();
    expect(geolocate).not.toHaveBeenCalled();
  });

  it("submits explicit country and context; shows sourced, limited live research without an amount", async () => {
    signIn(); mocks.research.mockResolvedValue(response());
    render(<InternationalWorkspace />);
    await userEvent.type(screen.getByLabelText("Country code"), "us");
    await userEvent.type(screen.getByLabelText("State, province or region (optional)"), "California");
    await userEvent.type(screen.getByLabelText("Electric utility (optional)"), "Example Utility");
    await userEvent.click(screen.getByRole("button", { name: "Check official sources" }));
    await waitFor(() => expect(mocks.research).toHaveBeenCalledTimes(1));
    expect(mocks.research.mock.calls[0][0]).toEqual({ countryCode: "US", region: "California", utility: "Example Utility" });
    expect(await screen.findByText("Example authority page")).toBeTruthy();
    expect(screen.getByText("Live researched · not curated")).toBeTruthy();
    expect(screen.getByText("Authority website: www.energy.gov")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Open official source/ }).getAttribute("href")).toBe("https://www.energy.gov/example");
    expect(screen.getByText(/Eligibility, benefit amounts, deadlines and payment timing have not been evaluated/)).toBeTruthy();
  });

  it("requests one-time location only on click, then clears conflicting country and region", async () => {
    signIn();
    const geolocate = vi.fn((success: (position: GeolocationPosition) => void) => success({
      coords: { latitude: 0, longitude: 0, accuracy: 500 },
    } as GeolocationPosition)); // Synthetic test coordinate; no private location.
    vi.stubGlobal("navigator", { geolocation: { getCurrentPosition: geolocate } });
    mocks.research.mockResolvedValue(response({ jurisdiction: { countryCode: "GB", region: "England", utility: null,
      origin: "AMAZON_LOCATION" } }));
    render(<InternationalWorkspace />);
    expect(geolocate).not.toHaveBeenCalled();
    await userEvent.type(screen.getByLabelText("Country code"), "US");
    await userEvent.type(screen.getByLabelText("State, province or region (optional)"), "California");
    await userEvent.click(screen.getByRole("button", { name: "Use my location once" }));
    expect(geolocate).toHaveBeenCalledTimes(1);
    expect((screen.getByLabelText("Country code") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("State, province or region (optional)") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("State, province or region (optional)") as HTMLInputElement).disabled).toBe(true);
    await userEvent.click(screen.getByRole("button", { name: "Check official sources" }));
    await waitFor(() => expect(mocks.research).toHaveBeenCalledTimes(1));
    expect(mocks.research.mock.calls[0][0]).toEqual({ location: { latitude: 0, longitude: 0 } });
    expect(await screen.findByText(/Region from location: England/)).toBeTruthy();
  });

  it("routes India to curated benefits for either explicit country or location-derived country", async () => {
    signIn();
    const view = render(<InternationalWorkspace />);
    await userEvent.type(screen.getByLabelText("Country code"), "IN");
    await userEvent.click(screen.getByRole("button", { name: "Check official sources" }));
    expect(mocks.research).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "Open Government Benefits" }).getAttribute("href")).toBe("/app/benefits");
    view.unmount();
    const geolocate = vi.fn((success: (position: GeolocationPosition) => void) => success({
      coords: { latitude: 0, longitude: 0, accuracy: 500 },
    } as GeolocationPosition));
    vi.stubGlobal("navigator", { geolocation: { getCurrentPosition: geolocate } });
    mocks.research.mockRejectedValue(new RoofRequestError("INDIA_USE_CURATED_POLICY", "India uses curated policy."));
    render(<InternationalWorkspace />);
    await userEvent.click(screen.getByRole("button", { name: "Use my location once" }));
    await userEvent.click(screen.getByRole("button", { name: "Check official sources" }));
    expect(await screen.findByRole("link", { name: "Open Government Benefits" })).toBeTruthy();
  });

  it("rejects a coarse device fix before sending coordinates", async () => {
    signIn();
    const geolocate = vi.fn((success: (position: GeolocationPosition) => void) => success({
      coords: { latitude: 0, longitude: 0, accuracy: 50_000 },
    } as GeolocationPosition)); // Synthetic test coordinate; no private location.
    vi.stubGlobal("navigator", { geolocation: { getCurrentPosition: geolocate } });
    render(<InternationalWorkspace />);
    await userEvent.click(screen.getByRole("button", { name: "Use my location once" }));
    expect(screen.getByRole("alert").textContent).toContain("too approximate");
    expect(screen.queryByText("Location ready")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Check official sources" }));
    expect(mocks.research).not.toHaveBeenCalled();
  });

  it("drops an old response when jurisdiction changes and renders unavailable coverage honestly", async () => {
    signIn();
    const late = deferred<InternationalResearchResponse>();
    mocks.research.mockReturnValueOnce(late.promise).mockResolvedValueOnce(response({ status: "UNAVAILABLE", sources: [],
      jurisdiction: { countryCode: "CA", region: null, utility: null, origin: "EXPLICIT" },
      coverage: { complete: false, reasonCodes: ["AUTHORITY_REGISTRY_UNAVAILABLE"] } }));
    render(<InternationalWorkspace />);
    await userEvent.type(screen.getByLabelText("Country code"), "US");
    await userEvent.click(screen.getByRole("button", { name: "Check official sources" }));
    await waitFor(() => expect(mocks.research).toHaveBeenCalledTimes(1));
    await userEvent.clear(screen.getByLabelText("Country code"));
    await userEvent.type(screen.getByLabelText("Country code"), "CA");
    await act(async () => late.resolve(response()));
    expect(screen.queryByText("Example authority page")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Check official sources" }));
    expect(await screen.findByText("Research unavailable")).toBeTruthy();
    expect(screen.getByText(/No authoritative source page was verified/)).toBeTruthy();
  });

  it("removes pending research when the signed-in account changes", async () => {
    signIn("synthetic-user-a");
    const late = deferred<InternationalResearchResponse>();
    mocks.research.mockReturnValue(late.promise);
    const view = render(<InternationalWorkspace />);
    await userEvent.type(screen.getByLabelText("Country code"), "US");
    await userEvent.click(screen.getByRole("button", { name: "Check official sources" }));
    await waitFor(() => expect(mocks.research).toHaveBeenCalledTimes(1));
    const priorSignal = mocks.research.mock.calls[0][1] as AbortSignal;
    signIn("synthetic-user-b");
    view.rerender(<InternationalWorkspace />);
    expect(priorSignal.aborted).toBe(true);
    await act(async () => late.resolve(response()));
    expect(screen.queryByText("Example authority page")).toBeNull();
    expect((screen.getByLabelText("Country code") as HTMLInputElement).value).toBe("");
  });

  it("labels a source-bearing partial result as incomplete", async () => {
    signIn();
    mocks.research.mockResolvedValue(response({ status: "INCOMPLETE", sources: [{
      title: "Example authority page", url: "https://www.energy.gov/example", authorityHost: "www.energy.gov",
      sourceDate: "2026-10-01T00:00:00.000Z", checkedAt: researchedAt,
      contentSha256: "a".repeat(64), verificationStatus: "LIVE_RESEARCHED",
    }] }));
    render(<InternationalWorkspace />);
    await userEvent.type(screen.getByLabelText("Country code"), "US");
    await userEvent.click(screen.getByRole("button", { name: "Check official sources" }));
    expect(await screen.findByText("Research incomplete")).toBeTruthy();
    expect(screen.getByText("Page last modified")).toBeTruthy();
    expect(screen.getByText("Example authority page")).toBeTruthy();
    expect(screen.getByText(/entered region or utility has not been verified as applicable/)).toBeTruthy();
  });
});
