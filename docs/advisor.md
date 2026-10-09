# Grounded solar and policy advisor

The Phase 13 advisor is a read-only explanation layer over an authenticated
homeowner's saved property and confirmed roof analysis. An optional scenario
uses the existing deterministic system, financial, and policy evaluators. An
optional application context uses the stored, user-reported tracker snapshot.
The advisor does not write any of these records.

## Fact boundary

The server loads the property, analysis, policy state, and application through
the same ownership checks as their source APIs. It creates bounded fact cards
with explicit provenance. Financial and benefit amounts come only from the
deterministic evaluators and user-supplied scenario inputs. A verified policy
card retains its source citations, jurisdiction, effective period, policy
version, verification status, and source-check metadata.
An application card labels progress as user reported; it does not imply that a
government portal approved, received, or paid anything.

Amazon Bedrock may select relevant card IDs from a bounded list. Its output is
validated against that list, and the server composes the answer from the card
statements. Model prose, arithmetic, policy claims, links, and instructions
from retrieved material are not admitted into the final answer. No raw address,
application reference, document contents, or policy archive text is sent to
Bedrock in the default prompt. If Bedrock is unconfigured, unavailable, or
returns invalid selection, the same fact cards remain available through a
deterministic fallback. Missing context is stated rather than guessed.

## User flow

The signed-in user selects an owned property and a confirmed, unexpired roof
analysis. They can ask a bounded question and optionally provide the same
scenario inputs used by the policy-backed financial endpoint, or choose an
application tracker for progress context. The UI displays the answer, individual
fact cards, provenance, official citations when available, missing inputs,
and caveats. Changing accounts clears prior results; changing property or
analysis clears incompatible context.

`GET /v1/properties/{propertyId}/analyses` lists a bounded page of that
property's confirmed analysis summaries for selection. Expired Google analyses
are excluded. `POST /v1/advisor/solar` accepts IDs, question, and optional
scenario/application context; it never accepts browser-supplied roof geometry,
policy facts, or application status as trusted grounding. See [API contracts](api.md).

## Limits

The advisor cannot establish a subsidy, installation approval, structural
safety, tariff, payment date, or official application status. A local demo may
show fictional data only when conspicuously labelled and kept separate from
live account actions. Live Bedrock, Cognito, DynamoDB, Google Solar, and policy
behavior require deployment and integration verification.
