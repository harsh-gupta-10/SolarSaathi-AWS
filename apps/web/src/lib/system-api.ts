import { z } from "zod";
import type { SystemDemand, SystemDesignResult } from "@solarsaathi/calculations";
import { postAuthenticated, RoofRequestError } from "./roof-api";

const finite = z.number().finite();
const roofWarnings = z.enum([
  "GOOGLE_BOUNDS_ARE_APPROXIMATE", "SEGMENT_BOUNDS_MISSING", "PANEL_SUGGESTIONS_MISSING",
  "PANEL_DIMENSIONS_DIFFER_FROM_GOOGLE_MODEL", "PANEL_SPECS_DIFFER_FROM_GOOGLE_MODEL",
  "PANELS_FILTERED_FOR_CLEARANCE", "PITCH_ASSUMED_FLAT", "AREA_ONLY_MANUAL_ROOF",
  "MANUAL_AREA_DIFFERS_FROM_DIMENSIONS", "PANEL_LIMIT_REACHED", "NEAR_VERTICAL_SEGMENT", "NO_USABLE_GEOMETRY",
]);
const fitStatus = z.enum(["MODELED_APPROXIMATE", "SPACE_FEASIBLE", "UNDETERMINED"]);
const roofLayoutAssumptions = z.object({
  schemaVersion: z.literal(1), panelWidthMeters: finite.positive(), panelHeightMeters: finite.positive(),
  panelCapacityWatts: finite.positive(), edgeSetbackMeters: finite.nonnegative(), panelGapMeters: finite.nonnegative(),
  servicePathWidthMeters: finite.nonnegative(), mountingOffsetMeters: finite.nonnegative(),
  manualAreaToleranceFraction: finite.min(0).max(1), maxModeledPitchDegrees: finite.min(0).max(89),
  maxPanels: z.number().int().positive(),
});
const assumptions = z.object({
  schemaVersion: z.literal(1), roofLayout: roofLayoutAssumptions,
  candidateNominalKw: z.array(finite.positive()).min(1), generationKwhPerKwYear: finite.positive(),
  googleDcToAcEnergyFactor: finite.positive().max(1), inverterDcAcRatio: finite.positive(),
  targetCoverageFraction: finite.positive(), maximumGenerationToDemandRatio: finite.positive(),
});
const candidateReason = z.enum([
  "ROOF_FIT_UNDETERMINED", "EXCEEDS_MODELED_ROOF", "SANCTIONED_LOAD_REVIEW_NEEDED",
  "EXCEEDS_DEMAND_LIMIT", "ZERO_MODELED_GENERATION",
]);
export const systemCandidateSchema = z.object({
  nominalKw: finite.positive(), panelCount: z.number().int().positive(), actualDcKw: finite.positive(),
  minimumInverterAcKw: finite.positive(), estimatedAnnualGenerationKwh: finite.nonnegative(),
  generationBasis: z.enum(["GOOGLE_DC_DERATED", "ASSUMED_YIELD"]), annualConsumptionCoverageRatio: finite.nonnegative(),
  roofFit: z.enum(["MODELED_APPROXIMATE", "SPACE_FEASIBLE", "UNDETERMINED", "EXCEEDS_MODELED_ROOF"]),
  recommendationEligible: z.boolean(), reasonCodes: z.array(candidateReason),
});
const designSchema: z.ZodType<SystemDesignResult> = z.object({
  schemaVersion: z.literal(1), source: z.literal("DETERMINISTIC_SYSTEM_DESIGN_V1"), assumptions,
  demand: z.object({ source: z.enum(["DIRECT_CONSUMPTION", "BILL_ESTIMATE"]),
    monthlyConsumptionKwh: finite.positive(), annualConsumptionKwh: finite.positive(),
    sanctionedLoadKw: finite.positive().optional(), monthlyBillRupees: finite.positive().optional(),
    tariffRupeesPerKwh: finite.positive().optional(),
  }),
  roof: z.object({ source: z.enum(["GOOGLE_SOLAR", "MANUAL"]), fitStatus,
    maxPanelCount: z.number().int().nonnegative().nullable(), maxModeledDcKw: finite.nonnegative().nullable(),
    layoutWarnings: z.array(roofWarnings),
  }),
  candidates: z.array(systemCandidateSchema).min(1), recommendation: systemCandidateSchema.nullable(),
  decisionCode: z.enum(["RECOMMENDED_CLOSEST_TO_TARGET", "ROOF_FIT_UNDETERMINED", "NO_CANDIDATE_WITHIN_ROOF", "NO_CANDIDATE_WITH_MODELED_GENERATION", "NO_CANDIDATE_WITHIN_DEMAND_LIMIT"]),
  warnings: z.array(z.enum([
    "LOCAL_RULES_NOT_CHECKED", "SANCTIONED_LOAD_NOT_PROVIDED", "SANCTIONED_LOAD_REVIEW_NEEDED",
    "BILL_TO_KWH_IS_APPROXIMATE", "GOOGLE_ROOF_FIT_APPROXIMATE", "MANUAL_FIT_NEEDS_SITE_SURVEY",
    "ASSUMED_YIELD_USED", "GOOGLE_DC_TO_AC_FACTOR_ASSUMED",
  ])),
});
const responseSchema = z.object({
  schemaVersion: z.literal(1), source: z.literal("DETERMINISTIC_SYSTEM_DESIGN"),
  requestId: z.string().min(1), propertyId: z.string().min(1), analysisId: z.string().min(1), design: designSchema,
});

export interface SystemRecommendationResponse {
  schemaVersion: 1;
  source: "DETERMINISTIC_SYSTEM_DESIGN";
  requestId: string;
  propertyId: string;
  analysisId: string;
  design: SystemDesignResult;
}

export const systemApi = {
  recommend: async (propertyId: string, analysisId: string, demand: SystemDemand, generationKwhPerKwYear: number,
    signal?: AbortSignal): Promise<SystemRecommendationResponse> => {
    const response = await postAuthenticated("/systems/recommend",
      { propertyId, analysisId, demand, generationKwhPerKwYear }, responseSchema, signal);
    if (response.propertyId !== propertyId || response.analysisId !== analysisId) {
      throw new RoofRequestError("INVALID_RESPONSE", "The system design service returned a different analysis. Try again.");
    }
    return response;
  },
};
