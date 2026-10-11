import {
  CognitoIdentityProviderClient,
  GetUserCommand,
  type GetUserCommandOutput,
} from "@aws-sdk/client-cognito-identity-provider";
import { CognitoJwtVerifier } from "aws-jwt-verify";
import { FetchError, JwtBaseError, JwksValidationError } from "aws-jwt-verify/error";
import { SimpleFetcher } from "aws-jwt-verify/https";
import { SimpleJwksCache } from "aws-jwt-verify/jwk";
import type { CognitoAccessTokenPayload } from "aws-jwt-verify/jwt-model";
import type { APIGatewayProxyEvent } from "aws-lambda";
import { bearerAccessToken } from "./bearer";
import { cognitoConfiguration, type AuthEnvironment, type CognitoConfiguration } from "./config";
import { authServiceUnavailable, unauthorized } from "./errors";

import { createHash } from "node:crypto";
export const VERIFICATION_TIMEOUT_MS = 3_000;
export const GET_USER_TIMEOUT_MS = 4_000;
const USER_CACHE_TTL_MS = 30_000;
const USER_CACHE_MAX = 500;
const MAX_CACHE_ENTRIES = 8;

export interface AccessTokenVerifier {
  verify(token: string): Promise<CognitoAccessTokenPayload>;
}

export interface CognitoUserClient {
  send(command: GetUserCommand, options: { abortSignal: AbortSignal }): Promise<GetUserCommandOutput>;
}

export interface IdentityDependencies {
  createVerifier?: (configuration: CognitoConfiguration) => AccessTokenVerifier;
  createClient?: (configuration: CognitoConfiguration) => CognitoUserClient;
}

export interface VerifiedCognitoUser {
  sub: string;
  groups: readonly string[];
  attributes: GetUserCommandOutput["UserAttributes"];
}

export function createAccessTokenVerifier(configuration: CognitoConfiguration) {
  return CognitoJwtVerifier.create({
    userPoolId: configuration.userPoolId,
    clientId: configuration.clientId,
    tokenUse: "access",
  }, {
    jwksCache: new SimpleJwksCache({
      fetcher: new SimpleFetcher({ defaultRequestOptions: { responseTimeout: 1_000 } }),
    }),
  });
}

export function createCognitoUserClient(configuration: CognitoConfiguration): CognitoUserClient {
  return new CognitoIdentityProviderClient({
    region: configuration.region,
    maxAttempts: 2,
    requestHandler: { connectionTimeout: 1_000, requestTimeout: 2_000 },
  });
}

async function bounded<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(authServiceUnavailable()), timeoutMs); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function cached<T>(cache: Map<string, T>, key: string, create: () => T): T {
  const existing = cache.get(key);
  if (existing) return existing;
  const value = create();
  if (cache.size >= MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value!);
  cache.set(key, value);
  return value;
}

export function createCognitoIdentityResolver(dependencies: IdentityDependencies = {}) {
  const verifiers = new Map<string, AccessTokenVerifier>();
  const clients = new Map<string, CognitoUserClient>();
  const verifierFactory = dependencies.createVerifier ?? createAccessTokenVerifier;
  const clientFactory = dependencies.createClient ?? createCognitoUserClient;

  const userCache = new Map<string, { attributes: GetUserCommandOutput["UserAttributes"]; expiresAt: number }>();
  return async (event: APIGatewayProxyEvent, environment: AuthEnvironment): Promise<VerifiedCognitoUser> => {
    const configuration = cognitoConfiguration(environment);
    const token = bearerAccessToken(event);
    let claims: CognitoAccessTokenPayload;
    try {
      const verifier = cached(verifiers, `${configuration.userPoolId}:${configuration.clientId}`, () => verifierFactory(configuration));
      claims = await bounded(verifier.verify(token), VERIFICATION_TIMEOUT_MS);
    } catch (error) {
      if (error instanceof JwtBaseError && !(error instanceof FetchError) && !(error instanceof JwksValidationError)) {
        throw unauthorized();
      }
      throw authServiceUnavailable();
    }
    if (typeof claims.exp !== "number" || !Number.isFinite(claims.exp) || claims.exp <= Math.floor(Date.now() / 1_000) ||
      typeof claims.sub !== "string" || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(claims.sub)) {
      throw unauthorized();
    }
    const groups = claims["cognito:groups"];
    if (groups !== undefined && (!Array.isArray(groups) || !groups.every(group => typeof group === "string"))) {
      throw unauthorized();
    }
    const cacheKey = createHash("sha256").update(`${configuration.userPoolId}:${configuration.clientId}:${configuration.region}:${token}`).digest("hex");
    const now = Date.now();
    const hit = userCache.get(cacheKey);
    if (hit && hit.expiresAt > now) return { sub: claims.sub, groups: groups ?? [], attributes: hit.attributes };
    userCache.delete(cacheKey);
    let user: GetUserCommandOutput;
    const abortController = new AbortController();
    const abortTimer = setTimeout(() => abortController.abort(), GET_USER_TIMEOUT_MS);
    try {
      const client = cached(clients, `${configuration.userPoolId}:${configuration.region}`, () => clientFactory(configuration));
      user = await bounded(client.send(new GetUserCommand({ AccessToken: token }), { abortSignal: abortController.signal }), GET_USER_TIMEOUT_MS);
    } catch (error) {
      const name = error instanceof Error ? error.name : undefined;
      if (["NotAuthorizedException", "UserNotFoundException", "UserNotConfirmedException", "PasswordResetRequiredException", "InvalidParameterException", "ForbiddenException"].includes(name ?? "")) {
        throw unauthorized();
      }
      throw authServiceUnavailable();
    } finally {
      clearTimeout(abortTimer);
    }
    if (!user || typeof user !== "object") throw unauthorized();
    // Short-lived cache bounds Cognito GetUser traffic; it never outlives the token and caps revocation lag at 30 s.
    if (userCache.size >= USER_CACHE_MAX) userCache.delete(userCache.keys().next().value as string);
    userCache.set(cacheKey, { attributes: user.UserAttributes,
      expiresAt: Math.min(now + USER_CACHE_TTL_MS, claims.exp * 1_000) });
    return { sub: claims.sub, groups: groups ?? [], attributes: user.UserAttributes };
  };
}

export type CognitoIdentityResolver = ReturnType<typeof createCognitoIdentityResolver>;
