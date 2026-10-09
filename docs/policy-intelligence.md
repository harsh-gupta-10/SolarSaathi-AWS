# Policy Intelligence System

## Objective

SolarSaathi needs a continuously refreshed, source-traceable policy knowledge system for solar subsidies, incentives, application rules and related benefits.

This is not a generic web scraper.

It is a **policy intelligence pipeline**.

## Local implementation state

Phases 8–9 provide typed source, document, citation, fact and policy-version
contracts; exact official-domain registration; bounded HTML/PDF extraction;
raw and normalized hashes; scheduled canonical-URL checks; and human review of
candidate quotations and document changes. Source/document versions and S3
archives are immutable. Phase 10 adds a separate human-authored, evidence-bound
benefit-rule draft and independent publication gate. A reviewer verifies the
numeric values and rule clauses against archived official excerpts before an
active version can enter deterministic homeowner evaluation. This local
workflow is deployed in development but has not been populated with live India
coverage. See [development deployment](live-deployment.md).

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
The Phase 9 local crawler monitors only explicitly registered canonical URLs.
Operators must register official circular/PDF URLs separately; bounded link
discovery and source expansion remain open work before broad live coverage.

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

The Phase 17 fallback starts from a small, explicitly reviewed official-host
registry. It can verify current pages for the United States Department of
Energy, Great Britain's Ofgem, and Australia's Clean Energy Regulator. These
are discovery starting points, not national, state, utility, or incentive
coverage. Search is optional and only proposes official-host URLs; the server
must separately fetch, validate robots rules, and pin public DNS/TLS before a
page is cited. User-entered region or utility names are unverified context;
without scoped evidence the result is incomplete. Research metadata expires
quickly and never becomes an active rule, eligibility result, or subsidy amount.

## 11. Admin approval

Phase 9 approves or rejects **evidence review records** only: document changes
and exact candidate quotations. Even approved evidence stays outside active
policy benefits. Phase 10's separate publication flow validates the current
official archive, exact excerpts, numeric values, eligibility/compatibility
clauses, effective dates, source authority and independent reviewer. Only its
atomic activation makes a verified version available to homeowners. Do not
equate evidence-review approval with active policy publication.

For Phase 12, an optional `processSteps` array can be published with a benefit
rule. Each step has a stable ID, consecutive order, required flag, title and
description. The author supplies a distinct exact archived excerpt under
`PROCESS_STEP_<index>`; publication creates a verified TEXT fact bound to that
step's semantic claim key. The application tracker can snapshot these steps
only when the benefit is selected and source checks are fresh and healthy.
No process template is inferred from a generic national sequence or from an
LLM response. Older active rules without process steps remain valid for benefit
arithmetic but cannot start a policy-specific tracker.

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

Phase 18 rollback requests select a previous verified version for separate
administrator review. Approval must revalidate the bound current official
document, source freshness, effective dates and precedence. It publishes a
new immutable version carrying the reviewed historical semantics and links to
the prior version in an activation event; it does not repoint `ACTIVE` to an
older version or delete history. Stale or withdrawn evidence blocks rollback.

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
