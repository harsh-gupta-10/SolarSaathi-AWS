import { createHash } from "node:crypto";
import { GeoPlacesClient, ReverseGeocodeCommand } from "@aws-sdk/client-geo-places";
import { RequestError } from "../lib/http";
import { fetchOfficialPage, type OfficialPageDependencies } from "./fetch";
import { authorityRegistry, REGISTRY_VERSION, supportedCountry, type SupportedCountry } from "./registry";
import type { ResearchInput, ResearchResponse, ResearchSource } from "./schema";
import type { ResearchCache } from "./cache";
import type { Discovery } from "./search";

export interface CountryLocator {
  locate(latitude: number, longitude: number): Promise<{ countryCode: string; region: string | null; regionCode?: string | null } | null>;
}

export class AmazonCountryLocator implements CountryLocator {
  private readonly client: GeoPlacesClient;
  constructor(region: string) { this.client = new GeoPlacesClient({ region, maxAttempts: 2,
    requestHandler: { connectionTimeout: 1_000, requestTimeout: 3_000 } }); }
  async locate(latitude: number, longitude: number) {
    const response = await this.client.send(new ReverseGeocodeCommand({
      QueryPosition: [longitude, latitude], QueryRadius: 1_000, MaxResults: 1, IntendedUse: "SingleUse",
    }), { abortSignal: AbortSignal.timeout(4_000) });
    const item = response.ResultItems?.[0];
    if (!item || typeof item.Distance !== "number" || !Number.isFinite(item.Distance) || item.Distance > 1_000) return null;
    const address = item.Address;
    const countryCode = address?.Country?.Code2;
    if (!countryCode || !/^[A-Z]{2}$/.test(countryCode)) return null;
    return { countryCode, region: address?.Region?.Name ?? address?.Region?.Code ?? null,
      regionCode: address?.Region?.Code ?? null };
  }
}

function result(input: { countryCode: string; region: string | null; utility: string | null;
  origin: "EXPLICIT" | "AMAZON_LOCATION" }, requestId: string, now: Date,
  status: ResearchResponse["status"], sources: ResearchSource[], reasonCodes: string[],
  cacheStatus: ResearchResponse["cache"]["status"], expiresAt: string | null): ResearchResponse {
  return { schemaVersion: 1, source: "LIVE_AUTHORITY_RESEARCH_V1", requestId, status,
    jurisdiction: input, researchedAt: now.toISOString(), expiresAt,
    cache: { status: cacheStatus, version: 1 }, coverage: { complete: false, reasonCodes }, sources,
    notCurated: true, eligibilityEvaluated: false, benefitAmountAvailable: false };
}

function sameRegion(left: string, right: string) {
  return left.trim().toLocaleLowerCase("en") === right.trim().toLocaleLowerCase("en");
}

export class InternationalResearchService {
  constructor(private readonly locator: CountryLocator, private readonly discovery: Discovery,
    private readonly cache: ResearchCache, private readonly now: () => Date = () => new Date(),
    private readonly page: typeof fetchOfficialPage = fetchOfficialPage,
    private readonly pageDependencies: OfficialPageDependencies = {}) {}

  async research(input: ResearchInput, requestId: string): Promise<ResearchResponse> {
    const now = this.now();
    let countryCode = input.countryCode ?? "ZZ";
    let region = input.region ?? null;
    const origin = input.location ? "AMAZON_LOCATION" : "EXPLICIT";
    if (input.location) {
      let location: Awaited<ReturnType<CountryLocator["locate"]>>;
      try { location = await this.locator.locate(input.location.latitude, input.location.longitude); }
      catch { location = null; }
      if (!location) {
        return result({ countryCode, region, utility: input.utility ?? null, origin }, requestId, now,
          "UNAVAILABLE", [], ["LOCATION_UNAVAILABLE"], "NOT_STORED", null);
      }
      if (input.countryCode && input.countryCode !== location.countryCode) {
        throw new RequestError(422, "LOCATION_JURISDICTION_MISMATCH", "The selected country differs from the shared location.");
      }
      if (input.region && location.region && !sameRegion(input.region, location.region) &&
        (!location.regionCode || !sameRegion(input.region, location.regionCode))) {
        throw new RequestError(422, "LOCATION_JURISDICTION_MISMATCH", "The selected region differs from the shared location.");
      }
      countryCode = location.countryCode;
      region = location.region ?? region;
    }
    if (countryCode === "IN") {
      throw new RequestError(422, "INDIA_USE_CURATED_POLICY", "Use the verified India policy workflow for this jurisdiction.");
    }
    const jurisdiction = { countryCode, region, utility: input.utility ?? null, origin } as const;
    if (!supportedCountry(countryCode)) {
      return result(jurisdiction, requestId, now, "UNAVAILABLE", [], ["AUTHORITY_REGISTRY_UNAVAILABLE"], "NOT_STORED", null);
    }
    // Ofgem's SEG authority covers Great Britain. A Northern Ireland request cannot inherit it.
    if (countryCode === "GB" && region && /^(?:(?:GB-)?NI|(?:GB-)?NIR|northern ireland)$/i.test(region.trim())) {
      return result(jurisdiction, requestId, now, "UNAVAILABLE", [], ["NORTHERN_IRELAND_OUT_OF_SCOPE"], "NOT_STORED", null);
    }
    const cacheable = !input.location;
    const hash = createHash("sha256").update(JSON.stringify({ registry: REGISTRY_VERSION, countryCode,
      region: region?.toLocaleLowerCase("en") ?? null, utility: input.utility?.toLocaleLowerCase("en") ?? null,
    })).digest("hex");
    const nowSeconds = Math.floor(now.getTime() / 1_000);
    let cacheReadUnavailable = false;
    if (cacheable) {
      let cached: ResearchResponse | undefined;
      try { cached = await this.cache.get(hash, nowSeconds); }
      catch { cacheReadUnavailable = true; }
      if (cached && cached.jurisdiction.countryCode === countryCode && cached.jurisdiction.region === region &&
        cached.jurisdiction.utility === jurisdiction.utility) {
        return { ...cached, requestId, cache: { status: "HIT", version: 1 } };
      }
    }
    const reasons = ["LIMITED_AUTHORITY_REGISTRY"];
    if (cacheReadUnavailable) reasons.push("CACHE_UNAVAILABLE");
    if (input.location) reasons.push("LOCATION_APPROXIMATE");
    if (countryCode === "GB" && !region) reasons.push("GREAT_BRITAIN_SCOPE_UNCONFIRMED");
    if (region) reasons.push("REGIONAL_RELEVANCE_UNVERIFIED");
    if (input.utility) reasons.push("UTILITY_RELEVANCE_UNVERIFIED");
    if (!this.discovery.configured) reasons.push("SEARCH_NOT_CONFIGURED");
    const urls: string[] = [authorityRegistry[countryCode].seed];
    try { urls.push(...await this.discovery.search(countryCode as SupportedCountry, region, jurisdiction.utility)); }
    catch { reasons.push("SEARCH_UNAVAILABLE"); }
    const sources: ResearchSource[] = [];
    let sourceCacheAllowed = true;
    for (const url of [...new Set(urls)].slice(0, 2)) {
      try {
        const fetched = await this.page(url, countryCode as SupportedCountry, now.toISOString(), this.pageDependencies);
        sources.push(fetched.source);
        sourceCacheAllowed &&= fetched.cacheAllowed;
      }
      catch { reasons.push("OFFICIAL_PAGE_UNAVAILABLE"); }
    }
    const status = sources.length === 0 ? "UNAVAILABLE" : reasons.some(code =>
      code !== "LIMITED_AUTHORITY_REGISTRY" && code !== "CACHE_UNAVAILABLE")
      ? "INCOMPLETE" : "LIVE_RESEARCHED";
    const expiresAt = sources.length && cacheable && sourceCacheAllowed
      ? new Date(now.getTime() + (status === "LIVE_RESEARCHED" ? 6 : 1) * 3_600_000).toISOString() : null;
    const response = result(jurisdiction, requestId, now, status, sources, [...new Set(reasons)],
      cacheable && sourceCacheAllowed ? "MISS" : "NOT_STORED", expiresAt);
    if (cacheable && sourceCacheAllowed && sources.length) {
      try {
        if (!await this.cache.put(hash, response, nowSeconds)) {
          response.cache.status = "NOT_STORED";
          response.expiresAt = null;
        }
      } catch {
        response.cache.status = "NOT_STORED";
        response.expiresAt = null;
        response.coverage.reasonCodes.push("CACHE_UNAVAILABLE");
      }
    }
    return response;
  }
}
