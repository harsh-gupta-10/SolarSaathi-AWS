import { describe, expect, it } from "vitest";
import { EnvironmentValidationError, parsePublicEnv } from "@solarsaathi/config/public";
import { parseServerEnv } from "@solarsaathi/config/server";

describe("API CORS origin configuration", () => {
  it("allows a fixed HTTPS or localhost origin", () => {
    expect(parseServerEnv({ API_ALLOWED_ORIGIN: "https://app.example.com" }).API_ALLOWED_ORIGIN).toBe("https://app.example.com");
    expect(parseServerEnv({ API_ALLOWED_ORIGIN: "http://localhost:3000" }).API_ALLOWED_ORIGIN).toBe("http://localhost:3000");
  });
  it.each(["*", "https://app.example.com/path", "https://app.example.com/", "http://untrusted.example.com", "not-a-url"])("rejects arbitrary or non-origin CORS values", origin => {
    expect(() => parseServerEnv({ API_ALLOWED_ORIGIN: origin })).toThrow(EnvironmentValidationError);
  });
});

describe("Cognito public OAuth configuration", () => {
  it("accepts a complete code-flow configuration without any secrets", () => {
    expect(parsePublicEnv({
      NEXT_PUBLIC_COGNITO_DOMAIN: "example.auth.ap-south-1.amazoncognito.com",
      NEXT_PUBLIC_COGNITO_REDIRECT_SIGN_IN: "https://app.solarsaathi.in/auth/callback",
      NEXT_PUBLIC_COGNITO_REDIRECT_SIGN_OUT: "https://app.solarsaathi.in/auth/sign-in",
      NEXT_PUBLIC_COGNITO_GOOGLE_ENABLED: "true",
      GOOGLE_OAUTH_CLIENT_SECRET: "server-only-value",
    })).not.toHaveProperty("GOOGLE_OAUTH_CLIENT_SECRET");
  });
  it.each(["https://domain.example", "localhost:3000", "example.com/path", "127.0.0.1", " example.com"])("rejects a non-host Cognito domain: %s", domain => {
    expect(() => parsePublicEnv({ NEXT_PUBLIC_COGNITO_DOMAIN: domain })).toThrow(EnvironmentValidationError);
  });
  it.each(["not-a-url", "http://evil.example/auth/callback", "https://app.example/auth/callback?code=secret", "https://app.example/auth/callback#token", "https://app.example/other", "//evil.example/auth/callback"])("rejects invalid callbacks without retaining values", callback => {
    let caught: unknown;
    try { parsePublicEnv({ NEXT_PUBLIC_COGNITO_REDIRECT_SIGN_IN: callback }); } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(EnvironmentValidationError);
    expect(String(caught)).not.toContain(callback);
  });
  it("requires matching redirect origins", () => {
    expect(() => parsePublicEnv({ NEXT_PUBLIC_COGNITO_REDIRECT_SIGN_IN: "https://app.example/auth/callback", NEXT_PUBLIC_COGNITO_REDIRECT_SIGN_OUT: "https://other.example/auth/sign-in" })).toThrow(EnvironmentValidationError);
  });
  it("allows localhost HTTP only for the exact callback routes", () => {
    expect(parsePublicEnv({ NEXT_PUBLIC_COGNITO_REDIRECT_SIGN_IN: "http://localhost:3000/auth/callback", NEXT_PUBLIC_COGNITO_REDIRECT_SIGN_OUT: "http://localhost:3000/auth/sign-in" }).NEXT_PUBLIC_COGNITO_REDIRECT_SIGN_IN).toBe("http://localhost:3000/auth/callback");
  });
  it.each(["yes", "1", "TRUE"])("rejects ambiguous Google enabling values", value => expect(() => parsePublicEnv({ NEXT_PUBLIC_COGNITO_GOOGLE_ENABLED: value })).toThrow(EnvironmentValidationError));
});
