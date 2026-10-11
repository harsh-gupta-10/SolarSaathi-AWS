/**
 * Deterministic grounding post-check. Model prose may only restate figures that appear in this turn's tool results
 * (or in earlier tool summaries of the same conversation). Ungrounded money, kW, percent and payback figures are
 * replaced by a pointer to the cards.
 */
export const UNGROUNDED_REPLACEMENT = "see the card above";

export type FigureKind = "money" | "kw" | "kwh" | "percent" | "years";
export interface Figure { kind: FigureKind; value: number; precision: number; unitSize: number; start: number; end: number }

const LAKH = 100_000, CRORE = 10_000_000;
const NUMBER = String.raw`\d{1,3}(?:,\d{2,3})+(?:\.\d+)?|\d+(?:\.\d+)?`;
const MONEY_MULTIPLIER = String.raw`(?:\s*(lakhs?|lacs?|crores?|cr|thousand|k)\b)?`;
const moneyPatterns = [
  new RegExp(String.raw`(?:₹|\bRs\.?|\bINR)\s*(${NUMBER})${MONEY_MULTIPLIER}`, "gi"),
  new RegExp(String.raw`(${NUMBER})${MONEY_MULTIPLIER}\s*(?:rupees|rs\b\.?|inr\b)`, "gi"),
  // "2 lakh" without a currency marker is still an amount.
  new RegExp(String.raw`\b(${NUMBER})\s*(lakhs?|lacs?|crores?)\b`, "gi"),
];
const kwPattern = new RegExp(String.raw`(?<![\w.])(${NUMBER})\s*-?\s*(kwh|kwp|kw|kilowatts?|kilowatt[- ]hours?)\b`, "gi");
const percentPattern = new RegExp(String.raw`(${NUMBER})\s*(?:%|per\s?cent\b|percent\b)`, "gi");
const yearsPattern = new RegExp(String.raw`(${NUMBER})\s*(?:-|to)?\s*(?:years?|yrs?)\b`, "gi");
const paybackContext = /pay\s?-?back|break\s?-?even|recover(?:s|ed)?\s+(?:the\s+)?(?:cost|investment)|earn(?:s)? back/i;

const multiplier = (word: string | undefined) => {
  const unit = word?.toLowerCase();
  if (!unit) return 1;
  if (unit.startsWith("lakh") || unit.startsWith("lac")) return LAKH;
  if (unit.startsWith("crore") || unit === "cr") return CRORE;
  return 1_000;
};
const parseNumber = (text: string) => Number(text.replace(/,/g, ""));
const precisionOf = (text: string) => text.includes(".") ? text.split(".")[1]!.length : 0;

/** Extract every checkable figure from model text. Spans never overlap. */
export function extractFigures(text: string): Figure[] {
  const found: Figure[] = [];
  const taken: Array<[number, number]> = [];
  const free = (start: number, end: number) => !taken.some(([a, b]) => start < b && end > a);
  const add = (figure: Figure) => { if (free(figure.start, figure.end)) { found.push(figure); taken.push([figure.start, figure.end]); } };

  for (const pattern of moneyPatterns) {
    for (const match of text.matchAll(pattern)) {
      const raw = match[1]!;
      const size = multiplier(match[2]);
      const precision = precisionOf(raw);
      add({ kind: "money", value: parseNumber(raw) * size, precision, unitSize: size,
        start: match.index!, end: match.index! + match[0].length });
    }
  }
  for (const match of text.matchAll(kwPattern)) {
    const unit = match[2]!.toLowerCase();
    add({ kind: unit.startsWith("kwh") || unit.includes("hour") ? "kwh" : "kw", value: parseNumber(match[1]!),
      precision: precisionOf(match[1]!), unitSize: 1, start: match.index!, end: match.index! + match[0].length });
  }
  for (const match of text.matchAll(percentPattern)) {
    add({ kind: "percent", value: parseNumber(match[1]!), precision: precisionOf(match[1]!), unitSize: 1,
      start: match.index!, end: match.index! + match[0].length });
  }
  // Years are only checked in payback sentences; other years (warranty, lifetime) are not financial claims.
  for (const sentence of sentenceSpans(text)) {
    if (!paybackContext.test(sentence.text)) continue;
    for (const match of sentence.text.matchAll(yearsPattern)) {
      const start = sentence.start + match.index!;
      add({ kind: "years", value: parseNumber(match[1]!), precision: precisionOf(match[1]!), unitSize: 1,
        start, end: start + match[0].length });
    }
  }
  return found.sort((a, b) => a.start - b.start);
}

function sentenceSpans(text: string): Array<{ start: number; text: string }> {
  const spans: Array<{ start: number; text: string }> = [];
  let start = 0;
  for (const match of text.matchAll(/[.!?।\n]+(?=\s|$)/g)) {
    const end = match.index! + match[0].length;
    spans.push({ start, text: text.slice(start, end) }); start = end;
  }
  if (start < text.length) spans.push({ start, text: text.slice(start) });
  return spans;
}

const TOLERANCE: Record<FigureKind, number> = { money: 0.02, kw: 0.02, kwh: 0.02, percent: 0.03, years: 0.04 };

/** Numeric facts registered from tool output. Kind-agnostic: a value must simply exist in the tool results. */
export class GroundingContext {
  private readonly values = new Set<number>();
  private readonly texts: string[] = [];

  addNumber(value: number) {
    if (!Number.isFinite(value)) return;
    this.values.add(value);
    // Rounded presentations of a tool figure (e.g. 5.5 -> "5.5", 4 -> "4") are checked with tolerance below.
  }
  /** Register numbers found in tool-provided prose such as modelSummary. */
  addText(text: string) {
    this.texts.push(text);
    for (const match of text.matchAll(new RegExp(NUMBER, "g"))) {
      const base = parseNumber(match[0]);
      this.addNumber(base);
    }
    for (const figure of extractFigures(text)) this.addNumber(figure.value);
  }
  /** Walk structured card/tool data. Values under keys containing "paise" are also registered in rupees. */
  addData(data: unknown, key = "") {
    if (typeof data === "number") {
      this.addNumber(data);
      if (/paise/i.test(key)) this.addNumber(data / 100);
    } else if (typeof data === "string") {
      this.addText(data);
    } else if (Array.isArray(data)) {
      for (const item of data) this.addData(item, key);
    } else if (data && typeof data === "object") {
      for (const [childKey, value] of Object.entries(data)) this.addData(value, childKey);
    }
  }
  get size() { return this.values.size; }

  has(figure: Figure): boolean {
    const half = 0.5 * 10 ** -figure.precision * figure.unitSize;
    for (const candidate of this.values) {
      const allowed = Math.max(0.5, Math.min(half, Math.abs(figure.value) * TOLERANCE[figure.kind]));
      if (Math.abs(candidate - figure.value) <= allowed + 1e-9) return true;
    }
    return false;
  }
}

export interface GroundingResult { text: string; replaced: number }

export function groundText(text: string, context: GroundingContext): GroundingResult {
  const figures = extractFigures(text);
  let output = "";
  let cursor = 0;
  let replaced = 0;
  for (const figure of figures) {
    if (context.has(figure)) continue;
    output += text.slice(cursor, figure.start) + UNGROUNDED_REPLACEMENT;
    cursor = figure.end;
    replaced++;
  }
  return { text: output + text.slice(cursor), replaced };
}

/**
 * Incremental grounding for streamed model text. Text is released only after a sentence boundary, so a figure that
 * is split across token deltas is checked whole. `flush` releases the remainder at the end of a model segment.
 */
export class GroundingStream {
  private buffer = "";
  replaced = 0;
  constructor(private readonly context: GroundingContext) {}

  private release(upTo: number): string {
    if (upTo <= 0) return "";
    const chunk = this.buffer.slice(0, upTo);
    this.buffer = this.buffer.slice(upTo);
    const result = groundText(chunk, this.context);
    this.replaced += result.replaced;
    return result.text;
  }

  push(delta: string): string {
    this.buffer += delta;
    let boundary = -1;
    for (const match of this.buffer.matchAll(/[.!?।\n]+\s+/g)) {
      const before = this.buffer.slice(0, match.index!).trimEnd();
      // "Rs. 5,000" and "approx. 3 kW" must not end a sentence; a digit after the break means a decimal-like list.
      if (/(?:\bRs|\bINR|\bapprox|\bno|\bca)$/i.test(before) && match[0].startsWith(".")) continue;
      boundary = match.index! + match[0].length;
    }
    return this.release(boundary);
  }

  flush(): string { return this.release(this.buffer.length); }
}
