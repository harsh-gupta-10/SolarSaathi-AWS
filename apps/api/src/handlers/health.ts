import type { HealthResponse } from "@solarsaathi/types";
import { jsonResponse, withRequestLogging } from "../lib/http";

export const handler = withRequestLogging((_event, context, environment) => {
  const body: HealthResponse = {
    status: "ok",
    service: "solarsaathi-api",
    environment: environment.ENVIRONMENT,
    version: "0.1.0",
    requestId: context.awsRequestId,
  };
  return jsonResponse(200, body);
});
