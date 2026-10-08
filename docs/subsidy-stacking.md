# Subsidy Stacking and Benefit Optimization

## Goal

Find the highest **valid** benefit available to a specific customer, not the highest number produced by blindly adding schemes.

## Core concept

Potential benefits:

```text
Central
+ State
+ DISCOM
+ Local/municipal
+ Other compatible financial benefit
= candidate total
```

Then apply:

```text
eligibility
→ compatibility
→ exclusions
→ caps
→ timing
→ beneficiary rules
→ property rules
→ equipment rules
→ geography
→ scheme-specific calculation
```

## Never assume stacking

A benefit can be:
- ADDITIVE
- CAPPED_COMBINED
- MUTUALLY_EXCLUSIVE
- CONDITIONAL
- ALTERNATIVE
- SEQUENTIAL
- NOT_STACKABLE
- UNKNOWN

If compatibility is unknown, do not count it in the final eligible total.

## Data model

```json
{
  "benefitId": "SYNTHETIC_CENTRAL_EXAMPLE",
  "scope": "CENTRAL",
  "jurisdiction": "IN",
  "calculation": {
    "type": "TIERED_KW",
    "tiers": [
      {"upToKw": 2, "inrPerKw": 10000},
      {"upToKw": 3, "inrPerKw": 5000}
    ],
    "capInr": 25000
  },
  "compatibility": {
    "with": ["STATE_EXAMPLE"],
    "mode": "CONDITIONAL"
  },
  "source": {
    "policyId": "..."
  }
}
```

This object is a synthetic shape example, not a current scheme or benefit
value. Production calculations must read approved active policy versions and
their citations from the policy database.

## Eligibility dimensions

Check:
- country
- state
- district/local body if relevant
- DISCOM
- customer type
- residential/commercial
- ownership/occupancy
- grid connection
- sanctioned load
- system size
- installation date
- vendor eligibility
- equipment requirements
- prior subsidy
- scheme participation
- property status
- application timing

## Stacking algorithm

```text
1. Retrieve all applicable active benefits.
2. Filter by jurisdiction.
3. Filter by customer/property eligibility.
4. Calculate each benefit independently.
5. Resolve compatibility graph.
6. Remove mutually exclusive combinations.
7. Apply combined caps.
8. Apply priority/precedence.
9. Produce optimal valid combination.
10. Return excluded benefits and reasons.
```

## Output

```json
{
  "grossCost": 195000,
  "benefits": [],
  "totalEligibleBenefit": 0,
  "netCost": 195000,
  "policyVersions": [],
  "warnings": ["No approved current policy facts were available for evaluation."]
}
```

This example deliberately contains no unverified benefit amount.

## Explain non-eligible schemes

Example:

> Maharashtra state benefit: Not included. No verified compatible state subsidy was found for this residential installation.

Or:

> Potential benefit identified, but not included because the source does not establish that it can be combined with PM Surya Ghar.

This is better than hiding it.

## Auditability

Store:
- input facts
- policies used
- rule IDs
- calculated amount
- exclusions
- policy versions
- timestamp

## Important

Never display:

> "You will definitely receive ₹X."

Prefer:

> "Based on the current verified policy rules and the information you provided, you may be eligible for up to ₹X."

Final benefit is subject to official verification and scheme processing.
