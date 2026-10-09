import { describe, expect, it } from "vitest";
import type { BenefitStackResultV1 } from "@solarsaathi/policy";
import { calculateBaseFinancialsV1, calculatePolicyFinancialsV1,
  type BaseFinancialInputV1 } from "../src";

const evaluatedAt = "2026-10-09T08:00:00.000Z";
const checkedAt = "2026-10-09T07:00:00.000Z";

function baseInput(grossSystemCostRupees = 10_000): BaseFinancialInputV1 {
  return {
    schemaVersion: 1,
    system: { nominalKw: 2, actualDcKw: 2.2, yearOneGenerationKwh: 3_000,
      generationBasis: "ASSUMED_YIELD" },
    quote: { grossSystemCostRupees },
    usage: { annualConsumptionKwh: 2_000, selfConsumptionFraction: 0.8,
      importTariffRupeesPerKwh: 5, exportRateRupeesPerKwh: 2 },
    assumptions: { annualDegradationFraction: 0.1,
      annualImportTariffEscalationFraction: 0.1,
      annualExportRateEscalationFraction: 0,
      annualMaintenanceRupees: 100,
      annualMaintenanceEscalationFraction: 0 },
    sensitivity: { generationVariationFraction: 0.1, tariffVariationFraction: 0.2,
      systemCostVariationFraction: 0.1 },
  };
}

function decision(scope: "CENTRAL" | "STATE" | "DISCOM" | "LOCAL" | "OTHER",
  amountPaise: number, status: "SELECTED" | "INELIGIBLE" | "UNKNOWN" = "SELECTED"):
  BenefitStackResultV1["decisions"][number] {
  const token = scope.toLowerCase();
  return {
    benefitId: `BENEFIT#${token}`, ruleId: `RULE#${token}`, scope,
    jurisdiction: scope === "CENTRAL" ? "IN" : "IN-MH", effectiveFrom: "2026-01-01",
    status, reasonCodes: [status === "SELECTED" ? "IN_OPTIMAL_VERIFIED_STACK" : "APPLICANT_FACTS_UNKNOWN"],
    ...(status !== "UNKNOWN" ? { calculatedAmountPaise: amountPaise } : {}),
    ...(status === "SELECTED" ? { countedAmountPaise: amountPaise } : {}),
    policyId: `POLICY#${token}`, policyVersion: 2, factIds: [`FACT#${token}`],
    citations: [{ schemaVersion: 1, sourceId: `SRC#${token}`, sourceRegistryVersion: 1,
      documentId: `DOC#${token}`, documentVersion: 2, documentSha256: "a".repeat(64),
      publisherName: "Synthetic fixture", documentTitle: "Synthetic policy excerpt",
      sourceUrl: "https://example.gov.in/policy", retrievedAt: checkedAt,
      locator: { charStart: 0, charEnd: 25 } }],
    sourceChecks: [{ sourceId: `SRC#${token}`, lastCheckedAt: checkedAt,
      fresh: true, status: "HEALTHY" }],
    verificationStatus: "VERIFIED", lastVerifiedAt: "2026-10-08T07:00:00.000Z",
  };
}

function benefits(decisions: BenefitStackResultV1["decisions"], coverageComplete = true):
  BenefitStackResultV1 {
  return { schemaVersion: 1, source: "DETERMINISTIC_BENEFIT_STACK_V1", evaluatedAt,
    totalEligibleBenefitPaise: decisions.reduce((sum, item) => sum + (item.countedAmountPaise ?? 0), 0),
    coverageComplete, optimalWithinVerifiedRules: true, decisions, warnings: [] };
}

describe("Phase 11 policy-backed financial projection", () => {
  it("uses selected verified central and state benefits once, with a 25-year adjusted ledger", () => {
    const base = calculateBaseFinancialsV1(baseInput());
    const result = calculatePolicyFinancialsV1({ base, benefits: benefits([
      decision("CENTRAL", 200_000), decision("STATE", 100_000),
      decision("LOCAL", 500_000, "INELIGIBLE"),
    ]) });
    expect(result).toMatchObject({ source: "DETERMINISTIC_POLICY_FINANCIAL_V1", status: "COMPLETE",
      timingAssumption: "BENEFITS_MODELED_UPFRONT", grossCostPaise: 1_000_000,
      selectedByScopePaise: { CENTRAL: 200_000, STATE: 100_000, DISCOM: 0, LOCAL: 0, OTHER: 0 },
      totalEligibleBenefitPaise: 300_000, modeledUpfrontBenefitPaise: 300_000,
      excessBenefitPaise: 0, netUpfrontCostPaise: 700_000, initialCashFlowRupees: -7_000,
      coverageComplete: true });
    expect(result.annualRows).toHaveLength(25);
    expect(result.annualRows[0]).toMatchObject({ year: 1, baseCumulativeCashFlowRupees: 1_900,
      cumulativeCashFlowRupees: 4_900, netCashFlowRupees: 11_900 });
    expect(result.totals.paybackYears).toBeCloseTo(7_000 / 11_900);
    expect(result.annualRows[24].cumulativeCashFlowRupees).toBe(result.totals.netSavingsOver25YearsRupees);
    expect(result.provenance.selectedPolicies.map(item => item.policyVersion)).toEqual([2, 2]);
    expect(result.provenance.selectedPolicies[0].sourceIds).toEqual(["SRC#central"]);
    expect(base.annualRows[0].cumulativeCashFlowRupees).toBe(1_900);
    expect(base.sensitivity.systemCost.base.totals).toEqual(base.totals);
    expect(result.warnings).toContain("BENEFIT_PAYMENT_TIMING_UNVERIFIED");
  });

  it("labels incomplete coverage and unknown rules without counting unknown amounts", () => {
    const result = calculatePolicyFinancialsV1({ base: calculateBaseFinancialsV1(baseInput()),
      benefits: benefits([decision("CENTRAL", 200_000), decision("STATE", 500_000, "UNKNOWN")], false) });
    expect(result.status).toBe("PARTIAL");
    expect(result.netUpfrontCostPaise).toBe(800_000);
    expect(result.selectedByScopePaise.STATE).toBe(0);
    expect(result.warnings).toEqual(expect.arrayContaining([
      "POLICY_COVERAGE_INCOMPLETE", "BENEFIT_AMOUNT_UNKNOWN", "BENEFIT_PAYMENT_TIMING_UNVERIFIED",
    ]));
  });

  it("discloses selected other benefits without treating tax or financing value as upfront cash", () => {
    const base = calculateBaseFinancialsV1(baseInput());
    const result = calculatePolicyFinancialsV1({ base, benefits: benefits([
      decision("CENTRAL", 200_000), decision("OTHER", 900_000),
    ]) });
    expect(result.selectedByScopePaise).toMatchObject({ CENTRAL: 200_000, OTHER: 900_000 });
    expect(result.totalEligibleBenefitPaise).toBe(1_100_000);
    expect(result.nonUpfrontBenefitPaise).toBe(900_000);
    expect(result.modeledUpfrontBenefitPaise).toBe(200_000);
    expect(result.excessBenefitPaise).toBe(0);
    expect(result.netUpfrontCostPaise).toBe(800_000);
    expect(result.initialCashFlowRupees).toBe(-8_000);
    expect(result.annualRows[0]?.cumulativeCashFlowRupees).toBe(3_900);
    expect(result.warnings).toContain("OTHER_BENEFITS_NOT_MODELED_UPFRONT");
    expect(base.totals.paybackYears).toBeCloseTo(10_000 / 11_900);
    expect(result.totals.paybackYears).toBeCloseTo(8_000 / 11_900);
  });

  it("keeps the base upfront cost and payback when only other benefits are selected", () => {
    const base = calculateBaseFinancialsV1(baseInput());
    const result = calculatePolicyFinancialsV1({ base, benefits: benefits([decision("OTHER", 1_200_000)]) });
    expect(result.totalEligibleBenefitPaise).toBe(1_200_000);
    expect(result.nonUpfrontBenefitPaise).toBe(1_200_000);
    expect(result.modeledUpfrontBenefitPaise).toBe(0);
    expect(result.excessBenefitPaise).toBe(0);
    expect(result.netUpfrontCostPaise).toBe(result.grossCostPaise);
    expect(result.totals.paybackYears).toBe(base.totals.paybackYears);
    expect(result.warnings).toContain("OTHER_BENEFITS_NOT_MODELED_UPFRONT");
    expect(result.warnings).not.toContain("BENEFITS_EXCEED_GROSS_QUOTE");
  });

  it("keeps a verified ineligible result at zero selected benefits without inventing a grant", () => {
    const result = calculatePolicyFinancialsV1({ base: calculateBaseFinancialsV1(baseInput()),
      benefits: benefits([decision("CENTRAL", 200_000, "INELIGIBLE")]) });
    expect(result.status).toBe("COMPLETE");
    expect(result.totalEligibleBenefitPaise).toBe(0);
    expect(result.netUpfrontCostPaise).toBe(result.grossCostPaise);
    expect(result.provenance.selectedPolicies).toEqual([]);
  });

  it("floors the modeled upfront cost at zero and separates selected excess", () => {
    const result = calculatePolicyFinancialsV1({ base: calculateBaseFinancialsV1(baseInput()),
      benefits: benefits([decision("CENTRAL", 1_200_000)]) });
    expect(result.totalEligibleBenefitPaise).toBe(1_200_000);
    expect(result.modeledUpfrontBenefitPaise).toBe(1_000_000);
    expect(result.excessBenefitPaise).toBe(200_000);
    expect(result.netUpfrontCostPaise).toBe(0);
    expect(result.initialCashFlowRupees).toBe(0);
    expect(result.totals.paybackYears).toBe(0);
    expect(result.warnings).toContain("BENEFITS_EXCEED_GROSS_QUOTE");
  });

  it("rounds sub-paise gross quotes half up before subtracting integer benefits", () => {
    const base = calculateBaseFinancialsV1(baseInput(10_000.005));
    const result = calculatePolicyFinancialsV1({ base, benefits: benefits([decision("CENTRAL", 100)]) });
    expect(result.grossCostPaise).toBe(1_000_001);
    expect(result.netUpfrontCostPaise).toBe(999_901);
    expect(result.initialCashFlowRupees).toBe(-9_999.01);
  });

  it("reports absent payback when operating flow does not recover net investment", () => {
    const input = baseInput(1_000_000);
    input.system.yearOneGenerationKwh = 100;
    input.usage.annualConsumptionKwh = 1_000;
    input.usage.selfConsumptionFraction = 1;
    input.usage.importTariffRupeesPerKwh = 1;
    input.usage.exportRateRupeesPerKwh = 0;
    input.assumptions = { annualDegradationFraction: 0, annualImportTariffEscalationFraction: 0,
      annualExportRateEscalationFraction: 0, annualMaintenanceRupees: 50,
      annualMaintenanceEscalationFraction: 0 };
    const result = calculatePolicyFinancialsV1({ base: calculateBaseFinancialsV1(input),
      benefits: benefits([decision("CENTRAL", 50_000)]) });
    expect(result.totals.paybackYears).toBeNull();
    expect(result.warnings).toContain("NO_PAYBACK_WITHIN_25_YEARS");
  });

  it("fails closed on inconsistent selected totals, stale evidence, or a malformed base", () => {
    const base = calculateBaseFinancialsV1(baseInput());
    const valid = benefits([decision("CENTRAL", 200_000)]);
    expect(() => calculatePolicyFinancialsV1({ base, benefits: {
      ...valid, totalEligibleBenefitPaise: 250_000,
    } })).toThrow(RangeError);
    const stale = benefits([decision("CENTRAL", 200_000)]);
    stale.decisions[0].sourceChecks[0].fresh = false;
    expect(() => calculatePolicyFinancialsV1({ base, benefits: stale })).toThrow(RangeError);
    for (const status of ["DEGRADED", "FAILED", "STALE"] as const) {
      const unhealthy = benefits([decision("CENTRAL", 200_000)]);
      unhealthy.decisions[0].sourceChecks[0].status = status;
      expect(() => calculatePolicyFinancialsV1({ base, benefits: unhealthy })).toThrow(RangeError);
    }
    const malformedBase = { ...base, annualRows: base.annualRows.slice(1) };
    expect(() => calculatePolicyFinancialsV1({ base: malformedBase, benefits: valid })).toThrow(RangeError);
  });
});
