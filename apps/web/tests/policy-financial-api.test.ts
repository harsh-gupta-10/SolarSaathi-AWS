import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { policyFinancialApi } from "../src/lib/policy-financial-api";
import { demoPolicyFinancialResponse } from "../src/app/demo/policy-financial-fixture";

const mocks = vi.hoisted(() => ({ session: vi.fn() }));
vi.mock("../src/lib/env", () => ({ getPublicEnvironment: () => ({ NEXT_PUBLIC_API_BASE_URL: "https://api.example.com/v1" }) }));
vi.mock("aws-amplify/auth", () => ({ fetchAuthSession: mocks.session }));

const response = demoPolicyFinancialResponse;
const inputs = { grossSystemCostRupees: response.base.input.quote.grossSystemCostRupees,
  selfConsumptionFraction: response.base.input.usage.selfConsumptionFraction,
  importTariffRupeesPerKwh: response.base.input.usage.importTariffRupeesPerKwh,
  exportRateRupeesPerKwh: response.base.input.usage.exportRateRupeesPerKwh,
  annualMaintenanceRupees: response.base.input.assumptions.annualMaintenanceRupees };
const demand = { kind: "CONSUMPTION" as const, monthlyConsumptionKwh: 300 };
const args = [response.propertyId, response.analysisId, demand, 1500, response.system.nominalKw,
  inputs, undefined, { country: "IN" as const, state: "MH" }] as const;

beforeEach(() => { mocks.session.mockReset(); mocks.session.mockResolvedValue({ tokens: { accessToken: { toString: () => "access-token" } } }); });
afterEach(() => vi.unstubAllGlobals());

describe("policy-backed financial API client", () => {
  it("sends only user inputs and parses the sourced adjusted projection", async () => {
    const timer = vi.spyOn(globalThis, "setTimeout");
    const fetcher = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => response });
    vi.stubGlobal("fetch", fetcher);
    await expect(policyFinancialApi.estimate(...args)).resolves.toMatchObject({ status: "AVAILABLE",
      projection: { status: "PARTIAL", timingAssumption: "BENEFITS_MODELED_UPFRONT" } });
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://api.example.com/v1/financials/policy-backed/estimate");
    expect(JSON.parse(fetcher.mock.calls[0]?.[1].body)).toEqual({ propertyId: response.propertyId,
      analysisId: response.analysisId, demand, generationKwhPerKwYear: 1500,
      nominalKw: response.system.nominalKw, financialInputs: inputs, applicantFacts: { country: "IN", state: "MH" } });
    expect(fetcher.mock.calls[0]?.[1].credentials).toBe("omit");
    expect(timer).toHaveBeenCalledWith(expect.any(Function), 30_000);
    timer.mockRestore();
  });

  it("accepts no policy projection when current benefits are unavailable", async () => {
    const unavailable = { ...response, status: "UNAVAILABLE", projection: undefined,
      benefits: { ...response.benefits, status: "UNAVAILABLE", result: undefined,
        reasonCodes: ["NO_ACTIVE_VERIFIED_RULES"] }, reasonCodes: ["NO_ACTIVE_VERIFIED_RULES"] };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => unavailable }));
    await expect(policyFinancialApi.estimate(...args)).resolves.toMatchObject({ status: "UNAVAILABLE",
      projection: undefined, benefits: { status: "UNAVAILABLE" } });
  });

  it("rejects contradictory or foreign responses rather than presenting adjusted amounts", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, status: 200,
      json: async () => ({ ...response, status: "UNAVAILABLE" }) });
    vi.stubGlobal("fetch", fetcher);
    await expect(policyFinancialApi.estimate(...args)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    fetcher.mockResolvedValue({ ok: true, status: 200,
      json: async () => ({ ...response, benefits: { ...response.benefits, analysisId: "other" } }) });
    await expect(policyFinancialApi.estimate(...args)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
});
