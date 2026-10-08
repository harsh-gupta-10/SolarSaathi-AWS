import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { EnvironmentValidationError, parsePublicEnv, type EnvironmentInput } from "@solarsaathi/config/public";

const exec = promisify(execFile);
export type AwsReader = (args: readonly string[]) => Promise<unknown>;
export interface ReadinessCheck { name: string; passed: boolean; message: string; }
export interface ReadinessReport { status: "ready" | "blocked"; checks: ReadinessCheck[]; liveAuthenticationVerified: false; }
const operations = new Set(["get-caller-identity", "describe-user-pool", "describe-user-pool-client", "describe-user-pool-domain", "describe-managed-login-branding-by-client", "list-groups", "list-identity-providers"]);
const requiredFields = ["NEXT_PUBLIC_COGNITO_USER_POOL_ID", "NEXT_PUBLIC_COGNITO_CLIENT_ID", "NEXT_PUBLIC_COGNITO_DOMAIN", "NEXT_PUBLIC_COGNITO_REDIRECT_SIGN_IN", "NEXT_PUBLIC_COGNITO_REDIRECT_SIGN_OUT"] as const;

export const runAwsReadOnly: AwsReader = async args => {
  const allowed = args[0] === "sts" ? args[1] === "get-caller-identity"
    : args[0] === "cognito-idp" && args[1] !== "get-caller-identity" && operations.has(args[1]);
  if (!allowed) throw new Error("Only fixed read-only Cognito checks are allowed.");
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.startsWith("AWS_") || ["PATH", "HOME", "LANG", "LC_ALL", "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "no_proxy", "REQUESTS_CA_BUNDLE"].includes(key)));
  try {
    const result = await exec("aws", [...args], { encoding: "utf8", timeout: 15_000, maxBuffer: 262_144, env: { ...env, AWS_PAGER: "", AWS_EC2_METADATA_DISABLED: "true" } });
    return JSON.parse(result.stdout) as unknown;
  } catch { throw new Error("The read-only AWS metadata check could not complete."); }
};
function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function strings(value: unknown): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []; }
function validityMinutes(client: Record<string, unknown>, kind: "AccessToken" | "IdToken" | "RefreshToken"): number {
  const value = client[`${kind}Validity`];
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return Infinity;
  const unit = record(client.TokenValidityUnits)[kind] ?? (kind === "RefreshToken" ? "days" : "hours");
  const factors: Record<string, number> = { seconds: 1 / 60, minutes: 1, hours: 60, days: 1_440 };
  const factor = factors[String(unit)];
  return factor ? value * factor : Infinity;
}

export async function checkCognitoReadiness(input: EnvironmentInput, reader: AwsReader = runAwsReadOnly): Promise<ReadinessReport> {
  const checks: ReadinessCheck[] = [];
  function add(name: string, passed: boolean, message: string) { checks.push({ name, passed, message }); }
  function report(): ReadinessReport { return { status: checks.every(check => check.passed) ? "ready" : "blocked", checks, liveAuthenticationVerified: false }; }
  let config: ReturnType<typeof parsePublicEnv>;
  try { config = parsePublicEnv(input); } catch (error) {
    const fields = error instanceof EnvironmentValidationError ? error.issues.map(issue => issue.field).join(", ") : "public authentication settings";
    add("configuration", false, `Correct invalid configuration fields: ${fields}.`);
    return report();
  }
  const missing = requiredFields.filter(field => !config[field]);
  if (missing.length) {
    add("configuration", false, `Configure ${missing.join(", ")} before connecting Cognito. No AWS calls were made.`);
    return report();
  }
  const poolId = config.NEXT_PUBLIC_COGNITO_USER_POOL_ID!;
  const clientId = config.NEXT_PUBLIC_COGNITO_CLIENT_ID!;
  const region = config.NEXT_PUBLIC_COGNITO_REGION ?? poolId.split("_")[0];
  const domain = config.NEXT_PUBLIC_COGNITO_DOMAIN!;
  const prefixSuffix = `.auth.${region}.amazoncognito.com`;
  const domainName = domain.endsWith(prefixSuffix) ? domain.slice(0, -prefixSuffix.length) : domain;
  async function read(operation: string, query: string, extra: string[] = [], service = "cognito-idp"): Promise<unknown> {
    try {
      const value = await reader([service, operation, ...extra, "--region", region, "--query", query, "--output", "json", "--no-cli-pager", "--cli-connect-timeout", "5", "--cli-read-timeout", "10"]);
      if (value === undefined) throw new Error("Missing metadata.");
      return value;
    }
    catch {
      const action = operation.split("-").map(part => part[0].toUpperCase() + part.slice(1)).join("");
      const recovery = service === "sts" ? "Check AWS login and region." : `Check AWS login, region and permission for ${service}:${action}.`;
      add(operation, false, `Cannot read the configured metadata. ${recovery}`);
      return undefined;
    }
  }
  const identity = await read("get-caller-identity", "Account!=`null`", [], "sts");
  if (identity !== true) { if (identity !== undefined) add("aws-identity", false, "AWS identity could not be verified."); return report(); }
  add("aws-identity", true, "AWS identity is available; account identifiers are not displayed.");
  const [poolValue, clientValue, domainValue, groupsValue] = await Promise.all([
    read("describe-user-pool", "UserPool.{Id:Id,AutoVerifiedAttributes:AutoVerifiedAttributes,SchemaAttributes:SchemaAttributes}", ["--user-pool-id", poolId]),
    read("describe-user-pool-client", "UserPoolClient.{UserPoolId:UserPoolId,ClientId:ClientId,HasSecret:ClientSecret!=`null`,AllowedOAuthFlowsUserPoolClient:AllowedOAuthFlowsUserPoolClient,AllowedOAuthFlows:AllowedOAuthFlows,AllowedOAuthScopes:AllowedOAuthScopes,CallbackURLs:CallbackURLs,LogoutURLs:LogoutURLs,SupportedIdentityProviders:SupportedIdentityProviders,ReadAttributes:ReadAttributes,WriteAttributes:WriteAttributes,AccessTokenValidity:AccessTokenValidity,IdTokenValidity:IdTokenValidity,RefreshTokenValidity:RefreshTokenValidity,TokenValidityUnits:TokenValidityUnits,EnableTokenRevocation:EnableTokenRevocation,RefreshTokenRotation:RefreshTokenRotation,ExplicitAuthFlows:ExplicitAuthFlows}", ["--user-pool-id", poolId, "--client-id", clientId]),
    read("describe-user-pool-domain", "DomainDescription.{UserPoolId:UserPoolId,Status:Status,ManagedLoginVersion:ManagedLoginVersion}", ["--domain", domainName]),
    read("list-groups", "Groups[].GroupName", ["--user-pool-id", poolId]),
  ]);
  if (poolValue !== undefined) {
    const pool = record(poolValue);
    add("pool-binding", pool.Id === poolId, "The configured user pool must exist.");
    add("email-verification", strings(pool.AutoVerifiedAttributes).includes("email"), "The pool must verify email ownership.");
    const attributes = Array.isArray(pool.SchemaAttributes) ? pool.SchemaAttributes.map(record) : [];
    add("organization-schema", attributes.some(attribute => ["organizationId", "custom:organizationId"].includes(String(attribute.Name)) && attribute.AttributeDataType === "String"), "An organization identity attribute must be present; it does not establish database membership.");
  }
  if (clientValue !== undefined) {
    const client = record(clientValue);
    add("client-binding", client.UserPoolId === poolId && client.ClientId === clientId, "The configured app client must belong to this pool.");
    add("public-client", client.HasSecret === false, "The browser app client must not have a secret.");
    const flows = strings(client.AllowedOAuthFlows);
    add("code-flow", client.AllowedOAuthFlowsUserPoolClient === true && flows.length === 1 && flows[0] === "code", "Only the authorization-code flow is allowed; the SDK supplies PKCE.");
    add("oauth-scopes", ["openid", "email", "profile", "aws.cognito.signin.user.admin"].every(scope => strings(client.AllowedOAuthScopes).includes(scope)), "Identity and Cognito user-attribute scopes must be registered.");
    add("callback", strings(client.CallbackURLs).includes(config.NEXT_PUBLIC_COGNITO_REDIRECT_SIGN_IN!), "The exact configured callback must be registered.");
    add("logout", strings(client.LogoutURLs).includes(config.NEXT_PUBLIC_COGNITO_REDIRECT_SIGN_OUT!), "The exact configured logout URL must be registered.");
    const write = strings(client.WriteAttributes);
    add("readonly-membership", Array.isArray(client.WriteAttributes) && !write.some(attribute => ["custom:organizationId", "custom:role"].includes(attribute)), "Membership attributes must be explicitly read-only to the public client.");
    add("organization-read", strings(client.ReadAttributes).includes("custom:organizationId"), "The identity profile must be allowed to read organization context.");
    add("short-lived-tokens", validityMinutes(client, "AccessToken") <= 15 && validityMinutes(client, "IdToken") <= 15 && validityMinutes(client, "RefreshToken") <= 1_440, "Access/ID tokens must be at most 15 minutes; refresh tokens at most one day.");
    add("rotation-revocation", client.EnableTokenRevocation === true && record(client.RefreshTokenRotation).Feature === "ENABLED" && !strings(client.ExplicitAuthFlows).includes("ALLOW_REFRESH_TOKEN_AUTH"), "Enable rotation/revocation without the incompatible refresh-auth flow.");
    add("hosted-provider", strings(client.SupportedIdentityProviders).includes("COGNITO"), "Hosted account creation/sign-in must be enabled.");
    if (config.NEXT_PUBLIC_COGNITO_GOOGLE_ENABLED === "true") add("google-client", strings(client.SupportedIdentityProviders).includes("Google"), "Enable Google on this app client before showing its sign-in action.");
  }
  if (domainValue !== undefined) {
    const loginDomain = record(domainValue);
    add("login-domain", loginDomain.UserPoolId === poolId && loginDomain.Status === "ACTIVE", "The login domain must be active and bound to the configured pool.");
    add("managed-login", loginDomain.ManagedLoginVersion === 2, "Managed login v2 must be enabled.");
    if (loginDomain.ManagedLoginVersion === 2) {
      const branding = await read("describe-managed-login-branding-by-client", "ManagedLoginBranding.ManagedLoginBrandingId!=`null`", ["--user-pool-id", poolId, "--client-id", clientId]);
      if (branding !== undefined) add("login-branding", branding === true, "Managed login v2 requires a branding resource for this app client.");
    }
  }
  if (groupsValue !== undefined) add("broker-group", strings(groupsValue).includes("BROKER"), "Broker group membership must be administrator-assigned.");
  if (config.NEXT_PUBLIC_COGNITO_GOOGLE_ENABLED === "true") {
    const providers = await read("list-identity-providers", "Providers[].ProviderName", ["--user-pool-id", poolId]);
    if (providers !== undefined) add("google-provider", strings(providers).includes("Google"), "Google federation must exist; provider secrets are never retrieved.");
  }
  return report();
}

export function formatReadiness(report: ReadinessReport): string {
  return ["Cognito configuration readiness (read-only)", ...report.checks.map(check => `${check.passed ? "PASS" : "BLOCKED"} ${check.name}: ${check.message}`), "Metadata only: interactive sign-up, sign-in, callback and API authorization still require live verification."].join("\n");
}
