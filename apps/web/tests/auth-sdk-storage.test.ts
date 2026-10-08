// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Amplify } from "aws-amplify";
import { cognitoUserPoolsTokenProvider } from "aws-amplify/auth/cognito";
import { CookieStorage } from "aws-amplify/utils";
import { configureCognitoClient } from "../src/auth/auth-client";

const configuration = {
  status: "ready" as const,
  userPoolId: "ap-south-1_example",
  userPoolClientId: "publicclient",
  domain: "example.auth.ap-south-1.amazoncognito.com",
  redirectSignIn: "http://localhost:3000/auth/callback",
  redirectSignOut: "http://localhost:3000/auth/sign-in",
  googleEnabled: false,
};

beforeEach(() => { localStorage.clear(); });
afterEach(async () => {
  await cognitoUserPoolsTokenProvider.authTokenStore.clearTokens();
  cognitoUserPoolsTokenProvider.teardownNotify();
  vi.restoreAllMocks();
});

describe("real Amplify 6.22.1 token persistence", () => {
  it("does not reset explicit cookie token storage to the SDK localStorage default on configure", async () => {
    const persist = vi.spyOn(Storage.prototype, "setItem");
    configureCognitoClient(configuration, "http:");
    const tokenStore = cognitoUserPoolsTokenProvider.authTokenStore;
    expect(tokenStore.keyValueStorage).toBeInstanceOf(CookieStorage);
    expect(Amplify.getConfig().Auth?.Cognito?.userPoolId).toBe(configuration.userPoolId);
    expect(Amplify.getConfig().Auth?.Cognito?.identityPoolId).toBeUndefined();
    await tokenStore.storeTokens({
      username: "fixture-user",
      clockDrift: 0,
      accessToken: { payload: { sub: "fixture-sub", token_use: "access" }, toString: () => "TEST_ACCESS_TOKEN" },
      idToken: { payload: { sub: "fixture-sub", token_use: "id" }, toString: () => "TEST_ID_TOKEN" },
      refreshToken: "TEST_REFRESH_TOKEN",
    });
    expect(document.cookie).toContain("TEST_ACCESS_TOKEN");
    expect(document.cookie).toContain("TEST_REFRESH_TOKEN");
    expect(localStorage.length).toBe(0);
    expect(persist).not.toHaveBeenCalled();
    configureCognitoClient(configuration, "http:");
    expect(tokenStore.keyValueStorage).toBeInstanceOf(CookieStorage);
    expect(await tokenStore.getKeyValueStorage().getItem("CognitoIdentityServiceProvider.publicclient.fixture-user.refreshToken")).toBe("TEST_REFRESH_TOKEN");
  });
});
