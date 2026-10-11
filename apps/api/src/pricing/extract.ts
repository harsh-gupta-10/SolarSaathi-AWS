import type { ModuleClass } from "@solarsaathi/calculations";
import { PRICE_RECORD_LIMITS } from "./schema";

/**
 * Deterministic rupee-per-kW extraction from untrusted page text. No model is involved: a figure is accepted only if it
 * carries an explicit per-kW (or per-Wp) unit, falls inside plausibility bounds, sits near a parseable date, and is not
 * an outlier among the page's other figures. Text outside matched figures is never copied into results.
 */
export interface ExtractedPrice {
  rupeesPerKwMin: number; rupeesPerKwMax: number; moduleClass?: ModuleClass;
  sizeBand?: { minKw: number; maxKw: number }; publishedOn: string; context: "STATED_DATE" | "PAGE_DATE";
}

const NUM = String.raw`(\d{1,3}(?:,\d{2,3})+(?:\.\d+)?|\d+(?:\.\d+)?)`;
const CURRENCY = String.raw`(?:₹|rs\.?|inr)\s*`;
const UNIT_KW = String.raw`(?:per|/)\s*(?:kw|kwp|kilowatt)\b`;
const UNIT_WP = String.raw`(?:per|/)\s*wp\b`;
const rangePattern = new RegExp(String.raw`${CURRENCY}${NUM}\s*(?:-|–|to)\s*(?:${CURRENCY})?${NUM}\s*(${UNIT_KW}|${UNIT_WP})`, "gi");
const singlePattern = new RegExp(String.raw`${CURRENCY}${NUM}\s*(${UNIT_KW}|${UNIT_WP})`, "gi");
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const datePattern = new RegExp(String.raw`\b(?:(\d{1,2})(?:st|nd|rd|th)?\s+)?(${MONTHS.join("|")})[a-z]*\.?,?\s+(20\d{2})\b|\b(20\d{2})-(\d{2})-(\d{2})\b`, "gi");

const parse = (value: string) => Number(value.replace(/,/g, ""));
const median = (values: number[]) => { const sorted = [...values].sort((a, b) => a - b); const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2; };

export function parseDatesIn(text: string, now: Date): Date[] {
  const dates: Date[] = [];
  for (const match of text.matchAll(datePattern)) {
    let date: Date | undefined;
    if (match[2] && match[3]) date = new Date(Date.UTC(Number(match[3]), MONTHS.indexOf(match[2].toLowerCase().slice(0, 3)), Number(match[1] ?? 1)));
    else if (match[4]) date = new Date(Date.UTC(Number(match[4]), Number(match[5]) - 1, Number(match[6])));
    if (date && !Number.isNaN(date.getTime()) && date.getTime() <= now.getTime() + 86_400_000) dates.push(date);
  }
  return dates;
}

function sentenceAround(text: string, index: number, length: number) {
  const before = Math.max(text.lastIndexOf(". ", index - 1), text.lastIndexOf("\n", index - 1));
  const afterDot = text.indexOf(". ", index + length);
  const afterNl = text.indexOf("\n", index + length);
  const ends = [afterDot, afterNl].filter(value => value >= 0);
  return text.slice(before + 1, ends.length ? Math.min(...ends) : text.length).slice(0, 600);
}

function sizeBandIn(sentence: string): { minKw: number; maxKw: number } | undefined {
  const range = sentence.match(/(\d+(?:\.\d+)?)\s*(?:-|–|to)\s*(\d+(?:\.\d+)?)\s*kw/i);
  if (range && Number(range[1]) < Number(range[2])) return { minKw: Number(range[1]), maxKw: Number(range[2]) };
  const upTo = sentence.match(/(?:up to|upto|first|below|under)\s*(\d+(?:\.\d+)?)\s*kw/i);
  if (upTo && Number(upTo[1]) >= 1) return { minKw: 0.5, maxKw: Number(upTo[1]) };
  return undefined;
}

export function extractPrices(text: string, options: { now: Date; pageDate?: string | null; maxAgeDays?: number }): ExtractedPrice[] {
  const maxAge = (options.maxAgeDays ?? 3 * 365) * 86_400_000;
  const candidates: Array<ExtractedPrice & { index: number }> = [];
  const taken: Array<[number, number]> = [];
  const accept = (index: number, length: number, low: number, high: number, unit: string) => {
    if (taken.some(([a, b]) => index < b && index + length > a)) return;
    taken.push([index, index + length]);
    const perWp = /wp/i.test(unit);
    const min = perWp ? low * 1_000 : low, max = perWp ? high * 1_000 : high;
    if (min < PRICE_RECORD_LIMITS.minRupeesPerKw || max > PRICE_RECORD_LIMITS.maxRupeesPerKw || min > max) return;
    const sentence = sentenceAround(text, index, length);
    const sentenceStart = Math.max(text.lastIndexOf(". ", index - 1), text.lastIndexOf("\n", index - 1));
    const previousStart = Math.max(text.lastIndexOf(". ", sentenceStart - 1), text.lastIndexOf("\n", sentenceStart - 1));
    // A date counts if it is in the same sentence or the one immediately before it.
    const near = parseDatesIn(`${sentenceStart > 0 ? text.slice(previousStart + 1, sentenceStart + 1) : ""} ${sentence}`, options.now);
    const pageDate = options.pageDate ? new Date(options.pageDate) : undefined;
    const date = near.sort((a, b) => b.getTime() - a.getTime())[0] ?? (pageDate && !Number.isNaN(pageDate.getTime()) ? pageDate : undefined);
    if (!date || options.now.getTime() - date.getTime() > maxAge) return;
    const moduleClass: ModuleClass | undefined = /non[- ]?dcr|imported/i.test(sentence) ? "NON_DCR" :
      /\bdcr\b|domestic content/i.test(sentence) ? "DCR" : undefined;
    const band = sizeBandIn(sentence);
    candidates.push({ index, rupeesPerKwMin: min, rupeesPerKwMax: max, ...(moduleClass ? { moduleClass } : {}),
      ...(band ? { sizeBand: band } : {}), publishedOn: date.toISOString(), context: near.length ? "STATED_DATE" : "PAGE_DATE" });
  };
  for (const match of text.matchAll(rangePattern)) accept(match.index!, match[0].length, parse(match[1]!), parse(match[2]!), match[3]!);
  for (const match of text.matchAll(singlePattern)) accept(match.index!, match[0].length, parse(match[1]!), parse(match[1]!), match[2]!);
  let kept = candidates;
  // Outlier rejection: with three or more figures drop any whose midpoint is more than 50% from the median.
  if (candidates.length >= 3) {
    const centre = median(candidates.map(item => (item.rupeesPerKwMin + item.rupeesPerKwMax) / 2));
    kept = candidates.filter(item => Math.abs((item.rupeesPerKwMin + item.rupeesPerKwMax) / 2 - centre) <= centre * 0.5);
  }
  return kept.sort((a, b) => a.index - b.index).map(item => { const { index, ...rest } = item; void index; return rest; });
}
