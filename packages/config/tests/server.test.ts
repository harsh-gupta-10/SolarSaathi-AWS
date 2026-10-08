import { describe, expect, expectTypeOf, it } from "vitest";
import { parseServerEnv, type ServerEnv } from "@solarsaathi/config/server";

const optionalFields = [
  "API_ALLOWED_ORIGIN",
  "COGNITO_USER_POOL_ID",
  "COGNITO_CLIENT_ID",
  "COGNITO_REGION",
  "GOOGLE_GEOCODING_API_KEY",
  "GOOGLE_SOLAR_API_KEY",
  "BEDROCK_MODEL_ID",
  "BEDROCK_REGION",
  "CORE_TABLE_NAME",
  "USERS_TABLE_NAME",
  "ORGS_TABLE_NAME",
  "CUSTOMERS_TABLE_NAME",
  "PROPERTIES_TABLE_NAME",
  "ANALYSES_TABLE_NAME",
  "LEADS_TABLE_NAME",
  "SOLAR_CACHE_TABLE_NAME",
] as const;

const tableFields = optionalFields.filter((field) => field.endsWith("_TABLE_NAME"));

describe("parseServerEnv", () => {
  it("starts Phase 0 without keys, models or tables", () => {
    const result = parseServerEnv({});
    expect(result).toMatchObject({
      ENVIRONMENT: "dev",
      AWS_REGION: "ap-south-1",
      LOG_LEVEL: "info",
    });
    for (const field of optionalFields) expect(result[field]).toBeUndefined();
    expectTypeOf(result).toEqualTypeOf<ServerEnv>();
    expectTypeOf(result.ENVIRONMENT).toEqualTypeOf<"dev" | "test" | "prod">();
    expectTypeOf(result.LOG_LEVEL).toEqualTypeOf<"debug" | "info" | "warn" | "error">();
    expectTypeOf(result.AWS_REGION).toEqualTypeOf<string>();
  });

  it.each(["", " ", "\t\n"])("normalizes blanks and applies defaults (%j)", (blank) => {
    const result = parseServerEnv(
      Object.fromEntries(
        ["ENVIRONMENT", "AWS_REGION", "LOG_LEVEL", ...optionalFields].map(
          (field) => [field, blank],
        ),
      ),
    );
    expect(result.ENVIRONMENT).toBe("dev");
    expect(result.AWS_REGION).toBe("ap-south-1");
    expect(result.LOG_LEVEL).toBe("info");
    for (const field of optionalFields) expect(result[field]).toBeUndefined();
  });

  it.each(["dev", "test", "prod"])("accepts %s without requiring integrations", (environment) => {
    expect(parseServerEnv({ ENVIRONMENT: environment }).ENVIRONMENT).toBe(environment);
  });

  it.each(["debug", "info", "warn", "error"])("accepts log level %s", (level) => {
    expect(parseServerEnv({ LOG_LEVEL: level }).LOG_LEVEL).toBe(level);
  });

  it.each([
    "ap-south-1",
    "us-east-1",
    "eu-west-2",
    "cn-north-1",
    "us-gov-west-1",
    "eusc-de-east-1",
  ])("accepts configured region syntax %s", (region) => {
    const result = parseServerEnv({ AWS_REGION: region, BEDROCK_REGION: region });
    expect(result.AWS_REGION).toBe(region);
    expect(result.BEDROCK_REGION).toBe(region);
  });

  it("preserves configured values, including separate Bedrock region", () => {
    const input = Object.freeze({
      ENVIRONMENT: "test",
      AWS_REGION: "ap-south-1",
      LOG_LEVEL: "warn",
      GOOGLE_GEOCODING_API_KEY: "example-geocoding_key",
      GOOGLE_SOLAR_API_KEY: "example-solar_key",
      BEDROCK_MODEL_ID: "provider.example-model-v1:0",
      BEDROCK_REGION: "us-east-1",
      ...Object.fromEntries(tableFields.map((field) => [field, "example-table"])),
    });
    expect(parseServerEnv(input)).toEqual(input);
  });

  it.each(optionalFields)("permits %s independently", (field) => {
    const value = field === "API_ALLOWED_ORIGIN" ? "https://app.example.com"
      : field === "COGNITO_USER_POOL_ID" ? "ap-south-1_Example123"
      : field === "COGNITO_CLIENT_ID" ? "exampleclient123"
      : field.endsWith("REGION") ? "us-east-1" : "example-value";
    expect(parseServerEnv({ [field]: value })[field]).toBe(value);
  });

  it.each([
    ["ENVIRONMENT", "production"],
    ["ENVIRONMENT", "PROD"],
    ["LOG_LEVEL", "trace"],
    ["LOG_LEVEL", "INFO"],
    ["AWS_REGION", "india"],
    ["AWS_REGION", "ap-south"],
    ["AWS_REGION", "ap-south-0"],
    ["AWS_REGION", "ap_south_1"],
    ["AWS_REGION", " ap-south-1 "],
    ["BEDROCK_REGION", "bad-region"],
    ["GOOGLE_GEOCODING_API_KEY", "key with spaces"],
    ["GOOGLE_SOLAR_API_KEY", "key\nwith-newline"],
    ["BEDROCK_MODEL_ID", "model with spaces"],
    ["BEDROCK_MODEL_ID", "a".repeat(2049)],
  ])("rejects invalid configured %s", (field, value) => {
    expect(() => parseServerEnv({ [field]: value })).toThrow();
  });

  it.each(tableFields)("validates table name constraints for %s", (field) => {
    for (const value of ["ab", "a".repeat(256), "invalid/table", "with spaces"]) {
      expect(() => parseServerEnv({ [field]: value })).toThrow(field);
    }
    for (const value of ["abc", "solar.dev-users_1", "a".repeat(255)]) {
      expect(parseServerEnv({ [field]: value })[field]).toBe(value);
    }
  });
});
