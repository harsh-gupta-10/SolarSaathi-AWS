# Subsidy and Application Tracker

## Source of the checklist

An application begins only from a positive `SELECTED` Phase 10 benefit for an
owned, confirmed, unexpired roof analysis. Its active policy version must carry
`processSteps`. A policy administrator supplies an exact archived official
excerpt for every step; a separate reviewer publishes the immutable policy
version and verified TEXT facts. Older benefit rules without sourced steps
remain valid for benefit calculation but cannot create a tracker. The API
returns `PROCESS_TEMPLATE_UNAVAILABLE` instead of inventing a jurisdictional
checklist.

The application snapshots the selected benefit, policy/rule version, process
order, step citations and source check times at creation. A later policy change
does not silently rewrite an applicant's history. The UI links to the official
document, shows its version and verification time, and distinguishes this
process snapshot from user reported progress.

## Persisted application

`SOLAR_APPLICATION` belongs to a property and includes the confirmed analysis
ID, creator, selected benefit and system, policy version, cited step snapshot,
user reported step statuses, optional vendor name and application reference,
document *metadata*, revision and timestamps. Initial steps are `PENDING`.
The backend derives `expectedNextStepId` from ordered required steps and then
optional steps. `status` is `IN_PROGRESS`, `BLOCKED`, or `COMPLETED`; it is a
summary of the user's checklist, not government approval.

Each step may be `PENDING`, `IN_PROGRESS`, `COMPLETED`, `BLOCKED`, or
`NOT_APPLICABLE`. A required step cannot be marked `NOT_APPLICABLE`. Correcting
a completed or skipped step requires a note. Every mutation checks the
expected revision and writes an immutable actor/timestamp audit event in the
same DynamoDB transaction. An owner or authorized organization member can
read and update a property tracker; the backend enforces scope on every call.

## Conversation style update

The user can describe an update for a chosen step. The deterministic
`chat-update` route may suggest a status for explicit wording, but it always
requires confirmation, stores no message, and makes no state change. Ambiguous,
future or negated wording produces no suggested status. The user reviews the
suggestion and saves it through the audited step transition. This is not an
official portal chatbot or a source of official completion data.

## Documents and reminders

The tracker stores a document type, label, optional date received and recorded
time. It does not upload contents or assert document verification. Official
application/reference numbers and vendor names are user supplied. No portal
polling, official deadline, automated notification or reminder service is
currently configured. The UI directs users to the source for current
instructions and status. Future reminders require user controlled timing and
an explicit notification channel.

The synthetic `/demo/application-tracker` fixture exists for visual and
accessibility inspection only. It is labelled as fictional and its controls
are disabled.
