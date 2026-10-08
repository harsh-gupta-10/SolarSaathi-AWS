# API Contracts

All privileged operations are server-side.

## Local availability

`GET /v1/health` is public and returns service status, environment, package version
and request ID; it is not a downstream integration health check.

`GET /v1/me` is implemented for authenticated identity verification. The backend
independently verifies the Cognito access-token signature, issuer, expiry,
`token_use=access` and configured app client, then calls Cognito `GetUser` with
that access token. It compares the returned `sub` to the verified token subject
and projects only the shared identity contract:
`{ profile, emailVerified, source: "COGNITO", requestId }`.
Role comes from verified groups, not request headers or browser preview controls;
organization context comes from Cognito attributes. This is **not** a database
membership/ownership check and does not persist a profile.

Missing authentication configuration returns `503 AUTH_NOT_CONFIGURED`;
missing/invalid/revoked/mismatched credentials return `401 UNAUTHORIZED`;
Cognito/JWKS outages return sanitized `503 AUTH_SERVICE_UNAVAILABLE`. Raw tokens,
SDK errors and unrelated user attributes are never returned or logged.

`POST /v1/solar/analyze` and `POST /v1/advisor/solar` return structured
`501 NOT_IMPLEMENTED` responses. The original `/v1/analyze` and `/v1/chat`
scaffold paths remain aliases. No product results are fabricated.

Phase 3 core routes are locally implemented: `GET /v1/users/me`,
`POST /v1/users/bootstrap`, `GET /v1/organizations/me`,
`GET|POST /v1/customers`, `GET|POST /v1/properties`,
`GET /v1/properties/{propertyId}`, and `GET|POST /v1/leads`. Every route requires
a verified Cognito identity and a configured DynamoDB core table. The backend
checks stored ownership and organization membership before reading or writing
records. A homeowner bootstrap creates a personal organization and self
customer atomically; brokers can create customers and leads.

Phase 4 roof routes are locally implemented but have not been tested against
live Google services:

| Route | Request | Result |
| --- | --- | --- |
| `POST /v1/solar/geocode` | `{ propertyId }` | Address candidates for an owned stored property |
| `POST /v1/solar/building-insights` | `{ propertyId, placeId, location }` | Property-bound Google roof preview and `previewId` |
| `POST /v1/solar/confirm-building` | `{ propertyId, previewId, confirmed: true }` | Explicit building confirmation |
| `POST /v1/solar/confirm-roof` | `{ propertyId, previewId, confirmed: true }` or `{ propertyId, manual, confirmed: true }` | Saved normalized roof analysis |

`location` uses `{ latitude, longitude }`. Manual input requires
`roofAreaSquareMeters` and may include horizontal `lengthMeters`, `widthMeters`,
`pitchDegrees`, and `azimuthDegrees`. The server checks paired dimensions and
area consistency. Client roof JSON is never accepted as verified Google data.
Google preview and analysis records are bounded and expire; manual measurements
are labelled user-provided. A confirmed roof is still not a structural review,
panel layout, or financial result.

Phase 6 adds authenticated `POST /v1/systems/recommend` with a strict request:

```json
{
  "propertyId": "owned-property-id",
  "analysisId": "confirmed-analysis-id",
  "generationKwhPerKwYear": 1500,
  "demand": { "kind": "CONSUMPTION", "monthlyConsumptionKwh": 300 }
}
```

Alternatively, `demand` may be `{ "kind": "BILL", "monthlyBillRupees":
2400, "tariffRupeesPerKwh": 8 }`. Both forms may include `sanctionedLoadKw`
as context for a local-rule review. The backend loads the owned, unexpired
analysis and uses its saved roof model; the browser cannot submit roof geometry
or override the panel and inverter planning assumptions. The response contains
`{ schemaVersion, source, requestId, propertyId, analysisId, design }`, where
`design` includes the explicit assumptions, roof cap, all candidates, a
recommendation when one is defensible, reason codes, and warnings. A saved
analysis without usable roof geometry returns `409 ROOF_MODEL_REQUIRED`.
Generation is an estimate; this endpoint returns no price, subsidy, legal
eligibility, or structural approval.

Phase 7 adds authenticated `POST /v1/financials/estimate`:

```json
{
  "propertyId": "owned-property-id",
  "analysisId": "confirmed-analysis-id",
  "demand": { "kind": "CONSUMPTION", "monthlyConsumptionKwh": 300 },
  "generationKwhPerKwYear": 1500,
  "nominalKw": 2,
  "financialInputs": {
    "grossSystemCostRupees": 120000,
    "selfConsumptionFraction": 0.7,
    "importTariffRupeesPerKwh": 8,
    "exportRateRupeesPerKwh": 0,
    "annualMaintenanceRupees": 3000
  }
}
```

All rupee and rate values in this example are **synthetic request inputs**, not
market prices, current tariffs or policy benefits. The server checks ownership
and expiry, recomputes Phase 6 candidates from the stored roof, and permits
only a supported eligible nominal size with positive generation. The response
uses source `DETERMINISTIC_BASE_FINANCIAL_V1` and includes the trusted candidate,
echoed assumptions, 25 annual cash-flow rows, payback or `null`, and one-axis
sensitivity. `policyBenefitsEvaluated` and `financingModeled` are `false`.
There is no subsidy amount in the base response. Invalid inputs return 400;
missing normalized roof returns 409; an unfit candidate returns 422.

POST scaffolds require an `application/json` object of at most 64 KiB after
base64 decoding. Errors use `{ error: { code, message, requestId } }`, with
400 for invalid JSON/object shape, 413 for oversized payloads, 415 for unsupported
media type and a sanitized 500 for unexpected failures/configuration errors.
These routes do not currently read or mutate any user data. The Phase 2 SAM
configuration protects product routes with a Cognito user-pool authorizer,
requiring an access token with `aws.cognito.signin.user.admin` scope. Health and
CORS preflight remain public. Lambda responses and gateway/authorizer errors
include the fixed `ApplicationOrigin` CORS header, never a reflected caller origin;
HTTP error statuses are preserved. Local direct Lambda invocation bypasses the gateway
and is not proof of deployed authorization. The identity endpoint binds the app client in backend code. Stateful
user-resource APIs must additionally enforce database ownership/organization
checks; those APIs arrive with Phase 3. Browser navigation roles are never authorization.

Phase 8 adds administrator-only policy source and document registration. The
server verifies a current Cognito session and requires the `ADMIN_POLICY` or
`ADMIN` group from the verified token. A registered source starts as `PROPOSED`
and disabled; registering a document does not verify, approve, or activate any
policy fact. The source request contains `name`, `publisherName`,
`jurisdiction`, `sourceType`, `canonicalUrl`, `crawlFrequency`, and
`freshnessWindowHours`. The backend derives the source ID, authority tier, and
allowed host from its official-host registry. Only exact, curated official
hosts are accepted.

`POST /v1/admin/policy/documents` accepts `sourceId`, positive `version`,
`title`, `documentType`, `mimeType` (`text/html` or `application/pdf`), optional
publication/effective dates, optional `documentUrl`, and `contentBase64`.
`documentUrl` must be HTTPS on the source's exact registered official host;
when omitted, the source URL is used. Distinct document URLs have separate
immutable version series. This endpoint has a separate body limit for a
document of at most 2,000,000 bytes. It binds the document to the
registered official host, hashes the exact bytes, extracts normalized text and
bounded citation chunks, and stores the raw and derived artifacts in private
S3 with immutable DynamoDB metadata. It does not fetch a URL supplied by the
caller. Identical retries are idempotent; conflicting versions are rejected.
These are
administrative ingestion routes, not public policy lookup routes.

Phase 9 adds locally implemented administrator review routes. They require the
same verified Cognito group and configured policy storage. A source begins
scheduled checks only after `POST /v1/admin/policy/sources/curate` receives its
`sourceId` and `expectedRegistryVersion`. `POST /v1/admin/policy/sources/crawl`
requests an earlier check of an enabled source and returns whether it was newly
queued. An ordinary rate limit cannot be bypassed before its due time; a
source stopped for an unusually long `Retry-After` requires an audited
`rateLimitClearanceReason` from an administrator before requeue. `GET /v1/admin/policy/sources` returns immutable registry snapshots and
separate current crawl states/freshness so health is not inferred from a source
version.

`GET /v1/admin/policy/queue?limit=20&cursor=...` returns one mixed, paginated
review page as `items` (unverified extracted quotations) and `changes`
(document-level changes, including documents with zero extracted quotations).
`GET /v1/admin/policy/candidates/{candidateId}` and
`GET /v1/admin/policy/changes/{changeId}` return citation/document/source,
freshness and audit context. The change detail may include up to 4,000
characters of hash-checked archived plain text; it never returns raw HTML/PDF
or an S3 URL. `POST` to either detail path followed by `/approve` or `/reject`
requires `expectedRevision` and accepts a review reason. A separate
administrator from the source curator must review. Approval records the
evidence or document review only: it never activates a policy fact, eligibility
rule or subsidy amount. Changed revisions return 409; all transitions are
audited. These routes and scheduled fetches have only local test coverage;
no deployed policy workflow has been verified.

Phase 10 adds a locally implemented, owner-scoped `POST /v1/benefits/evaluate`.
The request uses the confirmed `propertyId` and `analysisId`, the same demand,
generation and nominal system inputs as the system and base-financial routes,
and `applicantFacts` declared by the user. `eligibleQuotedCostPaise` is optional:
the gross installed quote is not silently treated as policy-eligible cost.
The backend reloads the owned roof and recomputes the roof-fitting system; it
does not accept browser geometry, benefit amounts, policy IDs or source health.

```json
{
  "propertyId": "owned-property-id",
  "analysisId": "confirmed-analysis-id",
  "demand": { "kind": "CONSUMPTION", "monthlyConsumptionKwh": 300 },
  "generationKwhPerKwYear": 1500,
  "nominalKw": 2,
  "applicantFacts": {
    "country": "IN",
    "state": "MH",
    "customerType": "RESIDENTIAL",
    "propertyType": "INDIVIDUAL_HOME",
    "ownership": "OWNER"
  }
}
```

These are synthetic **request inputs**, not a current policy or eligibility
claim. The response has source `DETERMINISTIC_BENEFIT_STACK_V1`, trusted system
capacity, `applicantFactsSource: "USER_DECLARED"`,
`eligibilityNotGuaranteed: true`, scope coverage, and either `UNAVAILABLE`
with reason codes and no amount or `AVAILABLE` with a deterministic stack.
Each decision includes its status, reason codes, policy/rule/version, effective
jurisdiction and dates, immutable official citations and current last-checked
source status. `coverageComplete` remains false until coverage is independently
verified. The total counts only selected compatible verified rules; unknown or
stale benefits never enter it. This is separate from the unsubsidized Phase 7
financial response; net cost and subsidy-adjusted payback are Phase 11 work.

Phase 10 also adds administrator-only policy publication routes. They require a
verified Cognito `ADMIN_POLICY` or `ADMIN` group. `POST
/v1/admin/policy/benefits/drafts` creates an immutable, evidence-bound rule
draft. The request identifies a current curated source, latest crawled document
version, exact archived quote and locator, benefit ID and typed rule. Numeric
amounts, eligibility clauses and positive compatibility edges require their
own cited archived evidence. The server derives policy/rule/fact IDs and
versions; a draft cannot choose or overwrite them. `GET
/v1/admin/policy/benefits/queue?cursor=...` pages submitted drafts with an
opaque cursor, and `GET
/v1/admin/policy/benefits/{draftId}` returns detail with source freshness.
`POST` to the draft path followed by `/submit`, `/publish`, or `/reject` carries
`expectedRevision`; reviewer actions require an audited reason. Only the
author may submit, while a different administrator from both author and source
curator may publish or reject. Publication transactionally writes verified
numeric/clause facts, an immutable active version, activation event and active
pointer. Superseding a version preserves history. Evidence review in Phase 9
alone never publishes a benefit. No Phase 10 policy resources have been
deployed or populated locally.

The draft request includes `clauseEvidence: [{ clauseKey, locator,
quotedEvidence }]`. `EFFECTIVE_PERIOD` is always required; `CAP`,
`COMBINED_CAP`, `SYSTEM_SIZE`, and `OVERLAP` appear when the corresponding rule
field exists. Every `eligibility.allOf` predicate uses
`ELIGIBILITY_ALL_<index>`, each `eligibility.anyOf` predicate uses
`ELIGIBILITY_ANY_<group>_<index>`, and compatibility edges and conditional
predicates use `COMPATIBILITY_<index>` and
`COMPATIBILITY_<index>_CONDITION_<index>`. Empty eligibility is rejected. Each
locator carries exact absolute character offsets and, when archived, the same
page/section/fragment. The server verifies every excerpt against the pinned
normalized archive before creation and again before publication.

Phase 11 adds authenticated `POST /v1/financials/policy-backed/estimate`. It
accepts the Phase 7 estimate inputs plus Phase 10 `applicantFacts` and optional
`eligibleQuotedCostPaise`. The backend reloads the owned analysis, recomputes
the roof-fitting system and base financial estimate, and evaluates current
active verified rules for that same system. It does not accept client benefit
amounts, policy IDs, source health or rooftop measurements. The response always
contains the unsubsidized `base` and a cited `benefits` evaluation. When a
current selected benefit can be counted, `status: "AVAILABLE"` includes a
`projection` with gross, scope breakdown, total, modeled upfront amount, net,
25-year cash flow, payback and policy provenance. Its
`timingAssumption: "BENEFITS_MODELED_UPFRONT"` means the adjusted result is a
scenario, not a claim about official payment timing. Partial scope coverage or
unknown eligibility is labelled `PARTIAL`. When no reliable positive selected
benefit is available, `status: "UNAVAILABLE"` omits the projection and gives
reason codes; the base remains available.
Selected `OTHER` benefits are disclosed in the total and
`nonUpfrontBenefitPaise` but do not reduce net upfront cost or payback, because
their tax/financing/regulatory cash treatment is not verified.

Paths below are planned contracts unless listed as available above.

## Roof

`POST /v1/solar/geocode`

`POST /v1/solar/building-insights`

`POST /v1/solar/analyze`

`POST /v1/solar/confirm-building`

`POST /v1/solar/confirm-roof`

## Policy

`GET /v1/policies?country=IN&state=MH&discom=MSEDCL`

`GET /v1/policies/:policyId`

`GET /v1/policies/:policyId/history`

`POST /v1/policies/research`

For international research, return a clearly labelled live-research result.

## Applications

`POST /v1/applications`

`GET /v1/applications/:id`

`POST /v1/applications/:id/steps/:stepId`

`POST /v1/applications/:id/events`

`POST /v1/applications/:id/chat-update`

## Advisor

`POST /v1/advisor/solar`

Grounding context:
- property
- solar analysis
- benefit evaluation
- policy records
- application state

## Accessories

`POST /v1/accessories/recommend`

Input:
- analysis
- system
- inverter
- user goals
- EV
- backup
- budget

## Rooftop designs

`POST /v1/designs/recommend`

`POST /v1/designs/generate`

`GET /v1/designs/templates`

## Admin

`POST /v1/admin/policy/:id/rollback`

`GET /v1/admin/crawler/runs`

## Error principles

Never hide:
- stale policy
- conflicting policy
- missing source
- unavailable model
- failed crawl
- incomplete application information

Return structured errors and actionable recovery.
