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

## Sensitive data
Protect:
- identity data
- application reference numbers
- utility details
- uploaded documents
- financial information
- address/property information

Do not expose private S3 objects publicly.

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
