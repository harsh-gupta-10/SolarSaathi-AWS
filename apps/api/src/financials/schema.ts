import { z } from "zod";
import { identifier } from "../data/schemas";
import { systemDemandSchema } from "../systems/schema";

export const financialEstimateRequestSchema = z.object({
  propertyId: identifier,
  analysisId: identifier,
  demand: systemDemandSchema,
  generationKwhPerKwYear: z.number().finite().min(500).max(2_500),
  nominalKw: z.number().finite().min(0.1).max(100),
  financialInputs: z.object({
    grossSystemCostRupees: z.number().finite().min(1_000).max(50_000_000),
    selfConsumptionFraction: z.number().finite().min(0).max(1),
    importTariffRupeesPerKwh: z.number().finite().min(0.1).max(100),
    exportRateRupeesPerKwh: z.number().finite().min(0).max(100),
    annualMaintenanceRupees: z.number().finite().min(0).max(5_000_000),
  }).strict(),
}).strict();

export type FinancialEstimateRequest = z.infer<typeof financialEstimateRequestSchema>;
