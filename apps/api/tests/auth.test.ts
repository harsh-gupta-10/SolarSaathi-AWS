import { GetUserCommand } from "@aws-sdk/client-cognito-identity-provider";
import { FetchError } from "aws-jwt-verify/error";
import { afterEach, describe, expect, it, vi } from "vitest";
import { bearerAccessToken, MAX_ACCESS_TOKEN_LENGTH } from "../src/auth/bearer";
import { cognitoConfiguration } from "../src/auth/config";
import { createCognitoIdentityResolver, GET_USER_TIMEOUT_MS, VERIFICATION_TIMEOUT_MS } from "../src/auth/cognito";
import { configuration, environment, request, signedToken, sub, userOutput, verifierWithTestJwks } from "./auth-fixtures";

const unauthorized = { statusCode: 401, code: "UNAUTHORIZED" };
const unavailable = { statusCode: 503, code: "AUTH_SERVICE_UNAVAILABLE" };
afterEach(() => vi.useRealTimers());

describe("strict bearer header", () => {
  it.each(["authorization", "Authorization", "AUTHORIZATION"])("accepts one case-insensitive header name: %s", name => {
    const event = request();
    event.headers = { [name]: "bEaReR header.payload.signature" };
    expect(bearerAccessToken(event)).toBe("header.payload.signature");
  });

  it("accepts one multivalue-only header and an identical Gateway mirror", () => {
    const event = request();
    event.multiValueHeaders = { authorization: [event.headers.authorization!] };
    expect(bearerAccessToken(event)).toBe(event.headers.authorization!.slice(7));
    event.headers = {};
    expect(bearerAccessToken(event)).toBe(event.multiValueHeaders.authorization![0].slice(7));
  });

  it.each([undefined, "", "Basic header.payload.signature", "Bearer", "Bearer opaque", "Bearer header.payload.signature,header.payload.signature", "Bearer  header.payload.signature", "Bearer\theader.payload.signature", " Bearer header.payload.signature", "Bearer header.payload.signature\n"])("rejects absent or ambiguous values: %s", value => {
    expect(() => bearerAccessToken({ ...request(), headers: { authorization: value } })).toThrow(expect.objectContaining(unauthorized));
  });

  it("rejects duplicate case variants, multiple values, empty arrays and inconsistent maps", () => {
    const token = "Bearer header.payload.signature";
    const events = [
      { headers: { authorization: token, Authorization: token }, multiValueHeaders: {} },
      { headers: {}, multiValueHeaders: { authorization: [token], Authorization: [token] } },
      { headers: { authorization: token }, multiValueHeaders: { Authorization: [token] } },
      { headers: { authorization: token }, multiValueHeaders: { authorization: [token, token] } },
      { headers: { authorization: token }, multiValueHeaders: { authorization: [] } },
      { headers: { authorization: token }, multiValueHeaders: { authorization: ["Bearer other.payload.signature"] } },
      { headers: { authorization: undefined }, multiValueHeaders: { authorization: [token] } },
    ];
    for (const event of events) {
      expect(() => bearerAccessToken({ ...request(), ...event })).toThrow(expect.objectContaining(unauthorized));
    }
  });

  it("rejects oversized tokens", () => {
    expect(() => bearerAccessToken(request(`${"a".repeat(MAX_ACCESS_TOKEN_LENGTH)}.b.c`))).toThrow(expect.objectContaining(unauthorized));
  });
});

describe("validated Cognito configuration", () => {
  it("derives the region from the pool and accepts a matching explicit region", () => {
    expect(cognitoConfiguration(environment)).toEqual(configuration);
    expect(cognitoConfiguration({ ...environment, COGNITO_REGION: "ap-south-1" })).toEqual(configuration);
  });

  it.each([{}, { COGNITO_REGION: "ap-south-1" }, { COGNITO_USER_POOL_ID: environment.COGNITO_USER_POOL_ID }, { COGNITO_CLIENT_ID: environment.COGNITO_CLIENT_ID }, { ...environment, COGNITO_REGION: "us-east-1" }, { ...environment, COGNITO_USER_POOL_ID: "https://untrusted.example/pool" }, { ...environment, COGNITO_CLIENT_ID: "private-invalid-marker!" }, { ...environment, COGNITO_CLIENT_ID: " " }])("fails closed on absent, partial or invalid configuration", input => {
    expect(() => cognitoConfiguration(input)).toThrow(expect.objectContaining({ statusCode: 503, code: "AUTH_NOT_CONFIGURED" }));
    try { cognitoConfiguration(input); } catch (error) { expect(String(error)).not.toContain("private-invalid-marker"); }
  });
});

describe("maintained access-token verification and current session", () => {
  function setup() {
    const verifier = verifierWithTestJwks();
    const createVerifier = vi.fn(() => verifier);
    const send = vi.fn().mockResolvedValue(userOutput());
    const createClient = vi.fn(() => ({ send }));
    return { verifier, createVerifier, send, createClient, resolve: createCognitoIdentityResolver({ createVerifier, createClient }) };
  }

  it("verifies ephemeral signed JWTs and sends only GetUser with an abort signal", async () => {
    const { resolve, send, createClient, createVerifier } = setup();
    const token = signedToken({ "cognito:groups": ["BROKER"], "custom:organizationId": "untrusted-claim-org" });
    expect(await resolve(request(token), environment)).toEqual({ sub, groups: ["BROKER"], attributes: userOutput().UserAttributes });
    expect(createClient).toHaveBeenCalledWith(configuration);
    expect(createVerifier).toHaveBeenCalledWith(configuration);
    const [command, options] = send.mock.calls[0];
    expect(command).toBeInstanceOf(GetUserCommand);
    expect(command.input).toEqual({ AccessToken: token });
    expect(options.abortSignal).toBeInstanceOf(AbortSignal);
    expect(options.abortSignal.aborted).toBe(false);
  });

  it.each([
    { token_use: "id", aud: configuration.clientId },
    { token_use: "refresh" },
    { client_id: "wrongclient" },
    { iss: "https://cognito-idp.ap-south-1.amazonaws.com/ap-south-1_OtherPool" },
    { exp: 1 },
    { exp: undefined },
    { sub: undefined },
    { sub: "not-a-cognito-sub" },
    { "cognito:groups": "BROKER" },
    { "cognito:groups": ["BROKER", 1] },
  ])("rejects invalid signed claims without calling Cognito: %j", async claims => {
    const { resolve, send } = setup();
    await expect(resolve(request(signedToken(claims)), environment)).rejects.toMatchObject(unauthorized);
    expect(send).not.toHaveBeenCalled();
  });

  it("rejects a forged signature without calling Cognito", async () => {
    const { resolve, send } = setup();
    const pieces = signedToken().split(".");
    pieces[2] = `${pieces[2][0] === "a" ? "b" : "a"}${pieces[2].slice(1)}`;
    await expect(resolve(request(pieces.join(".")), environment)).rejects.toMatchObject(unauthorized);
    expect(send).not.toHaveBeenCalled();
  });

  it("rejects malformed JWT encoding", async () => {
    const { resolve, send } = setup();
    await expect(resolve(request("invalid.payload.signature"), environment)).rejects.toMatchObject(unauthorized);
    expect(send).not.toHaveBeenCalled();
  });

  it("reuses verifier/client instances and isolates changed pool/client configuration", async () => {
    const { resolve, createVerifier, createClient } = setup();
    await resolve(request(), environment);
    await resolve(request(), { ...environment, COGNITO_REGION: "ap-south-1" });
    expect(createVerifier).toHaveBeenCalledTimes(1);
    expect(createClient).toHaveBeenCalledTimes(1);
    await resolve(request(), { ...environment, COGNITO_CLIENT_ID: "secondclient" });
    expect(createVerifier).toHaveBeenCalledTimes(2);
    expect(createClient).toHaveBeenCalledTimes(1);
    await resolve(request(), { ...environment, COGNITO_USER_POOL_ID: "ap-south-1_SecondPool" });
    expect(createVerifier).toHaveBeenCalledTimes(3);
    expect(createClient).toHaveBeenCalledTimes(2);
  });

  it.each(["NotAuthorizedException", "UserNotFoundException", "UserNotConfirmedException", "PasswordResetRequiredException", "ForbiddenException"])("rejects revoked, missing or disallowed sessions: %s", async name => {
    const { resolve, send } = setup();
    send.mockRejectedValue(Object.assign(new Error("private-sdk-token-marker"), { name }));
    await expect(resolve(request(), environment)).rejects.toMatchObject(unauthorized);
  });

  it.each(["TooManyRequestsException", "InternalErrorException", "TimeoutError", "AbortError", "CredentialsProviderError", "Error"])("sanitizes downstream failure: %s", async name => {
    const { resolve, send } = setup();
    send.mockRejectedValue(Object.assign(new Error("private-sdk-token-marker"), { name }));
    await expect(resolve(request(), environment)).rejects.toMatchObject(unavailable);
  });

  it("reports JWKS outages as service failures rather than invalid credentials", async () => {
    const { resolve, verifier, send } = setup();
    vi.spyOn(verifier, "verify").mockRejectedValue(new FetchError("https://cognito.example/jwks", "private-jwks-marker"));
    await expect(resolve(request(), environment)).rejects.toMatchObject(unavailable);
    expect(send).not.toHaveBeenCalled();
  });

  it("bounds GetUser wall-clock time and aborts the request", async () => {
    vi.useFakeTimers();
    const { resolve, send } = setup();
    send.mockImplementation(() => new Promise(() => undefined));
    const operation = resolve(request(), environment);
    const rejected = expect(operation).rejects.toMatchObject(unavailable);
    await vi.advanceTimersByTimeAsync(GET_USER_TIMEOUT_MS + 1);
    await rejected;
    expect(send.mock.calls[0][1].abortSignal.aborted).toBe(true);
  });

  it("bounds JWT/JWKS verification time without starting GetUser", async () => {
    vi.useFakeTimers();
    const { resolve, verifier, send } = setup();
    vi.spyOn(verifier, "verify").mockImplementation(() => new Promise(() => undefined));
    const rejected = expect(resolve(request(), environment)).rejects.toMatchObject(unavailable);
    await vi.advanceTimersByTimeAsync(VERIFICATION_TIMEOUT_MS + 1);
    await rejected;
    expect(send).not.toHaveBeenCalled();
  });

  it("does not create clients when headers/configuration are unavailable", async () => {
    const { resolve, createClient, createVerifier } = setup();
    await expect(resolve(request(), {})).rejects.toMatchObject({ code: "AUTH_NOT_CONFIGURED" });
    await expect(resolve({ ...request(), headers: {} }, environment)).rejects.toMatchObject(unauthorized);
    expect(createClient).not.toHaveBeenCalled();
    expect(createVerifier).not.toHaveBeenCalled();
  });
});
