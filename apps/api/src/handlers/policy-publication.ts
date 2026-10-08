import type { APIGatewayProxyEvent } from "aws-lambda";
import { createCognitoIdentityResolver, type CognitoIdentityResolver } from "../auth/cognito";
import { currentIdentityResponse } from "../auth/profile";
import { jsonResponse, parseJsonObject, RequestError, withRequestLogging } from "../lib/http";
import { PolicyPublicationService } from "../policy/publication-service";
import { DynamoPolicyPublicationRepository, type PolicyPublicationRepository } from "../policy/publication-storage";
import { DynamoPolicyRepository, S3PolicyObjectStore, type PolicyRepository } from "../policy/storage";
import { DynamoPolicyWorkflowRepository, type PolicyWorkflowRepository } from "../policy/workflow-storage";

function route(event: APIGatewayProxyEvent): { action: "create" | "queue" | "detail" | "submit" | "publish" | "reject";
  draftId?: string } {
  const stage = event.requestContext?.stage;
  const path = event.path.startsWith(`/${stage}/`) ? event.path.slice(stage.length + 1) : event.path;
  const selected = path.startsWith("/v1/") ? path : `/v1${path}`;
  if (selected === "/v1/admin/policy/benefits/drafts" && event.httpMethod === "POST") return { action: "create" };
  if (selected === "/v1/admin/policy/benefits/queue" && event.httpMethod === "GET") return { action: "queue" };
  const match = selected.match(/^\/v1\/admin\/policy\/benefits\/(DRAFT%23[a-f0-9]{32}|DRAFT#[a-f0-9]{32})(?:\/(submit|publish|reject))?$/i);
  if (!match) throw new RequestError(404, "NOT_FOUND", "The requested endpoint was not found.");
  const action = (match[2] ?? "detail") as "detail" | "submit" | "publish" | "reject";
  if (event.httpMethod !== (action === "detail" ? "GET" : "POST")) throw new RequestError(405, "METHOD_NOT_ALLOWED", "Use the supported method.");
  return { action, draftId: decodeURIComponent(match[1]!) };
}

export interface PublicationHandlerDependencies {
  resolveIdentity?: CognitoIdentityResolver;
  createRecords?: (tableName: string, region: string) => PolicyRepository;
  createWorkflow?: (tableName: string, region: string) => PolicyWorkflowRepository;
  createPublication?: (tableName: string, region: string) => PolicyPublicationRepository;
  createArchive?: (bucket: string, region: string) => { getDerived(key: string, versionId: string): Promise<Uint8Array> };
  now?: () => Date;
}

export function createPolicyPublicationHandler(dependencies: PublicationHandlerDependencies = {}) {
  const identityResolver = dependencies.resolveIdentity ?? createCognitoIdentityResolver();
  return withRequestLogging(async (event, context, environment) => {
    const selected = route(event);
    const user = await identityResolver(event, environment);
    const identity = currentIdentityResponse(user, context.awsRequestId);
    if (!identity.emailVerified || !user.groups.some(group => group === "ADMIN_POLICY" || group === "ADMIN")) {
      throw new RequestError(403, "POLICY_ADMIN_REQUIRED", "A verified policy administrator account is required.");
    }
    const table = process.env.POLICY_TABLE_NAME;
    const bucket = process.env.POLICY_DOCUMENT_BUCKET;
    if (!table || !bucket) throw new RequestError(503, "POLICY_STORAGE_NOT_CONFIGURED", "Policy publication is not configured.");
    const records = (dependencies.createRecords ?? ((name, region) => new DynamoPolicyRepository(name, region)))(table, environment.AWS_REGION);
    const workflow = (dependencies.createWorkflow ?? ((name, region) => new DynamoPolicyWorkflowRepository(name, region)))(table, environment.AWS_REGION);
    const publication = (dependencies.createPublication ?? ((name, region) => new DynamoPolicyPublicationRepository(name, region)))(table, environment.AWS_REGION);
    const archive = (dependencies.createArchive ?? ((name, region) => new S3PolicyObjectStore(name, region)))(bucket, environment.AWS_REGION);
    const service = new PolicyPublicationService(records, workflow, publication, archive, dependencies.now);
    if (selected.action === "queue") return jsonResponse(200, await service.queue(context.awsRequestId,
      event.queryStringParameters?.cursor));
    if (selected.action === "detail") return jsonResponse(200, await service.detail(selected.draftId!, context.awsRequestId));
    const body = parseJsonObject(event);
    if (selected.action === "create") return jsonResponse(201, await service.createDraft(body, identity.profile.userId, context.awsRequestId));
    return jsonResponse(200, await service.transition(selected.draftId!, selected.action, body,
      identity.profile.userId, context.awsRequestId));
  });
}

export const handler = createPolicyPublicationHandler();
