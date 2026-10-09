import { authorityRegistry, officialUrl, type SupportedCountry } from "./registry";

export interface Discovery { readonly configured: boolean; search(country: SupportedCountry, region: string | null,
  utility: string | null): Promise<string[]> }

/** Search is discovery only. Every candidate is rechecked by officialUrl and the pinned page fetcher. */
export class BraveOfficialDiscovery implements Discovery {
  constructor(private readonly apiKey: string | undefined, private readonly fetcher: typeof fetch = fetch) {}
  get configured() { return !!this.apiKey; }

  async search(country: SupportedCountry, region: string | null, utility: string | null): Promise<string[]> {
    if (!this.apiKey) return [];
    const host = authorityRegistry[country].host;
    // User-entered region and utility never leave our backend. The search provider
    // only receives a generic country-scoped query and a reviewed official host.
    const terms = `rooftop solar government incentive site:${host}`;
    const url = new URL("https://api.search.brave.com/res/v1/web/search");
    url.search = new URLSearchParams({ q: terms.slice(0, 450), country, count: "5", safesearch: "strict" }).toString();
    const response = await this.fetcher(url, {
      method: "GET", redirect: "error", signal: AbortSignal.timeout(4_000),
      headers: { Accept: "application/json", "X-Subscription-Token": this.apiKey },
    });
    if (!response.ok || !response.headers.get("content-type")?.toLowerCase().includes("application/json")) throw new Error("SEARCH_UNAVAILABLE");
    const length = Number(response.headers.get("content-length") ?? 0);
    if (length > 200_000) throw new Error("SEARCH_RESPONSE_TOO_LARGE");
    const reader = response.body?.getReader();
    if (!reader) throw new Error("SEARCH_RESPONSE_INVALID");
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        total += next.value.byteLength;
        if (total > 200_000) throw new Error("SEARCH_RESPONSE_TOO_LARGE");
        chunks.push(next.value);
      }
    } finally { await reader.cancel().catch(() => undefined); }
    const data: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
    if (!data || typeof data !== "object" || !("web" in data) || !data.web || typeof data.web !== "object" ||
      !("results" in data.web) || !Array.isArray(data.web.results)) throw new Error("SEARCH_RESPONSE_INVALID");
    const tokens = [region, utility].filter((value): value is string => !!value)
      .flatMap(value => value.toLowerCase().split(/\W+/).filter(token => token.length >= 3));
    const candidates = data.web.results.slice(0, 5).flatMap(item => {
      if (!item || typeof item !== "object" || !("url" in item) || typeof item.url !== "string") return [];
      const url = officialUrl(item.url, country);
      if (!url) return [];
      const title = "title" in item && typeof item.title === "string" ? item.title : "";
      const haystack = `${title} ${new URL(url).pathname}`.toLowerCase();
      return [{ url, score: tokens.filter(token => haystack.includes(token)).length }];
    });
    return [...new Map(candidates.sort((a, b) => b.score - a.score).map(item => [item.url, item])).values()]
      .slice(0, 2).map(item => item.url);
  }
}
