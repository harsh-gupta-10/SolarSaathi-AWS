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

`PolicyBenefitRuleV1` stores scope, jurisdiction, effective window, a fixed,
per-kW, tiered-kW or percentage-of-policy-eligible-cost formula, system size
limits, typed applicant conditions, reciprocal compatibility edges, overlap
group, and individual/combined caps. Values are integer paise or basis points.
Each rule points to an immutable active policy version and independently
verified numeric and clause facts with official archive citations. The current
source check remains a separate live record; updating it never rewrites the
source or fact version. No scheme amount lives in product source code.

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

The Phase 10 engine performs an exact, bounded search over at most 16 relevant
active rules. The API prefilters by declared jurisdiction. Missing applicant
facts have a third `UNKNOWN` state; they are never assumed eligible. Positive
stacking requires reciprocal, explicitly supported compatibility edges.
Overlap groups and mutually exclusive rules cannot be counted together.
Combined caps are applied once, with deterministic tie-breaking. Arithmetic
uses BigInt internally and returns bounded integer paise. When more than 16
relevant rules exist, the API returns unavailable rather than a partial
"optimum." A scope is marked covered only after independent coverage review.

## Output

`BenefitStackResultV1` returns selected, ineligible, unknown and excluded
decisions with reason codes, verified rule/policy/fact IDs, current source
checks, citations and a total of counted selected benefits. It does not
calculate net installed cost or payback; that integration belongs to Phase 11.
When no current verified rules are available, the API returns `UNAVAILABLE`
without an amount. Stale evidence and absent policy-eligible cost do not
become zero.

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

> "Based on the current verified rules and the details you provided, these are the benefits this check could include. Policy coverage and official approval may change the outcome."

Final benefit is subject to official verification and scheme processing.
