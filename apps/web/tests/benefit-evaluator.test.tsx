// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BenefitEvaluator } from "../src/components/benefit-evaluator";

const api = vi.hoisted(() => ({ evaluate: vi.fn() }));
vi.mock("../src/lib/benefits-api", () => ({ benefitsApi: api }));
vi.mock("../src/lib/roof-api", () => ({ RoofRequestError: class extends Error {} }));

const props = { propertyId: "property-1", analysisId: "analysis-1",
  demand: { kind: "CONSUMPTION" as const, monthlyConsumptionKwh: 300 }, generationKwhPerKwYear: 1500,
  nominalKw: 3, grossSystemCostRupees: 200000 };
const unavailable = { schemaVersion: 1, source: "DETERMINISTIC_BENEFIT_STACK_V1", status: "UNAVAILABLE",
  propertyId: "property-1", analysisId: "analysis-1", requestId: "request-1",
  system: { nominalKw: 3, actualDcKw: 3.2 }, evaluatedAt: "2026-10-08T00:00:00.000Z",
  coverage: { central: false, state: false, discom: false, local: false, other: false },
  reasonCodes: ["NO_ACTIVE_VERIFIED_RULES"] };

beforeEach(() => { api.evaluate.mockReset(); api.evaluate.mockResolvedValue(unavailable); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("benefit evaluation UI", () => {
  it("sends declared facts and leaves eligible cost unknown until supplied", async () => {
    const user = userEvent.setup();
    render(<BenefitEvaluator {...props} />);
    await user.selectOptions(screen.getByLabelText("State or union territory"), "MH");
    await user.selectOptions(screen.getByLabelText("Electricity customer type"), "RESIDENTIAL");
    await user.click(screen.getByRole("button", { name: "Evaluate benefits" }));
    await screen.findByRole("heading", { name: "Verified benefit calculation unavailable" });
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
    await screen.findByRole("heading", { name: "Verified benefit calculation unavailable" });
    expect(api.evaluate).toHaveBeenCalledWith("property-1", "analysis-1", props.demand, 1500, 3,
      12000000, expect.objectContaining({ country: "IN" }), expect.any(AbortSignal));
    await user.selectOptions(screen.getByLabelText("Connected to the electricity grid?"), "YES");
    expect(screen.queryByRole("heading", { name: "Verified benefit calculation unavailable" })).toBeNull();
  });
});
