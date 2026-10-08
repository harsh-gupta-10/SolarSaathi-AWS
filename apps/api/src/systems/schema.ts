import { z } from "zod";
import { identifier } from "../data/schemas";

const consumption = z.object({
  kind: z.literal("CONSUMPTION"),
  monthlyConsumptionKwh: z.number().finite().min(1).max(100_000),
  sanctionedLoadKw: z.number().finite().min(0.25).max(1_000).optional(),
}).strict();

const bill = z.object({
  kind: z.literal("BILL"),
  monthlyBillRupees: z.number().finite().min(1).max(1_000_000),
  tariffRupeesPerKwh: z.number().finite().min(0.1).max(100),
  sanctionedLoadKw: z.number().finite().min(0.25).max(1_000).optional(),
}).strict();

export const systemDemandSchema = z.discriminatedUnion("kind", [consumption, bill]);

export const systemRecommendationRequestSchema = z.object({
  propertyId: identifier,
  analysisId: identifier,
  demand: systemDemandSchema,
  generationKwhPerKwYear: z.number().finite().min(500).max(2_500),
}).strict();

export type SystemRecommendationRequest = z.infer<typeof systemRecommendationRequestSchema>;
