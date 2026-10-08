import { describe, expect, it, vi } from "vitest";
import { checkCognitoReadiness, formatReadiness, runAwsReadOnly, type AwsReader } from "./auth-readiness";

const config = {
  NEXT_PUBLIC_COGNITO_USER_POOL_ID: "ap-south-1_Example123",
  NEXT_PUBLIC_COGNITO_CLIENT_ID: "exampleclient123",
  NEXT_PUBLIC_COGNITO_DOMAIN: "example.auth.ap-south-1.amazoncognito.com",
  NEXT_PUBLIC_COGNITO_REDIRECT_SIGN_IN: "http://localhost:3137/auth/callback",
  NEXT_PUBLIC_COGNITO_REDIRECT_SIGN_OUT: "http://localhost:3137/auth/sign-in",
  NEXT_PUBLIC_COGNITO_GOOGLE_ENABLED: "false",
};
function metadata() {
  return {
    "get-caller-identity": true,
    "describe-user-pool": { Id: config.NEXT_PUBLIC_COGNITO_USER_POOL_ID, AutoVerifiedAttributes: ["email"], SchemaAttributes: [{ Name: "custom:organizationId", AttributeDataType: "String" }] },
    "describe-user-pool-client": {
      UserPoolId: config.NEXT_PUBLIC_COGNITO_USER_POOL_ID, ClientId: config.NEXT_PUBLIC_COGNITO_CLIENT_ID, HasSecret: false,
      AllowedOAuthFlowsUserPoolClient: true, AllowedOAuthFlows: ["code"], AllowedOAuthScopes: ["openid", "email", "profile", "aws.cognito.signin.user.admin"],
      CallbackURLs: [config.NEXT_PUBLIC_COGNITO_REDIRECT_SIGN_IN], LogoutURLs: [config.NEXT_PUBLIC_COGNITO_REDIRECT_SIGN_OUT], SupportedIdentityProviders: ["COGNITO"],
      ReadAttributes: ["email", "name", "custom:organizationId"], WriteAttributes: ["email", "name"],
      AccessTokenValidity: 15, IdTokenValidity: 15, RefreshTokenValidity: 1, TokenValidityUnits: { AccessToken: "minutes", IdToken: "minutes", RefreshToken: "days" },
      EnableTokenRevocation: true, RefreshTokenRotation: { Feature: "ENABLED" }, ExplicitAuthFlows: ["ALLOW_USER_SRP_AUTH"],
    },
    "describe-user-pool-domain": { UserPoolId: config.NEXT_PUBLIC_COGNITO_USER_POOL_ID, Status: "ACTIVE", ManagedLoginVersion: 2 },
    "describe-managed-login-branding-by-client": true,
    "list-groups": ["HOMEOWNER", "BROKER"],
    "list-identity-providers": ["Google"],
  } as Record<string, unknown>;
}
function readerFor(data: Record<string, unknown>) {
  return vi.fn<AwsReader>(async args => data[args[1]]);
}

describe("read-only Cognito readiness", () => {
  it("does not contact AWS when public configuration is missing", async () => {
    const reader = readerFor(metadata());
    const result = await checkCognitoReadiness({}, reader);
    expect(result.status).toBe("blocked");
    expect(formatReadiness(result)).toContain("No AWS calls were made");
    expect(reader).not.toHaveBeenCalled();
  });
  it("redacts invalid input and arbitrary reader errors", async () => {
    const secret = "private-secret-marker";
    const inputResult = await checkCognitoReadiness({ ...config, NEXT_PUBLIC_COGNITO_DOMAIN: secret });
    expect(formatReadiness(inputResult)).not.toContain(secret);
    const result = await checkCognitoReadiness(config, async () => { throw new Error(secret); });
    expect(result.status).toBe("blocked");
    expect(JSON.stringify(result)).not.toContain(secret);
  });
  it("reports configuration readiness without claiming live authentication", async () => {
    const reader = readerFor(metadata());
    const result = await checkCognitoReadiness(config, reader);
    expect(result.status).toBe("ready");
    expect(result.liveAuthenticationVerified).toBe(false);
    expect(formatReadiness(result)).toContain("interactive sign-up");
    for (const [args] of reader.mock.calls) {
      expect(args[1]).toMatch(/^(get|describe|list)-/);
      expect(args).toContain("--query");
      expect(args).toContain("--no-cli-pager");
      expect(args[args.indexOf("--region") + 1]).toBe("ap-south-1");
    }
    const domainArgs = reader.mock.calls.find(([args]) => args[1] === "describe-user-pool-domain")![0];
    expect(domainArgs[domainArgs.indexOf("--domain") + 1]).toBe("example");
  });
  it("uses a custom login domain verbatim and only checks Google when enabled", async () => {
    const data = metadata();
    const client = data["describe-user-pool-client"] as Record<string, unknown>;
    client.SupportedIdentityProviders = ["COGNITO", "Google"];
    const reader = readerFor(data);
    expect((await checkCognitoReadiness({ ...config, NEXT_PUBLIC_COGNITO_DOMAIN: "auth.example.com", NEXT_PUBLIC_COGNITO_GOOGLE_ENABLED: "true" }, reader)).status).toBe("ready");
    expect(reader.mock.calls.some(([args]) => args[1] === "list-identity-providers")).toBe(true);
    const args = reader.mock.calls.find(([args]) => args[1] === "describe-user-pool-domain")![0];
    expect(args[args.indexOf("--domain") + 1]).toBe("auth.example.com");
  });
  it.each([
    ["HasSecret", true], ["AllowedOAuthFlows", ["implicit"]], ["AllowedOAuthFlowsUserPoolClient", false],
    ["AllowedOAuthScopes", ["openid"]], ["CallbackURLs", []], ["LogoutURLs", []],
    ["WriteAttributes", ["email", "custom:organizationId"]], ["WriteAttributes", undefined],
    ["ReadAttributes", ["email"]], ["EnableTokenRevocation", false],
    ["RefreshTokenRotation", { Feature: "DISABLED" }], ["ExplicitAuthFlows", ["ALLOW_REFRESH_TOKEN_AUTH"]],
    ["AccessTokenValidity", 60], ["IdTokenValidity", 60], ["RefreshTokenValidity", 30],
    ["TokenValidityUnits", {}], ["ClientId", "other-client"], ["UserPoolId", "other-pool"],
    ["SupportedIdentityProviders", []],
  ])("blocks unsafe or incomplete client metadata: %s", async (field, value) => {
    const data = metadata();
    (data["describe-user-pool-client"] as Record<string, unknown>)[String(field)] = value;
    expect((await checkCognitoReadiness(config, readerFor(data))).status).toBe("blocked");
  });
  it.each(["get-caller-identity", "describe-user-pool", "describe-user-pool-client", "describe-user-pool-domain", "describe-managed-login-branding-by-client", "list-groups"])("fails closed for malformed/missing %s results", async operation => {
    const data = metadata();
    data[operation] = undefined;
    expect((await checkCognitoReadiness(config, readerFor(data))).status).toBe("blocked");
  });
  it("does not display account identifiers, configured IDs or arbitrary AWS metadata", async () => {
    const data = metadata();
    (data["describe-user-pool-client"] as Record<string, unknown>).UnexpectedSecret = "private-secret-marker";
    const text = formatReadiness(await checkCognitoReadiness(config, readerFor(data)));
    expect(text).not.toContain("private-secret-marker");
    expect(text).not.toContain(config.NEXT_PUBLIC_COGNITO_CLIENT_ID);
    expect(text).not.toContain(config.NEXT_PUBLIC_COGNITO_USER_POOL_ID);
  });
  it("refuses AWS mutation commands before spawning the CLI", async () => {
    await expect(runAwsReadOnly(["cognito-idp", "create-user-pool"])).rejects.toThrow("read-only");
    await expect(runAwsReadOnly(["cognito-idp", "admin-update-user-attributes"])).rejects.toThrow("read-only");
    await expect(runAwsReadOnly(["secretsmanager", "get-secret-value"])).rejects.toThrow("read-only");
  });
});
