import { z } from "zod";
import type { SystemDemand } from "@solarsaathi/calculations";
import { postAuthenticated, RoofRequestError } from "./roof-api";

const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/);
const note = z.string().min(1).max(2_000);
const recommendation = z.object({
  id, title: z.string().min(1).max(160),
  category: z.enum(["ELECTRICAL_SAFETY", "MONITORING", "BACKUP", "EV", "MAINTENANCE"]),
  classification: z.enum(["REQUIRED_BY_RULE", "STRONGLY_RECOMMENDED", "RECOMMENDED", "OPTIONAL", "NOT_RECOMMENDED"]),
  score: z.number().int().min(0).max(100), reason: note,
  compatibility: z.enum(["COMPATIBLE", "REQUIRES_REVIEW", "NOT_RECOMMENDED"]),
  safetyNotes: z.array(note).max(12),
  policyRelevance: z.object({ status: z.literal("NOT_EVALUATED"), note }),
  costRange: z.object({ status: z.literal("UNAVAILABLE"), currency: z.literal("INR"), note }),
});
export const accessoriesResponseSchema = z.object({
  schemaVersion: z.literal(1), source: z.literal("DETERMINISTIC_ACCESSORY_ADVISOR_V1"),
  requestId: z.string().min(1), propertyId: id, analysisId: id,
  system: z.object({ nominalKw: z.number().finite().positive(), actualDcKw: z.number().finite().positive(),
    minimumInverterAcKw: z.number().finite().positive(), roofSource: z.enum(["MANUAL", "GOOGLE_SOLAR"]),
    generationBasis: z.enum(["GOOGLE_DC_DERATED", "ASSUMED_YIELD"]) }),
  recommendations: z.array(recommendation).max(30), warnings: z.array(note).max(30),
  financialIntegration: z.object({ includedInBaseEstimate: z.literal(false), benefitEligibilityEvaluated: z.literal(false) }),
}).superRefine((value, context) => {
  if (new Set(value.recommendations.map(item => item.id)).size !== value.recommendations.length) {
    context.addIssue({ code: "custom", path: ["recommendations"], message: "Accessory IDs must be unique." });
  }
  if (value.recommendations.some(item => item.classification === "REQUIRED_BY_RULE")) {
    context.addIssue({ code: "custom", path: ["recommendations"], message: "A policy requirement needs verified rule evidence." });
  }
});

export type AccessoriesResponse = z.infer<typeof accessoriesResponseSchema>;
export interface AccessoriesRequest {
  propertyId: string; analysisId: string; nominalKw: number; demand: SystemDemand; generationKwhPerKwYear: number;
  goals?: { backupPower?: boolean; evCharging?: boolean; monitoring?: boolean; easierMaintenance?: boolean };
  inverterType?: "GRID_TIED" | "HYBRID" | "UNKNOWN";
  evStatus?: "NONE" | "PLANNING" | "OWNS_EV";
  site?: { lightningExposure?: "UNKNOWN" | "REPORTED_HIGH" | "REPORTED_NORMAL";
    birdActivity?: boolean; safeCleaningAccess?: "UNKNOWN" | "YES" | "NO" };
}

export const accessoriesApi = {
  recommend: async (input: AccessoriesRequest, signal?: AbortSignal) => {
    const response = await postAuthenticated("/accessories/recommend", input, accessoriesResponseSchema, signal, 30_000);
    if (response.propertyId !== input.propertyId || response.analysisId !== input.analysisId ||
      response.system.nominalKw !== input.nominalKw) {
      throw new RoofRequestError("INVALID_RESPONSE", "The recommendations do not match the selected roof and system.");
    }
    return response;
  },
};
