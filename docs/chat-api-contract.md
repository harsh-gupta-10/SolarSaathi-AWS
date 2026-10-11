# Chat API contract (draft v1)

Types: `packages/types/src/chat.ts`. Plan: `docs/chat-assistant-plan.md`.

- **Stream:** `POST {NEXT_PUBLIC_CHAT_STREAM_URL}` (Lambda Function URL, `RESPONSE_STREAM`). Header
  `Authorization: Bearer <Cognito access token>`. Body `ChatStreamRequest`. Response `text/event-stream`; each SSE
  `data:` line is one JSON `ChatStreamEvent`. The stream always ends with `done` or `error`.
- **REST (API Gateway, Cognito):** `GET /v1/chats`, `GET /v1/chats/{chatId}`, `DELETE /v1/chats/{chatId}`,
  `DELETE /v1/chats` (delete all), `POST /v1/chat/confirm` (`ChatConfirmRequest` -> `ChatConfirmResponse`).
- Mutating tools never execute from model output. They emit a `proposal`; only `/v1/chat/confirm` executes it.
- Authoritative numbers appear only inside `card` events. If model text contains an ungrounded figure the server
  replaces it and emits `grounding`.
