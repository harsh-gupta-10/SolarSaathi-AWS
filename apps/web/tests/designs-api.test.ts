import { beforeEach, describe, expect, it, vi } from "vitest";
import { designsApi, designsResponseSchema, designGenerationResponseSchema } from "../src/lib/designs-api";

const request = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock("../src/lib/roof-api", () => ({ postAuthenticated: request.post,
  RoofRequestError: class extends Error { constructor(public readonly code: string, message: string) { super(message); } },
}));
const rectangle = (minX: number, maxX: number, minZ: number, maxZ: number) => [
  { x: minX, y: 0, z: minZ }, { x: maxX, y: 0, z: minZ },
  { x: maxX, y: 0, z: maxZ }, { x: minX, y: 0, z: maxZ },
];
const fingerprint = "b".repeat(64);
const candidate = { candidateId: "drying", category: "DRYING", title: "Drying corner", status: "SPACE_FEASIBLE",
  reason: "A modeled clear zone fits this concept.", requiredAreaSquareMeters: 4, modeledAreaSquareMeters: 6,
  placement: { zoneId: "zone-1", corners: rectangle(5.5, 7.5, 2, 4), areaSquareMeters: 4 },
  requiresStructuralReview: true, safetyNotes: ["Site review required."], fingerprint,
  template: { status: "DETERMINISTIC_FALLBACK" }, image: { status: "NOT_REQUESTED" } };
const response = { schemaVersion: 1, source: "DETERMINISTIC_REMAINING_SPACE_V1", requestId: "r1",
  propertyId: "property-1", analysisId: "analysis-1", system: { nominalKw: 3, actualDcKw: 3.2, panelCount: 3 },
  planning: { fitStatus: "SPACE_FEASIBLE", roofAreaSquareMeters: 80, modeledUsableProjectedAreaSquareMeters: 30,
    reservedSolarProjectedAreaSquareMeters: 24, remainingProjectedAreaSquareMeters: 6,
    assumptions: { edgeSetbackMeters: 0.5, servicePathWidthMeters: 0.8, solarBufferMeters: 0.75 } },
  geometry: { coordinateSystem: "LOCAL_EAST_UP_NORTH_METERS",
    segments: [{ segmentId: "segment-1", corners: rectangle(0, 10, 0, 8) }], panels: [],
    freeZones: [{ zoneId: "zone-1", segmentId: "segment-1", corners: rectangle(5, 8, 2, 4), areaSquareMeters: 6 }], totalFreeZoneCount: 1 },
  candidates: [candidate], warnings: ["Site review required."] };
const input = { propertyId: "property-1", analysisId: "analysis-1", nominalKw: 3,
  demand: { kind: "CONSUMPTION" as const, monthlyConsumptionKwh: 300 }, generationKwhPerKwYear: 1500 };

beforeEach(() => request.post.mockReset());

describe("remaining-roof API boundary", () => {
  it("requires a traceable, space-feasible placement and a 64-character fingerprint", () => {
    expect(designsResponseSchema.safeParse(response).success).toBe(true);
    expect(designsResponseSchema.safeParse({ ...response, candidates: [{ ...candidate, fingerprint: "invalid" }] }).success).toBe(false);
    expect(designsResponseSchema.safeParse({ ...response, candidates: [{ ...candidate, placement: {
      ...candidate.placement, zoneId: "foreign-zone" } }] }).success).toBe(false);
    expect(designsResponseSchema.safeParse({ ...response, planning: { ...response.planning, fitStatus: "UNDETERMINED" } }).success).toBe(false);
    expect(designsResponseSchema.safeParse({ ...response, geometry: { ...response.geometry, totalFreeZoneCount: 0 } }).success).toBe(false);
  });
  it("rejects a result for another property, analysis or system", async () => {
    request.post.mockResolvedValue({ ...response, analysisId: "analysis-2" });
    await expect(designsApi.recommend(input)).rejects.toThrow(/selected roof and system/);
    request.post.mockResolvedValue({ ...response, system: { ...response.system, nominalKw: 5 } });
    await expect(designsApi.recommend(input)).rejects.toThrow(/selected roof and system/);
  });
  it("uses the authenticated design route and validates generated image scope", async () => {
    request.post.mockResolvedValue(response);
    const controller = new AbortController();
    await designsApi.recommend(input, controller.signal);
    expect(request.post).toHaveBeenCalledWith("/designs/recommend", input, designsResponseSchema, controller.signal, 30_000);
    const concept = { schemaVersion: 1, source: "ROOFTOP_DESIGN_CONCEPT_V1", requestId: "r2",
      propertyId: "property-1", analysisId: "analysis-1", candidate,
      concept: { template: { status: "DETERMINISTIC_FALLBACK", fingerprint }, image: {
        status: "UNAVAILABLE", propertyScoped: false, visualAccuracy: "INSPIRATIONAL_ONLY", reason: "Model unavailable." } },
      warnings: [] };
    expect(designGenerationResponseSchema.safeParse(concept).success).toBe(true);
    expect(designGenerationResponseSchema.safeParse({ ...concept, concept: { ...concept.concept, image: {
      status: "READY", url: "http://example.com/image", expiresAt: "2026-10-09T10:00:00.000Z",
      source: "BEDROCK_NOVA_CANVAS", propertyScoped: false, visualAccuracy: "INSPIRATIONAL_ONLY" } } }).success).toBe(false);
    request.post.mockResolvedValue(concept);
    await designsApi.generate(input, candidate as Parameters<typeof designsApi.generate>[1], "IMAGE", controller.signal);
    expect(request.post).toHaveBeenLastCalledWith("/designs/generate", { ...input, candidateId: "drying", render: "IMAGE" },
      designGenerationResponseSchema, controller.signal, 45_000);
  });
});
