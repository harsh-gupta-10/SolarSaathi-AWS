import { authNotConfigured } from "./errors";

export interface AuthEnvironment {
  COGNITO_USER_POOL_ID?: string;
  COGNITO_CLIENT_ID?: string;
  COGNITO_REGION?: string;
}

export interface CognitoConfiguration {
  userPoolId: string;
  clientId: string;
  region: string;
}

export function cognitoConfiguration(environment: AuthEnvironment): CognitoConfiguration {
  const userPoolId = environment.COGNITO_USER_POOL_ID?.trim();
  const clientId = environment.COGNITO_CLIENT_ID?.trim();
  const pool = userPoolId?.match(/^([a-z]{2}(?:-[a-z]+)+-\d)_([A-Za-z0-9]+)$/);
  const region = environment.COGNITO_REGION?.trim() || pool?.[1];
  if (!userPoolId || userPoolId.length > 55 || !pool || !clientId ||
    !/^[A-Za-z0-9_+]{1,128}$/.test(clientId) || region !== pool[1]) {
    throw authNotConfigured();
  }
  return { userPoolId, clientId, region };
}
