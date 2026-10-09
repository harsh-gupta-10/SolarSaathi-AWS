# Commands

## Prerequisites
Node.js 22 LTS (or 24) and pnpm 10.34.6, pinned in the root manifest.
If pnpm is missing, run `corepack enable` or use `corepack pnpm` for bootstrap.
Use pnpm only; the committed lockfile is `pnpm-lock.yaml`.

## Install
`pnpm install --frozen-lockfile`

## Complete local quality check
`pnpm check`

This runs lint, typecheck, tests and production builds in that order. It requires
no AWS, Google or Bedrock credentials. The same checks run in GitHub Actions.

## Development
`pnpm dev`

## Lint
`pnpm lint`

## Typecheck
`pnpm typecheck`

## Test
`pnpm test`

## Build
`pnpm build`

## AWS SAM
Requires AWS SAM CLI and cfn-lint for `pnpm sam:validate`.

- `pnpm sam:validate` — local template schema validation, no deployment
- `pnpm sam:build` — bundle API handlers, then assemble SAM artifacts
- `pnpm sam:local` — start the built backend; requires Docker
- `pnpm sam:deploy` — deploy the built template with a guided prompt; requires
  an explicitly chosen AWS account, region, stack and credentials

Do not deploy until infrastructure validation, authorization and environment
configuration appropriate to the target deployment have been reviewed.
See [SAM resource intent and limitations](../infra/sam/README.md).

## Amplify Hosting

The repository-root `amplify.yml` builds the `apps/web` Next.js app from the
pnpm workspace root. Configure the Amplify app as `WEB_COMPUTE`, connect the
repository, select the `main` branch, and set
`AMPLIFY_MONOREPO_APP_ROOT=apps/web`. The root `.npmrc` enables pnpm's hoisted
linker for Amplify's monorepo build image. Set the public variables listed below
on the Amplify branch before triggering its build; Next.js embeds
`NEXT_PUBLIC_*` values during that build. Use the exact Amplify branch origin
for SAM's `ApplicationOrigin` and Cognito redirect URLs.

## Environment
For Next.js, copy only the `NEXT_PUBLIC_*` Web section of `.env.example` into
`apps/web/.env.local`. The root `.env.local` is not automatically loaded by Next
when the app is run from its workspace package.

For Lambda, configure server variables through SAM/Lambda configuration. SAM
local uses an `--env-vars` JSON file; do not assume it reads dotenv files.
`AWS_REGION` is supplied by Lambda and should not be set as a Lambda environment
variable in a template.

Optional blank variables are ignored in Phase 0. Public and server settings are
validated through separate `@solarsaathi/config/public` and
`@solarsaathi/config/server` entry points. Never commit secrets.

## Cognito configuration

Set these public values in `apps/web/.env.local` (or Amplify Hosting build
configuration), then rebuild:
- `NEXT_PUBLIC_COGNITO_USER_POOL_ID`
- `NEXT_PUBLIC_COGNITO_CLIENT_ID` — a public client without a secret
- `NEXT_PUBLIC_COGNITO_REGION`
- `NEXT_PUBLIC_COGNITO_DOMAIN` — hostname only
- `NEXT_PUBLIC_COGNITO_REDIRECT_SIGN_IN` — exact `/auth/callback` URL
- `NEXT_PUBLIC_COGNITO_REDIRECT_SIGN_OUT` — exact `/auth/sign-in` URL
- `NEXT_PUBLIC_COGNITO_GOOGLE_ENABLED` — `true` only after federation is configured

Redirect origins must match the deployment's browser origin. A missing/partial
setup keeps sign-in unavailable; it does not simulate a session. Cognito hosted
pages handle account creation, verification, recovery and MFA.

The SAM template requires an explicitly chosen `CognitoDomainPrefix` and
`ApplicationOrigin`. Before deployment confirm the account, region, permissions,
Cognito Essentials costs, retained identity data and validation. Google federation
additionally needs an OAuth web client and a Secrets Manager secret containing
`clientSecret`; register `https://<cognito-domain>/oauth2/idpresponse` with Google.
Never place that secret in a `NEXT_PUBLIC_*` field.

New users display as homeowners unless an authorized administrator assigns the
`BROKER` Cognito group and organization metadata. Organization/profile persistence
and server-side ownership checks are Phase 3, not client role-picker features.

## Read-only Cognito readiness

`pnpm auth:check` builds a local CLI and reads the public configuration from
`apps/web/.env.local` (if present) plus the process environment. It uses only AWS
STS identity and Cognito describe/list commands. It never creates, updates or
deletes resources, retrieves provider secrets, or displays raw account/client
identifiers or CLI errors.

The checker validates pool/client binding, code flow, exact callback/logout URLs,
scopes, short-lived tokens, rotation/revocation, read-only organization attributes,
active managed-login domain/branding, broker group and optional Google provider.
Missing/unsafe configuration or insufficient read permissions produce exit code
`2`; metadata readiness produces `0`. A ready result is **not** proof of a working
sign-in, Google redirect or deployed API authorization. Those live tests remain
required. No configured Cognito fields means no AWS metadata calls are made.

For the Lambda identity endpoint, set `COGNITO_USER_POOL_ID`, `COGNITO_CLIENT_ID`
and optional `COGNITO_REGION`; SAM supplies these from its pool/client resources.
The pool region can differ from Lambda's `AWS_REGION`, but a specified Cognito
region must match the pool prefix. After sign-in and API configuration, account
settings offer **Verify API connection**, which sends only the access token to
`GET /v1/me`, without SDK cookies or redirects. It verifies the returned identity,
not database ownership or organization membership.

## Before commit
Run:
- lint
- typecheck
- tests
- build

Do not create fake historical Git commits. Hackathon repository history must honestly reflect development.
