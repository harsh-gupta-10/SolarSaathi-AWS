# Subsidy and Application Tracker

## Purpose

Turn a one-time subsidy calculation into a guided workflow that helps the homeowner complete the official process.

## Application object

```json
{
  "applicationId": "APP#...",
  "propertyId": "PROPERTY#...",
  "schemeId": "PM_SURYA_GHAR",
  "jurisdiction": "IN-MH",
  "discom": "MSEDCL",
  "systemKw": 3,
  "status": "INSTALLATION",
  "referenceNumber": null,
  "vendorId": null,
  "steps": []
}
```

## Dynamic checklist

Checklist comes from the active policy/process record.

Typical states may include:
- ELIGIBILITY_CHECK
- APPLICATION_SUBMITTED
- VENDOR_SELECTED
- DISCOM_FEASIBILITY
- INSTALLATION
- INSPECTION
- METER
- COMMISSIONING
- CFA/SUBSIDY_PROCESSING
- SUBSIDY_RECEIVED

Do not assume every jurisdiction has the same sequence.

## Step transitions

Each step:
- PENDING
- IN_PROGRESS
- COMPLETED
- BLOCKED
- NOT_APPLICABLE

Every change stores:
- timestamp
- actor
- previous state
- new state
- optional note

## Chat-driven updates

User:
> I submitted my application today.

Assistant:
- identify the relevant active application
- mark application submitted
- timestamp
- ask for reference number only if useful

User:
> The vendor installed the panels.

Assistant:
- mark installation complete/in-progress according to user wording
- show next policy-defined step

Never infer official completion merely from a user's ambiguous statement.

## Documents

Store metadata, not sensitive document contents by default:
- document type
- uploaded timestamp
- status
- S3 object key if uploaded
- verification status

Sensitive documents must have strict authorization.

## Status UI

```text
Eligibility          ✓
Application          ✓
Vendor               ✓
Feasibility          ✓
Installation         ●
Inspection           ○
Meter                ○
Commissioning        ○
Subsidy processing   ○
Subsidy received     ○
```

## Official links

Every process step should link to the authoritative portal/document when possible.

## Notifications

Future optional features:
- reminder for incomplete checklist
- source/policy change affecting application
- user-entered deadline
- application milestone reminders

Never claim an official processing deadline unless the policy source explicitly states one.
