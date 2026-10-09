import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { isIP } from "node:net";
import { evaluateOfficialRobots, isPublicPolicyAddress } from "@solarsaathi/policy";
import { extractHtmlDocument } from "@solarsaathi/policy";
import { authorityRegistry, officialUrl, type SupportedCountry } from "./registry";
import type { ResearchSource } from "./schema";

export interface FetchedOfficialPage { source: ResearchSource; cacheAllowed: boolean }

const USER_AGENT = "SolarSaathiPolicyBot/1.0";
const MAX_HTML_BYTES = 350_000;
const MAX_ROBOTS_BYTES = 100_000;
const REQUEST_TIMEOUT_MS = 4_500;

type PinnedResult = { status: number; headers: Record<string, string | undefined>; bytes: Uint8Array };
export interface OfficialPageDependencies {
  resolve?: (host: string) => Promise<readonly { address: string; family: 4 | 6 }[]>;
  pinnedRequest?: (url: string, address: { address: string; family: 4 | 6 }, maxBytes: number,
    signal: AbortSignal) => Promise<PinnedResult>;
}

function ip(value: string) { return isIP(value) === 6 ? new URL(`https://[${value}]/`).hostname : value; }
async function defaultPinnedRequest(url: string, address: { address: string; family: 4 | 6 },
  maxBytes: number, signal: AbortSignal): Promise<PinnedResult> {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const req = request(target, {
      method: "GET", agent: false, signal, servername: target.hostname, family: address.family,
      lookup(hostname, _options, callback) {
        if (hostname !== target.hostname) return callback(new Error("HOST_MISMATCH"), "", 4);
        callback(null, address.address, address.family);
      },
      headers: { "User-Agent": USER_AGENT, Accept: "text/html,text/plain", "Accept-Encoding": "identity" },
    }, response => {
      const length = response.headers["content-length"];
      if (response.headers["content-encoding"] && response.headers["content-encoding"] !== "identity" ||
          typeof length === "string" && (!/^\d+$/.test(length) || Number(length) > maxBytes)) {
        req.destroy(new Error("SIZE_OR_ENCODING")); return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      response.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > maxBytes) { req.destroy(new Error("SIZE_LIMIT")); return; }
        chunks.push(chunk);
      });
      response.on("end", () => resolve({ status: response.statusCode ?? 0,
        headers: {
          location: typeof response.headers.location === "string" ? response.headers.location : undefined,
          "content-type": typeof response.headers["content-type"] === "string" ? response.headers["content-type"] : undefined,
          "last-modified": typeof response.headers["last-modified"] === "string" ? response.headers["last-modified"] : undefined,
          "cache-control": typeof response.headers["cache-control"] === "string" ? response.headers["cache-control"] : undefined,
          "x-robots-tag": typeof response.headers["x-robots-tag"] === "string" ? response.headers["x-robots-tag"] : undefined,
        }, bytes: Buffer.concat(chunks, size) }));
      response.on("error", reject);
    });
    req.on("socket", socket => socket.once("secureConnect", () => {
      if (!socket.remoteAddress || ip(socket.remoteAddress) !== ip(address.address)) req.destroy(new Error("PIN_MISMATCH"));
    }));
    req.on("error", reject);
    req.end();
  });
}

async function fetchPinned(url: string, maxBytes: number, dependencies: OfficialPageDependencies,
  signal: AbortSignal): Promise<PinnedResult> {
  if (signal.aborted) throw new Error("FETCH_TIMEOUT");
  const host = new URL(url).hostname;
  const addresses = await Promise.race([
    (dependencies.resolve ?? (async name =>
      (await lookup(name, { all: true, verbatim: true })).map(item => ({ address: item.address, family: item.family as 4 | 6 }))))(host),
    new Promise<never>((_, reject) => signal.addEventListener("abort", () => reject(new Error("DNS_TIMEOUT")), { once: true })),
  ]);
  if (addresses.length === 0 || addresses.some(item => item.family !== isIP(item.address) || !isPublicPolicyAddress(item.address))) {
    throw new Error("UNSAFE_DNS");
  }
  const response = await (dependencies.pinnedRequest ?? defaultPinnedRequest)(url, addresses[0]!, maxBytes, signal);
  if (response.bytes.length > maxBytes || !Number.isInteger(response.status) || response.status < 100 || response.status > 599) {
    throw new Error("INVALID_RESPONSE");
  }
  return response;
}

function safeDate(value: string | undefined, checkedAt: string): string | null {
  if (!value || value.length > 100) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp <= Date.parse(checkedAt) + 86_400_000
    ? new Date(timestamp).toISOString() : null;
}

/** Exact official host, public DNS, pinned TLS socket, robots and byte/time limits. */
export async function fetchOfficialPage(rawUrl: string, country: SupportedCountry,
  checkedAt: string, dependencies: OfficialPageDependencies = {}): Promise<FetchedOfficialPage> {
  const start = officialUrl(rawUrl, country);
  if (!start) throw new Error("UNREVIEWED_HOST");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const host = authorityRegistry[country].host;
    const robots = await fetchPinned(`https://${host}/robots.txt`, MAX_ROBOTS_BYTES, dependencies, controller.signal);
    if (robots.status !== 200 && robots.status !== 404 && robots.status !== 410) throw new Error("ROBOTS_UNAVAILABLE");
    if (robots.status === 200 && !robots.headers["content-type"]?.toLowerCase().startsWith("text/plain")) throw new Error("ROBOTS_INVALID");
    const robotsText = robots.status === 200 ? new TextDecoder("utf-8", { fatal: true }).decode(robots.bytes) : "";
    let url = start;
    for (let redirect = 0; redirect < 3; redirect++) {
      const policy = evaluateOfficialRobots(robotsText, url);
      if (!policy.allowed || policy.crawlDelaySeconds > 0) throw new Error("ROBOTS_RESTRICTED");
      const response = await fetchPinned(url, MAX_HTML_BYTES, dependencies, controller.signal);
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const next = response.headers.location && officialUrl(new URL(response.headers.location, url).toString(), country);
        if (!next) throw new Error("UNSAFE_REDIRECT");
        url = next; continue;
      }
      if (response.status !== 200 || !response.headers["content-type"]?.toLowerCase().startsWith("text/html")) {
        throw new Error("PAGE_UNAVAILABLE");
      }
      const html = new TextDecoder("utf-8", { fatal: true }).decode(response.bytes);
      const title = extractHtmlDocument(html, { maxNodes: 12_000, maxParts: 1_000, maxTextCharacters: 300_000 }).title;
      const directives = `${response.headers["cache-control"] ?? ""} ${response.headers["x-robots-tag"] ?? ""}`;
      return { cacheAllowed: !/\b(?:noarchive|no-store|no-cache|private|max-age=0)\b/i.test(directives), source: {
        title: title?.slice(0, 180) || authorityRegistry[country].label, url, authorityHost: host,
        sourceDate: safeDate(response.headers["last-modified"], checkedAt), checkedAt,
        contentSha256: createHash("sha256").update(response.bytes).digest("hex"),
        verificationStatus: "LIVE_RESEARCHED" } };
    }
    throw new Error("TOO_MANY_REDIRECTS");
  } finally { clearTimeout(timeout); }
}
