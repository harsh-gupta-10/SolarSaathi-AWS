# Security and Trust

## Authentication
Use Cognito.

The Phase 2 integration uses Cognito managed-login authorization code + PKCE.
There is no client secret or browser identity pool. Cognito handles email
verification, sign-in, sign-up, MFA challenges and recovery on its hosted pages.
The SAM public client has short-lived tokens, refresh-token rotation and revocation;
organization attributes are read-only to that client. Google federation is optional,
and its secret is referenced from Secrets Manager, never browser configuration.

Amplify token persistence uses short-lived, secure-on-HTTPS, SameSite=Lax cookies
instead of its default localStorage. These SDK cookies are JavaScript-readable,
not HttpOnly: XSS remains a risk. A production review must decide whether an
HttpOnly server-session/BFF is required and add an appropriate script CSP;
the baseline frame/object/base restrictions are not a complete XSS defense.
OAuth callback code/state must be removed from the URL after exchange/failure.

The backend identity endpoint verifies JWTs with `aws-jwt-verify`, including
issuer, signature, expiry, access-token use and app-client binding. It never
trusts gateway claim objects or caller role/organization headers. Strict bearer
header parsing rejects ambiguity and oversized tokens. A bounded Cognito
`GetUser` call confirms the subject and current token acceptance before returning
an allowlisted identity response; no tokens or raw SDK errors are logged.

`GetUser` is authorized by the user's access token and does not evaluate IAM
policies: do not add privileged Cognito/admin policies to the Lambda role for this
endpoint. Signature-only verification cannot establish database membership;
Phase 3 must enforce ownership and tenant membership separately.

The browser's optional API identity check omits cookies, rejects redirects,
validates the response subject/shape and clears its result when accounts change.
The read-only readiness CLI checks metadata only and does not claim live login
or revoke/modify sessions.

## Authorization
Enforce role and ownership server-side.

Roles:
- HOMEOWNER
- BROKER
- ADMIN_POLICY
- ADMIN

## Policy integrity
Only authorized policy admins may approve a production policy version.

Use conditional DynamoDB writes so two admins cannot activate conflicting versions.

Phase 8 ingestion accepts only exact official hosts from a reviewed registry.
The server derives source authority from source type, verifies the current
Cognito session and `ADMIN_POLICY`/`ADMIN` group, and archives bounded HTML/PDF
bytes privately with hashes and immutable document-version records. Parsed text
and chunks are untrusted evidence. Ingestion never publishes a policy fact or
grants a crawler permission to follow an arbitrary link.

Phase 9 fetches only enabled, curated official sources. The fetcher validates
the exact HTTPS host on each redirect, resolves and pins public DNS addresses,
obeys robots exclusions, and applies response, time and byte limits. A
15-minute EventBridge worker checks a bounded due-source batch with a
conditional lease and one reserved concurrent execution. Failures preserve
prior document evidence, record a bounded error code and trigger a CloudWatch
error alarm. The private archive enforces conditional object creation for raw
and derived prefixes. The admin review API requires a separate reviewer from
the source curator and a revision-checked transaction; approved evidence is
still unverified for homeowner policy/benefit use. Local checks do not prove
deployed IAM, Cognito, network or alarm routing.

Phase 10 publication binds each numeric and operative rule clause to an exact
excerpt in an immutable archived official document. The backend derives the
fact IDs and checks document hashes, current source status and source
precedence; it does not accept browser-supplied authority or publication IDs.
An admin different from the draft author and source curator must publish, with
revision-checked DynamoDB transactions and audit records. The homeowner route
loads only an owned analysis and active rules, and fails closed when there are
no current rules or the bounded rule catalog cannot support evaluation. Local
tests exercise these controls but do not establish live IAM or policy coverage.

Phase 12 process steps use the same archived-excerpt and independent-review
publication gate. Application creation reevaluates an owned roof and selected
benefit, requires fresh healthy official-source checks, and condition-checks
the active rule/version in the DynamoDB creation transaction. Application
reads and mutations first verify property ownership or organization scope.
Revision-checked writes append immutable audit events. Browser supplied step
templates, policy facts or benefit amounts are ignored/rejected. The
conversation style suggestion stores no message and never updates a step;
the user must explicitly confirm through the audited step endpoint. Document
records are metadata only. Application progress is user reported and must not
be displayed as official government completion.

Application writes also condition-check the current organization membership,
stored user role, property and property locator revisions in the same DynamoDB
transaction as the mutation. A broker whose access or property association
changes after the initial read cannot commit a stale update.

Phase 16 broker proposals recompute policy and financial results against an
owned, unexpired analysis before saving. Customer, property and analysis IDs
must form one current organization-scoped chain. The browser cannot supply
benefit amounts or policy provenance as trusted values. A saved proposal is
an as-of snapshot with coverage and source freshness displayed, not a promise
of subsidy receipt or a generated official document. Retention of any
Google-derived proposal snapshot is bounded by its analysis expiry and
hard-delete indexing; proposal detail reads reject expired records.
Lead stage changes use a broker-only expected-revision transaction with
current organization membership and stored role checks plus an immutable
event. Stage labels are user reported workflow notes.

Phase 18 policy rollback is an administrator-only publication action. A
requester records a reason and expected active version; a different verified
policy administrator approves or rejects with a separate reason. The reviewer
cannot be the historical version author or bound source curator. Approval
rechecks the immutable target's official citation against the current crawled
document, source freshness, effective dates and any cross-source precedence.
The final DynamoDB transaction condition-checks active version and source/crawl
revisions, writes a new immutable version and activation/audit records, and
never deletes or rewrites older versions. A stale or conflicting target is
blocked rather than silently reactivated. The browser cannot choose trusted
facts, amounts or citations for a rollback.

## Sensitive data
Protect:
- identity data
- application reference numbers
- utility details
- uploaded documents
- financial information
- address/property information

Do not expose private S3 objects publicly.

## Application document uploads
Applicants can attach ID, bill, property, bank and certificate files to an
application tracker. Decided policy (2026-10-11):

- **Storage:** a dedicated private bucket per stage (`ApplicationDocumentBucket`).
  Block Public Access is fully on, objects are bucket-owner enforced, default
  encryption is SSE-S3 (AES-256), a bucket policy denies non-TLS requests, and
  versioning is off so a deletion is final.
- **What is accepted:** `application/pdf`, `image/jpeg`, `image/png`, 1 byte to
  10 MB. Keys are built by the server as
  `applications/{sha256(ownerUserId)[0..32]}/{applicationId}/{documentId}`; a
  user-supplied filename never reaches a key or a response header.
- **Upload:** the API records the document as `PENDING_UPLOAD` and returns a
  presigned `PUT` valid for 5 minutes with `content-type` and `content-length`
  signed, so S3 rejects any other declared type or size. The browser sends the
  file straight to S3 without cookies or the Cognito token.
- **Confirmation:** a file counts as stored only after the confirm call checks
  `HeadObject` size and content type and the first bytes against the declared
  type's file signature (PDF, JPEG, PNG). A mismatch deletes the object.
  The client-computed SHA-256 is recorded as `sha256Reported`; it is not
  verified by the server.
- **Access:** only users who pass the property access check (owner, or a member
  of the owning organization) can confirm, download or delete. Downloads use a
  presigned `GET` valid for 5 minutes with `Content-Disposition: attachment`.
- **Retention and deletion:** objects under `applications/` expire 365 days after
  upload (S3 lifecycle); the tracker shows the deletion date and refuses
  downloads after it. Incomplete multipart uploads are aborted after 1 day.
  The delete endpoint removes the object first, then the metadata with an
  audited `DOCUMENT_DELETED` event, so a retried delete never leaves an orphan.
  A `PENDING_UPLOAD` entry whose object was never confirmed can be deleted the
  same way.
- **Logging:** request logs record only request ID, status and duration. File
  contents, presigned URLs and object keys are never logged.
- **Not yet enabled (optional):** S3 server access logs or CloudTrail S3 data
  events for object-level audit, malware scanning, and account-deletion cascade
  to documents. Decide before production use.

## Google roof data retention
Google Maps Platform's Solar API terms limit cached Building Insights and Data
Layers to 30 calendar days, except for the specific fixed-media downstream
transaction exception. SolarSaathi does not rely on that exception for its live
roof records. Google-derived previews expire after 15 minutes; analyses and
cache records expire within 21 days of retrieval. The backend refuses expired
reads. A sparse DynamoDB expiry index and hourly EventBridge worker hard-delete
expired records with conditional writes; DynamoDB TTL remains a backup because
its physical deletion is asynchronous. The worker has a bounded page budget and
a CloudWatch error alarm for backlog or failure. Operators must investigate
alarms promptly and review retained backups before production use. Manual
measurements are user-provided and remain separate from Google-derived data.

## Secrets
Never put:
- Google server API keys
- AWS credentials
- Bedrock credentials
- internal admin tokens
in frontend code.

Use environment configuration / AWS secret management where required.

## Crawler security
- allowlist canonical domains
- rate limit
- avoid arbitrary URL fetching
- validate redirects
- restrict internal network access
- reject private IP targets
- sanitize extracted content
- never execute downloaded documents

Phase 17 international research accepts no browser-supplied URL. Only exact
reviewed official hosts can be fetched; redirects stay on that host, DNS
answers must be public, and the TLS connection is pinned to the checked
address. Apply robots, response byte and time limits. Optional external search
gets a fixed generic country/host query only; no user region, utility, free
text or coordinates go to the search provider. Browser geolocation happens
only on a button click and coordinates are sent to the AWS backend for a
single-use reverse geocode; neither coordinates nor geocode output are cached.
Cache data is versioned, validated on read and bounded by TTL. Live research
cannot feed the verified India benefit engine or be published as policy.

## Prompt injection
Government web pages and uploaded documents are untrusted content.

The policy extractor must treat page text as data, not instructions.

## AI advisor
The server must bind every advisor request to a verified Cognito identity and
recheck ownership of the property, confirmed analysis, and optional application.
The browser must not supply trusted roof, policy, calculation, or application
facts. Advisor requests are read only. Keep question and response sizes bounded.

Build deterministic, provenance-labelled cards from owned data and current
policy evaluation. Bedrock may select only known card IDs; server validation
rejects any unknown or malformed selection, and server code renders the final
answer from the original cards. Do not pass raw addresses, application
references, document contents, credentials, or policy archive text to the model
by default. The model must never calculate financial values, decide subsidy
eligibility, or turn user-reported progress into official status. On model
failure, use a deterministic cited fallback with explicit missing context.
Do not log the question, selected fact statements, model prompt, or model
response in application logs; keep invocation logging disabled or assess its
private data exposure before production use.

## Chat assistant (conversations and untrusted content)
Supersedes the advisor rule that the question is never stored: the chat assistant stores conversations for the signed-in user.

- Chat requires sign-in. The Function URL has no IAM auth; the handler verifies the Cognito access token on every request, checks the
  `Origin` header against `ApplicationOrigin`, and keys all data by the verified user id.
- Retention: conversations, messages, proposals and rate counters carry `expiresAtEpochSeconds` (90 days for chats). Users can delete one chat or all
  chats (`DELETE /v1/chats`). Logs hold metadata only: request id, counts, token usage, stop reason, tool names. Never log message text, prompts, tool results or model output.
- Sensitive data: Aadhaar, PAN, IFSC, card numbers, OTPs, passwords, bank account and consumer numbers are masked in code before the text is stored or sent to the model, and
  Bedrock Guardrails apply regex and PII filters as a second layer. The consumer number is never stored. The assistant never requests these values and never contacts government portals.
- Threat model, prompt-injection surfaces: user messages; property labels and addresses; vendor names; web search results and fetched pages; tool results; policy document text.
  Rules: all such text is data. Web pages are parsed by deterministic regex and never forwarded to a model; model-visible tool summaries wrap user-derived labels in
  `<untrusted_data>` and strip angle brackets; user text is escaped so it cannot forge the context markers; fetched pages cannot trigger tool calls (research is one bounded search plus at most three fetches).
- Numbers: the model only explains. A deterministic post-check replaces any rupee, kW, percent or payback figure in model text that is absent from this conversation's tool results. Tool arguments that
  represent user-supplied figures must appear in the user's own messages, otherwise the tool asks the user to confirm.
- Mutations: model tools only create server-side proposals (random 128-bit id, 10 minute expiry, parameter hash, single-use conditional claim). Only `POST /v1/chat/confirm` executes them, through the
  same services and ownership checks as the REST API, with idempotency keys derived from the proposal.
- Fetching: price research uses an authority-tiered host allowlist, public DNS, pinned TLS socket, robots.txt, byte and time limits. Candidates are saved as `CANDIDATE` and need a different
  policy administrator to approve. Confirm Brave's terms permit persisting extracted figures before enabling research in production (only URLs and extracted figures are stored, not snippets).
- Cost and abuse: per-user 30 turns/hour, 200 turns/day, 400,000 tokens/day, 5 research searches/day, 8 tool iterations, bounded output tokens and turn timeout.

## Financial safety
Do not guarantee:
- subsidy
- savings
- payback
- processing time
- installation approval

## Engineering safety
AI rooftop images are conceptual only.
No structural approval is implied.

For remaining-roof concepts, all fit decisions and clearance geometry must
come from owned, server-loaded roof and deterministic layout data. Generic
template lookup uses a normalized non-address fingerprint and repeats the
fit check for the current roof. Generated images are private property/analysis
assets with bounded bytes, content type and expiry; never serve another
property's asset or expose a raw S3 key to an unauthorized caller. Bedrock
prompts omit raw address, coordinates, Google imagery and user documents.
An unavailable model/storage service must preserve the deterministic 3D/plan
concept and state uncertainty explicitly.

Accessory advice must use an owned, confirmed roof and backend-recomputed
system candidate. Self-reported inverter, EV, electrical and site details are
planning context. Do not claim circuit, voltage/current, battery, charger,
earthing, lightning, or structural compatibility without a qualified design
review. No accessory may be labelled legally required, subsidy eligible, or
priced from a generic catalog without current supporting evidence. Never add
an optional accessory to the policy-eligible solar quote automatically.

## Audit
Keep:
- policy changes
- approvals
- calculation provenance
- application state transitions
- admin actions

### Document deletion paths (review fixes, 2026-10-11)
- **Delete a document:** the S3 object is removed first, then the record; if the record changed meanwhile, the removal is
  retried once on the latest revision, so no entry keeps offering a download for a missing file.
- **Delete a property:** the core function collects the S3 keys of every application document of that property while
  purging its records, then deletes those objects (IAM: `s3:DeleteObject` on `applications/*` only). A failure is logged
  as `PROPERTY_PURGE_INCOMPLETE`; lifecycle expiry (365 days) is the backstop.
- **Unfinished uploads:** the upload link is signed before anything is recorded; a pending entry can request a fresh
  link (`confirm` with `reissueUpload`) and must be completed with a file of the same type and size.
- Still open: deleting documents when a whole *account* is deleted.

## External AI provider: OpenAI (optional, 2026-10-11)

When `ChatProvider=openai`, the chat assistant sends the (masked) conversation, the tool results the user's question needed
and the system prompt to `api.openai.com`. This is an external integration like Google Maps/Solar, not a replacement for AWS.
- **Key handling:** the API key lives only in AWS Secrets Manager. The chat function reads it at request time through one
  read-only statement scoped to that secret, caches it five minutes in memory and never logs, returns or echoes it. It is not
  in Lambda environment variables, CloudFormation parameters (only the secret's ARN), the repository or the browser.
  Rotate by writing a new secret value; revoke the old key at OpenAI.
- **Data sent:** masked user text (Aadhaar, bank, card, password, OTP and consumer numbers are removed first), tool summaries
  of the user's own saved roof/system/financial/benefit data, and the fixed system prompt. No credentials or other users' data.
  Confirm OpenAI's current API data-retention terms before enabling it for real customers; document them in the privacy notice.
- **Requests** use HTTPS, do not follow redirects, are bounded by the chat turn deadline, and the provider's error text is
  truncated and never includes the key.
- **Controls that remain:** sensitive-data masking, grounding filter, per-user limits, confirm-before-change cards. Bedrock
  Guardrails do not apply on this path.
