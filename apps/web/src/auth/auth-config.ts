import { getPublicEnvironment } from "../lib/env";

export type AuthConfiguration =
  | { status: "unconfigured" | "error" }
  | {
      status: "ready";
      userPoolId: string;
      userPoolClientId: string;
      domain: string;
      redirectSignIn: string;
      redirectSignOut: string;
      googleEnabled: boolean;
    };

export function getAuthConfiguration(origin: string): AuthConfiguration {
  try {
    const env = getPublicEnvironment();
    const userPoolId = env.NEXT_PUBLIC_COGNITO_USER_POOL_ID;
    const userPoolClientId = env.NEXT_PUBLIC_COGNITO_CLIENT_ID;
    const domain = env.NEXT_PUBLIC_COGNITO_DOMAIN;
    const redirectSignIn = env.NEXT_PUBLIC_COGNITO_REDIRECT_SIGN_IN;
    const redirectSignOut = env.NEXT_PUBLIC_COGNITO_REDIRECT_SIGN_OUT;
    if (!userPoolId || !userPoolClientId || !domain || !redirectSignIn || !redirectSignOut) {
      return { status: "unconfigured" };
    }
    const login = new URL(redirectSignIn);
    const logout = new URL(redirectSignOut);
    const current = new URL(origin);
    const validRedirect = (url: URL, path: string) =>
      url.origin === current.origin && url.pathname === path &&
      !url.search && !url.hash && !url.username && !url.password &&
      (url.protocol === "https:" ||
        (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)));
    if (
      !validRedirect(login, "/auth/callback") ||
      !validRedirect(logout, "/auth/sign-in") ||
      !/^[a-zA-Z0-9.-]+$/.test(domain) ||
      new URL(`https://${domain}`).host !== domain
    ) {
      return { status: "error" };
    }
    return {
      status: "ready", userPoolId, userPoolClientId, domain,
      redirectSignIn, redirectSignOut,
      googleEnabled: env.NEXT_PUBLIC_COGNITO_GOOGLE_ENABLED === "true",
    };
  } catch {
    return { status: "error" };
  }
}
