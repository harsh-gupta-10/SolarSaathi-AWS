import type { APIGatewayProxyEvent } from "aws-lambda";
import { createCognitoIdentityResolver, type CognitoIdentityResolver } from "../auth/cognito";
import { currentIdentityResponse } from "../auth/profile";
import { documentExecutor } from "../data/client";
import { CoreRepository } from "../data/repository";
import { CoreService } from "../data/service";
import { jsonResponse, parseJsonObject, RequestError, withRequestLogging } from "../lib/http";
import { GoogleRoofClient } from "../roof/google";
import { RoofService } from "../roof/service";

const paths = new Set(["/v1/solar/geocode", "/v1/solar/building-insights", "/v1/solar/confirm-building", "/v1/solar/confirm-roof"]);

function pathFor(event: APIGatewayProxyEvent): string {
  const resource = event.resource.startsWith("/v1/") ? event.resource : `/v1${event.resource}`;
  if (paths.has(resource)) return resource;
  const stage = event.requestContext?.stage;
  const relative = stage && event.path.startsWith(`/${stage}/`) ? event.path.slice(stage.length + 1) : event.path;
  const path = relative.startsWith("/v1/") ? relative : `/v1${relative}`;
  if (paths.has(path)) return path;
  throw new RequestError(404, "NOT_FOUND", "The requested endpoint was not found.");
}

export interface RoofHandlerDependencies {
  resolveIdentity?: CognitoIdentityResolver;
  createRepository?: (tableName: string, region: string) => CoreRepository;
  createGoogleClient?: (geocodingKey?: string, solarKey?: string) => GoogleRoofClient;
  now?: () => Date;
  createId?: () => string;
}

export function createRoofHandler(dependencies: RoofHandlerDependencies = {}) {
  const resolveIdentity = dependencies.resolveIdentity ?? createCognitoIdentityResolver();
  const createRepository = dependencies.createRepository ?? ((tableName: string, region: string) =>
    new CoreRepository(tableName, documentExecutor(region)));
  const createGoogleClient = dependencies.createGoogleClient ?? ((geocodingKey?: string, solarKey?: string) =>
    new GoogleRoofClient(geocodingKey, solarKey));
  return withRequestLogging(async (event, context, environment) => {
    const path = pathFor(event);
    if (event.httpMethod !== "POST") throw new RequestError(405, "METHOD_NOT_ALLOWED", "Use POST for this endpoint.");
    if (!environment.CORE_TABLE_NAME) throw new RequestError(503, "DATABASE_NOT_CONFIGURED", "The core database is not configured.");
    const body = parseJsonObject(event);
    const identity = currentIdentityResponse(await resolveIdentity(event, environment), context.awsRequestId);
    const core = new CoreService(createRepository(environment.CORE_TABLE_NAME, environment.AWS_REGION), dependencies);
    const roof = new RoofService(core, createGoogleClient(environment.GOOGLE_GEOCODING_API_KEY, environment.GOOGLE_SOLAR_API_KEY), dependencies.now);
    if (path === "/v1/solar/geocode") return jsonResponse(200, await roof.geocode(identity, body, context.awsRequestId));
    if (path === "/v1/solar/building-insights") return jsonResponse(200, await roof.buildingInsights(identity, body, context.awsRequestId));
    if (path === "/v1/solar/confirm-building") return jsonResponse(200, await roof.confirmBuilding(identity, body, context.awsRequestId));
    return jsonResponse(201, await roof.confirmRoof(identity, body, context.awsRequestId));
  });
}

export const handler = createRoofHandler();
