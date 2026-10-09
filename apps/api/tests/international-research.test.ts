import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { describe, expect, it, vi } from "vitest";
import type { CoreExecutor } from "../src/data/client";
import { ResearchCache } from "../src/international/cache";
import { fetchOfficialPage, type OfficialPageDependencies } from "../src/international/fetch";
import { InternationalResearchService, type CountryLocator } from "../src/international/service";
import { BraveOfficialDiscovery, type Discovery } from "../src/international/search";
import type { ResearchResponse, ResearchSource } from "../src/international/schema";

const now = new Date("2026-10-09T10:00:00.000Z");
const source: ResearchSource = { title: "Department of Energy", url: "https://www.energy.gov/solar",
  authorityHost: "www.energy.gov", sourceDate: null, checkedAt: now.toISOString(),
  contentSha256: "a".repeat(64), verificationStatus: "LIVE_RESEARCHED" };
const locator: CountryLocator = { locate: async () => ({ countryCode: "US", region: "California", regionCode: "CA" }) };
const discovery: Discovery = { configured: true, search: async () => [] };
const cache = { get: vi.fn(async () => undefined), put: vi.fn(async () => true) } as unknown as ResearchCache;
const page = vi.fn(async () => ({ source, cacheAllowed: true }));
function service(loc: CountryLocator = locator, find: Discovery = discovery) {
  return new InternationalResearchService(loc, find, cache, () => now, page);
}

describe("international research jurisdiction and claims", () => {
  it("returns live official metadata for a country, without amount or eligibility claims", async () => {
    const response = await service().research({ countryCode: "US" }, "req-1");
    expect(response).toMatchObject({ status: "LIVE_RESEARCHED", jurisdiction: { countryCode: "US", origin: "EXPLICIT" },
      coverage: { complete: false }, sources: [source], notCurated: true,
      eligibilityEvaluated: false, benefitAmountAvailable: false, cache: { status: "MISS" } });
    expect(response).not.toHaveProperty("benefitAmount");
    expect(response).not.toHaveProperty("subsidyRupees");
    expect(response).not.toHaveProperty("eligibleAmount");
  });

  it("marks unsupported countries, Northern Ireland and unverified region/utility scope clearly", async () => {
    expect((await service().research({ countryCode: "CA" }, "req-2")).coverage.reasonCodes)
      .toContain("AUTHORITY_REGISTRY_UNAVAILABLE");
    expect((await service().research({ countryCode: "GB", region: "Northern Ireland" }, "req-3")).coverage.reasonCodes)
      .toContain("NORTHERN_IRELAND_OUT_OF_SCOPE");
    const scoped = await service().research({ countryCode: "US", region: "CA", utility: "Example Utility" }, "req-4");
    expect(scoped.status).toBe("INCOMPLETE");
    expect(scoped.coverage.reasonCodes).toContain("UTILITY_RELEVANCE_UNVERIFIED");
    await expect(service().research({ countryCode: "IN" }, "req-5"))
      .rejects.toMatchObject({ code: "INDIA_USE_CURATED_POLICY", statusCode: 422 });
  });

  it("checks location against explicit country and accepts region code or name without caching geocode", async () => {
    await expect(service().research({ countryCode: "GB", location: { latitude: 37, longitude: -122 } }, "req-6"))
      .rejects.toMatchObject({ code: "LOCATION_JURISDICTION_MISMATCH" });
    const before = vi.mocked(cache.put).mock.calls.length;
    const response = await service().research({ location: { latitude: 37, longitude: -122 }, region: "CA" }, "req-7");
    expect(response).toMatchObject({ jurisdiction: { countryCode: "US", region: "California", origin: "AMAZON_LOCATION" },
      cache: { status: "NOT_STORED" }, status: "INCOMPLETE" });
    expect(vi.mocked(cache.put).mock.calls).toHaveLength(before);
  });

  it("degrades search and cache failures without inventing source evidence", async () => {
    const failing = { configured: true, search: async () => { throw new Error("offline"); } };
    const brokenCache = { get: async () => { throw new Error("offline"); }, put: async () => { throw new Error("offline"); } } as unknown as ResearchCache;
    const response = await new InternationalResearchService(locator, failing, brokenCache, () => now,
      async () => { throw new Error("official unavailable"); }).research({ countryCode: "US" }, "req-8");
    expect(response).toMatchObject({ status: "UNAVAILABLE", sources: [], cache: { status: "MISS" } });
    expect(response.coverage.reasonCodes).toEqual(expect.arrayContaining([
      "CACHE_UNAVAILABLE", "SEARCH_UNAVAILABLE", "OFFICIAL_PAGE_UNAVAILABLE",
    ]));
  });

  it("does not persist citations from an official no-store page", async () => {
    const before = vi.mocked(cache.put).mock.calls.length;
    const response = await new InternationalResearchService(locator, discovery, cache, () => now,
      async () => ({ source, cacheAllowed: false })).research({ countryCode: "GB" }, "req-9");
    expect(response).toMatchObject({ status: "INCOMPLETE", cache: { status: "NOT_STORED" }, expiresAt: null });
    expect(vi.mocked(cache.put).mock.calls).toHaveLength(before);
  });
  it("does not persist mixed cacheable and no-store official citations", async () => {
    const before = vi.mocked(cache.put).mock.calls.length;
    const twoPages: Discovery = { configured: true, search: async () => ["https://www.energy.gov/solar"] };
    const response = await new InternationalResearchService(locator, twoPages, cache, () => now,
      async url => ({ source: { ...source, url }, cacheAllowed: url.endsWith("/solar") === false }))
      .research({ countryCode: "US" }, "req-10");
    expect(response.sources).toHaveLength(2);
    expect(response).toMatchObject({ cache: { status: "NOT_STORED" }, expiresAt: null });
    expect(vi.mocked(cache.put).mock.calls).toHaveLength(before);
  });
});

describe("pinned official fetch", () => {
  const base: OfficialPageDependencies = {
    resolve: async () => [{ address: "8.8.8.8", family: 4 }],
    pinnedRequest: async url => url.endsWith("/robots.txt")
      ? { status: 200, headers: { "content-type": "text/plain" }, bytes: Buffer.from("User-agent: *\nAllow: /") }
      : { status: 200, headers: { "content-type": "text/html" }, bytes: Buffer.from("<html><head><title>Official solar page</title></head><body><p>Solar information</p></body></html>") },
  };
  it("accepts only the reviewed official host with public DNS and checked page bytes", async () => {
    expect(await fetchOfficialPage("https://www.energy.gov/solar", "US", now.toISOString(), base))
      .toMatchObject({ source: { title: "Official solar page", authorityHost: "www.energy.gov", sourceDate: null }, cacheAllowed: true });
    await expect(fetchOfficialPage("https://www.energy.gov.evil.test/solar", "US", now.toISOString(), base))
      .rejects.toThrow("UNREVIEWED_HOST");
    await expect(fetchOfficialPage("http://www.energy.gov/solar", "US", now.toISOString(), base))
      .rejects.toThrow("UNREVIEWED_HOST");
  });
  it("rejects private DNS, robots denial and cross-host redirects", async () => {
    await expect(fetchOfficialPage("https://www.energy.gov/solar", "US", now.toISOString(),
      { ...base, resolve: async () => [{ address: "127.0.0.1", family: 4 }] })).rejects.toThrow("UNSAFE_DNS");
    await expect(fetchOfficialPage("https://www.energy.gov/solar", "US", now.toISOString(),
      { ...base, pinnedRequest: async url => url.endsWith("robots.txt")
        ? { status: 200, headers: { "content-type": "text/plain" }, bytes: Buffer.from("User-agent: *\nDisallow: /") }
        : { status: 200, headers: { "content-type": "text/html" }, bytes: Buffer.from("<html><body>solar</body></html>") } }))
      .rejects.toThrow("ROBOTS_RESTRICTED");
    await expect(fetchOfficialPage("https://www.energy.gov/solar", "US", now.toISOString(),
      { ...base, pinnedRequest: async url => url.endsWith("robots.txt")
        ? { status: 404, headers: {}, bytes: new Uint8Array() }
        : { status: 302, headers: { location: "https://evil.test/" }, bytes: new Uint8Array() } }))
      .rejects.toThrow("UNSAFE_REDIRECT");
  });
  it("allows a current citation from a no-store official page but forbids cache persistence", async () => {
    const fetched = await fetchOfficialPage("https://www.energy.gov/solar", "US", now.toISOString(), {
      ...base, pinnedRequest: async url => url.endsWith("robots.txt")
        ? { status: 404, headers: {}, bytes: new Uint8Array() }
        : { status: 200, headers: { "content-type": "text/html", "cache-control": "no-store, no-cache" },
          bytes: Buffer.from("<html><head><title>Official page</title></head><body>Current page</body></html>") },
    });
    expect(fetched).toMatchObject({ cacheAllowed: false, source: { verificationStatus: "LIVE_RESEARCHED" } });
  });
});

describe("transient official discovery", () => {
  it("sends generic country and reviewed-host terms, never user-entered utility or region", async () => {
    const fetcher = vi.fn(async (input: URL | RequestInfo) => {
      const url = new URL(String(input));
      expect(url.hostname).toBe("api.search.brave.com");
      expect(url.searchParams.get("q")).toContain("site:www.energy.gov");
      expect(url.searchParams.get("q")).not.toMatch(/California|Private Utility/);
      return new Response(JSON.stringify({ web: { results: [
        { url: "https://www.energy.gov/solar", title: "California solar" },
        { url: "https://www.energy.gov.evil.test/solar", title: "Solar" },
      ] } }), { headers: { "content-type": "application/json" } });
    });
    const search = new BraveOfficialDiscovery("server-only-key", fetcher as typeof fetch);
    expect(await search.search("US", "California", "Private Utility")).toEqual(["https://www.energy.gov/solar"]);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(new BraveOfficialDiscovery(undefined).configured).toBe(false);
  });
});

describe("temporary research cache", () => {
  it("uses a TTL conditional write and rejects expired or malformed stored evidence", async () => {
    const records = new Map<string, Record<string, unknown>>();
    const execute: CoreExecutor = async command => {
      if (command instanceof GetCommand) return { Item: records.get(String(command.input.Key?.PK)) };
      if (command instanceof PutCommand) {
        const item = command.input.Item as Record<string, unknown>;
        records.set(String(item.PK), item);
        expect(command.input.ConditionExpression).toContain("expiresAtEpochSeconds <= :now");
        return {};
      }
      throw new Error("unexpected command");
    };
    const store = new ResearchCache("core", execute);
    const hash = "b".repeat(64);
    const response: ResearchResponse = { schemaVersion: 1, source: "LIVE_AUTHORITY_RESEARCH_V1",
      requestId: "r", status: "LIVE_RESEARCHED", jurisdiction: { countryCode: "US", region: null, utility: null, origin: "EXPLICIT" },
      researchedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 3_600_000).toISOString(),
      cache: { status: "MISS", version: 1 }, coverage: { complete: false, reasonCodes: ["LIMITED_AUTHORITY_REGISTRY"] },
      sources: [source], notCurated: true, eligibilityEvaluated: false, benefitAmountAvailable: false };
    expect(await store.put(hash, response, Math.floor(now.getTime() / 1_000))).toBe(true);
    expect((await store.get(hash, Math.floor(now.getTime() / 1_000)))?.sources).toEqual([source]);
    expect(await store.get(hash, Math.floor(now.getTime() / 1_000) + 3_601)).toBeUndefined();
    const record = records.get(`INTL_RESEARCH#${hash}`)!;
    records.set(`INTL_RESEARCH#${hash}`, { ...record, responseJson: JSON.stringify({ ...response,
      sources: [{ ...source, url: "https://www.energy.gov.evil.test/solar" }] }) });
    expect(await store.get(hash, Math.floor(now.getTime() / 1_000))).toBeUndefined();
  });
});
