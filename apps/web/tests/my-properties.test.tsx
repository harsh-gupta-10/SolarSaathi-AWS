// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MyPropertiesWorkspace } from "../src/components/my-properties-workspace";

const roof = vi.hoisted(() => ({ bootstrap: vi.fn(), createProperty: vi.fn(), deleteProperty: vi.fn() }));
vi.mock("../src/lib/roof-api", () => ({
  roofApi: roof, RoofRequestError: class extends Error { code?: string; },
}));
const list = vi.hoisted(() => ({ properties: vi.fn() }));
vi.mock("../src/lib/applications-api", () => ({ applicationsApi: list }));
const auth = vi.hoisted(() => ({ value: { status: "signedIn", profile: { userId: "user-1" } } as
  { status: string; profile: { userId: string } | null } }));
vi.mock("../src/auth/auth-provider", () => ({ useAuth: () => auth.value }));

beforeEach(() => {
  localStorage.clear();
  auth.value = { status: "signedIn", profile: { userId: "user-1" } };
  list.properties.mockResolvedValue({ properties: [] });
  roof.bootstrap.mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("My Properties", () => {
  it("starts empty with no seeded sample properties, invented subsidy or sample controls", async () => {
    render(<MyPropertiesWorkspace />);
    expect(await screen.findByText("No properties registered yet")).toBeTruthy();
    expect(screen.queryByText(/78,000/)).toBeNull();
    expect(screen.queryByText(/sample/i)).toBeNull();
  });

  it("shows the backend error and saves nothing when the account save fails", async () => {
    roof.createProperty.mockRejectedValue(new Error("Backend unavailable"));
    const user = userEvent.setup();
    render(<MyPropertiesWorkspace />);
    await user.click(screen.getByRole("button", { name: "Add Property" }));
    await user.type(screen.getByLabelText("Property Address"), "1 Test Road, Pune");
    await user.click(screen.getByRole("button", { name: "Save Property to Account" }));
    expect(await screen.findByText("Backend unavailable")).toBeTruthy();
    expect(screen.queryByText("1 Test Road, Pune", { selector: "span" })).toBeNull();
  });

  it("does not fabricate roof area, system size or subsidy for a newly saved property", async () => {
    roof.createProperty.mockResolvedValue("property-1");
    const user = userEvent.setup();
    render(<MyPropertiesWorkspace />);
    await user.click(screen.getByRole("button", { name: "Add Property" }));
    await user.type(screen.getByLabelText("Property Address"), "1 Test Road, Pune");
    await user.type(screen.getByLabelText(/Monthly Units/), "410");
    await user.click(screen.getByRole("button", { name: "Save Property to Account" }));
    expect(await screen.findByText("Not measured yet")).toBeTruthy();
    expect(screen.getByText("Not designed yet")).toBeTruthy();
    expect(screen.queryByText(/₹78,000|Max Subsidy/)).toBeNull();
  });

  it("drops cached properties the backend no longer returns", async () => {
    localStorage.setItem("solarsaathi.properties.v1.user-1", JSON.stringify([
      { propertyId: "gone", label: "Deleted elsewhere", address: "Old Rd", createdAt: "x", updatedAt: "x" }]));
    list.properties.mockResolvedValue({ properties: [{ propertyId: "kept", label: "Kept home", address: "New Rd" }] });
    render(<MyPropertiesWorkspace />);
    expect(await screen.findByText("Kept home")).toBeTruthy();
    expect(screen.queryByText("Deleted elsewhere")).toBeNull();
  });

  it("asks signed-out visitors to sign in and shows no stored properties", () => {
    localStorage.setItem("solarsaathi.properties.v1.default", JSON.stringify([
      { propertyId: "p", label: "Leaked", address: "x", createdAt: "x", updatedAt: "x" }]));
    auth.value = { status: "signedOut", profile: null };
    render(<MyPropertiesWorkspace />);
    expect(screen.getByRole("heading", { name: "Sign in to manage your properties" })).toBeTruthy();
    expect(screen.queryByText("Leaked")).toBeNull();
  });
});
