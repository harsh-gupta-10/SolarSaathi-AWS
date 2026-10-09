# SolarSaathi — Architecture

## High-level

```text
Next.js / Amplify
        │
        ▼
API Gateway
        │
        ▼
Lambda services
 ┌──────┼────────┬────────────┬───────────────┐
 ▼      ▼        ▼            ▼               ▼
Solar  Policy   Financial   Application     AI
API    Engine   Engine      Tracker         Advisor
 │      │        │            │               │
 ▼      ▼        ▼            ▼               ▼
Google DynamoDB deterministic DynamoDB      Bedrock
Solar    + S3   calculations  + S3
 │
 ▼
3D normalized roof model
```

## Scheduled policy pipeline

```text
EventBridge
    ↓
Crawler Lambda
    ↓
official web/PDF sources
    ↓
S3 raw documents
    ↓
parser/extractor
    ↓
candidate facts
    ↓
validator
    ↓
DynamoDB policy version
    ↓
approval queue
    ↓
active policy
```

## Core AWS services

### Amplify Hosting
Next.js hosting.

### Cognito
Authentication and Google federation.

### API Gateway
Public backend API.

### Lambda
- roof service
- policy service
- calculation service
- application service
- advisor service
- crawler jobs
- change detection
- notifications

### DynamoDB
Source of truth for:
- users
- organizations
- properties
- analyses
- policy data
- applications
- leads
- designs
- accessory catalog

### S3
- policy source documents
- generated rooftop concept images
- generated reports
- private user documents
- derived thumbnails

### EventBridge
- scheduled source crawls
- stale-policy checks
- optional reminders
- asynchronous processing

### Bedrock
- grounded text advisor
- policy extraction/classification
- rooftop concept generation where model/region access exists

### CloudWatch
- logs
- metrics
- crawler failures
- stale sources
- model failures
- alarms

## External integrations

### Google Geocoding
Address → coordinates.

### Google Solar API
Coordinates/building → solar building insights.

Do not use Google Solar API as a government policy source.

## Region considerations

Keep AWS regions configurable.

Some Bedrock image models may not be available in the application's primary AWS region. The image-generation adapter must support a configured Bedrock region/model and fail gracefully to a deterministic 3D/template concept.

## Policy engine boundaries

```text
Policy DB → eligibility engine → subsidy optimizer → financial engine
                                     ↓
                              user explanation
                                     ↓
                                   Bedrock
```

Bedrock does not sit between policy facts and arithmetic. The Phase 13 advisor
loads only owned context and builds deterministic fact cards. A configured
Bedrock model may select card IDs for relevance; the server validates the IDs
and composes the answer from original card statements and citations. A model
failure keeps the deterministic cards available. See [advisor design](advisor.md).

## Caching

Cache:
- Google Solar responses where permitted
- policy source content
- normalized policy facts
- international research
- rooftop design templates
- generated design assets

Every cache has TTL/version rules.

## Observability

Every policy calculation should emit:
- policy version IDs
- rule IDs
- analysis ID
- application ID where relevant
- calculation timestamp
