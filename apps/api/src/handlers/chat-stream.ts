import { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";
import { parseServerEnv } from "@solarsaathi/config/server";
import type { APIGatewayProxyEvent, Context, LambdaFunctionURLEvent } from "aws-lambda";
import type { Writable } from "node:stream";
import type { ChatStreamEvent } from "@solarsaathi/types";
import type { BedrockStreamClient } from "../chat/agent";
import { createChatRuntime, type ChatRuntime, type ChatServiceDependencies } from "../chat/services";
import { handleChatTurn } from "../chat/stream-service";
import { createCognitoIdentityResolver, type CognitoIdentityResolver } from "../auth/cognito";
import { currentIdentityResponse } from "../auth/profile";
import { RequestError } from "../lib/http";

/** `awslambda` is injected by the Lambda Node.js runtime for response streaming. */
interface AwsLambdaStreaming {
  streamifyResponse(handler: (event: LambdaFunctionURLEvent, stream: Writable, context: Context) => Promise<void>): unknown;
  HttpResponseStream: { from(stream: Writable, metadata: { statusCode: number; headers: Record<string, string> }): Writable };
}
const MAX_BODY_BYTES = 16_384;

export interface ChatStreamDependencies extends ChatServiceDependencies {
  resolveIdentity?: CognitoIdentityResolver;
  runtime?: ChatRuntime;
  client?: BedrockStreamClient;
}

export interface SseSink { begin(statusCode: number, headers: Record<string, string>): void; write(chunk: string): void; end(): void }

function parseBody(event: LambdaFunctionURLEvent): unknown {
  const raw = event.isBase64Encoded ? Buffer.from(event.body ?? "", "base64").toString("utf8") : event.body ?? "";
  if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) throw new RequestError(413, "PAYLOAD_TOO_LARGE", "The message request is too large.");
  try { return JSON.parse(raw); } catch { throw new RequestError(400, "INVALID_REQUEST", "Send a valid JSON object."); }
}

const securityHeaders = { "cache-control": "no-store", "x-content-type-options": "nosniff" };
const event = (value: ChatStreamEvent) => `data: ${JSON.stringify(value)}\n\n`;

/** Testable core: verifies the caller, then streams SSE events into the sink. Never throws after `begin`. */
export async function serveChatStream(request: LambdaFunctionURLEvent, sink: SseSink, context: { awsRequestId: string },
  dependencies: ChatStreamDependencies = {}, resolveIdentity: CognitoIdentityResolver = createCognitoIdentityResolver()) {
  const failJson = (statusCode: number, code: string, message: string) => {
    sink.begin(statusCode, { "content-type": "application/json; charset=utf-8", ...securityHeaders });
    sink.write(JSON.stringify({ error: { code, message, requestId: context.awsRequestId } })); sink.end();
  };
  let environment: ReturnType<typeof parseServerEnv>;
  try { environment = parseServerEnv(process.env); } catch { return failJson(500, "INTERNAL_ERROR", "The service could not complete the request."); }
  const headers = Object.fromEntries(Object.entries(request.headers ?? {}).map(([name, value]) => [name.toLowerCase(), value]));
  if (request.requestContext?.http?.method !== "POST") return failJson(405, "METHOD_NOT_ALLOWED", "Use POST for this endpoint.");
  if (environment.API_ALLOWED_ORIGIN && headers.origin && headers.origin !== environment.API_ALLOWED_ORIGIN) {
    return failJson(403, "ORIGIN_NOT_ALLOWED", "This origin is not allowed.");
  }
  if (!headers["content-type"]?.toLowerCase().startsWith("application/json")) return failJson(415, "UNSUPPORTED_MEDIA_TYPE", "Send an application/json request.");
  let identity;
  try {
    const user = await resolveIdentity({ headers: { authorization: headers.authorization }, multiValueHeaders: {} } as unknown as APIGatewayProxyEvent, environment);
    identity = currentIdentityResponse(user, context.awsRequestId);
  } catch (error) {
    return error instanceof RequestError ? failJson(error.statusCode, error.code, error.message) : failJson(401, "UNAUTHORIZED", "Sign in again.");
  }
  let body: unknown;
  try { body = parseBody(request); } catch (error) {
    return error instanceof RequestError ? failJson(error.statusCode, error.code, error.message) : failJson(400, "INVALID_REQUEST", "Send a valid JSON object.");
  }
  let runtime: ChatRuntime;
  try { runtime = dependencies.runtime ?? createChatRuntime(environment, dependencies); }
  catch (error) { return error instanceof RequestError ? failJson(error.statusCode, error.code, error.message) : failJson(500, "INTERNAL_ERROR", "The service could not complete the request."); }

  sink.begin(200, { "content-type": "text/event-stream; charset=utf-8", connection: "keep-alive", ...securityHeaders });
  sink.write(": open\n\n");
  const modelId = environment.BEDROCK_MODEL_ID;
  const guardrailId = process.env.GUARDRAIL_ID?.trim();
  const guardrailVersion = process.env.GUARDRAIL_VERSION?.trim();
  let additional: Record<string, unknown> | undefined;
  try { additional = process.env.CHAT_MODEL_REQUEST_FIELDS ? JSON.parse(process.env.CHAT_MODEL_REQUEST_FIELDS) as Record<string, unknown> : undefined; } catch { additional = undefined; }
  const config = modelId ? { modelId, ...(guardrailId && guardrailVersion ? { guardrail: { id: guardrailId, version: guardrailVersion } } : {}),
    promptCache: process.env.CHAT_PROMPT_CACHE !== "false", ...(additional ? { additionalModelRequestFields: additional } : {}),
    log: (value: Record<string, unknown>) => console.log(JSON.stringify({ timestamp: new Date().toISOString(), service: "solarsaathi-chat", ...value })) } : undefined;
  const client = dependencies.client ?? (modelId ? new BedrockRuntimeClient({ region: environment.BEDROCK_REGION ?? environment.AWS_REGION, maxAttempts: 2,
    requestHandler: { connectionTimeout: 2_000, requestTimeout: 90_000 } }) as unknown as BedrockStreamClient : undefined);
  const aborted = new AbortController();
  try {
    for await (const value of handleChatTurn(runtime, client, config, { identity, requestId: context.awsRequestId, body, signal: aborted.signal })) {
      sink.write(event(value));
    }
  } catch {
    aborted.abort();
  } finally { sink.end(); }
}

export function createChatStreamHandler(dependencies: ChatStreamDependencies = {}) {
  const lambda = (globalThis as { awslambda?: AwsLambdaStreaming }).awslambda;
  const resolveIdentity = dependencies.resolveIdentity ?? createCognitoIdentityResolver();
  if (typeof lambda?.streamifyResponse !== "function") return undefined;
  return lambda.streamifyResponse(async (request, stream, context) => {
    let target: Writable = stream;
    await serveChatStream(request, {
      begin: (statusCode, headers) => { target = lambda.HttpResponseStream.from(stream, { statusCode, headers }); },
      write: chunk => { target.write(chunk); }, end: () => { target.end(); },
    }, context, dependencies, resolveIdentity);
  });
}

export const handler = createChatStreamHandler();
