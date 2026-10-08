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

## Financial integration

Accessories must be separated from the base solar financial model unless the user explicitly includes them.

Show:

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
