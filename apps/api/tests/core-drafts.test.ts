import type { APIGatewayProxyEvent } from "aws-lambda";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCognitoIdentityResolver } from "../src/auth/cognito";
import { createCoreHandler } from "../src/handlers/core";
import { draftKey } from "../src/data/drafts";
import { keys } from "../src/data/keys";
import { normalizeManual } from "../src/roof/normalize";
import { context, environment, request, signedToken, sub, userOutput, verifierWithTestJwks } from "./auth-fixtures";
import { MemoryItemTable } from "./chat-fixtures";
import { fixedNow, identity, otherId, setupData } from "./data-fixtures";

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.stubEnv("ENVIRONMENT", "test"); vi.stubEnv("LOG_LEVEL", "info");
  vi.stubEnv("CORE_TABLE_NAME", "test-core-table"); vi.stubEnv("AWS_REGION", "ap-south-1");
  vi.stubEnv("COGNITO_USER_POOL_ID", environment.COGNITO_USER_POOL_ID);
  vi.stubEnv("COGNITO_CLIENT_ID", environment.COGNITO_CLIENT_ID); vi.stubEnv("COGNITO_REGION", "");
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

function event(path: string, method = "GET", body?: unknown): APIGatewayProxyEvent {
  return {
    ...request(signedToken({ "cognito:groups": [] })),
    resource: path, path, httpMethod: method, body: body === undefined ? null : JSON.stringify(body),
    headers: { ...request(signedToken({ "cognito:groups": [] })).headers, "content-type": "application/json" },
  };
}
const parsed = (response: { body: string }) => JSON.parse(response.body);

async function setup() {
  const data = setupData();
  const items = new MemoryItemTable();
  const send = vi.fn().mockResolvedValue(userOutput({}));
  const resolve = createCognitoIdentityResolver({ createVerifier: () => verifierWithTestJwks(), createClient: () => ({ send }) });
  const core = createCoreHandler({ resolveIdentity: resolve, createRepository: () => data.repository, createItems: () => items, now: () => fixedNow });
  const invoke = (path: string, method = "GET", body?: unknown) => core(event(path, method, body), context);
  expect((await invoke("/v1/users/bootstrap", "POST", {})).statusCode).toBe(200);
  const propertyId = parsed(await invoke("/v1/properties", "POST", { label: "Home", address: "123 Test Road Mumbai" })).property.propertyId as string;
  const roof = normalizeManual({ roofAreaSquareMeters: 80, lengthMeters: 10, widthMeters: 8 }, fixedNow.toISOString());
  const { analysisId } = await data.service.saveManualRoof(identity(sub), propertyId, roof);
  return { data, items, invoke, propertyId, analysisId };
}

describe("analysis restore and form drafts", () => {
  it("returns the full confirmed roof model for an owned analysis", async () => {
    const { invoke, propertyId, analysisId } = await setup();
    const response = await invoke(`/v1/properties/${propertyId}/analyses/${analysisId}`);
    expect(response.statusCode).toBe(200);
    expect(parsed(response)).toMatchObject({ analysisId, source: "MANUAL", roof: { source: "MANUAL", roofAreaSquareMeters: 80 } });
    expect((await invoke(`/v1/properties/${propertyId}/analyses/missing-analysis`)).statusCode).toBe(404);
  });

  it("saves, reads back and validates a draft, with an expiry", async () => {
    const { invoke, items, propertyId, analysisId } = await setup();
    const path = `/v1/properties/${propertyId}/analyses/${analysisId}/draft`;
    expect(parsed(await invoke(path)).draft).toBeNull();
    const draft = { schemaVersion: 1, step: 5, design: { basis: "CONSUMPTION", consumption: "320" }, financial: { quote: "180000" } };
    const saved = await invoke(path, "PUT", draft);
    expect(saved.statusCode).toBe(200);
    expect(parsed(saved)).toMatchObject({ draft, updatedAt: fixedNow.toISOString() });
    expect(parsed(await invoke(path)).draft).toEqual(draft);
    const stored = await items.get(draftKey(propertyId, analysisId));
    expect(stored?.expiresAtEpochSeconds).toBeGreaterThan(Math.floor(fixedNow.getTime() / 1_000));

    expect((await invoke(path, "PUT", { ...draft, extra: true })).statusCode).toBe(400);
    expect((await invoke(path, "PUT", { schemaVersion: 1, design: { "bad key": "x" } })).statusCode).toBe(400);
    expect((await invoke(path, "PUT", { schemaVersion: 1, design: { notes: "x".repeat(201) } })).statusCode).toBe(400);
  });

  it("checks ownership through the analysis lookup used by both routes", async () => {
    const { data, propertyId, analysisId } = await setup();
    await data.service.bootstrap(identity(otherId), {});
    await expect(data.service.getAnalysis(identity(otherId), propertyId, analysisId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(data.memory.read(keys.analysis(propertyId, analysisId))).toBeDefined();
  });

  it("keys drafts under the property partition so property deletion purges them", () => {
    expect(draftKey("p1", "a1")).toEqual({ PK: "PROPERTY#p1", SK: "DRAFT#a1" });
  });
});
