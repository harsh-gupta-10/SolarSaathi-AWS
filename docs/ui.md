# UI / UX Specification

## Visual direction

Premium clean-energy SaaS:
- light background
- white cards
- solar green accent
- restrained shadows
- Inter/Geist
- strong typography
- generous spacing
- subtle motion

Avoid:
- neon cyberpunk
- excessive gradients
- emoji-heavy UI
- generic AI-chat visual language

## Phase 1 implementation

The marketing site is `/` locally; the application shell is `/app`. Production
host routing is designed to serve `solarsaathi.in` as marketing and rewrite
`app.solarsaathi.in` to the application routes. The development site is hosted
on Amplify's default domain; custom DNS is not connected.

UI primitives are generated with shadcn/ui in `packages/ui` and styled with
Tailwind CSS. The single distinctive hero element is an illustrative roof plan,
explicitly not a property assessment. No fictional metrics or subsidy amounts
are shown. Upcoming features have labelled, navigable empty states.

Addresses are validated and stored only in this tab's session storage, not URLs
or accounts. Users can edit or clear a draft. No geocoding call is made until
Phase 4. The navigation role selector is a preview, not an authorization control.
Mobile navigation uses a labelled, keyboard-accessible sheet with focus return.

## Phase 2 identity UI

`/auth/sign-in` and `/auth/sign-up` start the hosted Cognito flow; the hosted page
handles credentials, verification, MFA and recovery. Optional Google is shown
only when enabled and configured. `/auth/callback` waits for the SDK exchange,
cleans query credentials after processing/failure and provides recovery on errors.
Account settings show identity context, not proof of database ownership. An
optional **Verify API connection** action uses the current access token with
`GET /v1/me`, omits cookies, rejects redirects, enforces a deadline and validates
the returned subject/shape. It is disabled when signed out, does not run
automatically and never shows a successful check without a real API response.
Results are cleared on account/session changes.

When Cognito is configured, the navigation-preview role picker disappears.
Signed-in navigation comes from Cognito identity display; a stored preview role
never changes it. Missing configuration produces an explicit unavailable state,
not a demo login. Live auth validation remains pending approved resources.

## Phase 4 roof UI

`/app/analyze` now connects the tab address draft to an authenticated property,
then presents address candidates, an optional Google satellite map, and a text
and coordinate alternative. The selected point and the building returned by
Google Solar are shown separately. The user confirms the building and then the
roof measurements before a Google analysis is saved. Changing the address or
point invalidates downstream previews. Manual measurements remain available
when lookup is unavailable; length and width describe horizontal footprint
dimensions and must agree with the entered area and pitch.

When the satellite map is configured, a user can explicitly request one device
location reading. A blue point and accuracy circle recenter the map; they never
select a house or persist a location. Tapping a house sends its point to the
existing property-bound Solar preview endpoint and draws a lightly filled,
approximate returned building bounds overlay. The overlay is not a surveyed
roof polygon. Permission refusal, timeout and unavailable location leave the
manual map/coordinate path usable; building and roof confirmations still
require separate actions.

Google roof area is labelled modeled, with imagery quality/date when returned
and attribution next to the data. Neither path claims structural suitability,
panel clearance, a subsidy, or a financial estimate. A restricted browser Maps
key, backend Google keys, Cognito and the API are not configured locally, so
live selection remains unverified.

## Homeowner navigation

- Overview
- Analyze Roof
- My Properties
- Savings
- Government Benefits
- Application Tracker
- AI Advisor
- Rooftop Ideas
- Accessories
- Help
- Settings

## Broker navigation

- Overview
- Customers
- Properties
- Analyses
- Benefits
- Applications
- Leads
- AI Advisor
- Designs
- Settings

## Phase 16 broker workspace

The broker overview shows loaded customer, property and lead counts with a
clear indicator when more pages exist. Customer records lead to property
creation; each property opens its saved analysis, application checklist and
design concepts. A broker can start roof selection for that same customer
property, including the device-location and returned-building overlay flow,
without creating an unrelated duplicate property.

Proposal preview requires a real quote and scenario inputs. It presents the
backend's base and policy-adjusted figures with source/coverage context and
allows saving an as-of snapshot only after a real backend response. A saved
proposal shows its creation time, policy versions, source check time and
recheck state. Missing policy coverage remains explicit. Lead intake stays
separate from customer and property records until the user deliberately
creates and associates those records. A broker can move a lead stage forward
with a revision-checked action; labels are business progress only. A visibly
fictional `/demo/broker`
route illustrates the workspace without live customer or subsidy claims.

## Roof flow

1. address input
2. satellite map
3. building selection
4. "Is this the correct building?"
5. Solar API analysis
6. roof metrics
7. "Are these measurements right?"
8. 3D solar layout

The confirmed assessment opens a deterministic 3D planning view and a
top-down plan of the same geometry. The viewer offers orbit, zoom, top, and
reset controls that also work from keyboard-accessible buttons. Show panel
count and capacity only when the calculation has a defensible fit result;
otherwise show "Undetermined." Label Google roof edges and clearances as
modeled approximations, show the exact layout assumptions, and keep the Google
Solar attribution visible. When WebGL is unavailable, the plan and text
summary remain usable. A separate fixture-only demo route may illustrate the
viewer without implying that an address has been analyzed.

## Phase 6 system designer UI

After saving a roof, `/app/analyze` offers a consumption or bill-and-tariff
input and an editable annual generation assumption. The comparison is requested
from the authenticated backend for the saved analysis. Results show each
candidate's whole-panel DC capacity, minimum modeled inverter AC capacity,
estimated yearly generation, modeled roof fit, and reasons it was not selected.
The recommendation and all inputs are labelled as planning estimates. Bill
conversion and Google roof geometry carry their approximation warnings;
sanctioned load is only a prompt to verify local rules. The 3D viewer and
designer use the same versioned roof layout assumptions. The synthetic demo is
clearly labelled and does not call live services.

## Phase 7 base financial UI

Once a roof-fitting system has been compared, the homeowner may enter an
installed quote or their own planning estimate, an avoidable import energy
rate, a self-use share, an assumed export credit and annual maintenance. The
authenticated backend rechecks the candidate against the saved roof. The
result shows the unsubsidized upfront quote, payback or no payback within 25
years, a cumulative cash-flow chart, one-at-a-time sensitivity, all calculation
assumptions, and a full annual table. The export value remains a user scenario
until local metering rules are verified. Government benefits and financing are
shown as unevaluated, and the synthetic demo values are labelled as fixtures.

## Policy-backed financial results (Phase 11)

The policy-backed result follows the confirmed roof, system and gross quote.
It shows the original unsubsidized financial estimate beside an optional
policy-adjusted scenario from the same authenticated backend response. The
scenario shows gross, central, state, DISCOM, local and other selected benefits,
total, net upfront cost, modeled payback and 25-year cash flow. It must label
incomplete coverage and unknown eligibility, link every selected rule to its
source/version, and state that the benefit is modeled as received upfront
because actual disbursement timing is not verified. If policy evaluation is
unavailable, only the unsubsidized estimate is shown. No amount is generated
in React.
Selected other benefits remain visible but are separated from the amount
modeled against the installation quote until their cash treatment is verified.

## Phase 12 application tracker UI

A selected benefit offers a tracker creation action. The backend checks for a
current sourced process template; a missing template produces an explicit
message instead of a generic checklist. `/app/applications` lists only the
signed-in user's property-scoped trackers. Switching account or property clears
and scopes the displayed data. A selected tracker shows process step order and
official citations, separate user reported progress, the derived next step,
and forms for status, notes, reference, vendor and document metadata. A
conversation style message can suggest a status but cannot save it without a
second explicit confirmation. No official portal status is implied. The
fictional `/demo/application-tracker` route is visibly synthetic and has
disabled controls.

## Phase 10 benefit evaluation UI

`/app/benefits` explains the property-first flow. A homeowner can check
benefits after a confirmed roof, roof-fitting system comparison and base
financial scenario. The browser sends self-reported jurisdiction, applicant,
property, timing and optional scheme facts to the authenticated backend.
Percent-of-eligible-cost rules remain unknown unless a separate, explicitly
policy-eligible cost is supplied; the whole gross quote is never substituted.

The result shows selected, ineligible, unknown and compatibility-excluded
rules, separate scope coverage, reason codes, and policy/source/version,
effective window, verification and last source-check timestamps. Missing or
stale data is textually labelled and never presented as a zero benefit.
Incomplete coverage never produces a "maximum subsidy" claim. The Phase 7
financial chart remains the unsubsidized baseline; Phase 11 adds a separate
policy-adjusted scenario. Published rules depend on official processing;
the UI calls the result an estimate based on self-reported facts.

The administrator policy workspace adds a benefit-rule publication tab.
Authors bind a typed rule and clause evidence to the exact current archive;
they then submit an immutable draft. A separate reviewer sees source freshness,
quote, policy metadata and rule JSON before recording a reasoned publish or
reject decision. The synthetic demo disables all publication requests.

Hero card:

```text
Recommended system
{system kW}

Estimated gross cost
{user quote}

Eligible government benefits
{verified eligible total or unavailable}

Estimated net
{computed net or unavailable}
```

Below it:
- source/version
- last verified
- benefit breakdown
- excluded potential benefits + reason
- payback
- 25-year savings

## Subsidy stacking display

Show separate chips/cards:

```text
Central government
{amount from active verified policy}
{eligibility result}

State
{amount or unavailable}
{compatibility result and reason}

DISCOM/local
{amount or unavailable}
{condition and source}
```

Then:

**Total eligible benefits**

Do not make the user infer whether amounts are additive.

## Policy status

Example:

> Policy verified 6 Oct 2026<br>
> Sources: MNRE · MSEDCL

If stale:

> Policy data may be outdated. Last verified 31 days ago.

## Policy administration (Phase 9)

Only a signed-in policy administrator can open the review workspace. The
backend rechecks the current Cognito group on every request. The page shows
pending candidate quotations and document-level changes in one paginated
queue, plus a separate current source-monitoring view. A quotation shows its
publisher, jurisdiction, effective date when known, exact HTTPS source URL,
retrieved time, document version/hash and page or section. A document change
with zero extracted quotations remains reviewable with a bounded plain-text
preview when the archive is available. Label every candidate as unverified
even after human evidence review. Show conflict and stale-source warnings in
text, not color alone. A different administrator from the source curator must
review; the UI disables that curator's review controls. Review decisions need
a reason and explicit confirmation; source curation uses confirmation without
a fictitious reason field. A source stopped for a long official rate limit
requires a separate reasoned administrator action before an early retry. An empty queue says whether no sources are active
or active sources have no pending changes. Neither approval path publishes a
benefit rule or homeowner subsidy amount. `/demo/policy-review` is a clearly
labelled synthetic interface preview without API writes.

## Policy administration (Phase 18)

The console adds source registration and paged health cards, a durable crawler
run timeline, and a filtered unresolved-conflict view. Show stale or failed
sources in text with last-check time and a path back to their official URL.
An empty conflict page with a continuation cursor offers **Load more**; it
cannot imply there are no remaining conflicts. Evidence review stays separate
from verified benefit publication.

Published policies have a paged history and a current-pointer badge. An
immutable historical row is labelled **Published, not current** even if its
stored version record says `ACTIVE`. Compare verified rule terms, effective
dates, source/document hash and citations before proposing rollback. A
rollback form shows current and target versions, requires an audit reason and
creates a pending request. A separate policy administrator reviews the request
with another reason; stale evidence, a changed active pointer or source
precedence conflict is shown as a blocked state. The synthetic policy-review
demo never submits a source, review or rollback request.

## Application tracker

Timeline with checkboxes/status.

Include:
- official portal link
- source
- user notes
- reference number
- uploaded document metadata

## AI advisor

Questions:
- Am I eligible?
- Why is my subsidy this amount?
- What documents do I need?
- Where do I apply?
- What should I do next?
- What does this status mean?

Responses show source cards.

Phase 13's authenticated advisor lets the user choose an owned property and
confirmed, unexpired analysis before asking a question. The result separates
server-composed answer text from provenance-labelled fact cards, with source
citations and verification metadata on policy cards. Missing financial or
applicant inputs remain visible; a concise roof answer must not imply a
subsidy calculation. Application progress is labelled user reported. Show a
usable deterministic answer when the optional model is unavailable, and clear
prior account/property context when the selection changes.

## Rooftop ideas

```text
You have approximately 830 sq ft of modeled usable roof area remaining.

[Garden]
[Outdoor seating]
[Compact gym]
[Green zone]
[Surprise me]
```

Then:
- concept image
- 3D option
- "Why this works"
- space used
- solar clearance preserved
- structural-review warning if applicable

Phase 15 should make the saved roof and panel geometry inspectable in a
keyboard-accessible 3D view with a top-down and text fallback. Show each
candidate's deterministic placement, projected free-zone area, modeled solar
buffer and service path, and `SPACE_FEASIBLE`/undetermined status. A space fit
must never be styled or described as structural approval. Keep the template
concept available when image generation is unconfigured or fails. An optional
Bedrock image is inspirational only, never an aerial image or property-accurate
rendering. Property-specific assets must not appear after an account, property
or analysis change. A demo uses visibly synthetic roof geometry.

## Accessories

Show:
- Required
- Strongly recommended
- Optional

Never make every accessory look mandatory.

The Phase 14 authenticated screen should select an owned property and
confirmed roof, then require explicit consumption, planning yield and a
supported system candidate. Optional goal, EV, inverter and site inputs are
labelled as user reported. Display the backend's ranked recommendations with
category, classification, compatibility review, reason and safety notes.
Group unavailable costs and unevaluated policy requirements as clear states;
do not draw a price, subsidy or mandatory badge from the catalog alone. A
fictional preview, if provided, must remain visibly separate from live account
actions. Changing account, property, roof or planning inputs clears old
recommendations.

## International

When researching:

> Checking official solar sources for your location...

Then show:
- source
- retrieval time
- "Live researched", "Research incomplete", or "Research unavailable"
- source date when known, expiry and cache state
- explicit incomplete coverage and reason codes

The Phase 17 research page accepts a country code or a user-triggered,
one-time device location. A location request clears the manually selected
country and is sent only to the AWS research API for country detection. Region
and utility fields provide user-declared context; they do not establish that
the cited source applies to that area or customer. Official source links open
separately. The page never shows a researched subsidy amount or eligibility
result. A visibly fictional demo explains the result format without calling
live services.

## Chat-first workspace and shared design system (2026-10-11)

- **One brand.** Solar green tokens (`--primary #12633f`) and Inter via `next/font`. The marketing "Samara" token names
  are kept only as aliases onto the same palette until their CSS is retired. New UI uses Tailwind utilities and the
  `@solarsaathi/ui` primitives, not new global classes.
- **Primitives** (`packages/ui`): `Field` (label, hint, per-field error wired to `aria-describedby` / `aria-invalid`;
  `liveError={false}` when a form shows one summary alert), `Select`, `CurrencyInput` (₹ prefix, Indian grouping, digits
  only), `ChipGroup` (radio-semantics quick answers), `Card`, `Badge`, `Callout`, `EmptyState`, `SourceCitation`. Inputs and
  selects are 44 px tall.
- **Forms:** one input per fact with quick-pick chips; rarely needed assumptions sit under "Advanced". Required answers
  are never prefilled. Advanced assumptions start at an explicit, labelled "none assumed" value.
- **Chat home (`/app`):** conversation list on the left, the thread in the centre, a pinned "solar summary" on the right
  (a bottom panel on small screens). Assistant text is explanation only; every figure is rendered from a server-built
  card (`ChatCard`, `packages/types/src/chat.ts`) with its source, status badge and date. Changes (create property,
  confirm roof, create application, update a step) appear as a "Please confirm" card and run only when the user clicks
  Confirm. Chat needs sign-in. If `NEXT_PUBLIC_CHAT_STREAM_URL` is not set the guided overview is shown instead.
- **Navigation:** Chat, My roofs, Applications, Help, Settings, plus a collapsed "More tools" group for the step-level pages.
- **Marketing hero** is the chat composer: the typed question is held in `sessionStorage`, carried through sign-in
  (validated `returnTo`) and becomes the first chat turn.

## Analysis flow fixes (2026-10-11)

- **Six steps:** Address → Find building → Roof model → System size → Cost & savings → Subsidies & apply. One form per
  step; a sticky stepper at the top and sticky Back/Next bar at the bottom. Next is disabled until the step has a
  backend result. On each step change the page scrolls to the stepper and focuses the step heading; new results scroll
  into view. Focus is never pulled out of a field the user is typing in.
- **Desktop sidebar** is sticky (full viewport height, scrolls on its own).
- **Saved answers:** sizing, cost and benefit inputs are an analysis draft (`lib/analysis-draft.tsx`): written to this
  device immediately and to the account (debounced `PUT …/draft`). Editing an earlier step clears later *results*, never
  later *answers*. A visible status says whether answers are saved to the account or only on this device. Device copies
  are cleared on sign-out. Drafts are inputs only; every figure is recomputed by the backend.
- **Reload:** `?propertyId=&analysisId=` is kept in the address bar; a reload reopens the confirmed roof, and the sizing
  step if sizing answers were saved. No duplicate property is created.
- **Subsidy messages** are explained in plain language from the backend reason codes (`lib/policy-reasons.ts`); unknown
  rules list the question that would resolve them. No amount is shown or inferred.
- **3D roof / map overlay:** roof planes are rotated to their azimuth, one building outline is shared by the 3D walls
  and the map polygon, panels are clipped to their plane's setbacks, the 3D view uses north = −z, and the map is locked
  top-down with an "approximate outline" note and imagery date.
