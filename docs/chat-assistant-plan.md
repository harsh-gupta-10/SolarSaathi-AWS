# Chat-First SolarSaathi — Audit and Plan (2026-10-11)

Goal: when a user opens SolarSaathi it should feel like a chat assistant. They ask about solar, and the assistant
gets work done: finds and confirms the roof, sizes a system, prepares an indicative quotation from researched
prices, checks benefits, and prefills the application checklist. Guardrails keep it on-topic, honest about numbers,
and safe with personal data. The marketing site and forms are redesigned to match.

This plan respects `AGENTS.md`: deterministic code computes every number and eligibility decision; the model
explains and orchestrates. AWS remains the platform (Bedrock, Lambda, DynamoDB, Cognito).

---

## 1. Audit summary

### 1.1 Current advisor
- `POST /v1/advisor/solar` (`apps/api/src/handlers/chat.ts`, `advisor/service.ts`). A regex picks the intent, and the
  server builds fixed "fact cards". Bedrock Converse (`advisor/bedrock.ts`) only **selects card IDs**, so the user's
  question never reaches the model and model prose never reaches the user.
- No streaming, no conversation history, no Bedrock Guardrails, no per-user quota (stage throttle only, 10 rps).
  `AdvisorBedrockModelId` is empty in dev, so the deterministic fallback always runs.
- IAM grants `bedrock:InvokeModel` only; streaming needs `bedrock:InvokeModelWithResponseStream`.
- Transport is API Gateway REST (29 s integration limit, Lambda timeout 28 s), which is too tight for multi-tool turns.

### 1.2 Capabilities a chat agent can call (already deterministic, ownership-checked, in-process callable)
Read-only: list/get properties and analyses, `systems/recommend`, `financials/estimate`, `benefits/evaluate`,
`financials/policy-backed/estimate`, `accessories/recommend`, `designs/recommend`, applications list/get/events.
External/paid: `solar/geocode`, `solar/building-insights`, `designs/generate` (IMAGE).
Mutating, which needs explicit user confirmation: create property, confirm building/roof, create application, step/details/
document updates, delete property, broker proposals. `POST /properties`, `/applications`, `/designs/generate` have
**no idempotency key**; model retries could create duplicates.

### 1.3 Quotation and forms
- No quotation, installer or price-catalog model exists. "Quote" is a number the user types. `vendorName` is free text.
- PM Surya Ghar portal needs: state, DISCOM, consumer number, mobile/OTP, roof and system details, bill, Aadhaar,
  property proof, bank/IFSC, vendor selection, commissioning and net-meter documents. We store a small subset by
  design; Aadhaar and bank data are outside `security.md`.
- Forms (financial estimator, benefit evaluator, system designer, application tracker) share problems:
  - Errors are shown once per form rather than per field.
  - Inputs are 36 px tall, below the 44 px touch target.
  - Currency inputs have no ₹ prefix or Indian digit grouping.
  - Fields ask for internal IDs (district/DISCOM/scheme codes).
  - A preset select plus a number input sits on every financial field (11 controls for 6 values).
  - Document type is free text.

### 1.4 Price research (web)
- No official machine-readable price list exists. Official anchors: the MNRE benchmark (Feb 2024: ₹50k/kW for the
  first 2 kW, ₹45k/kW after) and state DISCOM tender/benchmark rates (e.g. MSEDCL ₹45,450/kW, 2026).
  Almost everything else online is installer marketing with conflicting numbers, roughly ₹50–75k/kW for DCR on-grid.
- Claude's built-in web search and web fetch are **not available on Amazon Bedrock**. Brave Search is already
  integrated (international research) with a pinned, size/time-bounded fetcher. Its storage rights depend on the
  plan, so confirm with Brave before persisting results.
- Risks: stale prices (the ALMM List-II cell mandate from June 2026 moved prices), SEO spam, prompt injection in
  fetched pages, and consumer-protection rules (quotes must be labelled indicative, with inclusions and exclusions).

### 1.5 UI/UX (screenshots in `/tmp/ss-shots/`, deployed site)
- Three visual brands: the marketing page is cream and sky blue ("Samara" tokens), the workspace is solar green, and
  `/demo` is dark with yellow accents. `docs/ui.md` specifies solar green.
- Fonts are never loaded (no `next/font`; `regola` has no `@font-face`).
- Marketing copy is internal jargon ("Deterministic rooftop solar protocol", "A blueprint rendered on warm paper",
  "Samara architectural system" in the footer), repeated card sections, and 9–10 px text.
- The workspace has 12 nav items; signed-out users hit "Sign in" dead ends; the address input is unstyled outside
  the hero (`globals.css:669-704`). The stepper number duplication is now fixed.
- `globals.css` is 2,275 lines with 612 hex literals and two token systems. `packages/ui` has only Button/Input/Label/Sheet.

---

## 2. Target experience

```
┌──────────────┬───────────────────────────────────────────┬──────────────────────┐
│ + New chat   │  SolarSaathi                               │  Artifact panel      │
│              │                                            │  (pinned, collapsible)│
│ My roofs     │  You: I want solar for my house in Pune,   │  ┌────────────────┐  │
│  • Kothrud   │       bill is about ₹4,500                 │  │ Satellite map  │  │
│  • Office    │                                            │  │ / 3D roof      │  │
│              │  SolarSaathi: Let's find your roof first.  │  └────────────────┘  │
│ Chats        │  [Address card ▸ GPS | type address]       │  System: 3 kW · 6 pnl│
│  • Quote …   │                                            │  Quote: ₹1.6–1.9 L   │
│  • Subsidy … │  [Building pick card ▸ Confirm]            │  Benefits: checking… │
│              │  [System options card: 2 / 3 / 4 kW]       │  Checklist: 3 / 9    │
│ Applications │  [Indicative quote card + sources]         │                      │
│ Settings     │                                            │                      │
│              │  ┌──────────────────────────────────────┐ │                      │
│              │  │ Ask about your roof, costs, subsidy… │ │                      │
│              │  └──────────────────────────────────────┘ │                      │
│              │  [Get a quote] [Check subsidy] [Help me apply]                    │
└──────────────┴───────────────────────────────────────────┴──────────────────────┘
```

- `/app` opens the chat. The thread mixes **model text** (explanations) with **deterministic cards** rendered
  from tool results: address, building pick, roof confirm, system options, savings chart, quote, benefit
  decision, checklist. Every money figure is inside a card with its source and status badge.
- Mutating steps appear as **proposal cards** with Confirm / Change buttons. Nothing is saved, confirmed or created until the user clicks.
- On mobile the artifact panel becomes a bottom sheet; the left rail becomes a drawer.
- Existing pages (Analyze, Properties, Applications) stay reachable as "open in full view" from any card. They are
  the same components, so there is no duplicate logic.
- Chat requires sign-in. A question typed in the marketing hero is carried through sign-in into the first chat turn.

---

## 3. Architecture

### 3.1 Transport and runtime
- New `ChatAgentFunction` (Node 22) behind a **Lambda Function URL with `InvokeMode: RESPONSE_STREAM`**, streaming
  Server-Sent Events to the browser. The JWT is verified in code with the existing `auth/cognito.ts`, which already does it.
  Timeout 120 s. CORS is locked to `ApplicationOrigin`. WAF or a usage cap goes in front (see 3.5).
- The existing REST API stays for everything else; the chat function calls services **in-process** with the verified
  identity (the pattern `chat.ts` already uses), so tools inherit ownership checks.
- IAM: add `bedrock:InvokeModelWithResponseStream`, `bedrock:ApplyGuardrail`.

### 3.2 Model
- Claude on Amazon Bedrock via `ConverseStream` (existing `@aws-sdk/client-bedrock-runtime` dependency; stays on IAM
  with no new SDK). Default model **Claude Opus 5.5** (`anthropic.claude-opus-5-5` / the regional inference profile ID;
  confirm the exact ID in the Bedrock console for ap-south-1), configured by the existing `AdvisorBedrockModelId` parameter.
- Opus 5.5 notes: thinking cannot be disabled; control cost with `effort` (`low` for chat turns, `medium` for
  quote/application planning). Forced `tool_choice` is rejected, so use `auto` plus `strict` tool schemas.
  Handle `stop_reason: refusal`. Server-side `fallbacks` are not available on Bedrock; on refusal, show a safe message.
- Prompt caching: a frozen system prompt plus a fixed, sorted tool list first, with the cache breakpoint after them. No
  timestamps or user data in the system prompt. Per-turn context (selected property, role) goes in the user turn.
- Loop limits: max 8 tool iterations per turn, `max_tokens` capped, and a per-turn timeout with graceful "I couldn't finish" handling.

### 3.3 Tools (all `strict: true`, typed with zod, executed server-side)
| Tool | Wraps | Kind |
|---|---|---|
| `list_my_properties`, `get_property_summary` | core service | read |
| `start_property` (address) | `createProperty` | **proposal** (needs confirm) |
| `find_building` | geocode + building-insights | external, read |
| `confirm_roof` | confirm-building / confirm-roof / manual | **proposal** |
| `recommend_systems` | `systems/recommend` | read |
| `estimate_savings` | `financials/estimate` | read |
| `check_benefits` | `benefits/evaluate` (+ policy-backed) | read; returns missing facts as questions |
| `get_indicative_quote` | new quote engine (§4) | read |
| `research_prices` | new research pipeline (§4.3) | external, read; returns candidates, never amounts to quote |
| `prepare_application` | new checklist builder (§5) + `applications` create | **proposal** |
| `update_application_step` | step/details/documents | **proposal** |
| `explain_policy` | policy records + citations | read |

- **Proposal pattern:** a mutating tool never executes on the model's call. It returns a `proposal` (server-signed,
  single-use token, idempotency key, expires in 10 min). The UI renders Confirm, and the click calls
  `POST /v1/chat/confirm` which executes the stored action. This builds on the existing `chat-update` suggest-then-confirm precedent.
- Add idempotency keys to `POST /properties`, `/applications`, `/designs/generate` (conditional put on the key).
- Broker-only tools are exposed only when the stored role is BROKER.

### 3.4 Guardrails (defence in depth)
1. **Input:** zod-validated message (≤ 2,000 chars), attachments are off for now, and a per-user token bucket in DynamoDB
   (e.g. 30 turns/hour, 200/day). A daily Bedrock token budget per user with a hard stop.
2. **Amazon Bedrock Guardrails** on every turn (`guardrailConfig` on ConverseStream):
   - denied topics: non-solar requests, financial/investment advice beyond solar, legal advice, medical;
   - prompt-attack filter (high);
   - sensitive-information filters: mask or block Aadhaar, PAN, bank account/IFSC, card numbers, OTPs and passwords;
   - word filters for profanity;
   - a contextual grounding check where supported.
   Guardrail ID and version are SAM parameters.
3. **Scope in the system prompt:** solar, electricity bills, rooftop, subsidies, installation and the app's own features.
   Off-topic requests get a short polite redirect with suggestion chips.
4. **Numbers come only from tools.** The model is told to never state a ₹ amount, kW, payback, subsidy or eligibility
   unless it came from a tool result in this turn. A **deterministic post-check** scans model text for numbers and ₹ amounts
   and compares them with the tool results; ungrounded figures are replaced with "see the card above" and logged as a grounding
   violation. Cards, not prose, carry the authoritative figures.
5. **Untrusted content:** web snippets, page text, addresses, labels and vendor names are passed inside clearly delimited
   data blocks with an instruction that they are data, never instructions. Price extraction from pages is
   deterministic (regex and units validation), not model-decided. Fetched pages never trigger further tool calls by
   themselves (`research_prices` does one bounded search and fetch).
6. **Never collect secrets:** the assistant refuses to take portal passwords and OTPs, and tells users not to paste
   Aadhaar or bank numbers. Guardrails mask them if pasted, and masked text is what gets stored.
7. **No autonomous submission:** the assistant never logs into or submits to government portals; it prepares a
   checklist and links to the official portal.
8. **Privacy and retention:** conversations stored as `USER#{id} / CHAT#{chatId} / MSG#{ts}` with a 90-day TTL, user-deletable
   ("Delete chat", "Delete all"). Update `security.md` (it currently forbids logging questions). Logs keep metadata only.
9. **Evaluation:** a red-team and quality eval set (off-topic, jailbreak, injection inside a fake price page, ungrounded
   subsidy bait such as "just tell me I'll get ₹1 lakh", PII paste, Hindi/Hinglish) runs in CI against the guardrail and
   post-check code paths with recorded model fixtures; live-model evals run on demand.

### 3.5 Cost controls
Per-user budgets (above), Brave and Google calls cached per property/fingerprint, `effort: low` by default, a prompt-cached
system and tool prefix, CloudWatch metrics (tokens, tool calls, guardrail interventions, grounding violations), and alarms on spend.

---

## 4. Quotation from researched prices

### 4.1 Data model: price benchmarks (versioned, admin-approved)
`PRICE_BENCHMARK#{id}` records: scope (national/state/DISCOM), system-size band (1–2, 2–3, 3–5, 5–10 kW), module class
(DCR / non-DCR), inverter type, ₹/kW min/typical/max, inclusions (structure, wiring, net-meter fee, GST), source URL,
publisher, authority tier (official / DISCOM / trade press / installer), published date, last checked, expiry,
status (`CANDIDATE` → `APPROVED` → `SUPERSEDED`). Same two-person approval gate as policy publication.
Seed candidates (not approved): the MNRE Feb-2024 benchmark and the MSEDCL 2026 tender rate, each with their source.

### 4.2 Quote engine (deterministic, `packages/calculations`)
Input: actual DC kW from `recommend_systems`, state, DISCOM, module class, inverter, optional battery.
Output: an **indicative range** (low/typical/high) with line items, which approved benchmarks were used, their dates and
sources, the subsidy shown separately from policy-backed results, and a mandatory disclaimer ("Indicative estimate, not an
offer. Get at least 3 quotes from DISCOM-empanelled vendors."). If no approved benchmark exists for the scope, return
`UNAVAILABLE` plus the nearest wider-scope benchmark, clearly labelled. Never extrapolate silently.

### 4.3 Research pipeline (discovery, not truth)
`research_prices` and a scheduled job run Brave Search with fixed query templates (state, size, "rooftop solar price per
kW 2026"), followed by an allowlisted, pinned fetch (gov.in / nic.in / DISCOM / known trade press first), then deterministic
extraction of ₹/kW figures with units and dates, outlier rejection, and storage as `CANDIDATE` benchmarks with provenance.
An admin approves candidates in the policy console (new "Prices" tab). In chat, researched-but-unapproved figures may
be shown only as "market chatter seen on the web", with links, never inside the quote card.

### 4.4 Compare my installer quote (phase 2 of quoting)
The user uploads a quote PDF or photo. Claude extracts line items into a strict schema (validated deterministically), and
the engine compares them to the approved range and the checklist (ALMM-listed DCR modules, net-meter fee, warranty, AMC),
then flags gaps. The file is stored in S3 with a TTL and is user-deletable.

---

## 5. "Help me apply": form assistance

- `prepare_application` builds a **PM Surya Ghar readiness pack** from what we know (property, roof, system,
  quote, benefit decision) plus conversational answers: state, DISCOM, consumer number (optional; stored only if the user
  opts in), sanctioned load, ownership, prior subsidy. It produces:
  - a step checklist (register → apply → feasibility → vendor → install → inspection/net meter → subsidy claim),
  - a document list (bill, ID, property proof, cancelled cheque, landlord NOC if renting, photo) with "have ready"
    status (we don't upload or store Aadhaar or bank documents),
  - a prefilled **application tracker** record (existing model) via a proposal card,
  - a printable/downloadable summary and a link to the official portal.
- Conversational fill: each missing field becomes a **quick-reply chip question** in chat ("Do you own the house? Yes / No /
  Rented"). Answers prefill the form; the full form stays one click away for review and edits before confirmation.
- Steps the user reports ("DISCOM approved my feasibility") use the existing chat-update suggest-then-confirm flow.

---

## 6. Form UI redesign

New `packages/ui` primitives: `Field` (label + hint + per-field error wired to `aria-describedby`/`aria-invalid`), `CurrencyInput`
(₹ prefix, `inputmode="decimal"`, en-IN grouping, no "e"), `Select`, `Combobox` (searchable state/DISCOM/district pickers
replacing code fields), `ChipGroup` (quick answers), `Card`, `Badge`, `Callout`, `Stepper`, `EmptyState`, `SourceCitation`.
Inputs 44 px tall.

Per form:
- **System designer:** a "kWh or bill" toggle (keep), annual generation moves to Advanced, bill-photo hint.
- **Financial estimator:** 6 controls instead of 11. One input each, with suggestion chips ("₹7.5/kWh is common in MH, check
  your bill"). Plain labels ("What you pay per unit"). Export/maintenance go under Advanced. Illustrative values are labelled.
- **Benefit evaluator:** state and DISCOM default from the property, "grid connected" defaults Yes, internal code fields
  replaced by pickers, date fields get help text, missing answers shown as a short "Answer 2 questions to finish" list.
- **Application tracker:** document type becomes a select, details/documents use fieldsets, the status select is primary,
  and note/chat are collapsed.
- All forms: per-field errors, an error summary at the top linking to fields, and preserved values on error.

---

## 7. Marketing site redesign

- **One brand:** solar green tokens from `docs/ui.md`, Inter via `next/font` (plus a display face loaded properly or dropped).
  Delete the Samara token set after the restyle. Dark `/demo` adopts the same tokens.
- **Hero = the product:** "Ask SolarSaathi about your roof." with a live chat composer and suggestion chips ("What will a
  3 kW system cost in Pune?", "Am I eligible for PM Surya Ghar?", "Help me apply"). Submitting goes to sign-in (if needed) and then
  `/app` with the question as the first turn.
  Secondary: "See a sample roof analysis" (demo). Remove the mid-sentence chip.
- **How it works:** 3 steps (Find your roof → See system, cost and subsidy → Get your application ready) with real UI screenshots.
  This replaces the three overlapping card sections.
- **Trust strip:** "Benefit rules from official sources" with MNRE / PM Surya Ghar / DISCOM source links, a last-checked
  stamp from the policy catalog, and "Quotes are indicative ranges with sources", phrased positively.
- **For installers:** keep it short and link to the broker workspace.
- **Remove:** internal jargon, "Workspace flow built" and "Synthetic demo available" labels, footer design-system text, and the
  dev-environment notice (move it to a small environment badge shown only in dev). Minimum 14 px body, contrast ≥ 4.5:1.
- Target mobile page length ~3,000 px (from 6,642). Keep the isometric roof illustration with a "Sample" watermark.
- SEO and performance: metadata/OG image, `next/image`, Lighthouse ≥ 90.

---

## 8. Workspace shell

Navigation shrinks from 12 to 5: **Chat** (home), **My roofs** (each roof has tabs: Roof, System, Savings, Benefits, Quote,
Ideas, Accessories), **Applications**, **Help**, **Settings**. Outside-India lives under Help or a country switch.
Broker nav stays separate. Signed-out pages show one shared `EmptyState` instead of three different sign-in cards.
This requires finishing the `analyze-start.tsx` split (C1 in `remediation-plan.md`) so each step can render as a chat card or a page.

---

## 9. Delivery phases

| # | Phase | Main work | Exit criteria |
|---|---|---|---|
| P0 | Design system and brand | tokens, fonts, `packages/ui` primitives (§6), fix the address input | Storybook-style gallery page; all pages use one token set |
| P1 | Marketing redesign | §7 | Lighthouse ≥ 90, mobile ≤ 3,500 px, copy review |
| P2 | Forms redesign | §6 per form, split `analyze-start.tsx` into step components | per-field errors, 44 px targets, tests updated |
| P3 | Chat backend core | Function URL streaming, ConverseStream loop, conversation store, rate limits, Guardrails, grounding post-check, read-only tools | red-team eval passes, p95 first token < 2.5 s, cost metrics live |
| P4 | Chat UI | chat shell (§2), cards from P2 components, artifact panel, quick replies, mobile sheet, hero question carried through sign-in | keyboard/screen-reader pass, e2e test of the "find roof → system → savings" thread |
| P5 | Proposals and idempotency | proposal tokens, `/v1/chat/confirm`, idempotency keys, mutating tools | no mutation without a click (test), no duplicates on retry |
| P6 | Quotation | price benchmark model, admin "Prices" tab, quote engine, research pipeline, quote card | quote shows only approved benchmarks with sources; unapproved data never in the card |
| P7 | Help me apply | readiness pack, checklist, tracker prefill, printable summary | no Aadhaar/bank stored; portal never contacted |
| P8 | Installer-quote comparison | upload, extraction, comparison | validated schema, file TTL |
| P9 | Hardening | WAF, alarms, load test, eval expansion (Hindi/Hinglish), docs (`security.md`, `api.md`, `advisor.md`) | `pnpm check` green, SAM deployed, live smoke test |

P0–P2 (UI) and P3 (backend) can run in parallel. P4 depends on P2 and P3. P6 and P7 depend on P5.

---

## 10. Decisions (confirmed 2026-10-11)

1. **Model:** Claude Opus 5.5 on Bedrock, `effort` low for chat turns and medium for quote/application planning.
2. **Pricing:** Brave Search plus admin approval. Researched prices are `CANDIDATE`s, and only approved benchmarks appear in quote cards.
   Confirm the Brave plan's storage rights before persisting results.
3. **Consumer number:** never stored. The checklist tells the user to have it ready.
4. **Signed-out chat:** not allowed. Chat requires sign-in; the marketing hero composer carries the question through sign-in
   (`returnTo`) into `/app`.
5. **Still open:** who approves price benchmarks (default: policy admins), and launch languages (default: English).

---

## Progress (2026-10-11)

- **P0 design system:** done (tokens unified, Inter via `next/font`, primitives in `packages/ui`, address form fixed).
- **P1 marketing:** done (chat-style hero, three-step "how it works", trust strip, installers, jargon removed).
- **P2 forms:** estimator, benefit, system designer and tracker forms redone with the primitives. The full split of
  `analyze-start.tsx` is still open; the chat deep-links into it for the map and building pick instead of embedding it.
- **P3, P5, P6, P7 (backend):** in progress in `apps/api`, `packages/calculations`, `infra/sam`.
- **P4 chat UI:** done against the contract in `docs/chat-api-contract.md` (stream client, state reducer, cards,
  proposals, pinned summary, hero hand-off). It activates when `NEXT_PUBLIC_CHAT_STREAM_URL` is set.
- **P8 shell:** navigation reduced to 5 plus "More tools"; sign-in links return users to the page they were on.

## Deployment status (2026-10-11)

- **Deployed to dev:** API stack `solarsaathi-dev` (chat Function URL, chat/price REST routes, Bedrock Guardrail `ChatGuardrail`) and the
  web app (Amplify build 8) with `NEXT_PUBLIC_CHAT_STREAM_URL` set to the `ChatStreamUrl` output. Gates: `pnpm check` green (958 tests).
- **Blocked outside the code:** Bedrock returns `ValidationException: Operation not allowed` for every Anthropic model in this account
  (checked Opus 5.5, Sonnet 5.5, Haiku 5.5, Opus 4.8, Sonnet 4.6, Haiku 4.5 through the `global.` inference profiles). The account needs Bedrock
  model access or Anthropic use-case approval before the assistant can answer. Until then chat turns return a model-unavailable message.
- **Config used:** `AdvisorBedrockModelId=global.anthropic.claude-opus-5-5`, matching profile ARN, and foundation-model ARN
  `arn:aws:bedrock:*::foundation-model/anthropic.claude-opus-5-5`.
- **Not configured:** `BraveSearchKeySecretArn` (price research reports itself unavailable), no approved price benchmarks (quotes stay `UNAVAILABLE`).
- **Unverified against live Bedrock:** Opus 5.5 effort field name (`CHAT_MODEL_REQUEST_FIELDS`), prompt-cache checkpoints, guardrail streaming mode and regex support.
- **Not built:** installer-quote upload and comparison (P8), WAF, full split of `analyze-start.tsx`, pruning of unused marketing CSS.
