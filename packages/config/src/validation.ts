import { z } from "zod";

export type EnvironmentInput = Record<string, string | undefined>;

export interface EnvironmentIssue {
  readonly field: string;
  readonly message: "Invalid configured value.";
}

export class EnvironmentValidationError extends Error {
  readonly issues: readonly EnvironmentIssue[];

  constructor(fields: readonly string[]) {
    super(`Invalid environment configuration: ${fields.join(", ")}.`);
    this.name = "EnvironmentValidationError";
    this.issues = Object.freeze(
      fields.map((field) =>
        Object.freeze({ field, message: "Invalid configured value." as const }),
      ),
    );
  }
}

export function blankToUndefined(value: unknown): unknown {
  return typeof value === "string" && value.trim() === "" ? undefined : value;
}

// Validate region syntax, not service availability or account access.
export const awsRegionPattern =
  /^(?:af|ap|ca|cn|eu|eusc|il|me|mx|sa|us)-(?:[a-z]+-)+[1-9]\d*$/;

export const awsRegionSchema = z.string().max(64).regex(awsRegionPattern);
export const userPoolIdSchema = z.string().max(55).regex(/^[a-z0-9-]+_[A-Za-z0-9]+$/)
  .refine(value => awsRegionPattern.test(value.split("_")[0] ?? ""));
export const cognitoClientIdSchema = z.string().regex(/^[A-Za-z0-9_+]{1,128}$/);

export function optionalValue<T extends z.ZodType>(schema: T) {
  return z.preprocess(blankToUndefined, schema.optional());
}

export function parseEnvironment<T extends z.ZodType>(
  schema: T,
  env: EnvironmentInput,
  fields: readonly string[],
): z.output<T> {
  const selected = Object.fromEntries(fields.map((field) => [field, env[field]]));
  const result = schema.safeParse(selected);

  if (!result.success) {
    // Never retain the Zod error, input values, or arbitrary input field names.
    const invalidFields = fields.filter((field) =>
      result.error.issues.some((issue) => issue.path[0] === field),
    );
    throw new EnvironmentValidationError(invalidFields);
  }

  return result.data;
}
