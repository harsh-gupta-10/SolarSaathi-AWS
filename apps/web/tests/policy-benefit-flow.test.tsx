// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BenefitEvaluator } from "../src/components/benefit-evaluator";
import { demoPolicyFinancialResponse } from "../src/app/demo/policy-financial-fixture";

const api = vi.hoisted(() => ({ estimate: vi.fn() }));
vi.mock("../src/lib/policy-financial-api", () => ({ policyFinancialApi: api }));
vi.mock("../src/lib/roof-api", () => ({ RoofRequestError: class extends Error {} }));

const fixture = demoPolicyFinancialResponse;
const financialInputs = { grossSystemCostRupees: fixture.base.input.quote.grossSystemCostRupees,
  selfConsumptionFraction: fixture.base.input.usage.selfConsumptionFraction,
  importTariffRupeesPerKwh: fixture.base.input.usage.importTariffRupeesPerKwh,
  exportRateRupeesPerKwh: fixture.base.input.usage.exportRateRupeesPerKwh,
  annualMaintenanceRupees: fixture.base.input.assumptions.annualMaintenanceRupees };
const props = { propertyId: fixture.propertyId, analysisId: fixture.analysisId,
  demand: { kind: "CONSUMPTION" as const, monthlyConsumptionKwh: 300 }, generationKwhPerKwYear: 1500,
  nominalKw: fixture.system.nominalKw, grossSystemCostRupees: financialInputs.grossSystemCostRupees,
  financialInputs };

beforeEach(() => { api.estimate.mockReset(); api.estimate.mockResolvedValue(fixture); });
afterEach(cleanup);

describe("policy financial flow", () => {
  it("uses declared facts with the base scenario and clears the adjusted result when facts change", async () => {
    const user = userEvent.setup();
    render(<BenefitEvaluator {...props} />);
    await user.selectOptions(screen.getByLabelText("State or union territory"), "MH");
    await user.click(screen.getByRole("button", { name: "Estimate with verified benefits" }));
    await screen.findByRole("heading", { name: "From your quote to a modeled net cost" });
    expect(api.estimate).toHaveBeenCalledWith(fixture.propertyId, fixture.analysisId, props.demand, 1500,
      fixture.system.nominalKw, financialInputs, undefined,
      expect.objectContaining({ country: "IN", state: "MH" }), expect.any(AbortSignal));
    await user.click(screen.getByText("View rule decisions and source details"));
    expect(screen.getByText(/Verified policy SYNTHETIC_DEMO/)).toBeTruthy();
    await user.selectOptions(screen.getByLabelText("State or union territory"), "GJ");
    expect(screen.queryByRole("heading", { name: "From your quote to a modeled net cost" })).toBeNull();
  });
});
