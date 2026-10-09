import { beforeEach, describe, expect, it, vi } from "vitest";
import { accessoriesApi, accessoriesResponseSchema } from "../src/lib/accessories-api";

const request = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock("../src/lib/roof-api", () => ({
  postAuthenticated: request.post,
  RoofRequestError: class extends Error { constructor(public readonly code: string, message: string) { super(message); } },
}));

const response = { schemaVersion: 1, source: "DETERMINISTIC_ACCESSORY_ADVISOR_V1", requestId: "r1",
  propertyId: "property-1", analysisId: "analysis-1",
  system: { nominalKw: 3, actualDcKw: 3.2, minimumInverterAcKw: 2.5,
    roofSource: "MANUAL", generationBasis: "ASSUMED_YIELD" },
  recommendations: [{ id: "inverter-monitoring", title: "Production monitoring", category: "MONITORING",
    classification: "RECOMMENDED", score: 80, reason: "Matches the stated goal.",
    compatibility: "REQUIRES_REVIEW", safetyNotes: ["Check inverter support."],
    policyRelevance: { status: "NOT_EVALUATED", note: "No accessory policy rule evaluated." },
    costRange: { status: "UNAVAILABLE", currency: "INR", note: "No sourced price." } }],
  warnings: [], financialIntegration: { includedInBaseEstimate: false, benefitEligibilityEvaluated: false } };
const input = { propertyId: "property-1", analysisId: "analysis-1", nominalKw: 3,
  demand: { kind: "CONSUMPTION" as const, monthlyConsumptionKwh: 300 }, generationKwhPerKwYear: 1500 };

beforeEach(() => request.post.mockReset());

describe("accessory API boundary", () => {
  it("accepts only traceable unavailable cost and unevaluated policy states", () => {
    expect(accessoriesResponseSchema.safeParse(response).success).toBe(true);
    expect(accessoriesResponseSchema.safeParse({ ...response, recommendations: [{ ...response.recommendations[0],
      costRange: { status: "AVAILABLE", currency: "INR", min: 1000, max: 2000 } }] }).success).toBe(false);
    expect(accessoriesResponseSchema.safeParse({ ...response, recommendations: [{ ...response.recommendations[0],
      classification: "REQUIRED_BY_RULE" }] }).success).toBe(false);
  });
  it("binds the result to the selected property, roof, and system", async () => {
    request.post.mockResolvedValue({ ...response, propertyId: "property-2" });
    await expect(accessoriesApi.recommend(input)).rejects.toThrow(/selected roof and system/);
    request.post.mockResolvedValue({ ...response, system: { ...response.system, nominalKw: 5 } });
    await expect(accessoriesApi.recommend(input)).rejects.toThrow(/selected roof and system/);
  });
  it("uses the authenticated recommendation endpoint", async () => {
    request.post.mockResolvedValue(response);
    const controller = new AbortController();
    await accessoriesApi.recommend(input, controller.signal);
    expect(request.post).toHaveBeenCalledWith("/accessories/recommend", input, accessoriesResponseSchema,
      controller.signal, 30_000);
  });
});
