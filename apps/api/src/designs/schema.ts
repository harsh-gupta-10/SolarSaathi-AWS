import type { RoofLayoutCorners } from "@solarsaathi/calculations";
import { z } from "zod";
import { identifier } from "../data/schemas";
import { systemRecommendationRequestSchema } from "../systems/schema";

export const designCategorySchema = z.enum(["DRYING", "SEATING", "GARDEN", "STRETCH"]);
export type DesignCategory = z.infer<typeof designCategorySchema>;
export const designCandidateIdSchema = z.enum(["drying", "seating", "garden", "stretch"]);
export type DesignCandidateId = z.infer<typeof designCandidateIdSchema>;

export const designRecommendationRequestSchema = systemRecommendationRequestSchema.extend({
  nominalKw: z.number().finite().min(0.25).max(100),
  preferences: z.object({ categories: z.array(designCategorySchema).min(1).max(4).refine(values =>
    new Set(values).size === values.length).optional() }).strict().optional(),
}).strict();
export type DesignRecommendationRequest = z.infer<typeof designRecommendationRequestSchema>;

export const designGenerationRequestSchema = designRecommendationRequestSchema.extend({
  candidateId: designCandidateIdSchema,
  render: z.enum(["TEMPLATE", "IMAGE"]),
}).strict();
export type DesignGenerationRequest = z.infer<typeof designGenerationRequestSchema>;

export const fingerprintSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const designImageQuerySchema = z.object({ propertyId: identifier }).strict();

export interface ZoneV1 { zoneId: string; segmentId: string; corners: RoofLayoutCorners; areaSquareMeters: number }
export interface DesignCandidateV1 {
  candidateId: DesignCandidateId;
  category: DesignCategory;
  title: string;
  status: "SPACE_FEASIBLE" | "NOT_SPACE_FEASIBLE" | "UNDETERMINED";
  reason: string;
  requiredAreaSquareMeters: number;
  modeledAreaSquareMeters?: number;
  placement?: { zoneId: string; corners: RoofLayoutCorners; areaSquareMeters: number };
  requiresStructuralReview: true;
  safetyNotes: string[];
  fingerprint: string;
  template: { status: "STORED" | "DETERMINISTIC_FALLBACK" };
  image: { status: "NOT_REQUESTED" };
}
export interface DesignRecommendationResponseV1 {
  schemaVersion: 1;
  source: "DETERMINISTIC_REMAINING_SPACE_V1";
  requestId: string;
  propertyId: string;
  analysisId: string;
  system: { nominalKw: number; actualDcKw: number; panelCount: number };
  planning: {
    fitStatus: "SPACE_FEASIBLE" | "MODELED_APPROXIMATE" | "UNDETERMINED";
    roofAreaSquareMeters: number;
    modeledUsableProjectedAreaSquareMeters: number | null;
    reservedSolarProjectedAreaSquareMeters: number | null;
    remainingProjectedAreaSquareMeters: number | null;
    assumptions: { edgeSetbackMeters: number; servicePathWidthMeters: number; solarBufferMeters: number };
  };
  geometry: {
    coordinateSystem: "LOCAL_EAST_UP_NORTH_METERS";
    segments: { segmentId: string; corners: RoofLayoutCorners }[];
    panels: { panelId: string; segmentId: string; corners: RoofLayoutCorners }[];
    freeZones: ZoneV1[];
    totalFreeZoneCount: number;
  };
  candidates: DesignCandidateV1[];
  warnings: string[];
}

export interface DesignGenerationResponseV1 {
  schemaVersion: 1;
  source: "ROOFTOP_DESIGN_CONCEPT_V1";
  requestId: string;
  propertyId: string;
  analysisId: string;
  designId?: string;
  candidate: DesignCandidateV1;
  concept: {
    template: { status: "STORED" | "DETERMINISTIC_FALLBACK"; fingerprint: string; templateId?: string };
    image: { status: "NOT_REQUESTED" | "READY" | "UNAVAILABLE"; url?: string; expiresAt?: string;
      source?: "BEDROCK_NOVA_CANVAS"; propertyScoped: boolean; visualAccuracy: "INSPIRATIONAL_ONLY"; reason?: string };
  };
  warnings: string[];
}
