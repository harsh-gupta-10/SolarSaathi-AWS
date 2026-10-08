import { benefitEvaluationContextSchema } from "@solarsaathi/policy";
import { z } from "zod";
import { financialEstimateRequestSchema } from "./schema";

export const policyFinancialEstimateRequestSchema = financialEstimateRequestSchema.extend({
  applicantFacts: benefitEvaluationContextSchema.omit({ systemWatts: true, eligibleQuotedCostPaise: true })
    .extend({ country: z.literal("IN") }),
  // The policy-eligible quote must be stated separately from the full installed quote.
  eligibleQuotedCostPaise: z.number().int().safe().positive().max(1_000_000_000_000).optional(),
}).strict().superRefine((value, context) => {
  if (value.eligibleQuotedCostPaise !== undefined &&
    value.eligibleQuotedCostPaise / 100 > value.financialInputs.grossSystemCostRupees) {
    context.addIssue({ code: "custom", path: ["eligibleQuotedCostPaise"],
      message: "The policy-eligible cost cannot exceed the gross quote." });
  }
});

export type PolicyFinancialEstimateRequest = z.infer<typeof policyFinancialEstimateRequestSchema>;
