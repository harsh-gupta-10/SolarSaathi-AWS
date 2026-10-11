# Demo and submission runbook

**Pitch:** SolarSaathi helps a homeowner assess rooftop solar, estimate costs
and eligible benefits from current verified rules, follow the application
steps, and explore the remaining roof space.

## Current evidence (2026-10-11)

SolarSaathi is deployed as a development environment on AWS (`ap-south-1`): Amplify
Hosting serves the Next.js app, and the `solarsaathi-dev` CloudFormation stack runs
Cognito, API Gateway, Lambda, DynamoDB and S3. See [live-deployment.md](live-deployment.md)
for the URLs and the verified smoke checks. The repository is public at
`harsh-gupta-10/SolarSaathi-AWS`; GitHub Actions runs `pnpm check`, SAM validation
and SAM build on every push (851 tests at the last audit).

Known limits, stated plainly:

- The official-source policy catalog has not been published through the two-person
  admin workflow yet, so the live app fails closed: it shows "No verified subsidy
  rule is published for your area yet" instead of a number. Subsidy amounts appear
  only in the labelled fixture demo (`/demo/*`), never as live policy.
- Amazon Bedrock refuses every model in this AWS account, so chat runs on an
  OpenAI provider with the key in AWS Secrets Manager. Bedrock stays the default
  and is not removed.
- Google Maps, Geocoding and Solar APIs are external integrations.

Do not present a local fixture as live policy data.

## Choose the presentation mode

| Mode | What can be shown | What to say |
| --- | --- | --- |
| Local fixture | Public `/demo/*` screens, deterministic calculations, UI and test evidence | “This is fictional sample data and locally tested code. Cloud integrations are not demonstrated.” |
| Live integration | An authorized deployed environment with working login, owned property, Google roof data and current published official policy evidence | Name each working service, show its source or operational proof, and disclose any fallback used. |

Start the local fixture walkthrough at `/demo`; follow its final source trail
to `/demo/source-trail`. The detailed fixture routes are `/demo/roof-3d`, `/demo/system-designer`,
`/demo/policy-financial`, `/demo/application-tracker`, `/demo/advisor`,
`/demo/accessories`, `/demo/rooftop-ideas`, `/demo/broker`,
`/demo/international` and `/demo/policy-review`. Their fictional values are
separate from authenticated account records. The fixture-only screens do not
call an official portal, produce a live eligibility decision or prove a cloud
transaction.

For the presentation sequence and feature-specific safety language, use
[demo.md](demo.md). A local run starts with `pnpm install --frozen-lockfile`,
`pnpm check`, then `pnpm dev`; open the fixture route in the browser. See
[commands.md](commands.md) for prerequisites. If the app is already running,
use its existing local URL instead of launching a second server.

## Live evidence gate

Complete these checks against the exact deployed version before calling a step
“live.” Record the environment, timestamp, commit SHA, observed result and
sanitized screenshot or log link. Keep credentials, tokens, exact home
coordinates, addresses and private documents out of submission material.

1. **GitHub:** Confirm the target commit is pushed, its Quality checks run is
   successful, and the submission link can be opened by reviewers. A private
   repository needs an access plan; a working author login alone does not give
   judges access. Preserve genuine commit history.
2. **AWS identity and release:** Use AWS CLI to confirm the intended account and
   region before any deployment action. Review SAM validation, change set,
   retained resources, Cognito Essentials cost, permissions, alarm notification
   targets and Google-data backup retention. A successful build or read-only
   template validation is not a deployment approval.
3. **Authentication and ownership:** Verify Cognito hosted signup/sign-in,
   callback and `GET /v1/me`, then test owner, foreign-owner, broker organization
   and administrator boundaries through the deployed API.
4. **Roof and Google:** Verify an explicitly selected and confirmed building,
   the approximate overlay, current Google Solar response, confirmed roof and
   manual fallback. The one-time device location must only center the map.
   Verify Google API key restrictions and the retention worker plus monitored
   alarm in the deployed environment.
5. **Policy:** Register/curate official sources, observe a successful crawler
   check, review exact archived evidence, publish through independent approval,
   and inspect citation, effective date, version and last check. Only then show
   a numeric *estimated* benefit. A failed, running, stale or unverified source
   must leave the amount unavailable or incomplete. Do not use a proposed source
   or a fixture value as current government policy.
6. **Finance and workflow:** Verify the owned-analysis system recommendation,
   input assumptions, source-cited benefit stacking, adjusted financial
   scenario and application checklist. User-marked tracker progress is not an
   official government application status or submission.
7. **Optional services:** Demonstrate Bedrock only if its configured model is
   invoked and a cited server-composed answer is observed. Demonstrate
   international lookup only when a verified official fetch occurred; label it
   researched with incomplete coverage. Demonstrate generated roof imagery
   only when property-specific provenance and private asset storage are proven.

## Service evidence map

| Service | Repository implementation | Live claim requires |
| --- | --- | --- |
| Amplify Hosting | Next.js build and host intent | Deployed app URL, domain and matching commit |
| Cognito | SAM pool, client, groups and browser auth | Working hosted login, verified token and API binding |
| API Gateway + Lambda | SAM routes and compiled handlers | Deployed endpoint, authorizer and sanitized request proof |
| DynamoDB | Core, policy and design tables in SAM | Owned read/write and conditional workflow proof |
| S3 | Private versioned policy archive and private short-lived design assets | Archived policy object/version and protected design-asset proof without exposing content |
| EventBridge + CloudWatch | Scheduled workers, logs and failure alarms | Observed schedule/run, monitored alarms and retention review |
| Bedrock | Optional advisor card selection | Configured invocation plus deterministic cited response |
| Google Maps/Geocoding/Solar | External adapters and map UI | Restricted keys, observed API call and roof provenance |
| Google Cloud CLI | No selected local project | Named, approved project and scoped read-only validation |

## Claims and limits

Use “estimated,” “may be eligible,” and “within currently verified rules.”
Neither geometry nor a 3D concept approves installation or structural safety.
An area-only roof cannot establish panel count. Financial payback uses explicit
user assumptions, and the policy-backed model treats selected benefits as
upfront for planning even though payment timing is unverified. A source-cited
application checklist does not submit to a government portal. No guaranteed
subsidy, approval, payback, installation or application timeline should appear
in narration or captions.

If live integration fails during the presentation, switch visibly to a fixture
route and say which service was unavailable. Do not splice fixture results into
the authenticated flow or label them AWS-backed. The exact unfinished release
work is tracked in [phases.md](phases.md) and [testing.md](testing.md).
