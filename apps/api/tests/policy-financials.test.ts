import { describe, expect, it, vi } from "vitest";
import type { BenefitStackResultV1 } from "@solarsaathi/policy";
import type { CurrentIdentityResponse } from "@solarsaathi/types";
import { BenefitsService } from "../src/benefits/service";
import { FinancialsService } from "../src/financials/service";
import { PolicyFinancialsService } from "../src/financials/policy-service";
import { RequestError } from "../src/lib/http";
import type { PolicyPublicationRepository } from "../src/policy/publication-storage";
import type { PolicyRepository } from "../src/policy/storage";
import type { PolicyWorkflowRepository } from "../src/policy/workflow-storage";
import { normalizeManual } from "../src/roof/normalize";
import { fixedNow, identity, otherId, setupData } from "./data-fixtures";

const quote = { grossSystemCostRupees: 200_000, selfConsumptionFraction: 0.7,
  importTariffRupeesPerKwh: 10, exportRateRupeesPerKwh: 3, annualMaintenanceRupees: 5_000 };
const request = (propertyId: string, analysisId: string) => ({ propertyId, analysisId,
  demand: { kind: "CONSUMPTION" as const, monthlyConsumptionKwh: 600 },
  generationKwhPerKwYear: 1_500, nominalKw: 3, financialInputs: quote,
  applicantFacts: { country: "IN" as const, state: "MH", customerType: "RESIDENTIAL" as const } });

const citation = { schemaVersion: 1 as const, sourceId: "SRC#SYNTHETIC", sourceRegistryVersion: 1,
  documentId: "DOC#SYNTHETIC", documentVersion: 1, documentSha256: "a".repeat(64),
  publisherName: "Synthetic official fixture", documentTitle: "Synthetic fixture notice",
  sourceUrl: "https://mnre.gov.in/synthetic-fixture", retrievedAt: fixedNow.toISOString(),
  locator: { section: "Fixture section" } };
const selectedStack = (): BenefitStackResultV1 => ({ schemaVersion: 1, source: "DETERMINISTIC_BENEFIT_STACK_V1",
  evaluatedAt: fixedNow.toISOString(), totalEligibleBenefitPaise: 100_000, coverageComplete: false,
  optimalWithinVerifiedRules: true, warnings: ["POLICY_COVERAGE_UNVERIFIED"],
  decisions: [{ benefitId: "BENEFIT#SYNTHETIC", ruleId: "RULE#SYNTHETIC", scope: "CENTRAL",
    jurisdiction: "IN", effectiveFrom: "2026-01-01", status: "SELECTED", reasonCodes: [],
    calculatedAmountPaise: 100_000, countedAmountPaise: 100_000,
    policyId: "POLICY#SYNTHETIC", policyVersion: 1, factIds: ["FACT#SYNTHETIC"],
    citations: [citation], sourceChecks: [{ sourceId: citation.sourceId,
      lastCheckedAt: fixedNow.toISOString(), fresh: true, status: "HEALTHY" }],
    verificationStatus: "VERIFIED", lastVerifiedAt: fixedNow.toISOString() }] });

async function setup() {
  const { service, memory } = setupData();
  await service.bootstrap(identity(), {});
  const property = await service.createProperty(identity(), { label: "Home", address: "123 Example Road, Mumbai" });
  const roof = normalizeManual({ roofAreaSquareMeters: 100, lengthMeters: 10, widthMeters: 10 }, fixedNow.toISOString());
  const analysis = await service.saveManualRoof(identity(), property.propertyId, roof);
  return { service, memory, property, analysis };
}

function composite(core: Awaited<ReturnType<typeof setup>>["service"],
  mode: "AVAILABLE" | "UNAVAILABLE" | "UNKNOWN" | "MISMATCH" | "STALE" | "OTHER_ONLY" = "AVAILABLE") {
  const evaluate = vi.fn(async (_identity: CurrentIdentityResponse, _body: unknown, requestId: string, trusted: {
    propertyId: string; analysisId: string; system: { nominalKw: number; actualDcKw: number };
  }) => {
    const common = { schemaVersion: 1 as const, source: "DETERMINISTIC_BENEFIT_STACK_V1" as const,
      requestId, propertyId: trusted.propertyId, analysisId: trusted.analysisId,
      system: { nominalKw: trusted.system.nominalKw,
        actualDcKw: mode === "MISMATCH" ? trusted.system.actualDcKw + 1 : trusted.system.actualDcKw },
      evaluatedAt: fixedNow.toISOString(), coverage: { central: false, state: false,
        discom: false, local: false, other: false }, applicantFactsSource: "USER_DECLARED" as const,
      eligibilityNotGuaranteed: true as const };
    if (mode === "UNAVAILABLE") return { ...common, status: "UNAVAILABLE" as const,
      reasonCodes: ["NO_ACTIVE_VERIFIED_RULES"] };
    const result = selectedStack();
    if (mode === "UNKNOWN") {
      result.totalEligibleBenefitPaise = 0;
      result.decisions[0]!.status = "UNKNOWN";
      delete result.decisions[0]!.countedAmountPaise;
    }
    if (mode === "STALE") result.decisions[0]!.sourceChecks[0]!.fresh = false;
    if (mode === "OTHER_ONLY") result.decisions[0]!.scope = "OTHER";
    return { ...common, status: "AVAILABLE" as const, result };
  });
  return { service: new PolicyFinancialsService(new FinancialsService(core),
    { evaluate } as unknown as BenefitsService), evaluate };
}

describe("policy-backed financial estimate", () => {
  it("derives base and upfront-only projection from an owned roof and selected cited benefit", async () => {
    const { service: core, property, analysis, memory } = await setup();
    const getAnalysis = vi.spyOn(core, "getAnalysis");
    const { service, evaluate } = composite(core);
    const before = memory.records.size;
    const response = await service.estimate(identity(), request(property.propertyId, analysis.analysisId), "req-1");
    expect(response).toMatchObject({ source: "DETERMINISTIC_POLICY_FINANCIAL_V1", status: "AVAILABLE",
      base: { initialCashFlowRupees: -200_000 },
      benefits: { status: "AVAILABLE", result: { totalEligibleBenefitPaise: 100_000 } },
      projection: { status: "PARTIAL", timingAssumption: "BENEFITS_MODELED_UPFRONT",
        selectedByScopePaise: { CENTRAL: 100_000 }, grossCostPaise: 20_000_000,
        netUpfrontCostPaise: 19_900_000 } });
    expect(response.projection?.annualRows).toHaveLength(25);
    expect(response.projection?.provenance.selectedPolicies[0]).toMatchObject({
      ruleId: "RULE#SYNTHETIC", policyVersion: 1 });
    expect(getAnalysis).toHaveBeenCalledTimes(1);
    expect(evaluate.mock.calls[0]?.[3]).toMatchObject({ propertyId: property.propertyId,
      analysisId: analysis.analysisId, system: { nominalKw: 3 } });
    expect(evaluate.mock.calls[0]?.[1]).not.toHaveProperty("eligibleQuotedCostPaise");
    expect(memory.records.size).toBe(before);
  });

  it("keeps the unsubsidized result and omits adjusted claims when no current policy or confirmed selected benefit exists", async () => {
    const { service: core, property, analysis } = await setup();
    for (const [mode, reason] of [["UNAVAILABLE", "NO_ACTIVE_VERIFIED_RULES"],
      ["UNKNOWN", "NO_CONFIRMED_ELIGIBLE_BENEFITS"],
      ["OTHER_ONLY", "NO_UPFRONT_MODELABLE_BENEFITS"]] as const) {
      const response = await composite(core, mode).service.estimate(identity(),
        request(property.propertyId, analysis.analysisId), "req-2");
      expect(response).toMatchObject({ status: "UNAVAILABLE", reasonCodes: [reason],
        base: { initialCashFlowRupees: -200_000 } });
      expect(response).not.toHaveProperty("projection");
    }
  });

  it("uses the actual bounded benefit catalog without re-reading the owned roof when no active rule exists", async () => {
    const { service: core, property, analysis } = await setup();
    const getAnalysis = vi.spyOn(core, "getAnalysis");
    const publication = { listActive: vi.fn(async () => []) } as unknown as PolicyPublicationRepository;
    const benefits = new BenefitsService(core, {} as PolicyRepository,
      {} as PolicyWorkflowRepository, publication, () => fixedNow);
    const response = await new PolicyFinancialsService(new FinancialsService(core), benefits)
      .estimate(identity(), request(property.propertyId, analysis.analysisId), "req");
    expect(response).toMatchObject({ status: "UNAVAILABLE", reasonCodes: ["NO_ACTIVE_VERIFIED_RULES"],
      benefits: { status: "UNAVAILABLE" } });
    expect(response).not.toHaveProperty("projection");
    expect(getAnalysis).toHaveBeenCalledTimes(1);
    expect(publication.listActive).toHaveBeenCalledWith(["IN", "IN-MH"], 17);
  });

  it("preserves the base estimate when policy storage is unavailable", async () => {
    const { service: core, property, analysis } = await setup();
    const publicationStub = { listActive: vi.fn(async () => { throw new Error("DynamoDB unavailable"); }) };
    const publication = publicationStub as unknown as PolicyPublicationRepository;
    const benefits = new BenefitsService(core, {} as PolicyRepository,
      {} as PolicyWorkflowRepository, publication, () => fixedNow);
    const response = await new PolicyFinancialsService(new FinancialsService(core), benefits)
      .estimate(identity(), request(property.propertyId, analysis.analysisId), "req-outage");
    expect(response).toMatchObject({ status: "UNAVAILABLE", reasonCodes: ["BENEFIT_EVALUATION_UNAVAILABLE"],
      base: { initialCashFlowRupees: -200_000 }, benefits: { status: "UNAVAILABLE",
        reasonCodes: ["BENEFIT_EVALUATION_UNAVAILABLE"] } });
    expect(response).not.toHaveProperty("projection");
  });

  it("does not mask policy validation or authorization errors as an unavailable scenario", async () => {
    const { service: core, property, analysis } = await setup();
    const evaluate = vi.fn(async () => { throw new RequestError(403, "FORBIDDEN", "Denied"); });
    const service = new PolicyFinancialsService(new FinancialsService(core),
      { evaluate } as unknown as BenefitsService);
    await expect(service.estimate(identity(), request(property.propertyId, analysis.analysisId), "req"))
      .rejects.toMatchObject({ statusCode: 403, code: "FORBIDDEN" });
  });

  it("rejects policy-eligible cost greater than the gross quote at the API boundary", async () => {
    const { service: core, property, analysis } = await setup();
    const { service, evaluate } = composite(core);
    await expect(service.estimate(identity(), { ...request(property.propertyId, analysis.analysisId),
      eligibleQuotedCostPaise: 20_000_001 }, "req"))
      .rejects.toMatchObject({ statusCode: 400, code: "INVALID_REQUEST" });
    expect(evaluate).not.toHaveBeenCalled();
    const valid = await service.estimate(identity(), { ...request(property.propertyId, analysis.analysisId),
      eligibleQuotedCostPaise: 20_000_000 }, "req");
    expect(valid.status).toBe("AVAILABLE");
    expect(evaluate.mock.calls[0]?.[1]).toMatchObject({ eligibleQuotedCostPaise: 20_000_000 });
  });

  it("rejects browser-submitted benefit, policy, roof or trusted-system fields and foreign ownership", async () => {
    const { service: core, property, analysis } = await setup();
    const { service } = composite(core);
    const valid = request(property.propertyId, analysis.analysisId);
    for (const field of [{ totalEligibleBenefitPaise: 999_999_999 }, { policyId: "POLICY#FORGED" },
      { roof: analysis.roofModel }, { system: { actualDcKw: 20 } }, { benefits: { status: "AVAILABLE" } }]) {
      await expect(service.estimate(identity(), { ...valid, ...field }, "req"))
        .rejects.toMatchObject({ statusCode: 400, code: "INVALID_REQUEST" });
    }
    await core.bootstrap(identity(otherId), {});
    await expect(service.estimate(identity(otherId), valid, "req"))
      .rejects.toMatchObject({ statusCode: 404 });
  });

  it("fails closed if the benefit evaluation returns a different server-selected system", async () => {
    const { service: core, property, analysis } = await setup();
    await expect(composite(core, "MISMATCH").service.estimate(identity(),
      request(property.propertyId, analysis.analysisId), "req"))
      .rejects.toMatchObject({ statusCode: 503, code: "POLICY_FINANCIAL_MISMATCH" });
  });

  it("refuses an adjusted result when a selected citation has a stale source check", async () => {
    const { service: core, property, analysis } = await setup();
    await expect(composite(core, "STALE").service.estimate(identity(),
      request(property.propertyId, analysis.analysisId), "req"))
      .rejects.toMatchObject({ statusCode: 503, code: "POLICY_FINANCIAL_CALCULATION_UNAVAILABLE" });
  });
});
