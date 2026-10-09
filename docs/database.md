# DynamoDB Data Model

Single-table design is preferred unless a clear access-pattern reason requires separation.

## Existing entities

### USER
`PK=USER#id`, `SK=PROFILE`

### ORGANIZATION
`PK=ORG#id`, `SK=PROFILE`

### CUSTOMER
`PK=ORG#orgId`, `SK=CUSTOMER#customerId`

### PROPERTY
`PK=CUSTOMER#customerId`, `SK=PROPERTY#propertyId`

### SOLAR_ANALYSIS
`PK=PROPERTY#propertyId`, `SK=ANALYSIS#analysisId`

### LEAD
`PK=ORG#orgId`, `SK=LEAD#leadId`

Phase 16 advances the stored lead through explicit broker-reported stages with
an expected-revision condition. Each change atomically appends a
`BROKER_LEAD_EVENT` at `PK=ORG#orgId`,
`SK=LEAD_EVENT#leadId#revision`; organization membership and user role are
rechecked in the same transaction. Lead stages are business notes, not
verified solar installation or government application statuses.

### SOLAR_CACHE
`PK=CACHE#key`, `SK=VERSION#version`

The Phase 3 implementation scopes the key to a property:
`PK=CACHE#propertyId#key`. Cache records include `expiresAtEpochSeconds`,
which is checked on every read and used by DynamoDB TTL. Google-derived cache
metadata must expire within 21 days.

### ROOF_PREVIEW
`PK=PROPERTY#propertyId`, `SK=ROOF_PREVIEW#previewId`

An immutable, property-bound normalized Google roof preview. It stores the
selected geocode place, point and roof model for 15 minutes. The Google model
is bounded before DynamoDB persistence. It is not a confirmed analysis.

### BUILDING_CONFIRMATION
`PK=PROPERTY#propertyId`, `SK=BUILDING_CONFIRMATION#previewId`

An immutable marker that the authenticated property owner or broker explicitly
confirmed the building associated with the preview. It shares the preview's
expiry. Confirming roof measurements creates a SOLAR_ANALYSIS only after this
marker exists. Manual measurements are separately marked `MANUAL`.

Google-derived SOLAR_ANALYSIS records include the normalized roof and expire no
later than 21 days from retrieval. Reads reject expired records immediately;
the hourly GSI3 worker conditionally hard-deletes expired Google roof records.
DynamoDB TTL is a secondary cleanup mechanism, and live retention still needs
deployment verification.

## Policy entities

Phase 8 stores the administrative source and ingestion metadata in a separate
policy table. This is a deliberate access boundary: homeowner and roof Lambda
roles have no access to policy drafts or raw-document metadata. Raw bytes and
derived normalized text/chunks live in a private, versioned S3 bucket. An
ingested document is evidence for review, never an active benefit by itself.
Conditional writes preserve immutable source/document versions. Phase 9 keeps
mutable crawl state and review pointers separate from those snapshots; every
human review also writes an immutable revision and audit event.

### POLICY_SOURCE
`PK=SOURCE#sourceId`, `SK=CURRENT` and `SK=VERSION#registryVersion`

Initial registration atomically writes the current pointer and an immutable
version snapshot. Curation atomically writes the next immutable version,
current pointer, crawl state and audit event with a registry-version condition.
Only `CURRENT` source records appear in sparse GSI4 (`POLICY_SOURCES`).

Fields:
- authorityLevel
- jurisdiction
- canonicalUrl
- sourceType
- crawlFrequency
- lastCheckedAt
- lastChangedAt
- contentHash
- status

### POLICY_CRAWL_STATE
`PK=SOURCE#sourceId`, `SK=CRAWL_STATE`

Revision-checked mutable state stores the next due epoch, bounded lease,
failure count, last fetch validators/hashes and last checked/changed time.
Sparse GSI2 (`POLICY_CRAWL_DUE`) indexes the due epoch. Source snapshots are
not rewritten for each check.

### POLICY_DOCUMENT
`PK=SOURCE#sourceId`, `SK=DOCUMENT#documentId#VERSION#version`

`documentId` is derived from the canonical document URL, so one registered
publisher/source may archive multiple documents. Document versions are
immutable conditional writes.

Fields:
- s3Key
- s3VersionId
- derivedS3Key
- derivedS3VersionId
- sha256
- normalizedTextSha256
- chunkCount
- retrievedAt
- publishedAt
- effectiveFrom
- title
- mimeType

### POLICY_DOCUMENT_CHANGE
`PK=CHANGE#changeId`, `SK=CURRENT`, `SK=DETECTED#00000001`, and
`SK=REVIEW#revision`

A document-level change remains reviewable even when extraction finds no
candidate quotation. Current review status is conditionally updated; detection
and review snapshots are immutable. Only pending current records appear in
sparse GSI1 (`POLICY_REVIEW_PENDING`).

### POLICY_CANDIDATE
`PK=CANDIDATE#candidateId`, `SK=CURRENT` and `SK=REVIEW#revision`

The candidate stores an unverified, exact quoted chunk with document/version
hash and citation. Approval means evidence reviewed; it does not activate a
policy rule. Pending candidates share GSI1 with document changes, so one
cursor pages both record types. Current status is rechecked on a consistent
read after the eventually consistent index query.

### POLICY_AUDIT
Stored under the relevant source/change/candidate partition with
`SK=AUDIT#timestamp#eventId`. Curation, crawl checks/failures, detected
changes and reviewer actions append events; review transactions write the
audit event with the immutable review snapshot.

### POLICY_PUBLICATION_DRAFT
`PK=PUB_DRAFT#draftId`, `SK=CURRENT` and `SK=AUDIT#time#eventId`

Phase 10 keeps an immutable draft body with a revision-checked mutable status.
The draft binds a benefit rule to a precise archived quote/locator and records
author and source curator. Submission adds a sparse pending-review GSI6 entry.
A different administrator reviews with a reason; each transition appends audit.
Correcting a rule requires a new draft.

### PUBLISHED_POLICY
`PK=PUBLISHED_POLICY#policyId`, `SK=VERSION#00000001` and `SK=ACTIVE`

The version record stores a verified policy version, numeric and cited clause
facts, typed benefit rule and provenance. It is immutable. A conditional
transaction writes the next version, an `ACTIVATION#VERSION#...` event, updated
active pointer, draft transition and audit together, while checking current
source/crawl revisions. The pointer alone appears in sparse GSI5, partitioned
by jurisdiction for bounded homeowner evaluation. Historical versions remain
readable; the pointer controls which version participates in calculations.
Current crawl state is separate from immutable source/document snapshots.

### POLICY_CHANGE
The Phase 10 activation event records version lineage. More detailed semantic
field diffs and rollback remain future work. This is distinct from Phase 9
document-change evidence above.

### POLICY_RESEARCH_CACHE
Phase 17 stores bounded, temporary international source metadata in the core
table at `PK=INTL_RESEARCH#sha256(normalized jurisdiction and registry version)`,
`SK=VERSION#1`. The record contains a versioned response, research timestamp,
and `expiresAtEpochSeconds` for read-time expiry and DynamoDB TTL. The cache
holds fetched official-page citations, not Brave search-result content,
coordinates, reverse-geocode results, benefit amounts, or active policy facts.
Requests using device coordinates bypass this cache. A cache hit retains the
original source retrieval time and gets a new request ID; expiry is never
extended by reading. A source forbidding storage with `Cache-Control:
no-store` can be cited for the current request but is never written to this
cache. Unsupported jurisdictions and failed fetches are not stored.

## Subsidy/application entities

### SOLAR_APPLICATION
`PK=PROPERTY#propertyId`, `SK=APPLICATION#applicationId`

Phase 12 stores the application and bounded (up to 20) checklist steps in one
revision-checked item. The snapshot includes the selected benefit and confirmed
analysis IDs, system, policy/rule version, cited verified process steps, source
checks, user reported status, expected next step, optional application reference
and vendor name, and up to 30 document metadata notes. No document contents or
official portal credentials are stored. Checklist mutations replace this item
conditionally on revision and append an audit event atomically. Creation also
condition-checks the active policy version/rule pointer in the policy table.

Steps are embedded because every tracker read needs the whole bounded
checklist; there is no separate `APPLICATION_STEP` item in the Phase 12
implementation. Historical process citations remain fixed in the application
snapshot when a newer policy version becomes active.

### APPLICATION_EVENT
`PK=APPLICATION#applicationId`, `SK=EVENT#timestamp#id`

Fields:
- actor and timestamp
- action (`CREATED`, `STEP_TRANSITION`, `DETAILS_UPDATED`, `DOCUMENT_RECORDED`)
- changed step/fields, previous and new status, and optional note/document ID

Events are immutable, property scoped through their parent application, and
returned by a bounded paginated API after ownership checks.

## Design entities

### DESIGN_TEMPLATE
`PK=DESIGN#fingerprint`, `SK=VERSION#version`

Fields:
- category
- candidateId and roofSource
- roofAreaBucket
- solarKw
- freeAreaBucket
- designSpec
- template version; normalized shape and clearance assumptions are encoded
  in the fingerprint used for lookup

The fingerprint excludes address, coordinates, account identifiers and raw
Google Solar imagery. It can reuse a parametric arrangement only after a
fresh deterministic fit check for the requesting roof. A property-specific
rendering is never stored on the generic template or served to another owner.

### USER_DESIGN
`PK=PROPERTY#propertyId`, `SK=DESIGN#designId`

Stores analysis ID, selected candidate and fingerprint, owner/organization
provenance, optional property-specific private S3 image key, and
creation/expiry timestamps. Placement is recomputed from the confirmed roof
for a fresh recommendation; the image remains illustrative. Every read verifies
property ownership and the analysis association. Google-derived geometry
must respect its retention limit. Google-derived design records use the sparse
GSI3 hard-delete index; direct reads also reject expired records. The private
asset bucket expires generated objects after one day.

### DESIGN_GENERATION_CLAIM and DESIGN_BUDGET
`PK=PROPERTY#propertyId`, `SK=DESIGN_CLAIM#designId` conditionally reserves one
model attempt for an analysis, candidate and fingerprint before invoking
Bedrock. Google-derived claims use GSI3 for hourly hard deletion at source
expiry. Atomic UTC-day counters under `PK=DESIGN_BUDGET#date` cap attempts
per owner and across the application. A failed model call still consumes its
claim and budget; the deterministic 3D concept remains available.

## Broker proposal entities (Phase 16)

### BROKER_PROPOSAL
`PK=CUSTOMER#customerId`, `SK=PROPOSAL#proposalId`

An immutable customer, property and analysis-scoped snapshot of a newly
recomputed policy-backed financial scenario. It stores creator/organization
provenance, derived coverage status, policy version IDs, oldest relevant
source-check time, creation time, a JSON snapshot and its SHA-256 digest.
Reads verify current broker membership and the customer/property chain;
the detail response labels an old or unverifiable snapshot for recheck.
No PDF, application submission or official status is stored. Proposal writes
condition-check current ownership and record revisions in one transaction.

The proposal's TTL is bounded by the saved analysis expiry when Google roof
data contributes. Such proposals enter the sparse GSI3 hard-delete sweep as
well as DynamoDB TTL. Listing uses the customer's partition and a bounded
cursor; expired entries are omitted from responses. This design does not
archive Google-derived roof details beyond their allowed retention period.

## Accessory entities

### ACCESSORY
`PK=ACCESSORY#id`, `SK=VERSION#version`

Fields:
- category
- compatibility
- classificationRules
- safetyNotes
- optionalCostRange
- active

## Policy calculation audit

### BENEFIT_CALCULATION
The Phase 10 API computes a request-scoped result and returns its request ID,
policy versions and cited decisions. It does not persist this entity yet.
Persisting a property-scoped audit snapshot requires a retention and privacy
design, because applicant eligibility inputs are self-reported and sensitive.
Phase 11 likewise returns a request-scoped policy-backed financial scenario
with the base result and cited benefit evaluation, without storing an adjusted
estimate or applicant facts.

## Access patterns

Must support:
- get current policy for jurisdiction
- get policy history
- list pending policy changes
- get source health
- get active benefits for property
- get application and steps
- get user's saved designs
- get compatible accessories
- get policy calculation audit
