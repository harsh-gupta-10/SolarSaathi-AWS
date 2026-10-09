import { z } from "zod";
import type { SystemDemand } from "@solarsaathi/calculations";
import { citationSchema, type BenefitApplicantFacts } from "./benefits-api";
import type { FinancialInputs } from "./financial-api";
import { getAuthenticated, postAuthenticated, RoofRequestError } from "./roof-api";

const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/);
const timestamp = z.iso.datetime({ offset: true });
const analysis = z.object({ analysisId: id, propertyId: id,
  source: z.enum(["MANUAL", "GOOGLE_SOLAR"]), measuredAt: timestamp,
  roofAreaSquareMeters: z.number().finite().positive(), segmentCount: z.number().int().positive(),
  expiresAt: timestamp.optional(),
});
const analysisPage = z.object({ schemaVersion: z.literal(1), source: z.literal("DYNAMODB"),
  requestId: z.string().min(1), analyses: z.array(analysis).max(20), nextCursor: z.string().optional() });
const sourceCheck = z.object({ sourceId: z.string().min(1), lastCheckedAt: timestamp.nullable(),
  fresh: z.boolean(), status: z.enum(["HEALTHY", "DEGRADED", "STALE", "FAILED", "UNKNOWN"]) });
const card = z.object({ id: z.string().min(1), kind: z.enum(["ROOF", "SYSTEM", "FINANCIAL", "BENEFIT", "APPLICATION"]),
  statement: z.string().min(1).max(2_000), provenance: z.enum(["GOOGLE_SOLAR", "USER_MEASURED",
    "DETERMINISTIC_CALCULATION", "VERIFIED_POLICY", "USER_REPORTED"]),
  citations: z.array(citationSchema).min(1).max(50).optional(), policyId: z.string().min(1).optional(),
  policyVersion: z.number().int().positive().optional(), lastVerifiedAt: timestamp.optional(),
  jurisdiction: z.string().min(1).optional(), effectiveFrom: z.iso.date().optional(),
  effectiveTo: z.iso.date().optional(), verificationStatus: z.literal("VERIFIED").optional(),
  sourceChecks: z.array(sourceCheck).min(1).max(50).optional(),
}).superRefine((value, context) => {
  if (value.provenance === "VERIFIED_POLICY" &&
    (!value.citations?.length || !value.policyId || !value.policyVersion || !value.lastVerifiedAt || !value.sourceChecks?.length ||
      !value.jurisdiction || !value.effectiveFrom || value.verificationStatus !== "VERIFIED")) {
    context.addIssue({ code: "custom", message: "Verified policy cards require versioned current citations." });
  }
});
export const advisorResponseSchema = z.object({ schemaVersion: z.literal(1),
  source: z.literal("GROUNDED_ADVISOR_V1"), requestId: z.string().min(1), propertyId: id, analysisId: id,
  status: z.enum(["ANSWERED", "INSUFFICIENT_CONTEXT"]),
  mode: z.enum(["BEDROCK_FACT_SELECTION", "DETERMINISTIC_FALLBACK"]),
  answer: z.string().min(1).max(10_000), cards: z.array(card).max(32),
  selectedCardIds: z.array(z.string().min(1)).max(32),
  caveats: z.array(z.string().min(1).max(1_000)).max(30),
  missingContext: z.array(z.string().min(1).max(500)).max(30),
}).superRefine((value, context) => {
  const cardIds = new Set(value.cards.map(item => item.id));
  if (cardIds.size !== value.cards.length || new Set(value.selectedCardIds).size !== value.selectedCardIds.length ||
    value.selectedCardIds.some(id => !cardIds.has(id))) {
    context.addIssue({ code: "custom", path: ["selectedCardIds"], message: "Answer cards must be unique and traceable." });
  }
});

export type AdvisorResponse = z.infer<typeof advisorResponseSchema>;
export type AdvisorAnalysis = z.infer<typeof analysis>;
export interface AdvisorScenario {
  demand: SystemDemand;
  generationKwhPerKwYear: number;
  nominalKw: number;
  financialInputs: FinancialInputs;
  applicantFacts: BenefitApplicantFacts;
  eligibleQuotedCostPaise?: number;
}
export interface AdvisorQuestion {
  propertyId: string;
  analysisId: string;
  question: string;
  applicationId?: string;
  scenario?: AdvisorScenario;
}

export const advisorApi = {
  analyses: async (propertyId: string, cursor?: string, signal?: AbortSignal) => {
    const response = await getAuthenticated(`/properties/${encodeURIComponent(propertyId)}/analyses?limit=20` +
      (cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""), analysisPage, signal);
    if (response.analyses.some(item => item.propertyId !== propertyId)) {
      throw new RoofRequestError("INVALID_RESPONSE", "The assessment list belongs to a different property.");
    }
    return response;
  },
  ask: async (question: AdvisorQuestion, signal?: AbortSignal) => {
    const response = await postAuthenticated("/advisor/solar", question, advisorResponseSchema, signal, 30_000);
    if (response.propertyId !== question.propertyId || response.analysisId !== question.analysisId) {
      throw new RoofRequestError("INVALID_RESPONSE", "The advisor returned a different property or roof assessment.");
    }
    return response;
  },
};
