# Development deployment — 9 October 2026

This is the first live **development** environment. It is not a production
launch or a verified India subsidy catalog.

## Targets

| Service | Development target |
| --- | --- |
| AWS | Account `944311261347`, `ap-south-1` |
| CloudFormation | `solarsaathi-dev` (`CREATE_COMPLETE`) |
| Amplify Hosting | App `d12c230dem2g5h`, `main`, `WEB_COMPUTE` |
| Website | `https://main.d12c230dem2g5h.amplifyapp.com` |
| API | `https://ii1kh7hhb8.execute-api.ap-south-1.amazonaws.com/v1` |
| Google Cloud | `solarsaathi-india-20261009` (billing enabled) |

The Google project has Maps JavaScript, Geocoding, Solar and API Keys APIs
enabled. Its browser Maps key is restricted to the development Amplify origin
and Maps JavaScript API. Separate Geocoding and Solar keys are restricted to
their respective APIs and stored as JSON `apiKey` values in AWS Secrets Manager
under `solarsaathi/dev/google-geocoding` and `solarsaathi/dev/google-solar`.
The server keys have no source-IP restriction because this Lambda stack has no
fixed egress IP; they must never be exposed to the browser or logs.

The Amplify branch holds only `NEXT_PUBLIC_*` values and
`AMPLIFY_MONOREPO_APP_ROOT=apps/web`. SAM's `ApplicationOrigin`, Cognito
callbacks and CORS match the exact Amplify URL. Google sign-in federation and
optional Bedrock models remain disabled, with deterministic fallbacks in the
application.

## Verified

- The repository's `pnpm check`, SAM validation/build, and GitHub quality
  workflow passed for the deployed template and hosting configuration.
- CloudFormation completed the development stack. The initial attempt exposed
  this account's ten-execution Lambda concurrency quota; the crawler now uses
  its lease without reserved concurrency by default.
- `GET /v1/health` returned HTTP 200 with the `dev` environment, and an
  unauthenticated `GET /v1/me` returned HTTP 401 with the configured CORS origin.
- The read-only Cognito readiness checker passed pool, public client, callback,
  managed-login, token and broker-group checks. Interactive sign-up and an
  authenticated API request still require a real test account.
- Direct Geocoding and Solar API calls with their respective server keys both
  returned HTTP 200 for a test location. No key value or provider response was
  stored in this repository.
- Amplify's initial `main` build, deploy and verify steps succeeded. The hosted
  homepage, Cognito sign-in form, and the 3D roof and plan views loaded in a
  browser. The one-click device location and selected-house overlay require an
  authenticated account for a live end-to-end check; the browser state tests
  cover permission denial, stale responses and selected bounds.

## Operational limits before production

- The chat assistant cannot answer: Bedrock refuses every model in this account
  (`authorizationStatus: NOT_AUTHORIZED` as of 11 October 2026). Chat is planned to use GPT-6.1 Sol on Bedrock (see "Switching chat to GPT-6.1 Sol"; every Bedrock model, including Amazon Nova, is currently refused with "Operation not allowed", so the account itself needs fixing first); earlier Sonnet 5.5 owner steps and the redeploy command are in
  `docs/chat-assistant-plan.md` ("Chat model: Sonnet 5.5 and enabling access").
- The official-source policy catalog has not been populated or independently
  approved. Do not display live subsidy amounts until that workflow is complete.
- CloudWatch alarms exist, but notification destinations and API Gateway access
  logs need an operational review. Review the Google-derived data retention and
  DynamoDB point-in-time recovery behavior against production requirements.
- This initial stack was created using the AWS root CLI session. Configure a
  scoped deployment identity for routine changes.
- The account has an AWS monthly budget with alerts; budgets do not stop spend.
  Review Cognito Essentials, DynamoDB/PITR, Amplify compute and Google Maps/Solar
  usage before inviting users.
- No custom domain is connected. Add DNS and update Google referrer restrictions,
  SAM `ApplicationOrigin`, Cognito redirects and Amplify branch variables
  together when adopting one.
