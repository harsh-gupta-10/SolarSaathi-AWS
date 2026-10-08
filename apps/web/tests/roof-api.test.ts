import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { roofApi, RoofRequestError } from "../src/lib/roof-api";

const mocks = vi.hoisted(() => ({ base: "https://api.example.com/v1", session: vi.fn() }));
vi.mock("../src/lib/env", () => ({ getPublicEnvironment: () => ({ NEXT_PUBLIC_API_BASE_URL: mocks.base }) }));
vi.mock("aws-amplify/auth", () => ({ fetchAuthSession: mocks.session }));

beforeEach(() => {
  mocks.base = "https://api.example.com/v1";
  mocks.session.mockReset();
  mocks.session.mockResolvedValue({ tokens: { accessToken: { toString: () => "access-token" } } });
});
afterEach(() => vi.unstubAllGlobals());

describe("roof API client", () => {
  it("does not make a request without a configured API", async () => {
    mocks.base = "";
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    await expect(roofApi.geocode("property-1")).rejects.toMatchObject({ code: "API_NOT_CONFIGURED" } satisfies Partial<RoofRequestError>);
    expect(mocks.session).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("uses an access token and omits cookies for a validated roof request", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, status: 200,
      json: async () => ({ schemaVersion: 1, requestId: "request-1", source: "GOOGLE_GEOCODING", candidates: [] }) });
    vi.stubGlobal("fetch", fetcher);
    await expect(roofApi.geocode("property-1")).resolves.toMatchObject({ candidates: [] });
    expect(fetcher).toHaveBeenCalledWith("https://api.example.com/v1/solar/geocode", expect.objectContaining({
      method: "POST", credentials: "omit", redirect: "error", cache: "no-store", body: JSON.stringify({ propertyId: "property-1" }),
      headers: expect.objectContaining({ authorization: "Bearer access-token" }),
    }));
  });
  it("rejects malformed provider data instead of displaying it", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200,
      json: async () => ({ schemaVersion: 1, requestId: "request-1", source: "GOOGLE_GEOCODING", candidates: [{ placeId: "x" }] }) }));
    await expect(roofApi.geocode("property-1")).rejects.toMatchObject({ code: "INVALID_RESPONSE" } satisfies Partial<RoofRequestError>);
  });
  it("rejects malformed roof geometry before the confirmation UI reads coordinates", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200,
      json: async () => ({ schemaVersion: 1, requestId: "request-2", source: "GOOGLE_SOLAR", previewId: "preview-1",
        roof: { schemaVersion: 1, source: "GOOGLE_SOLAR", measuredAt: "2026-10-08T10:00:00Z",
          roofAreaSquareMeters: 35, segmentCount: 1, segments: [{ segmentId: "one", areaSquareMeters: 35 }],
          center: { latitude: "not a number", longitude: 72.8 } } }) }));
    await expect(roofApi.confirmBuilding("property-1", "preview-1")).rejects.toMatchObject({ code: "INVALID_RESPONSE" } satisfies Partial<RoofRequestError>);
  });
  it("rejects invalid optional panel measurements before generating a 3D plan", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200,
      json: async () => ({ schemaVersion: 1, requestId: "request-3", source: "MANUAL", analysisId: "analysis-1",
        roof: { schemaVersion: 1, source: "MANUAL", measuredAt: "2026-10-08T10:00:00Z",
          roofAreaSquareMeters: 35, segmentCount: 1, segments: [{ segmentId: "one", areaSquareMeters: 35 }],
          panelWidthMeters: "2.0" } }) }));
    await expect(roofApi.confirmManualRoof("property-1", { roofAreaSquareMeters: 35 })).rejects.toMatchObject({ code: "INVALID_RESPONSE" } satisfies Partial<RoofRequestError>);
  });
});
