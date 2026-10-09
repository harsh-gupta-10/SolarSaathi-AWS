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
- `docs/advisor.md` — grounded advisor and fact boundary
- `docs/rooftop-designs.md` — deterministic remaining-space concepts and reuse
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

Phases 0–14 have locally implemented source code:
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
  `/demo/system-designer`;
- an unsubsidized 25-year base financial model with user-entered quote and
  energy rates, separate self-use and export values, annual cash flow, payback,
  sensitivity and an authenticated estimate API;
- a policy evidence foundation with a reviewed official-host registry,
  versioned source/document/fact schemas, conservative precedence, bounded
  HTML/PDF extraction, citations, and admin-only private evidence ingestion;
- an official-source crawler with bounded scheduled fetches, change detection,
  tentative conflict signals, a mixed evidence/document-change review queue,
  independent administrator review, immutable audit, and a policy review UI
  with a synthetic preview at `/demo/policy-review`;
- a deterministic benefit engine with tri-state eligibility, cited numeric and
  clause evidence, compatibility/overlap/caps, an exact bounded optimizer,
  owner-scoped evaluation API, and separate administrator rule publication.
- a policy-backed financial scenario that recomputes the owned roof and base
  estimate, then presents current selected benefits, modeled net upfront cost,
  adjusted cash flow and payback with cited policy provenance;
- an application tracker with policy-specific, exact-excerpt-backed process
  steps, audited user reported progress, references and document notes. A
  deterministic conversation update can suggest a status but requires an
  explicit save. A fictional visual preview is at `/demo/application-tracker`;
- an optional one-click device-location marker on the satellite map, separate
  house selection, and an approximate Google Solar building bounds overlay
  after a house is selected. The device location is never stored or used as
  automatic building confirmation;
- a read-only, owner-scoped advisor that explains confirmed roofs, optional
  deterministic financial/policy scenarios and user reported application
  progress through provenance-labelled fact cards. Optional Bedrock selection
  can organize those cards; the server writes the final sourced answer and
  falls back without a model. A fictional visual preview is at `/demo/advisor`;
- a deterministic accessory review tied to an owned roof-fitting system and
  declared backup, EV, monitoring and maintenance goals. It shows category,
  relevance, compatibility and safety review, with no invented market price,
  policy mandate or paid ranking. A fictional preview is at
  `/demo/accessories`.

Google-derived preview, analysis and cache records have a 21-day retention
limit and an hourly bounded hard-delete worker with an error alarm. Google roof
bounds are approximate and the 3D view does not certify installation or
structural safety. An area-only manual roof has no panel-count estimate or
recommended system size. The system designer does not claim local interconnection
eligibility, a cost, savings or subsidy. The base financial model requires
explicit user inputs and does not establish policy benefits or export credits.
The policy evidence archive has no active government benefit facts yet.
Crawler review approval does not publish a rule or calculate a subsidy.
Phase 10's publication workflow requires a separate reviewer and exact current
official archive excerpts for every numeric value and rule clause. The
homeowner benefit view labels applicant facts self-reported, leaves incomplete
coverage visible, and never uses an unknown rule to increase the total.
Phase 11 retains the unsubsidized base estimate when policy is unavailable.
Its adjusted scenario assumes selected central/state/DISCOM/local benefits are
received upfront; actual payment timing is unverified. Selected other benefits
remain disclosed but do not reduce the modeled net cost or payback.
The application tracker requires a selected benefit with a current sourced
process template; it does not submit to or read status from a government
portal. User recorded completion is not official approval, and no notification
service or official processing deadline is configured.
The advisor cannot establish eligibility, official progress, savings or
structural safety. Without a verified policy corpus or user-entered scenario,
it gives a limited roof explanation and identifies missing context. No Bedrock
model is configured or exercised live.
Accessory policy relevance and cost ranges remain unavailable until verified
rule evidence and sourced regional prices exist. The accessory list is a
planning discussion for a qualified installer, not equipment specification.

These phases have **local** lint, typecheck, test and build coverage. No AWS
resources or Google Cloud project have been configured or deployed for this app;
live Cognito, DynamoDB, Google API and hosting behavior remains unverified.
Production release also needs alarm notifications, a review of DynamoDB PITR
backup retention for Google data, credentials in the intended AWS account, and
live deployment checks. The policy engine has no live India benefit data and
provides no real subsidy figure in the local preview. The local
crawler monitors registered URLs; automatic discovery of linked official
documents and live India source coverage remain open.

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
