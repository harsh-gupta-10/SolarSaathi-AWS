import { describe, expect, it } from "vitest";
import { CoreService } from "../src/data/service";
import { normalizeManual } from "../src/roof/normalize";
import { systemRecommendationRequestSchema } from "../src/systems/schema";
import { SystemsService } from "../src/systems/service";
import { fixedNow, identity, otherId, setupData } from "./data-fixtures";

const request = (propertyId: string, analysisId: string) => ({
  propertyId, analysisId, generationKwhPerKwYear: 1_500,
  demand: { kind: "CONSUMPTION" as const, monthlyConsumptionKwh: 600 },
});

async function setup() {
  const { service, repository, memory } = setupData();
  await service.bootstrap(identity(), {});
  const property = await service.createProperty(identity(), { label: "Home", address: "123 Example Road, Mumbai" });
  const roof = normalizeManual({ roofAreaSquareMeters: 100, lengthMeters: 10, widthMeters: 10 }, fixedNow.toISOString());
  const analysis = await service.saveManualRoof(identity(), property.propertyId, roof);
  return { service, repository, memory, property, analysis };
}

describe("authenticated system recommendation", () => {
  it("uses the owned confirmed roof, explicit generation assumption and deterministic candidates", async () => {
    const { service, property, analysis } = await setup();
    const systems = new SystemsService(service);
    const result = await systems.recommend(identity(), request(property.propertyId, analysis.analysisId), "req-1");
    expect(result).toMatchObject({ schemaVersion: 1, source: "DETERMINISTIC_SYSTEM_DESIGN", requestId: "req-1",
      propertyId: property.propertyId, analysisId: analysis.analysisId,
      design: { assumptions: { generationKwhPerKwYear: 1_500 } } });
    expect(result.design.candidates.length).toBeGreaterThan(0);
    expect(result.design.warnings).toContain("SANCTIONED_LOAD_NOT_PROVIDED");
    expect(JSON.stringify(result)).not.toMatch(/grossCost|subsidy|netCost|governmentBenefit|API_KEY/);
    const bill = await systems.recommend(identity(), { ...request(property.propertyId, analysis.analysisId),
      demand: { kind: "BILL", monthlyBillRupees: 6_000, tariffRupeesPerKwh: 10, sanctionedLoadKw: 3 } }, "req-2");
    expect(bill.design.demand).toMatchObject({ source: "BILL_ESTIMATE", monthlyConsumptionKwh: 600 });
    expect(bill.design.warnings).toContain("SANCTIONED_LOAD_REVIEW_NEEDED");
    expect(bill.design.candidates.some(candidate => candidate.recommendationEligible &&
      candidate.reasonCodes.includes("SANCTIONED_LOAD_REVIEW_NEEDED"))).toBe(true);
  });

  it("does not disclose another owner's analysis or accept a client-supplied roof", async () => {
    const { repository, property, analysis } = await setup();
    const other = new CoreService(repository, { now: () => fixedNow, createId: () => "other-generated-id" });
    await other.bootstrap(identity(otherId), {});
    const systems = new SystemsService(other);
    await expect(systems.recommend(identity(otherId), request(property.propertyId, analysis.analysisId), "req"))
      .rejects.toMatchObject({ statusCode: 404 });
    expect(systemRecommendationRequestSchema.safeParse({ ...request(property.propertyId, analysis.analysisId),
      roof: analysis.roofModel }).success).toBe(false);
  });

  it("requires a normalized roof model and bounded technical inputs", async () => {
    const { service, property, analysis } = await setup();
    const legacy = await service.saveAnalysis(identity(), property.propertyId, analysis.roof);
    const systems = new SystemsService(service);
    await expect(systems.recommend(identity(), request(property.propertyId, legacy.analysisId), "req"))
      .rejects.toMatchObject({ statusCode: 409, code: "ROOF_MODEL_REQUIRED" });
    for (const invalid of [
      { ...request(property.propertyId, analysis.analysisId), generationKwhPerKwYear: 10_000 },
      { ...request(property.propertyId, analysis.analysisId), demand: { kind: "CONSUMPTION", monthlyConsumptionKwh: 0 } },
      { ...request(property.propertyId, analysis.analysisId), demand: { kind: "BILL", monthlyBillRupees: 500, tariffRupeesPerKwh: 0 } },
      { ...request(property.propertyId, analysis.analysisId), demand: { kind: "CONSUMPTION", monthlyConsumptionKwh: 600, sanctionedLoadKw: 0 } },
    ]) {
      await expect(systems.recommend(identity(), invalid, "req")).rejects.toMatchObject({ statusCode: 400 });
    }
  });

  it("rejects an expired confirmed Google roof before running the designer", async () => {
    const { service, repository, property } = await setup();
    const googleRoof = { schemaVersion: 1 as const, source: "GOOGLE_SOLAR" as const,
      measuredAt: fixedNow.toISOString(), roofAreaSquareMeters: 100, segmentCount: 1,
      segments: [{ segmentId: "google-segment-0", areaSquareMeters: 100 }], buildingId: "buildings/test-roof",
      bounds: { southwest: { latitude: 19, longitude: 72 }, northeast: { latitude: 19.001, longitude: 72.001 } } };
    const preview = await service.saveRoofPreview(identity(), property.propertyId, "place-test",
      { latitude: 19, longitude: 72 }, googleRoof);
    await service.confirmBuilding(identity(), property.propertyId, preview.previewId);
    const analysis = await service.saveConfirmedRoof(identity(), property.propertyId, preview.previewId);
    const later = new CoreService(repository, { now: () => new Date(fixedNow.getTime() + 22 * 86_400_000) });
    await expect(new SystemsService(later).recommend(identity(),
      request(property.propertyId, analysis.analysisId), "req"))
      .rejects.toMatchObject({ statusCode: 404, code: "NOT_FOUND" });
  });
});
