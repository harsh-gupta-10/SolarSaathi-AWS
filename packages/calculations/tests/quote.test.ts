import { describe, expect, it } from "vitest";
import { buildIndicativeQuoteV1, QUOTE_DISCLAIMER, type PriceBenchmarkV1 } from "../src/quote";

const at = new Date("2026-10-10T00:00:00.000Z");
// Synthetic test fixtures only. No production code seeds approved benchmarks.
const benchmark = (overrides: Partial<PriceBenchmarkV1> = {}): PriceBenchmarkV1 => ({
  schemaVersion: 1, benchmarkId: "PB-1", scope: { level: "STATE", state: "MH" }, sizeBand: { minKw: 1, maxKw: 3 },
  moduleClass: "DCR", inverterType: "STRING", rupeesPerKw: { min: 50_000, typical: 60_000, max: 70_000 },
  inclusions: ["Structure", "Wiring"], exclusions: ["Net-meter fee"],
  source: { url: "https://example.gov.in/rates", publisher: "Fixture Authority", authorityTier: "OFFICIAL" },
  publishedOn: "2026-09-01T00:00:00.000Z", lastCheckedAt: "2026-10-01T00:00:00.000Z",
  expiresAt: "2027-03-01T00:00:00.000Z", status: "APPROVED", ...overrides,
});
const input = { actualDcKw: 3, state: "mh", moduleClass: "DCR" as const, inverterType: "STRING" as const, at };

describe("indicative quote engine", () => {
  it("prices from an approved in-scope benchmark with line items, sources and a separate subsidy note", () => {
    const quote = buildIndicativeQuoteV1(input, [benchmark()]);
    expect(quote.status).toBe("AVAILABLE");
    expect(quote.estimate?.totalRupees).toEqual({ low: 150_000, typical: 180_000, high: 210_000 });
    expect(quote.estimate?.lineItems[0]).toMatchObject({ benchmarkId: "PB-1", actualDcKw: 3 });
    expect(quote.estimate?.benchmark).toMatchObject({ sourceUrl: "https://example.gov.in/rates", publishedOn: "2026-09-01T00:00:00.000Z" });
    expect(quote.subsidy.netted).toBe(false);
    expect(quote.disclaimer).toBe(QUOTE_DISCLAIMER);
  });

  it("never uses candidate, superseded, rejected or expired benchmarks", () => {
    for (const bad of [{ status: "CANDIDATE" as const }, { status: "SUPERSEDED" as const }, { status: "REJECTED" as const },
      { expiresAt: "2026-10-01T00:00:00.000Z" }]) {
      const quote = buildIndicativeQuoteV1(input, [benchmark(bad)]);
      expect(quote.status).toBe("UNAVAILABLE");
      expect(quote.estimate).toBeUndefined();
      expect(quote.reasonCodes).toEqual(["NO_APPROVED_BENCHMARK"]);
    }
  });

  it("does not extrapolate across size band, module class, inverter type or state", () => {
    for (const changed of [{ actualDcKw: 3.5 }, { moduleClass: "NON_DCR" as const }, { inverterType: "HYBRID" as const }, { state: "GJ" }]) {
      expect(buildIndicativeQuoteV1({ ...input, ...changed }, [benchmark()]).status).toBe("UNAVAILABLE");
    }
  });

  it("prefers a DISCOM benchmark over the state one and ignores another DISCOM's benchmark", () => {
    const state = benchmark();
    const discom = benchmark({ benchmarkId: "PB-D", scope: { level: "DISCOM", state: "MH", discom: "MSEDCL" },
      rupeesPerKw: { min: 40_000, typical: 45_000, max: 50_000 } });
    const other = benchmark({ benchmarkId: "PB-X", scope: { level: "DISCOM", state: "MH", discom: "TATA" } });
    expect(buildIndicativeQuoteV1({ ...input, discom: "msedcl" }, [state, discom, other]).estimate?.benchmark.benchmarkId).toBe("PB-D");
    expect(buildIndicativeQuoteV1({ ...input, discom: "BEST" }, [other, discom]).status).toBe("UNAVAILABLE");
    expect(buildIndicativeQuoteV1({ ...input, discom: "BEST" }, [state, other]).estimate?.benchmark.benchmarkId).toBe("PB-1");
  });

  it("returns only a labelled wider-scope reference when just a national benchmark exists", () => {
    const national = benchmark({ benchmarkId: "PB-N", scope: { level: "NATIONAL" } });
    const quote = buildIndicativeQuoteV1(input, [national]);
    expect(quote.status).toBe("UNAVAILABLE");
    expect(quote.estimate).toBeUndefined();
    expect(quote.reasonCodes).toEqual(["NO_BENCHMARK_AT_REQUESTED_SCOPE"]);
    expect(quote.widerScopeReference).toMatchObject({ label: expect.stringContaining("Wider-scope"), benchmark: { benchmarkId: "PB-N" } });
  });

  it("breaks ties by authority tier then publication date and rejects invalid input", () => {
    const installer = benchmark({ benchmarkId: "PB-I", source: { url: "https://x.example", publisher: "Installer", authorityTier: "INSTALLER" } });
    expect(buildIndicativeQuoteV1(input, [installer, benchmark()]).estimate?.benchmark.benchmarkId).toBe("PB-1");
    const newer = benchmark({ benchmarkId: "PB-new", publishedOn: "2026-10-05T00:00:00.000Z" });
    expect(buildIndicativeQuoteV1(input, [benchmark(), newer]).estimate?.benchmark.benchmarkId).toBe("PB-new");
    expect(buildIndicativeQuoteV1({ ...input, actualDcKw: 0 }, [benchmark()]).reasonCodes).toEqual(["INVALID_INPUT"]);
    expect(buildIndicativeQuoteV1(input, [benchmark({ rupeesPerKw: { min: 70_000, typical: 60_000, max: 50_000 } })]).status).toBe("UNAVAILABLE");
  });
});
