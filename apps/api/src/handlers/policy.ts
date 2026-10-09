import type { APIGatewayProxyEvent } from "aws-lambda";
import { createCognitoIdentityResolver, type CognitoIdentityResolver } from "../auth/cognito";
import { currentIdentityResponse } from "../auth/profile";
import { jsonResponse, parseJsonObject, RequestError, withRequestLogging } from "../lib/http";
import { PolicyService } from "../policy/service";
import { DynamoPolicyRepository, S3PolicyObjectStore, type PolicyObjectStore, type PolicyRepository } from "../policy/storage";
import { PolicyWorkflowService } from "../policy/workflow-service";
import { DynamoPolicyWorkflowRepository, type PolicyWorkflowRepository } from "../policy/workflow-storage";

const SOURCE_ROUTE = "/v1/admin/policy/sources";
const DOCUMENT_ROUTE = "/v1/admin/policy/documents";
const CURATE_ROUTE = "/v1/admin/policy/sources/curate";
const CRAWL_ROUTE = "/v1/admin/policy/sources/crawl";
const QUEUE_ROUTE = "/v1/admin/policy/queue";
const CRAWLER_RUNS_ROUTE = "/v1/admin/policy/crawler-runs";
const CONFLICTS_ROUTE = "/v1/admin/policy/conflicts";

function route(event: APIGatewayProxyEvent): { kind: string; candidateId?: string; changeId?: string } {
  const resource = event.resource.startsWith("/v1/") ? event.resource : `/v1${event.resource}`;
  const stage = event.requestContext?.stage;
  const relative = stage && event.path.startsWith(`/${stage}/`) ? event.path.slice(stage.length + 1) : event.path;
  const path = relative.startsWith("/v1/") ? relative : `/v1${relative}`;
  const selected = [resource, path].find(value =>
    [SOURCE_ROUTE, DOCUMENT_ROUTE, CURATE_ROUTE, CRAWL_ROUTE, QUEUE_ROUTE, CRAWLER_RUNS_ROUTE, CONFLICTS_ROUTE].includes(value));
  if (selected) {
    const method = [QUEUE_ROUTE, CRAWLER_RUNS_ROUTE, CONFLICTS_ROUTE].includes(selected) ? "GET" :
      selected === SOURCE_ROUTE ? event.httpMethod : "POST";
    if (event.httpMethod !== method || (selected === SOURCE_ROUTE && !["GET", "POST"].includes(method))) {
      throw new RequestError(405, "METHOD_NOT_ALLOWED", "Use the supported method for this endpoint.");
    }
    return { kind: selected };
  }
  const changePath = path.match(/^\/v1\/admin\/policy\/changes\/([^/]+)(?:\/(approve|reject))?$/);
  if (changePath || resource.startsWith("/v1/admin/policy/changes/{changeId}")) {
    let changeId: string;
    try { changeId = decodeURIComponent(event.pathParameters?.changeId ?? changePath?.[1] ?? ""); }
    catch { throw new RequestError(400, "INVALID_REQUEST", "The change ID is invalid."); }
    const action = changePath?.[2] ?? (resource.endsWith("/approve") ? "approve" : resource.endsWith("/reject") ? "reject" : undefined);
    if (event.httpMethod !== (action ? "POST" : "GET")) {
      throw new RequestError(405, "METHOD_NOT_ALLOWED", "Use the supported method for this endpoint.");
    }
    return { kind: action ? `change-${action}` : "change", changeId };
  }
  const candidatePath = path.match(/^\/v1\/admin\/policy\/candidates\/([^/]+)(?:\/(approve|reject))?$/);
  if (!candidatePath && !resource.startsWith("/v1/admin/policy/candidates/{candidateId}")) {
    throw new RequestError(404, "NOT_FOUND", "The requested endpoint was not found.");
  }
  let candidateId: string;
  try { candidateId = decodeURIComponent(event.pathParameters?.candidateId ?? candidatePath?.[1] ?? ""); }
  catch { throw new RequestError(400, "INVALID_REQUEST", "The candidate ID is invalid."); }
  const action = candidatePath?.[2] ?? (resource.endsWith("/approve") ? "approve" : resource.endsWith("/reject") ? "reject" : undefined);
  if (event.httpMethod !== (action ? "POST" : "GET")) {
    throw new RequestError(405, "METHOD_NOT_ALLOWED", "Use the supported method for this endpoint.");
  }
  return { kind: action ?? "candidate", candidateId };
}

export interface PolicyHandlerDependencies {
  resolveIdentity?: CognitoIdentityResolver;
  createRepository?: (tableName: string, region: string) => PolicyRepository;
  createWorkflowRepository?: (tableName: string, region: string) => PolicyWorkflowRepository;
  createObjectStore?: (bucket: string, region: string) => PolicyObjectStore;
  now?: () => Date;
}

export function createPolicyHandler(dependencies: PolicyHandlerDependencies = {}) {
  const resolveIdentity = dependencies.resolveIdentity ?? createCognitoIdentityResolver();
  const createRepository = dependencies.createRepository ?? ((tableName: string, region: string) =>
    new DynamoPolicyRepository(tableName, region));
  const createWorkflowRepository = dependencies.createWorkflowRepository ?? ((tableName: string, region: string) =>
    new DynamoPolicyWorkflowRepository(tableName, region));
  const createObjectStore = dependencies.createObjectStore ?? ((bucket: string, region: string) =>
    new S3PolicyObjectStore(bucket, region));
  return withRequestLogging(async (event, context, environment) => {
    const selected = route(event);
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
    const repository = createRepository(tableName, environment.AWS_REGION);
    const objects = createObjectStore(bucket, environment.AWS_REGION);
    const service = new PolicyService(repository, objects, dependencies.now);
    const workflow = new PolicyWorkflowService(repository,
      createWorkflowRepository(tableName, environment.AWS_REGION), dependencies.now,
      objects.getDerived ? { getDerived: (key, versionId) => objects.getDerived!(key, versionId) } : undefined);
    if (selected.kind === SOURCE_ROUTE && event.httpMethod === "GET") {
      return jsonResponse(200, await workflow.listSources(context.awsRequestId,
        event.queryStringParameters?.limit, event.queryStringParameters?.cursor));
    }
    if (selected.kind === CRAWLER_RUNS_ROUTE) {
      return jsonResponse(200, await workflow.listRuns(context.awsRequestId,
        event.queryStringParameters?.limit, event.queryStringParameters?.cursor));
    }
    if (selected.kind === CONFLICTS_ROUTE) {
      return jsonResponse(200, await workflow.listConflicts(context.awsRequestId,
        event.queryStringParameters?.limit, event.queryStringParameters?.cursor));
    }
    if (selected.kind === QUEUE_ROUTE) {
      return jsonResponse(200, await workflow.queue(event.queryStringParameters?.limit,
        event.queryStringParameters?.cursor, context.awsRequestId));
    }
    if (selected.kind === "candidate") {
      return jsonResponse(200, await workflow.candidate(selected.candidateId ?? "", context.awsRequestId));
    }
    if (selected.kind === "change") {
      return jsonResponse(200, await workflow.change(selected.changeId ?? "", context.awsRequestId));
    }
    const body = parseJsonObject(event, selected.kind === DOCUMENT_ROUTE ? 3_000_000 : 65_536);
    if (selected.kind === SOURCE_ROUTE) {
      const result = await service.registerSource(body, context.awsRequestId);
      return jsonResponse(result.created ? 201 : 200, result);
    }
    if (selected.kind === CURATE_ROUTE) {
      return jsonResponse(200, await workflow.curateSource(body, identity.profile.userId, context.awsRequestId));
    }
    if (selected.kind === CRAWL_ROUTE) {
      return jsonResponse(202, await workflow.requestCrawl(body, identity.profile.userId, context.awsRequestId));
    }
    if (selected.kind === "approve" || selected.kind === "reject") {
      return jsonResponse(200, await workflow.review(selected.candidateId ?? "",
        selected.kind === "approve" ? "APPROVED" : "REJECTED", body, identity.profile.userId, context.awsRequestId));
    }
    if (selected.kind === "change-approve" || selected.kind === "change-reject") {
      return jsonResponse(200, await workflow.reviewChange(selected.changeId ?? "",
        selected.kind === "change-approve" ? "APPROVED" : "REJECTED", body,
        identity.profile.userId, context.awsRequestId));
    }
    const result = await service.ingestDocument(body, context.awsRequestId);
    return jsonResponse(result.created ? 201 : 200, result);
  });
}

export const handler = createPolicyHandler();
