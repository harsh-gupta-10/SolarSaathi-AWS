/** Bounded Brave Search client for price research. Only result URLs and titles are read; snippets are discarded. */
export interface WebSearchResult { url: string; title: string }
export interface WebSearch { readonly configured: boolean; search(query: string): Promise<WebSearchResult[]> }

const MAX_RESPONSE_BYTES = 200_000;

export class BraveWebSearch implements WebSearch {
  constructor(private readonly apiKey: string | undefined, private readonly fetcher: typeof fetch = fetch) {}
  get configured() { return !!this.apiKey; }

  async search(query: string): Promise<WebSearchResult[]> {
    if (!this.apiKey) return [];
    const url = new URL("https://api.search.brave.com/res/v1/web/search");
    url.search = new URLSearchParams({ q: query.slice(0, 400), country: "IN", count: "10", safesearch: "strict" }).toString();
    const response = await this.fetcher(url, { method: "GET", redirect: "error", signal: AbortSignal.timeout(4_000),
      headers: { Accept: "application/json", "X-Subscription-Token": this.apiKey } });
    if (!response.ok || !response.headers.get("content-type")?.toLowerCase().includes("application/json")) throw new Error("SEARCH_UNAVAILABLE");
    if (Number(response.headers.get("content-length") ?? 0) > MAX_RESPONSE_BYTES) throw new Error("SEARCH_RESPONSE_TOO_LARGE");
    const reader = response.body?.getReader();
    if (!reader) throw new Error("SEARCH_RESPONSE_INVALID");
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        total += next.value.byteLength;
        if (total > MAX_RESPONSE_BYTES) throw new Error("SEARCH_RESPONSE_TOO_LARGE");
        chunks.push(next.value);
      }
    } finally { await reader.cancel().catch(() => undefined); }
    const data: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
    const results = (data as { web?: { results?: unknown } } | null)?.web?.results;
    if (!Array.isArray(results)) throw new Error("SEARCH_RESPONSE_INVALID");
    return results.slice(0, 10).flatMap(item => {
      const record = item as { url?: unknown; title?: unknown } | null;
      return record && typeof record.url === "string" ? [{ url: record.url, title: typeof record.title === "string" ? record.title.slice(0, 180) : "" }] : [];
    });
  }
}
