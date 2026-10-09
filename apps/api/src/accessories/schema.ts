import { z } from "zod";
import { systemRecommendationRequestSchema } from "../systems/schema";

const goalsSchema = z.object({
  backupPower: z.boolean().optional(),
  evCharging: z.boolean().optional(),
  monitoring: z.boolean().optional(),
  easierMaintenance: z.boolean().optional(),
}).strict();

const siteSchema = z.object({
  lightningExposure: z.enum(["UNKNOWN", "REPORTED_HIGH", "REPORTED_NORMAL"]).optional(),
  birdActivity: z.boolean().optional(),
  safeCleaningAccess: z.enum(["UNKNOWN", "YES", "NO"]).optional(),
}).strict();

export const accessoryRecommendationRequestSchema = systemRecommendationRequestSchema.extend({
  nominalKw: z.number().finite().min(0.25).max(100),
  goals: goalsSchema.optional(),
  inverterType: z.enum(["GRID_TIED", "HYBRID", "UNKNOWN"]).optional(),
  evStatus: z.enum(["NONE", "PLANNING", "OWNS_EV"]).optional(),
  site: siteSchema.optional(),
}).strict();

export type AccessoryRecommendationRequest = z.infer<typeof accessoryRecommendationRequestSchema>;

export type AccessoryCategory = "ELECTRICAL_SAFETY" | "MONITORING" | "BACKUP" | "EV" | "MAINTENANCE";
export type AccessoryClassification = "REQUIRED_BY_RULE" | "STRONGLY_RECOMMENDED" | "RECOMMENDED" | "OPTIONAL" | "NOT_RECOMMENDED";
export type AccessoryCompatibility = "COMPATIBLE" | "REQUIRES_REVIEW" | "NOT_RECOMMENDED";

export interface AccessoryRecommendationV1 {
  id: string;
  title: string;
  category: AccessoryCategory;
  classification: AccessoryClassification;
  score: number;
  reason: string;
  compatibility: AccessoryCompatibility;
  safetyNotes: string[];
  policyRelevance: { status: "NOT_EVALUATED"; note: string };
  costRange: { status: "UNAVAILABLE"; currency: "INR"; note: string };
}

export interface AccessoryRecommendationResponseV1 {
  schemaVersion: 1;
  source: "DETERMINISTIC_ACCESSORY_ADVISOR_V1";
  requestId: string;
  propertyId: string;
  analysisId: string;
  system: {
    nominalKw: number;
    actualDcKw: number;
    minimumInverterAcKw: number;
    roofSource: "GOOGLE_SOLAR" | "MANUAL";
    generationBasis: "GOOGLE_DC_DERATED" | "ASSUMED_YIELD";
  };
  recommendations: AccessoryRecommendationV1[];
  warnings: string[];
  financialIntegration: { includedInBaseEstimate: false; benefitEligibilityEvaluated: false };
}
