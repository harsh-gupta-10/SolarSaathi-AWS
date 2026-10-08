# SolarSaathi

SolarSaathi is an India-first rooftop-solar decision platform.

It answers:
1. Is my roof suitable for solar?
2. What system should I install?
3. What is the expected cost, savings and payback?
4. Which central, state, DISCOM and other incentives may apply?
5. Can those benefits legally/officially be combined?
6. What is the application process and what documents do I need?
7. How do I track my subsidy/application?
8. What can I do with rooftop space remaining after solar?
9. Which useful solar accessories should I consider?

## Core product

Address → building selection → Google Solar analysis → roof confirmation → system design → live policy/subsidy engine → financial model → application tracker → AI advisor → remaining-roof-space concepts → installer lead.

## India-first policy intelligence

SolarSaathi maintains versioned policy records sourced primarily from:
- MNRE / Government of India
- PM Surya Ghar official portal
- State energy departments
- State DISCOMs
- Electricity regulators
- MEDA / equivalent state agencies
- official circulars, notifications and guidelines

Current policy values are never treated as permanent constants. A crawler detects source changes, extracts candidate updates, validates them, and sends material changes through an approval workflow.

## AWS stack

- Next.js + TypeScript + Tailwind + shadcn/ui
- AWS Amplify Hosting
- Amazon Cognito
- API Gateway
- AWS Lambda
- DynamoDB
- S3
- EventBridge
- CloudWatch
- Amazon Bedrock
- AWS SAM / CloudFormation
- Google Geocoding API
- Google Solar API

## Documentation map

- `docs/project.md` — complete product specification
- `docs/phases.md` — implementation order
- `docs/policy-intelligence.md` — live policy crawler and policy engine
- `docs/subsidy-stacking.md` — central/state/local subsidy combination logic
- `docs/application-tracker.md` — user checklist and application state
- `docs/accessories.md` — accessory recommendation engine
- `docs/international.md` — non-India fallback
- `docs/data-sources.md` — source registry and authority rules
- `docs/architecture.md` — system architecture
- `docs/database.md` — DynamoDB model
- `docs/api.md` — API contracts
- `docs/ui.md` — UI specification
- `docs/calculations.md` — deterministic calculations
- `docs/security.md` — security requirements
- `docs/testing.md` — testing strategy
- `docs/demo.md` — hackathon demo
- `docs/submission.md` — submission requirements
- `docs/decisions.md` — architectural decisions

## Implementation status

Phases 0–6 have locally implemented source code:
- pnpm workspace, Next.js marketing site, responsive application shell, typed
  packages, quality scripts, GitHub Actions, and compiled Lambda/SAM foundation;
- Cognito hosted sign-in, code+PKCE callback, identity verification, profile and
  role-aware navigation;
- a single-table DynamoDB core model with backend ownership and organization
  checks for users, organizations, customers, properties, leads and analyses;
- property-bound Geocoding and Google Solar Building Insights, explicit building
  and roof confirmation, normalized roof measurements, and manual fallback;
- deterministic roof geometry and panel layout with an interactive 3D viewer,
  top-down fallback, explicit planning assumptions, and a fixture-only demo at
  `/demo/roof-3d`;
- deterministic whole-panel system sizing, modeled inverter and generation
  estimates, an authenticated comparison API, and a fixture-only demo at
  `/demo/system-designer`.

Google-derived preview, analysis and cache records have a 21-day retention
limit and an hourly bounded hard-delete worker with an error alarm. Google roof
bounds are approximate and the 3D view does not certify installation or
structural safety. An area-only manual roof has no panel-count estimate or
recommended system size. The system designer does not claim local interconnection
eligibility, a cost, savings or subsidy.

These phases have **local** lint, typecheck, test and build coverage. No AWS
resources or Google Cloud project have been configured or deployed for this app;
live Cognito, DynamoDB, Google API and hosting behavior remains unverified.
Production release also needs alarm notifications, a review of DynamoDB PITR
backup retention for Google data, credentials in the intended AWS account, and
live deployment checks. The financial and policy engines in later phases remain
scaffolds and do not provide real subsidy figures.

Local application validation uses `pnpm check`. AWS CloudFormation accepted a
read-only template validation, and GitHub Actions is configured to run SAM
validation and build. SAM CLI, cfn-lint and cfn-guard are not installed in this
local environment; template tests and CloudFormation syntax validation do not
prove deployability. See [implementation phases](docs/phases.md) for detailed
status and remaining work.

## Development

Use Node.js 22 LTS (or Node.js 24) and pnpm 10.34.6. Run `corepack enable` if pnpm
is unavailable, or use `corepack pnpm install` to bootstrap it. Then run:

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm dev
```

No cloud credentials are needed for these commands. Integration configuration
is optional in Phase 0; malformed configured values fail validation. See
[development commands](docs/commands.md) and [SAM setup](infra/sam/README.md).

Do not deploy a scaffold and call it complete. Build the product phase-by-phase and keep the README truthful.
