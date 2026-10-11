# Runbook — publish the PM Surya Ghar central residential benefit (2026-10-11)

Why: every homeowner currently sees "No verified subsidy rule is published for your area yet" because the policy
catalog is empty (`NO_ACTIVE_VERIFIED_RULES`). The only allowed fix is the admin workflow below. Nothing in this
runbook is a policy value: every number must be copied from the archived official document during review.

## Decisions taken

| Decision | Choice | Reason |
|---|---|---|
| Scheme | PM Surya Ghar: Muft Bijli Yojana — Central Financial Assistance (CFA) to residential consumers | Covers the main homeowner case; central scope applies in every state |
| Source document | The **current MNRE operational guidelines for CFA to the residential sector**, downloaded from `mnre.gov.in` (fallback: the official notification on `pmsuryaghar.gov.in`) | Highest-authority, stable PDF. The portal's dynamic web pages change bytes often and would make the rule stale (raw-sha freshness check) |
| Not authoritative | News sites, blogs, DISCOM mirrors of the PDF (e.g. a JBVNL-hosted copy) | Discovery only — use them to find the MNRE original, never as the cited source |
| Rule shape | `scope: CENTRAL`, `jurisdiction: IN`, benefit kind `TIERED_KW` | Matches how the guideline expresses per-kW support with a capacity cap |
| Reviewers | Two different people in Cognito group `ADMIN_POLICY` (author ≠ publisher ≠ source curator) | Enforced by `publication-service.ts`; the owner must name them |

Open check before authoring: a 2026 revision of the CFA guidelines has been reported. Use whichever version MNRE lists
as current, and set `effectiveFrom`/`effectiveTo` exactly as that document states (the scheme was approved to run to
FY 2026-27, so confirm whether an extension notice exists; publish fails if the rule is not in effect today in IST).

## Steps

1. **Register source** (Admin A, `/app/policy-admin` → Sources): official MNRE PDF URL, publisher MNRE, type `MNRE`
   or `OFFICIAL_NOTIFICATION`, jurisdiction `IN`, scope `CENTRAL`. Then **curate** it.
2. **Crawl**: wait for the 15-minute crawler or trigger a crawl. Confirm crawl state `READY` and the archived document
   (hash, derived text) in the console.
3. **Author draft** (Admin A or C), from the archived text only:
   - tiers (kW bounds and per-kW support) and any cap, copied verbatim;
   - eligibility conditions exactly as written — expected to include residential customer type, grid-connected,
     no prior rooftop-solar subsidy, approved vendor / domestically manufactured modules if the text requires them;
   - `quotedEvidence`: one exact chunk containing every number; one `clauseEvidence` excerpt per clause key
     (effective period, cap, each eligibility and compatibility clause). Submit.
4. **Publish** (Admin B, not author or curator): compare every number and clause against the archive, record a reason,
   publish. This writes the ACTIVE pointer under GSI5 `ACTIVE_POLICY_BENEFITS#IN`.
5. **Verify**: read-only query `GSI5PK = ACTIVE_POLICY_BENEFITS#IN` returns one bundle; run the homeowner flow
   (Step 6) answering every question, including "More eligibility details". Expected result: the rule is listed as
   Included with its citation, and a subsidy-adjusted estimate appears.
6. **Keep it current**: the source must be re-crawled within its freshness window (48 h). If MNRE replaces the PDF,
   a new draft must be authored and published; the old version stays in history.

## If the homeowner still sees no estimate

| Message shown | Meaning | Action |
|---|---|---|
| No verified subsidy rule is published for your area yet | No ACTIVE pointer | Steps 1–4 not complete |
| The official sources could not be re-checked recently | Source stale / crawl failed / document changed | Check crawl health; re-publish if the PDF changed |
| No benefit could be confirmed from your answers (rule shows "To include this rule: …") | Unanswered condition | Homeowner answers the listed question |
| The benefit check is temporarily unavailable | Integrity or service error (503) | Check API logs for the rule/version ID |
