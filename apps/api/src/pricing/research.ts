import { createHash } from "node:crypto";
import type { InverterType, ModuleClass, PriceBenchmarkV1 } from "@solarsaathi/calculations";
import type { FetchedPageText } from "../international/fetch";
import type { WebSearch } from "./brave";
import { authorityTierForHost, isAllowedResearchHost, TIER_ORDER } from "./domains";
import { extractPrices } from "./extract";
import { INDIAN_REGIONS, type RegionCode } from "./states";
import { PriceBenchmarkStore, SYSTEM_RESEARCH_ACTOR } from "./store";

export const RESEARCH_MAX_PAGES = 3;
export const RESEARCH_CANDIDATE_TTL_DAYS = 60;
const MAX_CANDIDATES_PER_PAGE = 3;
const NATIONAL_HOSTS = new Set(["mnre.gov.in", "pmsuryaghar.gov.in", "seci.co.in"]);
const DEFAULT_BANDS: ReadonlyArray<{ minKw: number; maxKw: number }> = [
  { minKw: 1, maxKw: 2 }, { minKw: 2, maxKw: 3 }, { minKw: 3, maxKw: 5 }, { minKw: 5, maxKw: 10 }];

export interface ResearchRequest { state: RegionCode; sizeKw: number; moduleClass: ModuleClass; inverterType: InverterType }
export interface ResearchCandidateSummary {
  benchmarkId: string; created: boolean; publisher: string; authorityTier: PriceBenchmarkV1["source"]["authorityTier"];
  sourceUrl: string; title: string; rupeesPerKw: PriceBenchmarkV1["rupeesPerKw"]; sizeBand: PriceBenchmarkV1["sizeBand"];
  moduleClass: ModuleClass; scope: PriceBenchmarkV1["scope"]; publishedOn: string; notes: string[];
}
export interface ResearchOutcome {
  status: "OK" | "SEARCH_NOT_CONFIGURED" | "SEARCH_UNAVAILABLE";
  query: string; pagesRead: number; pagesFailed: number; candidates: ResearchCandidateSummary[];
}

/** Query text is built only from fixed templates and an enumerated state name: no user or page text is interpolated. */
export function buildResearchQuery(request: ResearchRequest, now: Date): string {
  const name = INDIAN_REGIONS[request.state];
  return `rooftop solar system price per kW ${name} ${now.getUTCFullYear()}${request.moduleClass === "DCR" ? " DCR" : ""}`;
}

export class PriceResearchService {
  constructor(private readonly store: PriceBenchmarkStore, private readonly search: WebSearch,
    private readonly fetchPage: (url: string, checkedAt: string) => Promise<FetchedPageText>,
    private readonly now: () => Date = () => new Date()) {}

  async research(request: ResearchRequest): Promise<ResearchOutcome> {
    const now = this.now();
    const query = buildResearchQuery(request, now);
    const empty = { query, pagesRead: 0, pagesFailed: 0, candidates: [] as ResearchCandidateSummary[] };
    if (!this.search.configured) return { status: "SEARCH_NOT_CONFIGURED", ...empty };
    let results;
    try { results = await this.search.search(query); } catch { return { status: "SEARCH_UNAVAILABLE", ...empty }; }
    const eligible = results.flatMap(item => {
      try {
        const url = new URL(item.url);
        const tier = url.protocol === "https:" && isAllowedResearchHost(url.hostname) ? authorityTierForHost(url.hostname) : undefined;
        return tier ? [{ url: url.toString(), host: url.hostname.replace(/^www\./, ""), tier }] : [];
      } catch { return []; }
    }).sort((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier])
      .filter((item, index, all) => all.findIndex(other => other.url === item.url) === index)
      .slice(0, RESEARCH_MAX_PAGES);

    const summaries: ResearchCandidateSummary[] = [];
    let pagesRead = 0, pagesFailed = 0;
    for (const page of eligible) {
      let fetched: FetchedPageText;
      try { fetched = await this.fetchPage(page.url, now.toISOString()); pagesRead++; }
      catch { pagesFailed++; continue; }
      // Page text is untrusted data. It is parsed by regex only and is never forwarded to a model.
      const extracted = extractPrices(fetched.text, { now, pageDate: fetched.sourceDate }).slice(0, MAX_CANDIDATES_PER_PAGE);
      for (const price of extracted) {
        const notes: string[] = ["Extracted automatically; unverified until a policy administrator approves it."];
        const sizeBand = price.sizeBand ?? DEFAULT_BANDS.find(band => request.sizeKw >= band.minKw && request.sizeKw <= band.maxKw) ??
          { minKw: request.sizeKw, maxKw: request.sizeKw };
        if (!price.sizeBand) notes.push("System size band was not stated in the source; assumed from the request.");
        const moduleClass = price.moduleClass ?? request.moduleClass;
        if (!price.moduleClass) notes.push("Module class was not stated in the source; assumed from the request.");
        const national = NATIONAL_HOSTS.has(page.host);
        if (!national) notes.push("Scope was assumed to be the requested state; confirm against the source.");
        if (price.context === "PAGE_DATE") notes.push("Date is the page's Last-Modified header, not a date stated beside the figure.");
        const typical = Math.round((price.rupeesPerKwMin + price.rupeesPerKwMax) / 2);
        const idSource = [page.url, price.rupeesPerKwMin, price.rupeesPerKwMax, moduleClass, sizeBand.minKw, sizeBand.maxKw].join("|");
        const benchmark: PriceBenchmarkV1 = { schemaVersion: 1, benchmarkId: `PB-${createHash("sha256").update(idSource).digest("hex").slice(0, 24)}`,
          scope: national ? { level: "NATIONAL" } : { level: "STATE", state: request.state }, sizeBand, moduleClass,
          inverterType: "UNSPECIFIED", rupeesPerKw: { min: price.rupeesPerKwMin, typical, max: price.rupeesPerKwMax },
          inclusions: [], exclusions: [], source: { url: fetched.url, publisher: page.host, authorityTier: page.tier,
            ...(fetched.title ? { title: fetched.title.split("").map(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 ? " " : char).join("").trim().slice(0, 180) } : {}) },
          publishedOn: price.publishedOn, lastCheckedAt: now.toISOString(),
          expiresAt: new Date(now.getTime() + RESEARCH_CANDIDATE_TTL_DAYS * 86_400_000).toISOString(), status: "CANDIDATE" };
        if (benchmark.source.title === "") delete benchmark.source.title;
        try {
          const { stored, created } = await this.store.createCandidate(benchmark, { createdBy: SYSTEM_RESEARCH_ACTOR, researchNotes: notes });
          summaries.push({ benchmarkId: stored.benchmark.benchmarkId, created, publisher: page.host, authorityTier: page.tier,
            sourceUrl: stored.benchmark.source.url, title: stored.benchmark.source.title ?? page.host,
            rupeesPerKw: stored.benchmark.rupeesPerKw, sizeBand: stored.benchmark.sizeBand, moduleClass: stored.benchmark.moduleClass,
            scope: stored.benchmark.scope, publishedOn: stored.benchmark.publishedOn, notes });
        } catch { pagesFailed++; }
      }
    }
    return { status: "OK", query, pagesRead, pagesFailed, candidates: summaries };
  }
}
