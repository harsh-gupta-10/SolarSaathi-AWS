// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AddressForm } from "../src/components/address-form";
import { AppShell } from "../src/components/app-shell";
import { AnalyzeStart } from "../src/components/analyze-start";
import { ADDRESS_DRAFT_KEY } from "../src/lib/address-draft";
import type { AuthProfile } from "../src/auth/auth-profile";

const auth = vi.hoisted(() => ({ status: "unconfigured" as "unconfigured" | "signedOut" | "signedIn", profile: null as AuthProfile | null }));
vi.mock("../src/auth/auth-provider", () => ({ useAuth: () => auth }));
const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }), usePathname: () => "/app" }));
beforeEach(() => { sessionStorage.clear(); push.mockReset(); auth.status = "unconfigured"; auth.profile = null; });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("address entry", () => {
  it("announces invalid input next to a visibly labelled field", async () => {
    render(<AddressForm />);
    await userEvent.click(screen.getByRole("button", { name: "Start planning" }));
    expect(screen.getByRole("alert").textContent).toContain("fuller address");
    expect(screen.getByLabelText("Your property address").getAttribute("aria-invalid")).toBe("true");
    expect(push).not.toHaveBeenCalled();
  });
  it("persists a tab-only draft and navigates without putting the address in the URL", async () => {
    render(<AddressForm />);
    await userEvent.type(screen.getByLabelText("Your property address"), "Example Road, Mumbai 400001");
    await userEvent.click(screen.getByRole("button", { name: "Start planning" }));
    expect(sessionStorage.getItem(ADDRESS_DRAFT_KEY)).toContain("Example Road");
    expect(push).toHaveBeenCalledWith("/app/analyze");
  });
  it("recovers when storage is blocked", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    render(<AddressForm initialAddress="Example Road, Mumbai 400001" />);
    await userEvent.click(screen.getByRole("button", { name: "Start planning" }));
    expect(screen.getByRole("alert").textContent).toContain("could not save this draft");
    expect(push).not.toHaveBeenCalled();
  });
  it("updates and clears a draft on the same route without getting stuck", async () => {
    sessionStorage.setItem(ADDRESS_DRAFT_KEY, JSON.stringify({ version: 1, address: "Example Road, Mumbai 400001" }));
    render(<AnalyzeStart />);
    await screen.findByText("Example Road, Mumbai 400001");
    await userEvent.click(screen.getByRole("button", { name: "Edit address" }));
    const input = screen.getByRole("textbox", { name: "Your property address" });
    await userEvent.clear(input);
    await userEvent.type(input, "Another Road, Pune 411001");
    await userEvent.click(screen.getByRole("button", { name: "Start planning" }));
    expect(screen.getByText("Another Road, Pune 411001")).toBeTruthy();
    expect(push).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Clear draft" }));
    expect(sessionStorage.getItem(ADDRESS_DRAFT_KEY)).toBeNull();
    expect(screen.getByRole("textbox", { name: "Your property address" })).toBeTruthy();
  });
});
describe("workspace shell", () => {
  it("changes the preview navigation without granting permissions", async () => {
    render(<AppShell><h1>Workspace content</h1></AppShell>);
    expect(screen.getByRole("link", { name: "Analyze Roof" })).toBeTruthy();
    await userEvent.selectOptions(screen.getByLabelText("Navigation preview"), "BROKER");
    expect(screen.getByRole("link", { name: "Customers" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Analyze Roof" })).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("do not grant account permissions");
    expect(screen.getByRole("link", { name: "Overview" }).getAttribute("aria-current")).toBe("page");
  });
  it("ignores stored broker preview values for an authenticated homeowner", () => {
    sessionStorage.setItem("solarsaathi.navigation-preview.v1", "BROKER");
    auth.status = "signedIn";
    auth.profile = { userId: "user-1", cognitoSub: "user-1", email: "homeowner@example.com", name: "Homeowner", role: "HOMEOWNER" };
    render(<AppShell><h1>Workspace content</h1></AppShell>);
    expect(screen.queryByLabelText("Navigation preview")).toBeNull();
    expect(screen.queryByRole("link", { name: "Customers" })).toBeNull();
    expect(screen.getByRole("link", { name: "Analyze Roof" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Account" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Policy review" })).toBeNull();
  });
  it("shows policy review navigation only for a signed-in admin group", () => {
    auth.status = "signedIn";
    auth.profile = { userId: "admin-1", cognitoSub: "admin-1", email: "admin@example.com",
      name: "Policy administrator", role: "HOMEOWNER", policyAdmin: true };
    render(<AppShell><h1>Workspace content</h1></AppShell>);
    expect(screen.getByRole("link", { name: "Policy review" }).getAttribute("href")).toBe("/app/policy-admin");
  });
  it("does not allow broker preview switching when real authentication is configured", () => {
    sessionStorage.setItem("solarsaathi.navigation-preview.v1", "BROKER");
    auth.status = "signedOut";
    render(<AppShell><h1>Workspace content</h1></AppShell>);
    expect(screen.queryByLabelText("Navigation preview")).toBeNull();
    expect(screen.queryByRole("link", { name: "Customers" })).toBeNull();
    expect(screen.getByRole("link", { name: "Sign in" })).toBeTruthy();
  });
  it("opens accessible mobile navigation and closes it with Escape", async () => {
    render(<AppShell><h1>Workspace content</h1></AppShell>);
    const trigger = screen.getByRole("button", { name: "Open navigation" });
    await userEvent.click(trigger);
    expect(screen.getByRole("dialog", { name: "SolarSaathi" })).toBeTruthy();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });
});
