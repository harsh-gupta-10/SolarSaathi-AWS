import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCognitoIdentityResolver } from "../src/auth/cognito";
import { currentIdentityResponse } from "../src/auth/profile";
import { createProfileHandler, handler } from "../src/handlers/profile";
import { configuration, context, environment, request, signedToken, sub, userOutput, verifierWithTestJwks } from "./auth-fixtures";

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.stubEnv("ENVIRONMENT", "test");
  vi.stubEnv("LOG_LEVEL", "info");
  vi.stubEnv("COGNITO_USER_POOL_ID", environment.COGNITO_USER_POOL_ID);
  vi.stubEnv("COGNITO_CLIENT_ID", environment.COGNITO_CLIENT_ID);
  vi.stubEnv("COGNITO_REGION", "");
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

function setup(attributes: Record<string, string | undefined> = {}) {
  const verifier = verifierWithTestJwks();
  const send = vi.fn().mockResolvedValue(userOutput(attributes));
  const resolve = createCognitoIdentityResolver({ createVerifier: () => verifier, createClient: () => ({ send }) });
  return { profile: createProfileHandler(resolve), send };
}

describe("GET /v1/me trusted identity", () => {
  it("returns only the typed current identity, with no session or SDK internals", async () => {
    const { profile } = setup({ "custom:organizationId": "org-server-123", phone_number: "private-phone-marker" });
    const response = await profile(request(signedToken({ "cognito:groups": ["BROKER"] })), context);
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      profile: { userId: sub, cognitoSub: sub, email: "user@example.com", name: "Solar User", role: "BROKER", organizationId: "org-server-123" },
      emailVerified: true, source: "COGNITO", requestId: context.awsRequestId,
    });
    expect(response.headers?.["cache-control"]).toBe("no-store");
    expect(response.body).not.toMatch(/AccessToken|refresh|issuer|client_id|private-phone-marker|never-expose/);
  });

  it.each([undefined, [], ["HOMEOWNER"], ["ADMIN"], ["ADMIN_POLICY"], ["broker"]])("maps only exact verified BROKER groups, not admin/custom roles: %j", async groups => {
    const { profile } = setup({ "custom:role": "BROKER" });
    const response = await profile(request(signedToken({ "cognito:groups": groups, "custom:role": "BROKER", role: "BROKER" })), context);
    expect(JSON.parse(response.body).profile.role).toBe("HOMEOWNER");
  });

  it("allows a verified broker without claiming organization membership", async () => {
    const { profile } = setup();
    const response = await profile(request(signedToken({ "cognito:groups": ["HOMEOWNER", "BROKER"] })), context);
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).profile).toMatchObject({ role: "BROKER" });
    expect(JSON.parse(response.body).profile).not.toHaveProperty("organizationId");
    expect(response.body).not.toMatch(/membershipVerified|ownershipVerified/);
  });

  it.each(["", "  "])("omits empty organization attributes for a verified broker", async organizationId => {
    const { profile } = setup({ "custom:organizationId": organizationId });
    const response = await profile(request(signedToken({ "cognito:groups": ["BROKER"] })), context);
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).profile).not.toHaveProperty("organizationId");
  });

  it("ignores authorizer claims, custom JWT organization, body/query/header roles and browser previews", async () => {
    const { profile } = setup({ "custom:organizationId": "server-org" });
    const event = request(signedToken({ "custom:organizationId": "forged-jwt-org", role: "BROKER", "custom:role": "BROKER" }));
    event.headers["x-user-role"] = "BROKER";
    event.headers["x-organization-id"] = "forged-header-org";
    event.headers["x-preview-role"] = "BROKER";
    event.queryStringParameters = { role: "BROKER", organizationId: "forged-query-org" };
    event.body = JSON.stringify({ role: "BROKER", organizationId: "forged-body-org" });
    event.requestContext.authorizer = { claims: { sub: "forged-authorizer-sub", "cognito:groups": ["BROKER"], "custom:organizationId": "forged-authorizer-org" } };
    const response = await profile(event, context);
    expect(JSON.parse(response.body).profile).toMatchObject({ cognitoSub: sub, role: "HOMEOWNER", organizationId: "server-org" });
    expect(response.body).not.toContain("forged");
  });

  it("never substitutes authorizer claims for a bearer token", async () => {
    const { profile, send } = setup();
    const event = request();
    event.headers = {};
    event.requestContext.authorizer = { claims: { sub, client_id: configuration.clientId, token_use: "access" } };
    const response = await profile(event, context);
    expect(response.statusCode).toBe(401);
    expect(JSON.parse(response.body).error.code).toBe("UNAUTHORIZED");
    expect(send).not.toHaveBeenCalled();
  });

  it.each([
    { sub: "11111111-1111-4111-8111-111111111111" },
    { sub: "" },
    { email: "" },
    { email: "invalid-email" },
    { email: "<user@example.com>" },
    { email: "user..name@example.com" },
    { email: "user@exam\nple.com" },
    { email_verified: "not-a-boolean" },
    { "custom:organizationId": "../other-organization" },
  ])("rejects mismatched identity or invalid required attributes: %j", async attributes => {
    const { profile } = setup(attributes);
    const response = await profile(request(), context);
    expect(response.statusCode).toBe(401);
    expect(JSON.parse(response.body).error.code).toBe("UNAUTHORIZED");
  });

  it("rejects absent/malformed/duplicate required attributes", async () => {
    const { profile, send } = setup();
    const outputs = [
      { ...userOutput(), UserAttributes: undefined },
      { ...userOutput(), UserAttributes: userOutput().UserAttributes!.filter(attribute => attribute.Name !== "email") },
      { ...userOutput(), UserAttributes: [...userOutput().UserAttributes!, { Name: "sub", Value: sub }] },
      { ...userOutput(), UserAttributes: [{ Name: "sub", Value: sub }, { Name: "email" }] },
    ];
    for (const output of outputs) {
      send.mockResolvedValue(output);
      expect((await profile(request(), context)).statusCode).toBe(401);
    }
  });

  it.each([
    [{ name: "  Solar User  " }, "Solar User"],
    [{ name: "", given_name: " Asha ", family_name: " Rao " }, "Asha Rao"],
    [{ name: "", preferred_username: "solar-person" }, "solar-person"],
    [{ name: "" }, "user"],
    [{ name: "unsafe\nname" }, "user"],
  ])("normalizes/defaults names without making them authorization inputs", (attributes, expected) => {
    const identity = currentIdentityResponse({ sub, groups: [], attributes: userOutput(attributes).UserAttributes }, context.awsRequestId);
    expect(identity.profile.name).toBe(expected);
  });

  it("defaults absent verification to false and does not infer email ownership", () => {
    const attributes = userOutput().UserAttributes!.filter(attribute => attribute.Name !== "email_verified");
    expect(currentIdentityResponse({ sub, groups: [], attributes }, context.awsRequestId).emailVerified).toBe(false);
    expect(currentIdentityResponse({ sub, groups: [], attributes: userOutput({ email_verified: "false" }).UserAttributes }, context.awsRequestId).emailVerified).toBe(false);
  });

  it("returns actionable AUTH_NOT_CONFIGURED without creating a fake profile", async () => {
    vi.stubEnv("COGNITO_USER_POOL_ID", "");
    vi.stubEnv("COGNITO_CLIENT_ID", "");
    const response = await handler(request(), context);
    expect(response.statusCode).toBe(503);
    expect(JSON.parse(response.body)).toEqual({ error: { code: "AUTH_NOT_CONFIGURED", message: expect.stringContaining("COGNITO_USER_POOL_ID"), requestId: context.awsRequestId } });
    expect(JSON.parse(response.body)).not.toHaveProperty("profile");
  });

  it("returns 503 for partial configuration before reading any token", async () => {
    vi.stubEnv("COGNITO_CLIENT_ID", "");
    const response = await handler({ ...request(), headers: {} }, context);
    expect(response.statusCode).toBe(503);
    expect(JSON.parse(response.body).error.code).toBe("AUTH_NOT_CONFIGURED");
  });

  it("keeps identity errors/status/CORS sanitized and never logs tokens or user data", async () => {
    const { profile, send } = setup();
    const token = signedToken();
    vi.stubEnv("API_ALLOWED_ORIGIN", "https://app.example.com");
    for (const [name, status, code] of [["NotAuthorizedException", 401, "UNAUTHORIZED"], ["TooManyRequestsException", 503, "AUTH_SERVICE_UNAVAILABLE"]] as const) {
      send.mockRejectedValue(Object.assign(new Error(`private-sdk-marker ${token}`), { name }));
      const response = await profile(request(token), context);
      expect(response.statusCode).toBe(status);
      expect(JSON.parse(response.body).error).toMatchObject({ code, requestId: context.awsRequestId });
      expect(response.headers?.["access-control-allow-origin"]).toBe("https://app.example.com");
      expect(response.body).not.toContain(token);
      expect(response.body).not.toContain("private-sdk-marker");
    }
    expect(JSON.stringify(vi.mocked(console.log).mock.calls)).not.toMatch(/private-sdk-marker|user@example.com|AccessToken/);
    expect(JSON.stringify(vi.mocked(console.log).mock.calls)).not.toContain(token);
  });

  it("does not leak tokens in successful responses or request logs", async () => {
    const { profile } = setup();
    const token = signedToken();
    const response = await profile(request(token), context);
    expect(response.body).not.toContain(token);
    expect(JSON.stringify(vi.mocked(console.log).mock.calls)).not.toContain(token);
    expect(JSON.stringify(vi.mocked(console.log).mock.calls)).not.toContain("user@example.com");
  });

  it("permits only GET and does not fetch identity for another method", async () => {
    const { profile, send } = setup();
    expect((await profile({ ...request(), httpMethod: "POST" }, context)).statusCode).toBe(405);
    expect(send).not.toHaveBeenCalled();
  });
});
