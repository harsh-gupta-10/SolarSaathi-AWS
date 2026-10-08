import { describe, expect, it, vi } from "vitest";
import { CoreService } from "../src/data/service";
import { CoreRepository } from "../src/data/repository";
import { keys } from "../src/data/keys";
import { analysisSchema } from "../src/data/schemas";
import { GoogleRoofClient } from "../src/roof/google";
import { normalizeSolar } from "../src/roof/normalize";
import { RoofService } from "../src/roof/service";
import { fixedNow, identity, MemoryExecutor, otherId, setupData } from "./data-fixtures";

const coordinate = { latitude: 19.076, longitude: 72.8777 };
const geocodeResponse = {
  status: "OK", results: [{ place_id: "place-mumbai-1", formatted_address: "123 Example Road, Mumbai, India",
    geometry: { location: { lat: coordinate.latitude, lng: coordinate.longitude }, location_type: "ROOFTOP" } }],
};
const solarResponse = {
  name: "buildings/place-mumbai-1", center: coordinate, imageryQuality: "BASE",
  imageryDate: { year: 2025, month: 6, day: 14 },
  boundingBox: { sw: { latitude: 19.0759, longitude: 72.8776 }, ne: { latitude: 19.0761, longitude: 72.8778 } },
  solarPotential: {
    wholeRoofStats: { areaMeters2: 80, groundAreaMeters2: 78 },
    roofSegmentStats: [{ stats: { areaMeters2: 80, groundAreaMeters2: 78, sunshineQuantiles: [1400, 1700] },
      center: coordinate, pitchDegrees: 11, azimuthDegrees: 181, planeHeightAtCenterMeters: 24 }],
    panelWidthMeters: 1.05, panelHeightMeters: 1.7, panelCapacityWatts: 400,
    solarPanels: [{ center: coordinate, orientation: "PORTRAIT", segmentIndex: 0, yearlyEnergyDcKwh: 600 }],
    financialAnalyses: [{ cashPurchaseSavings: { savings: { savingsYear1: 999_999 } } }],
  },
};
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

function google(overrides: { geocode?: unknown; solar?: unknown; solarStatus?: number } = {}) {
  const calls: URL[] = [];
  const fetcher = vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
    const url = new URL(String(input)); calls.push(url);
    expect(options?.redirect).toBe("error");
    if (url.hostname === "maps.googleapis.com") return json(overrides.geocode ?? geocodeResponse);
    if (url.hostname === "solar.googleapis.com") return json(overrides.solar ?? solarResponse, overrides.solarStatus ?? 200);
    throw new Error("Unexpected host");
  }) as unknown as typeof fetch;
  return { client: new GoogleRoofClient("test-geocode-key", "test-solar-key", fetcher), calls, fetcher };
}

async function setup() {
  const data = setupData();
  await data.service.bootstrap(identity(), {});
  await data.service.bootstrap(identity(otherId), {});
  const property = await data.service.createProperty(identity(), { label: "Home", address: "123 Example Road, Mumbai" });
  const provider = google();
  const roof = new RoofService(data.service, provider.client, () => fixedNow);
  return { ...data, property, provider, roof };
}

describe("Google roof flow", () => {
  it("geocodes the stored address, normalizes Solar data and requires both confirmations", async () => {
    const { roof, property, provider, memory } = await setup();
    const geocoded = await roof.geocode(identity(), { propertyId: property.propertyId }, "req-1");
    expect(geocoded).toMatchObject({ source: "GOOGLE_GEOCODING", candidates: [{ placeId: "place-mumbai-1", location: coordinate }] });
    const selected = { propertyId: property.propertyId, placeId: "place-mumbai-1", location: coordinate };
    const preview = await roof.buildingInsights(identity(), selected, "req-2");
    expect(preview.roof).toMatchObject({ source: "GOOGLE_SOLAR", roofAreaSquareMeters: 80, groundAreaSquareMeters: 78,
      imageryQuality: "BASE", imageryDate: "2025-06-14", buildingId: "buildings/place-mumbai-1", segmentCount: 1 });
    expect(preview.roof.panelSuggestions).toHaveLength(1);
    expect(preview.roof.segments[0].planeHeightAtCenterMeters).toBe(24);
    expect(preview.roof.bounds).toMatchObject({ southwest: solarResponse.boundingBox.sw, northeast: solarResponse.boundingBox.ne });
    expect(JSON.stringify(preview)).not.toMatch(/financialAnalyses|999999|test-solar-key/);
    await expect(roof.confirmRoof(identity(), { propertyId: property.propertyId, previewId: preview.previewId, confirmed: true }, "req-3"))
      .rejects.toMatchObject({ code: "BUILDING_NOT_CONFIRMED" });
    const confirmedBuilding = await roof.confirmBuilding(identity(), { propertyId: property.propertyId, previewId: preview.previewId, confirmed: true }, "req-4");
    expect(confirmedBuilding.roof).toEqual(preview.roof);
    const confirmedRoof = await roof.confirmRoof(identity(), { propertyId: property.propertyId, previewId: preview.previewId, confirmed: true }, "req-5");
    expect(confirmedRoof).toMatchObject({ source: "GOOGLE_SOLAR", analysisId: preview.previewId, roof: preview.roof });
    const stored = memory.read(keys.analysis(property.propertyId, preview.previewId))!;
    expect(stored.expiresAtEpochSeconds).toBe(Math.floor(fixedNow.getTime() / 1_000) + 21 * 86_400);
    expect(stored).toMatchObject({ GSI3PK: "GOOGLE_ROOF_RETENTION", GSI3SK: stored.expiresAtEpochSeconds });
    const typedStored = analysisSchema.parse(stored);
    expect(analysisSchema.safeParse({ ...typedStored, roof: { ...typedStored.roof,
      measuredAt: new Date(fixedNow.getTime() - 22 * 86_400_000).toISOString() } }).success).toBe(false);
    expect((await roof.confirmRoof(identity(), { propertyId: property.propertyId, previewId: preview.previewId, confirmed: true }, "req-6")).analysisId)
      .toBe(preview.previewId);
    expect(provider.calls.map(url => url.hostname)).toEqual(["maps.googleapis.com", "maps.googleapis.com", "solar.googleapis.com"]);
    expect(provider.calls[0].searchParams.get("address")).toBe(property.address);
    expect(provider.calls[2].searchParams.get("requiredQuality")).toBe("BASE");
  });

  it("rejects forged property, place ID, remote points and preview tokens", async () => {
    const { roof, property, provider } = await setup();
    await expect(roof.geocode(identity(otherId), { propertyId: property.propertyId }, "req"))
      .rejects.toMatchObject({ statusCode: 404 });
    expect(provider.calls).toHaveLength(0);
    await expect(roof.buildingInsights(identity(), { propertyId: property.propertyId, placeId: "forged", location: coordinate }, "req"))
      .rejects.toMatchObject({ code: "BUILDING_SELECTION_INVALID" });
    await expect(roof.buildingInsights(identity(), { propertyId: property.propertyId, placeId: "place-mumbai-1",
      location: { latitude: 20, longitude: 73 } }, "req")).rejects.toMatchObject({ code: "BUILDING_SELECTION_INVALID" });
    expect(provider.calls.every(url => url.hostname === "maps.googleapis.com")).toBe(true);
    await expect(roof.confirmBuilding(identity(), { propertyId: property.propertyId, previewId: "unowned", confirmed: true }, "req"))
      .rejects.toMatchObject({ statusCode: 404 });
  });

  it("returns manual fallback when Google has no building and never fabricates panel geometry", async () => {
    const { service, property } = await setup();
    const absent = google({ solarStatus: 404, solar: { error: { code: 404 } } });
    const roof = new RoofService(service, absent.client, () => fixedNow);
    await expect(roof.buildingInsights(identity(), { propertyId: property.propertyId, placeId: "place-mumbai-1", location: coordinate }, "req"))
      .rejects.toMatchObject({ code: "SOLAR_BUILDING_NOT_FOUND" });
    const manual = await roof.confirmRoof(identity(), { propertyId: property.propertyId,
      manual: { roofAreaSquareMeters: 64, lengthMeters: 8, widthMeters: 8 }, confirmed: true }, "req");
    expect(manual.roof).toMatchObject({ source: "MANUAL", roofAreaSquareMeters: 64, segmentCount: 1,
      manualDimensions: { lengthMeters: 8, widthMeters: 8 } });
    expect(manual.roof.panelSuggestions).toBeUndefined();
    expect((await service.getAnalysis(identity(), property.propertyId, manual.analysisId)).expiresAtEpochSeconds).toBeUndefined();
  });

  it("expires Google-derived previews and analyses at read time", async () => {
    const memory = new MemoryExecutor(); const repository = new CoreRepository("test-core-table", memory.execute);
    let current = fixedNow; let sequence = 0;
    const core = new CoreService(repository, { now: () => current, createId: () => `id-${++sequence}` });
    await core.bootstrap(identity(), {});
    const property = await core.createProperty(identity(), { label: "Home", address: "123 Example Road, Mumbai" });
    const roof = new RoofService(core, google().client, () => current);
    const preview = await roof.buildingInsights(identity(), { propertyId: property.propertyId, placeId: "place-mumbai-1", location: coordinate }, "req");
    current = new Date(fixedNow.getTime() + 15 * 60 * 1_000);
    await expect(roof.confirmBuilding(identity(), { propertyId: property.propertyId, previewId: preview.previewId, confirmed: true }, "req"))
      .rejects.toMatchObject({ statusCode: 404 });
    current = fixedNow;
    await roof.confirmBuilding(identity(), { propertyId: property.propertyId, previewId: preview.previewId, confirmed: true }, "req");
    current = new Date(fixedNow.getTime() + 10 * 60_000);
    await roof.confirmRoof(identity(), { propertyId: property.propertyId, previewId: preview.previewId, confirmed: true }, "req");
    expect(memory.read(keys.analysis(property.propertyId, preview.previewId))?.expiresAtEpochSeconds)
      .toBe(Math.floor(fixedNow.getTime() / 1_000) + 21 * 86_400);
    current = new Date(fixedNow.getTime() + 21 * 86_400_000);
    await expect(core.getAnalysis(identity(), property.propertyId, preview.previewId)).rejects.toMatchObject({ statusCode: 404 });
  });

  it("rejects contradictory manual dimensions and legacy permanent Google metadata", async () => {
    const { service, property, roof } = await setup();
    await expect(roof.confirmRoof(identity(), { propertyId: property.propertyId,
      manual: { roofAreaSquareMeters: 100, lengthMeters: 5, widthMeters: 5 }, confirmed: true }, "req"))
      .rejects.toMatchObject({ statusCode: 400 });
    await expect(service.saveAnalysis(identity(), property.propertyId, { schemaVersion: 1, source: "GOOGLE_SOLAR",
      measuredAt: fixedNow.toISOString(), roofAreaSquareMeters: 90, segmentCount: 1 }))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  it("indexes only Google-derived cache records and limits their retention", async () => {
    const { service, property, memory } = await setup();
    const now = Math.floor(fixedNow.getTime() / 1_000);
    const metadata = { schemaVersion: 1 as const, source: "GOOGLE_SOLAR" as const,
      measuredAt: fixedNow.toISOString(), roofAreaSquareMeters: 80, segmentCount: 1 };
    await service.saveCache(identity(), property.propertyId, "google-cache", 1, now + 60, metadata);
    expect(memory.read(keys.cache(property.propertyId, "google-cache", 1))).toMatchObject({
      GSI3PK: "GOOGLE_ROOF_RETENTION", GSI3SK: now + 60,
    });
    await expect(service.saveCache(identity(), property.propertyId, "google-cache", 2, now + 22 * 86_400, metadata))
      .rejects.toMatchObject({ statusCode: 400 });
    await expect(service.saveCache(identity(), property.propertyId, "google-cache", 3, now + 15 * 86_400,
      { ...metadata, measuredAt: new Date((now - 10 * 86_400) * 1_000).toISOString() }))
      .rejects.toMatchObject({ statusCode: 400 });
    await service.saveCache(identity(), property.propertyId, "manual-cache", 1, now + 60, { ...metadata, source: "MANUAL" });
    expect(memory.read(keys.cache(property.propertyId, "manual-cache", 1))?.GSI3PK).toBeUndefined();
  });
});

describe("upstream validation", () => {
  it("rejects malformed Solar geometry and invalid imagery dates", () => {
    expect(() => normalizeSolar({ ...solarResponse, solarPotential: { ...solarResponse.solarPotential, roofSegmentStats: [] } }, fixedNow.toISOString()))
      .toThrowError(expect.objectContaining({ code: "GOOGLE_RESPONSE_INVALID" }));
    expect(() => normalizeSolar({ ...solarResponse, imageryDate: { year: 2025, month: 2, day: 31 } }, fixedNow.toISOString()))
      .toThrowError(expect.objectContaining({ code: "GOOGLE_RESPONSE_INVALID" }));
    expect(() => normalizeSolar({ ...solarResponse, boundingBox: undefined }, fixedNow.toISOString()))
      .toThrowError(expect.objectContaining({ code: "GOOGLE_RESPONSE_INVALID" }));
    const largeSegments = Array.from({ length: 1_000 }, (_, index) => ({
      stats: { areaMeters2: 1, sunshineQuantiles: Array.from({ length: 32 }, () => 1_234.56) },
      center: { latitude: coordinate.latitude + index / 1_000_000, longitude: coordinate.longitude },
      pitchDegrees: 15, azimuthDegrees: 180,
    }));
    expect(() => normalizeSolar({ ...solarResponse, solarPotential: { ...solarResponse.solarPotential,
      roofSegmentStats: largeSegments, solarPanels: [] } }, fixedNow.toISOString()))
      .toThrowError(expect.objectContaining({ code: "SOLAR_ROOF_TOO_COMPLEX" }));
  });

  it("bounds response size, blocks redirects and sanitizes provider errors", async () => {
    const oversized = new GoogleRoofClient("secret", "secret", (async () =>
      new Response("x", { headers: { "content-type": "application/json", "content-length": "2000001" } })) as typeof fetch);
    await expect(oversized.geocode("123 Example Road")).rejects.toMatchObject({ code: "GOOGLE_RESPONSE_INVALID" });
    const failed = new GoogleRoofClient("secret", "secret", (async () => { throw new Error("secret PRIVATE_PROVIDER_ERROR"); }) as typeof fetch);
    await expect(failed.buildingInsights(coordinate)).rejects.toMatchObject({ code: "GOOGLE_UNAVAILABLE" });
    const missing = new GoogleRoofClient(undefined, undefined);
    await expect(missing.geocode("123 Example Road")).rejects.toMatchObject({ code: "GOOGLE_NOT_CONFIGURED" });
  });
});
