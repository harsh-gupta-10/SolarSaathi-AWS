import { describe, expect, it } from "vitest";
import { EnvironmentValidationError, parseServerEnv } from "@solarsaathi/config/server";
import { parsePublicEnv } from "@solarsaathi/config/public";

describe("backend Cognito configuration", () => {
  it("accepts explicitly bound pool/client settings independent of the Lambda region", () => {
    expect(parseServerEnv({ AWS_REGION: "ap-south-1", COGNITO_USER_POOL_ID: "us-east-1_Example123", COGNITO_CLIENT_ID: "exampleclient123", COGNITO_REGION: "us-east-1" })).toMatchObject({ COGNITO_CLIENT_ID: "exampleclient123", COGNITO_REGION: "us-east-1" });
  });
  it("keeps partial settings optional so public health can start without auth", () => {
    expect(parseServerEnv({ COGNITO_USER_POOL_ID: "ap-south-1_Example123" }).COGNITO_CLIENT_ID).toBeUndefined();
  });
  it.each([
    { COGNITO_USER_POOL_ID: "invalid" },
    { COGNITO_CLIENT_ID: "client with spaces" },
    { COGNITO_REGION: "invalid-region" },
    { COGNITO_USER_POOL_ID: "ap-south-1_Example123", COGNITO_REGION: "us-east-1" },
  ])("redacts invalid configured identity settings", config => expect(() => parseServerEnv(config)).toThrow(EnvironmentValidationError));
  it("never exposes server-only binding configuration through the public entry", () => {
    const env = parsePublicEnv({ COGNITO_USER_POOL_ID: "ap-south-1_Example123", COGNITO_CLIENT_ID: "server-bound-client" });
    expect(env).not.toHaveProperty("COGNITO_USER_POOL_ID");
    expect(env).not.toHaveProperty("COGNITO_CLIENT_ID");
  });
});
