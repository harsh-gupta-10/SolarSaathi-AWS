# SolarSaathi — Implementation Phases

Build in this order. Do not skip foundational validation.

## Phase 0 — Repository and AWS foundation
- pnpm workspace
- Next.js app
- Lambda/API skeleton
- shared types
- calculations package
- SAM
- environment validation
- CI-quality scripts
- CloudWatch logging

Exit: clean install/typecheck/lint/build.

Current status: the Phase 0 application foundation and quality scripts are
implemented. The local page is explicitly a development scaffold; no cloud
resources have been deployed. SAM YAML/artifact checks are available locally,
while CloudFormation schema validation is configured in CI and local
SAM/cfn-lint tooling remains unavailable. Local infrastructure checks are not
an approval to deploy.

## Phase 1 — Marketing site + application shell
- `solarsaathi.in`
- `app.solarsaathi.in`
- landing page
- address input
- responsive app shell
- homeowner/broker role-aware navigation

Status: local implementation verified. Landing page, tab-only address drafts,
accessible mobile navigation, role-preview menus and planned-feature screens
are implemented. Production host routing is ready for the two specified domains;
domain ownership, DNS and Amplify hosting have not been configured or deployed.
Phase 1 passes lint, typecheck, 149 tests, production build and browser checks.
Navigation preview does not grant account permissions.

## Phase 2 — Cognito
- sign-up/sign-in
- Google federation
- user profile
- role
- organization

Status: local implementation verified; **live integration blocked**. Hosted
Cognito sign-in/account creation, code+PKCE callback handling, optional Google,
identity/profile display, group-derived navigation and read-only organization
context are implemented. The backend `GET /v1/me` verifies JWT/app-client binding
and current Cognito identity; account settings can test that API connection.
`pnpm auth:check` performs repeatable, read-only configuration readiness checks. SAM contains the pool, public client, managed-login
branding, groups and conditional Google provider. Local quality checks pass,
but signup/signin/Google and deployed API authorization have not been verified.
No pool/client/domain is configured for this app, and cloud-change approval was
not received. Live Phase 2 integration remains open until an authorized setup
passes live checks; do not treat mocked tests as live authentication proof.
Local source implementation may continue sequentially after the Phase 2 code
quality gates pass. Cloud deployment and production release remain blocked on
the separate live authentication/schema/permissions checks.

## Phase 3 — DynamoDB core model
Implement:
- USER
- ORGANIZATION
- CUSTOMER
- PROPERTY
- SOLAR_ANALYSIS
- LEAD
- SOLAR_CACHE

Status: local implementation verified. The typed single-table repository now
stores users, organizations, customers, properties, solar-analysis metadata,
leads and property-scoped solar cache records. Authenticated core routes enforce
ownership and organization membership in backend code. SAM wires the core
Lambda, two property-list indexes, TTL, scoped DynamoDB permissions and retained
table storage. Lint, typecheck, tests and production builds pass locally.
No table or routes have been deployed; live DynamoDB, Cognito authorization and
CloudFormation schema validation remain unverified.

## Phase 4 — Roof analysis
- Google Geocoding
- satellite map
- building selection
- building confirmation
- Google Solar buildingInsights
- roof measurement confirmation
- normalized roof model

Fallback:
- manual roof input if exact building analysis is unavailable.

Status: local implementation verified. The authenticated flow geocodes the
saved property address, lets the user select and explicitly confirm a building,
fetches Google Solar Building Insights through a backend API, and requires a
second confirmation before saving normalized roof measurements. A manual roof
path works when Google coverage or configuration is unavailable. Backend
ownership checks, bounded Google requests, preview expiry, input validation,
and account-safe UI state are tested. Lint, typecheck, tests, and production
build pass locally. Live Google calls and deployed API behavior remain
unverified because keys, project selection, and AWS deployment are not set up.
Google-derived records have a 21-day limit and an hourly hard-delete worker;
alarm notification routing and PITR backup retention still need review before
a production launch.

## Phase 5 — Deterministic 3D
- roof geometry
- solar panel layout
- panel count
- clearances
- interactive viewer
- no AI dependency for geometry

Status: local implementation verified. A pure, versioned layout calculation
uses explicit panel, setback, gap, service-path and pitch assumptions. It
filters Google panel suggestions against approximate modeled bounds, computes
conservative rectangular manual layouts, and returns no fit count for an
area-only entry. The confirmed roof renders in an interactive 3D viewer with
a plan/text fallback; a synthetic demo at `/demo/roof-3d` can be inspected
without live credentials. Lint, typecheck, tests and production build pass
locally. Clearance values are modeling assumptions, not verified code or
structural approval. Live integration remains dependent on Phase 2–4 cloud
configuration.

## Phase 6 — System designer
- 1/2/3/5+ kW candidate systems
- roof constraints
- consumption/bill
- panel wattage
- inverter
- generation assumptions
- recommendation explanation

## Phase 7 — Base financial engine
- gross cost
- generation
- savings
- degradation
- tariff escalation
- payback
- 25-year cash flow
- sensitivity

## Phase 8 — Policy Intelligence foundation
Create:
- source registry
- policy schema
- policy versioning
- source authority ranking
- document ingestion
- HTML parser
- PDF parser
- content hashes
- policy chunks
- source citations

## Phase 9 — Live India policy crawler
- EventBridge scheduled jobs
- Lambda fetchers
- official source monitoring
- change detection
- extraction
- normalization
- conflict detection
- admin approval queue
- audit log

Priority sources:
- MNRE
- PM Surya Ghar
- Maharashtra Energy Department
- MSEDCL
- state energy departments
- DISCOMs
- electricity regulators
- official state renewable agencies

## Phase 10 — Subsidy stacking / eligibility engine
Implement:
- central benefits
- state benefits
- DISCOM benefits
- local/municipal benefits
- other incentives
- caps
- minimum/maximum system size
- beneficiary rules
- property rules
- installation timing
- scheme compatibility
- mutually exclusive rules
- precedence
- stacking optimizer

Output:
- eligible benefits
- ineligible benefits + reason
- total eligible benefit
- source for every benefit
- policy version
- confidence/verification status

## Phase 11 — Policy-backed financial engine
Replace hardcoded subsidy assumptions with policy engine output.

Financial result must show:
- gross
- central
- state
- local/other
- total eligible
- net
- payback
- source/version

## Phase 12 — Application / subsidy tracker
- policy-specific checklist
- user-created application
- step states
- timestamps
- notes
- documents metadata
- vendor
- application reference
- expected next step
- user chat updates
- reminders/notifications where supported

## Phase 13 — AI Solar + Policy Advisor
Grounding:
- property
- solar analysis
- financial calculations
- policy records
- application state
- source citations

AI can explain, summarize and guide. It cannot change deterministic facts.

## Phase 14 — Accessory advisor
- accessory catalog
- compatibility rules
- necessity/optional classification
- cost ranges
- recommendation score
- safety notes
- policy relevance

No pay-to-rank logic in MVP.

## Phase 15 — Rooftop remaining-space advisor
- calculate remaining modeled usable area
- deterministic feasibility
- design candidates
- normalized fingerprints
- template lookup
- Bedrock image generation adapter
- S3 assets
- DynamoDB metadata
- 3D fallback

## Phase 16 — Broker workspace
- customers
- properties
- analyses
- policy-backed proposals
- leads
- application tracking
- reusable designs

## Phase 17 — International fallback
- country detection
- jurisdiction discovery
- live authoritative search
- temporary cache
- explicit "live researched" status
- no false global coverage

## Phase 18 — Admin policy console
- sources
- crawler runs
- changes
- conflicts
- approval
- versions
- rollback
- stale-source warnings

## Phase 19 — Testing and hardening
- unit tests
- integration tests
- policy fixtures
- stacking edge cases
- stale policy tests
- crawler tests
- application state machine tests
- auth tests
- security tests
- failure-mode UI

## Phase 20 — Demo and submission
Demo should show:
address → building → roof → solar → live subsidy stacking → net cost → application checklist → AI → remaining roof concept → accessories → source trail.

No fake "live" policy data in demo. If live services are unavailable, clearly use a labelled demo fixture.
