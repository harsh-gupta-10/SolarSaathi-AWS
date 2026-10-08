import { Amplify } from "aws-amplify";
import { cognitoUserPoolsTokenProvider } from "aws-amplify/auth/cognito";
import type { AuthConfiguration } from "./auth-config";
import { createAuthCookieStorage } from "./auth-storage";

export function configureCognitoClient(
  config: Extract<AuthConfiguration, { status: "ready" }>,
  protocol: string,
) {
  const auth = { Cognito: {
    userPoolId: config.userPoolId,
    userPoolClientId: config.userPoolClientId,
    loginWith: { oauth: {
      domain: config.domain,
      scopes: ["openid", "email", "profile", "aws.cognito.signin.user.admin"],
      redirectSignIn: [config.redirectSignIn],
      redirectSignOut: [config.redirectSignOut],
      responseType: "code" as const,
    } },
  } };
  cognitoUserPoolsTokenProvider.setKeyValueStorage(createAuthCookieStorage(protocol));
  cognitoUserPoolsTokenProvider.setAuthConfig(auth);
  // 6.22.1 resets default-provider storage on configure unless explicitly supplied.
  Amplify.configure({ Auth: auth }, { Auth: { tokenProvider: cognitoUserPoolsTokenProvider } });
}
