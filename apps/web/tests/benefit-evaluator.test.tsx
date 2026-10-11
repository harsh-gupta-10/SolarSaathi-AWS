// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BenefitEvaluator } from "../src/components/benefit-evaluator";

const api = vi.hoisted(() => ({ evaluate: vi.fn() }));
vi.mock("../src/lib/benefits-api", async importOriginal => ({
  ...(await importOriginal<typeof import("../src/lib/benefits-api")>()), benefitsApi: api,
}));
vi.mock("../src/lib/roof-api", () => ({ RoofRequestError: class extends Error {} }));

const props = { propertyId: "property-1", analysisId: "analysis-1",
  demand: { kind: "CONSUMPTION" as const, monthlyConsumptionKwh: 300 }, generationKwhPerKwYear: 1500,
  nominalKw: 3, grossSystemCostRupees: 200000 };
const unavailable = { schemaVersion: 1, source: "DETERMINISTIC_BENEFIT_STACK_V1", status: "UNAVAILABLE",
  propertyId: "property-1", analysisId: "analysis-1", requestId: "request-1",
  system: { nominalKw: 3, actualDcKw: 3.2 }, evaluatedAt: "2026-10-08T00:00:00.000Z",
  coverage: { central: false, state: false, discom: false, local: false, other: false },
  reasonCodes: ["NO_ACTIVE_VERIFIED_RULES"] };
const citation = { schemaVersion: 1, sourceId: "SRC#SYNTHETIC", sourceRegistryVersion: 1,
  documentId: "DOC#SYNTHETIC", documentVersion: 1, documentSha256: "a".repeat(64),
  publisherName: "Fictional authority", documentTitle: "Synthetic test rule",
  sourceUrl: "https://example.com/fictional", retrievedAt: "2026-10-08T00:00:00.000Z",
  locator: { section: "Test fixture" } };
const decision = { benefitId: "BENEFIT#SYNTHETIC", ruleId: "RULE#SYNTHETIC", scope: "CENTRAL",
  jurisdiction: "IN", effectiveFrom: "2026-01-01", status: "INELIGIBLE", reasonCodes: ["CUSTOMER_TYPE_MISMATCH"],
  policyId: "POLICY#SYNTHETIC", policyVersion: 1, factIds: ["FACT#SYNTHETIC"],
  citations: [citation], sourceChecks: [{ sourceId: "SRC#SYNTHETIC", lastCheckedAt: "2026-10-08T00:00:00.000Z",
    fresh: true, status: "HEALTHY" }], verificationStatus: "VERIFIED", lastVerifiedAt: "2026-10-08T00:00:00.000Z" };

beforeEach(() => { api.evaluate.mockReset(); api.evaluate.mockResolvedValue(unavailable); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("benefit evaluation UI", () => {
  it("does not present a partial zero as determined when another source failed", async () => {
    api.evaluate.mockResolvedValue({ ...unavailable, status: "AVAILABLE", applicantFactsSource: "USER_DECLARED",
      eligibilityNotGuaranteed: true, reasonCodes: undefined,
      result: { schemaVersion: 1, source: "DETERMINISTIC_BENEFIT_STACK_V1",
        evaluatedAt: "2026-10-08T00:00:00.000Z", totalEligibleBenefitPaise: 0,
        coverageComplete: false, optimalWithinVerifiedRules: false,
        decisions: [decision, { ...decision, benefitId: "BENEFIT#UNKNOWN", ruleId: "RULE#UNKNOWN",
          scope: "STATE", status: "UNKNOWN", reasonCodes: ["SOURCE_CHECK_FAILED"],
          sourceChecks: [{ ...decision.sourceChecks[0], fresh: false, status: "FAILED" }] }],
        warnings: ["SOURCE_CHECK_FAILED"] } });
    await userEvent.click(render(<BenefitEvaluator {...props} />).getByRole("button", { name: "Evaluate benefits" }));
    expect(await screen.findByRole("heading", { name: "Benefits found in the verified rules" })).toBeTruthy();
    expect(screen.getByText("Undetermined")).toBeTruthy();
    expect(screen.queryByText("₹0")).toBeNull();
    expect(screen.getByText(/Previously verified rule SYNTHETIC/)).toBeTruthy();
    expect(screen.getByText(/current source check is missing, failed or stale/)).toBeTruthy();
  });
  it("keeps the server's unavailable answer and never substitutes a client-side subsidy", async () => {
    const user = userEvent.setup();
    render(<BenefitEvaluator {...props} />);
    await user.selectOptions(screen.getByLabelText("State or union territory"), "MH");
    await user.selectOptions(screen.getByLabelText("Electricity customer type"), "RESIDENTIAL");
    await user.click(screen.getByRole("button", { name: "Evaluate benefits" }));
    expect(await screen.findByRole("heading", { name: "No verified subsidy rule is published for your area yet" })).toBeTruthy();
    expect(screen.queryByText(/78,000/)).toBeNull();
    expect(screen.queryByRole("button", { name: /sample|fill/i })).toBeNull();
    // The step never dead-ends: concrete next steps are offered, without any subsidy amount.
    expect(screen.getByRole("heading", { name: "What you can do next" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /pmsuryaghar\.gov\.in/ }).getAttribute("href")).toBe("https://pmsuryaghar.gov.in");
    expect(screen.getByRole("link", { name: "View my roofs" }).getAttribute("href")).toBe("/app/properties");
  });
  it("sends declared facts and leaves eligible cost unknown until supplied", async () => {
    const user = userEvent.setup();
    render(<BenefitEvaluator {...props} />);
    await user.selectOptions(screen.getByLabelText("State or union territory"), "MH");
    await user.selectOptions(screen.getByLabelText("Electricity customer type"), "RESIDENTIAL");
    await user.click(screen.getByRole("button", { name: "Evaluate benefits" }));
    await screen.findByRole("heading", { name: "No verified subsidy rule is published for your area yet" });
    expect(api.evaluate).toHaveBeenCalledWith("property-1", "analysis-1", props.demand, 1500, 3,
      undefined, expect.objectContaining({ country: "IN", state: "MH", customerType: "RESIDENTIAL" }),
      expect.any(AbortSignal));
    expect(screen.queryByRole("heading", { name: /Benefits found in the verified rules/ })).toBeNull();
  });

  it("uses separately entered policy-eligible cost and clears stale results when facts change", async () => {
    const user = userEvent.setup();
    render(<BenefitEvaluator {...props} />);
    await user.click(screen.getByText("More eligibility details, if known"));
    await user.type(screen.getByLabelText("Policy-eligible cost (₹)"), "120000");
    await user.click(screen.getByRole("button", { name: "Evaluate benefits" }));
    await screen.findByRole("heading", { name: "No verified subsidy rule is published for your area yet" });
    expect(api.evaluate).toHaveBeenCalledWith("property-1", "analysis-1", props.demand, 1500, 3,
      12000000, expect.objectContaining({ country: "IN" }), expect.any(AbortSignal));
    await user.click(within(screen.getByRole("radiogroup", { name: "Connected to the electricity grid?" })).getByRole("radio", { name: "Yes" }));
    expect(screen.queryByRole("heading", { name: "No verified subsidy rule is published for your area yet" })).toBeNull();
  });
});
