# Hackathon Demo

## Target demo

A Mumbai/Maharashtra residential homeowner asks:

> Is my roof worth putting solar on?

## Demo sequence

### 1. Address
Enter a demo residential address.

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
Show:

```text
Central benefit
₹...

State benefit
₹...

DISCOM/local
₹...

Total eligible
₹...
```

Explain why each is included/excluded.

Show source and verification date.

### 6. Financial result
Show:
- gross
- benefits
- net
- annual savings
- payback
- 25-year savings

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

## Demo reliability

Live services should be used when available.
If any external service fails:
- use a clearly labelled demo fixture
- do not fake "live" status
- show the fallback gracefully

## Strongest differentiator

The combination of:
- roof intelligence
- policy intelligence
- subsidy stacking
- application tracking
- AI explanation
- rooftop-space optimization

is more compelling than a basic solar calculator.
