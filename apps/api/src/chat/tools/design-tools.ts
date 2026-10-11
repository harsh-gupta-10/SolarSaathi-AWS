import { z } from "zod";
import {
  applicantFactFields, card, claimedByUser, demandFields, demandOrQuestion, DEFAULT_GENERATION_KWH_PER_KW_YEAR, inr, inrFromPaise,
  kw, kwh, noRoofOutput, pct, propertyFields, question, resolveAnalysis, unconfirmedFigure, years, type ApplicantFactInput,
} from "./support";
import { defineTool, type ToolContext, type ToolOutput } from "./types";

const analysisHref = (propertyId: string) => `/app/analyze?propertyId=${encodeURIComponent(propertyId)}`;
const SYSTEM_DISCLAIMER = "Planning estimate from roof geometry and your usage. Not a structural or electrical approval; a site survey is required.";

export const recommendSystems = defineTool({
  name: "recommend_systems",
  description: "Size rooftop solar options for a confirmed roof from the user's monthly units (kWh) or bill plus tariff. Returns candidate kW sizes with roof fit and modelled yearly generation.",
  schema: z.object({ ...propertyFields, ...demandFields }).strict(),
  async run(input, context) {
    const analysis = await resolveAnalysis(context, input.propertyId, input.analysisId);
    if (!analysis) return noRoofOutput(context, input.propertyId);
    const built = demandOrQuestion(context, input);
    if ("question" in built) return built.question;
    const response = await context.services.systems.recommend(context.identity, { propertyId: input.propertyId,
      analysisId: analysis.analysisId, demand: built.demand, generationKwhPerKwYear: DEFAULT_GENERATION_KWH_PER_KW_YEAR }, context.requestId);
    const { design } = response;
    const eligible = design.candidates.filter(item => item.recommendationEligible && item.estimatedAnnualGenerationKwh > 0);
    const recommended = design.recommendation;
    const table = { columns: ["System size", "Panels", "DC capacity", "Yearly generation", "Roof fit"],
      rows: eligible.map(item => [kw(item.nominalKw), String(item.panelCount), kw(item.actualDcKw), kwh(item.estimatedAnnualGenerationKwh), item.roofFit.replace(/_/g, " ").toLowerCase()]) };
    const summary = recommended ?
      `Recommended nominal ${recommended.nominalKw} kW: ${recommended.panelCount} panels, actual DC ${recommended.actualDcKw} kW, ` +
      `about ${Math.round(recommended.estimatedAnnualGenerationKwh)} kWh per year, covers ${Math.round(recommended.annualConsumptionCoverageRatio * 100)}% of yearly use. ` +
      `analysisId=${analysis.analysisId}. Options: ${eligible.map(item => `${item.nominalKw} kW (actual DC ${item.actualDcKw} kW)`).join(", ")}. ` +
      `Yield assumption ${design.assumptions.generationKwhPerKwYear} kWh per kW per year. Decision ${design.decisionCode}. Warnings: ${design.warnings.join(", ") || "none"}.` :
      `No supported system size for this roof and demand. Decision ${design.decisionCode}. Warnings: ${design.warnings.join(", ") || "none"}.`;
    const rows = [
      { label: "Your yearly use", value: kwh(design.demand.annualConsumptionKwh) },
      ...(recommended ? [{ label: "Suggested size", value: kw(recommended.actualDcKw), emphasis: true,
        note: `${recommended.panelCount} panels, ${pct(recommended.annualConsumptionCoverageRatio)} of your use` }] : []),
      { label: "Yield assumption", value: `${design.assumptions.generationKwhPerKwYear} kWh per kW per year`, note: "Planning default, not a site measurement" }];
    return { modelSummary: summary, cards: [card(context, "SYSTEM_OPTIONS", "System options for your roof",
      { summary: recommended ? "Space-feasible options for your roof." : "No supported size fits this roof and demand.", rows, table,
        bullets: design.warnings.map(item => item.replace(/_/g, " ").toLowerCase()), disclaimer: SYSTEM_DISCLAIMER,
        action: { label: "Open full roof analysis", href: analysisHref(input.propertyId) } },
      { provenance: { source: "DETERMINISTIC_SYSTEM_DESIGN_V1", verificationStatus: "INDICATIVE" } })] };
  },
});

const accessoryGoals = z.object({ backupPower: z.boolean().optional(), evCharging: z.boolean().optional(),
  monitoring: z.boolean().optional(), easierMaintenance: z.boolean().optional() }).strict();
export const recommendAccessories = defineTool({
  name: "recommend_accessories",
  description: "Suggest accessories (surge protection, monitoring, backup, EV, maintenance) for a chosen system size. No prices are available.",
  schema: z.object({ ...propertyFields, ...demandFields, nominalKw: z.number().finite().min(0.25).max(100), goals: accessoryGoals.optional() }).strict(),
  async run(input, context) {
    const analysis = await resolveAnalysis(context, input.propertyId, input.analysisId);
    if (!analysis) return noRoofOutput(context, input.propertyId);
    const built = demandOrQuestion(context, input);
    if ("question" in built) return built.question;
    const result = await context.services.accessories.recommend(context.identity, { propertyId: input.propertyId,
      analysisId: analysis.analysisId, demand: built.demand, generationKwhPerKwYear: DEFAULT_GENERATION_KWH_PER_KW_YEAR,
      nominalKw: input.nominalKw, ...(input.goals ? { goals: input.goals } : {}) }, context.requestId);
    return { modelSummary: `Accessories for ${input.nominalKw} kW: ${result.recommendations.map(item => `${item.title} (${item.classification})`).join("; ")}. ${result.warnings.join(" ")}`,
      cards: [card(context, "SYSTEM_OPTIONS", "Suggested accessories", {
        items: result.recommendations.map(item => ({ label: item.title, detail: `${item.classification.replace(/_/g, " ").toLowerCase()}: ${item.reason}` })),
        bullets: result.warnings, disclaimer: "Accessory prices and policy requirements are not verified." },
      { provenance: { source: "DETERMINISTIC_ACCESSORY_ADVISOR_V1", verificationStatus: "INDICATIVE" } })] };
  },
});

const COST_BASES = ["USER_QUOTE", "INDICATIVE_QUOTE"] as const;
export const estimateSavings = defineTool({
  name: "estimate_savings",
  description: "Estimate yearly cash flow, payback and 25-year savings for a chosen system size. Needs the user's installer quote total (or an indicative quote typical value with costSource INDICATIVE_QUOTE) and tariff. Optionally adds verified benefits when all applicant facts are given.",
  schema: z.object({
    ...propertyFields, ...demandFields, ...applicantFactFields,
    nominalKw: z.number().finite().min(0.1).max(100),
    importTariffRupeesPerKwh: z.number().finite().min(0.1).max(100).optional(),
    grossSystemCostRupees: z.number().finite().min(1_000).max(50_000_000).optional(),
    costSource: z.enum(COST_BASES).optional(),
    selfConsumptionFraction: z.number().finite().min(0).max(1).optional(),
    exportRateRupeesPerKwh: z.number().finite().min(0).max(100).optional(),
    annualMaintenanceRupees: z.number().finite().min(0).max(5_000_000).optional(),
  }).strict(),
  async run(input, context): Promise<ToolOutput> {
    const analysis = await resolveAnalysis(context, input.propertyId, input.analysisId);
    if (!analysis) return noRoofOutput(context, input.propertyId);
    const built = demandOrQuestion(context, input);
    if ("question" in built) return built.question;
    const tariff = input.importTariffRupeesPerKwh ?? (built.demand.kind === "BILL" ? built.demand.tariffRupeesPerKwh : undefined);
    if (tariff === undefined) return question(context, "tariff_rupees_per_kwh", "What do you pay per unit (rupees per kWh)? It is printed on your bill.", [], { freeText: true });
    if (!claimedByUser(context, tariff) && input.importTariffRupeesPerKwh !== undefined) return unconfirmedFigure(context, "tariff_rupees_per_kwh", tariff);
    const cost = input.grossSystemCostRupees;
    if (cost === undefined) {
      return question(context, "gross_system_cost_rupees", "What is the total price on your installer's quote (in rupees)? If you have no quote yet, I can show an indicative range once I know your state and panel type.", [], { freeText: true });
    }
    const basis = input.costSource ?? "USER_QUOTE";
    const grounded = [...context.userFigures].some(figure => Math.abs(figure - cost) <= Math.max(0.5, cost * 0.005));
    const fromQuote = basis === "INDICATIVE_QUOTE" && contextGroundingHas(context, cost);
    if (!grounded && !fromQuote) return unconfirmedFigure(context, "system_cost_rupees", cost);
    const financialInputs = { grossSystemCostRupees: cost, selfConsumptionFraction: input.selfConsumptionFraction ?? 0.9,
      importTariffRupeesPerKwh: tariff, exportRateRupeesPerKwh: input.exportRateRupeesPerKwh ?? 0,
      annualMaintenanceRupees: input.annualMaintenanceRupees ?? 0 };
    const assumptions = [
      { label: "Share of solar power you use yourself", value: pct(financialInputs.selfConsumptionFraction), note: input.selfConsumptionFraction === undefined ? "Illustrative default" : "As you stated" },
      { label: "Value of exported power", value: `${inr(financialInputs.exportRateRupeesPerKwh)} per kWh`, note: input.exportRateRupeesPerKwh === undefined ? "Illustrative default" : "As you stated" },
      { label: "Yearly maintenance", value: inr(financialInputs.annualMaintenanceRupees), note: input.annualMaintenanceRupees === undefined ? "Illustrative default" : "As you stated" },
      { label: "Your power tariff", value: `${inr(tariff)} per kWh` },
      { label: "System cost used", value: inr(cost), note: basis === "USER_QUOTE" ? "Your quote" : "Indicative benchmark, not an offer" }];
    const facts: ApplicantFactInput = { state: input.state, district: input.district, discom: input.discom, customerType: input.customerType,
      propertyType: input.propertyType, ownership: input.ownership, gridConnected: input.gridConnected, priorSubsidyReceived: input.priorSubsidyReceived };
    const complete = !!(facts.state && facts.customerType && facts.ownership && facts.gridConnected !== undefined && facts.priorSubsidyReceived !== undefined);
    const base = { propertyId: input.propertyId, analysisId: analysis.analysisId, demand: built.demand,
      generationKwhPerKwYear: DEFAULT_GENERATION_KWH_PER_KW_YEAR, nominalKw: input.nominalKw, financialInputs };
    let withBenefits: Awaited<ReturnType<ToolContext["services"]["policyFinancials"]["estimate"]>> | undefined;
    let estimate: Awaited<ReturnType<ToolContext["services"]["financials"]["estimate"]>>;
    if (complete) {
      withBenefits = await context.services.policyFinancials.estimate(context.identity, { ...base,
        applicantFacts: { country: "IN", ...Object.fromEntries(Object.entries(facts).filter(([, value]) => value !== undefined)) } }, context.requestId);
      estimate = { ...withBenefits, financial: withBenefits.base } as unknown as typeof estimate;
    } else estimate = await context.services.financials.estimate(context.identity, base, context.requestId);
    const totals = estimate.financial.totals;
    const projection = withBenefits?.status === "AVAILABLE" ? withBenefits.projection : undefined;
    const rows = [
      { label: "System", value: `${kw(estimate.system.actualDcKw)} DC, about ${kwh(estimate.system.estimatedAnnualGenerationKwh)} per year` },
      { label: "Year-one net cash flow", value: inr(totals.yearOneNetCashFlowRupees), emphasis: true },
      { label: "Payback (no subsidy)", value: years(totals.paybackYears), emphasis: true },
      { label: "25-year net savings (no subsidy)", value: inr(totals.netSavingsOver25YearsRupees) },
      ...(projection ? [
        { label: "Verified benefits counted", value: inrFromPaise(projection.totalEligibleBenefitPaise), note: projection.coverageComplete ? "Coverage complete for verified rules" : "Coverage incomplete: other benefits may exist" },
        { label: "Net upfront cost after benefits", value: inrFromPaise(projection.netUpfrontCostPaise) },
        { label: "Payback with verified benefits", value: years(projection.totals.paybackYears), emphasis: true }] : [])];
    const summary = `System actual DC ${estimate.system.actualDcKw} kW, about ${Math.round(estimate.system.estimatedAnnualGenerationKwh)} kWh per year. ` +
      `Cost used ${inr(cost)} (${basis}). Year-one net cash flow ${inr(totals.yearOneNetCashFlowRupees)}. ` +
      `Payback ${totals.paybackYears === null ? "not within 25 years" : `${totals.paybackYears.toFixed(1)} years`} before any subsidy. ` +
      `25-year net savings ${inr(totals.netSavingsOver25YearsRupees)}. ` +
      (projection ? `Verified benefits ${inrFromPaise(projection.totalEligibleBenefitPaise)}; net upfront ${inrFromPaise(projection.netUpfrontCostPaise)}; payback with benefits ${projection.totals.paybackYears === null ? "not within 25 years" : `${projection.totals.paybackYears.toFixed(1)} years`}${projection.coverageComplete ? "" : "; coverage incomplete so do not call it the maximum"}. `
        : withBenefits ? `Benefits unavailable (${(withBenefits.reasonCodes ?? []).join(", ")}). ` : "Benefits not evaluated. ") +
      `Assumptions: ${assumptions.map(item => `${item.label} ${item.value}`).join("; ")}.`;
    return { modelSummary: summary, cards: [card(context, "SAVINGS", "Estimated savings",
      { summary: "Scenario calculation from your inputs, not a guarantee.", rows, bullets: assumptions.map(item => `${item.label}: ${item.value}${item.note ? ` (${item.note})` : ""}`),
        disclaimer: "Estimates depend on tariffs, usage, weather and the assumptions listed. Subsidy payment is not guaranteed.",
        action: { label: "Open financial estimator", href: analysisHref(input.propertyId) } },
      { provenance: { source: projection ? "DETERMINISTIC_POLICY_FINANCIAL_V1" : "DETERMINISTIC_BASE_FINANCIAL_V1", verificationStatus: "INDICATIVE" } })] };
  },
});

function contextGroundingHas(context: ToolContext, value: number) {
  return context.grounding.has({ kind: "money", value, precision: 0, unitSize: 1, start: 0, end: 0 });
}
