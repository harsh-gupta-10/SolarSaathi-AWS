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

Current `pnpm check` passes **232 tests**, lint, workspace/infrastructure typechecks
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
