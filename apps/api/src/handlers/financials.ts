import type { APIGatewayProxyEvent } from "aws-lambda";
import { createCognitoIdentityResolver, type CognitoIdentityResolver } from "../auth/cognito";
import { currentIdentityResponse } from "../auth/profile";
import { documentExecutor } from "../data/client";
import { CoreRepository } from "../data/repository";
import { CoreService, type ServiceDependencies } from "../data/service";
import { FinancialsService } from "../financials/service";
import { jsonResponse, parseJsonObject, RequestError, withRequestLogging } from "../lib/http";

const FINANCIALS_PATH = "/v1/financials/estimate";

function route(event: APIGatewayProxyEvent): void {
  const resource = event.resource.startsWith("/v1/") ? event.resource : `/v1${event.resource}`;
  const stage = event.requestContext?.stage;
  const relative = stage && event.path.startsWith(`/${stage}/`) ? event.path.slice(stage.length + 1) : event.path;
  const path = relative.startsWith("/v1/") ? relative : `/v1${relative}`;
  if (resource !== FINANCIALS_PATH && path !== FINANCIALS_PATH) {
    throw new RequestError(404, "NOT_FOUND", "The requested endpoint was not found.");
  }
  if (event.httpMethod !== "POST") throw new RequestError(405, "METHOD_NOT_ALLOWED", "Use POST for this endpoint.");
}

export interface FinancialsHandlerDependencies extends ServiceDependencies {
  resolveIdentity?: CognitoIdentityResolver;
  createRepository?: (tableName: string, region: string) => CoreRepository;
}

export function createFinancialsHandler(dependencies: FinancialsHandlerDependencies = {}) {
  const resolveIdentity = dependencies.resolveIdentity ?? createCognitoIdentityResolver();
  const createRepository = dependencies.createRepository ?? ((tableName: string, region: string) =>
    new CoreRepository(tableName, documentExecutor(region)));
  return withRequestLogging(async (event, context, environment) => {
    route(event);
    if (!environment.CORE_TABLE_NAME) {
      throw new RequestError(503, "DATABASE_NOT_CONFIGURED", "The core database is not configured.");
    }
    const body = parseJsonObject(event);
    const identity = currentIdentityResponse(await resolveIdentity(event, environment), context.awsRequestId);
    const core = new CoreService(createRepository(environment.CORE_TABLE_NAME, environment.AWS_REGION), dependencies);
    return jsonResponse(200, await new FinancialsService(core).estimate(identity, body, context.awsRequestId));
  });
}

export const handler = createFinancialsHandler();
