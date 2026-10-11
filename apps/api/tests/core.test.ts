import type { APIGatewayProxyEvent } from "aws-lambda";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCognitoIdentityResolver } from "../src/auth/cognito";
import { createCoreHandler, handler } from "../src/handlers/core";
import { keys } from "../src/data/keys";
import { configuration, context, environment, request, signedToken, sub, userOutput, verifierWithTestJwks } from "./auth-fixtures";
import { fixedNow, setupData } from "./data-fixtures";

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.stubEnv("ENVIRONMENT", "test"); vi.stubEnv("LOG_LEVEL", "info");
  vi.stubEnv("CORE_TABLE_NAME", "test-core-table"); vi.stubEnv("AWS_REGION", "ap-south-1");
  vi.stubEnv("COGNITO_USER_POOL_ID", environment.COGNITO_USER_POOL_ID);
  vi.stubEnv("COGNITO_CLIENT_ID", environment.COGNITO_CLIENT_ID); vi.stubEnv("COGNITO_REGION", "");
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

function event(path: string, method = "GET", body?: unknown, broker = false): APIGatewayProxyEvent {
  return {
    ...request(signedToken({ "cognito:groups": broker ? ["BROKER"] : [] })),
    resource: path, path, httpMethod: method, body: body === undefined ? null : JSON.stringify(body),
    headers: { ...request().headers, "content-type": "application/json" },
  };
}
function setup(attributes: Record<string, string | undefined> = {}) {
  const data = setupData();
  const send = vi.fn().mockResolvedValue(userOutput(attributes));
  const resolve = createCognitoIdentityResolver({ createVerifier: () => verifierWithTestJwks(), createClient: () => ({ send }) });
  const core = createCoreHandler({ resolveIdentity: resolve, createRepository: () => data.repository, now: () => fixedNow, createId: (() => { let n = 0; return () => `handler-id-${++n}`; })() });
  const invoke = (path: string, method = "GET", body?: unknown, broker = false) => {
    const input = event(path, method, body, broker);
    input.headers.authorization = request(signedToken({ "cognito:groups": broker ? ["BROKER"] : [] })).headers.authorization;
    return core(input, context);
  };
  return { ...data, send, core, invoke };
}
const parsed = (response: { body: string }) => JSON.parse(response.body);

describe("core HTTP source routes", () => {
  it("has no persisted fake account until atomic bootstrap, then projects versioned DynamoDB DTOs", async () => {
    const { invoke, memory } = setup();
    expect((await invoke("/v1/users/me")).statusCode).toBe(404);
    expect(memory.records.size).toBe(0);
    const bootstrap = await invoke("/v1/users/bootstrap", "POST", {});
    expect(bootstrap.statusCode).toBe(200);
    expect(parsed(bootstrap)).toMatchObject({ schemaVersion: 1, source: "DYNAMODB", requestId: context.awsRequestId, user: { userId: sub, role: "HOMEOWNER" }, organization: { kind: "PERSONAL" }, customer: { kind: "SELF" } });
    expect(parsed(await invoke("/v1/users/me")).user).toEqual(parsed(bootstrap).user);
    expect(parsed(await invoke("/v1/organizations/me")).organization).toEqual(parsed(bootstrap).organization);
    const created = await invoke("/v1/properties", "POST", { label: "Home", address: "123 Test Road Mumbai" });
    expect(created.statusCode).toBe(201);
    const property = parsed(created).property;
    expect(parsed(await invoke("/v1/properties")).properties).toEqual([property]);
    expect(bootstrap.body + created.body).not.toMatch(/"PK"|"SK"|ownerUserId|memberUserIds|GSI|revision|entityType/);
  });

  it("supports customer/lead tenant endpoints only for a verified broker with canonical membership", async () => {
    const { invoke, memory } = setup();
    await invoke("/v1/users/bootstrap", "POST", { organizationName: "Solar business" }, true);
    expect((await invoke("/v1/customers", "POST", { name: "Client", email: "client@example.com" }, true)).statusCode).toBe(201);
    expect((await invoke("/v1/leads", "POST", { name: "Lead", phone: "+919876543210" }, true)).statusCode).toBe(201);
    expect(parsed(await invoke("/v1/leads", "GET", undefined, true)).leads).toHaveLength(1);
    expect(parsed(await invoke("/v1/customers", "GET", undefined, true)).customers).toHaveLength(1);
    expect((await invoke("/v1/leads")).statusCode).toBe(403);
    const orgId = memory.read(keys.user(sub))?.orgId as string;
    memory.seed({ ...memory.read(keys.organization(orgId))!, PK: `ORG#${orgId}`, SK: "PROFILE", ownerUserId: "another-actor", memberUserIds: ["another-actor"], revision: 2 });
    expect((await invoke("/v1/customers", "GET", undefined, true)).statusCode).toBe(403);
  });

  it("routes property IDs using resource params or the safely stripped stage path fallback", async () => {
    const { core, invoke } = setup();
    await invoke("/v1/users/bootstrap", "POST", {});
    const property = parsed(await invoke("/v1/properties", "POST", { label: "Home", address: "123 Test Road Mumbai" })).property;
    const resourceEvent = { ...event(`/prod/v1/properties/${property.propertyId}`), resource: "/v1/properties/{propertyId}", pathParameters: { propertyId: property.propertyId } };
    expect(parsed(await core(resourceEvent, context)).property).toEqual(property);
    const fallback = { ...event(`/test/v1/properties/${property.propertyId}`), resource: "/{proxy+}", requestContext: { ...event("/").requestContext, stage: "test" } };
    expect(parsed(await core(fallback, context)).property).toEqual(property);
    expect((await core({ ...resourceEvent, pathParameters: null }, context)).statusCode).toBe(400);
    expect((await core({ ...resourceEvent, pathParameters: { propertyId: "../cross-org" } }, context)).statusCode).toBe(400);
    expect((await invoke("/v1/properties/unknown-property")).statusCode).toBe(404);
  });

  it("accepts SAM stage-relative resources with the deployed v1 stage", async () => {
    const { core } = setup();
    const bootstrap = { ...event("/v1/users/bootstrap", "POST", {}), resource: "/users/bootstrap",
      requestContext: { ...event("/").requestContext, stage: "v1" } };
    expect((await core(bootstrap, context)).statusCode).toBe(200);
    const create = { ...event("/v1/properties", "POST", { label: "Home", address: "123 Test Road Mumbai" }),
      resource: "/properties", requestContext: bootstrap.requestContext };
    const response = await core(create, context);
    expect(response.statusCode).toBe(201);
    const propertyId = parsed(response).property.propertyId;
    const get = { ...event(`/v1/properties/${propertyId}`), resource: "/properties/{propertyId}",
      pathParameters: { propertyId }, requestContext: bootstrap.requestContext };
    expect((await core(get, context)).statusCode).toBe(200);
    const list = { ...event("/v1/properties"), resource: "/properties", requestContext: bootstrap.requestContext };
    expect(parsed(await core(list, context)).properties).toHaveLength(1);
  });

  it("deletes an owned property through DELETE /v1/properties/{propertyId}", async () => {
    const { invoke } = setup();
    await invoke("/v1/users/bootstrap", "POST", {});
    const property = parsed(await invoke("/v1/properties", "POST", { label: "Home", address: "123 Test Road Mumbai" })).property;
    const deleted = await invoke(`/v1/properties/${property.propertyId}`, "DELETE");
    expect(deleted.statusCode).toBe(200);
    expect(parsed(deleted)).toMatchObject({ schemaVersion: 1, source: "DYNAMODB", deleted: { propertyId: property.propertyId } });
    expect(parsed(await invoke("/v1/properties")).properties).toEqual([]);
    expect((await invoke(`/v1/properties/${property.propertyId}`, "DELETE")).statusCode).toBe(404);
    expect((await invoke("/v1/properties", "DELETE")).statusCode).toBe(405);
  });

  it("does not add arbitrary analysis/cache endpoints or generic updates", async () => {
    const { invoke } = setup();
    expect((await invoke("/v1/analyses", "POST", { subsidy: 999 })).statusCode).toBe(404);
    expect((await invoke("/v1/solar-cache", "POST", {})).statusCode).toBe(404);
    expect((await invoke("/v1/properties", "PUT", {})).statusCode).toBe(405);
  });

  it.each(["/v1/customers", "/v1/leads"])("role-gates %s for homeowner GET and POST", async path => {
    const { invoke } = setup(); await invoke("/v1/users/bootstrap", "POST", {});
    for (const method of ["GET", "POST"]) expect((await invoke(path, method, method === "POST" ? { name: "Client" } : undefined)).statusCode).toBe(403);
  });
});

describe("core trusted identity, configuration and safe failures", () => {
  it("returns DATABASE_NOT_CONFIGURED instead of an empty list without reaching auth/store", async () => {
    const { invoke, send, memory } = setup(); vi.stubEnv("CORE_TABLE_NAME", "");
    const response = await invoke("/v1/properties");
    expect(response.statusCode).toBe(503); expect(parsed(response).error.code).toBe("DATABASE_NOT_CONFIGURED");
    expect(send).not.toHaveBeenCalled(); expect(memory.commands).toHaveLength(0);
  });

  it("reuses auth missing/invalid/outage errors, with no database access", async () => {
    vi.stubEnv("COGNITO_USER_POOL_ID", ""); vi.stubEnv("COGNITO_CLIENT_ID", "");
    const response = await handler(event("/v1/users/me"), context);
    expect(response.statusCode).toBe(503); expect(parsed(response).error.code).toBe("AUTH_NOT_CONFIGURED");
    vi.stubEnv("COGNITO_USER_POOL_ID", environment.COGNITO_USER_POOL_ID); vi.stubEnv("COGNITO_CLIENT_ID", environment.COGNITO_CLIENT_ID);
    const { core, memory, send } = setup();
    const absent = { ...event("/v1/users/me"), headers: {} };
    expect((await core(absent, context)).statusCode).toBe(401); expect(memory.commands).toHaveLength(0);
    send.mockRejectedValueOnce(new Error("private auth provider outage"));
    const outage = await core(event("/v1/users/me"), context);
    expect(outage.statusCode).toBe(503); expect(parsed(outage).error.code).toBe("AUTH_SERVICE_UNAVAILABLE");
    expect(outage.body).not.toContain("private"); expect(memory.commands).toHaveLength(0);
  });

  it("ignores request role/org/header/authorizer overrides and binds the configured Cognito client", async () => {
    const { core, invoke } = setup();
    await invoke("/v1/users/bootstrap", "POST", {});
    const input = event("/v1/customers");
    input.headers["x-user-role"] = "BROKER"; input.headers["x-organization-id"] = "other-org";
    input.requestContext.authorizer = { claims: { sub: "forged-actor", "cognito:groups": ["BROKER"], "custom:organizationId": "other-org" } };
    expect((await core(input, context)).statusCode).toBe(403);
    input.headers.authorization = request(signedToken({ client_id: "other-client" })).headers.authorization;
    expect((await core(input, context)).statusCode).toBe(401);
    const wrongUse = event("/v1/users/me");
    wrongUse.headers.authorization = request(signedToken({ token_use: "id", aud: configuration.clientId })).headers.authorization;
    expect((await core(wrongUse, context)).statusCode).toBe(401);
  });

  it("does not grant membership from verified Cognito organization context alone", async () => {
    const { invoke, memory } = setup({ "custom:organizationId": "not-a-stored-membership" });
    const response = await invoke("/v1/users/bootstrap", "POST", {}, true);
    expect(response.statusCode).toBe(403); expect(memory.records.size).toBe(0);
  });

  it("requires verified email before creating database records", async () => {
    const { invoke, memory } = setup({ email_verified: "false" });
    expect((await invoke("/v1/users/bootstrap", "POST", {})).statusCode).toBe(403); expect(memory.records.size).toBe(0);
  });

  it("sanitizes database outage/schema poisoning and logs no body/token/SDK details", async () => {
    const { invoke, memory } = setup();
    memory.failNext = new Error("PRIVATE_SDK_MARKER");
    const outage = await invoke("/v1/users/me");
    expect(outage.statusCode).toBe(503); expect(parsed(outage).error.code).toBe("DATABASE_UNAVAILABLE");
    await invoke("/v1/users/bootstrap", "POST", {});
    memory.seed({ ...memory.read(keys.user(sub))!, ...keys.user(sub), role: "ADMIN", extraSecrets: "PRIVATE_SDK_MARKER" });
    const poisoned = await invoke("/v1/users/me"); expect(poisoned.statusCode).toBe(503);
    const output = outage.body + poisoned.body + JSON.stringify(vi.mocked(console.log).mock.calls);
    expect(output).not.toMatch(/PRIVATE_SDK_MARKER|Bearer|eyJ|123 Test Road/);
  });

  it("keeps fixed CORS and no-store headers through core responses/errors", async () => {
    const { invoke } = setup(); vi.stubEnv("API_ALLOWED_ORIGIN", "https://app.solarsaathi.in");
    const response = await invoke("/v1/users/me");
    expect(response.headers).toMatchObject({ "cache-control": "no-store", "access-control-allow-origin": "https://app.solarsaathi.in", "x-content-type-options": "nosniff" });
  });
});

describe("core input/pagination HTTP validation", () => {
  it.each([
    ["/v1/users/bootstrap", { userId: "forged" }], ["/v1/users/bootstrap", { orgId: "forged" }],
    ["/v1/customers", { name: "Client", ownerUserId: "forged" }], ["/v1/customers", { name: "Client", customerId: "forged" }],
    ["/v1/leads", { name: "Lead", status: "LOST" }], ["/v1/properties", { label: "Home", address: "123 Test Road", grossCost: 1 }],
  ])("rejects authority and future-phase fields on %s", async (path, body) => {
    const { invoke } = setup(); await invoke("/v1/users/bootstrap", "POST", {}, true);
    expect((await invoke(path, "POST", body, true)).statusCode).toBe(400);
  });

  it("uses shared body parsing for malformed JSON, media types, base64 and size", async () => {
    const { core } = setup(); const input = event("/v1/users/bootstrap", "POST", {});
    expect((await core({ ...input, body: "[1]" }, context)).statusCode).toBe(400);
    expect((await core({ ...input, headers: { ...input.headers, "content-type": "text/plain" } }, context)).statusCode).toBe(415);
    expect((await core({ ...input, body: JSON.stringify({ oversized: "x".repeat(65_536) }) }, context)).statusCode).toBe(413);
    const encoded = { ...input, body: Buffer.from("{}").toString("base64"), isBase64Encoded: true };
    expect((await core(encoded, context)).statusCode).toBe(200);
  });

  it("strictly validates list query limits, duplicate keys, cursors and org overrides", async () => {
    const { core, invoke } = setup(); await invoke("/v1/users/bootstrap", "POST", {});
    for (const query of [{ limit: "0" }, { limit: "51" }, { limit: "1.5" }, { limit: "-1" }, { cursor: "bad-cursor" }, { orgId: "forged-org" }]) {
      const response = await core({ ...event("/v1/properties"), queryStringParameters: query }, context);
      expect(response.statusCode).toBe(400);
    }
    const duplicated = { ...event("/v1/properties"), queryStringParameters: { limit: "1" }, multiValueQueryStringParameters: { limit: ["1", "2"] } };
    expect((await core(duplicated, context)).statusCode).toBe(400);
  });
});
