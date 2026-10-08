import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { demoFinancialResponse } from "../src/app/demo/system-financial-fixture";
import { financialApi, type FinancialInputs } from "../src/lib/financial-api";

const mocks = vi.hoisted(() => ({ session: vi.fn() }));
vi.mock("../src/lib/env", () => ({ getPublicEnvironment: () => ({ NEXT_PUBLIC_API_BASE_URL: "https://api.example.com/v1" }) }));
vi.mock("aws-amplify/auth", () => ({ fetchAuthSession: mocks.session }));

const demand = { kind: "CONSUMPTION" as const, monthlyConsumptionKwh: 300 };
const nominalKw = demoFinancialResponse.system.nominalKw;
const financialInputs: FinancialInputs = { grossSystemCostRupees: 200_000, selfConsumptionFraction: 0.7,
  importTariffRupeesPerKwh: 8, exportRateRupeesPerKwh: 0, annualMaintenanceRupees: 3_000 };
const response = { ...demoFinancialResponse, propertyId: "property-1", analysisId: "analysis-1" };

beforeEach(() => {
  mocks.session.mockReset();
  mocks.session.mockResolvedValue({ tokens: { accessToken: { toString: () => "access-token" } } });
});
afterEach(() => vi.unstubAllGlobals());

describe("financial API client", () => {
  it("sends explicit inputs and analysis IDs without browser roof or system metrics", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => response });
    vi.stubGlobal("fetch", fetcher);
    await expect(financialApi.estimate("property-1", "analysis-1", demand, 1500, nominalKw, financialInputs)).resolves.toMatchObject({ financial: response.financial });
    expect(fetcher).toHaveBeenCalledWith("https://api.example.com/v1/financials/estimate", expect.objectContaining({
      method: "POST", credentials: "omit", redirect: "error", cache: "no-store",
      body: JSON.stringify({ propertyId: "property-1", analysisId: "analysis-1", demand,
        generationKwhPerKwYear: 1500, nominalKw, financialInputs }),
      headers: expect.objectContaining({ authorization: "Bearer access-token" }),
    }));
  });

  it("rejects an estimate for another analysis or selected system", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200,
      json: async () => ({ ...response, analysisId: "other-analysis" }) }));
    await expect(financialApi.estimate("property-1", "analysis-1", demand, 1500, nominalKw, financialInputs)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("rejects incomplete cash-flow series before rendering", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200,
      json: async () => ({ ...response, financial: { ...response.financial, annualRows: response.financial.annualRows.slice(0, 24) } }) }));
    await expect(financialApi.estimate("property-1", "analysis-1", demand, 1500, nominalKw, financialInputs)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
});
