import { buildIndicativeQuoteV1, type IndicativeQuoteV1, type QuoteEstimate } from "@solarsaathi/calculations";
import { z } from "zod";
import { CHAT_CONFIG } from "../config";
import { researchKey } from "../keys";
import { dayBucket } from "../limits";
import { regionCodes } from "../../pricing/states";
import { card, cleanLabel, inr, kw } from "./support";
import { defineTool, type ToolContext, type ToolOutput } from "./types";

const kwGrounded = (context: ToolContext, value: number) =>
  context.grounding.has({ kind: "kw", value, precision: 2, unitSize: 1, start: 0, end: 0 });

function estimateRows(estimate: QuoteEstimate) {
  return [
    { label: "Indicative range", value: `${inr(estimate.totalRupees.low)} to ${inr(estimate.totalRupees.high)}`, emphasis: true },
    { label: "Typical", value: inr(estimate.totalRupees.typical) },
    { label: "Per kW", value: `${inr(estimate.perKw.low)} to ${inr(estimate.perKw.high)}`, note: `typical ${inr(estimate.perKw.typical)}` },
    { label: "Price basis", value: `${estimate.benchmark.publisher} (${estimate.benchmark.authorityTier.toLowerCase().replace("_", " ")})`,
      note: `${estimate.benchmark.scopeLabel}; published ${estimate.benchmark.publishedOn.slice(0, 10)}; checked ${estimate.benchmark.lastCheckedAt.slice(0, 10)}` }];
}

export const getIndicativeQuote = defineTool({
  name: "get_indicative_quote",
  description: "Indicative price range for a system size from APPROVED price benchmarks only, with sources. The size (actualDcKw) must come from recommend_systems. Subsidy is never netted. If no approved benchmark covers the user's state, it says so.",
  schema: z.object({
    actualDcKw: z.number().finite().min(0.1).max(1_000), state: z.enum(regionCodes), discom: z.string().trim().min(1).max(64).optional(),
    moduleClass: z.enum(["DCR", "NON_DCR"]), inverterType: z.enum(["STRING", "MICRO", "HYBRID", "UNSPECIFIED"]).default("UNSPECIFIED"),
  }).strict(),
  async run(input, context): Promise<ToolOutput> {
    if (!kwGrounded(context, input.actualDcKw)) {
      return { modelSummary: "SYSTEM_SIZE_NOT_ESTABLISHED. Run recommend_systems first and pass the actual DC kW it returned.", cards: [] };
    }
    const benchmarks = await context.services.prices.listUsable();
    const quote: IndicativeQuoteV1 = buildIndicativeQuoteV1({ actualDcKw: input.actualDcKw, state: input.state,
      ...(input.discom ? { discom: input.discom } : {}), moduleClass: input.moduleClass, inverterType: input.inverterType, at: context.now() }, benchmarks);
    const estimate = quote.estimate;
    const links = (estimate ?? quote.widerScopeReference) ? [{ label: (estimate ?? quote.widerScopeReference)!.benchmark.publisher,
      url: (estimate ?? quote.widerScopeReference)!.benchmark.sourceUrl }] : [];
    if (estimate) {
      return { modelSummary: `INDICATIVE_QUOTE for ${input.actualDcKw} kW ${input.moduleClass}: range ${inr(estimate.totalRupees.low)} to ${inr(estimate.totalRupees.high)}, typical ${inr(estimate.totalRupees.typical)} ` +
        `(${inr(estimate.perKw.typical)} per kW). Source ${estimate.benchmark.publisher}, published ${estimate.benchmark.publishedOn.slice(0, 10)}. Subsidy is separate and not deducted. Say it is indicative, not an offer.`,
      cards: [card(context, "QUOTE", "Indicative price range", {
        summary: `For a ${kw(input.actualDcKw)} system, ${input.moduleClass === "DCR" ? "DCR" : "non-DCR"} modules.`, rows: estimateRows(estimate),
        table: { columns: ["Item", "Per kW", "Amount"], rows: estimate.lineItems.map(item => [item.label,
          `${inr(item.rupeesPerKw.low)} to ${inr(item.rupeesPerKw.high)}`, `${inr(item.amountRupees.low)} to ${inr(item.amountRupees.high)}`]) },
        bullets: [...estimate.inclusions.map(item => `Included: ${item}`), ...estimate.exclusions.map(item => `Not included: ${item}`), quote.subsidy.note],
        disclaimer: quote.disclaimer },
      { provenance: { source: `PRICE_BENCHMARK:${estimate.benchmark.benchmarkId}`, verificationStatus: "INDICATIVE", jurisdiction: estimate.benchmark.scopeLabel,
        effectiveDate: estimate.benchmark.publishedOn.slice(0, 10), lastCheckedAt: estimate.benchmark.lastCheckedAt, links } })] };
    }
    const wider = quote.widerScopeReference;
    return { modelSummary: `QUOTE_UNAVAILABLE (${quote.reasonCodes.join(", ")}). No approved price benchmark covers this state, size, module class and inverter type. ` +
      (wider ? "A national reference exists but is not specific to the user's area and must not be quoted as their price. " : "") +
      "Do not invent a price. Suggest getting at least three vendor quotes and offer to research market prices (unverified).",
    cards: [card(context, "QUOTE", "No approved price range yet", {
      summary: "I do not have an approved price benchmark for your state and system type, so I will not guess a price.",
      ...(wider ? { rows: [{ label: "Wider-scope reference (not your quote)", value: `${inr(wider.perKw.low)} to ${inr(wider.perKw.high)} per kW`, note: wider.label }] } : {}),
      bullets: ["Ask at least three DISCOM-empanelled vendors for itemised quotes."], disclaimer: quote.disclaimer },
    { provenance: { source: "QUOTE_ENGINE", verificationStatus: "UNVERIFIED", ...(links.length ? { links } : {}) } })] };
  },
});

export const researchPrices = defineTool({
  name: "research_prices",
  description: "Search the web for market price-per-kW information for a state. Results are UNVERIFIED candidates saved for administrator review; they are shown separately and never used in a quote. Limited per day.",
  schema: z.object({ state: z.enum(regionCodes), sizeKw: z.number().finite().min(0.5).max(1_000), moduleClass: z.enum(["DCR", "NON_DCR"]) }).strict(),
  async run(input, context): Promise<ToolOutput> {
    const research = context.services.research;
    if (!research) {
      return { modelSummary: "PRICE_RESEARCH_NOT_AVAILABLE. Web research is not configured. Do not guess prices.",
        cards: [card(context, "NOTICE", "Price research is unavailable", { summary: "Web price research is not set up in this environment." },
          { provenance: { source: "PRICE_RESEARCH", verificationStatus: "UNVERIFIED" } })] };
    }
    if (!kwGrounded(context, input.sizeKw)) return { modelSummary: "SYSTEM_SIZE_NOT_ESTABLISHED. Run recommend_systems first.", cards: [] };
    const counter = await context.services.items.increment(researchKey(context.identity.profile.userId, dayBucket(context.now())),
      { field: "searches", by: 1, max: CHAT_CONFIG.researchPerDay, expiresAtEpochSeconds: Math.floor(context.now().getTime() / 1_000) + 2 * 86_400 });
    if (!counter.ok) return { modelSummary: "PRICE_RESEARCH_DAILY_LIMIT. Tell the user the daily research limit is reached.", cards: [] };
    const outcome = await research.research({ state: input.state, sizeKw: input.sizeKw, moduleClass: input.moduleClass, inverterType: "UNSPECIFIED" });
    if (outcome.status !== "OK" || !outcome.candidates.length) {
      return { modelSummary: `PRICE_RESEARCH_NO_RESULTS status=${outcome.status} pagesRead=${outcome.pagesRead}. Nothing usable was found. Do not guess prices.`,
        cards: [card(context, "PRICE_RESEARCH", "No price information found", { summary: "I could not find a reliable published price per kW for this search.",
          disclaimer: "Unverified web research. Nothing here is a quote." }, { provenance: { source: "WEB_RESEARCH", verificationStatus: "UNVERIFIED" } })] };
    }
    const links = outcome.candidates.map(item => ({ label: item.publisher, url: item.sourceUrl }));
    return { modelSummary: `PRICE_RESEARCH found ${outcome.candidates.length} UNVERIFIED market figures: ` +
      outcome.candidates.map(item => `${item.publisher} (${item.authorityTier.toLowerCase().replace("_", " ")}) ${inr(item.rupeesPerKw.min)} to ${inr(item.rupeesPerKw.max)} per kW, published ${item.publishedOn.slice(0, 10)}`).join("; ") +
      ". These are market chatter pending administrator approval; label them unverified and never present them as the user's quote.",
    cards: [card(context, "PRICE_RESEARCH", "Market prices seen on the web (unverified)", {
      summary: "Found by automatic search and awaiting review. Not part of your quote.",
      table: { columns: ["Source", "Per kW", "Published", "System size"], rows: outcome.candidates.map(item => [
        `${item.publisher} (${item.authorityTier.toLowerCase().replace("_", " ")})`, `${inr(item.rupeesPerKw.min)} to ${inr(item.rupeesPerKw.max)}`,
        item.publishedOn.slice(0, 10), `${item.sizeBand.minKw} to ${item.sizeBand.maxKw} kW`]) },
      bullets: ["Figures were extracted automatically and may be out of date or for different equipment.", ...new Set(outcome.candidates.flatMap(item => item.notes)).values()].slice(0, 6).map(item => cleanLabel(item, 200)),
      disclaimer: "Unverified web research, not an offer. Get at least 3 quotes from DISCOM-empanelled vendors." },
    { provenance: { source: "WEB_RESEARCH", verificationStatus: "UNVERIFIED", lastCheckedAt: context.now().toISOString(), links } })] };
  },
});
