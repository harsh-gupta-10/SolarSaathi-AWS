# SolarSaathi — Product Specification

## 1. Product thesis

SolarSaathi turns a home address into a practical rooftop-solar decision and assistance workflow.

Primary promise:

> "Is your roof worth going solar, what will it really cost after every eligible benefit, and how do you actually get the benefit?"

Secondary promise:

> "After planning solar, how can you use the remaining rooftop space intelligently?"

## 2. Target users

### Homeowner
Needs:
- roof suitability
- system recommendation
- current subsidy/incentive eligibility
- combined central + state + local benefit calculation
- cost/payback/savings
- official application process
- document checklist
- application/subsidy tracking
- AI explanation
- accessory recommendations
- remaining-roof-space ideas

### Broker / solar consultant
Needs:
- multiple customers
- properties
- analyses
- policy-backed proposals
- lead management
- reusable designs
- application tracking

### Admin / policy operator
Needs:
- source registry
- crawler status
- detected policy changes
- policy conflicts
- approval queue
- policy versions
- audit trail

## 3. Primary homeowner flow

```text
Landing
  ↓
Enter address
  ↓
Geocode
  ↓
Satellite map / building selection
  ↓
"Is this the correct building?"
  ↓
Google Solar buildingInsights
  ↓
Roof analysis
  ↓
"Are these measurements right?"
  ↓
System recommendation
  ↓
Live policy lookup
  ↓
Central + state + local/other benefit compatibility engine
  ↓
Net cost + savings + payback
  ↓
Application checklist
  ↓
"Track my subsidy"
  ↓
AI solar/policy advisor
  ↓
Remaining roof-space advisor
  ↓
Accessory recommendations
  ↓
Installer lead
```

## 4. Product modules

### A. Roof intelligence
- Geocoding
- satellite map
- building selection
- buildingInsights
- roof segments
- area, pitch, azimuth, sunshine
- deterministic solar geometry
- 3D preview

### B. Solar system designer
Recommend system size using:
- roof area
- modeled usable area
- electricity consumption/bill
- sanctioned load where available
- local constraints
- solar generation assumptions

### C. Financial engine
Calculate:
- gross system cost
- eligible incentives
- net upfront cost
- annual generation
- bill savings
- tariff escalation
- degradation
- payback
- 25-year cumulative savings

### D. Policy Intelligence
Continuously collect:
- central schemes
- state schemes
- DISCOM incentives
- local-body benefits
- net-metering rules
- eligibility
- process
- documents
- deadlines
- official links
- vendor requirements
- exclusions
- caps
- compatibility rules

### E. Subsidy optimizer
Find the best eligible combination without double-counting.

### F. Application tracker
Track:
- eligibility
- application
- vendor
- feasibility
- installation
- inspection
- meter
- commissioning
- subsidy/CFA processing
- payment received

The exact checklist is policy-specific.

### G. AI policy advisor
Grounded retrieval only:
- current policy records
- current property
- current application state
- current calculation results
- authoritative sources

### H. Rooftop-use advisor
Suggest feasible uses for remaining roof area:
- rooftop garden
- vertical garden
- outdoor seating
- shaded lounge
- compact light-use gym
- utility/storage zone
- drying/laundry area
- EV charging area where appropriate
- other regionally relevant uses

Heavy structures require structural review.

### I. Accessory advisor
Recommend useful equipment around the solar installation:
- monitoring
- surge protection
- earthing/lightning protection where appropriate
- smart energy meter
- battery/backup when relevant
- EV charger when relevant
- cleaning/maintenance equipment
- safety signage/access
- bird/pest mitigation when appropriate
- cable management
- water/cleaning considerations

Recommendations must be based on user goals, system type, roof and policy—not upselling.

## 5. India-first policy scope

Launch priority:
1. PM Surya Ghar / MNRE
2. Maharashtra Energy Department
3. MSEDCL
4. Maharashtra electricity regulations / relevant regulator
5. MEDA / official state renewable-energy sources
6. Other states progressively

For every state, identify the relevant DISCOM(s), regulator, energy department and official scheme sources.

## 6. International strategy

Do not attempt to maintain every country's policy manually for MVP.

For non-India users:
- identify country/region
- identify utility/jurisdiction
- perform live authoritative-source research
- tell the user it is being checked
- cache the result temporarily
- label it "live researched" until curated
- never imply global completeness

## 7. Product principles

- Policy-backed, not blog-backed.
- Calculated, not hallucinated.
- Current, not hardcoded.
- Explainable, not opaque.
- India-first, globally extensible.
- Engineering data separate from AI inspiration.
- No benefit double-counting.
- No fabricated deadlines or guaranteed subsidy dates.
