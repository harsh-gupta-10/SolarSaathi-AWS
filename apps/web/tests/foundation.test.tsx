import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import Home from "../src/app/page";
import { getPublicEnvironment } from "../src/lib/env";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

describe("truthful development site", () => {
  it("labels unavailable features without displaying fabricated results", () => {
    const html = renderToStaticMarkup(<Home />);
    expect(html).toContain('id="main-content"');
    expect(html).toContain("live integrations need cloud configuration");
    expect(html).toContain("no verified live policy corpus");
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
});
