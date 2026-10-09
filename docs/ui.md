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
host routing serves `solarsaathi.in` as marketing and rewrites
`app.solarsaathi.in` to the application routes. DNS/hosting is not deployed.

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

## Accessories

Show:
- Required
- Strongly recommended
- Optional

Never make every accessory look mandatory.

## International

When researching:

> Checking current solar incentives for your location...

Then show:
- source
- retrieval time
- "Live researched"
- confidence
