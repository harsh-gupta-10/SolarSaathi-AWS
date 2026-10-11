/**
 * Deterministic indicative-quote engine. It prices a system only from APPROVED, unexpired, in-scope price
 * benchmarks. It never extrapolates across scope, size band, module class or inverter type, and it never nets any
 * subsidy into a price. Benchmarks are data (versioned records approved by policy admins), not constants.
 */
export const QUOTE_ENGINE_VERSION = "INDICATIVE_QUOTE_V1" as const;
export const QUOTE_DISCLAIMER =
  "Indicative estimate, not an offer. Get at least 3 quotes from DISCOM-empanelled vendors. Subsidies are shown separately and are not deducted from this range.";

export type PriceScopeLevel = "NATIONAL" | "STATE" | "DISCOM";
export type PriceBenchmarkStatus = "CANDIDATE" | "APPROVED" | "SUPERSEDED" | "REJECTED";
export type PriceAuthorityTier = "OFFICIAL" | "DISCOM" | "TRADE_PRESS" | "INSTALLER" | "OTHER";
export type ModuleClass = "DCR" | "NON_DCR";
export type InverterType = "STRING" | "MICRO" | "HYBRID" | "UNSPECIFIED";

export interface PriceBenchmarkV1 {
  schemaVersion: 1;
  benchmarkId: string;
  scope: { level: PriceScopeLevel; state?: string; discom?: string };
  sizeBand: { minKw: number; maxKw: number };
  moduleClass: ModuleClass;
  inverterType: InverterType;
  rupeesPerKw: { min: number; typical: number; max: number };
  inclusions: string[];
  exclusions: string[];
  source: { url: string; publisher: string; authorityTier: PriceAuthorityTier; title?: string };
  publishedOn: string;
  lastCheckedAt: string;
  expiresAt: string;
  status: PriceBenchmarkStatus;
}

export interface QuoteInputV1 {
  actualDcKw: number;
  state: string;
  discom?: string;
  moduleClass: ModuleClass;
  inverterType: InverterType;
  at: Date;
}

export interface QuoteMoney { low: number; typical: number; high: number }
export interface QuoteBenchmarkRef {
  benchmarkId: string; scopeLevel: PriceScopeLevel; scopeLabel: string; publisher: string; authorityTier: PriceAuthorityTier;
  sourceUrl: string; publishedOn: string; lastCheckedAt: string; expiresAt: string;
}
export interface QuoteLineItem {
  label: string; actualDcKw: number; rupeesPerKw: QuoteMoney; amountRupees: QuoteMoney; benchmarkId: string;
}
export interface QuoteEstimate {
  perKw: QuoteMoney; totalRupees: QuoteMoney; lineItems: QuoteLineItem[]; benchmark: QuoteBenchmarkRef;
  inclusions: string[]; exclusions: string[];
}
export type QuoteReasonCode =
  | "NO_APPROVED_BENCHMARK" | "NO_BENCHMARK_AT_REQUESTED_SCOPE" | "INVALID_INPUT";

export interface IndicativeQuoteV1 {
  schemaVersion: 1;
  engineVersion: typeof QUOTE_ENGINE_VERSION;
  status: "AVAILABLE" | "UNAVAILABLE";
  input: { actualDcKw: number; state: string; discom?: string; moduleClass: ModuleClass; inverterType: InverterType };
  estimate?: QuoteEstimate;
  /** Present only when status is UNAVAILABLE: the nearest wider-scope reference, never presented as the quote. */
  widerScopeReference?: QuoteEstimate & { label: string };
  reasonCodes: QuoteReasonCode[];
  subsidy: { netted: false; note: string };
  disclaimer: string;
}

const LEVEL_RANK: Record<PriceScopeLevel, number> = { DISCOM: 3, STATE: 2, NATIONAL: 1 };
const TIER_RANK: Record<PriceAuthorityTier, number> = { OFFICIAL: 5, DISCOM: 4, TRADE_PRESS: 3, INSTALLER: 2, OTHER: 1 };
const norm = (value: string | undefined) => (value ?? "").trim().toUpperCase();
const SUBSIDY_NOTE = "Central, state and DISCOM benefits are calculated separately from verified policy records and are never netted into this price range.";

function scopeLabel(benchmark: PriceBenchmarkV1) {
  const { level, state, discom } = benchmark.scope;
  return level === "NATIONAL" ? "National" : level === "STATE" ? `State ${state}` : `DISCOM ${discom} (${state})`;
}

export function benchmarkUsable(benchmark: PriceBenchmarkV1, at: Date): boolean {
  const { min, typical, max } = benchmark.rupeesPerKw;
  return benchmark.status === "APPROVED" && Date.parse(benchmark.expiresAt) > at.getTime() &&
    Date.parse(benchmark.publishedOn) <= at.getTime() &&
    Number.isFinite(min) && Number.isFinite(typical) && Number.isFinite(max) && min > 0 && min <= typical && typical <= max &&
    benchmark.sizeBand.minKw > 0 && benchmark.sizeBand.minKw <= benchmark.sizeBand.maxKw;
}

function covers(benchmark: PriceBenchmarkV1, input: QuoteInputV1): boolean {
  if (benchmark.moduleClass !== input.moduleClass) return false;
  // An UNSPECIFIED benchmark inverter only matches an UNSPECIFIED request: no silent equivalence.
  if (benchmark.inverterType !== input.inverterType) return false;
  if (input.actualDcKw < benchmark.sizeBand.minKw || input.actualDcKw > benchmark.sizeBand.maxKw) return false;
  const { level, state, discom } = benchmark.scope;
  if (level === "NATIONAL") return true;
  if (norm(state) !== norm(input.state)) return false;
  return level === "STATE" || (!!input.discom && norm(discom) === norm(input.discom));
}

const better = (a: PriceBenchmarkV1, b: PriceBenchmarkV1) =>
  LEVEL_RANK[b.scope.level] - LEVEL_RANK[a.scope.level] ||
  TIER_RANK[b.source.authorityTier] - TIER_RANK[a.source.authorityTier] ||
  Date.parse(b.publishedOn) - Date.parse(a.publishedOn) ||
  (a.sizeBand.maxKw - a.sizeBand.minKw) - (b.sizeBand.maxKw - b.sizeBand.minKw) ||
  (a.benchmarkId < b.benchmarkId ? -1 : 1);

function estimateFrom(benchmark: PriceBenchmarkV1, actualDcKw: number): QuoteEstimate {
  const perKw: QuoteMoney = { low: benchmark.rupeesPerKw.min, typical: benchmark.rupeesPerKw.typical, high: benchmark.rupeesPerKw.max };
  const amount: QuoteMoney = { low: Math.round(perKw.low * actualDcKw), typical: Math.round(perKw.typical * actualDcKw),
    high: Math.round(perKw.high * actualDcKw) };
  return { perKw, totalRupees: amount, benchmark: {
    benchmarkId: benchmark.benchmarkId, scopeLevel: benchmark.scope.level, scopeLabel: scopeLabel(benchmark),
    publisher: benchmark.source.publisher, authorityTier: benchmark.source.authorityTier, sourceUrl: benchmark.source.url,
    publishedOn: benchmark.publishedOn, lastCheckedAt: benchmark.lastCheckedAt, expiresAt: benchmark.expiresAt },
  lineItems: [{ label: `Rooftop solar system, ${benchmark.moduleClass === "DCR" ? "DCR" : "non-DCR"} modules`,
    actualDcKw, rupeesPerKw: perKw, amountRupees: amount, benchmarkId: benchmark.benchmarkId }],
  inclusions: [...benchmark.inclusions], exclusions: [...benchmark.exclusions] };
}

/**
 * Requested scope is the most specific scope the user gave (DISCOM, else state). Benchmarks at that scope, or the
 * state benchmark covering a DISCOM, make the quote AVAILABLE. A national benchmark is only ever returned as a
 * clearly labelled wider-scope reference with status UNAVAILABLE.
 */
export function buildIndicativeQuoteV1(input: QuoteInputV1, benchmarks: readonly PriceBenchmarkV1[]): IndicativeQuoteV1 {
  const echoed = { actualDcKw: input.actualDcKw, state: norm(input.state), ...(input.discom ? { discom: norm(input.discom) } : {}),
    moduleClass: input.moduleClass, inverterType: input.inverterType };
  const base = { schemaVersion: 1 as const, engineVersion: QUOTE_ENGINE_VERSION, input: echoed,
    subsidy: { netted: false as const, note: SUBSIDY_NOTE }, disclaimer: QUOTE_DISCLAIMER };
  if (!Number.isFinite(input.actualDcKw) || input.actualDcKw <= 0 || input.actualDcKw > 1_000 || !norm(input.state)) {
    return { ...base, status: "UNAVAILABLE", reasonCodes: ["INVALID_INPUT"] };
  }
  const usable = benchmarks.filter(item => benchmarkUsable(item, input.at) && covers(item, input)).sort(better);
  const specific = usable.filter(item => item.scope.level !== "NATIONAL");
  if (specific.length) return { ...base, status: "AVAILABLE", estimate: estimateFrom(specific[0]!, input.actualDcKw), reasonCodes: [] };
  const wider = usable.find(item => item.scope.level === "NATIONAL");
  if (wider) {
    return { ...base, status: "UNAVAILABLE", reasonCodes: ["NO_BENCHMARK_AT_REQUESTED_SCOPE"],
      widerScopeReference: { ...estimateFrom(wider, input.actualDcKw),
        label: "Wider-scope reference (national), not specific to your state or DISCOM; do not treat as your quote." } };
  }
  return { ...base, status: "UNAVAILABLE", reasonCodes: ["NO_APPROVED_BENCHMARK"] };
}
