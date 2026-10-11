import { z } from "zod";
import { regionCodes } from "../../pricing/states";
import {
  applicantFactFields, card, claimedByUser, demandFields, demandOrQuestion, DEFAULT_GENERATION_KWH_PER_KW_YEAR, inrFromPaise,
  missingFactQuestion, noRoofOutput, propertyFields, resolveAnalysis, unconfirmedFigure, type ApplicantFactInput, type DemandInput,
} from "./support";
import { defineTool, type ToolContext, type ToolOutput } from "./types";

export const benefitInput = z.object({
  ...propertyFields, ...demandFields, ...applicantFactFields,
  nominalKw: z.number().finite().min(0.1).max(100),
  eligibleQuotedCostRupees: z.number().finite().min(1_000).max(10_000_000_000).optional(),
}).strict();
export type BenefitInput = z.infer<typeof benefitInput>;

export function applicantFacts(input: BenefitInput) {
  const facts: ApplicantFactInput = { state: input.state, district: input.district, discom: input.discom, customerType: input.customerType,
    propertyType: input.propertyType, ownership: input.ownership, gridConnected: input.gridConnected, priorSubsidyReceived: input.priorSubsidyReceived };
  return facts;
}

export type BenefitEvaluation = Awaited<ReturnType<ToolContext["services"]["benefits"]["evaluate"]>>;
export interface PreparedBenefits { analysisId: string; evaluation: BenefitEvaluation; demand: ReturnType<typeof requireDemand> }
function requireDemand(demand: unknown) { return demand as { kind: "CONSUMPTION" | "BILL" } & Record<string, number | string>; }

/** Shared by check_benefits and prepare_application: roof, demand, applicant facts, then the deterministic evaluation. */
export async function prepareBenefits(input: BenefitInput, context: ToolContext):
Promise<{ output: ToolOutput } | { prepared: PreparedBenefits; eligibleQuotedCostPaise?: number }> {
  const analysis = await resolveAnalysis(context, input.propertyId, input.analysisId);
  if (!analysis) return { output: noRoofOutput(context, input.propertyId) };
  const built = demandOrQuestion(context, input as DemandInput);
  if ("question" in built) return { output: built.question };
  const missing = missingFactQuestion(context, applicantFacts(input));
  if (missing) return { output: missing };
  if (input.eligibleQuotedCostRupees !== undefined && !claimedByUser(context, input.eligibleQuotedCostRupees)) {
    return { output: unconfirmedFigure(context, "eligible_cost_rupees", input.eligibleQuotedCostRupees) };
  }
  const eligibleQuotedCostPaise = input.eligibleQuotedCostRupees === undefined ? undefined : Math.round(input.eligibleQuotedCostRupees * 100);
  const facts = Object.fromEntries(Object.entries(applicantFacts(input)).filter(([, value]) => value !== undefined));
  const evaluation = await context.services.benefits.evaluate(context.identity, {
    propertyId: input.propertyId, analysisId: analysis.analysisId, demand: built.demand,
    generationKwhPerKwYear: DEFAULT_GENERATION_KWH_PER_KW_YEAR, nominalKw: input.nominalKw,
    ...(eligibleQuotedCostPaise === undefined ? {} : { eligibleQuotedCostPaise }),
    applicantFacts: { country: "IN", ...facts, ...(input.sanctionedLoadKw ? { sanctionedLoadWatts: Math.round(input.sanctionedLoadKw * 1_000) } : {}) },
  }, context.requestId);
  return { prepared: { analysisId: analysis.analysisId, evaluation, demand: requireDemand(built.demand) },
    ...(eligibleQuotedCostPaise === undefined ? {} : { eligibleQuotedCostPaise }) };
}

const REASON_TEXT: Record<string, string> = {
  APPLICANT_FACTS_UNKNOWN: "More applicant facts are needed", ELIGIBLE_COST_UNKNOWN: "The eligible cost is needed",
  JURISDICTION_UNKNOWN: "State or district is needed",
};

export const checkBenefits = defineTool({
  name: "check_benefits",
  description: "Evaluate verified central, state and DISCOM benefits for a confirmed roof and chosen system size. If applicant facts are missing it asks the user one question at a time. Never claim a maximum before coverage is complete.",
  schema: benefitInput,
  async run(input, context): Promise<ToolOutput> {
    const result = await prepareBenefits(input, context);
    if ("output" in result) return result.output;
    const { evaluation } = result.prepared;
    const href = `/app/analyze?propertyId=${encodeURIComponent(input.propertyId)}`;
    if (evaluation.status !== "AVAILABLE") {
      const codes = evaluation.reasonCodes ?? [];
      return { modelSummary: `BENEFITS_UNAVAILABLE reasons ${codes.join(", ")}. No verified benefit amount can be stated. Do not guess a subsidy.`,
        cards: [card(context, "BENEFITS", "Benefits not available yet", { summary: "I cannot confirm a current verified benefit for these facts right now.",
          bullets: codes.map(code => REASON_TEXT[code] ?? code.replace(/_/g, " ").toLowerCase()), action: { label: "Open benefit evaluator", href },
          disclaimer: "Never assume a subsidy that has not been verified against official sources." },
        { provenance: { source: "DETERMINISTIC_BENEFIT_STACK_V1", verificationStatus: "UNVERIFIED", lastCheckedAt: evaluation.evaluatedAt } })] };
    }
    const stack = evaluation.result;
    const selected = stack.decisions.filter(item => item.status === "SELECTED" && (item.countedAmountPaise ?? 0) > 0);
    const rows = stack.decisions.map(item => ({
      label: `${item.scope} benefit (${item.jurisdiction})`,
      value: item.status === "SELECTED" ? inrFromPaise(item.countedAmountPaise ?? 0) :
        item.status === "UNKNOWN" ? "More information needed" : item.status === "INELIGIBLE" ? "Not eligible" : "Not in compatible combination",
      note: `Policy version ${item.policyVersion}, effective ${item.effectiveFrom}, verified ${item.lastVerifiedAt.slice(0, 10)}`,
      emphasis: item.status === "SELECTED" }));
    const links = [...new Map(stack.decisions.flatMap(item => item.citations).map(citation =>
      [citation.sourceUrl, { label: citation.publisherName, url: citation.sourceUrl }])).values()].slice(0, 6);
    const summary = `Verified benefit stack total counted ${inrFromPaise(stack.totalEligibleBenefitPaise)}. ` +
      `Decisions: ${stack.decisions.map(item => `${item.scope} ${item.status}${item.status === "SELECTED" ? ` ${inrFromPaise(item.countedAmountPaise ?? 0)}` : ""} policy ${item.policyId} v${item.policyVersion} [${item.reasonCodes.join("|")}]`).join("; ")}. ` +
      (stack.coverageComplete ? "Coverage is complete for verified rules, but payment is never guaranteed." :
        "Coverage is INCOMPLETE: other benefits may exist. Do not call this the maximum possible subsidy.");
    return { modelSummary: summary, cards: [card(context, "BENEFITS", selected.length ? "Benefits you may qualify for" : "Benefit check result",
      { summary: selected.length ? `Verified benefits counted: ${inrFromPaise(stack.totalEligibleBenefitPaise)}` : "No verified benefit is currently selected for these facts.",
        rows, bullets: stack.warnings.map(item => item.replace(/_/g, " ").toLowerCase()),
        disclaimer: "Eligibility and payment are decided by the scheme or utility. Overlapping benefits are not double-counted.",
        action: { label: "Open benefit evaluator", href } },
      { provenance: {
        source: "DETERMINISTIC_BENEFIT_STACK_V1", verificationStatus: selected.length ? "VERIFIED" : "INDICATIVE",
        jurisdiction: selected[0]?.jurisdiction ?? "IN", ...(selected[0] ? { effectiveDate: selected[0].effectiveFrom, policyVersion: selected[0].policyVersion } : {}),
        lastCheckedAt: evaluation.evaluatedAt, links } })] };
  },
});

export const explainPolicy = defineTool({
  name: "explain_policy",
  description: "Read-only: list currently active, verified policy records for India and optionally one state, with versions, effective dates and official sources. Use for 'how does the scheme work' questions.",
  schema: z.object({ state: z.enum(regionCodes).optional() }).strict(),
  async run(input, context) {
    const jurisdictions = input.state ? ["IN", `IN-${input.state}`] : ["IN"];
    const bundles = await context.services.publication.listActive(jurisdictions, 17);
    if (!bundles.length) {
      return { modelSummary: "NO_ACTIVE_VERIFIED_POLICY_RECORDS for this jurisdiction. Say so; do not describe schemes from memory.",
        cards: [card(context, "NOTICE", "No verified policy record", { summary: "No verified policy record is available here yet, so I will not describe benefit amounts.",
          disclaimer: "Check the official MNRE, state energy department or DISCOM website." }, { provenance: { source: "POLICY_CATALOG", verificationStatus: "UNVERIFIED" } })] };
    }
    const links = [...new Map(bundles.flatMap(bundle => bundle.facts.map(fact => fact.citation)).map(citation =>
      [citation.sourceUrl, { label: citation.publisherName, url: citation.sourceUrl }])).values()].slice(0, 8);
    const lines = bundles.map(bundle => ({ label: `${bundle.rule.scope} ${bundle.rule.jurisdiction}`,
      detail: `Policy version ${bundle.version.version}, effective ${bundle.rule.effectiveFrom}${bundle.rule.effectiveTo ? ` to ${bundle.rule.effectiveTo}` : ""}, ` +
        `verification ${bundle.version.verificationStatus}, last verified ${bundle.version.lastVerifiedAt?.slice(0, 10) ?? "unknown"}. ` +
        (bundle.rule.processSteps ? `Process steps: ${bundle.rule.processSteps.map(step => step.title).join("; ")}.` : "No process steps published.") }));
    return { modelSummary: `Active verified policy records: ${bundles.map(bundle =>
      `${bundle.policyId} v${bundle.version.version} ${bundle.rule.scope} ${bundle.rule.jurisdiction} effective ${bundle.rule.effectiveFrom} (${bundle.version.verificationStatus})`).join("; ")}. ` +
      "Amounts are calculated by check_benefits, not from this list.",
    cards: [card(context, "BENEFITS", "Official policy records", { summary: "Active verified records with their effective dates and sources.", items: lines,
      disclaimer: "Benefit amounts are calculated for your facts with the benefit check.", },
    { provenance: { source: "POLICY_CATALOG", verificationStatus: "VERIFIED", jurisdiction: input.state ? `IN-${input.state}` : "IN", links,
      lastCheckedAt: bundles.map(bundle => bundle.version.lastVerifiedAt ?? "").sort().at(-1) || undefined } })] };
  },
});
