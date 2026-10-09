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

Status: locally implemented. A homeowner starts a tracker only from a
currently selected, positive, verified benefit for an owned confirmed roof.
The active policy rule must include a process template: each ordered step is
separately bound to an exact archived official excerpt and approved through
the independent publication gate. No generic or AI-invented checklist is
shown when process evidence is absent. Creation requires fresh healthy source
checks and condition-checks the active policy version. The application freezes
its cited process snapshot while progress remains clearly user reported.
Property-scoped list/detail, revision-checked step transitions, timestamped
notes, reference/vendor details, document metadata and immutable audit events
are implemented. The conversation style update suggests a status only for
explicit wording and always requires a separate confirmation; it stores no
message. The UI shows the policy-defined next step and a source trail, with a
clearly fictional disabled demo. The map can recenter from one explicit
device-location request, then a separate house tap automatically requests
Google Solar preview and an approximate bounds overlay; building and roof
confirmations remain separate.

The local gate passed 710 tests, lint, typechecking, production builds, SAM
invariant checks and desktop/mobile browser inspection of the tracker demo.
Automated WCAG A/AA inspection found zero violations on the two inspected
sizes. No current India process template has been published or deployed; live
Cognito, Google, DynamoDB, portal status and notification delivery are
unverified. No official submission, portal synchronization, automated reminder
or government deadline claim is implemented. AWS CloudFormation validation
awaits renewed CLI credentials; Google Cloud has no selected project.

## Phase 13 — AI Solar + Policy Advisor
Grounding:
- property
- solar analysis
- financial calculations
- policy records
- application state
- source citations

AI can explain, summarize and guide. It cannot change deterministic facts.

Status: locally implemented. An authenticated, owner-scoped endpoint loads a
confirmed unexpired roof, optionally recomputes the existing system, base
financial and current policy-backed scenario, and optionally loads a tracker
for the same analysis. It creates bounded provenance-labelled fact cards. A
configured Bedrock model can select relevant card IDs; the server validates
the selection and composes the final answer from its original cards. The raw
address, reference, vendor, archive text and question are not sent to the
model. Invalid output, timeout or absent model uses a deterministic fallback.
No policy amount or official application status is model-generated. Missing
scenario inputs or verified benefit records are explicit. A paginated
owner-scoped analysis list supports the authenticated UI, which offers
property/roof/application selection and optional user-entered financial and
applicant inputs. The `/demo/advisor` screen is a conspicuously synthetic,
read-only layout fixture.

The local gate passed 724 tests, lint, typechecking, production builds, API
bundle/PDF smoke tests and SAM invariant checks. Desktop/mobile browser checks
found no horizontal overflow and automated WCAG A/AA checks reported zero
violations for the inspected demo states. No Bedrock model, Cognito/API stack,
current India policy corpus or Google service is configured/deployed, so live
advisor grounding, model permission and latency remain unverified. Local SAM
CLI validation and AWS CloudFormation validation await available tooling and
renewed AWS credentials respectively.

## Phase 14 — Accessory advisor
- accessory catalog
- compatibility rules
- necessity/optional classification
- cost ranges
- recommendation score
- safety notes
- policy relevance

No pay-to-rank logic in MVP.

Status: locally implemented with explicitly unavailable prices and policy
mandates. The authenticated endpoint reloads an owned, confirmed unexpired
roof, recomputes the Phase 6 system candidate and rejects unsupported or
unfit choices. A deterministic equipment/check taxonomy ranks electrical
safety, monitoring, backup, EV and maintenance items from declared goals and
site/inverter context. Each item includes a necessity classification,
compatibility review state, reason and safety note. Battery and EV equipment
remain conditional on user goals and qualified design review. The catalog has
no vendor or commission inputs. No accessory is marked `REQUIRED_BY_RULE`
without verified exact policy evidence; no current evidence is configured, so
policy relevance is `NOT_EVALUATED`. No sourced current price catalog exists,
so cost ranges are `UNAVAILABLE`. Accessory costs never change the base solar
estimate or benefit amount. The authenticated UI shows a concise shortlist,
full category review and explicit missing price/policy states; its
`/demo/accessories` route is fictional.

The local gate passed 735 tests before a focused pagination regression test;
the final Phase 14 source has 736 passing tests, lint, typechecking, API
bundle/PDF smoke tests,
SAM invariant checks and a production build. The demo returned HTTP 200 with
synthetic labels in the server-rendered HTML. Interactive browser and visual
accessibility checks could not run on this host because no browser surface or
binary was available. Live Cognito, DynamoDB, Google, policy and installer
behavior remain unverified. Numeric ranges and a verified rule requirement
remain open pending sourced data; this phase does not claim product prices or
electrical certification.

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

Status: local implementation verified. The authenticated API reloads an owned,
confirmed, unexpired roof and a fitting Phase 6 solar candidate. It subtracts
modeled edge setbacks, a service path and buffered panel footprints from
bounded projected roof rectangles, rejects overlapping Google segment bounds,
and labels Google geometry approximate. Area-only roofs return an explicit
geometry error. Four alternative light-use candidate families receive a
specific fitted zone or an unfit/undetermined reason; every concept requires a
structural and site review. A normalized non-address fingerprint finds generic
parametric templates in DynamoDB; reuse reapplies the stored footprint and
placement strategy only after a fresh fit check. Optional Nova Canvas imagery
uses a fixed category prompt, a property/analysis-scoped private S3 key, a
conditional one-attempt claim and atomic per-owner/global UTC-day budgets.
Google-derived design metadata joins the hourly hard-delete index, while S3
images have a one-day lifecycle. The browser offers interactive schematic 3D
with roof/panel depth, plan/text fallbacks, bounded-zone disclosure and a
visibly fictional demo.

Local lint, typechecking, 756 tests, SAM invariant tests and production builds
pass. The synthetic demo was inspected at narrow mobile and desktop widths;
concept selection, top-view camera and text fallback worked without visible
horizontal overflow. No Google, Cognito, DynamoDB, S3 or Bedrock integration
has been deployed or tested live. SAM/CloudFormation cloud validation and
live image-model permissions remain open until AWS credentials/configuration
are available; the model is disabled by default. S3 lifecycle expiry is
eventual, so deployed retention must be verified before production use.

## Phase 16 — Broker workspace
- customers
- properties
- analyses
- policy-backed proposals
- leads
- application tracking
- reusable designs

Status: **implemented locally (2026-10-09)**. Broker-only pages now page
organization customers, properties and leads; a customer property opens its
owned roof flow without duplication and lists its confirmed analyses, user
reported application trackers and saved property-specific design attempts.
The broker proposal API recomputes policy-backed financials from the owned,
unexpired analysis and real scenario inputs before preview or immutable save.
Snapshots record policy versions, source-check time, coverage, digest and
as-of/recheck status. Proposal saves condition-check current user membership,
customer, property, locator and analysis records; application writes gained
equivalent account/property transaction guards. Broker lead stages move
forward with revision and membership guards plus immutable audit events.
Google-derived proposals share source-bounded TTL and hourly hard deletion.
The browser drops late responses on account/customer/property changes. A
visibly fictional broker demo includes a layered isometric solar roof.

The full local gate passed lint, typechecking, **772 tests**, API bundle/PDF
smoke, infrastructure tests and production builds. The demo was inspected at
desktop and 390-pixel mobile widths without horizontal overflow; the signed
out broker route correctly required a verified broker account. No live
Cognito, DynamoDB, Google, AWS deployment or real broker transaction was
verified. Proposal PDF/send, lead-to-customer conversion and a full generic
template inventory are outside this phase's implemented scope.

## Phase 17 — International fallback
- country detection
- jurisdiction discovery
- live authoritative search
- temporary cache
- explicit "live researched" status
- no false global coverage

Status: **implemented locally (2026-10-09)**. The authenticated non-India
research route accepts an explicit country or user-triggered device location,
using Amazon Location for one-time country detection with a distance bound.
An exact-host registry starts with official US, Great Britain and Australian
agency pages. Bounded public-DNS, pinned-TLS, robots-aware fetches create
cited live page metadata; optional Brave discovery proposes only same-host
URLs using generic country/host terms. Region and utility are user-declared
context, and unsupported or unverified scope stays incomplete or unavailable.
Research never supplies eligibility or a benefit amount to the India engine.
Permitted citation metadata has short DynamoDB TTL; coordinates and pages
forbidding storage are never cached. The UI exposes retrieval, expiry,
source/date and coverage limits, plus a plainly fictional demo.

The full local gate passed lint, typechecking, **794 tests**, API bundle/PDF
smoke and production builds. Real local official-page fetches succeeded for
the three starter hosts, with no-store responses kept transient. Browser
inspection covered the demo, signed-out account guard and a narrow viewport
without horizontal overflow. No live AWS geocoding, DynamoDB, Cognito or
deployed API was verified; optional search needs a server-side key, and source
coverage is intentionally limited. CloudFormation/SAM deployment validation
remains pending cloud access.

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
