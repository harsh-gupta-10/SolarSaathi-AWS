// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
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
    expect(screen.getByRole("alert").textContent).toContain("Enter a gross quote");
    expect(api.estimate).not.toHaveBeenCalled();
    expect((screen.getByLabelText("Gross installed quote or planning estimate for this size (₹)") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Avoidable import energy rate (₹/kWh)") as HTMLInputElement).value).toBe("");
  });

  it("submits user values for the stored analysis and exposes 25-year rows and sensitivity", async () => {
    const user = userEvent.setup();
    render(<FinancialEstimator {...props} />);
    await user.type(screen.getByLabelText("Gross installed quote or planning estimate for this size (₹)"), "200000");
    await user.type(screen.getByLabelText("Solar energy used on site (%)"), "70");
    await user.type(screen.getByLabelText("Avoidable import energy rate (₹/kWh)"), "8");
    await user.type(screen.getByLabelText("Assumed export credit (₹/kWh)"), "0");
    await user.type(screen.getByLabelText("Year-one maintenance (₹/year)"), "3000");
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
    await user.type(screen.getByLabelText("Gross installed quote or planning estimate for this size (₹)"), "200000");
    await user.type(screen.getByLabelText("Solar energy used on site (%)"), "70");
    await user.type(screen.getByLabelText("Avoidable import energy rate (₹/kWh)"), "8");
    await user.type(screen.getByLabelText("Assumed export credit (₹/kWh)"), "0");
    await user.type(screen.getByLabelText("Year-one maintenance (₹/year)"), "3000");
    await user.click(screen.getByRole("button", { name: "Estimate 25-year cash flow" }));
    await screen.findByRole("heading", { name: "What this amount could mean" });
    const other = demoDesign.candidates.find(candidate => candidate.recommendationEligible && candidate.nominalKw !== props.recommendedNominalKw)!;
    await user.selectOptions(screen.getByLabelText("System candidate"), String(other.nominalKw));
    expect(screen.queryByRole("heading", { name: "What this amount could mean" })).toBeNull();
    expect((screen.getByLabelText("Gross installed quote or planning estimate for this size (₹)") as HTMLInputElement).value).toBe("");
  });

  it("shows backend errors without a synthetic result", async () => {
    const user = userEvent.setup();
    api.estimate.mockRejectedValue(new Error("service unavailable"));
    render(<FinancialEstimator {...props} />);
    await user.type(screen.getByLabelText("Gross installed quote or planning estimate for this size (₹)"), "200000");
    await user.type(screen.getByLabelText("Solar energy used on site (%)"), "70");
    await user.type(screen.getByLabelText("Avoidable import energy rate (₹/kWh)"), "8");
    await user.type(screen.getByLabelText("Assumed export credit (₹/kWh)"), "0");
    await user.type(screen.getByLabelText("Year-one maintenance (₹/year)"), "3000");
    await user.click(screen.getByRole("button", { name: "Estimate 25-year cash flow" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("could not be created"));
    expect(screen.queryByRole("heading", { name: "What this amount could mean" })).toBeNull();
  });

  it("selects budget range tiers and input presets to populate the scenario quickly", async () => {
    const user = userEvent.setup();
    render(<FinancialEstimator {...props} />);
    // Choose Standard tier from budget range dropdown (3 kW recommended * 64,000 = 192,000)
    await user.selectOptions(screen.getByLabelText(`Indicative budget range for ${props.recommendedNominalKw} kW`), "STANDARD");
    const quoteInput = screen.getByLabelText("Gross installed quote or planning estimate for this size (₹)") as HTMLInputElement;
    expect(quoteInput.value).toBe("192000");

    // Choose preset for self-use
    await user.selectOptions(screen.getByLabelText("Solar self-consumption presets"), "80");
    expect((screen.getByLabelText("Solar energy used on site (%)") as HTMLInputElement).value).toBe("80");

    // Choose preset for import tariff
    await user.selectOptions(screen.getByLabelText("Import tariff presets"), "7.5");
    expect((screen.getByLabelText("Avoidable import energy rate (₹/kWh)") as HTMLInputElement).value).toBe("7.5");

    // Choose preset for export rate
    await user.selectOptions(screen.getByLabelText("Export credit presets"), "2.5");
    expect((screen.getByLabelText("Assumed export credit (₹/kWh)") as HTMLInputElement).value).toBe("2.5");

    // Choose preset for maintenance
    await user.selectOptions(screen.getByLabelText("Maintenance cost presets"), "1500");
    expect((screen.getByLabelText("Year-one maintenance (₹/year)") as HTMLInputElement).value).toBe("1500");

    // Submit and verify estimate call
    await user.click(screen.getByRole("button", { name: "Estimate 25-year cash flow" }));
    await screen.findByRole("heading", { name: "What this amount could mean" });
    expect(api.estimate).toHaveBeenCalledWith("property-1", "analysis-1", props.demand, 1500,
      props.recommendedNominalKw, { grossSystemCostRupees: 192000, selfConsumptionFraction: 0.8,
        importTariffRupeesPerKwh: 7.5, exportRateRupeesPerKwh: 2.5, annualMaintenanceRupees: 1500 }, expect.any(AbortSignal));
  });

  it("populates standard Indian residential benchmarks via quick setup button", async () => {
    const user = userEvent.setup();
    render(<FinancialEstimator {...props} />);
    await user.click(screen.getByRole("button", { name: /Apply standard Indian residential benchmarks/ }));
    expect((screen.getByLabelText("Gross installed quote or planning estimate for this size (₹)") as HTMLInputElement).value).toBe("192000");
    expect((screen.getByLabelText("Solar energy used on site (%)") as HTMLInputElement).value).toBe("90");
    expect((screen.getByLabelText("Avoidable import energy rate (₹/kWh)") as HTMLInputElement).value).toBe("7.5");
    expect((screen.getByLabelText("Assumed export credit (₹/kWh)") as HTMLInputElement).value).toBe("0");
    expect((screen.getByLabelText("Year-one maintenance (₹/year)") as HTMLInputElement).value).toBe("0");

    await user.click(screen.getByRole("button", { name: "Estimate 25-year cash flow" }));
    await screen.findByRole("heading", { name: "What this amount could mean" });
    expect(api.estimate).toHaveBeenCalledWith("property-1", "analysis-1", props.demand, 1500,
      props.recommendedNominalKw, { grossSystemCostRupees: 192000, selfConsumptionFraction: 0.9,
        importTariffRupeesPerKwh: 7.5, exportRateRupeesPerKwh: 0, annualMaintenanceRupees: 0 }, expect.any(AbortSignal));
  });
});
