import type { APIGatewayProxyEvent } from "aws-lambda";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccessoriesService } from "../src/accessories/service";
import { accessoryRecommendationRequestSchema } from "../src/accessories/schema";
import { createCognitoIdentityResolver } from "../src/auth/cognito";
import { CoreService } from "../src/data/service";
import { createSystemsHandler } from "../src/handlers/systems";
import { normalizeManual } from "../src/roof/normalize";
import { SystemsService } from "../src/systems/service";
import { context, environment, request as apiRequest, sub, userOutput, verifierWithTestJwks } from "./auth-fixtures";
import { fixedNow, identity, otherId, setupData } from "./data-fixtures";

const request = (propertyId: string, analysisId: string) => ({
  propertyId, analysisId, nominalKw: 2, generationKwhPerKwYear: 1_500,
  demand: { kind: "CONSUMPTION" as const, monthlyConsumptionKwh: 600 },
});

async function setup(userId?: string) {
  const { service, repository, memory } = setupData();
  await service.bootstrap(identity(userId), {});
  const property = await service.createProperty(identity(userId), { label: "Home", address: "123 Example Road, Mumbai" });
  const analysis = await service.saveManualRoof(identity(userId), property.propertyId,
    normalizeManual({ roofAreaSquareMeters: 100, lengthMeters: 10, widthMeters: 10 }, fixedNow.toISOString()));
  return { service, repository, memory, property, analysis };
}

const item = (result: Awaited<ReturnType<AccessoriesService["recommend"]>>, id: string) =>
  result.recommendations.find(recommendation => recommendation.id === id);

describe("grounded accessory recommendations", () => {
  it("recomputes an owned roof-fit system and ranks goal-relevant equipment without prices or policy claims", async () => {
    const { service, property, analysis } = await setup();
    const advisor = new AccessoriesService(new SystemsService(service));
    const result = await advisor.recommend(identity(), { ...request(property.propertyId, analysis.analysisId),
      goals: { backupPower: true, evCharging: true, monitoring: true, easierMaintenance: true },
      inverterType: "HYBRID", evStatus: "OWNS_EV",
      site: { lightningExposure: "REPORTED_HIGH", birdActivity: true, safeCleaningAccess: "NO" } }, "req-14");
    expect(result).toMatchObject({ schemaVersion: 1, source: "DETERMINISTIC_ACCESSORY_ADVISOR_V1",
      requestId: "req-14", system: { nominalKw: 2, roofSource: "MANUAL" },
      financialIntegration: { includedInBaseEstimate: false, benefitEligibilityEvaluated: false } });
    expect(result.system.actualDcKw).toBeGreaterThan(0);
    expect(item(result, "battery-storage")).toMatchObject({ classification: "RECOMMENDED", compatibility: "REQUIRES_REVIEW" });
    expect(item(result, "ev-charger")).toMatchObject({ classification: "RECOMMENDED", compatibility: "REQUIRES_REVIEW" });
    expect(item(result, "cleaning-access")).toMatchObject({ classification: "STRONGLY_RECOMMENDED", compatibility: "REQUIRES_REVIEW" });
    expect(item(result, "bird-mitigation")?.reason).toContain("reported bird activity");
    expect(result.recommendations.every(recommendation => recommendation.classification !== "REQUIRED_BY_RULE" &&
      recommendation.policyRelevance.status === "NOT_EVALUATED" && recommendation.costRange.status === "UNAVAILABLE" &&
      recommendation.costRange.currency === "INR" && recommendation.score >= 0 && recommendation.score <= 100)).toBe(true);
    expect(result.recommendations.map(recommendation => recommendation.score)).toEqual(
      [...result.recommendations.map(recommendation => recommendation.score)].sort((a, b) => b - a));
    expect(JSON.stringify(result)).not.toMatch(/pricePaise|subsidyAmount|vendorName|affiliate|commission/);
  });

  it("does not recommend battery or EV equipment without those goals, and treats unknown inverter architecture cautiously", async () => {
    const { service, property, analysis } = await setup();
    const advisor = new AccessoriesService(new SystemsService(service));
    const plain = await advisor.recommend(identity(), request(property.propertyId, analysis.analysisId), "req");
    expect(item(plain, "battery-storage")).toMatchObject({ classification: "NOT_RECOMMENDED", score: 0 });
    expect(item(plain, "ev-charger")).toMatchObject({ classification: "NOT_RECOMMENDED", score: 0 });
    const unknown = await advisor.recommend(identity(), { ...request(property.propertyId, analysis.analysisId),
      goals: { backupPower: true } }, "req");
    expect(item(unknown, "battery-storage")).toMatchObject({ classification: "OPTIONAL", compatibility: "REQUIRES_REVIEW" });
    expect(item(unknown, "battery-storage")?.reason).toContain("architecture is unknown");
    const gridTied = await advisor.recommend(identity(), { ...request(property.propertyId, analysis.analysisId),
      goals: { backupPower: true }, inverterType: "GRID_TIED" }, "req");
    expect(item(gridTied, "battery-storage")).toMatchObject({ classification: "OPTIONAL", compatibility: "REQUIRES_REVIEW" });
    expect(gridTied.warnings.join(" ")).toContain("You reported a grid-tied inverter");
  });

  it("enforces ownership and rejects client roof facts, invalid inputs and unfit system candidates", async () => {
    const { service, repository, property, analysis } = await setup();
    const other = new CoreService(repository, { now: () => fixedNow });
    await other.bootstrap(identity(otherId), {});
    const advisor = new AccessoriesService(new SystemsService(other));
    await expect(advisor.recommend(identity(otherId), request(property.propertyId, analysis.analysisId), "req"))
      .rejects.toMatchObject({ statusCode: 404 });
    expect(accessoryRecommendationRequestSchema.safeParse({ ...request(property.propertyId, analysis.analysisId),
      roofModel: analysis.roofModel }).success).toBe(false);
    await expect(new AccessoriesService(new SystemsService(service)).recommend(identity(),
      { ...request(property.propertyId, analysis.analysisId), goals: { backupPower: "yes" } }, "req"))
      .rejects.toMatchObject({ statusCode: 400 });
    await expect(new AccessoriesService(new SystemsService(service)).recommend(identity(),
      { ...request(property.propertyId, analysis.analysisId), nominalKw: 99 }, "req"))
      .rejects.toMatchObject({ statusCode: 400, code: "INVALID_CANDIDATE" });
    await expect(new AccessoriesService(new SystemsService(service)).recommend(identity(),
      { ...request(property.propertyId, analysis.analysisId), nominalKw: 10 }, "req"))
      .rejects.toMatchObject({ statusCode: 422, code: "CANDIDATE_UNFIT" });
  });
});

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.stubEnv("ENVIRONMENT", "test"); vi.stubEnv("LOG_LEVEL", "info");
  vi.stubEnv("CORE_TABLE_NAME", "test-core-table"); vi.stubEnv("AWS_REGION", "ap-south-1");
  vi.stubEnv("COGNITO_USER_POOL_ID", environment.COGNITO_USER_POOL_ID);
  vi.stubEnv("COGNITO_CLIENT_ID", environment.COGNITO_CLIENT_ID);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

function event(body: unknown): APIGatewayProxyEvent {
  return { ...apiRequest(), resource: "/accessories/recommend", path: "/v1/accessories/recommend", httpMethod: "POST",
    body: JSON.stringify(body), headers: { ...apiRequest().headers, "content-type": "application/json" },
    requestContext: { ...apiRequest().requestContext, stage: "v1" } };
}

describe("accessory route", () => {
  it("uses verified identity and only reads the owned analysis", async () => {
    const { repository, memory, property, analysis } = await setup(sub);
    const resolve = createCognitoIdentityResolver({ createVerifier: () => verifierWithTestJwks(),
      createClient: () => ({ send: async () => userOutput() }) });
    const handler = createSystemsHandler({ resolveIdentity: resolve, createRepository: () => repository, now: () => fixedNow });
    const recordsBefore = memory.records.size;
    const commandsBefore = memory.commands.length;
    const response = await handler(event(request(property.propertyId, analysis.analysisId)), context);
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({ source: "DETERMINISTIC_ACCESSORY_ADVISOR_V1",
      analysisId: analysis.analysisId });
    expect(memory.records.size).toBe(recordsBefore);
    expect(memory.commands.slice(commandsBefore).every(command => command instanceof GetCommand)).toBe(true);
  });
});
