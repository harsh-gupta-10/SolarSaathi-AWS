# Remediation Plan — Audit of 2026-10-11

Status of the codebase at audit time: lint, typecheck, 851 tests and build all pass. The
deterministic engines (financials, PM Surya Ghar slab maths, stacking search, tenant
isolation) are sound. The problems are concentrated in recent UI/demo work and in a
"baseline" policy path that bypasses the verification pipeline. None of them are caught by tests.

Severity: **P0** = violates AGENTS.md non-negotiables / shows users false facts.
**P1** = functional bug or broken flow. **P2** = UX/quality. **P3** = docs/hygiene.

---

## Progress (2026-10-11, `pnpm check` green, 857 tests)

- **Done:** A1-A10 (A9 relabelled as illustrative and unsourced rather than removed), B1-B11, B13, B14, C2, C3 (partial), C4, C6 (partial), C9 (partial), D1, E1-E5.
- **Behaviour decisions:** no policy amounts until a verified rule is published (option a); GPS auto-fetch kept but now only centres the map and never picks a building; Google sign-in button stays off (deliberate in an earlier commit); consumer/CA number is no longer collected.
- **Still open:** B12 (add property-type and prior-subsidy conditions when the real PM Surya Ghar rule is authored); C1 full split of `analyze-start.tsx` (stepper extracted so far); C5 design-system consistency for My Properties; C7 policy badges on every money figure; D2 (server keys at runtime), D3 (`dynamodb:LeadingKeys`), D4 (expose financial assumptions); E6-E7.

---

## Phase A — Stop showing fabricated data (P0)

| # | Problem | Location | Fix |
|---|---------|----------|-----|
| A1 | Baseline policy catalog marked `VERIFIED` with fabricated SHA-256s (`SHA_ZERO` = empty-string hash, `SHA_MH` = same +1), `"a".repeat(64)` content hashes, invented citations/quotes/reviewer IDs, `healthStatus: HEALTHY` hardcoded | `packages/policy/src/baseline-catalog.ts:29-31,44,67,119-324,351,381` | Move to test/demo fixtures only (`verificationStatus` non-VERIFIED, `DEMO` label). Real PM Surya Ghar data must come through ingest → validation → two-admin approval with the actual MNRE document archived in S3. |
| A2 | `evaluateBaselineBenefitsV1` fakes `lastCheckedAt: now`, `sourceHealth: HEALTHY`, coverage `state: true` for any state | `baseline-catalog.ts:525,536,556-618` | Delete from production exports (`@solarsaathi/policy/baseline`); keep only under demo. |
| A3 | Browser overrides server `UNAVAILABLE` (incl. stale/storage-failure) by running baseline client-side, relabels `AVAILABLE`, uses `nominalKw*1000` instead of actual DC watts | `apps/web/src/components/benefit-evaluator.tsx:7,177-235` | Remove fallback entirely. Render server status + reason codes honestly ("No verified rules yet for your state"). |
| A4 | Seeder writes ACTIVE pointers with unconditional `PutCommand` (overwrites history), crawl `nextDueAt = 2147483647`, S3 "archives" are metadata JSON and silently fail bucket If-None-Match policy | `scripts/seed-policy-storage.ts:26-152` | Restrict to non-prod/demo, or rewrite to submit drafts into the publication workflow with conditional writes. Never touch ACTIVE pointers directly. |
| A5 | Hardcoded `estimatedSubsidyRupees: 78000`, "₹78,000" fallback, summed into a total; fabricated `roofAreaSquareMeters: 100`, `segmentCount: 2`, kW = `kWh/120` | `apps/web/src/components/my-properties-workspace.tsx:108-111,210,380-382` | Show only server-computed values with source/version/verification badge; otherwise "Not yet evaluated". |
| A6 | `ensureDefaultProperties` silently seeds two sample properties (with subsidy/payback/net cost) into every account | `apps/web/src/lib/properties-store.ts:28-75,144-148` | Delete. |
| A7 | Sample roof labelled `source: "GOOGLE_SOLAR"` with fake `analysisId`; sets `buildingConfirmed` without backend; restored properties also labelled GOOGLE_SOLAR | `apps/web/src/components/analyze-start.tsx:100-115,459-528` | Remove from `/app`; samples live only under `/demo` with `source: "DEMO_FIXTURE"`. |
| A8 | Sample/auto-fill buttons visible to all users; eligibility answers (ownership, no prior subsidy, approved vendor) auto-filled; advisor presets inject fixed ₹1.8L/3 kW scenario | `analyze-start.tsx:628-632,1289,1331`; `my-properties-workspace.tsx:169,230,332`; `system-designer.tsx:64-90`; `benefit-evaluator.tsx:257-286`; `advisor-workspace.tsx:32-50` | Gate behind a single `isDemoMode()` flag (off in prod), or remove. |
| A9 | Unsourced price tiers ₹50k–82k/kW, tariff/APPC/"90% self-consumption" presets in production | `packages/calculations/src/planning-assumptions.ts:84-161` | Mark as user-editable assumptions with explicit "indicative, unsourced" label, or remove until a sourced price catalog exists (Phase 14). |
| A10 | Legacy `calculateSubsidy` (flat per slab — wrong) and `calculateFinancials` still exported | `packages/calculations/src/index.ts:2-4`, `subsidy.ts`, `financial.ts` | Delete + their scaffold tests. |

**Tests to add:** UI never renders a rupee subsidy without provenance; benefit-evaluator shows UNAVAILABLE when server says so; demo-only controls absent when demo flag off; production bundle does not import `@solarsaathi/policy/baseline`.

---

## Phase B — Functional bugs (P1)

| # | Problem | Location | Fix |
|---|---------|----------|-----|
| B1 | Longitude set to latitude | `analyze-start.tsx:247` | `setLongitude(data.roof.center.longitude…)` + regression test. |
| B2 | GPS auto-fetch: stale closure over status/profile/propertyId, spinner never clears on error, address "lat° N, lng° E" hardcoded hemisphere, fabricated `locationType: "ROOFTOP"`, auto-selects building (contradicts `docs/demo.md`) | `analyze-start.tsx:188-252` | Delete auto-fetch; keep `locateOnce` (`:340`) which centres map only and requires user building selection. |
| B3 | Sample/local `prop-*` IDs passed to real `SystemDesigner` → backend 404s | `analyze-start.tsx:1317` | Falls out of A7; also guard on a backend-confirmed propertyId. |
| B4 | `createProperty` failure silently creates local `prop-` record and says "added to your account"; delete relies on `prop-` prefix | `my-properties-workspace.tsx:88-95,130` | Backend is source of truth; surface errors; no local fallback. |
| B5 | localStorage holds addresses + consumer/CA numbers under a shared `"default"` key, survives sign-out (docs say tab sessionStorage only); sync only adds, never removes; only first page fetched | `properties-store.ts:84-180`; `my-properties-workspace.tsx:39-59` | Replace store with API-backed list (paginate), optional non-PII draft in sessionStorage; clear on sign-out; don't render until auth status resolved. |
| B6 | DELETE property (uncommitted) leaves orphans: `APPLICATION#`+`EVENT#`, `DESIGN#`/`DESIGN_CLAIM#`, `CACHE#{propertyId}#…`, broker `PROPOSAL#`, S3 design images; purge capped at 20×25 and failures swallowed | `apps/api/src/data/repository.ts:89`; `service.ts:239-242` | Purge all child prefixes + S3 objects, loop until done (or async via EventBridge), log + alarm on failure, tests per prefix. Document in `docs/api.md`. |
| B7 | Marketing CTAs send signed-in users to sign-in while auth is loading | `apps/web/src/components/marketing-auth-actions.tsx:14,49,71` | Treat `loading` as pending (disabled/spinner). |
| B8 | No return URL after sign-in; "Create account" = "Sign in"; Google button never rendered despite `googleEnabled` | `auth/sign-in-panel.tsx:15-42`; `app/auth/callback/page.tsx:13` | Add `returnTo` (same-origin validated), distinct sign-up action, render Google when enabled. |
| B9 | "Savings" nav dead-ends at "in development … Phase 7" though estimator exists | `apps/web/src/app/app/[section]/page.tsx:29-41` | Wire to financial estimator for the selected property. |
| B10 | Stacking: CONDITIONAL edge with unknown facts reported as EXCLUDED instead of UNKNOWN-with-missing-facts | `packages/policy/src/benefit-stacking.ts:229-230` | Return UNKNOWN + list required facts. |
| B11 | Combined-cap attribution depends on `benefitId` sort order | `benefit-stacking.ts:235-253`; `policy-financials.ts:415-417` | Deterministic precedence (central → state → local → other) and test. |
| B12 | PM Surya Ghar rule lacks property-type / prior-subsidy conditions (apartments/RWA get individual slab) | baseline rule / future verified rule schema | Add conditions when verified rule is authored; add apartment/RWA test. |
| B13 | `listAnalyses` post-query filter can return empty page with `nextCursor` | `apps/api/src/data/service.ts:289` | Loop until page filled or use key condition. |
| B14 | Benefits API only loads source/document of `facts[0]` | `apps/api/src/benefits/service.ts:102` | Load all facts' sources. |

---

## Phase C — UX / UI quality (P2)

1. **Split `analyze-start.tsx` (1339 lines, 26+ `useState`)** into `Stepper`, `AddressStep`, `BuildingStep`, `RoofStep`, `SystemStep`, and a `useRoofAnalysis` reducer hook; removes hand-maintained reset effect (`:63-78`) and triplicated step markup (`:549-620`).
2. **Make the journey linear and contextual:** Analyze → Roof → System → Benefits → Savings → Applications/Advisor, carrying `propertyId` through the URL. Advisor link from My Properties must pass property context (`my-properties-workspace.tsx:~410`).
3. **`/app` signed-out state:** single clear "Sign in to save" prompt + one link to `/demo`; remove duplicate demo-link blocks (`analyze-start.tsx:637-674`).
4. **Remove "quick search" city landmark chips** (`analyze-start.tsx:275-292,794`) — they let a landmark be saved as a home.
5. **Design-system consistency:** My Properties uses ad-hoc Tailwind/emerald/amber; move to `globals.css` tokens / `packages/ui`. Remove emoji/glyphs and promotional copy (`docs/ui.md`).
6. **Accessibility:** `aria-hidden` on step number badges (`analyze-start.tsx:559-562`), move focus to step heading on change, `role="status"` on notices (`my-properties-workspace.tsx:182`), confirm dialog on delete (`:154`), clear `setTimeout`s on unmount (`:74,124`).
7. **Policy badges everywhere money appears:** source, jurisdiction, effective date, version, verification status, last-checked.
8. **Empty states** for "no verified rules for your state" that explain what's missing rather than show ₹0.
9. Move Benefits/Help long single-line JSX in `[section]/page.tsx:26,29` into components.

---

## Phase D — Backend hardening (P2)

1. Cache Cognito `GetUser` per token (short TTL) instead of per request (`apps/api/src/auth/cognito.ts:107`).
2. Read Google/Brave server keys from Secrets Manager at runtime rather than resolving into Lambda env (`infra/sam/template.yaml:312,316,550`).
3. Consider `dynamodb:LeadingKeys` IAM conditions for defence-in-depth.
4. Expose (or document as fixed) degradation/escalation assumptions (`financials/service.ts:65`); cross-check bill-derived demand vs entered tariff.
5. Tests: CONDITIONAL / overlap / ALTERNATIVE / SEQUENTIAL / NOT_STACKABLE, PM Surya Ghar >3 kW and fractional kW, apartment eligibility, seeder idempotency, cash flow turning negative.

---

## Phase E — Docs & hygiene (P3)

1. Reconcile deployment status: `README.md:49-56` / `docs/live-deployment.md` (dev stack live) vs `docs/phases.md:18,78,297,344` ("nothing deployed").
2. Correct `docs/phases.md` statuses: Phase 1, 2, 4 (`/solar/analyze` still 501), 7, 8 (`GET /v1/policies*` documented, no route), 10–14, 16 are partial.
3. `docs/api.md`: add DELETE property; fix "planned" list that repeats implemented routes (`:290`); remove or implement `/v1/policies*`.
4. `docs/tree.md`: add `packages/policy`, `scripts/`, `.github/workflows`, `amplify.yml`, missing docs and package AGENTS.md.
5. `docs/architecture.md`: mention Secrets Manager, Brave Search, Amazon Location.
6. Document `isDemoMode` flag, `pnpm policy:seed` scope, test count (851).
7. Remove AWS account ID from public docs if repo is public; move `google-cloud-sdk/` (515 MB) out of the working tree; drop placeholder `public/` and `database/README.md` if unused.

---

## Execution order

1. **Commit or stash** the in-progress DELETE-property work, then fix B6 on top of it.
2. **Phase A** in one PR (it is mostly deletion + a demo flag) — highest risk to users.
3. **B1–B5, B7–B9** (web bugs) — small, independent PRs.
4. **C1** (split analyze-start) before other UX work, since most UX items touch it.
5. **B10–B14, Phase D** (backend) in parallel with C.
6. **Phase E** last, reflecting the final state.

Run `pnpm check` after each PR.
