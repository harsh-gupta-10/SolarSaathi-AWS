// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { designSolarSystem, getSystemDesignAssumptionsV1, type SystemDemand } from "@solarsaathi/calculations";
import { demoRoof } from "../src/app/demo/fixtures";
import SystemDesignerDemoPage from "../src/app/demo/system-designer/page";
import { SystemDesigner } from "../src/components/system-designer";
import { SystemDesignResults } from "../src/components/system-design-results";

const api = vi.hoisted(() => ({ recommend: vi.fn() }));
vi.mock("../src/lib/system-api", () => ({ systemApi: api }));
vi.mock("../src/lib/roof-api", () => ({ RoofRequestError: class extends Error {} }));

beforeEach(() => {
  api.recommend.mockReset();
  api.recommend.mockImplementation(async (propertyId: string, analysisId: string, demand: SystemDemand, yieldFactor: number) => ({
    schemaVersion: 1, source: "DETERMINISTIC_SYSTEM_DESIGN", requestId: "request-1", propertyId, analysisId,
    design: designSolarSystem(demoRoof, demand, { ...getSystemDesignAssumptionsV1(demoRoof), generationKwhPerKwYear: yieldFactor }),
  }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("system designer", () => {
  it("submits monthly use for the saved analysis and explains the recommendation", async () => {
    const user = userEvent.setup();
    render(<SystemDesigner propertyId="property-1" analysisId="analysis-1" />);
    await user.click(screen.getByRole("button", { name: "Compare system sizes" }));
    expect(screen.getByRole("alert").textContent).toContain("monthly electricity use");
    expect(api.recommend).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText("Monthly electricity use (kWh)"), "300");
    await user.click(screen.getByRole("button", { name: "Compare system sizes" }));
    await screen.findByText("Planning recommendation");
    expect(api.recommend).toHaveBeenCalledWith("property-1", "analysis-1", { kind: "CONSUMPTION", monthlyConsumptionKwh: 300 }, 1500, expect.any(AbortSignal));
    expect(screen.getByRole("region", { name: "System candidate comparison" })).toBeTruthy();
    expect(screen.getByText(/Roof layout distances/)).toBeTruthy();
    expect(screen.getByText(/Local DISCOM, interconnection and building rules have not been checked/)).toBeTruthy();
  });

  it("requires an explicit tariff for bill-based demand and treats sanctioned load as review context", async () => {
    const user = userEvent.setup();
    render(<SystemDesigner propertyId="property-1" analysisId="analysis-1" />);
    await user.click(screen.getByRole("radio", { name: "Bill and tariff" }));
    await user.type(screen.getByLabelText("Monthly electricity bill (₹)"), "2400");
    await user.click(screen.getByRole("button", { name: "Compare system sizes" }));
    expect(screen.getByRole("alert").textContent).toContain("effective tariff");
    expect(api.recommend).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText("Effective electricity tariff (₹/kWh)"), "8");
    await user.type(screen.getByLabelText("Sanctioned load (kW, optional)"), "1.5");
    await user.click(screen.getByRole("button", { name: "Compare system sizes" }));
    await screen.findByText("Planning recommendation");
    expect(api.recommend).toHaveBeenCalledWith("property-1", "analysis-1",
      { kind: "BILL", monthlyBillRupees: 2400, tariffRupeesPerKwh: 8, sanctionedLoadKw: 1.5 }, 1500, expect.any(AbortSignal));
    expect(screen.getByText(/not an automatic legal limit/)).toBeTruthy();
    expect(screen.getByText(/Bill-derived use/)).toBeTruthy();
  });

  it("removes stale results as soon as inputs change", async () => {
    const user = userEvent.setup();
    render(<SystemDesigner propertyId="property-1" analysisId="analysis-1" />);
    await user.type(screen.getByLabelText("Monthly electricity use (kWh)"), "300");
    await user.click(screen.getByRole("button", { name: "Compare system sizes" }));
    await screen.findByText("Planning recommendation");
    await user.type(screen.getByLabelText("Monthly electricity use (kWh)"), "0");
    expect(screen.queryByText("Planning recommendation")).toBeNull();
    expect(api.recommend).toHaveBeenCalledTimes(1);
  });

  it("labels the system demo as synthetic and renders deterministic candidates without an API call", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => null);
    render(<SystemDesignerDemoPage />);
    await waitFor(() => expect(screen.getByText(/No API request is made/)).toBeTruthy());
    expect(screen.getByRole("region", { name: "System candidate comparison" })).toBeTruthy();
    expect(screen.getByText(/Synthetic fixture result/)).toBeTruthy();
    expect(api.recommend).not.toHaveBeenCalled();
  });

  it("explains undetermined roof fit without inventing a recommendation", () => {
    const areaOnly = { ...demoRoof, manualDimensions: undefined };
    const design = designSolarSystem(areaOnly, { kind: "CONSUMPTION", monthlyConsumptionKwh: 300 },
      getSystemDesignAssumptionsV1(areaOnly));
    render(<SystemDesignResults design={design} analysisId="area-only" demo />);
    expect(screen.getByRole("heading", { name: "Roof fit is undetermined" })).toBeTruthy();
    expect(screen.queryByText("Recommended")).toBeNull();
    expect(screen.getByText(/Area alone cannot determine roof shape or panel fit/)).toBeTruthy();
  });
});
