import { z } from "zod";
import {
  awsRegionSchema,
  cognitoClientIdSchema,
  userPoolIdSchema,
  optionalValue,
  parseEnvironment,
  type EnvironmentInput,
} from "./validation";

export {
  EnvironmentValidationError,
  type EnvironmentInput,
  type EnvironmentIssue,
} from "./validation";

const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);

const apiBaseUrlSchema = z.string().refine((value) => {
  if (!/^https?:\/\//.test(value) || /\s/.test(value)) return false;

  try {
    const url = new URL(value);
    return (
      url.username === "" &&
      url.password === "" &&
      (url.protocol === "https:" ||
        (url.protocol === "http:" && loopbackHosts.has(url.hostname)))
    );
  } catch {
    return false;
  }
});

function authRedirectSchema(pathname: string) {
  return apiBaseUrlSchema.refine(value => {
    try {
      const url = new URL(value);
      return url.pathname === pathname && url.search === "" && url.hash === "";
    } catch { return false; }
  });
}
function urlOrigin(value: string): string | undefined {
  try { return new URL(value).origin; } catch { return undefined; }
}

const publicEnvironmentSchema = z
  .object({
    NEXT_PUBLIC_API_BASE_URL: optionalValue(apiBaseUrlSchema),
    NEXT_PUBLIC_CHAT_STREAM_URL: optionalValue(apiBaseUrlSchema),
    NEXT_PUBLIC_GOOGLE_MAPS_KEY: optionalValue(z.string().min(20).max(256).regex(/^[A-Za-z0-9_-]+$/)),
    NEXT_PUBLIC_COGNITO_USER_POOL_ID: optionalValue(userPoolIdSchema),
    NEXT_PUBLIC_COGNITO_CLIENT_ID: optionalValue(cognitoClientIdSchema),
    NEXT_PUBLIC_COGNITO_REGION: optionalValue(awsRegionSchema),
    NEXT_PUBLIC_COGNITO_DOMAIN: optionalValue(z.string().max(253).regex(/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/)),
    NEXT_PUBLIC_COGNITO_REDIRECT_SIGN_IN: optionalValue(authRedirectSchema("/auth/callback")),
    NEXT_PUBLIC_COGNITO_REDIRECT_SIGN_OUT: optionalValue(authRedirectSchema("/auth/sign-in")),
    NEXT_PUBLIC_COGNITO_GOOGLE_ENABLED: optionalValue(z.enum(["true", "false"])),
  })
  .superRefine((env, ctx) => {
    if (env.NEXT_PUBLIC_COGNITO_REDIRECT_SIGN_IN && env.NEXT_PUBLIC_COGNITO_REDIRECT_SIGN_OUT &&
      urlOrigin(env.NEXT_PUBLIC_COGNITO_REDIRECT_SIGN_IN) !== urlOrigin(env.NEXT_PUBLIC_COGNITO_REDIRECT_SIGN_OUT)) {
      ctx.addIssue({ code: "custom", path: ["NEXT_PUBLIC_COGNITO_REDIRECT_SIGN_OUT"], message: "Authentication redirects must use the same origin." });
    }
    if (
      env.NEXT_PUBLIC_COGNITO_USER_POOL_ID !== undefined &&
      env.NEXT_PUBLIC_COGNITO_REGION !== undefined &&
      env.NEXT_PUBLIC_COGNITO_USER_POOL_ID.split("_")[0] !==
        env.NEXT_PUBLIC_COGNITO_REGION
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["NEXT_PUBLIC_COGNITO_USER_POOL_ID"],
        message: "User pool and configured region must match.",
      });
    }
  });

export type PublicEnv = z.output<typeof publicEnvironmentSchema>;

export function parsePublicEnv(env: EnvironmentInput): PublicEnv {
  return parseEnvironment(
    publicEnvironmentSchema,
    env,
    Object.keys(publicEnvironmentSchema.shape),
  );
}
