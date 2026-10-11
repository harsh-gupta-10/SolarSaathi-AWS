// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FinancialEstimator } from "../src/components/financial-estimator";
import { demoDesign, demoFinancialResponse } from "../src/app/demo/system-financial-fixture";

const api = vi.hoisted(() => ({ estimate: vi.fn() }));
vi.mock("../src/lib/financial-api", async importOriginal => ({
  ...(await importOriginal<typeof import("../src/lib/financial-api")>()), financialApi: api,
}));
vi.mock("../src/lib/roof-api", () => ({ RoofRequestError: class extends Error {} }));

const props = { propertyId: "property-1", analysisId: "analysis-1",
  demand: { kind: "CONSUMPTION" as const, monthlyConsumptionKwh: 300 }, generationKwhPerKwYear: 1500,
  candidates: demoDesign.candidates, recommendedNominalKw: demoDesign.recommendation!.nominalKw };

beforeEach(() => { api.estimate.mockReset(); api.estimate.mockResolvedValue(demoFinancialResponse); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("base financial estimate UI", () => {
  it("requires an explicit quote and energy values before calling the backend", async () => {
    const user = userEvent.setup();
    render(<FinancialEstimator {...props} />);
    await user.click(screen.getByRole("button", { name: "Estimate 25-year cash flow" }));
    expect(screen.getByRole("alert").textContent).toContain("Enter the installed cost");
    expect(api.estimate).not.toHaveBeenCalled();
    expect((screen.getByLabelText("Installed cost quote (₹)") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("What you pay per unit of electricity (₹/kWh)") as HTMLInputElement).value).toBe("");
  });

  it("submits user values for the stored analysis and exposes 25-year rows and sensitivity", async () => {
    const user = userEvent.setup();
    render(<FinancialEstimator {...props} />);
    await user.type(screen.getByLabelText("Installed cost quote (₹)"), "200000");
    await user.type(screen.getByLabelText("How much solar you use at home (%)"), "70");
    await user.type(screen.getByLabelText("What you pay per unit of electricity (₹/kWh)"), "8");
    await user.type(screen.getByLabelText("Export credit (₹/kWh)"), "0");
    await user.type(screen.getByLabelText("Yearly maintenance (₹/year)"), "3000");
    await user.click(screen.getByRole("button", { name: "Estimate 25-year cash flow" }));
    await screen.findByRole("heading", { name: "What this amount could mean" });
    expect(api.estimate).toHaveBeenCalledWith("property-1", "analysis-1", props.demand, 1500,
      props.recommendedNominalKw, { grossSystemCostRupees: 200000, selfConsumptionFraction: 0.7,
        importTariffRupeesPerKwh: 8, exportRateRupeesPerKwh: 0, annualMaintenanceRupees: 3000 }, expect.any(AbortSignal));
    expect(screen.getByText(/This base cash flow excludes policy benefits and financing/)).toBeTruthy();
    expect(screen.getByRole("img", { name: /Cumulative modeled cash flow/ })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "What changes the estimate?" })).toBeTruthy();
    await user.click(screen.getByText("Year-by-year cash flow (25 years)"));
    expect(screen.getByRole("region", { name: "25-year cash flow table" }).querySelectorAll("tbody tr")).toHaveLength(25);
  });

  it("clears stale estimates and the old quote when the system size changes", async () => {
    const user = userEvent.setup();
    render(<FinancialEstimator {...props} />);
    await user.type(screen.getByLabelText("Installed cost quote (₹)"), "200000");
    await user.type(screen.getByLabelText("How much solar you use at home (%)"), "70");
    await user.type(screen.getByLabelText("What you pay per unit of electricity (₹/kWh)"), "8");
    await user.type(screen.getByLabelText("Export credit (₹/kWh)"), "0");
    await user.type(screen.getByLabelText("Yearly maintenance (₹/year)"), "3000");
    await user.click(screen.getByRole("button", { name: "Estimate 25-year cash flow" }));
    await screen.findByRole("heading", { name: "What this amount could mean" });
    const other = demoDesign.candidates.find(candidate => candidate.recommendationEligible && candidate.nominalKw !== props.recommendedNominalKw)!;
    await user.selectOptions(screen.getByLabelText("System size"), String(other.nominalKw));
    expect(screen.queryByRole("heading", { name: "What this amount could mean" })).toBeNull();
    expect((screen.getByLabelText("Installed cost quote (₹)") as HTMLInputElement).value).toBe("");
  });

  it("shows backend errors without a synthetic result", async () => {
    const user = userEvent.setup();
    api.estimate.mockRejectedValue(new Error("service unavailable"));
    render(<FinancialEstimator {...props} />);
    await user.type(screen.getByLabelText("Installed cost quote (₹)"), "200000");
    await user.type(screen.getByLabelText("How much solar you use at home (%)"), "70");
    await user.type(screen.getByLabelText("What you pay per unit of electricity (₹/kWh)"), "8");
    await user.type(screen.getByLabelText("Export credit (₹/kWh)"), "0");
    await user.type(screen.getByLabelText("Yearly maintenance (₹/year)"), "3000");
    await user.click(screen.getByRole("button", { name: "Estimate 25-year cash flow" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("could not be created"));
    expect(screen.queryByRole("heading", { name: "What this amount could mean" })).toBeNull();
  });

  it("selects budget range tiers and quick-pick chips to populate the scenario", async () => {
    const user = userEvent.setup();
    render(<FinancialEstimator {...props} />);
    await user.click(screen.getByRole("radio", { name: "Standard" }));
    expect((screen.getByLabelText("Installed cost quote (₹)") as HTMLInputElement).value).toBe("1,92,000");
    await user.click(within(screen.getByRole("radiogroup", { name: "Typical self-use shares" })).getByRole("radio", { name: "80%" }));
    expect((screen.getByLabelText("How much solar you use at home (%)") as HTMLInputElement).value).toBe("80");
    await user.click(within(screen.getByRole("radiogroup", { name: "Illustrative rates" })).getByRole("radio", { name: "₹7.5" }));
    expect((screen.getByLabelText("What you pay per unit of electricity (₹/kWh)") as HTMLInputElement).value).toBe("7.5");
    await user.clear(screen.getByLabelText("Export credit (₹/kWh)"));
    await user.type(screen.getByLabelText("Export credit (₹/kWh)"), "2.5");
    await user.clear(screen.getByLabelText("Yearly maintenance (₹/year)"));
    await user.type(screen.getByLabelText("Yearly maintenance (₹/year)"), "1500");
    await user.click(screen.getByRole("button", { name: "Estimate 25-year cash flow" }));
    await screen.findByRole("heading", { name: "What this amount could mean" });
    expect(api.estimate).toHaveBeenCalledWith("property-1", "analysis-1", props.demand, 1500,
      props.recommendedNominalKw, { grossSystemCostRupees: 192000, selfConsumptionFraction: 0.8,
        importTariffRupeesPerKwh: 7.5, exportRateRupeesPerKwh: 2.5, annualMaintenanceRupees: 1500 }, expect.any(AbortSignal));
  });

  it("shows a per-field error and one summary alert, and starts advanced assumptions at an explicit zero", async () => {
    const user = userEvent.setup();
    render(<FinancialEstimator {...props} />);
    expect((screen.getByLabelText("Export credit (₹/kWh)") as HTMLInputElement).value).toBe("0");
    expect((screen.getByLabelText("Yearly maintenance (₹/year)") as HTMLInputElement).value).toBe("0");
    await user.click(screen.getByRole("button", { name: "Estimate 25-year cash flow" }));
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.getByLabelText("Installed cost quote (₹)").getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById("financial-quote-error")?.textContent).toContain("Enter the installed cost between");
  });
});
