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

`grossCost = systemKw * installedCostPerKw`

The cost model must be configurable by market/vendor context.

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

## Net cost

`netCost = max(0, grossCost - totalEligibleBenefit)`

Do not subtract optional accessories unless the user explicitly includes them and policy permits them in benefit calculation.

## Annual savings

Use:
- generation
- self-consumption/export assumptions
- tariff
- net-metering/settlement rules when available

Do not pretend that all generated kWh have the same financial value.

## Payback

Calculate from year-by-year cash flows, not a simplistic single ratio when detailed policy/tariff data exists.

## 25-year savings

Produce annual table:
- generation
- degradation
- tariff
- gross savings
- maintenance
- financing where applicable
- benefit
- cumulative cash flow

## Sensitivity

At minimum:
- low/base/high generation
- low/base/high tariff
- system cost
- benefit amount

## Policy provenance

Every financial result that uses a policy benefit stores:
- policy version
- rule IDs
- source IDs
- timestamp
