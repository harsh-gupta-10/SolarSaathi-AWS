import { writeFileSync } from "node:fs";
import process from "node:process";

const names = [
  "NEXT_PUBLIC_API_BASE_URL",
  "NEXT_PUBLIC_GOOGLE_MAPS_KEY",
  "NEXT_PUBLIC_COGNITO_USER_POOL_ID",
  "NEXT_PUBLIC_COGNITO_CLIENT_ID",
  "NEXT_PUBLIC_COGNITO_REGION",
  "NEXT_PUBLIC_COGNITO_DOMAIN",
  "NEXT_PUBLIC_COGNITO_REDIRECT_SIGN_IN",
  "NEXT_PUBLIC_COGNITO_REDIRECT_SIGN_OUT",
  "NEXT_PUBLIC_COGNITO_GOOGLE_ENABLED",
];

const lines = names.flatMap((name) => {
  const value = process.env[name];
  if (value === undefined) return [];
  if (/[\r\n\0]/.test(value)) throw new Error(`${name} must be a single-line value`);
  return [`${name}=${JSON.stringify(value)}`];
});

writeFileSync("apps/web/.env.production", `${lines.join("\n")}\n`, { mode: 0o600 });
