# Testing Strategy

## Phase 0 checks

`pnpm check` runs ESLint, all workspace typechecks, Vitest suites and production
builds. Current suites cover public/server environment separation and redacted
validation errors, explicit API unavailability, JSON input handling, request
logging without bodies/tokens, scaffold UI labelling and baseline calculation
arithmetic. Calculation fixtures are synthetic, not live government policy.

The baseline financial/slab tests preserve existing scaffold behavior; they do
not establish eligibility, stacking or a completed 25-year financial model.
Those engines require the phase-specific tests below before production use.

GitHub Actions repeats the application checks and SAM schema/build checks.
CloudFormation compliance and account-aware deployment checks remain separate
requirements; a successful application build alone is not infrastructure
approval.

## Phase 1 and Phase 2 checks

The Phase 2 baseline passed **232 tests**, lint, workspace/infrastructure typechecks
and production builds. Tests cover address drafts and storage failures,
role-aware navigation, domain routing, accessible mobile menus, SDK cookie
persistence, missing-config auth guards, strict-mode session restore, OAuth
callback cleanup/timeouts/errors, Google/sign-in/logout actions, identity mapping
and rejection of navigation-preview role changes in authenticated contexts.

SAM invariant tests check code-only public clients, rotation/revocation, read-only
organization attributes, managed-login branding, secret references and public
health versus protected product routes. They are **not** CloudFormation schema
validation or a cfn-guard compliance review.

Browser checks cover landing/workspace/sign-in at 375/768/1440px, invalid and valid
address drafts, broker preview navigation, mobile Escape/focus return, missing
Cognito configuration, account settings and callback query cleanup. Live Cognito
signup, sign-in, Google federation and deployed API authorizer tests remain
blocked pending approved resource configuration. Do not equate SDK mocks with
successful cloud integration.

## Phase 6 system designer checks

Pure calculation tests cover roof capacity, whole-panel DC sizing, candidate
selection, bill-derived demand, area-only uncertainty, zero Google energy,
Google panel specification mismatch, and sanctioned-load review without an
unverified legal cap. API tests cover strict numeric and identifier bounds,
identity and ownership, expired analysis reads, metadata-only roof rejection,
response provenance and least-privilege SAM routing. The fixture-only design
demo supports browser checks without Cognito or Google credentials. None of
these tests proves a live DISCOM rule or site-specific production yield.

## Phase 7 base financial checks

Calculator tests cover the 25 annual rows, degraded generation, independent
import/export values, annual self-use capped by demand, tariff and maintenance
escalation, interpolated or absent payback, and one-variable sensitivity. API
tests use owned, expired, foreign and metadata-only analyses; reject client
roof/candidate metrics and invalid monetary inputs; and verify the Lambda
performs only DynamoDB `GetItem` reads. UI tests exercise required user inputs,
stale-result clearing, response validation and an explicitly synthetic demo.
The base result has no policy benefit or financing calculation, so its cash
flow is not a policy-backed return forecast.

## Unit tests

### Calculations
- generation
- degradation
- tariff escalation
- payback
- 25-year cash flow
- caps

### Subsidy stacking
Test:
- central only
- central + state additive
- state unavailable
- mutually exclusive
- combined cap
- eligibility failure
- date boundary
- system-size boundary
- prior benefit exclusion
- unknown compatibility
- stale policy

### Policy precedence
Test:
- newer amendment beats older guideline
- higher-authority current source beats lower authority
- unresolved conflict blocks verified status

### Policy evidence foundation
Test official source host/type/jurisdiction binding, immutable source and
document versions, exact raw and normalized content hashes, HTML/PDF extraction
limits, stable chunk locators, and rejection of non-admin ingestion. A changed
HTML shell with unchanged normalized rule text must not become an active policy
change. The parser must never fetch links, run page scripts, or infer a subsidy
value from an uploaded document.

### Phase 9 official-source workflow
Test exact-host/HTTPS and each redirect hop, DNS rebinding/private-address
rejection, robots exclusions, bounded response/time/bytes, 304 and official
rate limiting. Test initial, raw-unchanged, cosmetic, material and zero-snippet
document changes; source URL/redirect identity changes must retain accurate
citations. Test candidate quotes against exact archived chunks and compare
conflict flags to actual prior reviewed evidence. Test lease/replay/failure
paths, mixed candidate/document-change queue pagination, separate curator and
reviewer, revision conflicts, immutable audit snapshots and no policy-fact
publication. Browser tests cover stale/failed source feedback, link
provenance, account changes and mobile/accessibility states. Fixtures are
synthetic, and no local test implies a live official policy value.

### Phase 10 benefit rules and publication

The Phase 10 local `pnpm check` gate passed 662 tests across the workspace,
infrastructure and tools suites, alongside lint, typechecking and builds.
Pure rule tests cover eligibility with unknown facts, jurisdiction and Indian
effective-date boundaries, current evidence, source precedence, overlap,
conditional and mutual compatibility, individual/combined caps, optimization,
zero-value handling and rule-catalog limits. API tests cover exact archived
numeric and clause excerpts, forged locators, maker-checker separation,
revision races, audited source replacement, owner-scoped analysis reads,
pagination and fail-closed unavailability. UI tests cover declared facts,
result provenance, unavailable states, publication queue/detail/review and
pagination. Desktop/mobile browser checks covered the benefit and admin demo
screens; accessibility checks reported no WCAG A/AA violations in the inspected
states. These fixtures do not establish live India policy coverage or deployed
AWS authorization.

### Phase 12 application tracker and map flow

Policy and API tests cover exact archived process-step excerpts, missing
templates, active version binding, fresh healthy source checks, selected
benefit enforcement, ownership, revision conflicts, required and optional
step transitions, status correction notes, document metadata, audit history
and nonmutating explicit/ambiguous chat suggestions. Web state tests cover
account sign-out clearing, property switch races, manual/geolocation map
selection, separate device and house markers, and approximate Solar bounds.
The `/demo/application-tracker` fixture supports browser layout and
accessibility inspection without suggesting a real published policy. No
fixture proves deployed Cognito, live Google Solar, official portal status,
notification delivery, or current India process coverage.

### Phase 13 grounded advisor

Exercise owner-scoped confirmed-analysis listing, expired Google record
filtering, and cross-property access denial. Advisor tests should verify that
trusted roof and application facts are loaded server-side, the optional
scenario uses the existing deterministic calculation and policy paths, and
missing scenario inputs never acquire invented financial or eligibility facts.
Inject malformed, unknown, duplicate, and out-of-range Bedrock-selected card
IDs; server-composed answers must contain only original fact-card statements.
Test model timeout/unavailability, unverified or stale policy, and cross-owner
application IDs for a deterministic, privacy-safe result or explicit error.
The browser should clear the old answer on account, property, or analysis
change and show citations, provenance, missing context, and fallback mode.
Visual inspection of any synthetic advisor demo must confirm its fictional
label survives mobile layouts and cannot be mistaken for live policy data.
The Phase 13 local gate passed 724 tests, lint, typechecking and production
builds. The new focused API and web suites passed 14 tests; SAM checks passed
25. Desktop and 390-pixel mobile inspection of `/demo/advisor` found no
horizontal overflow, and automated WCAG 2 A/AA and 2.1 A/AA checks reported
zero violations and zero incomplete items in the inspected states. This does
not verify deployed authorization, live model access or a real policy corpus.

### Phase 14 accessory advisor

Test each recommendation against a server-loaded owned roof and recomputed
fitting system. Cover malformed goals, unsupported inverter/EV states,
area-only roofs, unsuitable candidates, cross-owner access, and unknown site
conditions. Ranking must be stable, deterministic, and independent of price,
vendor or affiliate data. Verify that unavailable price and policy evidence
never becomes a numeric estimate or `REQUIRED_BY_RULE` classification, and
that electrical/structural cautions remain visible for battery, EV, lightning
and access items. The browser must clear old recommendations when the account,
property, roof or declared inputs change. A synthetic demo must remain plainly
fictional and must not present a regulation, compatibility or price as live.
The Phase 14 local gate passed 735 tests, lint, typechecking and production
builds. A focused pagination regression test added afterward passed, bringing
the source total to 736. The accessory API and web focused suites added 12 tests; SAM invariant
checks passed 25. The demo route returned HTTP 200 with synthetic labels in
server-rendered HTML. Interactive layout and accessibility checks were not
available because this host lacked a browser surface or executable.

### Phase 11 policy-backed financial scenario

The Phase 11 local `pnpm check` gate passed 692 tests across the workspace,
infrastructure and tools suites, plus lint, typechecking and production builds.
Pure calculation tests cover selected scope totals, integer-paise rounding,
net cost floors, excess benefit disclosure, year-zero payback, 25 annual rows,
unavailable payback and incomplete coverage. API tests require owner-scoped
saved analysis and current verified rule evidence, reject client benefit or
system overrides, retain the base result when policy is unavailable, and
verify response provenance. Web tests cover policy-unavailable, partial and
source-cited scenarios without doing financial arithmetic in the browser.
Neither local tests nor the modeled-upfront scenario establishes a real subsidy
payment date or live India policy coverage.

### Application state
Test:
- valid transitions
- invalid transitions
- user update
- admin update
- policy-specific steps

## Integration tests

- address → Solar API adapter
- policy source → extraction → version
- policy → benefit engine
- benefit engine → financial engine
- application → tracker
- advisor grounding

## Crawler tests

Fixtures should contain:
- HTML page
- PDF
- changed subsidy
- changed eligibility
- cosmetic-only change
- source outage
- conflicting source
- malicious prompt injection text

## Security tests
- unauthorized property access
- cross-organization broker access
- admin-only policy approval
- private S3 object access
- SSRF protection in crawler
- prompt injection resistance

## Demo tests

Create a deterministic fixture for:
- Maharashtra homeowner
- 3 kW
- policy-backed subsidy
- application tracker
- accessory recommendations
- remaining rooftop design

The fixture must be clearly labelled demo data and must not masquerade as live policy.
