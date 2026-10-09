import { z } from "zod";
import type { SystemDemand } from "@solarsaathi/calculations";
import { postAuthenticated, RoofRequestError } from "./roof-api";

const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/);
const finite = z.number().finite();
const positive = finite.positive();
const nonnegative = finite.nonnegative();
const note = z.string().min(1).max(2_000);
const point = z.object({ x: finite, y: finite, z: finite }).strict();
const corners = z.tuple([point, point, point, point]);
const category = z.enum(["DRYING", "SEATING", "GARDEN", "STRETCH"]);
const placement = z.object({ zoneId: id, corners, areaSquareMeters: positive }).strict();
const candidate = z.object({ candidateId: id, category, title: z.string().min(1).max(160),
  status: z.enum(["SPACE_FEASIBLE", "NOT_SPACE_FEASIBLE", "UNDETERMINED"]),
  reason: note, requiredAreaSquareMeters: positive, modeledAreaSquareMeters: positive.optional(),
  placement: placement.optional(), requiresStructuralReview: z.literal(true), safetyNotes: z.array(note).max(12),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/), template: z.object({ status: z.enum(["STORED", "DETERMINISTIC_FALLBACK"]) }),
  image: z.object({ status: z.literal("NOT_REQUESTED") }),
}).superRefine((value, context) => {
  if (value.status === "SPACE_FEASIBLE" && !value.placement ||
      value.status !== "SPACE_FEASIBLE" && value.placement) {
    context.addIssue({ code: "custom", path: ["placement"], message: "Only space-feasible concepts can have a placement." });
  }
});
export const designsResponseSchema = z.object({
  schemaVersion: z.literal(1), source: z.literal("DETERMINISTIC_REMAINING_SPACE_V1"),
  requestId: z.string().min(1), propertyId: id, analysisId: id,
  system: z.object({ nominalKw: positive, actualDcKw: positive, panelCount: z.number().int().nonnegative() }),
  planning: z.object({ fitStatus: z.enum(["SPACE_FEASIBLE", "MODELED_APPROXIMATE", "UNDETERMINED"]),
    roofAreaSquareMeters: positive, modeledUsableProjectedAreaSquareMeters: nonnegative.nullable(),
    reservedSolarProjectedAreaSquareMeters: nonnegative.nullable(), remainingProjectedAreaSquareMeters: nonnegative.nullable(),
    assumptions: z.object({ edgeSetbackMeters: nonnegative, servicePathWidthMeters: nonnegative,
      solarBufferMeters: nonnegative }) }),
  geometry: z.object({ coordinateSystem: z.literal("LOCAL_EAST_UP_NORTH_METERS"),
    segments: z.array(z.object({ segmentId: id, corners })).max(200),
    panels: z.array(z.object({ panelId: id, segmentId: id, corners })).max(1_200),
    freeZones: z.array(z.object({ zoneId: id, segmentId: id, corners, areaSquareMeters: positive })).max(40),
    totalFreeZoneCount: z.number().int().nonnegative() }),
  candidates: z.array(candidate).max(20), warnings: z.array(note).max(30),
}).superRefine((value, context) => {
  const zones = new Set(value.geometry.freeZones.map(item => item.zoneId));
  if (value.geometry.totalFreeZoneCount < value.geometry.freeZones.length) {
    context.addIssue({ code: "custom", path: ["geometry", "totalFreeZoneCount"],
      message: "Total modeled zones cannot be less than the visible zone count." });
  }
  if (new Set(value.candidates.map(item => item.candidateId)).size !== value.candidates.length ||
      value.candidates.some(item => item.placement && !zones.has(item.placement.zoneId))) {
    context.addIssue({ code: "custom", path: ["candidates"], message: "Concept placements must refer to unique, modeled free zones." });
  }
  if (value.planning.fitStatus === "UNDETERMINED" && value.candidates.some(item => item.status === "SPACE_FEASIBLE")) {
    context.addIssue({ code: "custom", path: ["candidates"], message: "Undetermined geometry cannot support a fitted concept." });
  }
});
const image = z.object({ status: z.enum(["NOT_REQUESTED", "READY", "UNAVAILABLE"]),
  url: z.string().url().refine(value => value.startsWith("https://")).optional(),
  expiresAt: z.iso.datetime({ offset: true }).optional(), source: z.literal("BEDROCK_NOVA_CANVAS").optional(),
  propertyScoped: z.boolean(), visualAccuracy: z.literal("INSPIRATIONAL_ONLY"), reason: note.optional(),
}).superRefine((value, context) => {
  if (value.status === "READY" && (!value.url || !value.expiresAt || !value.propertyScoped || !value.source) ||
      value.status !== "READY" && value.url) {
    context.addIssue({ code: "custom", path: ["url"], message: "Only a property-scoped ready concept can expose a signed image URL." });
  }
});
export const designGenerationResponseSchema = z.object({
  schemaVersion: z.literal(1), source: z.literal("ROOFTOP_DESIGN_CONCEPT_V1"), requestId: z.string().min(1),
  propertyId: id, analysisId: id, designId: id.optional(), candidate,
  concept: z.object({ template: z.object({ status: z.enum(["STORED", "DETERMINISTIC_FALLBACK"]),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/), templateId: id.optional() }), image }),
  warnings: z.array(note).max(30),
}).superRefine((value, context) => {
  if (value.concept.template.fingerprint !== value.candidate.fingerprint) {
    context.addIssue({ code: "custom", path: ["concept", "template", "fingerprint"], message: "Template fingerprint must match the concept." });
  }
});

export type DesignsResponse = z.infer<typeof designsResponseSchema>;
export type DesignCategory = z.infer<typeof category>;
export type DesignCandidate = DesignsResponse["candidates"][number];
export type DesignGenerationResponse = z.infer<typeof designGenerationResponseSchema>;
export interface DesignsRequest {
  propertyId: string; analysisId: string; nominalKw: number; demand: SystemDemand;
  generationKwhPerKwYear: number; preferences?: { categories?: DesignCategory[] };
}

export const designsApi = {
  recommend: async (input: DesignsRequest, signal?: AbortSignal) => {
    const response = await postAuthenticated("/designs/recommend", input, designsResponseSchema, signal, 30_000);
    if (response.propertyId !== input.propertyId || response.analysisId !== input.analysisId ||
      response.system.nominalKw !== input.nominalKw) {
      throw new RoofRequestError("INVALID_RESPONSE", "The design concepts do not match the selected roof and system.");
    }
    return response;
  },
  generate: async (input: DesignsRequest, selected: DesignCandidate, render: "TEMPLATE" | "IMAGE",
    signal?: AbortSignal) => {
    const response = await postAuthenticated("/designs/generate",
      { ...input, candidateId: selected.candidateId, render }, designGenerationResponseSchema, signal, 45_000);
    if (response.propertyId !== input.propertyId || response.analysisId !== input.analysisId ||
      response.candidate.candidateId !== selected.candidateId || response.candidate.fingerprint !== selected.fingerprint) {
      throw new RoofRequestError("INVALID_RESPONSE", "The generated concept does not match the selected roof and idea.");
    }
    return response;
  },
};
