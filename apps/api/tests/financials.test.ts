import { describe, expect, it } from "vitest";
import { CoreService } from "../src/data/service";
import { FinancialsService } from "../src/financials/service";
import { normalizeManual } from "../src/roof/normalize";
import { fixedNow, identity, otherId, setupData } from "./data-fixtures";

const financialInputs = { grossSystemCostRupees: 200_000, selfConsumptionFraction: 0.7,
  importTariffRupeesPerKwh: 10, exportRateRupeesPerKwh: 3, annualMaintenanceRupees: 5_000 };
const request = (propertyId: string, analysisId: string) => ({ propertyId, analysisId,
  demand: { kind: "CONSUMPTION" as const, monthlyConsumptionKwh: 600 },
  generationKwhPerKwYear: 1_500, nominalKw: 3, financialInputs });

async function setup(withDimensions = true) {
  const { service, repository, memory } = setupData();
  await service.bootstrap(identity(), {});
  const property = await service.createProperty(identity(), { label: "Home", address: "123 Example Road, Mumbai" });
  const roof = normalizeManual(withDimensions ? { roofAreaSquareMeters: 100, lengthMeters: 10, widthMeters: 10 } :
    { roofAreaSquareMeters: 100 }, fixedNow.toISOString());
  const analysis = await service.saveManualRoof(identity(), property.propertyId, roof);
  return { service, repository, memory, property, analysis };
}

describe("base financial estimate service", () => {
  it("recomputes an owned feasible system and returns unsubsidized 25-year cash flow", async () => {
    const { service, property, analysis, memory } = await setup();
    const before = memory.records.size;
    const result = await new FinancialsService(service).estimate(identity(), request(property.propertyId, analysis.analysisId), "req-1");
    expect(result).toMatchObject({ schemaVersion: 1, source: "DETERMINISTIC_BASE_FINANCIAL_V1",
      requestId: "req-1", propertyId: property.propertyId, analysisId: analysis.analysisId,
      roofSource: "MANUAL", policyBenefitsEvaluated: false, financingModeled: false,
      system: { nominalKw: 3, recommendationEligible: true },
      financial: { horizonYears: 25, input: { quote: { grossSystemCostRupees: 200_000 },
        assumptions: { annualMaintenanceRupees: 5_000 } } } });
    expect(result.financial.annualRows).toHaveLength(25);
    expect(result.financial.initialCashFlowRupees).toBe(-200_000);
    expect(result.financial.totals.paybackYears).not.toBeNull();
    expect(result.financial.warnings).toEqual(expect.arrayContaining([
      "AVOIDABLE_IMPORT_TARIFF_ASSUMED", "EXPORT_SETTLEMENT_UNVERIFIED", "ANNUAL_CONSUMPTION_HELD_FLAT",
    ]));
    expect(result.financial.sensitivity.generation.low.inputFactor).toBe(0.9);
    expect(result.financial.sensitivity.generation.high.inputFactor).toBe(1.1);
    expect(memory.records.size).toBe(before);
    expect(JSON.stringify(result)).not.toMatch(/"subsidy"|"benefitAmount"|"netCost"/);
  });

  it("rejects foreign properties, client-supplied roof or candidate metrics, and invalid prices", async () => {
    const { service, repository, property, analysis } = await setup();
    const other = new CoreService(repository, { now: () => fixedNow, createId: () => "other-generated-id" });
    await other.bootstrap(identity(otherId), {});
    await expect(new FinancialsService(other).estimate(identity(otherId), request(property.propertyId, analysis.analysisId), "req"))
      .rejects.toMatchObject({ statusCode: 404 });
    const financials = new FinancialsService(service);
    for (const body of [
      { ...request(property.propertyId, analysis.analysisId), roof: analysis.roofModel },
      { ...request(property.propertyId, analysis.analysisId), system: { actualDcKw: 100 } },
      { ...request(property.propertyId, analysis.analysisId), financialInputs: { ...financialInputs, grossSystemCostRupees: 0 } },
      { ...request(property.propertyId, analysis.analysisId), financialInputs: { ...financialInputs, exportRateRupeesPerKwh: -1 } },
      { ...request(property.propertyId, analysis.analysisId), financialInputs: { ...financialInputs, selfConsumptionFraction: 1.5 } },
    ]) await expect(financials.estimate(identity(), body, "req")).rejects.toMatchObject({ statusCode: 400 });
  });

  it("rejects unfit or unknown candidates and metadata-only analyses", async () => {
    const { service, property, analysis } = await setup(false);
    const financials = new FinancialsService(service);
    await expect(financials.estimate(identity(), request(property.propertyId, analysis.analysisId), "req"))
      .rejects.toMatchObject({ statusCode: 422, code: "CANDIDATE_UNFIT" });
    await expect(financials.estimate(identity(), { ...request(property.propertyId, analysis.analysisId), nominalKw: 4 }, "req"))
      .rejects.toMatchObject({ statusCode: 400, code: "INVALID_CANDIDATE" });
    const legacy = await service.saveAnalysis(identity(), property.propertyId, analysis.roof);
    await expect(financials.estimate(identity(), request(property.propertyId, legacy.analysisId), "req"))
      .rejects.toMatchObject({ statusCode: 409, code: "ROOF_MODEL_REQUIRED" });
  });

  it("rejects a confirmed Google analysis after its original measurement expires", async () => {
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
    await expect(new FinancialsService(later).estimate(identity(),
      request(property.propertyId, analysis.analysisId), "req"))
      .rejects.toMatchObject({ statusCode: 404, code: "NOT_FOUND" });
  });
});
