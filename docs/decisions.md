# Architecture Decisions

## ADR-001 — AWS-first
AWS is the primary cloud stack because the hackathon requires meaningful AWS usage and the product benefits from managed services.

## ADR-002 — DynamoDB source of truth
All product state and policy metadata use DynamoDB. No browser-direct database access.

## ADR-003 — Deterministic financial engine
Financial and subsidy arithmetic is deterministic TypeScript.

## ADR-004 — Policy versioning
Government rules are versioned because amendments and corrections can change eligibility and amounts.

## ADR-005 — Source authority
Official sources outrank news/blogs.

## ADR-006 — Human approval for material policy changes
Automatic extraction can propose a change; an authorized admin activates production policy.

## ADR-007 — Subsidy stacking is a compatibility problem
Do not sum every discovered benefit. Apply eligibility, compatibility, caps and exclusions.

## ADR-008 — India-first
India gets curated source coverage. International markets use live research until curated.

## ADR-009 — AI is an explanation layer
AI explains retrieved facts and calculations; it does not define policy or arithmetic.

## ADR-010 — 3D geometry is deterministic
Roof and solar geometry must not depend on generative AI.

## ADR-011 — Generated rooftop images are inspiration
They are not architectural/structural drawings.

## ADR-012 — S3 for generated assets
Generated images and raw policy documents are not stored in Git.

## ADR-013 — No blind image reuse
Use design fingerprints and reusable design specs, not identical property-specific images across users.

## ADR-014 — Accessories are contextual
Recommendations depend on actual system/user needs and are not generic upsells.
