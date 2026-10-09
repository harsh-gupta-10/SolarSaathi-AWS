// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApplicationsPanel } from "../src/components/application-tracker";

const identity = vi.hoisted(() => ({ status: "signedIn" as "signedIn" | "signedOut", profile: { userId: "owner-one" } as
  { userId: string } | null }));
const api = vi.hoisted(() => ({ properties: vi.fn(), list: vi.fn(), get: vi.fn(), transition: vi.fn(),
  details: vi.fn(), document: vi.fn(), chatSuggestion: vi.fn() }));
vi.mock("../src/auth/auth-provider", () => ({ useAuth: () => identity }));
vi.mock("../src/lib/applications-api", () => ({ applicationsApi: api }));
vi.mock("../src/lib/roof-api", () => ({ RoofRequestError: class extends Error {} }));

const citation = { schemaVersion: 1 as const, sourceId: "SRC#SYNTHETIC", sourceRegistryVersion: 1,
  documentId: "DOC#SYNTHETIC", documentVersion: 1, documentSha256: "a".repeat(64),
  publisherName: "Synthetic source", documentTitle: "Fictional process", sourceUrl: "https://example.com/fixture",
  retrievedAt: "2026-10-08T00:00:00.000Z", locator: { section: "Fixture" } };
const application = (propertyId: string, id: string) => ({ schemaVersion: 1, applicationId: id, propertyId,
  analysisId: "analysis-one", createdByUserId: "owner-one", policyId: "POLICY#SYNTHETIC", policyVersion: 1,
  benefitId: "BENEFIT#SYNTHETIC", ruleId: "RULE#SYNTHETIC", jurisdiction: "IN",
  system: { nominalKw: 3, actualDcKw: 3 }, benefitEvaluatedAt: "2026-10-08T00:00:00.000Z",
  benefitCountedAmountPaise: 100000, lastVerifiedAt: "2026-10-08T00:00:00.000Z",
  policyCitations: [citation], sourceChecks: [{ sourceId: citation.sourceId,
    lastCheckedAt: "2026-10-08T00:00:00.000Z", fresh: true, status: "HEALTHY" }],
  processSource: "VERIFIED_POLICY_SNAPSHOT", progressSource: "USER_REPORTED", status: "IN_PROGRESS",
  expectedNextStepId: "APPLICATION_SUBMITTED", steps: [{ stepId: "APPLICATION_SUBMITTED", order: 1,
    title: `Submit ${id}`, description: "Submit the synthetic fixture application.", required: true,
    citations: [citation], status: "PENDING", verificationStatus: "USER_REPORTED",
    updatedAt: "2026-10-08T00:00:00.000Z" }], documents: [], revision: 1,
  createdAt: "2026-10-08T00:00:00.000Z", updatedAt: "2026-10-08T00:00:00.000Z" });

beforeEach(() => {
  identity.status = "signedIn"; identity.profile = { userId: "owner-one" };
  Object.values(api).forEach(mock => mock.mockReset());
  api.properties.mockResolvedValue({ properties: [{ propertyId: "property-one", label: "Home one",
    address: "Private address one" }, { propertyId: "property-two", label: "Home two",
    address: "Private address two" }] });
  api.list.mockResolvedValue({ applications: [application("property-one", "application-one")] });
  api.get.mockImplementation(async (propertyId: string, id: string) => application(propertyId, id));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("application tracker account and property boundaries", () => {
  it("shows a retry instead of an empty assessment state when property loading fails", async () => {
    api.properties.mockRejectedValueOnce(new Error("network unavailable"));
    const user = userEvent.setup();
    render(<ApplicationsPanel />);
    await screen.findByRole("button", { name: "Retry loading properties" });
    expect(screen.queryByRole("heading", { name: "No property assessment yet" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Retry loading properties" }));
    expect(await screen.findByText(/Private address one/)).toBeTruthy();
  });
  it("shows a retry instead of an empty tracker state when application loading fails", async () => {
    api.list.mockRejectedValueOnce(new Error("network unavailable"));
    const user = userEvent.setup();
    render(<ApplicationsPanel />);
    await screen.findByRole("button", { name: "Retry loading applications" });
    expect(screen.queryByText("No application tracker has been created for this property.")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Retry loading applications" }));
    expect(await screen.findByRole("button", { name: /Synthetic/ })).toBeTruthy();
  });
  it("unmounts private application state when the signed-in account leaves", async () => {
    const user = userEvent.setup();
    const view = render(<ApplicationsPanel />);
    await screen.findByText(/Private address one/);
    await user.click(await screen.findByRole("button", { name: /Synthetic/ }));
    await screen.findByRole("heading", { name: "Submit application-one" });
    identity.status = "signedOut"; identity.profile = null; view.rerender(<ApplicationsPanel />);
    expect(screen.queryByText(/Private address one/)).toBeNull();
    expect(screen.queryByRole("heading", { name: "Submit application-one" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Sign in to view applications" })).toBeTruthy();
  });

  it("ignores an older property list response after the user switches properties", async () => {
    const user = userEvent.setup();
    let resolveOld!: (value: unknown) => void;
    api.list.mockImplementation((propertyId: string) => propertyId === "property-one" ?
      new Promise(resolve => { resolveOld = resolve; }) :
      Promise.resolve({ applications: [application("property-two", "application-two")] }));
    render(<ApplicationsPanel />);
    await screen.findByText(/Private address one/);
    await user.selectOptions(screen.getByLabelText("Property"), "property-two");
    await screen.findByText(/Policy v1.*updated/);
    resolveOld({ applications: [application("property-one", "application-one")] });
    await waitFor(() => expect(api.list).toHaveBeenCalledWith("property-two", undefined, expect.any(AbortSignal)));
    expect(screen.queryByRole("button", { name: /application-one/ })).toBeNull();
  });
});
