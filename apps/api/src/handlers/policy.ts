import type { APIGatewayProxyEvent } from "aws-lambda";
import { createCognitoIdentityResolver, type CognitoIdentityResolver } from "../auth/cognito";
import { currentIdentityResponse } from "../auth/profile";
import { jsonResponse, parseJsonObject, RequestError, withRequestLogging } from "../lib/http";
import { PolicyService } from "../policy/service";
import { DynamoPolicyRepository, S3PolicyObjectStore, type PolicyObjectStore, type PolicyRepository } from "../policy/storage";

const SOURCE_ROUTE = "/v1/admin/policy/sources";
const DOCUMENT_ROUTE = "/v1/admin/policy/documents";

function route(event: APIGatewayProxyEvent): string {
  const resource = event.resource.startsWith("/v1/") ? event.resource : `/v1${event.resource}`;
  const stage = event.requestContext?.stage;
  const relative = stage && event.path.startsWith(`/${stage}/`) ? event.path.slice(stage.length + 1) : event.path;
  const path = relative.startsWith("/v1/") ? relative : `/v1${relative}`;
  const selected = [resource, path].find(value => value === SOURCE_ROUTE || value === DOCUMENT_ROUTE);
  if (!selected) throw new RequestError(404, "NOT_FOUND", "The requested endpoint was not found.");
  if (event.httpMethod !== "POST") throw new RequestError(405, "METHOD_NOT_ALLOWED", "Use POST for this endpoint.");
  return selected;
}

export interface PolicyHandlerDependencies {
  resolveIdentity?: CognitoIdentityResolver;
  createRepository?: (tableName: string, region: string) => PolicyRepository;
  createObjectStore?: (bucket: string, region: string) => PolicyObjectStore;
  now?: () => Date;
}

export function createPolicyHandler(dependencies: PolicyHandlerDependencies = {}) {
  const resolveIdentity = dependencies.resolveIdentity ?? createCognitoIdentityResolver();
  const createRepository = dependencies.createRepository ?? ((tableName: string, region: string) =>
    new DynamoPolicyRepository(tableName, region));
  const createObjectStore = dependencies.createObjectStore ?? ((bucket: string, region: string) =>
    new S3PolicyObjectStore(bucket, region));
  return withRequestLogging(async (event, context, environment) => {
    const path = route(event);
    const user = await resolveIdentity(event, environment);
    const identity = currentIdentityResponse(user, context.awsRequestId);
    if (!identity.emailVerified || !user.groups.some(group => group === "ADMIN_POLICY" || group === "ADMIN")) {
      throw new RequestError(403, "POLICY_ADMIN_REQUIRED", "A verified policy administrator account is required.");
    }
    const tableName = process.env.POLICY_TABLE_NAME;
    const bucket = process.env.POLICY_DOCUMENT_BUCKET;
    if (!tableName || !/^[A-Za-z0-9_.-]{3,255}$/.test(tableName) ||
      !bucket || !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) {
      throw new RequestError(503, "POLICY_STORAGE_NOT_CONFIGURED", "The policy archive is not configured.");
    }
    const service = new PolicyService(createRepository(tableName, environment.AWS_REGION),
      createObjectStore(bucket, environment.AWS_REGION), dependencies.now);
    const body = parseJsonObject(event, path === DOCUMENT_ROUTE ? 3_000_000 : 65_536);
    if (path === SOURCE_ROUTE) {
      const result = await service.registerSource(body, context.awsRequestId);
      return jsonResponse(result.created ? 201 : 200, result);
    }
    const result = await service.ingestDocument(body, context.awsRequestId);
    return jsonResponse(result.created ? 201 : 200, result);
  });
}

export const handler = createPolicyHandler();
