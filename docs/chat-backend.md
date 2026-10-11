# Chat backend

Plan: [chat-assistant-plan.md](chat-assistant-plan.md). Wire contract: `packages/types/src/chat.ts` ([chat-api-contract.md](chat-api-contract.md)).

## Modules (`apps/api/src`)
| Path | Role |
|---|---|
| `chat/agent.ts` | `runTurn` async generator: Bedrock `ConverseStream` loop (max 8 tool iterations, token cap, turn timeout), frozen prompt, sorted strict tools, prompt-cache checkpoints (auto-disabled if the model rejects them), guardrail config, refusal and guardrail handling, emits `ChatStreamEvent`s |
| `chat/prompt.ts` | Frozen system prompt (no per-request data) |
| `chat/grounding.ts` | Pure figure extraction and replacement (`GroundingContext`, `groundText`, `GroundingStream`) |
| `chat/redact.ts` | Masks Aadhaar, PAN, IFSC, cards, OTP, passwords, bank accounts and consumer numbers |
| `chat/store.ts`, `limits.ts`, `keys.ts`, `config.ts` | Conversation store (`CHAT#{userId}` partition, 90-day TTL), turn limits and token budget, constants |
| `chat/proposals.ts`, `confirm.ts`, `proposal-schemas.ts` | Single-use proposals and confirmation executor |
| `chat/idempotency.ts` | Conditional-put idempotency; used by confirm and by `Idempotency-Key` on `POST /properties` and `/applications` |
| `chat/checklist.ts` | PM Surya Ghar readiness pack (published policy steps or labelled general guidance) |
| `chat/tools/*` | `check_benefits`, `confirm_roof`, `estimate_savings`, `explain_policy`, `get_indicative_quote`, `get_property_summary`, `list_my_customers` (broker), `list_my_properties`, `prepare_application`, `recommend_accessories`, `recommend_systems`, `research_prices`, `start_property`, `update_application_step` |
| `chat/services.ts`, `stream-service.ts` | Service graph and the turn orchestration (limits, masking, persistence) |
| `handlers/chat-stream.ts` | Function URL streaming handler (SSE) |
| `handlers/chats.ts` | REST list/get/delete and `POST /v1/chat/confirm` |
| `handlers/price-admin.ts` | Price benchmark administration |
| `pricing/*` | Benchmark schema, store, domain allowlist, deterministic extraction, Brave client, research service |
| `lib/item-table.ts` | Narrow DynamoDB access (get, put, conditional update, query prefix, counters) |
| `packages/calculations/src/quote.ts` | Deterministic indicative-quote engine over APPROVED benchmarks |

Chat items use partition `CHAT#{userId}` rather than `USER#{userId}` so IAM `dynamodb:LeadingKeys` can grant write access without allowing writes to account profiles.
Per-turn tool summaries are stored on assistant messages (not returned by the API) so later turns can restate earlier tool figures.

## Price benchmarks
`PRICE_BENCHMARK#{id}` records with scope (national, state, DISCOM), size band, module class, inverter type, rupees per kW min/typical/max, inclusions, source, dates and
status `CANDIDATE`, `APPROVED`, `SUPERSEDED`, `REJECTED`. The quote engine uses only APPROVED, unexpired benchmarks that match scope, band, module class and inverter type.
The most specific scope wins (DISCOM, then state). A national benchmark yields UNAVAILABLE plus a labelled wider-scope reference. Subsidy is never netted. No benchmarks are seeded.
Research candidates are written with creator `SYSTEM:RESEARCH`; a policy admin must approve them. A manually created candidate must be approved by a different admin.

## Deployment parameters and outputs
- Parameters: existing `AdvisorBedrockModelId`, `AdvisorBedrockModelArn`, `AdvisorBedrockFoundationModelArn`, `AdvisorBedrockRegion` select the model (set them to Claude Opus 5.5 and its inference profile);
  `BraveSearchKeySecretArn` enables research; new `GuardrailId` and `GuardrailVersion` (blank creates the stack-managed `ChatGuardrail`).
- Function environment: `CORE_TABLE_NAME`, `POLICY_TABLE_NAME`, `BEDROCK_MODEL_ID`, `BEDROCK_REGION`, `GUARDRAIL_ID`, `GUARDRAIL_VERSION`, `BRAVE_SEARCH_API_KEY`.
  Optional (not set by the template): `CHAT_PROMPT_CACHE=false` to skip cache checkpoints; `CHAT_MODEL_REQUEST_FIELDS` JSON passed as `additionalModelRequestFields` (for example an effort setting; the field name is model specific and must be verified in the console).
- Output `ChatStreamUrl` is the value for the web app's `NEXT_PUBLIC_CHAT_STREAM_URL`.

## Running tests
```
pnpm --filter @solarsaathi/api test         # includes chat-*.test.ts, pricing.test.ts, chat-guardrails.test.ts
pnpm --filter @solarsaathi/calculations test
pnpm test:infra                              # SAM template invariants
pnpm sam:validate                            # cfn-lint through SAM
```
`tests/chat-guardrails.test.ts` is the CI eval set (off-topic, jailbreak, injection in a fake price page, subsidy bait, PII paste, Hinglish) using recorded model fixtures; live-model evals are run on demand.
