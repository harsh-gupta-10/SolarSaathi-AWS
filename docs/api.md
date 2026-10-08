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
  "totalEligibleBenefit": 78000,
  "netCost": 117000,
  "policyVersions": [],
  "warnings": []
}
```

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

`GET /v1/admin/policy/sources`

`GET /v1/admin/policy/changes`

`POST /v1/admin/policy/changes/:id/approve`

`POST /v1/admin/policy/changes/:id/reject`

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
