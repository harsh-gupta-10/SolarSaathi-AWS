import { CognitoIdentityProviderClient } from "@aws-sdk/client-cognito-identity-provider";
import { describe, expect, it, vi } from "vitest";
import { createCognitoUserClient } from "../src/auth/cognito";

vi.mock("@aws-sdk/client-cognito-identity-provider", async importOriginal => {
  const actual = await importOriginal<typeof import("@aws-sdk/client-cognito-identity-provider")>();
  return {
    ...actual,
    CognitoIdentityProviderClient: vi.fn(function () { return { send: vi.fn() }; }),
  };
});

describe("unprivileged Cognito client configuration", () => {
  it("uses the validated region, bounded retries/timeouts and no hardcoded credentials or SDK logger", () => {
    createCognitoUserClient({ userPoolId: "ap-south-1_TestPool123", clientId: "testclient123", region: "ap-south-1" });
    expect(CognitoIdentityProviderClient).toHaveBeenCalledExactlyOnceWith({
      region: "ap-south-1",
      maxAttempts: 2,
      requestHandler: { connectionTimeout: 1_000, requestTimeout: 2_000 },
    });
  });
});
