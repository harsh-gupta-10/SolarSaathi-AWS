import { describe, expect, expectTypeOf, it } from "vitest";
import { parsePublicEnv, type PublicEnv } from "@solarsaathi/config/public";

const publicFields = [
  "NEXT_PUBLIC_API_BASE_URL",
  "NEXT_PUBLIC_GOOGLE_MAPS_KEY",
  "NEXT_PUBLIC_COGNITO_USER_POOL_ID",
  "NEXT_PUBLIC_COGNITO_CLIENT_ID",
  "NEXT_PUBLIC_COGNITO_REGION",
  "NEXT_PUBLIC_COGNITO_DOMAIN",
  "NEXT_PUBLIC_COGNITO_REDIRECT_SIGN_IN",
  "NEXT_PUBLIC_COGNITO_REDIRECT_SIGN_OUT",
  "NEXT_PUBLIC_COGNITO_GOOGLE_ENABLED",
] as const;

const configured = {
  NEXT_PUBLIC_API_BASE_URL: "https://api.example.com/v1",
  NEXT_PUBLIC_GOOGLE_MAPS_KEY: "AIzaAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  NEXT_PUBLIC_COGNITO_USER_POOL_ID: "ap-south-1_Example123",
  NEXT_PUBLIC_COGNITO_CLIENT_ID: "exampleclient123",
  NEXT_PUBLIC_COGNITO_REGION: "ap-south-1",
  NEXT_PUBLIC_COGNITO_DOMAIN: "example.auth.ap-south-1.amazoncognito.com",
  NEXT_PUBLIC_COGNITO_REDIRECT_SIGN_IN: "http://localhost:3000/auth/callback",
  NEXT_PUBLIC_COGNITO_REDIRECT_SIGN_OUT: "http://localhost:3000/auth/sign-in",
  NEXT_PUBLIC_COGNITO_GOOGLE_ENABLED: "false",
};

describe("parsePublicEnv", () => {
  it("requires no configured integrations", () => {
    const result = parsePublicEnv({});
    expect(Object.keys(result)).toEqual([...publicFields]);
    for (const field of publicFields) expect(result[field]).toBeUndefined();
    expectTypeOf(result).toEqualTypeOf<PublicEnv>();
    expectTypeOf(result.NEXT_PUBLIC_API_BASE_URL).toEqualTypeOf<
      string | undefined
    >();
  });

  it.each(["", " ", "\t\n"])("normalizes blank optional values (%j)", (blank) => {
    const result = parsePublicEnv(
      Object.fromEntries(publicFields.map((field) => [field, blank])),
    );
    for (const field of publicFields) expect(result[field]).toBeUndefined();
  });

  it("preserves configured values and does not mutate the supplied object", () => {
    const input = Object.freeze({ ...configured });
    expect(parsePublicEnv(input)).toEqual(configured);
    expect(input).toEqual(configured);
  });

  it.each(publicFields)("allows %s to be configured independently", (field) => {
    expect(parsePublicEnv({ [field]: configured[field] })[field]).toBe(
      configured[field],
    );
  });

  it.each([
    "http://localhost:3001/v1",
    "http://127.0.0.1:3001",
    "http://[::1]:3001/v1",
    "https://api.example.com/v1",
    "https://localhost:3001",
  ])("accepts an allowed API URL (%s)", (url) => {
    expect(parsePublicEnv({ NEXT_PUBLIC_API_BASE_URL: url }).NEXT_PUBLIC_API_BASE_URL)
      .toBe(url);
  });

  it.each([
    "not-a-url",
    "/v1",
    "https:api.example.com",
    "http://api.example.com",
    "http://localhost.example.com",
    "http://127.0.0.1.example.com",
    "http://0.0.0.0:3001",
    "ftp://localhost",
    "javascript:alert(1)",
    "https://",
    " https://api.example.com",
    "https://user:password@api.example.com",
    "http://user:password@localhost:3001",
  ])("rejects an invalid API URL (%s)", (url) => {
    expect(() => parsePublicEnv({ NEXT_PUBLIC_API_BASE_URL: url })).toThrow();
  });

  it.each([
    ["NEXT_PUBLIC_COGNITO_REGION", "not-a-region"],
    ["NEXT_PUBLIC_COGNITO_REGION", "ap_south_1"],
    ["NEXT_PUBLIC_COGNITO_REGION", "ap-south-0"],
    ["NEXT_PUBLIC_COGNITO_REGION", " ap-south-1 "],
    ["NEXT_PUBLIC_COGNITO_USER_POOL_ID", "invalid"],
    ["NEXT_PUBLIC_COGNITO_USER_POOL_ID", "invalid_Example123"],
    ["NEXT_PUBLIC_COGNITO_USER_POOL_ID", "ap-south-1_"],
    ["NEXT_PUBLIC_COGNITO_USER_POOL_ID", `ap-south-1_${"a".repeat(46)}`],
    ["NEXT_PUBLIC_COGNITO_CLIENT_ID", "client with spaces"],
    ["NEXT_PUBLIC_COGNITO_CLIENT_ID", "client!"],
    ["NEXT_PUBLIC_COGNITO_CLIENT_ID", "a".repeat(129)],
    ["NEXT_PUBLIC_GOOGLE_MAPS_KEY", "not a key"],
    ["NEXT_PUBLIC_GOOGLE_MAPS_KEY", "short"],
  ])("rejects invalid configured %s", (field, value) => {
    expect(() => parsePublicEnv({ [field]: value })).toThrow();
  });

  it("rejects inconsistent pool and Cognito region without requiring the API URL", () => {
    expect(() =>
      parsePublicEnv({
        NEXT_PUBLIC_COGNITO_USER_POOL_ID: "ap-south-1_Example123",
        NEXT_PUBLIC_COGNITO_REGION: "us-east-1",
      }),
    ).toThrow("NEXT_PUBLIC_COGNITO_USER_POOL_ID");
  });
});
