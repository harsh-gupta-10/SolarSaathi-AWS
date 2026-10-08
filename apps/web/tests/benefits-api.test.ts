import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { benefitsApi } from "../src/lib/benefits-api";

const mocks = vi.hoisted(() => ({ session: vi.fn() }));
vi.mock("../src/lib/env", () => ({ getPublicEnvironment: () => ({ NEXT_PUBLIC_API_BASE_URL: "https://api.example.com/v1" }) }));
vi.mock("aws-amplify/auth", () => ({ fetchAuthSession: mocks.session }));

const base = { schemaVersion: 1, source: "DETERMINISTIC_BENEFIT_STACK_V1", status: "UNAVAILABLE",
  applicantFactsSource: "USER_DECLARED", eligibilityNotGuaranteed: true,
  requestId: "request-1", propertyId: "property-1", analysisId: "analysis-1",
  system: { nominalKw: 3, actualDcKw: 3.2 }, evaluatedAt: "2026-10-08T10:30:00.000Z",
  coverage: { central: false, state: false, discom: false, local: false, other: false },
  reasonCodes: ["NO_ACTIVE_VERIFIED_RULES"] };
const demand = { kind: "CONSUMPTION" as const, monthlyConsumptionKwh: 300 };

beforeEach(() => {
  mocks.session.mockReset();
  mocks.session.mockResolvedValue({ tokens: { accessToken: { toString: () => "access-token" } } });
});
afterEach(() => vi.unstubAllGlobals());

describe("benefit evaluation API client", () => {
  it("omits unknown eligible cost and validates an unavailable result without an amount", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => base });
    vi.stubGlobal("fetch", fetcher);
    await expect(benefitsApi.evaluate("property-1", "analysis-1", demand, 1500, 3, undefined,
      { country: "IN", state: "MH" })).resolves.toMatchObject({ status: "UNAVAILABLE", reasonCodes: ["NO_ACTIVE_VERIFIED_RULES"] });
    const options = fetcher.mock.calls[0]?.[1];
    expect(JSON.parse(options.body)).toEqual({ propertyId: "property-1", analysisId: "analysis-1", demand,
      generationKwhPerKwYear: 1500, nominalKw: 3, applicantFacts: { country: "IN", state: "MH" } });
    expect(options.credentials).toBe("omit");
    expect(options.redirect).toBe("error");
  });

  it("rejects a service response that combines unavailable with an amount", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200,
      json: async () => ({ ...base, result: { schemaVersion: 1, source: "DETERMINISTIC_BENEFIT_STACK_V1",
        evaluatedAt: base.evaluatedAt, totalEligibleBenefitPaise: 1, coverageComplete: false,
        optimalWithinVerifiedRules: true, decisions: [], warnings: [] } }) }));
    await expect(benefitsApi.evaluate("property-1", "analysis-1", demand, 1500, 3, undefined,
      { country: "IN" })).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("rejects a result for a different saved system", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200,
      json: async () => ({ ...base, system: { ...base.system, nominalKw: 4 } }) }));
    await expect(benefitsApi.evaluate("property-1", "analysis-1", demand, 1500, 3, undefined,
      { country: "IN" })).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
});
