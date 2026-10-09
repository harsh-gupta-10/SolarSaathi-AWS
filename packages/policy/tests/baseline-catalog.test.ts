import { describe, expect, it } from "vitest";
import { evaluateBaselineBenefitsV1 } from "../src/baseline-catalog";

describe("evaluateBaselineBenefitsV1", () => {
  it("evaluates PM Surya Ghar central subsidy for 3 kW residential system in Maharashtra", () => {
    const result = evaluateBaselineBenefitsV1({
      context: {
        country: "IN",
        state: "MH",
        customerType: "RESIDENTIAL",
        propertyType: "INDIVIDUAL_HOME",
        ownership: "OWNER",
        gridConnected: true,
        systemWatts: 3000,
      },
    });

    expect(result.schemaVersion).toBe(1);
    expect(result.optimalWithinVerifiedRules).toBe(true);
    // 2 kW @ 30,000/kW + 1 kW @ 18,000/kW = 78,000 INR = 7,800,000 paise
    expect(result.totalEligibleBenefitPaise).toBe(7_800_000);

    const decisions = result.decisions;
    const central = decisions.find(d => d.scope === "CENTRAL");
    expect(central).toBeDefined();
    expect(central?.status).toBe("SELECTED");
    expect(central?.countedAmountPaise).toBe(7_800_000);
    expect(central?.citations.length).toBeGreaterThan(0);
    expect(central?.sourceChecks[0]?.fresh).toBe(true);
    expect(central?.sourceChecks[0]?.status).toBe("HEALTHY");

    const state = decisions.find(d => d.scope === "STATE");
    expect(state).toBeDefined();
    expect(state?.status).toBe("EXCLUDED");
    expect(state?.reasonCodes).toContain("ZERO_VALUE_NO_PAYOUT");
  });

  it("evaluates 2 kW system to 60,000 INR", () => {
    const result = evaluateBaselineBenefitsV1({
      context: {
        country: "IN",
        customerType: "RESIDENTIAL",
        gridConnected: true,
        systemWatts: 2000,
      },
    });

    expect(result.totalEligibleBenefitPaise).toBe(6_000_000);
  });

  it("rejects non-residential commercial applicants as ineligible under residential scheme", () => {
    const result = evaluateBaselineBenefitsV1({
      context: {
        country: "IN",
        customerType: "COMMERCIAL",
        gridConnected: true,
        systemWatts: 3000,
      },
    });

    const central = result.decisions.find(d => d.scope === "CENTRAL");
    expect(central?.status).toBe("INELIGIBLE");
    expect(result.totalEligibleBenefitPaise).toBe(0);
  });
});
