import type { APIGatewayProxyEvent } from "aws-lambda";
import { createCognitoIdentityResolver, type CognitoIdentityResolver } from "../auth/cognito";
import { currentIdentityResponse } from "../auth/profile";
import { documentExecutor } from "../data/client";
import { CoreRepository } from "../data/repository";
import { CoreService, type ServiceDependencies } from "../data/service";
import { idempotencyHeader, runIdempotent } from "../chat/idempotency";
import { DynamoItemTable, type ItemTable } from "../lib/item-table";
import { parseDraft, readDraft, writeDraft } from "../data/drafts";
import { S3ApplicationDocumentStore } from "../applications/documents";
import { jsonResponse, parseJsonObject, RequestError, withRequestLogging } from "../lib/http";

export interface CoreHandlerDependencies extends ServiceDependencies {
  resolveIdentity?: CognitoIdentityResolver;
  createRepository?: (tableName: string, region: string) => CoreRepository;
  createItems?: (tableName: string, region: string) => ItemTable;
}
const routes = new Map([
  ["/v1/users/me", ["GET"]], ["/v1/users/bootstrap", ["POST"]], ["/v1/organizations/me", ["GET"]],
  ["/v1/customers", ["GET", "POST"]], ["/v1/properties", ["GET", "POST"]],
  ["/v1/properties/{propertyId}", ["GET", "DELETE"]], ["/v1/leads", ["GET", "POST"]],
  ["/v1/properties/{propertyId}/analyses", ["GET"]],
  ["/v1/properties/{propertyId}/analyses/{analysisId}", ["GET"]],
  ["/v1/properties/{propertyId}/analyses/{analysisId}/draft", ["GET", "PUT"]],
]);

function versionedPath(path: string): string {
  return path.startsWith("/v1/") ? path : `/v1${path}`;
}

function route(event: APIGatewayProxyEvent): { path: string; propertyId?: string; analysisId?: string } {
  // API Gateway's resource excludes the stage; older local fixtures include /v1.
  const resource = versionedPath(event.resource);
  if (routes.has(resource)) {
    return { path: resource, ...(resource.includes("{propertyId}") ? { propertyId: event.pathParameters?.propertyId } : {}),
      ...(resource.includes("{analysisId}") ? { analysisId: event.pathParameters?.analysisId } : {}) };
  }
  const stage = event.requestContext?.stage;
  const stageRelativePath = stage && event.path.startsWith(`/${stage}/`) ? event.path.slice(stage.length + 1) : event.path;
  const path = versionedPath(stageRelativePath);
  if (routes.has(path) && !path.endsWith("{propertyId}")) return { path };
  const match = /^\/v1\/properties\/([^/]+)$/.exec(path);
  if (match) return { path: "/v1/properties/{propertyId}", propertyId: match[1] };
  const analyses = /^\/v1\/properties\/([^/]+)\/analyses$/.exec(path);
  if (analyses) return { path: "/v1/properties/{propertyId}/analyses", propertyId: analyses[1] };
  const analysis = /^\/v1\/properties\/([^/]+)\/analyses\/([^/]+)$/.exec(path);
  if (analysis) return { path: "/v1/properties/{propertyId}/analyses/{analysisId}", propertyId: analysis[1], analysisId: analysis[2] };
  const draft = /^\/v1\/properties\/([^/]+)\/analyses\/([^/]+)\/draft$/.exec(path);
  if (draft) return { path: "/v1/properties/{propertyId}/analyses/{analysisId}/draft", propertyId: draft[1], analysisId: draft[2] };
  throw new RequestError(404, "NOT_FOUND", "The requested endpoint was not found.");
}

function pageOptions(event: APIGatewayProxyEvent) {
  const values = event.queryStringParameters ?? {};
  const multiple = event.multiValueQueryStringParameters ?? {};
  if (Object.keys(values).some(name => !["cursor", "limit"].includes(name)) ||
    Object.entries(multiple).some(([name, list]) => !["cursor", "limit"].includes(name) || !list || list.length !== 1 || list[0] !== values[name])) {
    throw new RequestError(400, "INVALID_REQUEST", "Only a single cursor and limit are supported.");
  }
  if (values.limit !== undefined && !/^[1-9][0-9]?$/.test(values.limit)) {
    throw new RequestError(400, "INVALID_REQUEST", "Provide a list limit between 1 and 50.");
  }
  return { ...(values.cursor !== undefined ? { cursor: values.cursor } : {}), ...(values.limit !== undefined ? { limit: Number(values.limit) } : {}) };
}

export function createCoreHandler(dependencies: CoreHandlerDependencies = {}) {
  const resolve = dependencies.resolveIdentity ?? createCognitoIdentityResolver();
  const createRepository = dependencies.createRepository ?? ((tableName, region) => new CoreRepository(tableName, documentExecutor(region)));
  return withRequestLogging(async (event, context, environment) => {
    const { path, propertyId, analysisId } = route(event);
    if (!routes.get(path)?.includes(event.httpMethod)) throw new RequestError(405, "METHOD_NOT_ALLOWED", "Use a supported method for this endpoint.");
    if (!environment.CORE_TABLE_NAME) throw new RequestError(503, "DATABASE_NOT_CONFIGURED", "The core database is not configured.");
    const identity = currentIdentityResponse(await resolve(event, environment), context.awsRequestId);
    const documentBucket = process.env.APPLICATION_DOCUMENT_BUCKET;
    const service = new CoreService(createRepository(environment.CORE_TABLE_NAME, environment.AWS_REGION), {
      ...dependencies,
      deleteDocumentObjects: dependencies.deleteDocumentObjects ?? (documentBucket ? async keys => {
        const store = new S3ApplicationDocumentStore(documentBucket, environment.AWS_REGION);
        for (const key of keys) await store.delete(key);
      } : undefined),
    });
    const createPropertyOnce = async (request: APIGatewayProxyEvent, userId: string, env: typeof environment, core: CoreService) => {
      const body = parseJsonObject(request);
      const key = idempotencyHeader(request.headers);
      if (key === undefined) return core.createProperty(identity, body);
      const items = (dependencies.createItems ?? ((name, region) => new DynamoItemTable(name, region)))(env.CORE_TABLE_NAME!, env.AWS_REGION);
      return (await runIdempotent(items, userId, "CREATE_PROPERTY", key, () => core.createProperty(identity, body), dependencies.now)).value;
    };
    const response = { schemaVersion: 1 as const, source: "DYNAMODB" as const, requestId: context.awsRequestId };
    if (path === "/v1/users/me") return jsonResponse(200, { ...response, user: await service.getUser(identity) });
    if (path === "/v1/users/bootstrap") return jsonResponse(200, { ...response, ...await service.bootstrap(identity, parseJsonObject(event)) });
    if (path === "/v1/organizations/me") return jsonResponse(200, { ...response, organization: await service.getOrganization(identity) });
    if (path === "/v1/properties/{propertyId}") {
      if (!propertyId) throw new RequestError(400, "INVALID_REQUEST", "Provide a property ID.");
      if (event.httpMethod === "DELETE") return jsonResponse(200, { ...response, ...await service.deleteProperty(identity, propertyId) });
      return jsonResponse(200, { ...response, property: await service.getProperty(identity, propertyId) });
    }
    if (path === "/v1/properties/{propertyId}/analyses") {
      if (!propertyId) throw new RequestError(400, "INVALID_REQUEST", "Provide a property ID.");
      return jsonResponse(200, { ...response, ...await service.listAnalyses(identity, propertyId, pageOptions(event)) });
    }
    if (path === "/v1/properties/{propertyId}/analyses/{analysisId}" || path === "/v1/properties/{propertyId}/analyses/{analysisId}/draft") {
      if (!propertyId || !analysisId) throw new RequestError(400, "INVALID_REQUEST", "Provide a property and analysis ID.");
      // getAnalysis checks property ownership, the analysis record's owner and Google retention expiry.
      const record = await service.getAnalysis(identity, propertyId, analysisId);
      if (!record.roofModel) throw new RequestError(404, "NOT_FOUND", "The requested record was not found.");
      if (path.endsWith("/{analysisId}")) {
        return jsonResponse(200, { ...response, source: record.roofModel.source, analysisId: record.analysisId, roof: record.roofModel });
      }
      const items = (dependencies.createItems ?? ((name, region) => new DynamoItemTable(name, region)))(environment.CORE_TABLE_NAME, environment.AWS_REGION);
      const now = dependencies.now?.() ?? new Date();
      if (event.httpMethod === "GET") {
        const saved = await readDraft(items, propertyId, analysisId, now);
        return jsonResponse(200, { ...response, analysisId, ...(saved ?? { draft: null }) });
      }
      const saved = await writeDraft(items, { propertyId, analysisId, ownerUserId: record.ownerUserId, draft: parseDraft(parseJsonObject(event, 32_768)), now,
        ...(record.expiresAtEpochSeconds === undefined ? {} : { analysisExpiresAtEpochSeconds: record.expiresAtEpochSeconds }) });
      return jsonResponse(200, { ...response, analysisId, ...saved });
    }
    if (path === "/v1/customers") {
      return event.httpMethod === "GET" ? jsonResponse(200, { ...response, ...await service.listCustomers(identity, pageOptions(event)) }) :
        jsonResponse(201, { ...response, customer: await service.createCustomer(identity, parseJsonObject(event)) });
    }
    if (path === "/v1/properties") {
      return event.httpMethod === "GET" ? jsonResponse(200, { ...response, ...await service.listProperties(identity, pageOptions(event)) }) :
        jsonResponse(201, { ...response, property: await createPropertyOnce(event, identity.profile.userId, environment, service) });
    }
    return event.httpMethod === "GET" ? jsonResponse(200, { ...response, ...await service.listLeads(identity, pageOptions(event)) }) :
      jsonResponse(201, { ...response, lead: await service.createLead(identity, parseJsonObject(event)) });
  });
}

export const handler = createCoreHandler();
