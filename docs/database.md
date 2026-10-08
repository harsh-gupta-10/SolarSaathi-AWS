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

### POLICY_SOURCE
`PK=SOURCE#sourceId`, `SK=METADATA`

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

### POLICY_DOCUMENT
`PK=SOURCE#sourceId`, `SK=DOCUMENT#version`

Fields:
- s3Key
- sha256
- retrievedAt
- publishedAt
- effectiveFrom
- title
- mimeType

### POLICY
`PK=POLICY#policyId`, `SK=VERSION#version`

Fields:
- jurisdiction
- category
- status
- effectiveFrom
- effectiveTo
- verificationStatus
- sourceIds
- createdAt
- approvedAt

### POLICY_RULE
`PK=POLICY#policyId`, `SK=RULE#ruleId#version`

Fields:
- ruleType
- inputs
- formula
- eligibility
- exclusions
- compatibility
- cap
- priority
- sourceLocator

### POLICY_CHANGE
`PK=POLICY#policyId`, `SK=CHANGE#timestamp`

Fields:
- oldVersion
- newVersion
- changedFields
- detectedAt
- reviewStatus
- reviewer

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
`PK=ANALYSIS#analysisId`, `SK=BENEFIT_CALC#timestamp`

Store:
- policy versions
- rules
- candidate benefits
- excluded benefits
- final stack
- total
- timestamp

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
