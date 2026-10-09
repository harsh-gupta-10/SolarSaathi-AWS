import { createHash } from "node:crypto";
import type { CurrentIdentityResponse } from "@solarsaathi/types";
import { CoreService } from "../data/service";
import { parseInput } from "../data/schemas";
import { RequestError } from "../lib/http";
import { PolicyFinancialsService } from "../financials/policy-service";
import { FinancialsService } from "../financials/service";
import { ApplicationService } from "../applications/service";
import { advisorRequestSchema, type AdvisorCardV1, type AdvisorResponseV1 } from "./schema";
import type { AdvisorIntent, FactSelector } from "./bedrock";

function intent(question: string): AdvisorIntent {
  const text = question.toLowerCase();
  if (/\b(application|apply|tracking|tracker|vendor|document|reference|next step|inspection|meter)\b/.test(text)) return "APPLICATION";
  if (/\b(subsidy|benefit|scheme|eligib\w*|policy|incentive)\b/.test(text)) return "BENEFIT";
  if (/\b(cost|savings|payback|bill|financial|return|cash flow|quote)\b/.test(text)) return "FINANCIAL";
  if (/\b(panel|system|capacity|kilowatt|kw|generation)\b/.test(text)) return "SYSTEM";
  if (/\b(roof|area|sunshine|building)\b/.test(text)) return "ROOF";
  return "GENERAL";
}

const inr = (paise: number) => `₹${new Intl.NumberFormat("en-IN", {
  minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(paise / 100)}`;
const rupees = (amount: number) => `₹${new Intl.NumberFormat("en-IN", {
  maximumFractionDigits: 2 }).format(amount)}`;
const limited = (value: string) => value.length > 2_000 ? value.slice(0, 1_997) + "..." : value;
const relevantKinds: Record<AdvisorIntent, AdvisorCardV1["kind"][]> = {
  ROOF: ["ROOF"], SYSTEM: ["SYSTEM", "ROOF"], FINANCIAL: ["FINANCIAL", "SYSTEM"],
  BENEFIT: ["BENEFIT"], APPLICATION: ["APPLICATION"], GENERAL: ["ROOF", "SYSTEM", "FINANCIAL", "BENEFIT", "APPLICATION"],
};

export class AdvisorService {
  constructor(private readonly core: CoreService, private readonly financials: PolicyFinancialsService,
    private readonly baseFinancials: FinancialsService, private readonly applications: ApplicationService,
    private readonly selector?: FactSelector) {}

  async answer(identity: CurrentIdentityResponse, body: unknown, requestId: string): Promise<AdvisorResponseV1> {
    const input = parseInput(advisorRequestSchema, body);
    const category = intent(input.question);
    const analysis = await this.core.getAnalysis(identity, input.propertyId, input.analysisId);
    if (!analysis.roofModel) throw new RequestError(409, "ROOF_MODEL_REQUIRED", "Confirm roof measurements before asking about this assessment.");
    const cards: AdvisorCardV1[] = [];
    const caveats: string[] = [];
    const missingContext: string[] = [];
    cards.push({ id: "roof", kind: "ROOF",
      statement: limited(`The confirmed ${analysis.roof.source === "MANUAL" ? "user-measured" : "Google Solar modeled"} roof has ${analysis.roof.roofAreaSquareMeters.toFixed(1)} m² across ${analysis.roof.segmentCount} modeled segment${analysis.roof.segmentCount === 1 ? "" : "s"}, measured ${analysis.roof.measuredAt.slice(0, 10)}. This is not structural approval.`),
      provenance: analysis.roof.source === "MANUAL" ? "USER_MEASURED" : "GOOGLE_SOLAR" });
    caveats.push("Roof measurements and system estimates are planning information, not structural approval.");

    if (input.scenario) {
      const scenarioInput = { propertyId: input.propertyId, analysisId: input.analysisId, ...input.scenario };
      let scenario: Awaited<ReturnType<PolicyFinancialsService["estimate"]>> | undefined;
      try { scenario = await this.financials.estimate(identity, scenarioInput, requestId); }
      catch (error) {
        if (!(error instanceof RequestError) || error.statusCode !== 503 ||
          !/^(?:BENEFIT|POLICY)_/.test(error.code)) throw error;
        caveats.push("Current policy evaluation is unavailable; only the unsubsidized base is shown.");
      }
      const base = scenario ?? await this.baseFinancials.estimate(identity, {
        propertyId: input.propertyId, analysisId: input.analysisId, demand: input.scenario.demand,
        generationKwhPerKwYear: input.scenario.generationKwhPerKwYear,
        nominalKw: input.scenario.nominalKw, financialInputs: input.scenario.financialInputs,
      }, requestId);
      if (base.propertyId !== input.propertyId || base.analysisId !== input.analysisId || base.requestId !== requestId) {
        throw new RequestError(503, "ADVISOR_CONTEXT_MISMATCH", "The calculated scenario does not match this assessment.");
      }
      cards.push({ id: "system", kind: "SYSTEM", provenance: "DETERMINISTIC_CALCULATION",
        statement: limited(`The roof-fitting ${base.system.nominalKw} kW candidate models ${base.system.actualDcKw.toFixed(2)} kW DC and ${Math.round(base.system.estimatedAnnualGenerationKwh)} kWh in year one. Generation is an estimate.`) });
      const financial = scenario ? scenario.base : "financial" in base ? base.financial : undefined;
      if (!financial) throw new RequestError(503, "ADVISOR_CONTEXT_MISMATCH", "The base calculation is unavailable.");
      cards.push({ id: "base-financial", kind: "FINANCIAL", provenance: "DETERMINISTIC_CALCULATION",
        statement: limited(`With your ${rupees(financial.input.quote.grossSystemCostRupees)} gross quote, the unsubsidized model has ${rupees(financial.totals.yearOneNetCashFlowRupees)} year-one net cash flow and ${financial.totals.paybackYears === null ? "no modeled payback within 25 years" : `${financial.totals.paybackYears.toFixed(1)} years modeled payback`}. These are scenario calculations, not guaranteed savings.`) });
      if (scenario?.benefits.status === "AVAILABLE") {
        for (const decision of scenario.benefits.result.decisions) {
          if (decision.status !== "SELECTED" || !decision.countedAmountPaise ||
            decision.sourceChecks.some(check => !check.fresh || check.status !== "HEALTHY" || !check.lastCheckedAt)) continue;
          const cardId = `benefit-${createHash("sha256").update(`${decision.benefitId}\0${decision.ruleId}`).digest("hex").slice(0, 24)}`;
          cards.push({ id: cardId, kind: "BENEFIT", provenance: "VERIFIED_POLICY",
            statement: limited(`${decision.scope} rule ${decision.ruleId} calculates ${inr(decision.calculatedAmountPaise ?? decision.countedAmountPaise)}. ${decision.countedAmountPaise < (decision.calculatedAmountPaise ?? decision.countedAmountPaise) ? `The verified combined stack counts ${inr(decision.countedAmountPaise)} after its shared cap.` : `The compatible selected stack counts ${inr(decision.countedAmountPaise)}.`} Eligibility and payment are not guaranteed.`),
            citations: decision.citations, policyId: decision.policyId, policyVersion: decision.policyVersion,
            jurisdiction: decision.jurisdiction, effectiveFrom: decision.effectiveFrom,
            ...(decision.effectiveTo ? { effectiveTo: decision.effectiveTo } : {}),
            verificationStatus: "VERIFIED", lastVerifiedAt: decision.lastVerifiedAt,
            sourceChecks: decision.sourceChecks });
        }
        if (!scenario.benefits.result.coverageComplete) caveats.push("Policy coverage is incomplete; unlisted benefits may exist.");
        if (scenario.benefits.result.decisions.some(decision => decision.status === "UNKNOWN")) {
          caveats.push("Some benefit decisions remain unknown because declared facts are incomplete.");
        }
      } else caveats.push("No current verified benefit amount was available for this scenario.");
      if (category === "BENEFIT" && !cards.some(card => card.kind === "BENEFIT")) {
        missingContext.push("A current selected verified benefit is unavailable for these declared facts.");
      }
      caveats.push("Benefit payment timing and final approval must be confirmed with the official scheme or utility.");
    } else if (["SYSTEM", "FINANCIAL", "BENEFIT"].includes(category)) {
      missingContext.push("Provide a quote, usage and applicant facts to calculate financial or benefit answers.");
    }

    if (input.applicationId) {
      const application = await this.applications.get(identity, input.propertyId, input.applicationId);
      if (application.analysisId !== input.analysisId) throw new RequestError(409, "APPLICATION_ANALYSIS_MISMATCH",
        "This tracker belongs to a different roof assessment.");
      const completed = application.steps.filter(step => step.status === "COMPLETED").length;
      const next = application.steps.find(step => step.stepId === application.expectedNextStepId);
      cards.push({ id: "application", kind: "APPLICATION", provenance: "USER_REPORTED",
        statement: limited(`Your saved tracker reports ${completed} of ${application.steps.length} steps completed.${next ? ` The next listed step is ${next.title}.` : " No next step is listed."} This is user-reported progress, not a confirmation from the government or utility.`) });
    } else if (category === "APPLICATION") missingContext.push("Choose an application tracker for status or next-step guidance.");

    const relevant = cards.filter(card => relevantKinds[category].includes(card.kind));
    const fallbackIds = relevant.slice(0, 8).map(card => card.id);
    let selectedCardIds = fallbackIds;
    let mode: AdvisorResponseV1["mode"] = "DETERMINISTIC_FALLBACK";
    if (this.selector && relevant.length) {
      const chosen = await this.selector.select(category, relevant);
      if (chosen?.length && new Set(chosen).size === chosen.length &&
        chosen.every(id => relevant.some(card => card.id === id))) {
        selectedCardIds = chosen;
        mode = "BEDROCK_FACT_SELECTION";
      }
    }
    const selected = selectedCardIds.map(id => cards.find(card => card.id === id)!).filter(Boolean);
    const status = selected.length ? "ANSWERED" as const : "INSUFFICIENT_CONTEXT" as const;
    const answer = selected.length ? selected.map(card => card.statement).join("\n\n").slice(0, 10_000) :
      category === "BENEFIT" ? "I cannot confirm a current benefit from this assessment and declared facts yet." :
        category === "APPLICATION" ? "Choose a saved application tracker to review its user-reported progress." :
          "I need more confirmed assessment details to answer that question.";
    return { schemaVersion: 1, source: "GROUNDED_ADVISOR_V1", requestId,
      propertyId: input.propertyId, analysisId: input.analysisId, status, mode, answer,
      cards: cards.slice(0, 32), selectedCardIds, caveats, missingContext };
  }
}
