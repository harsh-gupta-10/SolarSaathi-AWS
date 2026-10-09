import type { APIGatewayProxyEvent, Context } from "aws-lambda";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handler as health } from "../src/handlers/health";
import { handler as analyze } from "../src/handlers/analyze";
import { withRequestLogging } from "../src/lib/http";

const context = { awsRequestId: "test-request-id" } as Context;
function request(body: string | null = "{}"): APIGatewayProxyEvent {
  return {
    body,
    headers: { "content-type": "application/json" },
    multiValueHeaders: {},
    httpMethod: "POST",
    isBase64Encoded: false,
    path: "/v1/solar/analyze",
    pathParameters: null,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    resource: "/solar/analyze",
    requestContext: {} as APIGatewayProxyEvent["requestContext"],
  };
}

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.stubEnv("ENVIRONMENT", "test");
  vi.stubEnv("LOG_LEVEL", "info");
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("API foundation", () => {
  it("returns health with configuration and request correlation", async () => {
    const response = await health({ ...request(null), httpMethod: "GET" }, context);
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      status: "ok", service: "solarsaathi-api", environment: "test", version: "0.1.0", requestId: "test-request-id",
    });
    expect(response.headers?.["cache-control"]).toBe("no-store");
    expect(JSON.parse(vi.mocked(console.log).mock.calls[0][0])).toMatchObject({
      level: "info", event: "request_completed", requestId: "test-request-id", statusCode: 200,
    });
  });

  it("keeps the unimplemented solar analysis scaffold explicit", async () => {
    const response = await analyze(request(), context);
    expect(response.statusCode).toBe(501);
    expect(JSON.parse(response.body)).toMatchObject({ error: { code: "NOT_IMPLEMENTED", requestId: "test-request-id" } });
  });

  it.each(["{", "[]", "null", "42", '"text"', ""])("rejects malformed/non-object input: %s", async (body) => {
    const response = await analyze(request(body), context);
    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error.code).toBe("INVALID_REQUEST");
  });

  it("requires JSON and accepts case-insensitive headers with charset", async () => {
    expect((await analyze({ ...request(), headers: {} }, context)).statusCode).toBe(415);
    expect((await analyze({ ...request(), headers: { "Content-Type": "Application/JSON; charset=utf-8" } }, context)).statusCode).toBe(501);
  });

  it("decodes API Gateway base64 JSON", async () => {
    expect((await analyze({ ...request(Buffer.from("{}").toString("base64")), isBase64Encoded: true }, context)).statusCode).toBe(501);
  });

  it("rejects oversized decoded payloads", async () => {
    expect((await analyze(request(JSON.stringify({ data: "x".repeat(65_536) })), context)).statusCode).toBe(413);
  });

  it("never logs bodies, headers or private property information", async () => {
    const event = request(JSON.stringify({ address: "private-address-marker" }));
    event.headers.authorization = "private-token-marker";
    await analyze(event, context);
    expect(JSON.stringify(vi.mocked(console.log).mock.calls)).not.toMatch(/private-address-marker|private-token-marker/);
  });

  it("sanitizes unexpected exceptions", async () => {
    const handler = withRequestLogging(() => { throw new Error("private-secret-marker"); });
    const response = await handler(request(), context);
    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain("private-secret-marker");
    expect(JSON.stringify(vi.mocked(console.log).mock.calls)).not.toContain("private-secret-marker");
  });

  it("fails safely on invalid environment configuration", async () => {
    vi.stubEnv("ENVIRONMENT", "invalid-private-marker");
    const response = await health(request(), context);
    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain("invalid-private-marker");
  });

  it("returns the configured CORS origin on success and errors without reflecting untrusted origins", async () => {
    vi.stubEnv("API_ALLOWED_ORIGIN", "https://app.example.com");
    const event = request("{");
    event.headers.origin = "https://untrusted.example.com";
    expect((await analyze(event, context)).headers?.["access-control-allow-origin"]).toBe("https://app.example.com");
    expect((await health(request(), context)).headers?.["access-control-allow-origin"]).toBe("https://app.example.com");
  });

  it("respects the configured log severity", async () => {
    vi.stubEnv("LOG_LEVEL", "error");
    await health(request(), context);
    expect(console.log).not.toHaveBeenCalled();
    await analyze(request(), context);
    expect(console.log).toHaveBeenCalledTimes(1);
  });
});
