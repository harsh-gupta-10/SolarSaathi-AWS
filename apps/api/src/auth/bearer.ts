import type { APIGatewayProxyEvent } from "aws-lambda";
import { unauthorized } from "./errors";

export const MAX_ACCESS_TOKEN_LENGTH = 8_192;

export function bearerAccessToken(event: APIGatewayProxyEvent): string {
  const headers = Object.entries(event.headers ?? {}).filter(([name]) => name.toLowerCase() === "authorization");
  const multiple = Object.entries(event.multiValueHeaders ?? {}).filter(([name]) => name.toLowerCase() === "authorization");
  if (headers.length > 1 || multiple.length > 1 || (!headers.length && !multiple.length)) {
    throw unauthorized();
  }
  const singleValue = headers[0]?.[1];
  const multipleValues = multiple[0]?.[1];
  if ((headers.length && typeof singleValue !== "string") ||
    (multiple.length && (!Array.isArray(multipleValues) || multipleValues.length !== 1 || typeof multipleValues[0] !== "string"))) {
    throw unauthorized();
  }
  // API Gateway mirrors a single header in both maps; only identical mirrors are accepted.
  if (headers.length && multiple.length &&
    (headers[0][0] !== multiple[0][0] || singleValue !== multipleValues?.[0])) {
    throw unauthorized();
  }
  const value = singleValue ?? multipleValues?.[0];
  if (typeof value !== "string" || value.length > MAX_ACCESS_TOKEN_LENGTH + 7) {
    throw unauthorized();
  }
  const match = value.match(/^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i);
  if (!match || match[1].length > MAX_ACCESS_TOKEN_LENGTH) {
    throw unauthorized();
  }
  return match[1];
}
