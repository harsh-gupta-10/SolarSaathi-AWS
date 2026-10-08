import { describe, expect, it } from "vitest";
import { ADDRESS_DRAFT_KEY, readAddressDraft, saveAddressDraft, validateAddress } from "../src/lib/address-draft";
import { isSectionActive, navigationForRole, navigationItem, sectionKeys, sectionPath } from "../src/lib/navigation";
import { resolveSiteRoute } from "../src/lib/site-routing";

describe("address drafts", () => {
  it.each(["", "  short ", "x".repeat(301), "Mumbai\u0000address"])("rejects incomplete/invalid drafts", value => expect(validateAddress(value)).toBeTruthy());
  it("stores a trimmed, versioned draft without network or query strings", () => {
    let value = "";
    saveAddressDraft({ setItem: (key, next) => { expect(key).toBe(ADDRESS_DRAFT_KEY); value = next; } }, "  Example Road, Mumbai 400001  ");
    expect(readAddressDraft({ getItem: () => value })).toBe("Example Road, Mumbai 400001");
  });
  it.each([null, "{", "[]", '{"version":2,"address":"Mumbai 400001"}', '{"version":1,"address":false}', '{"version":1,"address":"bad"}'])("ignores invalid stored data", value => expect(readAddressDraft({ getItem: () => value })).toBe(""));
  it("handles unavailable storage without leaking values", () => expect(readAddressDraft({ getItem: () => { throw new Error("blocked"); } })).toBe(""));
});
describe("role-aware navigation", () => {
  it("offers homeowner planning navigation", () => {
    const items = navigationForRole("HOMEOWNER");
    expect(items.map(item => item.label)).toContain("Analyze Roof");
    expect(items.map(item => item.label)).not.toContain("Customers");
  });
  it("offers broker workspace navigation without claiming permissions", () => {
    const labels = navigationForRole("BROKER").map(item => item.label);
    expect(labels).toContain("Customers");
    expect(labels).toContain("Leads");
    expect(labels).not.toContain("My Properties");
  });
  it("marks active pages on both local and rewritten application routes", () => {
    expect(isSectionActive("/app", "overview")).toBe(true);
    expect(isSectionActive("/", "overview")).toBe(true);
    expect(isSectionActive("/app/analyze", "analyze")).toBe(true);
    expect(isSectionActive("/analyze", "analyze")).toBe(true);
    expect(isSectionActive("/app/properties", "analyze")).toBe(false);
  });
  it("every navigation link resolves to a planned screen", () => {
    for (const role of ["HOMEOWNER", "BROKER"] as const) for (const item of navigationForRole(role)) {
      expect(navigationItem(item.key)).toBeDefined();
      expect(item.key === "overview" || sectionKeys().includes(item.key)).toBe(true);
      expect(sectionPath(item.key)).toMatch(/^\/app/);
    }
    expect(navigationItem("unknown")).toBeUndefined();
  });
});
describe("domain routing", () => {
  it("keeps localhost and unrelated hosts unchanged", () => {
    expect(resolveSiteRoute("localhost", "/app/analyze")).toEqual({ type: "next" });
    expect(resolveSiteRoute("malicious.example", "/app")).toEqual({ type: "next" });
  });
  it("routes the marketing app entry to a fixed application origin", () => expect(resolveSiteRoute("solarsaathi.in", "/app/analyze")).toEqual({ type: "redirect", origin: "https://app.solarsaathi.in", pathname: "/analyze" }));
  it("rewrites the app domain without duplicating path segments", () => {
    expect(resolveSiteRoute("app.solarsaathi.in", "/")).toEqual({ type: "rewrite", pathname: "/app" });
    expect(resolveSiteRoute("app.solarsaathi.in", "/benefits")).toEqual({ type: "rewrite", pathname: "/app/benefits" });
    expect(resolveSiteRoute("app.solarsaathi.in", "/app/benefits")).toEqual({ type: "redirect", origin: "https://app.solarsaathi.in", pathname: "/benefits" });
  });
  it.each(["/_next/static/app.js", "/favicon.ico", "/auth/callback", "/api/health"])("does not rewrite assets or authentication callbacks", path => expect(resolveSiteRoute("app.solarsaathi.in", path)).toEqual({ type: "next" }));
});
