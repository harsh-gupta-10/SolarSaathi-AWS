// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PriceAdminPanel } from "../src/components/price-admin-panel";

const api = vi.hoisted(() => ({ list: vi.fn(), create: vi.fn(), approve: vi.fn(), reject: vi.fn() }));
vi.mock("../src/lib/price-admin-api", () => ({ priceAdminApi: api }));
const auth = vi.hoisted(() => ({ value: { status: "signedIn", profile: { userId: "a1", policyAdmin: true } } as { status: string; profile: { userId: string; policyAdmin?: boolean } | null } }));
vi.mock("../src/auth/auth-provider", () => ({ useAuth: () => auth.value }));

const candidate = { schemaVersion: 1, benchmarkId: "PB-abcd1234", scope: { level: "STATE", state: "MH" }, sizeBand: { minKw: 1, maxKw: 3 },
  moduleClass: "DCR", inverterType: "STRING", rupeesPerKw: { min: 50000, typical: 60000, max: 70000 }, inclusions: ["Structure"], exclusions: ["GST"],
  source: { url: "https://example.gov.in/prices", publisher: "Example Dept", authorityTier: "OFFICIAL", title: "Rates" },
  publishedOn: "2026-09-01T00:00:00+05:30", lastCheckedAt: "2026-10-10T00:00:00Z", expiresAt: "2027-03-01T00:00:00+05:30", status: "CANDIDATE" };

beforeEach(() => { auth.value = { status: "signedIn", profile: { userId: "a1", policyAdmin: true } }; api.list.mockResolvedValue({ status: "CANDIDATE", benchmarks: [{ benchmark: candidate, audit: { createdBy: "SYSTEM:RESEARCH", createdAt: "2026-10-10T00:00:00Z" } }] }); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("price benchmark admin", () => {
  it("blocks non-admins without calling the API", () => {
    auth.value = { status: "signedIn", profile: { userId: "u1" } };
    render(<PriceAdminPanel />);
    expect(screen.getByRole("heading", { name: "Policy administrator access required" })).toBeTruthy();
    expect(api.list).not.toHaveBeenCalled();
  });
  it("lists candidates with their source and approves with a note", async () => {
    api.approve.mockResolvedValue({ ...candidate, status: "APPROVED" });
    const user = userEvent.setup();
    render(<PriceAdminPanel />);
    expect(await screen.findByText(/State MH · 1–3 kW · DCR/)).toBeTruthy();
    expect(screen.getByText(/Source: Example Dept \(official\)/)).toBeTruthy();
    await user.type(screen.getByLabelText(/Note or rejection reason/), "Matches MNRE circular");
    await user.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(api.approve).toHaveBeenCalledWith("PB-abcd1234", { note: "Matches MNRE circular" }));
  });
  it("requires a reason to reject", async () => {
    const user = userEvent.setup();
    render(<PriceAdminPanel />);
    await user.click(await screen.findByRole("button", { name: "Reject" }));
    expect(screen.getByText("Enter a reason before rejecting.")).toBeTruthy();
    expect(api.reject).not.toHaveBeenCalled();
  });
});
