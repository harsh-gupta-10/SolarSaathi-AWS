import type { APIGatewayProxyEvent } from "aws-lambda";
import { TransactWriteCommand, type TransactWriteCommandInput } from "@aws-sdk/lib-dynamodb";
import { designSolarSystem, getSystemDesignAssumptionsV1 } from "@solarsaathi/calculations";
import type { NormalizedRoofV1 } from "@solarsaathi/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCognitoIdentityResolver } from "../src/auth/cognito";
import { type CoreExecutor } from "../src/data/client";
import { CoreService } from "../src/data/service";
import { applyStoredTemplate, visibleZones, planRemainingSpaceV1 } from "../src/designs/geometry";
import type { DesignAssetStore, DesignImageGenerator } from "../src/designs/image";
import { DesignsService } from "../src/designs/service";
import { DesignStore, type StoredDesignTemplate } from "../src/designs/store";
import type { DesignCandidateV1, ZoneV1 } from "../src/designs/schema";
import { createDesignsHandler } from "../src/handlers/designs";
import { normalizeManual } from "../src/roof/normalize";
import { context, environment, request as apiRequest, sub, userOutput, verifierWithTestJwks } from "./auth-fixtures";
import { fixedNow, identity, MemoryExecutor, otherId, setupData } from "./data-fixtures";

const input = (propertyId: string, analysisId: string) => ({ propertyId, analysisId, nominalKw: 2,
  generationKwhPerKwYear: 1_500, demand: { kind: "CONSUMPTION" as const, monthlyConsumptionKwh: 600 } });
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);

function designExecutor(memory: MemoryExecutor): CoreExecutor {
  return async command => {
    if (!(command instanceof TransactWriteCommand) || !command.input.TransactItems?.some(item => item.Update)) {
      return memory.execute(command);
    }
    const operations = command.input.TransactItems as NonNullable<TransactWriteCommandInput["TransactItems"]>;
    const claim = operations[0].Put!;
    const claimKey = claim.Item as { PK: string; SK: string };
    const updates = operations.slice(1).map(item => item.Update!);
    const blocked = !!memory.read(claimKey) || updates.some(update => {
      const count = memory.read(update.Key as { PK: string; SK: string })?.attempts as number | undefined;
      return (count ?? 0) >= (update.ExpressionAttributeValues?.[":max"] as number);
    });
    if (blocked) throw Object.assign(new Error("conditional transaction"), { name: "TransactionCanceledException",
      CancellationReasons: [{ Code: "ConditionalCheckFailed" }, { Code: "None" }, { Code: "None" }] });
    memory.seed(claim.Item as { PK: string; SK: string } & Record<string, unknown>);
    for (const update of updates) {
      const key = update.Key as { PK: string; SK: string };
      const before = memory.read(key);
      memory.seed({ ...key, attempts: ((before?.attempts as number | undefined) ?? 0) + 1,
        expiresAtEpochSeconds: update.ExpressionAttributeValues?.[":expire"] });
    }
    return {};
  };
}

async function setup(userId?: string, dimensions = true) {
  const { memory, service, repository } = setupData();
  await service.bootstrap(identity(userId), {});
  const property = await service.createProperty(identity(userId), { label: "Home", address: "123 Example Road, Mumbai" });
  const analysis = await service.saveManualRoof(identity(userId), property.propertyId,
    normalizeManual(dimensions ? { roofAreaSquareMeters: 100, lengthMeters: 10, widthMeters: 10 } :
      { roofAreaSquareMeters: 100 }, fixedNow.toISOString()));
  return { memory, service, repository, property, analysis,
    store: new DesignStore("test-core-table", designExecutor(memory)) };
}

describe("remaining-roof planner", () => {
  it("reserves edge, service and panel buffers before placing alternate concepts", async () => {
    const { service, property, analysis, store } = await setup();
    const result = await new DesignsService(service, store, undefined, undefined, { now: () => fixedNow })
      .recommend(identity(), input(property.propertyId, analysis.analysisId), "req-15");
    expect(result).toMatchObject({ source: "DETERMINISTIC_REMAINING_SPACE_V1", requestId: "req-15",
      system: { nominalKw: 2 }, planning: { fitStatus: "SPACE_FEASIBLE",
        assumptions: { edgeSetbackMeters: 0.5, servicePathWidthMeters: 0.75, solarBufferMeters: 0.75 } } });
    expect(result.planning.modeledUsableProjectedAreaSquareMeters).toBeGreaterThan(result.planning.remainingProjectedAreaSquareMeters!);
    expect(result.planning.reservedSolarProjectedAreaSquareMeters).toBeGreaterThan(0);
    expect(result.geometry.panels).toHaveLength(result.system.panelCount);
    expect(result.geometry.freeZones.length).toBeGreaterThan(0);
    expect(result.geometry.totalFreeZoneCount).toBeGreaterThanOrEqual(result.geometry.freeZones.length);
    for (const candidate of result.candidates) {
      expect(candidate.requiresStructuralReview).toBe(true);
      expect(candidate.fingerprint).toMatch(/^[a-f0-9]{64}$/);
      if (candidate.placement) {
        expect(candidate.status).toBe("SPACE_FEASIBLE");
        expect(result.geometry.freeZones.some(zone => zone.zoneId === candidate.placement!.zoneId)).toBe(true);
      }
    }
  });

  it("rejects area-only roofs and unauthorized analysis access before a concept", async () => {
    const areaOnly = await setup(undefined, false);
    await expect(new DesignsService(areaOnly.service).recommend(identity(),
      input(areaOnly.property.propertyId, areaOnly.analysis.analysisId), "req"))
      .rejects.toMatchObject({ statusCode: 422, code: "ROOF_GEOMETRY_UNDETERMINED" });
    const owned = await setup();
    const foreign = new CoreService(owned.repository, { now: () => fixedNow });
    await foreign.bootstrap(identity(otherId), {});
    await expect(new DesignsService(foreign).recommend(identity(otherId),
      input(owned.property.propertyId, owned.analysis.analysisId), "req"))
      .rejects.toMatchObject({ statusCode: 404 });
    await expect(new DesignsService(owned.service).recommend(identity(),
      { ...input(owned.property.propertyId, owned.analysis.analysisId), roofModel: owned.analysis.roofModel }, "req"))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  it("fails closed for overlapping Google segment rectangles", () => {
    const roof: NormalizedRoofV1 = { schemaVersion: 1, source: "GOOGLE_SOLAR", measuredAt: fixedNow.toISOString(),
      roofAreaSquareMeters: 200, segmentCount: 2, buildingId: "buildings/test",
      bounds: { southwest: { latitude: 19, longitude: 72 }, northeast: { latitude: 19.000135, longitude: 72.000143 } },
      center: { latitude: 19.000067, longitude: 72.000071 },
      segments: [
        { segmentId: "first", areaSquareMeters: 100, bounds: {
          southwest: { latitude: 19, longitude: 72 }, northeast: { latitude: 19.00009, longitude: 72.000095 } } },
        { segmentId: "second", areaSquareMeters: 100, bounds: {
          southwest: { latitude: 19.000045, longitude: 72.000047 }, northeast: { latitude: 19.000135, longitude: 72.000143 } } },
      ], panelSuggestions: [{ segmentIndex: 0, center: { latitude: 19.00002, longitude: 72.00002 }, orientation: "PORTRAIT" }],
    };
    const assumptions = getSystemDesignAssumptionsV1(roof);
    const system = designSolarSystem(roof, { kind: "CONSUMPTION", monthlyConsumptionKwh: 600 }, assumptions);
    const result = planRemainingSpaceV1(roof, assumptions, system.candidates[0], "req", "property", "analysis");
    expect(result.planning.fitStatus).toBe("UNDETERMINED");
    expect(result.planning.remainingProjectedAreaSquareMeters).toBeNull();
    expect(result.geometry.freeZones).toEqual([]);
    expect(result.geometry.totalFreeZoneCount).toBe(0);
    expect(result.candidates.every(candidate => candidate.placement === undefined)).toBe(true);
    expect(result.warnings.join(" ")).toContain("segment bounds overlap");
  });

  it("keeps a fitting zone beyond the first 40 areas visible in the returned geometry", () => {
    const corners = (size: number) => [{ x: 0, y: 0, z: 0 }, { x: size, y: 0, z: 0 },
      { x: size, y: 0, z: size }, { x: 0, y: 0, z: size }] as ZoneV1["corners"];
    const zones: ZoneV1[] = Array.from({ length: 50 }, (_, index) => ({ zoneId: `zone-${index + 1}`,
      segmentId: "roof", corners: corners(10 - index / 10), areaSquareMeters: 100 - index }));
    const candidate = { placement: { zoneId: "zone-50", corners: corners(5), areaSquareMeters: 25 } } as DesignCandidateV1;
    const visible = visibleZones(zones, [candidate]);
    expect(visible.length).toBeLessThanOrEqual(40);
    expect(visible.some(zone => zone.zoneId === "zone-50")).toBe(true);
  });
});

describe("design template and image storage", () => {
  it("stores a generic template and claims a paid image once for one owned analysis", async () => {
    const { service, store, memory, property, analysis } = await setup();
    const generator: DesignImageGenerator = { generate: vi.fn(async () => png) };
    const assets: DesignAssetStore = { put: vi.fn(async () => undefined), delete: vi.fn(async () => undefined),
      signedUrl: vi.fn(async () => "https://assets.example/design.png?signature=test") };
    const advisor = new DesignsService(service, store, generator, assets, { now: () => fixedNow });
    const request = { ...input(property.propertyId, analysis.analysisId), candidateId: "drying", render: "IMAGE" };
    const first = await advisor.generate(identity(), request, "req");
    expect(first.concept).toMatchObject({ template: { status: "STORED" }, image: {
      status: "READY", source: "BEDROCK_NOVA_CANVAS", propertyScoped: true, visualAccuracy: "INSPIRATIONAL_ONLY" } });
    expect(first.designId).toMatch(/^[a-f0-9]{32}$/);
    expect(first.concept.image.expiresAt).toBeDefined();
    const second = await advisor.generate(identity(), request, "req2");
    expect(second.concept.image.status).toBe("READY");
    expect(generator.generate).toHaveBeenCalledTimes(1);
    expect(assets.put).toHaveBeenCalledTimes(1);
    const savedTemplate = memory.read({ PK: `DESIGN#${first.candidate.fingerprint}`, SK: "VERSION#1" });
    expect(savedTemplate?.designSpec).toMatchObject({ layoutVersion: 1,
      placementStrategy: "CENTER_LARGEST_FITTING_ZONE_ALLOW_ROTATION",
      footprintWidthMeters: 2, footprintDepthMeters: 2 });
    const reused = await advisor.recommend(identity(), input(property.propertyId, analysis.analysisId), "reuse");
    const reusedCandidate = reused.candidates.find(item => item.candidateId === "drying");
    expect(reusedCandidate?.template.status).toBe("STORED");
    expect(reusedCandidate?.placement).toEqual(first.candidate.placement);
    const tinyZone: ZoneV1 = { zoneId: reusedCandidate!.placement!.zoneId, segmentId: "tiny",
      corners: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 },
        { x: 1, y: 0, z: 1 }, { x: 0, y: 0, z: 1 }], areaSquareMeters: 1 };
    const freshCandidate = { ...reusedCandidate!, template: { status: "DETERMINISTIC_FALLBACK" as const } };
    expect(applyStoredTemplate(freshCandidate, [tinyZone], savedTemplate as StoredDesignTemplate)).toBe(false);
    expect(freshCandidate.template.status).toBe("DETERMINISTIC_FALLBACK");
    expect(memory.read({ PK: `PROPERTY#${property.propertyId}`, SK: `DESIGN#${first.designId}` })?.imageS3Key)
      .toBe(`generated/${property.propertyId}/${analysis.analysisId}/${first.designId}.png`);
    const authorized = await advisor.image(identity(), first.designId, { propertyId: property.propertyId }, "req3");
    expect(authorized).toMatchObject({ status: "READY", visualAccuracy: "INSPIRATIONAL_ONLY" });
    const other = new CoreService(new (await import("../src/data/repository")).CoreRepository("test-core-table", memory.execute),
      { now: () => fixedNow });
    await other.bootstrap(identity(otherId), {});
    await expect(new DesignsService(other, store, generator, assets, { now: () => fixedNow })
      .image(identity(otherId), first.designId, { propertyId: property.propertyId }, "req"))
      .rejects.toMatchObject({ statusCode: 404 });
  });

  it("enforces atomic per-user and global daily model-attempt caps", async () => {
    const memory = new MemoryExecutor();
    const store = new DesignStore("test-core-table", designExecutor(memory));
    const fp = "a".repeat(64);
    expect(await store.claimImageGeneration("property", "design-one", "owner", "owner", "analysis", fp, fixedNow)).toBe(true);
    expect(await store.claimImageGeneration("property", "design-one", "owner", "owner", "analysis", fp, fixedNow)).toBe(false);
    expect(await store.claimImageGeneration("property", "design-two", "owner", "owner", "analysis", fp, fixedNow)).toBe(true);
    expect(await store.claimImageGeneration("property", "design-three", "owner", "owner", "analysis", fp, fixedNow)).toBe(false);
    expect(await store.claimImageGeneration("property", "broker-attempt", "owner", "other-actor", "analysis", fp, fixedNow)).toBe(true);
    for (let index = 0; index < 17; index++) {
      expect(await store.claimImageGeneration("property", `extra-${index}`, `owner-${index}`, `owner-${index}`, "analysis", fp, fixedNow)).toBe(true);
    }
    expect(await store.claimImageGeneration("property", "over-global", "new-owner", "new-owner", "analysis", fp, fixedNow)).toBe(false);
    expect(memory.read({ PK: "DESIGN_BUDGET#2026-10-08", SK: "GLOBAL" })?.attempts).toBe(20);
    expect(memory.read({ PK: "DESIGN_BUDGET#2026-10-08", SK: "USER#owner" })?.attempts).toBe(2);
  });

  it("keeps deterministic fallback after model failure and deletes an orphaned asset on metadata failure", async () => {
    const { service, store, property, analysis } = await setup();
    const failed: DesignImageGenerator = { generate: vi.fn(async () => { throw new Error("private model error"); }) };
    const assets: DesignAssetStore = { put: vi.fn(async () => undefined), delete: vi.fn(async () => undefined),
      signedUrl: vi.fn(async () => "https://assets.example/image") };
    const advisor = new DesignsService(service, store, failed, assets, { now: () => fixedNow });
    const request = { ...input(property.propertyId, analysis.analysisId), candidateId: "drying", render: "IMAGE" };
    const first = await advisor.generate(identity(), request, "req");
    const repeat = await advisor.generate(identity(), request, "req2");
    expect(first.concept.image.status).toBe("UNAVAILABLE");
    expect(repeat.candidate.placement).toBeDefined();
    expect(failed.generate).toHaveBeenCalledTimes(1);
    expect(JSON.stringify([first, repeat])).not.toContain("private model error");

    const fresh = await setup();
    const brokenStore = new DesignStore("test-core-table", designExecutor(fresh.memory));
    brokenStore.createUserDesign = async () => { throw new Error("private metadata failure"); };
    const available: DesignImageGenerator = { generate: vi.fn(async () => png) };
    const orphan = await new DesignsService(fresh.service, brokenStore, available, assets, { now: () => fixedNow })
      .generate(identity(), { ...input(fresh.property.propertyId, fresh.analysis.analysisId),
        candidateId: "drying", render: "IMAGE" }, "req");
    expect(orphan.concept.image.status).toBe("UNAVAILABLE");
    expect(assets.delete).toHaveBeenCalledTimes(1);
  });

  it("skips image generation near a Google roof's 21-day expiry", async () => {
    const { service, repository, memory } = setupData();
    await service.bootstrap(identity(), {});
    const property = await service.createProperty(identity(), { label: "Home", address: "123 Example Road, Mumbai" });
    const google: NormalizedRoofV1 = { schemaVersion: 1, source: "GOOGLE_SOLAR", measuredAt: fixedNow.toISOString(),
      roofAreaSquareMeters: 100, segmentCount: 1, buildingId: "buildings/retention-test",
      bounds: { southwest: { latitude: 19, longitude: 72 }, northeast: { latitude: 19.00009, longitude: 72.000095 } },
      center: { latitude: 19.000045, longitude: 72.000047 },
      segments: [{ segmentId: "roof-1", areaSquareMeters: 100,
        bounds: { southwest: { latitude: 19, longitude: 72 }, northeast: { latitude: 19.00009, longitude: 72.000095 } } }],
      panelSuggestions: [
        { segmentIndex: 0, center: { latitude: 19.00002, longitude: 72.00002 }, orientation: "PORTRAIT" },
        { segmentIndex: 0, center: { latitude: 19.000065, longitude: 72.00002 }, orientation: "PORTRAIT" },
      ],
    };
    const preview = await service.saveRoofPreview(identity(), property.propertyId, "place-test",
      { latitude: 19.000045, longitude: 72.000047 }, google);
    await service.confirmBuilding(identity(), property.propertyId, preview.previewId);
    const analysis = await service.saveConfirmedRoof(identity(), property.propertyId, preview.previewId);
    const nearExpiry = new Date(fixedNow.getTime() + 20 * 86_400_000);
    const core = new CoreService(repository, { now: () => nearExpiry });
    const generator: DesignImageGenerator = { generate: vi.fn(async () => png) };
    const assets: DesignAssetStore = { put: vi.fn(async () => undefined), delete: vi.fn(async () => undefined),
      signedUrl: vi.fn(async () => "https://assets.example/image") };
    const advisor = new DesignsService(core, new DesignStore("test-core-table", designExecutor(memory)),
      generator, assets, { now: () => nearExpiry });
    const result = await advisor.generate(identity(), { ...input(property.propertyId, analysis.analysisId),
      nominalKw: 1, candidateId: "drying", render: "IMAGE" }, "req");
    expect(result.concept.image.status).toBe("UNAVAILABLE");
    expect(result.warnings.join(" ")).toContain("close to expiry");
    expect(generator.generate).not.toHaveBeenCalled();
    const expired = new CoreService(repository, { now: () => new Date(fixedNow.getTime() + 22 * 86_400_000) });
    await expect(new DesignsService(expired).recommend(identity(),
      { ...input(property.propertyId, analysis.analysisId), nominalKw: 1 }, "req"))
      .rejects.toMatchObject({ statusCode: 404 });
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
  return { ...apiRequest(), resource: "/designs/recommend", path: "/v1/designs/recommend", httpMethod: "POST",
    body: JSON.stringify(body), headers: { ...apiRequest().headers, "content-type": "application/json" },
    requestContext: { ...apiRequest().requestContext, stage: "v1" } };
}

describe("authenticated design handler", () => {
  it("serves deterministic concepts with Cognito identity and rejects bad routes and methods", async () => {
    const { memory, repository, property, analysis } = await setup(sub);
    const resolve = createCognitoIdentityResolver({ createVerifier: () => verifierWithTestJwks(),
      createClient: () => ({ send: async () => userOutput() }) });
    const handler = createDesignsHandler({ resolveIdentity: resolve, createRepository: () => repository,
      createDesignStore: () => new DesignStore("test-core-table", designExecutor(memory)), now: () => fixedNow });
    const count = memory.records.size;
    const response = await handler(event(input(property.propertyId, analysis.analysisId)), context);
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({ source: "DETERMINISTIC_REMAINING_SPACE_V1" });
    expect(memory.records.size).toBe(count);
    expect((await handler({ ...event({}), httpMethod: "GET" }, context)).statusCode).toBe(405);
    expect((await handler({ ...event({}), resource: "/designs/unknown", path: "/v1/designs/unknown" }, context)).statusCode).toBe(404);
  });
});
