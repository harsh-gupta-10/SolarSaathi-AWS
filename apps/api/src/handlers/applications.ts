import type { APIGatewayProxyEvent } from "aws-lambda";
import { createCognitoIdentityResolver, type CognitoIdentityResolver } from "../auth/cognito";
import { currentIdentityResponse } from "../auth/profile";
import { ApplicationService } from "../applications/service";
import { DynamoApplicationRepository, type ApplicationRepository } from "../applications/storage";
import { BenefitsService } from "../benefits/service";
import { documentExecutor } from "../data/client";
import { CoreRepository } from "../data/repository";
import { CoreService, type ServiceDependencies } from "../data/service";
import { jsonResponse, parseJsonObject, RequestError, withRequestLogging } from "../lib/http";
import { DynamoPolicyPublicationRepository, type PolicyPublicationRepository } from "../policy/publication-storage";
import { DynamoPolicyRepository, type PolicyRepository } from "../policy/storage";
import { DynamoPolicyWorkflowRepository, type PolicyWorkflowRepository } from "../policy/workflow-storage";

export interface ApplicationsHandlerDependencies extends ServiceDependencies {
  resolveIdentity?: CognitoIdentityResolver;
  createCore?: (tableName: string, region: string) => CoreRepository;
  createRecords?: (tableName: string, region: string) => PolicyRepository;
  createWorkflow?: (tableName: string, region: string) => PolicyWorkflowRepository;
  createPublication?: (tableName: string, region: string) => PolicyPublicationRepository;
  createApplications?: (coreTable: string, policyTable: string, region: string) => ApplicationRepository;
}

type Route = { kind: "collection" | "detail" | "step" | "details" | "documents" | "events" | "chat-update";
  applicationId?: string; stepId?: string };
function route(event: APIGatewayProxyEvent): Route {
  const stage = event.requestContext?.stage;
  const relative = stage && event.path.startsWith(`/${stage}/`) ? event.path.slice(stage.length + 1) : event.path;
  const path = relative.startsWith("/v1/") ? relative : `/v1${relative}`;
  if (path === "/v1/applications") return { kind: "collection" };
  const match = /^\/v1\/applications\/([^/]+)(?:\/(steps\/([^/]+)|details|documents|events|chat-update))?$/.exec(path);
  if (!match) throw new RequestError(404, "NOT_FOUND", "The requested endpoint was not found.");
  const suffix = match[2];
  return { kind: suffix?.startsWith("steps/") ? "step" : suffix === "details" ? "details" :
    suffix === "documents" ? "documents" : suffix === "events" ? "events" :
      suffix === "chat-update" ? "chat-update" : "detail",
  applicationId: match[1], ...(match[3] ? { stepId: match[3] } : {}) };
}

function query(event: APIGatewayProxyEvent, paged: boolean) {
  const values = event.queryStringParameters ?? {};
  const multiple = event.multiValueQueryStringParameters ?? {};
  const allowed = paged ? ["propertyId", "limit", "cursor"] : ["propertyId"];
  if (Object.keys(values).some(name => !allowed.includes(name)) ||
    Object.entries(multiple).some(([name, list]) => !allowed.includes(name) || !list || list.length !== 1 || list[0] !== values[name])) {
    throw new RequestError(400, "INVALID_REQUEST", "Use one supported value for each query parameter.");
  }
  if (!values.propertyId) throw new RequestError(400, "INVALID_REQUEST", "Provide a property ID.");
  if (values.limit !== undefined && !/^[1-9][0-9]?$/.test(values.limit)) {
    throw new RequestError(400, "INVALID_REQUEST", "Use a limit from 1 to 30.");
  }
  return { propertyId: values.propertyId, limit: values.limit ? Number(values.limit) : 20, cursor: values.cursor };
}

export function createApplicationsHandler(dependencies: ApplicationsHandlerDependencies = {}) {
  const resolveIdentity = dependencies.resolveIdentity ?? createCognitoIdentityResolver();
  return withRequestLogging(async (event, context, environment) => {
    const selected = route(event);
    const allowed = selected.kind === "collection" ? ["GET", "POST"] :
      selected.kind === "detail" || selected.kind === "events" ? ["GET"] : ["POST"];
    if (!allowed.includes(event.httpMethod)) throw new RequestError(405, "METHOD_NOT_ALLOWED", "Use a supported method for this endpoint.");
    if (!environment.CORE_TABLE_NAME || !process.env.POLICY_TABLE_NAME) {
      throw new RequestError(503, "APPLICATION_STORAGE_NOT_CONFIGURED", "Application tracking is not configured.");
    }
    const identity = currentIdentityResponse(await resolveIdentity(event, environment), context.awsRequestId);
    const core = new CoreService((dependencies.createCore ?? ((name, region) =>
      new CoreRepository(name, documentExecutor(region))))(environment.CORE_TABLE_NAME, environment.AWS_REGION), dependencies);
    const policyTable = process.env.POLICY_TABLE_NAME;
    const records = (dependencies.createRecords ?? ((name, region) =>
      new DynamoPolicyRepository(name, region)))(policyTable, environment.AWS_REGION);
    const workflow = (dependencies.createWorkflow ?? ((name, region) =>
      new DynamoPolicyWorkflowRepository(name, region)))(policyTable, environment.AWS_REGION);
    const publication = (dependencies.createPublication ?? ((name, region) =>
      new DynamoPolicyPublicationRepository(name, region)))(policyTable, environment.AWS_REGION);
    const makeApplications = dependencies.createApplications ?? ((coreTable, policyName, region) =>
      new DynamoApplicationRepository(coreTable, policyName, region));
    const repository = makeApplications(environment.CORE_TABLE_NAME, policyTable, environment.AWS_REGION);
    const service = new ApplicationService(core, new BenefitsService(core, records, workflow, publication, dependencies.now),
      publication, repository, dependencies.now, dependencies.createId);
    const common = { schemaVersion: 1 as const, source: "DYNAMODB_APPLICATION_TRACKER_V1" as const,
      requestId: context.awsRequestId };
    if (selected.kind === "collection") {
      if (event.httpMethod === "POST") return jsonResponse(201, { ...common, application: await service.create(identity, parseJsonObject(event)) });
      const options = query(event, true);
      return jsonResponse(200, { ...common, ...await service.list(identity, options.propertyId, options.limit, options.cursor) });
    }
    const applicationId = selected.applicationId!;
    if (selected.kind === "detail") {
      const options = query(event, false);
      return jsonResponse(200, { ...common, application: await service.get(identity, options.propertyId, applicationId) });
    }
    if (selected.kind === "events") {
      const options = query(event, true);
      return jsonResponse(200, { ...common, ...await service.events(identity, options.propertyId, applicationId, options.limit, options.cursor) });
    }
    const body = parseJsonObject(event);
    if (selected.kind === "chat-update") {
      return jsonResponse(200, { ...common, ...await service.chatUpdate(identity, applicationId, body) });
    }
    const application = selected.kind === "step" ? await service.transition(identity, applicationId, selected.stepId!, body) :
      selected.kind === "details" ? await service.updateDetails(identity, applicationId, body) :
        await service.addDocument(identity, applicationId, body);
    return jsonResponse(200, { ...common, application });
  });
}

export const handler = createApplicationsHandler();
