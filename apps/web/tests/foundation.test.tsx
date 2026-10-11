import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import Home from "../src/app/page";
import { getPublicEnvironment } from "../src/lib/env";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("../src/auth/auth-provider", () => ({ useAuth: () => ({ status: "signedOut", profile: null }) }));

describe("truthful development site", () => {
  it("labels unavailable features without displaying fabricated results", () => {
    const html = renderToStaticMarkup(<Home />);
    expect(html).toContain('id="main-content"');
    expect(html).toContain("Ask SolarSaathi about solar for your home.");
    expect(html).toContain("only once a rule has been verified against an official source");
    expect(html).toContain('href="/demo"');
    expect(html).toContain("Illustrative concept");
    expect(html).not.toContain("₹");
  });

  it("does not return server secrets through the public configuration", () => {
    vi.stubEnv("GOOGLE_SOLAR_API_KEY", "test-server-only-secret");
    try {
      const env = getPublicEnvironment();
      expect(env).not.toHaveProperty("GOOGLE_SOLAR_API_KEY");
      expect(JSON.stringify(env)).not.toContain("test-server-only-secret");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("labels a configured development deployment without claiming live policy coverage", () => {
    vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "https://api.example.com/v1");
    vi.stubEnv("NEXT_PUBLIC_GOOGLE_MAPS_KEY", "restrictedBrowserKeyForTestsOnly");
    vi.stubEnv("NEXT_PUBLIC_COGNITO_USER_POOL_ID", "ap-south-1_example");
    vi.stubEnv("NEXT_PUBLIC_COGNITO_CLIENT_ID", "publicclient");
    try {
      const html = renderToStaticMarkup(<Home />);
      expect(html).toContain("Development preview");
      expect(html).toContain("only once a rule has been verified against an official source");
      expect(html).not.toContain("Samara");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
