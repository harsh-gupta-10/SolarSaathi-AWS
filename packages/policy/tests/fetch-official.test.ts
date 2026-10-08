import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  evaluateOfficialRobots, fetchOfficialPolicyDocument, isPublicPolicyAddress,
  parseOfficialRetryAfter,
  type OfficialFetchDependencies, type OfficialDnsAddress, type PinnedResponse,
} from "../src/fetch-official";
import type { PolicySourceV1 } from "../src/schema";

const encoder = new TextEncoder();
const SOURCE_URL = "https://mnre.gov.in/en/grid-connected-solar-rooftop-programme/";
const NOW = "2026-10-08T12:00:00.000Z";

function source(changed: Partial<PolicySourceV1> = {}): PolicySourceV1 {
  return {
    schemaVersion: 1, sourceId: "SRC#MNRE#FETCH", registryVersion: 1,
    name: "Synthetic official source fixture", publisherName: "MNRE", jurisdiction: "IN",
    sourceType: "MNRE", authorityTier: 1, registryStatus: "CURATED", healthStatus: "HEALTHY",
    canonicalUrl: SOURCE_URL, allowedHosts: ["mnre.gov.in"], crawlFrequency: "DAILY",
    enabled: true, freshnessWindowHours: 48, curatedAt: NOW, curatorId: "test-reviewer",
    createdAt: NOW, updatedAt: NOW, ...changed,
  };
}

function response(statusCode: number, headers: Record<string, string | undefined> = {},
  bytes = ""): PinnedResponse {
  return { statusCode, headers, bytes: encoder.encode(bytes) };
}

const publicDns: OfficialDnsAddress[] = [{ address: "8.8.8.8", family: 4 }];

function fakeNetwork(reply: (url: string) => PinnedResponse,
  addresses: readonly OfficialDnsAddress[] = publicDns): OfficialFetchDependencies &
  { requestPinned: ReturnType<typeof vi.fn>; resolveAddresses: ReturnType<typeof vi.fn> } {
  return {
    resolveAddresses: vi.fn(async () => addresses),
    requestPinned: vi.fn(async input => reply(input.url)),
    pause: vi.fn(async () => undefined),
  };
}

describe("official policy source IP classification", () => {
  it("rejects private, metadata, reserved, documentation and multicast IPv4 ranges", () => {
    for (const address of [
      "0.1.2.3", "10.1.2.3", "100.64.1.1", "127.0.0.1", "169.254.169.254",
      "172.16.0.1", "172.31.255.255", "192.0.0.1", "192.0.2.1",
      "192.88.99.1", "192.168.1.1", "198.18.0.1", "198.51.100.1",
      "203.0.113.1", "224.0.0.1", "240.0.0.1", "255.255.255.255",
    ]) expect(isPublicPolicyAddress(address), address).toBe(false);
    expect(isPublicPolicyAddress("8.8.8.8")).toBe(true);
    expect(isPublicPolicyAddress("1.1.1.1")).toBe(true);
  });

  it("rejects loopback, mapped/private, local, documentation and special IPv6", () => {
    for (const address of ["::", "::1", "::ffff:127.0.0.1", "fc00::1", "fe80::1",
      "ff02::1", "2001:db8::1", "2001::1", "2002::1"]) {
      expect(isPublicPolicyAddress(address), address).toBe(false);
    }
    expect(isPublicPolicyAddress("2001:4860:4860::8888")).toBe(true);
    expect(isPublicPolicyAddress("2a00:1450:4001::200e")).toBe(true);
  });
});

describe("robots policy", () => {
  it("selects the most specific user agent and rule, with allow winning an equal match", () => {
    const robots = `User-agent: *\nDisallow: /\n\nUser-agent: SolarSaathiPolicyBot\n` +
      `Disallow: /docs\nAllow: /docs/public\nDisallow: /docs/public/private\nAllow: /docs/public$\n` +
      `Crawl-delay: 1.5`;
    expect(evaluateOfficialRobots(robots, "https://mnre.gov.in/docs/public")).toEqual({
      allowed: true, crawlDelaySeconds: 1.5,
    });
    expect(evaluateOfficialRobots(robots, "https://mnre.gov.in/docs/public/private/a").allowed).toBe(false);
    expect(evaluateOfficialRobots(robots, "https://mnre.gov.in/other").allowed).toBe(true);
    expect(evaluateOfficialRobots("User-agent: *\nDisallow: /%E0%A4%AF", "https://mnre.gov.in/योजना").allowed).toBe(false);
    expect(evaluateOfficialRobots("User-agent: *\nDisallow: /docs/*/secret$",
      "https://mnre.gov.in/docs/2026/secret").allowed).toBe(false);
    expect(evaluateOfficialRobots("User-agent: *\nDisallow: /docs/*/secret$",
      "https://mnre.gov.in/docs/2026/secret/other").allowed).toBe(true);
    expect(() => evaluateOfficialRobots(`User-agent: *\nDisallow: /${"*".repeat(501)}`,
      "https://mnre.gov.in/docs")).toThrow();
  });
});

describe("bounded official source fetching", () => {
  it("fetches robots first, honors crawl delay, pins DNS per hop and returns hashed HTML with validators", async () => {
    const html = "<html><body>Official fixture notice</body></html>";
    const network = fakeNetwork(url => {
      if (url.endsWith("/robots.txt")) return response(200, { "content-type": "text/plain" },
        "User-agent: SolarSaathiPolicyBot\nAllow: /en/\nCrawl-delay: 0.25");
      return response(200, { "content-type": "text/html; charset=utf-8", etag: '"v2"',
        "last-modified": "Wed, 08 Oct 2026 10:00:00 GMT" }, html);
    });
    const result = await fetchOfficialPolicyDocument({ source: source(), etag: '"v1"' }, network);
    expect(result).toMatchObject({ status: "CHANGED", mimeType: "text/html", finalUrl: SOURCE_URL,
      etag: '"v2"', robotsCrawlDelaySeconds: 0.25, redirectTrace: [] });
    if (result.status !== "CHANGED") throw new Error("Expected changed document");
    expect(result.sha256).toBe(createHash("sha256").update(result.bytes).digest("hex"));
    expect(network.requestPinned).toHaveBeenCalledTimes(2);
    expect(network.requestPinned.mock.calls[1]?.[0]).toMatchObject({
      address: publicDns[0], headers: { "If-None-Match": '"v1"', "Accept-Encoding": "identity" },
    });
    expect(network.pause).toHaveBeenCalledWith(250, expect.any(AbortSignal));
  });

  it("keeps conditional 304 distinct from a changed document", async () => {
    const network = fakeNetwork(url => url.endsWith("/robots.txt") ? response(404) :
      response(304, { etag: '"v1"' }));
    const result = await fetchOfficialPolicyDocument({ source: source(), etag: '"v1"' }, network);
    expect(result).toEqual({ status: "NOT_MODIFIED", finalUrl: SOURCE_URL, etag: '"v1"',
      redirectTrace: [], robotsCrawlDelaySeconds: 0 });
  });

  it("accepts a same-host redirect and records the final URL", async () => {
    const finalUrl = "https://mnre.gov.in/en/current-notice.pdf";
    const network = fakeNetwork(url => {
      if (url.endsWith("/robots.txt")) return response(404);
      if (url === SOURCE_URL) return response(302, { location: "/en/current-notice.pdf" });
      return response(200, { "content-type": "application/pdf" }, "%PDF-1.4\nfixture");
    });
    const result = await fetchOfficialPolicyDocument({ source: source() }, network);
    expect(result).toMatchObject({ status: "CHANGED", finalUrl, mimeType: "application/pdf",
      redirectTrace: [finalUrl] });
    expect(network.requestPinned).toHaveBeenCalledTimes(3);
  });

  it("rejects disabled or unverified sources and arbitrary URL/host/type changes before DNS", async () => {
    const network = fakeNetwork(() => response(200));
    await expect(fetchOfficialPolicyDocument({ source: source({ enabled: false }) }, network))
      .rejects.toMatchObject({ code: "SOURCE_NOT_CURATED" });
    await expect(fetchOfficialPolicyDocument({ source: source({ sourceType: "DISCOM", jurisdiction: "IN-MH" }) }, network))
      .rejects.toMatchObject({ code: "URL_NOT_ALLOWED" });
    await expect(fetchOfficialPolicyDocument({ source: source(), documentUrl: "http://mnre.gov.in/notice" }, network))
      .rejects.toMatchObject({ code: "URL_NOT_ALLOWED" });
    await expect(fetchOfficialPolicyDocument({ source: source(), documentUrl: "https://mnre.gov.in.evil.example/" }, network))
      .rejects.toMatchObject({ code: "URL_NOT_ALLOWED" });
    expect(network.resolveAddresses).not.toHaveBeenCalled();
  });

  it("rejects a mixed public/private DNS answer before connecting", async () => {
    const network = fakeNetwork(() => response(404), [publicDns[0]!, { address: "169.254.169.254", family: 4 }]);
    await expect(fetchOfficialPolicyDocument({ source: source() }, network))
      .rejects.toMatchObject({ code: "UNSAFE_ADDRESS" });
    expect(network.requestPinned).not.toHaveBeenCalled();
  });

  it("bounds a stalled DNS lookup with the whole-operation deadline", async () => {
    vi.useFakeTimers();
    try {
      const network: OfficialFetchDependencies = {
        resolveAddresses: () => new Promise(() => undefined),
        requestPinned: vi.fn(),
      };
      const pending = fetchOfficialPolicyDocument({ source: source() }, network);
      const assertion = expect(pending).rejects.toMatchObject({ code: "TIMEOUT" });
      await vi.advanceTimersByTimeAsync(20_001);
      await assertion;
      expect(network.requestPinned).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("revalidates every redirect host and robots path before requesting it", async () => {
    const offsite = fakeNetwork(url => url.endsWith("/robots.txt") ? response(404) :
      response(302, { location: "https://other.example.org/private.pdf" }));
    await expect(fetchOfficialPolicyDocument({ source: source() }, offsite))
      .rejects.toMatchObject({ code: "URL_NOT_ALLOWED" });
    expect(offsite.requestPinned).toHaveBeenCalledTimes(2);

    const blockedPath = fakeNetwork(url => {
      if (url.endsWith("/robots.txt")) return response(200, { "content-type": "text/plain" },
        "User-agent: *\nDisallow: /blocked/");
      return response(302, { location: "/blocked/secret.pdf" });
    });
    await expect(fetchOfficialPolicyDocument({ source: source() }, blockedPath))
      .rejects.toMatchObject({ code: "ROBOTS_DISALLOWED" });
    expect(blockedPath.requestPinned).toHaveBeenCalledTimes(2);
  });

  it("fails closed on robots denial or unavailable robots, excessive delay, and redirect loops", async () => {
    for (const [robots, expected] of [
      [response(200, { "content-type": "text/plain" }, "User-agent: *\nDisallow: /"), "ROBOTS_DISALLOWED"],
      [response(503), "ROBOTS_UNAVAILABLE"],
      [response(200, { "content-type": "text/plain" }, "User-agent: *\nCrawl-delay: 30"), "ROBOTS_CRAWL_DELAY"],
    ] as const) {
      const network = fakeNetwork(url => url.endsWith("/robots.txt") ? robots : response(200));
      await expect(fetchOfficialPolicyDocument({ source: source() }, network))
        .rejects.toMatchObject({ code: expected });
      expect(network.requestPinned).toHaveBeenCalledTimes(1);
    }
    const looping = fakeNetwork(url => url.endsWith("/robots.txt") ? response(404) :
      response(302, { location: SOURCE_URL }));
    await expect(fetchOfficialPolicyDocument({ source: source() }, looping))
      .rejects.toMatchObject({ code: "TOO_MANY_REDIRECTS" });
    expect(looping.requestPinned).toHaveBeenCalledTimes(5);
  });

  it("rejects unsupported content, no-archive directives, excess bytes, and unsolicited 304", async () => {
    for (const [document, expected] of [
      [response(200, { "content-type": "image/png" }, "PNG"), "UNSUPPORTED_CONTENT"],
      [response(200, { "content-type": "application/pdf" }, "not-pdf"), "UNSUPPORTED_CONTENT"],
      [response(200, { "content-type": "text/html", "cache-control": "no-store" }, "<p>no</p>"), "UNSUPPORTED_CONTENT"],
      [response(304), "INVALID_RESPONSE"],
      [response(200, { "content-type": "text/html" }, "x".repeat(2_000_001)), "CONTENT_TOO_LARGE"],
    ] as const) {
      const network = fakeNetwork(url => url.endsWith("/robots.txt") ? response(404) : document);
      await expect(fetchOfficialPolicyDocument({ source: source() }, network))
        .rejects.toMatchObject({ code: expected });
    }
  });

  it("carries a bounded Retry-After delay on HTTP 429 without trusting malformed values", async () => {
    const now = new Date("2026-10-08T10:00:00.000Z");
    expect(parseOfficialRetryAfter("7200", now)).toBe(7_200);
    expect(parseOfficialRetryAfter("Thu, 08 Oct 2026 12:00:00 GMT", now)).toBe(7_200);
    expect(parseOfficialRetryAfter("172800", now)).toBe(172_800);
    expect(parseOfficialRetryAfter("Sat, 10 Oct 2026 10:00:00 GMT", now)).toBe(172_800);
    expect(parseOfficialRetryAfter("9999999", now)).toBe(2_592_000);
    expect(parseOfficialRetryAfter("later", now)).toBeUndefined();
    const network = fakeNetwork(url => url.endsWith("/robots.txt") ? response(404) :
      response(429, { "retry-after": "7200" }));
    network.now = () => now;
    await expect(fetchOfficialPolicyDocument({ source: source() }, network)).rejects.toMatchObject({
      code: "RATE_LIMITED", statusCode: 429, retryAfterSeconds: 7_200,
      retryAfterExceedsCap: false,
    });

    const longRateLimit = fakeNetwork(url => url.endsWith("/robots.txt") ? response(404) :
      response(429, { "retry-after": "9999999" }));
    longRateLimit.now = () => now;
    await expect(fetchOfficialPolicyDocument({ source: source() }, longRateLimit)).rejects.toMatchObject({
      code: "RATE_LIMITED", retryAfterSeconds: 2_592_000, retryAfterExceedsCap: true,
    });
  });
});
