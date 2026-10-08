import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { designSolarSystem, getSystemDesignAssumptionsV1 } from "@solarsaathi/calculations";
import { demoRoof } from "../src/app/demo/fixtures";
import { systemApi } from "../src/lib/system-api";

const mocks = vi.hoisted(() => ({ session: vi.fn() }));
vi.mock("../src/lib/env", () => ({ getPublicEnvironment: () => ({ NEXT_PUBLIC_API_BASE_URL: "https://api.example.com/v1" }) }));
vi.mock("aws-amplify/auth", () => ({ fetchAuthSession: mocks.session }));

const demand = { kind: "CONSUMPTION" as const, monthlyConsumptionKwh: 300 };
const design = designSolarSystem(demoRoof, demand, getSystemDesignAssumptionsV1(demoRoof));

beforeEach(() => {
  mocks.session.mockReset();
  mocks.session.mockResolvedValue({ tokens: { accessToken: { toString: () => "access-token" } } });
});
afterEach(() => vi.unstubAllGlobals());

describe("system design API client", () => {
  it("posts only analysis IDs and bounded planning inputs with the access token", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({
      schemaVersion: 1, source: "DETERMINISTIC_SYSTEM_DESIGN", requestId: "request-1",
      propertyId: "property-1", analysisId: "analysis-1", design,
    }) });
    vi.stubGlobal("fetch", fetcher);
    await expect(systemApi.recommend("property-1", "analysis-1", demand, 1500)).resolves.toMatchObject({ design });
    expect(fetcher).toHaveBeenCalledWith("https://api.example.com/v1/systems/recommend", expect.objectContaining({
      method: "POST", credentials: "omit", redirect: "error", cache: "no-store",
      body: JSON.stringify({ propertyId: "property-1", analysisId: "analysis-1", demand, generationKwhPerKwYear: 1500 }),
      headers: expect.objectContaining({ authorization: "Bearer access-token" }),
    }));
  });

  it("rejects a result for a different analysis", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({
      schemaVersion: 1, source: "DETERMINISTIC_SYSTEM_DESIGN", requestId: "request-1",
      propertyId: "property-1", analysisId: "different-analysis", design,
    }) }));
    await expect(systemApi.recommend("property-1", "analysis-1", demand, 1500)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("rejects malformed candidate data before displaying it", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({
      schemaVersion: 1, source: "DETERMINISTIC_SYSTEM_DESIGN", requestId: "request-1",
      propertyId: "property-1", analysisId: "analysis-1",
      design: { ...design, candidates: [{ ...design.candidates[0], panelCount: "three" }] },
    }) }));
    await expect(systemApi.recommend("property-1", "analysis-1", demand, 1500)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
});
