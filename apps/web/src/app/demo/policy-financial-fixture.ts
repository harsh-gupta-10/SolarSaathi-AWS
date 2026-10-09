import { calculatePolicyFinancialsV1 } from "@solarsaathi/calculations";
import type { PolicyFinancialEstimateResponse } from "../../lib/policy-financial-api";
import { demoFinancialResponse } from "./system-financial-fixture";

/** Fictional policy values and evidence for the offline demo and tests only. */
const evaluatedAt = "2026-10-09T08:00:00.000Z";
export const demoSourceId = "SRC#SYNTHETIC_FIXTURE";
export const demoCitation = { schemaVersion: 1 as const, sourceId: demoSourceId, sourceRegistryVersion: 1,
  documentId: "DOC#SYNTHETIC_FIXTURE", documentVersion: 1, documentSha256: "a".repeat(64),
  publisherName: "Synthetic demo source", documentTitle: "Fictional rule fixture",
  sourceUrl: "https://example.invalid/fixture", retrievedAt: "2026-10-08T08:00:00.000Z",
  effectiveFrom: "2026-01-01", locator: { section: "Demo excerpt", charStart: 0, charEnd: 20 } };
const benefitStack: Parameters<typeof calculatePolicyFinancialsV1>[0]["benefits"] = {
  schemaVersion: 1, source: "DETERMINISTIC_BENEFIT_STACK_V1", evaluatedAt,
  totalEligibleBenefitPaise: 5_000_000, coverageComplete: false, optimalWithinVerifiedRules: true,
  decisions: [{
    benefitId: "BENEFIT#SYNTHETIC_DEMO", ruleId: "RULE#SYNTHETIC_DEMO", scope: "CENTRAL",
    jurisdiction: "IN", effectiveFrom: "2026-01-01", status: "SELECTED", reasonCodes: [],
    calculatedAmountPaise: 5_000_000, countedAmountPaise: 5_000_000,
    policyId: "POLICY#SYNTHETIC_DEMO", policyVersion: 1, factIds: ["FACT#SYNTHETIC_DEMO"],
    citations: [demoCitation],
    sourceChecks: [{ sourceId: demoSourceId, lastCheckedAt: "2026-10-09T07:00:00.000Z", fresh: true, status: "HEALTHY" }],
    verificationStatus: "VERIFIED", lastVerifiedAt: "2026-10-08T08:00:00.000Z",
  }], warnings: [],
};

export const demoPolicyFinancialResponse: PolicyFinancialEstimateResponse = {
  schemaVersion: 1, source: "DETERMINISTIC_POLICY_FINANCIAL_V1", status: "AVAILABLE",
  requestId: "synthetic-policy-fixture", propertyId: demoFinancialResponse.propertyId,
  analysisId: demoFinancialResponse.analysisId, roofSource: demoFinancialResponse.roofSource,
  system: demoFinancialResponse.system, systemDesignWarnings: demoFinancialResponse.systemDesignWarnings,
  base: demoFinancialResponse.financial,
  benefits: {
    schemaVersion: 1, source: "DETERMINISTIC_BENEFIT_STACK_V1", status: "AVAILABLE",
    requestId: "synthetic-benefit-fixture", propertyId: demoFinancialResponse.propertyId,
    analysisId: demoFinancialResponse.analysisId, system: { nominalKw: demoFinancialResponse.system.nominalKw,
      actualDcKw: demoFinancialResponse.system.actualDcKw }, evaluatedAt,
    applicantFactsSource: "USER_DECLARED", eligibilityNotGuaranteed: true,
    coverage: { central: false, state: false, discom: false, local: false, other: false }, result: benefitStack,
  },
  projection: calculatePolicyFinancialsV1({ base: demoFinancialResponse.financial, benefits: benefitStack }),
};
