import type { APIGatewayProxyEvent } from "aws-lambda";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCognitoIdentityResolver } from "../src/auth/cognito";
import { createRoofHandler } from "../src/handlers/roof";
import { context, environment, request, sub, userOutput, verifierWithTestJwks } from "./auth-fixtures";
import { fixedNow, identity, setupData } from "./data-fixtures";

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.stubEnv("ENVIRONMENT", "test"); vi.stubEnv("LOG_LEVEL", "info");
  vi.stubEnv("CORE_TABLE_NAME", "test-core-table"); vi.stubEnv("AWS_REGION", "ap-south-1");
  vi.stubEnv("COGNITO_USER_POOL_ID", environment.COGNITO_USER_POOL_ID);
  vi.stubEnv("COGNITO_CLIENT_ID", environment.COGNITO_CLIENT_ID);
  vi.stubEnv("GOOGLE_GEOCODING_API_KEY", ""); vi.stubEnv("GOOGLE_SOLAR_API_KEY", "");
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

function event(path: string, body: unknown): APIGatewayProxyEvent {
  return { ...request(), resource: path.replace(/^\/v1/, ""), path, httpMethod: "POST", body: JSON.stringify(body),
    headers: { ...request().headers, "content-type": "application/json" },
    requestContext: { ...request().requestContext, stage: "v1" } };
}

describe("roof API handler", () => {
  it("handles deployed stage-relative manual route with verified identity, owned property and no Google configuration", async () => {
    const { service, repository, memory } = setupData();
    await service.bootstrap(identity(sub), {});
    const property = await service.createProperty(identity(sub), { label: "Home", address: "123 Example Road, Mumbai" });
    const resolve = createCognitoIdentityResolver({ createVerifier: () => verifierWithTestJwks(),
      createClient: () => ({ send: async () => userOutput() }) });
    const handler = createRoofHandler({ resolveIdentity: resolve, createRepository: () => repository, now: () => fixedNow,
      createId: () => "manual-analysis-id" });
    const response = await handler(event("/v1/solar/confirm-roof", { propertyId: property.propertyId,
      manual: { roofAreaSquareMeters: 60 }, confirmed: true }), context);
    expect(response.statusCode).toBe(201);
    expect(JSON.parse(response.body)).toMatchObject({ schemaVersion: 1, source: "MANUAL", analysisId: "manual-analysis-id",
      roof: { source: "MANUAL", roofAreaSquareMeters: 60, segmentCount: 1 } });
    expect(JSON.stringify(memory.records)).not.toMatch(/GOOGLE_GEOCODING_API_KEY|GOOGLE_SOLAR_API_KEY/);
    const notConfirmed = await handler(event("/v1/solar/confirm-roof", { propertyId: property.propertyId,
      manual: { roofAreaSquareMeters: 60 }, confirmed: false }), context);
    expect(notConfirmed.statusCode).toBe(400);
  });

  it("rejects unsupported routes and methods before provider access", async () => {
    const handler = createRoofHandler({ resolveIdentity: async () => { throw new Error("auth should not run"); } });
    const missing = await handler(event("/v1/solar/unknown", {}), context);
    expect(missing.statusCode).toBe(404);
    const wrongMethod = await handler({ ...event("/v1/solar/geocode", {}), httpMethod: "GET" }, context);
    expect(wrongMethod.statusCode).toBe(405);
    expect(JSON.stringify([missing.body, wrongMethod.body])).not.toContain("auth should not run");
  });
});
