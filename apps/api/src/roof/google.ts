import type { RoofPoint } from "@solarsaathi/types";
import { RequestError } from "../lib/http";

const MAX_GOOGLE_RESPONSE_BYTES = 2_000_000;
const GOOGLE_TIMEOUT_MS = 4_000;
type Fetcher = typeof fetch;

async function readJson(response: Response): Promise<unknown> {
  const size = response.headers.get("content-length");
  if (size && Number(size) > MAX_GOOGLE_RESPONSE_BYTES) throw new RequestError(502, "GOOGLE_RESPONSE_INVALID", "Google returned roof data that could not be verified.");
  if (!response.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    throw new RequestError(502, "GOOGLE_RESPONSE_INVALID", "Google returned roof data that could not be verified.");
  }
  if (!response.body) throw new RequestError(502, "GOOGLE_RESPONSE_INVALID", "Google returned roof data that could not be verified.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_GOOGLE_RESPONSE_BYTES) throw new RequestError(502, "GOOGLE_RESPONSE_INVALID", "Google returned roof data that could not be verified.");
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => undefined); }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))); }
  catch { throw new RequestError(502, "GOOGLE_RESPONSE_INVALID", "Google returned roof data that could not be verified."); }
}

async function request(fetcher: Fetcher, url: URL, missingMessage: string, notFound: boolean): Promise<unknown> {
  let response: Response;
  try { response = await fetcher(url, { method: "GET", redirect: "error", signal: AbortSignal.timeout(GOOGLE_TIMEOUT_MS) }); }
  catch { throw new RequestError(503, "GOOGLE_UNAVAILABLE", missingMessage); }
  if (notFound && response.status === 404) throw new RequestError(404, "SOLAR_BUILDING_NOT_FOUND", "No supported building was found here. Select the building again or enter roof measurements manually.");
  if (response.status === 429) throw new RequestError(503, "GOOGLE_QUOTA_EXCEEDED", missingMessage);
  if (!response.ok) throw new RequestError(503, "GOOGLE_UNAVAILABLE", missingMessage);
  return readJson(response);
}

export class GoogleRoofClient {
  constructor(private readonly geocodingKey: string | undefined, private readonly solarKey: string | undefined,
    private readonly fetcher: Fetcher = fetch) {}

  async geocode(address: string): Promise<unknown> {
    if (!this.geocodingKey) throw new RequestError(503, "GOOGLE_NOT_CONFIGURED", "Address lookup is not configured. Enter roof measurements manually.");
    const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
    url.search = new URLSearchParams({ address, key: this.geocodingKey }).toString();
    return request(this.fetcher, url, "Address lookup is temporarily unavailable. Try again later or enter roof measurements manually.", false);
  }

  async buildingInsights(location: RoofPoint): Promise<unknown> {
    if (!this.solarKey) throw new RequestError(503, "GOOGLE_NOT_CONFIGURED", "Roof lookup is not configured. Enter roof measurements manually.");
    const url = new URL("https://solar.googleapis.com/v1/buildingInsights:findClosest");
    url.search = new URLSearchParams({
      "location.latitude": String(location.latitude), "location.longitude": String(location.longitude),
      // BASE is a minimum: Google returns HIGH or MEDIUM imagery whenever it exists, so one call gets the best quality.
      requiredQuality: "BASE", key: this.solarKey,
    }).toString();
    return request(this.fetcher, url, "Roof lookup is temporarily unavailable. Try again later or enter roof measurements manually.", true);
  }
}
