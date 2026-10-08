import { RequestError } from "../lib/http";

export function unauthorized(): RequestError {
  return new RequestError(401, "UNAUTHORIZED", "Sign in again with a valid Cognito access token.");
}

export function authNotConfigured(): RequestError {
  return new RequestError(
    503,
    "AUTH_NOT_CONFIGURED",
    "Authentication is unavailable. Configure COGNITO_USER_POOL_ID and COGNITO_CLIENT_ID with a matching COGNITO_REGION before using this endpoint.",
  );
}

export function authServiceUnavailable(): RequestError {
  return new RequestError(503, "AUTH_SERVICE_UNAVAILABLE", "Authentication is temporarily unavailable. Try again shortly.");
}
