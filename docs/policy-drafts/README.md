> **Status update, 2026-10-11 (after the research above):** two of the code blockers listed below were resolved on the
> owner's instruction, in code that is **not deployed yet**: (1) the four hosts (`cdnbbsr.s3waas.gov.in`, `solar.delhi.gov.in`,
> `solarcitiesportal.upneda.org.in`, `www.apdcl.org`) are now in `OFFICIAL_POLICY_HOSTS_V1`, each bound to its own source type and
> jurisdiction; (2) the PDF page cap is 80 instead of 50 (the three PDFs are 1.0-1.5 MB, under the 2 MB byte cap).
> Still open: the `robots.txt` handling for `mnre.gov.in` (returns HTML) and the slow `cdnbbsr` robots file, the missing effective
> dates on the UP draft, Delhi's missing Gazette, and the `FILL_FROM_ARCHIVE` offsets. The Assam copy is hosted by a DISCOM; prefer
> the Power Department's own file when it is found.

# Policy draft pack (researched 2026-10-11)

**DRAFT - NOT VERIFIED - requires admin review and publication.** Nothing in this folder is a verified policy fact.
It is research input for two human policy admins. No file here is read by the product, and no AWS or admin API was
called to produce it.

## What is in the pack

| File | Content |
|---|---|
| `central-pm-surya-ghar.json` | Central PM Surya Ghar residential CFA rule draft (TIERED_KW, 2 kW at Rs 30,000 then 1 kW at Rs 18,000) |
| `state-up.json` | Uttar Pradesh: Rs 15,000/kW, max Rs 30,000, additive. Blocked on an effective date |
| `state-as.json` | Assam: Rs 15,000/kW up to 3 kW, additive. Drafted from the Power Department notification |
| `state-dl.json` | Delhi: Rs 26,000/kW up to 3 kW, max Rs 78,000. Blocked on the Gazette notification |
| `state-coverage.md` | Every state checked, its status, and the exact URLs |

Each JSON has `sourceRegistration` (what to register), `document` (title, publisher, date, sha256 of the file I
fetched), `draftRequest` (the exact body for `POST /v1/admin/policy/benefits/drafts`: `benefitId`, `sourceId`,
`documentId`, `documentVersion`, `locator`, `quotedEvidence`, `rule`, `clauseEvidence`) and `reviewerNotes`.

## Read this first: the pack cannot be loaded as-is

I read `packages/policy/src/sources.ts`, `fetch-official.ts`, `apps/api/src/policy/crawler.ts`, `service.ts` and
`publication-service.ts`. The code, not the policy, blocks all four drafts today:

1. **Host registry.** `OFFICIAL_POLICY_HOSTS_V1` contains only `mnre.gov.in`, `solarrooftop.pmsuryaghar.gov.in` and five
   Maharashtra hosts. The central PDF lives on `cdnbbsr.s3waas.gov.in` (MNRE's CDN), UP on `solarcitiesportal.upneda.org.in`,
   Assam on `www.apdcl.org`, Delhi on `solar.delhi.gov.in`. None is registered. A reviewed code change adding each
   host with its sourceType and jurisdiction is needed first (the registry exists so callers cannot self-assign authority).
2. **50-page limit.** `crawler.ts` and `ingestDocument` reject PDFs over 50 pages (`PAGE_LIMIT`). The MNRE guideline PDF is
   57 pages and the Assam policy is 52. UP (46 pages) and the Delhi HTML page fit. Splitting an official PDF would break
   the "exact official bytes" premise, so the limit needs an owner decision.
3. **robots.txt.** `checkRobots` accepts only 200 `text/plain`, 404 or 410. `mnre.gov.in/robots.txt` answers 200 with
   `Content-Type: text/html`, and `cdnbbsr.s3waas.gov.in/robots.txt` timed out (504) on 2026-10-11, so both would raise
   `ROBOTS_UNAVAILABLE`. A manual upload (`POST /v1/admin/policy/documents`, `contentBase64`, max 2,000,000 bytes) still
   needs a registered host, and a `documentUrl` on that host, so it does not avoid items 1 and 2.
4. **Reciprocal edges.** The engine counts central + state only if BOTH rules carry an edge of the same mode to each
   other (`pairAllowed` in `benefit-stacking.ts`). The central draft already lists edges to the three state benefit IDs
   (`BENEFIT#IN_DL_...`, `BENEFIT#IN_UP_...`, `BENEFIT#IN_AS_...`). Adding another state later means publishing a new
   version of the central rule with one more edge.
5. **Special-category states.** The guideline pays Rs 33,000/Rs 19,800 per kWp in special-category States/UTs
   (Uttarakhand, Himachal Pradesh, J&K, Ladakh, North East including Sikkim and Assam, A&N, Lakshadweep). A CENTRAL rule
   must use jurisdiction `IN` and the schema has no state condition, so the central draft carries only the general
   Rs 30,000/Rs 18,000 rates. Homeowners in those places will see a lower central figure than the guideline allows.
   Do not add a second `IN` rule to fix this; it would double count.

## Steps for the two admins

Roles are enforced by `publication-service.ts`: author, source curator and publisher must be three different people in
Cognito group `ADMIN_POLICY` (or `ADMIN`); the publisher is neither the author nor the curator. Follow
`docs/runbook-pm-surya-ghar-publication.md` for the console clicks.

1. The owner resolves blockers 1 to 3 above (code change, reviewed) for the sources you intend to use.
2. Register sources in this order, then curate each and wait for crawl state `READY`:
   1. Central MNRE guideline PDF (`central-pm-surya-ghar.json` -> `sourceRegistration`).
   2. Each state source you will publish (UP, Assam, Delhi) from its JSON.
3. Author each draft from the ARCHIVED text only. For every quote, copy `charStart`/`charEnd`, `pageNumber` and
   section/fragment from the archived chunk; the server rejects a quote that is not an exact slice of one chunk at those
   offsets. My quotes are verbatim from the files I fetched with whitespace collapsed; the archive's extraction can
   differ. If it does, re-select the passage in the archive. Never change a number to make a quote fit.
4. Order of drafts: states first, central last (see blockers, item 4). Fill every `TODO_*` (Delhi and UP effective dates)
   from the official instrument named in that file; a draft with a TODO must not be submitted.
5. Author submits. A different admin (not author, not source curator) compares every number and clause against the
   archive, records a reason, and publishes. Rules take effect only on publication; before that they are unverified.
6. Verify with the homeowner flow for a UP, Delhi and Assam address, per the runbook, including the "More eligibility
   details" questions. Expect an Assam address to be central-understated (blocker 5).
7. Re-crawl within the 48 h freshness window. Dynamic pages (Delhi portal) change bytes and will make the rule stale;
   prefer the Gazette PDF.

## Why everything stays unverified until approved

`AGENTS.md`: government policy may not be hardcoded as a source of truth, LLM or research output must pass deterministic
validation and an admin approval gate, and conflicts must be marked rather than guessed. This pack was assembled by a
research agent. A human must confirm each number and clause against the archived official document before it becomes a
verified, versioned rule.

## Limitations

- Only official government hosts count as evidence. News and blogs were used only to discover documents and are not cited
  as evidence. Press-reported facts that I could not tie to an official document are listed in `state-coverage.md` as
  leads, not rules.
- I could not fetch `suryagujarat.guvnl.com` (HTTP 403), `usrp.upcl.org`, `rts.odisha.gov.in` and `state.bihar.gov.in`
  (no connection), or `solarrooftop.pmsuryaghar.gov.in` (no connection). `pmsuryaghar.gov.in` is a JavaScript app that
  returns no policy text to a plain fetch. `energy.rajasthan.gov.in` pages are JavaScript-rendered with no text.
- The 2025-07-07 MNRE amendment OM is image-only (no text layer) so it cannot be quoted as evidence; I read it visually.
  It does not change CFA rates. A reported 31 Aug 2026 OM (Phase II claim deadline) has no MNRE original that I could find.
- "No verified state incentive found" means: not found in the official pages and searches I ran on 2026-10-11. It is not
  proof of absence and several of those entries rest on search results rather than a full read of every state page.
- The rule schema cannot express: income tests, household-count limits, cost-linked caps (Delhi, Haryana), first-come
  budgets, special-category regions, or GHS/RWA formulas. Each draft says where it simplifies.
- Dates in `effectiveFrom`/`effectiveTo` are copied from the document where it states them; where it does not, the field
  holds a `TODO_*` marker instead of a guess.
