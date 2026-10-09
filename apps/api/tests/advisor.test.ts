import { describe, expect, it, vi } from "vitest";
import { ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import type { CoreService } from "../src/data/service";
import type { PolicyFinancialsService } from "../src/financials/policy-service";
import type { FinancialsService } from "../src/financials/service";
import type { ApplicationService } from "../src/applications/service";
import { AdvisorService } from "../src/advisor/service";
import { BedrockFactSelector, type FactSelector } from "../src/advisor/bedrock";
import { RequestError } from "../src/lib/http";
import { fixedNow, identity } from "./data-fixtures";

const propertyId = "property-1", analysisId = "analysis-1";
const roof = { roofModel: {}, roof: { source: "MANUAL", roofAreaSquareMeters: 80,
  segmentCount: 2, measuredAt: fixedNow.toISOString() } };
const citation = { schemaVersion: 1 as const, sourceId: `SRC#${"a".repeat(32)}`,
  sourceRegistryVersion: 1, documentId: `DOC#${"b".repeat(32)}`, documentVersion: 1,
  documentSha256: "c".repeat(64), publisherName: "Synthetic fixture authority",
  documentTitle: "Synthetic fixture notice", sourceUrl: "https://mnre.gov.in/fixture",
  retrievedAt: fixedNow.toISOString(), locator: { charStart: 1, charEnd: 20 } };
const request = { propertyId, analysisId, question: "How large is my roof?" };
const scenarioInput = { demand: { kind: "CONSUMPTION", monthlyConsumptionKwh: 500 },
  generationKwhPerKwYear: 1_500, nominalKw: 3,
  financialInputs: { grossSystemCostRupees: 150_000, selfConsumptionFraction: 0.7,
    importTariffRupeesPerKwh: 8, exportRateRupeesPerKwh: 0, annualMaintenanceRupees: 3_000 },
  applicantFacts: { country: "IN", customerType: "RESIDENTIAL" } };
const system = { nominalKw: 3, actualDcKw: 3.03, estimatedAnnualGenerationKwh: 4_500 };
const financial = { input: { quote: { grossSystemCostRupees: 150_000 } },
  totals: { yearOneNetCashFlowRupees: 28_000, paybackYears: 5.5 } };
const benefitDecision = { benefitId: "BENEFIT#example", ruleId: "RULE#example", policyId: "POLICY#example",
  policyVersion: 2, status: "SELECTED", scope: "CENTRAL", jurisdiction: "IN", effectiveFrom: "2026-01-01",
  countedAmountPaise: 900_000, calculatedAmountPaise: 1_000_000,
  citations: [citation], lastVerifiedAt: fixedNow.toISOString(),
  sourceChecks: [{ sourceId: citation.sourceId, lastCheckedAt: fixedNow.toISOString(), fresh: true, status: "HEALTHY" }] };

function setup() {
  const core = { getAnalysis: vi.fn(async () => roof) } as unknown as CoreService;
  const policy = { estimate: vi.fn(async () => ({ requestId: "request-1", propertyId, analysisId,
    system, base: financial, benefits: { status: "AVAILABLE", result: {
      decisions: [benefitDecision], coverageComplete: false } } })) } as unknown as PolicyFinancialsService;
  const base = { estimate: vi.fn(async () => ({ requestId: "request-1", propertyId, analysisId,
    system, financial })) } as unknown as FinancialsService;
  const applications = { get: vi.fn(async () => ({ propertyId, analysisId,
    steps: [{ status: "COMPLETED" }, { status: "PENDING", stepId: "NEXT", title: "Inspect roof" }],
    expectedNextStepId: "NEXT" })) } as unknown as ApplicationService;
  const selector = { select: vi.fn(async () => ["roof"]) } as FactSelector;
  return { core, policy, base, applications, selector,
    service: new AdvisorService(core, policy, base, applications, selector) };
}

describe("grounded advisor", () => {
  it("answers a roof question from owned analysis without unrelated missing-context prompts", async () => {
    const fixture = setup();
    const response = await fixture.service.answer(identity(), request, "request-1");
    expect(response).toMatchObject({ status: "ANSWERED", mode: "BEDROCK_FACT_SELECTION",
      selectedCardIds: ["roof"], cards: [{ provenance: "USER_MEASURED" }] });
    expect(response.answer).toContain("80.0 m²");
    expect(response.missingContext).toEqual([]);
    expect(fixture.policy.estimate).not.toHaveBeenCalled();
    expect(fixture.applications.get).not.toHaveBeenCalled();
  });

  it("only emits cited current verified benefit facts and deterministic amount explanation", async () => {
    const fixture = setup();
    const response = await fixture.service.answer(identity(), { ...request, question: "Why is my subsidy this amount?",
      scenario: scenarioInput }, "request-1");
    const benefit = response.cards.find(card => card.kind === "BENEFIT");
    expect(benefit).toMatchObject({ provenance: "VERIFIED_POLICY", policyId: "POLICY#example",
      policyVersion: 2, jurisdiction: "IN", effectiveFrom: "2026-01-01", verificationStatus: "VERIFIED",
      citations: [citation], sourceChecks: [expect.objectContaining({ status: "HEALTHY" })] });
    expect(benefit?.statement).toContain("₹10,000.00");
    expect(benefit?.statement).toContain("₹9,000.00");
    expect(response.cards.filter(card => card.kind === "BENEFIT")).toHaveLength(1);
    expect(new Set(response.cards.map(card => card.id)).size).toBe(response.cards.length);
    expect(fixture.selector.select).toHaveBeenCalledWith("BENEFIT", [benefit]);
  });

  it("falls back to unsubsidized calculations when policy evaluation is unavailable", async () => {
    const fixture = setup();
    vi.mocked(fixture.policy.estimate).mockRejectedValueOnce(new RequestError(503,
      "POLICY_FINANCIAL_CALCULATION_UNAVAILABLE", "Policy unavailable"));
    const result = await fixture.service.answer(identity(), { ...request, question: "What is my payback?",
      scenario: scenarioInput }, "request-1");
    expect(result.status).toBe("ANSWERED");
    expect(result.cards.some(card => card.kind === "FINANCIAL")).toBe(true);
  });

  it("requires an application on the same owned assessment", async () => {
    const fixture = setup();
    vi.mocked(fixture.applications.get).mockResolvedValueOnce({ propertyId, analysisId: "other-analysis" } as never);
    await expect(fixture.service.answer(identity(), { ...request,
      question: "What should I do next?", applicationId: "application-1" }, "request-1"))
      .rejects.toMatchObject({ code: "APPLICATION_ANALYSIS_MISMATCH" });
  });

  it("denies a foreign roof before model or policy work and propagates application access denial", async () => {
    const fixture = setup();
    vi.mocked(fixture.core.getAnalysis).mockRejectedValueOnce(new RequestError(404, "NOT_FOUND", "Roof not found"));
    await expect(fixture.service.answer(identity(), request, "request-1"))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(fixture.selector.select).not.toHaveBeenCalled();
    expect(fixture.policy.estimate).not.toHaveBeenCalled();
    vi.mocked(fixture.applications.get).mockRejectedValueOnce(new RequestError(404, "NOT_FOUND", "Application not found"));
    await expect(fixture.service.answer(identity(), { ...request,
      question: "What is my next application step?", applicationId: "foreign-application" }, "request-1"))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(fixture.selector.select).not.toHaveBeenCalled();
  });

  it("rejects model-selected unknown or duplicate IDs and ignores raw question in Bedrock payload", async () => {
    const send = vi.fn(async (command: ConverseCommand) => {
      expect(JSON.stringify(command.input)).not.toContain("secret-reference-123");
      expect(command.input.inferenceConfig?.maxTokens).toBe(128);
      return { stopReason: "end_turn", output: { message: { content: [{ text: '{"cardIds":["unknown"]}' }] } } };
    });
    const selector = new BedrockFactSelector("model-id", "ap-south-1", { send } as never);
    const cards = [{ id: "roof", kind: "ROOF" as const, provenance: "USER_MEASURED" as const,
      statement: "The modeled roof is 80 square meters." }];
    expect(await selector.select("ROOF", cards)).toBeUndefined();
    send.mockResolvedValueOnce({ stopReason: "end_turn", output: { message: { content: [{ text: '{"cardIds":["roof","roof"]}' }] } } });
    expect(await selector.select("ROOF", cards)).toBeUndefined();
    send.mockRejectedValueOnce(new Error("timeout"));
    expect(await selector.select("ROOF", cards)).toBeUndefined();
  });
});
