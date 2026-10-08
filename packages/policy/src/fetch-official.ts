import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { isIP } from "node:net";
import { setTimeout as sleep } from "node:timers/promises";
import type { IncomingHttpHeaders } from "node:http";
import { validateOfficialSourceRecord, validateOfficialSourceUrl } from "./sources";
import type { PolicySourceV1 } from "./schema";

const USER_AGENT = "SolarSaathiPolicyBot/1.0";
const MAX_DOCUMENT_BYTES = 2_000_000;
const MAX_ROBOTS_BYTES = 256_000;
const MAX_REDIRECTS = 3;
const MAX_TOTAL_MILLISECONDS = 20_000;
const MAX_CRAWL_DELAY_SECONDS = 10;
const MAX_URL_CHARACTERS = 2_000;
const MAX_ROBOTS_RULES = 2_000;
const MAX_ROBOTS_RULE_CHARACTERS = 500;
const MAX_RETRY_AFTER_SECONDS = 30 * 86_400;

export type OfficialFetchErrorCode =
  | "SOURCE_NOT_CURATED" | "URL_NOT_ALLOWED" | "DNS_UNAVAILABLE" | "UNSAFE_ADDRESS"
  | "PINNED_ADDRESS_MISMATCH" | "NETWORK_FAILURE" | "TIMEOUT" | "TOO_MANY_REDIRECTS"
  | "HTTP_STATUS" | "RATE_LIMITED" | "ROBOTS_UNAVAILABLE" | "ROBOTS_DISALLOWED"
  | "ROBOTS_INVALID" | "ROBOTS_CRAWL_DELAY" | "UNSUPPORTED_CONTENT"
  | "CONTENT_TOO_LARGE" | "INVALID_RESPONSE";

export class OfficialFetchError extends Error {
  constructor(public readonly code: OfficialFetchErrorCode, public readonly statusCode?: number,
    public readonly retryAfterSeconds?: number,
    public readonly retryAfterExceedsCap = false) {
    super(code);
    this.name = "OfficialFetchError";
  }
}

export interface OfficialFetchInput {
  source: PolicySourceV1;
  documentUrl?: string;
  etag?: string;
  lastModified?: string;
}

export interface OfficialDnsAddress {
  address: string;
  family: 4 | 6;
}

export interface PinnedRequestInput {
  url: string;
  address: OfficialDnsAddress;
  headers: Readonly<Record<string, string>>;
  maxBytes: number;
  signal: AbortSignal;
}

export interface PinnedResponse {
  statusCode: number;
  headers: Readonly<Record<string, string | undefined>>;
  bytes: Uint8Array;
}

/** Injection is for deterministic network tests. Production callers omit it. */
export interface OfficialFetchDependencies {
  resolveAddresses?: (hostname: string) => Promise<readonly OfficialDnsAddress[]>;
  requestPinned?: (input: PinnedRequestInput) => Promise<PinnedResponse>;
  pause?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  now?: () => Date;
}

interface FetchResult extends PinnedResponse {
  finalUrl: string;
  redirectTrace: string[];
}

export type OfficialFetchResult =
  | { status: "NOT_MODIFIED"; finalUrl: string; etag?: string; lastModified?: string;
      redirectTrace: string[]; robotsCrawlDelaySeconds: number }
  | { status: "CHANGED"; finalUrl: string; mimeType: "text/html" | "application/pdf";
      bytes: Uint8Array; sha256: string; etag?: string; lastModified?: string;
      redirectTrace: string[]; robotsCrawlDelaySeconds: number };

function ipv4Number(address: string): number | null {
  if (isIP(address) !== 4) return null;
  const octets = address.split(".").map(Number);
  return (((octets[0]! * 0x1000000) + (octets[1]! << 16) + (octets[2]! << 8) + octets[3]!) >>> 0);
}

/** Strict public unicast classification. Reserved and ambiguous ranges fail closed. */
export function isPublicPolicyAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const ip = ipv4Number(address)!;
    const inRange = (network: number, mask: number) => ((ip & mask) >>> 0) === (network >>> 0);
    return !(
      inRange(0x00000000, 0xff000000) || // 0/8
      inRange(0x0a000000, 0xff000000) || // 10/8
      inRange(0x64400000, 0xffc00000) || // 100.64/10
      inRange(0x7f000000, 0xff000000) || // 127/8
      inRange(0xa9fe0000, 0xffff0000) || // 169.254/16
      inRange(0xac100000, 0xfff00000) || // 172.16/12
      inRange(0xc0000000, 0xffffff00) || // 192.0.0/24
      inRange(0xc0000200, 0xffffff00) || // TEST-NET-1
      inRange(0xc0586300, 0xffffff00) || // former relay anycast
      inRange(0xc0a80000, 0xffff0000) || // 192.168/16
      inRange(0xc6120000, 0xfffe0000) || // 198.18/15
      inRange(0xc6336400, 0xffffff00) || // TEST-NET-2
      inRange(0xcb007100, 0xffffff00) || // TEST-NET-3
      inRange(0xe0000000, 0xf0000000) || // multicast
      inRange(0xf0000000, 0xf0000000)    // reserved/future
    );
  }
  if (family === 6) {
    // Only global unicast 2000::/3 is considered, excluding IETF special-use
    // 2001::/23, documentation 2001:db8::/32, and 6to4 2002::/16.
    const normalized = new URL(`https://[${address}]/`).hostname.slice(1, -1).toLowerCase();
    const first = Number.parseInt(normalized.split(":")[0] || "0", 16);
    if (first < 0x2000 || first > 0x3fff) return false;
    if (first === 0x2001) {
      const second = Number.parseInt(normalized.split(":")[1] || "0", 16);
      if (second <= 0x1ff || second === 0xdb8) return false;
    }
    return first !== 0x2002;
  }
  return false;
}

function canonicalIp(address: string): string {
  return isIP(address) === 6 ? new URL(`https://[${address}]/`).hostname : address;
}

function header(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name];
  if (Array.isArray(value)) return value.length === 1 ? value[0] : undefined;
  return value;
}

function selectedHeaders(headers: IncomingHttpHeaders): Record<string, string | undefined> {
  return Object.fromEntries(["location", "content-type", "content-length", "content-encoding", "etag",
    "last-modified", "retry-after", "cache-control", "x-robots-tag"].map(name => [name, header(headers, name)]));
}

async function defaultResolveAddresses(hostname: string): Promise<readonly OfficialDnsAddress[]> {
  const entries = await lookup(hostname, { all: true, verbatim: true });
  return entries.map(entry => ({ address: entry.address, family: entry.family as 4 | 6 }));
}

function defaultRequestPinned(input: PinnedRequestInput): Promise<PinnedResponse> {
  return new Promise((resolve, reject) => {
    const url = new URL(input.url);
    const req = request(url, {
      method: "GET", agent: false, signal: input.signal,
      servername: url.hostname,
      family: input.address.family,
      lookup(hostname, _options, callback) {
        if (hostname !== url.hostname) {
          callback(new OfficialFetchError("PINNED_ADDRESS_MISMATCH"), "", 4);
          return;
        }
        callback(null, input.address.address, input.address.family);
      },
      headers: input.headers,
    }, response => {
      const contentLength = header(response.headers, "content-length");
      const encoding = header(response.headers, "content-encoding");
      if (encoding && encoding.toLowerCase() !== "identity") {
        req.destroy(new OfficialFetchError("UNSUPPORTED_CONTENT"));
        return;
      }
      if (contentLength && (!/^\d+$/.test(contentLength) || Number(contentLength) > input.maxBytes)) {
        req.destroy(new OfficialFetchError("CONTENT_TOO_LARGE"));
        return;
      }
      const chunks: Buffer[] = [];
      let total = 0;
      response.on("data", (chunk: Buffer) => {
        total += chunk.length;
        if (total > input.maxBytes) {
          req.destroy(new OfficialFetchError("CONTENT_TOO_LARGE"));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => resolve({ statusCode: response.statusCode ?? 0,
        headers: selectedHeaders(response.headers), bytes: Buffer.concat(chunks, total) }));
      response.on("error", reject);
    });
    req.on("socket", socket => socket.once("secureConnect", () => {
      if (!socket.remoteAddress || canonicalIp(socket.remoteAddress) !== canonicalIp(input.address.address)) {
        req.destroy(new OfficialFetchError("PINNED_ADDRESS_MISMATCH"));
      }
    }));
    req.on("error", reject);
    req.end();
  });
}

function validator(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (value.length === 0 || value.length > 200 || !/^[\x20-\x7E]+$/.test(value)) {
    throw new OfficialFetchError("INVALID_RESPONSE");
  }
  return value;
}

interface ParsedRetryAfter {
  seconds?: number;
  exceedsCap: boolean;
}

/** Bounded RFC HTTP-date or delta-seconds. A delay beyond the cap requires manual scheduling. */
function parseRetryAfterDetails(value: string | undefined, now: Date): ParsedRetryAfter {
  if (!value || value.length > 100 || !Number.isFinite(now.getTime())) return { exceedsCap: false };
  const trimmed = value.trim();
  let seconds: number;
  if (/^\d+$/.test(trimmed)) {
    seconds = Number(trimmed);
  } else {
    if (!/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(trimmed)) {
      return { exceedsCap: false };
    }
    const deadline = Date.parse(trimmed);
    if (!Number.isFinite(deadline)) return { exceedsCap: false };
    seconds = Math.ceil((deadline - now.getTime()) / 1_000);
  }
  if (!Number.isFinite(seconds)) return { exceedsCap: false };
  return {
    seconds: Math.min(MAX_RETRY_AFTER_SECONDS, Math.max(0, Math.ceil(seconds))),
    exceedsCap: seconds > MAX_RETRY_AFTER_SECONDS,
  };
}

export function parseOfficialRetryAfter(value: string | undefined, now: Date): number | undefined {
  return parseRetryAfterDetails(value, now).seconds;
}

function validateTarget(rawUrl: string, source: PolicySourceV1): string {
  try {
    if (rawUrl.length > MAX_URL_CHARACTERS) throw new Error("URL length");
    const validated = validateOfficialSourceUrl(rawUrl, source.sourceType, source.jurisdiction);
    if (validated.host !== new URL(source.canonicalUrl).hostname ||
        !source.allowedHosts.includes(validated.host)) throw new Error("host");
    return validated.canonicalUrl;
  } catch {
    throw new OfficialFetchError("URL_NOT_ALLOWED");
  }
}

async function pinnedFetch(url: string, maxBytes: number, headers: Record<string, string>,
  signal: AbortSignal, dependencies: OfficialFetchDependencies): Promise<PinnedResponse> {
  if (signal.aborted) throw new OfficialFetchError("TIMEOUT");
  const hostname = new URL(url).hostname;
  let addresses: readonly OfficialDnsAddress[];
  try {
    addresses = await Promise.race([
      (dependencies.resolveAddresses ?? defaultResolveAddresses)(hostname),
      new Promise<never>((_, reject) => signal.addEventListener("abort",
        () => reject(new OfficialFetchError("TIMEOUT")), { once: true })),
    ]);
  } catch (error) {
    if (error instanceof OfficialFetchError) throw error;
    throw new OfficialFetchError("DNS_UNAVAILABLE");
  }
  if (addresses.length === 0) throw new OfficialFetchError("DNS_UNAVAILABLE");
  if (addresses.some(entry => entry.family !== isIP(entry.address) || !isPublicPolicyAddress(entry.address))) {
    throw new OfficialFetchError("UNSAFE_ADDRESS");
  }
  try {
    const response = await (dependencies.requestPinned ?? defaultRequestPinned)({
      url, address: addresses[0]!, headers, maxBytes, signal,
    });
    if (!Number.isInteger(response.statusCode) || response.statusCode < 100 || response.statusCode > 599 ||
        !(response.bytes instanceof Uint8Array)) throw new OfficialFetchError("INVALID_RESPONSE");
    if (response.bytes.length > maxBytes) throw new OfficialFetchError("CONTENT_TOO_LARGE");
    if (response.headers["content-encoding"] && response.headers["content-encoding"] !== "identity") {
      throw new OfficialFetchError("UNSUPPORTED_CONTENT");
    }
    return response;
  } catch (error) {
    if (error instanceof OfficialFetchError) throw error;
    if (signal.aborted) throw new OfficialFetchError("TIMEOUT");
    throw new OfficialFetchError("NETWORK_FAILURE");
  }
}

async function fetchWithRedirects(startUrl: string, source: PolicySourceV1, maxBytes: number,
  headers: Record<string, string>, signal: AbortSignal,
  dependencies: OfficialFetchDependencies, pathGuard?: (url: string) => void): Promise<FetchResult> {
  let url = validateTarget(startUrl, source);
  const redirectTrace: string[] = [];
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect++) {
    pathGuard?.(url);
    const response = await pinnedFetch(url, maxBytes, headers, signal, dependencies);
    if (![301, 302, 303, 307, 308].includes(response.statusCode)) {
      return { ...response, finalUrl: url, redirectTrace };
    }
    if (redirect === MAX_REDIRECTS) throw new OfficialFetchError("TOO_MANY_REDIRECTS");
    const location = response.headers.location;
    if (!location || location.length > 2_000) throw new OfficialFetchError("INVALID_RESPONSE");
    let nextUrl: string;
    try { nextUrl = new URL(location, url).toString(); }
    catch { throw new OfficialFetchError("INVALID_RESPONSE"); }
    url = validateTarget(nextUrl, source);
    redirectTrace.push(url);
  }
  throw new OfficialFetchError("TOO_MANY_REDIRECTS");
}

interface RobotsRule { allow: boolean; pattern: string }
interface RobotsGroup { agents: string[]; rules: RobotsRule[]; crawlDelay?: string }

function robotsMatch(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;
  // Keep existing %-escapes intact while encoding raw non-ASCII rule text.
  const encoded = body.split(/(%[0-9a-fA-F]{2})/g)
    .map(part => /^%[0-9a-fA-F]{2}$/.test(part) ? part.toUpperCase() : encodeURI(part))
    .join("");
  const canonicalPath = path.replace(/%[0-9a-fA-F]{2}/g, escape => escape.toUpperCase());
  const segments = encoded.split("*");
  const first = segments[0]!;
  if (!canonicalPath.startsWith(first)) return false;
  if (segments.length === 1) return !anchored || canonicalPath.length === first.length;
  let position = first.length;
  for (const segment of segments.slice(1, -1)) {
    const found = canonicalPath.indexOf(segment, position);
    if (found < 0) return false;
    position = found + segment.length;
  }
  const last = segments[segments.length - 1]!;
  if (anchored) return canonicalPath.endsWith(last) && canonicalPath.length - last.length >= position;
  return canonicalPath.indexOf(last, position) >= 0;
}

/** Conservative RFC 9309 allow/disallow evaluation plus the common Crawl-delay extension. */
export function evaluateOfficialRobots(text: string, url: string):
  { allowed: boolean; crawlDelaySeconds: number } {
  const groups: RobotsGroup[] = [];
  let current: RobotsGroup | undefined;
  let seenDirective = false;
  let ruleCount = 0;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.split("#", 1)[0]!.trim();
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (key === "user-agent") {
      if (!value) throw new OfficialFetchError("ROBOTS_INVALID");
      if (!current || seenDirective) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      seenDirective = false;
    } else if (current && (key === "allow" || key === "disallow")) {
      seenDirective = true;
      if (value) {
        if (!value.startsWith("/") || value.length > MAX_ROBOTS_RULE_CHARACTERS ||
            ++ruleCount > MAX_ROBOTS_RULES) throw new OfficialFetchError("ROBOTS_INVALID");
        current.rules.push({ allow: key === "allow", pattern: value });
      }
    } else if (current && key === "crawl-delay") {
      seenDirective = true;
      current.crawlDelay = value;
    }
  }
  const agent = USER_AGENT.split("/", 1)[0]!.toLowerCase();
  const specificity = (group: RobotsGroup) => Math.max(-1, ...group.agents.map(value =>
    value === "*" ? 0 : agent.startsWith(value) ? value.length : -1));
  const highest = Math.max(-1, ...groups.map(specificity));
  if (highest < 0) return { allowed: true, crawlDelaySeconds: 0 };
  const selected = groups.filter(group => specificity(group) === highest);
  const delays = selected.map(group => group.crawlDelay).filter((value): value is string => value !== undefined);
  let crawlDelaySeconds = 0;
  for (const value of delays) {
    if (!/^\d+(?:\.\d{1,3})?$/.test(value)) throw new OfficialFetchError("ROBOTS_INVALID");
    crawlDelaySeconds = Math.max(crawlDelaySeconds, Number(value));
  }
  if (crawlDelaySeconds > MAX_CRAWL_DELAY_SECONDS) throw new OfficialFetchError("ROBOTS_CRAWL_DELAY");
  const path = new URL(url).pathname + new URL(url).search;
  const matches = selected.flatMap(group => group.rules).filter(rule => robotsMatch(rule.pattern, path));
  if (matches.length === 0) return { allowed: true, crawlDelaySeconds };
  matches.sort((left, right) => {
    const length = (rule: RobotsRule) => Buffer.byteLength(rule.pattern.replace(/[*$]/g, ""));
    return length(right) - length(left) || Number(right.allow) - Number(left.allow);
  });
  return { allowed: matches[0]!.allow, crawlDelaySeconds };
}

async function checkRobots(source: PolicySourceV1, targetUrl: string, signal: AbortSignal,
  dependencies: OfficialFetchDependencies): Promise<{ text: string | null; crawlDelaySeconds: number }> {
  const robotsUrl = new URL("/robots.txt", source.canonicalUrl).toString();
  const response = await fetchWithRedirects(robotsUrl, source, MAX_ROBOTS_BYTES,
    { "User-Agent": USER_AGENT, Accept: "text/plain", "Accept-Encoding": "identity" }, signal, dependencies);
  if (response.statusCode === 404 || response.statusCode === 410) {
    return { text: null, crawlDelaySeconds: 0 };
  }
  if (response.statusCode !== 200 || !response.headers["content-type"]?.toLowerCase().startsWith("text/plain")) {
    throw new OfficialFetchError("ROBOTS_UNAVAILABLE", response.statusCode);
  }
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(response.bytes); }
  catch { throw new OfficialFetchError("ROBOTS_INVALID"); }
  const policy = evaluateOfficialRobots(text, targetUrl);
  if (!policy.allowed) throw new OfficialFetchError("ROBOTS_DISALLOWED");
  return { text, crawlDelaySeconds: policy.crawlDelaySeconds };
}

export async function fetchOfficialPolicyDocument(input: OfficialFetchInput,
  dependencies: OfficialFetchDependencies = {}): Promise<OfficialFetchResult> {
  let source: PolicySourceV1;
  try { source = validateOfficialSourceRecord(input.source); }
  catch { throw new OfficialFetchError("URL_NOT_ALLOWED"); }
  if (source.registryStatus !== "CURATED" || !source.enabled) {
    throw new OfficialFetchError("SOURCE_NOT_CURATED");
  }
  const targetUrl = validateTarget(input.documentUrl ?? source.canonicalUrl, source);
  const etag = validator(input.etag);
  const lastModified = validator(input.lastModified);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MAX_TOTAL_MILLISECONDS);
  try {
    const robots = await checkRobots(source, targetUrl, controller.signal, dependencies);
    const robotsCrawlDelaySeconds = robots.crawlDelaySeconds;
    if (robotsCrawlDelaySeconds > 0) {
      await (dependencies.pause ?? (async (ms, signal) => { await sleep(ms, undefined, { signal }); }))(
        robotsCrawlDelaySeconds * 1_000, controller.signal);
    }
    const headers: Record<string, string> = {
      "User-Agent": USER_AGENT, Accept: "text/html, application/pdf", "Accept-Encoding": "identity",
    };
    if (etag) headers["If-None-Match"] = etag;
    if (lastModified) headers["If-Modified-Since"] = lastModified;
    const response = await fetchWithRedirects(targetUrl, source, MAX_DOCUMENT_BYTES, headers,
      controller.signal, dependencies, url => {
        if (robots.text && !evaluateOfficialRobots(robots.text, url).allowed) {
          throw new OfficialFetchError("ROBOTS_DISALLOWED");
        }
      });
    const common = {
      finalUrl: response.finalUrl,
      redirectTrace: response.redirectTrace,
      robotsCrawlDelaySeconds,
      ...(validator(response.headers.etag) ? { etag: validator(response.headers.etag) } : {}),
      ...(validator(response.headers["last-modified"]) ?
        { lastModified: validator(response.headers["last-modified"]) } : {}),
    };
    if (response.statusCode === 304) {
      if (!etag && !lastModified) throw new OfficialFetchError("INVALID_RESPONSE");
      return { status: "NOT_MODIFIED", ...common };
    }
    if (response.statusCode === 429) {
      const retryAfter = parseRetryAfterDetails(response.headers["retry-after"],
        (dependencies.now ?? (() => new Date()))());
      throw new OfficialFetchError("RATE_LIMITED", 429, retryAfter.seconds, retryAfter.exceedsCap);
    }
    if (response.statusCode !== 200) throw new OfficialFetchError("HTTP_STATUS", response.statusCode);
    if (/\b(?:noarchive|no-store)\b/i.test(`${response.headers["x-robots-tag"] ?? ""} ${response.headers["cache-control"] ?? ""}`)) {
      throw new OfficialFetchError("UNSUPPORTED_CONTENT");
    }
    const mimeType = response.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase();
    if (mimeType !== "text/html" && mimeType !== "application/pdf") {
      throw new OfficialFetchError("UNSUPPORTED_CONTENT");
    }
    if (response.bytes.length === 0 || response.bytes.length > MAX_DOCUMENT_BYTES) {
      throw new OfficialFetchError("CONTENT_TOO_LARGE");
    }
    if (mimeType === "application/pdf" &&
        Buffer.from(response.bytes.subarray(0, 5)).toString("ascii") !== "%PDF-") {
      throw new OfficialFetchError("UNSUPPORTED_CONTENT");
    }
    return { status: "CHANGED", ...common, mimeType, bytes: response.bytes,
      sha256: createHash("sha256").update(response.bytes).digest("hex") };
  } catch (error) {
    if (error instanceof OfficialFetchError) throw error;
    if (controller.signal.aborted) throw new OfficialFetchError("TIMEOUT");
    throw new OfficialFetchError("NETWORK_FAILURE");
  } finally {
    clearTimeout(timer);
  }
}
