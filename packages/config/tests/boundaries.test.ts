import { inspect } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as publicEntry from "@solarsaathi/config/public";
import {
  EnvironmentValidationError,
  parsePublicEnv,
  type EnvironmentInput,
} from "@solarsaathi/config/public";
import { parseServerEnv } from "@solarsaathi/config/server";
import manifest from "../package.json";

function captureError(action: () => unknown): EnvironmentValidationError {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(EnvironmentValidationError);
    return error as EnvironmentValidationError;
  }
  throw new Error("Expected environment validation to fail.");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("environment boundaries", () => {
  it("exports separate public and server source entry points only", () => {
    expect(manifest.exports).toEqual({
      "./public": "./src/public.ts",
      "./server": "./src/server.ts",
    });
    expect(publicEntry).not.toHaveProperty("parseServerEnv");
    expect(Object.keys(publicEntry).sort()).toEqual([
      "EnvironmentValidationError",
      "parsePublicEnv",
    ]);
  });

  it("strips all server fields and unknown NEXT_PUBLIC fields from public output", () => {
    const result = parsePublicEnv({
      NEXT_PUBLIC_API_BASE_URL: "https://api.example.com",
      AWS_REGION: "invalid-but-irrelevant",
      ENVIRONMENT: "prod",
      LOG_LEVEL: "debug",
      GOOGLE_GEOCODING_API_KEY: "private-geocoding-key",
      GOOGLE_SOLAR_API_KEY: "private-solar-key",
      BEDROCK_MODEL_ID: "private-model",
      BEDROCK_REGION: "us-east-1",
      USERS_TABLE_NAME: "private-table",
      ORGS_TABLE_NAME: "private-table",
      CUSTOMERS_TABLE_NAME: "private-table",
      PROPERTIES_TABLE_NAME: "private-table",
      ANALYSES_TABLE_NAME: "private-table",
      LEADS_TABLE_NAME: "private-table",
      SOLAR_CACHE_TABLE_NAME: "private-table",
      AWS_SECRET_ACCESS_KEY: "private-aws-secret",
      NEXT_PUBLIC_UNKNOWN_SECRET: "private-unrecognized-secret",
    });
    expect(Object.keys(result).every((field) => field.startsWith("NEXT_PUBLIC_")))
      .toBe(true);
    expect(Object.keys(result)).toHaveLength(10);
    expect(JSON.stringify(result)).not.toContain("private-");
  });

  it("strips public and arbitrary secret fields from server output", () => {
    const result = parseServerEnv({
      NEXT_PUBLIC_API_BASE_URL: "invalid-but-irrelevant",
      NEXT_PUBLIC_COGNITO_REGION: "invalid-but-irrelevant",
      AWS_SECRET_ACCESS_KEY: "unrecognized-secret",
    });
    expect(result).not.toHaveProperty("NEXT_PUBLIC_API_BASE_URL");
    expect(result).not.toHaveProperty("NEXT_PUBLIC_COGNITO_REGION");
    expect(result).not.toHaveProperty("AWS_SECRET_ACCESS_KEY");
    expect(JSON.stringify(result)).not.toContain("unrecognized-secret");
  });

  it("never reads unrecognized env properties", () => {
    const env: EnvironmentInput = {};
    Object.defineProperty(env, "UNKNOWN_SECRET", {
      enumerable: true,
      get: () => { throw new Error("Unexpected secret access."); },
    });
    expect(() => parsePublicEnv(env)).not.toThrow();
    expect(() => parseServerEnv(env)).not.toThrow();
  });

  it("uses only the passed environment, not process.env", async () => {
    vi.stubEnv("ENVIRONMENT", "prod");
    vi.stubEnv("AWS_REGION", "us-east-1");
    vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "https://ambient.example.com");
    vi.resetModules();
    const freshServer = await import("@solarsaathi/config/server");
    const freshPublic = await import("@solarsaathi/config/public");
    expect(freshServer.parseServerEnv({}).ENVIRONMENT).toBe("dev");
    expect(freshServer.parseServerEnv({}).AWS_REGION).toBe("ap-south-1");
    expect(freshPublic.parsePublicEnv({}).NEXT_PUBLIC_API_BASE_URL).toBeUndefined();
    expect(freshServer.parseServerEnv({ ENVIRONMENT: "test" }).ENVIRONMENT).toBe("test");
    expect(freshPublic.parsePublicEnv({
      NEXT_PUBLIC_API_BASE_URL: "https://passed.example.com",
    }).NEXT_PUBLIC_API_BASE_URL).toBe("https://passed.example.com");
  });

  it("does not log successful or failing configuration", () => {
    const loggers = ["log", "info", "warn", "error", "debug"] as const;
    const spies = loggers.map((method) => vi.spyOn(console, method).mockImplementation(() => {}));
    parseServerEnv({ GOOGLE_SOLAR_API_KEY: "private-key" });
    parsePublicEnv({});
    captureError(() => parseServerEnv({ LOG_LEVEL: "invalid-secret-value" }));
    captureError(() => parsePublicEnv({ NEXT_PUBLIC_API_BASE_URL: "invalid-secret-value" }));
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});

describe("redacted validation failures", () => {
  it("retains only known field names and fixed messages in server errors", () => {
    const secrets = ["private-environment-value", "private-log-level", "private key value"];
    const error = captureError(() => parseServerEnv({
      ENVIRONMENT: secrets[0],
      LOG_LEVEL: secrets[1],
      GOOGLE_SOLAR_API_KEY: secrets[2],
      "private-unrecognized-field-name": "private-unrecognized-value",
    }));
    expect(error.issues).toEqual([
      { field: "ENVIRONMENT", message: "Invalid configured value." },
      { field: "LOG_LEVEL", message: "Invalid configured value." },
      { field: "GOOGLE_SOLAR_API_KEY", message: "Invalid configured value." },
    ]);
    expect(error).not.toHaveProperty("cause");
    expect(error).not.toHaveProperty("input");
    for (const rendered of [String(error), JSON.stringify(error), inspect(error, { showHidden: true, depth: null })]) {
      for (const secret of [...secrets, "private-unrecognized-field-name", "private-unrecognized-value"]) {
        expect(rendered).not.toContain(secret);
      }
    }
  });

  it("redacts public input values including embedded URL passwords", () => {
    const error = captureError(() => parsePublicEnv({
      NEXT_PUBLIC_API_BASE_URL: "https://user:private-password@api.example.com",
      NEXT_PUBLIC_COGNITO_REGION: "private-invalid-region",
      GOOGLE_SOLAR_API_KEY: "private-server-secret",
    }));
    expect(error.issues.map((issue) => issue.field)).toEqual([
      "NEXT_PUBLIC_API_BASE_URL",
      "NEXT_PUBLIC_COGNITO_REGION",
    ]);
    expect(inspect(error, { showHidden: true, depth: null })).not.toContain("private-");
    expect(error).not.toHaveProperty("cause");
  });

  it("redacts unexpected runtime types without retaining arbitrary objects", () => {
    const env = {
      GOOGLE_SOLAR_API_KEY: { value: "private-object-secret" },
    } as unknown as EnvironmentInput;
    const error = captureError(() => parseServerEnv(env));
    expect(error.issues).toEqual([
      { field: "GOOGLE_SOLAR_API_KEY", message: "Invalid configured value." },
    ]);
    expect(inspect(error, { showHidden: true, depth: null })).not.toContain("private-object-secret");
  });
});
