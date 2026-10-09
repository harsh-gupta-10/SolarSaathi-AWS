import { z } from "zod";
import {
  awsRegionSchema,
  userPoolIdSchema,
  cognitoClientIdSchema,
  blankToUndefined,
  optionalValue,
  parseEnvironment,
  type EnvironmentInput,
} from "./validation";

export {
  EnvironmentValidationError,
  type EnvironmentInput,
  type EnvironmentIssue,
} from "./validation";

const googleKeySchema = z.string().regex(/^[A-Za-z0-9_-]+$/);
const tableNameSchema = z.string().min(3).max(255).regex(/^[A-Za-z0-9_.-]+$/);
const bucketNameSchema = z.string().min(3).max(63).regex(/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/);

const serverEnvironmentSchema = z.object({
  ENVIRONMENT: z.preprocess(
    blankToUndefined,
    z.enum(["dev", "test", "prod"]).default("dev"),
  ),
  AWS_REGION: z.preprocess(
    blankToUndefined,
    awsRegionSchema.default("ap-south-1"),
  ),
  LOG_LEVEL: z.preprocess(
    blankToUndefined,
    z.enum(["debug", "info", "warn", "error"]).default("info"),
  ),
  API_ALLOWED_ORIGIN: optionalValue(z.string().max(2048).refine(value => {
    try {
      const url = new URL(value);
      return url.origin === value && !url.username && !url.password &&
        (url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)));
    } catch { return false; }
  })),
  COGNITO_USER_POOL_ID: optionalValue(userPoolIdSchema),
  COGNITO_CLIENT_ID: optionalValue(cognitoClientIdSchema),
  COGNITO_REGION: optionalValue(awsRegionSchema),
  GOOGLE_GEOCODING_API_KEY: optionalValue(googleKeySchema),
  GOOGLE_SOLAR_API_KEY: optionalValue(googleKeySchema),
  BEDROCK_MODEL_ID: optionalValue(z.string().min(1).max(2048).regex(/^\S+$/)),
  BEDROCK_REGION: optionalValue(awsRegionSchema),
  DESIGN_ASSET_BUCKET: optionalValue(bucketNameSchema),
  DESIGN_IMAGE_MODEL_ID: optionalValue(z.string().regex(/^amazon\.nova-canvas-v\d+:\d+$/)),
  DESIGN_IMAGE_REGION: optionalValue(awsRegionSchema),
  CORE_TABLE_NAME: optionalValue(tableNameSchema),
  USERS_TABLE_NAME: optionalValue(tableNameSchema),
  ORGS_TABLE_NAME: optionalValue(tableNameSchema),
  CUSTOMERS_TABLE_NAME: optionalValue(tableNameSchema),
  PROPERTIES_TABLE_NAME: optionalValue(tableNameSchema),
  ANALYSES_TABLE_NAME: optionalValue(tableNameSchema),
  LEADS_TABLE_NAME: optionalValue(tableNameSchema),
  SOLAR_CACHE_TABLE_NAME: optionalValue(tableNameSchema),
}).superRefine((env, ctx) => {
  if (env.COGNITO_USER_POOL_ID && env.COGNITO_REGION && env.COGNITO_USER_POOL_ID.split("_")[0] !== env.COGNITO_REGION) {
    ctx.addIssue({ code: "custom", path: ["COGNITO_REGION"], message: "Pool and region must match." });
  }
});

export type ServerEnv = z.output<typeof serverEnvironmentSchema>;

export function parseServerEnv(env: EnvironmentInput): ServerEnv {
  return parseEnvironment(
    serverEnvironmentSchema,
    env,
    Object.keys(serverEnvironmentSchema.shape),
  );
}
