# Solar Accessory Recommendation Engine

## Objective

Recommend useful accessories and complementary equipment without turning SolarSaathi into an upselling engine.

## Categories

### Electrical protection / safety
- DC/AC surge protection
- appropriate earthing
- lightning protection where appropriate
- isolators/breakers
- cable management
- safety signage/access

### Monitoring
- inverter monitoring
- smart energy meter
- production monitoring
- consumption monitoring
- alerts

### Backup / resilience
- battery energy storage
- backup inverter/UPS where compatible
- essential-load circuit

Recommend only when the user's goals and electrical architecture support it.

### EV
- EV charger
- load management
- solar-aware charging

Recommend based on:
- EV ownership/intention
- sanctioned load
- solar size
- local electrical constraints

### Maintenance
- cleaning equipment
- safe access
- inspection/maintenance planning
- bird/pest mitigation where relevant

### Water/cleaning
Recommend practical maintenance methods appropriate to the site. Do not imply a particular cleaning frequency is universally mandatory.

## Recommendation inputs

- system size
- inverter type
- roof type
- user goals
- backup requirement
- EV ownership
- monitoring interest
- budget
- local climate/context
- installer configuration
- policy requirements

## Classification

Each recommendation is:
- REQUIRED_BY_RULE
- STRONGLY_RECOMMENDED
- RECOMMENDED
- OPTIONAL
- NOT_RECOMMENDED

## Example

```json
{
  "accessory": "Battery storage",
  "classification": "OPTIONAL",
  "reason": "Useful if backup power is a priority; not necessary solely to maximize rooftop solar generation.",
  "compatibility": ["hybrid-inverter"],
  "warnings": ["Requires electrical/system design review"]
}
```

## No unsafe recommendations

Do not recommend:
- unsafe DIY electrical work
- incompatible voltage/current devices
- equipment solely because it increases cart value
- structural rooftop additions without structural review

## Phase 14 fact and price boundaries

The recommendation endpoint uses the same owned, confirmed, unexpired roof and
recomputed Phase 6 candidate as the system designer. User goals, EV intent,
inverter description, and site observations are declared context, not verified
equipment specifications or installation approval. A catalog rule may rank an
item for discussion and state what a professional must check. It may not claim
electrical compatibility from DC capacity alone. Battery, EV, earthing,
lightning, protection and roof-access choices require a qualified site and
electrical design review before procurement or installation.

No current policy record establishes an accessory mandate, and no sourced
regional price catalog is deployed. Therefore `REQUIRED_BY_RULE` and numeric
cost ranges must remain unavailable until exact verified policy evidence or
current sourced vendor prices are integrated. Policy relevance is labelled
not evaluated, and a generic recommendation never establishes subsidy
eligibility. Score is deterministic usefulness to the declared goal; vendors
cannot buy a higher rank. Accessory costs do not change the base solar quote,
policy-eligible cost or benefit calculation.
The confirmed, roof-fitting system is a prerequisite for advice and is shown
for context. Current ranking does not infer equipment compatibility or change
scores from system size or roof source; those facts do not establish a
defensible accessory specification without site and electrical design.

## Financial integration

Accessories must be separated from the base solar financial model unless the user explicitly includes them.

When a separately sourced accessory quote exists, show it outside the solar
base model, for example:

```text
Solar system
₹X

Eligible benefits
-₹Y

Optional accessories
₹Z

Net solar investment
₹...
```

Do not subtract optional accessory costs from subsidy calculations unless the policy explicitly allows those costs.
Until a sourced quote exists, display "Cost range unavailable" in place of
`₹Z` and do not produce a combined investment number.
