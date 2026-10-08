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

Status: local implementation verified. A pure versioned calculator compares
whole-panel 1/2/3/5/7.5/10 kW candidates against the same roof-fit assumptions
used by the 3D viewer. It reports actual DC capacity, minimum modeled inverter
AC capacity, labelled Google-derived or assumed annual generation, demand
coverage, decision reasons and review warnings. The authenticated API loads an
owned, unexpired confirmed roof; browser-supplied roof geometry is rejected.
The comparison UI and a synthetic offline demo are responsive. Lint, typecheck,
537 tests and production builds pass; desktop/mobile browser checks found no
WCAG A/AA violations. Google panel specifications have conservative modeling
guards. This is a planning recommendation, not local DISCOM eligibility,
structural approval, a price or a subsidy. Deployed API and live data remain
unverified until the earlier cloud dependencies are configured.

## Phase 7 — Base financial engine
- gross cost
- generation
- savings
- degradation
- tariff escalation
- payback
- 25-year cash flow
- sensitivity

Status: local implementation verified. The authenticated estimate endpoint
recomputes a roof-fitting Phase 6 candidate from the owned, unexpired analysis
and requires user-entered gross quote, avoidable import rate, self-use share,
export-rate scenario and maintenance. A pure versioned calculator separates
self-used and surplus energy, caps self-use by annual demand, applies explicit
degradation and escalation assumptions, and returns 25 annual rows, interpolated
payback or no payback, and one-variable low/base/high sensitivity. The UI shows
the unsubsidized cash flow, a chart, annual table and caveats; its demo values
are explicitly synthetic. Lint, typecheck, 559 tests and production builds pass
locally. Desktop/mobile browser checks found no WCAG A/AA violations; the chart
label color also passed a manual contrast ratio check. Export settlement,
policy benefits, financing and equipment replacement are not modeled or
verified. The API and cloud resources remain undeployed, so live behavior is
unverified.

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

Status: local foundation implemented. A typed policy package validates source,
document, chunk, citation, fact and version records; six verified official
source locations are starter discovery intents with `PROPOSED`/disabled status,
not active policy facts. Source authority and a conservative verified display
gate prevent a lower-authority or stale source from silently replacing current
evidence. HTML/PDF ingestion is bounded, extracts normalized text and cited
page/section chunks, hashes raw and derived content, and rejects encrypted or
malformed PDFs. Admin-only routes register exact official-host sources and
archive supplied document bytes in a private, versioned S3 bucket with
conditional DynamoDB metadata. A source can contain multiple document URL
series. No automatic crawl, policy fact extraction, approval, live benefit or
subsidy amount is available yet. Lint, typecheck, 589 tests, production builds,
SAM template tests and read-only CloudFormation template validation passed
locally. No policy resources have been deployed, so live IAM/Cognito/S3/DynamoDB
behavior remains unverified.

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

Status: local crawler and evidence-review workflow verified; **live India
coverage remains open**. A 15-minute EventBridge Lambda checks bounded,
curated official canonical URLs through an HTTPS, exact-host, DNS-pinned,
robots-aware fetcher. It keeps raw and normalized hashes, separates cosmetic
changes from review-worthy text changes, archives immutable PDF/HTML evidence,
extracts cited unverified quotations, and queues both candidate and
document-level changes (including zero-quotation changes). A bounded lookup
against previously approved evidence flags tentative cross-source differences;
no verified policy fact is inferred from that comparison. Administrators see
source freshness/failure, before/after text excerpts, conflict status and a
mixed paginated queue. Independent reviewer decisions are revision-checked
and audited; approval does not publish a benefit rule. Rate limits, redirect
identity, crawl leases/replay and failures have focused tests. The PDF parser
also passes a cold-start and PDF extraction smoke test from the bundled Lambda
artifact. Full lint, typecheck, 633 tests, production builds, SAM template
tests, read-only CloudFormation validation and desktop/mobile browser checks
pass locally; browser checks found no WCAG A/AA violations.

The crawler monitors only explicitly registered URLs. Linked official
circular/PDF discovery and broader India source registration remain open.
No policy resources have been deployed, so live official fetches, Cognito/IAM,
S3/DynamoDB, CloudWatch alarms and production coverage are unverified. There
is no deployed active verified benefit/rule publication path. Phase 10 adds
the local publication and evaluation path; live policy data remains open.

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

Status: locally implemented; **live verified India rule coverage remains
open**. The typed deterministic engine evaluates central, state, DISCOM, local
and other rules against declared applicant, property, geography, capacity and
timing facts. Missing facts remain unknown. Fixed, per-kW, tiered and
percentage-of-policy-eligible-cost formulas use bounded integer paise, with
explicit individual and combined caps. The exact search checks reciprocal
compatibility, overlap and exclusions for at most 16 relevant rules and
returns stable selected/ineligible/unknown/excluded reasons. The API scopes
active-rule retrieval by jurisdiction and returns unavailable without an
amount if its safe search bound or a DynamoDB page boundary is reached.

A separate admin publication workflow binds every numeric value, effective
period, eligibility clause and compatibility edge to exact excerpts in a
current immutable official archive. The author submits a draft; a different
administrator from the author and source curator reviews it. Conditional
DynamoDB transactions write verified facts, an immutable policy version,
active pointer, activation event and audit. Cross-source replacement applies
current official-source precedence and records its reason; unresolved
equal-authority conflicts fail closed for manual resolution. Evidence-review
approval alone never publishes a benefit. The homeowner API reloads the owned
roof and recomputes the selected system. It labels applicant facts as
self-reported, displays citations, policy versions, effective dates, source
last-check status and incomplete scope coverage. The Phase 7 financial result
remains unsubsidized; integration is Phase 11.

No policy stack has been deployed or populated with verified live India benefit
records. The local crawler still monitors explicitly registered URLs and does
not provide broad source coverage. Source conflicts that lack a deterministic
precedence resolution require separate human investigation; there is no
in-product conflict-resolution record yet. Installed-capacity rules using a
basis other than modeled DC watts must not be published until that basis is
represented and verified. Rule authoring currently requires precise archive
offsets and typed JSON in the admin UI. Live AWS IAM, Cognito, DynamoDB, S3,
API Gateway and source-crawl behavior remain unverified.

The local Phase 10 gate passed 662 tests, lint, typechecking, production builds,
SAM invariant checks and read-only CloudFormation template validation. The
benefit and admin demo screens passed inspected desktop/mobile accessibility
checks with no WCAG A/AA violations.

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

Status: locally implemented. The authenticated policy-backed estimate reloads
the owned confirmed roof, recomputes a fitting system and Phase 7 base, and
evaluates current Phase 10 active verified rules for the same system. The
response always retains the unsubsidized base. When a positive selected
central, state, DISCOM or local benefit exists, a pure integer-paise engine
shows gross quote, selected amounts by scope, total benefits, modeled upfront
reduction, net cost, 25-year cash flow, payback and policy/source/version
provenance. Unknown eligibility and unverified scope coverage are marked
partial. Policy outages, no current rules and no upfront-modelable benefit
leave the adjusted scenario unavailable without erasing the base.

The adjusted cash flow assumes selected cash incentives arrive upfront. Current
policy facts do not verify disbursement timing, so this is an illustrative
scenario, not a forecast of cash required at installation or a guaranteed
payment date. Selected `OTHER` benefits can represent tax, financing or
regulatory value; they remain disclosed but do not reduce modeled upfront
cost or payback. Benefits above the quote cannot create negative net cost.
The financial browser screen and synthetic demo preserve source citations and
keep the Phase 7 baseline visible. No active India policy corpus or cloud
stack is deployed, so live benefit amounts and authorization are unverified.
The local gate passed 692 tests, lint, typechecking, production builds, SAM
invariant checks and browser inspection of the synthetic policy financial demo.

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
