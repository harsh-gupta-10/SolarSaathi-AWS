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

### SOLAR_CACHE
`PK=CACHE#key`, `SK=VERSION#version`

The Phase 3 implementation scopes the key to a property:
`PK=CACHE#propertyId#key`. Cache records include `expiresAtEpochSeconds`,
which is checked on every read and used by DynamoDB TTL. Google-derived cache
metadata must expire within 30 days.

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
later than 30 days from retrieval. Reads reject expired records immediately;
DynamoDB TTL physical deletion is asynchronous and requires a production
retention review before live Google data is stored.

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
`PK=RESEARCH#fingerprint`, `SK=RESULT#version`

For international/on-demand research.

## Subsidy/application entities

### SOLAR_APPLICATION
`PK=PROPERTY#propertyId`, `SK=APPLICATION#applicationId`

Fields:
- schemeId
- jurisdiction
- discom
- systemKw
- status
- referenceNumber
- vendorId
- policyVersion
- createdAt
- updatedAt

### APPLICATION_STEP
`PK=APPLICATION#applicationId`, `SK=STEP#stepId`

Fields:
- status
- required
- completedAt
- notes
- policyRuleId

### APPLICATION_EVENT
`PK=APPLICATION#applicationId`, `SK=EVENT#timestamp#id`

Fields:
- actor
- fromStatus
- toStatus
- note

## Design entities

### DESIGN_TEMPLATE
`PK=DESIGN#fingerprint`, `SK=VERSION#version`

Fields:
- category
- roofType
- roofAreaBucket
- solarKw
- freeAreaBucket
- designSpec
- imageS3Key
- thumbnailS3Key
- generationModel
- usageCount

### USER_DESIGN
`PK=PROPERTY#propertyId`, `SK=DESIGN#designId`

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
