# SolarSaathi — Agent Contract

You are the coding agent for SolarSaathi, an India-first rooftop-solar decision and assistance platform.

## Read first
Before changing code, read:
1. `docs/project.md`
2. `docs/phases.md`
3. `docs/architecture.md`
4. `docs/policy-intelligence.md`
5. `docs/subsidy-stacking.md`
6. `docs/database.md`
7. `docs/api.md`
8. `docs/ui.md`
9. `docs/calculations.md`
10. `docs/accessories.md`
11. `docs/security.md`
12. `docs/testing.md`
13. `docs/demo.md`

Then read the nearest package/app `AGENTS.md`.

## Non-negotiable architecture
- AWS is the primary cloud platform.
- Use AWS Amplify Hosting, API Gateway, Lambda, DynamoDB, S3, EventBridge, CloudWatch, Cognito, and Amazon Bedrock where specified.
- Do not introduce AWS, Firebase, Supabase, Vercel, Netlify, or another replacement platform.
- Google Maps/Geocoding/Solar API are external integrations, not substitutes for AWS.
- Browser code must not contain AWS secrets, Google server keys, or privileged policy credentials.
- DynamoDB is accessed through backend APIs, never directly from the browser.
- Financial calculations and subsidy eligibility are deterministic code. LLMs explain results; they do not invent or decide them.

## Policy intelligence rules
- India is the primary policy market.
- Never hardcode a government subsidy as the source of truth when a verified policy record exists.
- Model central, state, DISCOM, municipal/local-body, utility, financing and other incentives separately.
- Never double-count overlapping benefits.
- A state incentive may be additive, conditional, capped, mutually exclusive, or unavailable. Determine the rule from authoritative sources.
- Always show source, jurisdiction, effective date, policy version, verification status, and last-checked time for user-facing policy facts.
- Prefer official government, MNRE, state energy departments, DISCOMs, regulators, scheme portals and official circulars.
- Treat news/blogs as discovery sources, not authoritative policy sources.
- Version policy data. Never silently overwrite historical policy facts.
- LLM extraction must pass deterministic validation and, for production policy changes, an admin approval gate.
- If sources conflict, do not guess. Mark the conflict and prefer the highest-authority current source.
- International policy lookup is on-demand and must be labelled as live/researched until curated and verified.

## Subsidy stacking
The product must calculate:
`eligible central benefit + eligible state benefit + eligible local/other benefit`, subject to each scheme's compatibility, caps, exclusions, timing and beneficiary rules.
Do not assume that all programs stack. Do not claim "maximum possible subsidy" until the compatibility engine has checked every applicable rule.

## Solar engineering safety
- Google Solar API and deterministic geometry are the source for roof/solar measurements.
- AI-generated rooftop concepts are inspirational only, not structural or engineering approvals.
- Never claim a pool, heavy structure, battery, gym, water tank, etc. is structurally safe from roof area alone.
- Preserve solar-panel clearance and service paths.
- Use "space-feasible" when only geometry/area has been checked.

## AI rooftop design
- Deterministic feasibility first.
- Reusable design templates are stored in S3/DynamoDB, not Git.
- Use normalized fingerprints to reuse similar concepts.
- Never blindly reuse an image from another property as if it were property-specific.
- Bedrock image generation is optional. A deterministic 3D concept or template must remain available if image generation is unavailable.

## Coding workflow
- Implement one phase at a time from `docs/phases.md`.
- Prefer small, typed modules with explicit interfaces.
- Validate all user input server-side.
- Add tests for calculations, policy stacking, source precedence, cache behavior, and application state transitions.
- Run lint, typecheck, tests, and build after meaningful changes.
- Do not fabricate API responses or government policy values in production code. Use fixtures only in tests/demo mode.
