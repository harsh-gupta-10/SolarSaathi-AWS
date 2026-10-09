import { beforeEach, describe, expect, it, vi } from "vitest";
import { advisorApi, advisorResponseSchema } from "../src/lib/advisor-api";

const request = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("../src/lib/roof-api", () => ({
  getAuthenticated: request.get, postAuthenticated: request.post,
  RoofRequestError: class extends Error { constructor(public readonly code: string, message: string) { super(message); } },
}));

const response = { schemaVersion: 1, source: "GROUNDED_ADVISOR_V1", requestId: "request-1",
  propertyId: "property-1", analysisId: "analysis-1", status: "ANSWERED",
  mode: "DETERMINISTIC_FALLBACK", answer: "The user entered a roof area.",
  cards: [{ id: "roof", kind: "ROOF", statement: "User entered 42 m².", provenance: "USER_MEASURED" }],
  selectedCardIds: ["roof"], caveats: [], missingContext: [] };

beforeEach(() => { request.get.mockReset(); request.post.mockReset(); });

describe("advisor API boundary", () => {
  it("accepts a grounded plain-text answer and rejects untraceable selected cards", () => {
    expect(advisorResponseSchema.safeParse(response).success).toBe(true);
    expect(advisorResponseSchema.safeParse({ ...response, selectedCardIds: ["missing"] }).success).toBe(false);
    expect(advisorResponseSchema.safeParse({ ...response, cards: [{ ...response.cards[0],
      provenance: "VERIFIED_POLICY" }] }).success).toBe(false);
  });
  it("rejects cross-property analysis lists and cross-analysis answers", async () => {
    request.get.mockResolvedValue({ schemaVersion: 1, source: "DYNAMODB", requestId: "r", analyses: [{
      analysisId: "analysis-1", propertyId: "property-2", source: "MANUAL", measuredAt: "2026-10-09T08:00:00.000Z",
      roofAreaSquareMeters: 42, segmentCount: 1,
    }] });
    await expect(advisorApi.analyses("property-1")).rejects.toThrow(/different property/);
    request.post.mockResolvedValue({ ...response, analysisId: "analysis-2" });
    await expect(advisorApi.ask({ propertyId: "property-1", analysisId: "analysis-1", question: "Is it suitable?" }))
      .rejects.toThrow(/different property or roof/);
  });
  it("passes the selected analysis and question to the authenticated advisor route", async () => {
    request.post.mockResolvedValue(response);
    const controller = new AbortController();
    await advisorApi.ask({ propertyId: "property-1", analysisId: "analysis-1", question: "What does my roof show?" }, controller.signal);
    expect(request.post).toHaveBeenCalledWith("/advisor/solar", { propertyId: "property-1", analysisId: "analysis-1",
      question: "What does my roof show?" }, advisorResponseSchema, controller.signal, 30_000);
  });
});
