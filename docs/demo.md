# Hackathon Demo

## Target demo

A Mumbai/Maharashtra residential homeowner asks:

> Is my roof worth putting solar on?

Choose the presentation mode before starting: an authenticated, deployed live
flow only after every service used has passed the [submission evidence gate](submission.md#live-evidence-gate),
or the visibly fictional local `/demo/*` routes. The numbered sequence below
describes the intended live flow. The fixture routes demonstrate separate UI
states and must not be narrated as one completed live property transaction.

## Demo sequence

### 1. Address
Enter an address for a property the presenter is authorized to use. Avoid
showing a resident's precise address or coordinates in a recording.

### 2. Building selection
Show satellite map.
Optionally use the one-time device-location button to center it; this does
not select a building. Tap the house to request Google Solar preview and show
the approximate building bounds overlay. If Google configuration is absent,
use the labelled manual/coordinate path.
Select building.
Confirm:
> Is this the correct building?

### 3. Roof analysis
Show:
- roof area
- roof segments
- sunshine
- recommended solar layout

Confirm:
> Are these measurements right?

### 4. System
Recommend a system based on:
- roof
- consumption
- policy/system constraints

### 5. Government benefits
Show each central, state, DISCOM/local or other decision only if a current,
approved rule applies. Explain why it is selected, excluded or unknown, and
show source, jurisdiction, effective date, version and last check. Show a
numeric total only for currently verified, counted rules; if coverage is
incomplete, call it a partial estimate. With no current verified rules, show
“unavailable” or “undetermined,” not ₹0 or a fixture subsidy.

### 6. Financial result
Show:
- gross
- benefits
- net
- annual savings
- payback
- 25-year savings

Label the quote, energy tariff, export assumption and benefit timing as inputs
or planning assumptions. Do not describe payback as guaranteed.

### 7. Application tracker
Click:
> Start application tracker

Show a policy-specific, cited checklist only when the selected benefit has a
verified process template. Update a user reported step and explain that an
official portal has not been changed. For an offline presentation use the
clearly fictional, disabled `/demo/application-tracker` fixture.

### 8. AI advisor
Ask:
> Why am I getting this subsidy?

The live account flow requires an owned property and confirmed roof. With
user-entered scenario inputs and a current verified selected benefit, it
explains the deterministic amount using cited policy cards. With no verified
benefit, it states that the amount cannot be confirmed. The optional Bedrock
model can select relevant cards; server code composes the factual answer.
For an offline presentation, `/demo/advisor` is a visibly fictional,
read-only layout fixture with no live subsidy or model claim.

### 9. Accessories
Show 2–4 deterministic recommendations from the selected owned roof, a
roof-fitting system and stated goals. Explain classification, compatibility
review and safety notes. Current prices and accessory-specific policy
requirements are unavailable; do not show a guessed cost or mandate. An
offline preview, if used, must be clearly synthetic.

### 10. Remaining roof
Show:
> You have approximately X sq ft remaining.

Generate/select:
- rooftop garden
- seating
- green zone

### 11. Close
> SolarSaathi turns a confusing rooftop-solar decision into one guided workflow.

### Broker continuation

For a broker account, open a customer, attach a property, and use **Assess this
roof** to analyze that exact property. Return to its saved analyses and
application checklist, then preview a proposal using the broker's entered
quote and assumptions. Save and reopen the as-of snapshot to show source
version, last check and coverage status. The `/demo/broker` screen is a
fictional layout preview; its records and policy states are not live data.

### International research fallback

Open `/app/international` with a signed-in account to request a country source
check or deliberately choose **Use my location once**. The response must show
official source links, retrieval time and incomplete coverage; a supplied
region or utility is context, not verified applicability. If the research API
or its dependencies are unavailable, show that state plainly. The
`/demo/international` screen is synthetic and visibly fictional; it never
claims that its source cards were fetched during the demo session.

### Policy administrator operations

With a verified policy administrator account, register an official source and
inspect its proposed/curated health, then show the paged crawler run and
unresolved conflict views. Review a document change as evidence only. For a
published rule, compare the current version with a historical version and
submit a reasoned rollback request; a different administrator must review it.
If no live policy corpus is available, use `/demo/policy-review` only as a
clearly labelled fictional read-only preview. Never simulate a rollback as an
actual active government policy change.

## Demo reliability

Use live services only after their deployed behavior and source provenance have
been checked. If an external service fails, state the failure and navigate to
a clearly labelled fixture route; keep the fixture's fictional data separate
from the account flow. See [submission.md](submission.md) for the verification
and evidence checklist.

## Strongest differentiator

The combination of:
- roof intelligence
- policy intelligence
- subsidy stacking
- application tracking
- AI explanation
- rooftop-space optimization

is more compelling than a basic solar calculator.
