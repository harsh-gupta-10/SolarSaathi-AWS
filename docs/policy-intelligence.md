# Policy Intelligence System

## Objective

SolarSaathi needs a continuously refreshed, source-traceable policy knowledge system for solar subsidies, incentives, application rules and related benefits.

This is not a generic web scraper.

It is a **policy intelligence pipeline**.

## 1. Policy categories

Every benefit/rule must be classified:

- CENTRAL_SUBSIDY
- STATE_SUBSIDY
- DISCOM_INCENTIVE
- LOCAL_BODY_INCENTIVE
- REGULATORY_BENEFIT
- NET_METERING
- FINANCING
- TAX_OR_FINANCIAL_BENEFIT
- VENDOR_REQUIREMENT
- ELIGIBILITY
- DOCUMENT_REQUIREMENT
- APPLICATION_PROCESS
- DEADLINE
- CAPACITY_LIMIT
- EQUIPMENT_REQUIREMENT
- OTHER

## 2. Source hierarchy

### Tier 1 — authoritative
- Government of India
- MNRE
- official PM Surya Ghar portal
- state government / energy department
- DISCOM
- electricity regulator
- official state renewable agency
- official scheme notification/guideline/circular

### Tier 2
- government-hosted technical/regulatory documents
- official institutional portals

### Tier 3
- reputable industry sources used for discovery/cross-checking

### Tier 4
- news, blogs, forums

Tier 3/4 must not override Tier 1.

## 3. Source registry

Each source stores:

```json
{
  "sourceId": "SRC#MSEDCL#ROOFTOP",
  "name": "MSEDCL Rooftop Solar",
  "jurisdiction": "IN-MH",
  "authorityLevel": 1,
  "sourceType": "DISCOM",
  "canonicalUrl": "...",
  "crawlFrequency": "DAILY",
  "enabled": true,
  "lastCheckedAt": "...",
  "lastChangedAt": "...",
  "contentHash": "...",
  "status": "HEALTHY"
}
```

## 4. Ingestion pipeline

```text
EventBridge
 ↓
source scheduler
 ↓
fetch source
 ↓
HTML/PDF detection
 ↓
download to S3 when appropriate
 ↓
extract text/tables
 ↓
normalize
 ↓
chunk
 ↓
hash
 ↓
compare previous version
 ↓
if changed:
   extract candidate facts
   validate
   create proposed policy version
   create change record
 ↓
admin approval for material production changes
 ↓
publish
```

## 5. Policy fact schema

A policy fact must include:

```json
{
  "factId": "FACT#...",
  "policyId": "POLICY#...",
  "category": "STATE_SUBSIDY",
  "jurisdiction": "IN-MH",
  "value": 50000,
  "unit": "INR",
  "formula": null,
  "eligibility": [],
  "compatibility": [],
  "exclusions": [],
  "effectiveFrom": "YYYY-MM-DD",
  "effectiveTo": null,
  "sourceId": "SRC#...",
  "sourceDocumentVersion": 12,
  "sourceLocator": "page 4 / section ...",
  "verificationStatus": "VERIFIED",
  "confidence": 0.98
}
```

## 6. Change detection

Use:
- HTTP metadata where available
- content hash
- document hash
- normalized text diff
- table diff
- extracted fact diff

Do not create a new policy version just because a page changed cosmetically.

Material changes include:
- amount
- eligibility
- cap
- system-size rule
- application process
- required document
- deadline
- vendor requirement
- compatibility
- geographic scope

## 7. Conflict detection

If two sources disagree:

1. compare effective dates
2. compare authority levels
3. compare document type
4. compare whether one is an amendment
5. check jurisdiction
6. check whether one is stale
7. if unresolved, flag `POLICY_CONFLICT`

Never silently choose a lower-authority value.

## 8. Source citation

Every user-facing policy result must be traceable to:
- organization
- source URL
- document title
- publication/effective date when available
- source version
- retrieval timestamp
- relevant page/section where possible

## 9. India source discovery

Initial source registry must include official sources for:
- MNRE
- PM Surya Ghar
- Maharashtra Energy Department
- MSEDCL
- Maharashtra regulator
- MEDA
- progressively all Indian states and DISCOMs

The crawler should discover new official pages but must not automatically trust arbitrary discovered domains.

## 10. International mode

For non-India:
- identify country/state/province/utility
- find official energy authority
- find official incentive page
- find utility rules
- retrieve current documents
- return a live research result
- cache temporarily
- do not promote to authoritative curated policy until reviewed

## 11. Admin approval

Material changes go:

```text
DETECTED
→ EXTRACTED
→ VALIDATED
→ PENDING_APPROVAL
→ APPROVED
→ ACTIVE
```

Rejected:
`PENDING_APPROVAL → REJECTED`

A rollback should restore a previous verified version without deleting history.

## 12. Staleness

Policy records should have:
- `lastVerifiedAt`
- `freshnessWindow`
- `staleAfter`

If stale:
- warn admin
- reduce confidence
- optionally prevent "verified" language
- never silently present stale policy as current

## 13. LLM role

Bedrock may:
- extract candidate facts
- summarize
- classify
- explain
- answer grounded questions

Bedrock may not:
- invent subsidy values
- override deterministic rules
- decide source authority
- silently merge conflicting policies
- alter published policy data

## 14. Failure behavior

If crawling fails:
- retain last verified policy
- show its verification date
- mark source as stale if threshold exceeded
- never replace with guessed data

If extraction fails:
- keep old active policy
- create failed ingestion record
- alert admin
