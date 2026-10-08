# Deterministic Calculation Engine

## Principles

All arithmetic lives in typed deterministic code.

Bedrock never performs authoritative financial arithmetic.

## Phase 5 roof layout

`planRoofLayout` is a pure, versioned calculation. It receives a confirmed
normalized roof and explicit panel dimensions, capacity, edge setback, panel
gap, service path, mounting offset, and panel limit. Its coordinates are local
metres: east (`x`), up (`y`), north (`z`). The 3D and plan views use the same
layout result, so a camera change cannot change panel count.

For Google Solar data, segment bounding boxes are approximations of roof
planes, not surveyed outlines. Suggested panel centers are kept only when the
modeled panel footprint lies within the inset and outside the modeled service
aisle, with no modeled panel overlap. Counts from this path are approximate.
The displayed setbacks are assumptions and must not be described as verified
regulatory or installation clearances.

For manual length and width, the rectangle supports a conservative,
space-feasible layout. An area-only entry has no defensible shape or panel
count; render an illustrative plane and return `null` for count and capacity.
Neither path establishes structural safety. A site survey and installer review
remain necessary before installation.

## Phase 6 system sizing

`designSolarSystem` uses the confirmed roof and the same versioned layout
assumptions as the 3D viewer. It checks 1, 2, 3, 5, 7.5 and 10 kW nominal
candidates using whole panels. The returned actual DC capacity, minimum modeled
inverter AC capacity, roof fit, yearly generation, coverage ratio, warnings and
reason codes make the recommendation reproducible. The displayed inverter
value is a sizing estimate, not an equipment selection. The recommendation is
the eligible candidate closest to annual consumption, with an explicit 125%
modeled generation-to-demand ceiling; these are planning assumptions rather
than legal or tariff rules.

Direct monthly kWh is preferred. A bill can be converted with an explicitly
entered average tariff, with an approximation warning. Google panel energy is
used only when the saved panel specifications match the layout model, then an
explicit DC-to-AC factor is applied. Otherwise the user-supplied annual yield
assumption is used and labelled. The default 1,500 kWh/kW-year is illustrative,
not a site-specific Solar API result. An area-only roof has undetermined fit
and no recommended size. Sanctioned load is reported for local-rule review;
it does not impose an unverified legal capacity cap. No financial savings,
subsidy or policy eligibility is calculated here.

Google panel width, height and capacity override the versioned baseline only
when the complete module specification passes conservative modeling guardrails.
An implausible or partial specification falls back to the displayed baseline
module and does not reuse Google's per-panel energy for that different module.
The guardrails protect the sizing model; they are not equipment certification.

## Solar generation

Initial configurable assumption:

`annualGenerationKwh = systemKw * generationFactorKwhPerKw`

Use actual Solar API energy estimates where available and label fallback assumptions.

## Degradation

Configurable default:
`0.5% / year`

Never hardcode this into policy data.

## Tariff escalation

Configurable default:
`4% / year`

Clearly label as an assumption.

## Gross system cost

Phase 7 requires an explicit gross installation quote in rupees. There is no
production price-per-kW default. The 25-year base result begins at the negative
gross quote, with no policy benefit deducted. A later market/vendor cost model
may supply a sourced estimate when a quote is unavailable.

## Benefit calculation

```text
candidate benefits
→ eligibility
→ compatibility
→ caps
→ stacking optimizer
→ total eligible benefit
```

Never manually subtract a subsidy in UI code.

Phase 10 implements this as a pure, versioned rule evaluator. It checks declared
applicant facts, jurisdiction, effective dates, current source evidence, rule
compatibility, overlapping benefits, individual and combined caps, then chooses
the largest compatible total. Money is evaluated in integer paise. Unknown
facts or unverified evidence do not become an eligible amount. The current
system-size test uses modeled actual DC watts; tariff or DISCOM AC-capacity
requirements need separately verified rules before they can be asserted.

The homeowner API recomputes the system from an owned, unexpired analysis. Its
policy result is shown alongside the Phase 7 unsubsidized estimate. The Phase 7
cash-flow rows and payback are not recalculated with a policy deduction yet.
An unknown policy-eligible cost is not assumed to equal the whole installation
quote. An incomplete or oversized relevant rule catalog yields an unavailable
result rather than a made-up zero or maximum benefit.

## Net cost

`netCost = max(0, grossCost - totalEligibleBenefit)`

Do not subtract optional accessories unless the user explicitly includes them and policy permits them in benefit calculation.

## Annual savings

The Phase 7 base model splits each year's generation into self-consumed energy
and surplus. Self-consumed energy is capped by the annual demand from Phase 6
and valued at a user-entered **avoidable** import energy rate. Surplus uses a
separately entered export-rate scenario, which may be zero. Local metering and
settlement rules have not yet been checked, so an export amount is not an
entitlement. Flat annual demand and the rate escalations are echoed assumptions.
Gross savings minus maintenance gives yearly net cash flow; financing and
policy benefits are outside the base result.

## Payback

Calculate the first crossing of zero cumulative cash flow from the negative
upfront quote and each year's net cash flow. Interpolate within that year;
return `null` if the quote is not recovered within 25 years. This is an
estimate, not a guaranteed payback time.

## 25-year savings

Produce annual table:
- generation
- degradation
- tariff
- gross savings
- maintenance
- financing where applicable in a later model
- verified benefit in the policy-backed model
- cumulative cash flow

## Sensitivity

The base result varies generation, avoidable import tariff and gross quote
one at a time by the displayed low/base/high percentages. Export rate stays
separate when tariff changes. Benefit sensitivity follows once the policy
engine provides an eligible, sourced amount; there is no invented subsidy
scenario in Phase 7.

This simplified year-by-year approach follows the cash-flow framing in
[NREL's System Advisor Model documentation](https://sam.nrel.gov/images/web_page_files/sam-help-2025-4-16.pdf).

## Policy provenance

Every financial result that uses a policy benefit stores:
- policy version
- rule IDs
- source IDs
- timestamp

Phase 10 benefit evaluations return this provenance and archived clause
citations, source checks, jurisdiction, effective window and verification time
to the caller. Persisting a policy-adjusted financial result is later work.
