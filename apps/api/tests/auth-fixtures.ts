import { createSign, generateKeyPairSync } from "node:crypto";
import type { APIGatewayProxyEvent, Context } from "aws-lambda";
import type { GetUserCommandOutput } from "@aws-sdk/client-cognito-identity-provider";
import { createAccessTokenVerifier } from "../src/auth/cognito";
import { cognitoConfiguration } from "../src/auth/config";

export const environment = {
  COGNITO_USER_POOL_ID: "ap-south-1_TestPool123",
  COGNITO_CLIENT_ID: "testclient123",
};
export const configuration = cognitoConfiguration(environment);
export const sub = "a61efe10-d953-4293-9750-62c163a2c2f8";
export const context = { awsRequestId: "identity-request-id" } as Context;

// Keys exist only in this test process, never in source fixtures or on disk.
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kty: "RSA", alg: "RS256", use: "sig", kid: "ephemeral-test-key" };

export function signedToken(overrides: Record<string, unknown> = {}): string {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: jwk.kid, typ: "JWT" })).toString("base64url");
  const claims = Buffer.from(JSON.stringify({
    sub,
    iss: `https://cognito-idp.${configuration.region}.amazonaws.com/${configuration.userPoolId}`,
    client_id: configuration.clientId,
    token_use: "access",
    scope: "aws.cognito.signin.user.admin",
    iat: now,
    exp: now + 600,
    ...overrides,
  })).toString("base64url");
  const unsigned = `${header}.${claims}`;
  const signature = createSign("RSA-SHA256").update(unsigned).sign(privateKey).toString("base64url");
  return `${unsigned}.${signature}`;
}

export function verifierWithTestJwks() {
  const verifier = createAccessTokenVerifier(configuration);
  verifier.cacheJwks({ keys: [jwk] });
  return verifier;
}

export function request(token: string = signedToken()): APIGatewayProxyEvent {
  return {
    body: null,
    headers: { authorization: `Bearer ${token}` },
    multiValueHeaders: {},
    httpMethod: "GET",
    isBase64Encoded: false,
    path: "/v1/me",
    resource: "/v1/me",
    pathParameters: null,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    requestContext: {} as APIGatewayProxyEvent["requestContext"],
  };
}

export function userOutput(attributes: Record<string, string | undefined> = {}): GetUserCommandOutput {
  return {
    Username: "never-expose-username",
    UserAttributes: Object.entries({ sub, email: "user@example.com", email_verified: "true", name: "Solar User", ...attributes })
      .map(([Name, Value]) => ({ Name, Value })),
    $metadata: { requestId: "never-expose-sdk-request" },
  };
}
