import type { NormalizedRoofV1 } from "@solarsaathi/types";
import { planRoofLayout, type RoofFitStatus, type RoofLayoutAssumptions, type RoofLayoutWarning } from "./roof-layout";

export type SystemDemand =
  | { kind: "CONSUMPTION"; monthlyConsumptionKwh: number; sanctionedLoadKw?: number }
  | { kind: "BILL"; monthlyBillRupees: number; tariffRupeesPerKwh: number; sanctionedLoadKw?: number };

export interface SystemDesignAssumptionsV1 {
  schemaVersion: 1;
  roofLayout: RoofLayoutAssumptions;
  /** Nominal candidate sizes; actual DC capacity uses an integer panel count. */
  candidateNominalKw: readonly number[];
  /** Site-independent, explicitly editable planning yield when Google panel energy is unavailable. */
  generationKwhPerKwYear: number;
  /** Google yearlyEnergyDcKwh multiplied by this explicit factor to estimate delivered AC energy. */
  googleDcToAcEnergyFactor: number;
  /** Actual panel DC kW divided by this ratio gives the minimum modeled inverter AC kW. */
  inverterDcAcRatio: number;
  targetCoverageFraction: number;
  maximumGenerationToDemandRatio: number;
}

export type SystemGenerationBasis = "GOOGLE_DC_DERATED" | "ASSUMED_YIELD";
export type CandidateRoofFit = RoofFitStatus | "EXCEEDS_MODELED_ROOF";
export type SystemCandidateReason =
  | "ROOF_FIT_UNDETERMINED"
  | "EXCEEDS_MODELED_ROOF"
  | "SANCTIONED_LOAD_REVIEW_NEEDED"
  | "EXCEEDS_DEMAND_LIMIT"
  | "ZERO_MODELED_GENERATION";
export type SystemDesignDecision =
  | "RECOMMENDED_CLOSEST_TO_TARGET"
  | "ROOF_FIT_UNDETERMINED"
  | "NO_CANDIDATE_WITHIN_ROOF"
  | "NO_CANDIDATE_WITH_MODELED_GENERATION"
  | "NO_CANDIDATE_WITHIN_DEMAND_LIMIT";
export type SystemDesignWarning =
  | "LOCAL_RULES_NOT_CHECKED"
  | "SANCTIONED_LOAD_NOT_PROVIDED"
  | "SANCTIONED_LOAD_REVIEW_NEEDED"
  | "BILL_TO_KWH_IS_APPROXIMATE"
  | "GOOGLE_ROOF_FIT_APPROXIMATE"
  | "MANUAL_FIT_NEEDS_SITE_SURVEY"
  | "ASSUMED_YIELD_USED"
  | "GOOGLE_DC_TO_AC_FACTOR_ASSUMED";

export interface SystemCandidate {
  nominalKw: number;
  panelCount: number;
  actualDcKw: number;
  /** Minimum AC nameplate estimate; no equipment model or standard size is implied. */
  minimumInverterAcKw: number;
  estimatedAnnualGenerationKwh: number;
  generationBasis: SystemGenerationBasis;
  annualConsumptionCoverageRatio: number;
  roofFit: CandidateRoofFit;
  recommendationEligible: boolean;
  reasonCodes: SystemCandidateReason[];
}

export interface SystemDemandSummary {
  source: "DIRECT_CONSUMPTION" | "BILL_ESTIMATE";
  monthlyConsumptionKwh: number;
  annualConsumptionKwh: number;
  sanctionedLoadKw?: number;
  monthlyBillRupees?: number;
  tariffRupeesPerKwh?: number;
}

export interface SystemDesignResult {
  schemaVersion: 1;
  source: "DETERMINISTIC_SYSTEM_DESIGN_V1";
  assumptions: SystemDesignAssumptionsV1;
  demand: SystemDemandSummary;
  roof: {
    source: NormalizedRoofV1["source"];
    fitStatus: RoofFitStatus;
    maxPanelCount: number | null;
    maxModeledDcKw: number | null;
    layoutWarnings: RoofLayoutWarning[];
  };
  candidates: SystemCandidate[];
  recommendation: SystemCandidate | null;
  decisionCode: SystemDesignDecision;
  warnings: SystemDesignWarning[];
}

function positive(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`Invalid ${label}.`);
}

function validateAssumptions(assumptions: SystemDesignAssumptionsV1): number[] {
  if (assumptions.schemaVersion !== 1 || !Array.isArray(assumptions.candidateNominalKw) ||
    assumptions.candidateNominalKw.length === 0 || assumptions.candidateNominalKw.length > 100) {
    throw new RangeError("Unsupported system design assumptions.");
  }
  positive(assumptions.generationKwhPerKwYear, "generation yield assumption");
  positive(assumptions.googleDcToAcEnergyFactor, "Google DC-to-AC energy factor");
  if (assumptions.googleDcToAcEnergyFactor > 1) throw new RangeError("Invalid Google DC-to-AC energy factor.");
  positive(assumptions.inverterDcAcRatio, "inverter DC-to-AC ratio");
  positive(assumptions.targetCoverageFraction, "target coverage fraction");
  positive(assumptions.maximumGenerationToDemandRatio, "maximum generation-to-demand ratio");
  const targets = [...assumptions.candidateNominalKw];
  targets.forEach(target => positive(target, "candidate size"));
  if (new Set(targets).size !== targets.length) throw new RangeError("Duplicate candidate size.");
  targets.sort((a, b) => a - b);
  return targets;
}

function demandSummary(demand: SystemDemand): SystemDemandSummary {
  if (demand.sanctionedLoadKw !== undefined) positive(demand.sanctionedLoadKw, "sanctioned load");
  if (demand.kind === "CONSUMPTION") {
    positive(demand.monthlyConsumptionKwh, "monthly consumption");
    const annualConsumptionKwh = demand.monthlyConsumptionKwh * 12;
    positive(annualConsumptionKwh, "annual consumption");
    return { source: "DIRECT_CONSUMPTION", monthlyConsumptionKwh: demand.monthlyConsumptionKwh,
      annualConsumptionKwh, ...(demand.sanctionedLoadKw === undefined ? {} : { sanctionedLoadKw: demand.sanctionedLoadKw }) };
  }
  if (demand.kind === "BILL") {
    positive(demand.monthlyBillRupees, "monthly bill");
    positive(demand.tariffRupeesPerKwh, "tariff");
    const monthlyConsumptionKwh = demand.monthlyBillRupees / demand.tariffRupeesPerKwh;
    positive(monthlyConsumptionKwh, "consumption inferred from bill");
    const annualConsumptionKwh = monthlyConsumptionKwh * 12;
    positive(annualConsumptionKwh, "annual consumption");
    return { source: "BILL_ESTIMATE", monthlyConsumptionKwh, annualConsumptionKwh,
      monthlyBillRupees: demand.monthlyBillRupees, tariffRupeesPerKwh: demand.tariffRupeesPerKwh,
      ...(demand.sanctionedLoadKw === undefined ? {} : { sanctionedLoadKw: demand.sanctionedLoadKw }) };
  }
  throw new RangeError("Unsupported demand input.");
}

function decisionFor(candidates: SystemCandidate[], maxPanelCount: number | null): SystemDesignDecision {
  if (maxPanelCount === null) return "ROOF_FIT_UNDETERMINED";
  if (!candidates.some(candidate => candidate.roofFit !== "EXCEEDS_MODELED_ROOF")) return "NO_CANDIDATE_WITHIN_ROOF";
  if (!candidates.some(candidate => candidate.roofFit !== "EXCEEDS_MODELED_ROOF" &&
    !candidate.reasonCodes.includes("ZERO_MODELED_GENERATION"))) return "NO_CANDIDATE_WITH_MODELED_GENERATION";
  return "NO_CANDIDATE_WITHIN_DEMAND_LIMIT";
}

/** Pure planning logic; no subsidy, tariff savings, policy eligibility, or LLM decisions. */
export function designSolarSystem(roof: NormalizedRoofV1, demand: SystemDemand,
  assumptions: SystemDesignAssumptionsV1): SystemDesignResult {
  const targets = validateAssumptions(assumptions);
  const consumption = demandSummary(demand);
  const layout = planRoofLayout(roof, assumptions.roofLayout);
  const warnings = new Set<SystemDesignWarning>(["LOCAL_RULES_NOT_CHECKED"]);
  if (consumption.sanctionedLoadKw === undefined) warnings.add("SANCTIONED_LOAD_NOT_PROVIDED");
  if (consumption.source === "BILL_ESTIMATE") warnings.add("BILL_TO_KWH_IS_APPROXIMATE");
  if (layout.fitStatus === "MODELED_APPROXIMATE") warnings.add("GOOGLE_ROOF_FIT_APPROXIMATE");
  if (layout.fitStatus === "SPACE_FEASIBLE") warnings.add("MANUAL_FIT_NEEDS_SITE_SURVEY");

  const candidates: SystemCandidate[] = targets.map(nominalKw => {
    const panelCount = Math.ceil(nominalKw * 1_000 / assumptions.roofLayout.panelCapacityWatts);
    if (!Number.isSafeInteger(panelCount) || panelCount < 1) throw new RangeError("Candidate panel count exceeds supported range.");
    const actualDcKw = panelCount * assumptions.roofLayout.panelCapacityWatts / 1_000;
    positive(actualDcKw, "actual DC size");
    const minimumInverterAcKw = actualDcKw / assumptions.inverterDcAcRatio;
    positive(minimumInverterAcKw, "minimum inverter AC size");
    const googleEnergy = roof.source === "GOOGLE_SOLAR" && panelCount <= layout.panels.length &&
      layout.panels.slice(0, panelCount).every(panel => panel.yearlyEnergyDcKwh !== undefined &&
        Number.isFinite(panel.yearlyEnergyDcKwh) && panel.yearlyEnergyDcKwh >= 0);
    const generationBasis: SystemGenerationBasis = googleEnergy ? "GOOGLE_DC_DERATED" : "ASSUMED_YIELD";
    const estimatedAnnualGenerationKwh = googleEnergy ?
      layout.panels.slice(0, panelCount).reduce((sum, panel) => sum + panel.yearlyEnergyDcKwh!, 0) *
        assumptions.googleDcToAcEnergyFactor : actualDcKw * assumptions.generationKwhPerKwYear;
    if (!Number.isFinite(estimatedAnnualGenerationKwh) || estimatedAnnualGenerationKwh < 0) {
      throw new RangeError("Calculated annual generation is outside the supported range.");
    }
    const annualConsumptionCoverageRatio = estimatedAnnualGenerationKwh / consumption.annualConsumptionKwh;
    if (!Number.isFinite(annualConsumptionCoverageRatio)) throw new RangeError("Calculated coverage is outside the supported range.");
    const roofFit: CandidateRoofFit = layout.panelCount === null ? "UNDETERMINED" :
      panelCount > layout.panelCount ? "EXCEEDS_MODELED_ROOF" : layout.fitStatus;
    const reasonCodes: SystemCandidateReason[] = [];
    if (roofFit === "UNDETERMINED") reasonCodes.push("ROOF_FIT_UNDETERMINED");
    if (roofFit === "EXCEEDS_MODELED_ROOF") reasonCodes.push("EXCEEDS_MODELED_ROOF");
    if (consumption.sanctionedLoadKw !== undefined && actualDcKw > consumption.sanctionedLoadKw) {
      reasonCodes.push("SANCTIONED_LOAD_REVIEW_NEEDED");
    }
    if (annualConsumptionCoverageRatio > assumptions.maximumGenerationToDemandRatio) reasonCodes.push("EXCEEDS_DEMAND_LIMIT");
    if (estimatedAnnualGenerationKwh === 0) reasonCodes.push("ZERO_MODELED_GENERATION");
    return { nominalKw, panelCount, actualDcKw, minimumInverterAcKw, estimatedAnnualGenerationKwh,
      generationBasis, annualConsumptionCoverageRatio, roofFit,
      recommendationEligible: reasonCodes.every(code => code === "SANCTIONED_LOAD_REVIEW_NEEDED"), reasonCodes };
  });

  if (candidates.some(candidate => candidate.reasonCodes.includes("SANCTIONED_LOAD_REVIEW_NEEDED"))) {
    warnings.add("SANCTIONED_LOAD_REVIEW_NEEDED");
  }
  if (candidates.some(candidate => candidate.generationBasis === "ASSUMED_YIELD")) warnings.add("ASSUMED_YIELD_USED");
  if (candidates.some(candidate => candidate.generationBasis === "GOOGLE_DC_DERATED")) {
    warnings.add("GOOGLE_DC_TO_AC_FACTOR_ASSUMED");
  }
  const targetGenerationKwh = consumption.annualConsumptionKwh * assumptions.targetCoverageFraction;
  positive(targetGenerationKwh, "target generation");
  const eligible = candidates.filter(candidate => candidate.recommendationEligible);
  eligible.sort((first, second) =>
    Math.abs(first.estimatedAnnualGenerationKwh - targetGenerationKwh) -
      Math.abs(second.estimatedAnnualGenerationKwh - targetGenerationKwh) ||
    first.actualDcKw - second.actualDcKw || first.nominalKw - second.nominalKw);
  const recommendation = eligible[0] ?? null;
  return {
    schemaVersion: 1, source: "DETERMINISTIC_SYSTEM_DESIGN_V1",
    assumptions: { ...assumptions, roofLayout: { ...assumptions.roofLayout }, candidateNominalKw: [...assumptions.candidateNominalKw] },
    demand: consumption,
    roof: { source: roof.source, fitStatus: layout.fitStatus, maxPanelCount: layout.panelCount,
      maxModeledDcKw: layout.dcCapacityKw, layoutWarnings: [...layout.warnings] },
    candidates, recommendation,
    decisionCode: recommendation ? "RECOMMENDED_CLOSEST_TO_TARGET" : decisionFor(candidates, layout.panelCount),
    warnings: Array.from(warnings),
  };
}
