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

## Benefits

`POST /v1/benefits/evaluate`

Input:
```json
{
  "propertyId": "...",
  "analysisId": "...",
  "systemKw": 3,
  "customerType": "RESIDENTIAL"
}
```

Output:
```json
{
  "grossCost": 195000,
  "benefits": [],
  "totalEligibleBenefit": 0,
  "netCost": 195000,
  "policyVersions": [],
  "warnings": ["No approved current policy facts were available for evaluation."]
}
```

This is a synthetic shape example with no live policy fact or subsidy amount.

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
