# International Policy Fallback

## Strategy

India receives curated, continuously monitored policy intelligence.

Other countries use on-demand authoritative research first.

## Flow

```text
User address
 ↓
country / region
 ↓
India?
 ├─ YES → internal policy database
 └─ NO
     ↓
identify government/utility jurisdiction
     ↓
live authoritative search
     ↓
extract incentives/process
     ↓
validate source
     ↓
present "live researched"
     ↓
temporary cache
```

## Requirements

International results must show:
- country
- state/province/region
- utility where relevant
- scheme name
- benefit
- eligibility
- source
- source date
- retrieval time
- confidence
- "not yet curated" label if not in the verified policy database

## Do not claim

- worldwide completeness
- guaranteed eligibility
- guaranteed amount
- guaranteed processing time

## International caching

Cache by:

```text
country
region
utility
policy query
source version
```

Set a shorter TTL than curated India policy.

## Expansion

When a country becomes strategically important:
- promote sources to the source registry
- define schemas
- create tests
- establish policy owner/approval
- move from live research to curated policy
