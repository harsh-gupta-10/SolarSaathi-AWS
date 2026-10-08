# @solarsaathi/config

Phase 0 environment validation. Import `parsePublicEnv` from
`@solarsaathi/config/public` in browser-safe code, and `parseServerEnv` from
`@solarsaathi/config/server` only in backend code. There is no combined entry point.
Exports reference TypeScript sources with extensionless internal module imports
for workspace bundlers, including Next.js webpack.

Both functions accept an explicit `Record<string, string | undefined>`, return
inferred typed values with their original environment variable names, and never
capture `process.env` or log configuration. Only allowlisted fields are read or
returned. The public entry point does not import server configuration.

All integrations and table names are optional, including Cognito. No credential
or table is required to start Phase 0. Blank and whitespace-only values become
`undefined`; blank defaulted fields use their defaults. Nonblank values are not
trimmed or rewritten.

Server defaults: `ENVIRONMENT=dev`, `AWS_REGION=ap-south-1`, `LOG_LEVEL=info`.
Optional `COGNITO_USER_POOL_ID`, `COGNITO_CLIENT_ID` and `COGNITO_REGION` bind
backend identity checks to the intended pool/client. A specified Cognito region
must match the pool prefix; it need not match the Lambda region. Missing/partial
settings still allow public health to start, but the identity endpoint fails
closed rather than inventing an identity.
Environment values are `dev`, `test`, `prod`; log levels are `debug`, `info`,
`warn`, `error`. Optional `BEDROCK_REGION` is separate from `AWS_REGION`.

API URLs must be absolute HTTPS URLs, except HTTP URLs to `localhost`,
`127.0.0.1`, or `[::1]` for local development. Embedded URL credentials are
rejected. Configured Cognito pool IDs and regions must agree when both are set;
partial Cognito configuration remains valid but does not enable authentication.
The Cognito domain is a host-only FQDN. Sign-in/sign-out redirects must use the
exact `/auth/callback` and `/auth/sign-in` paths, omit query/fragment data, and
share an origin. The frontend additionally checks the current browser origin.
`NEXT_PUBLIC_COGNITO_GOOGLE_ENABLED` is an optional `true`/`false` string, never a
provider secret. AWS regions are syntax-checked,
not verified for service availability or account access. Table names use
DynamoDB naming constraints (3–255 letters, digits, underscores, dots, hyphens).
`API_ALLOWED_ORIGIN` is an optional canonical HTTPS origin (HTTP loopback is
allowed for development), with no path, query, credentials or wildcard. Lambda
responses use that configured origin rather than reflecting a caller's Origin.
Keys and model IDs are format-checked, not authenticated against live services.

Invalid input throws `EnvironmentValidationError`, with only known field names
and fixed issue messages. Raw Zod errors, submitted values and causes are not
retained. Do not log successful server output, which intentionally contains
configured secrets.

Scripts: `build` and `typecheck` run `tsc --noEmit`; `lint` runs `eslint .`;
`test` runs `vitest run`. TypeScript, Vitest, ESLint, typescript-eslint, and Node
types are supplied by the workspace root. Zod is the package runtime dependency.
