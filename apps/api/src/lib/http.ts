import type { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from "aws-lambda";
import { parseServerEnv } from "@solarsaathi/config/server";
import type { ApiErrorResponse } from "@solarsaathi/types";

export class RequestError extends Error {
  constructor(public readonly statusCode: number, public readonly code: string, message: string) {
    super(message);
  }
}

export function jsonResponse(statusCode: number, body: unknown): APIGatewayProxyResult {
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
    body: JSON.stringify(body),
  };
}

export function parseJsonObject(event: APIGatewayProxyEvent, maximumBodyBytes = 65_536): Record<string, unknown> {
  const contentType = Object.entries(event.headers).find(([name]) => name.toLowerCase() === "content-type")?.[1];
  if (contentType?.split(";")[0].trim().toLowerCase() !== "application/json") {
    throw new RequestError(415, "UNSUPPORTED_MEDIA_TYPE", "Send an application/json request.");
  }

  const body = event.isBase64Encoded
    ? Buffer.from(event.body ?? "", "base64").toString("utf8")
    : event.body ?? "";
  if (Buffer.byteLength(body, "utf8") > maximumBodyBytes) {
    throw new RequestError(413, "PAYLOAD_TOO_LARGE", "The JSON request exceeds the endpoint size limit.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new RequestError(400, "INVALID_REQUEST", "Send a valid JSON object.");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new RequestError(400, "INVALID_REQUEST", "Send a valid JSON object.");
  }
  return parsed as Record<string, unknown>;
}

type RequestHandler = (
  event: APIGatewayProxyEvent,
  context: Context,
  environment: ReturnType<typeof parseServerEnv>,
) => APIGatewayProxyResult | Promise<APIGatewayProxyResult>;

export function withRequestLogging(handle: RequestHandler) {
  return async (event: APIGatewayProxyEvent, context: Context): Promise<APIGatewayProxyResult> => {
    const startedAt = Date.now();
    let logLevel = "info";
    let allowedOrigin: string | undefined;
    let response: APIGatewayProxyResult;
    try {
      const environment = parseServerEnv(process.env);
      logLevel = environment.LOG_LEVEL;
      allowedOrigin = environment.API_ALLOWED_ORIGIN;
      response = await handle(event, context, environment);
    } catch (error) {
      const expected = error instanceof RequestError;
      const body: ApiErrorResponse = {
        error: {
          code: expected ? error.code : "INTERNAL_ERROR",
          message: expected ? error.message : "The service could not complete the request.",
          requestId: context.awsRequestId,
        },
      };
      response = jsonResponse(expected ? error.statusCode : 500, body);
    }

    if (allowedOrigin) {
      response.headers = { ...response.headers, "access-control-allow-origin": allowedOrigin, vary: "Origin" };
    }
    const level = response.statusCode >= 500 ? "error" : response.statusCode >= 400 ? "warn" : "info";
    const priorities: Record<string, number> = { debug: 0, info: 1, warn: 2, error: 3 };
    if (priorities[level] >= priorities[logLevel]) {
      console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        level,
        service: "solarsaathi-api",
        event: "request_completed",
        requestId: context.awsRequestId,
        statusCode: response.statusCode,
        durationMs: Date.now() - startedAt,
      }));
    }
    return response;
  };
}

export function notImplemented(message: string, requestId: string): APIGatewayProxyResult {
  const body: ApiErrorResponse = { error: { code: "NOT_IMPLEMENTED", message, requestId } };
  return jsonResponse(501, body);
}
