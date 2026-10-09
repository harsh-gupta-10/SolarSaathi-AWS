import type { APIGatewayProxyEvent } from "aws-lambda";
import { createCognitoIdentityResolver, type CognitoIdentityResolver } from "../auth/cognito";
import { currentIdentityResponse } from "../auth/profile";
import { BenefitsService } from "../benefits/service";
import { BrokerService } from "../broker/service";
import { BrokerStore } from "../broker/store";
import { documentExecutor } from "../data/client";
import { CoreRepository } from "../data/repository";
import { CoreService, type ServiceDependencies } from "../data/service";
import { FinancialsService } from "../financials/service";
import { PolicyFinancialsService } from "../financials/policy-service";
import { jsonResponse, parseJsonObject, RequestError, withRequestLogging } from "../lib/http";
import { DynamoPolicyPublicationRepository } from "../policy/publication-storage";
import { DynamoPolicyRepository } from "../policy/storage";
import { DynamoPolicyWorkflowRepository } from "../policy/workflow-storage";

type Route = { kind: "PREVIEW" } | { kind: "SAVE" | "LIST" | "GET"; customerId: string; proposalId?: string } |
  { kind: "DESIGNS"; propertyId: string } | { kind: "LEAD_UPDATE"; leadId: string };
function route(event: APIGatewayProxyEvent): Route {
  const stage = event.requestContext?.stage;
  const relative = stage && event.path.startsWith(`/${stage}/`) ? event.path.slice(stage.length + 1) : event.path;
  const path = relative.startsWith("/v1/") ? relative : `/v1${relative}`;
  if (path === "/v1/broker/proposals/preview") {
    if (event.httpMethod !== "POST") throw new RequestError(405, "METHOD_NOT_ALLOWED", "Use POST for this endpoint.");
    return { kind: "PREVIEW" };
  }
  const proposal = /^\/v1\/broker\/customers\/([^/]+)\/proposals(?:\/([^/]+))?$/.exec(path);
  if (proposal) {
    const kind = proposal[2] ? "GET" : event.httpMethod === "POST" ? "SAVE" : "LIST";
    const method = kind === "SAVE" ? "POST" : "GET";
    if (event.httpMethod !== method) throw new RequestError(405, "METHOD_NOT_ALLOWED", `Use ${method} for this endpoint.`);
    return { kind, customerId: proposal[1]!, ...(proposal[2] ? { proposalId: proposal[2] } : {}) };
  }
  const designs = /^\/v1\/broker\/properties\/([^/]+)\/designs$/.exec(path);
  if (designs) {
    if (event.httpMethod !== "GET") throw new RequestError(405, "METHOD_NOT_ALLOWED", "Use GET for this endpoint.");
    return { kind: "DESIGNS", propertyId: designs[1]! };
  }
  const lead = /^\/v1\/broker\/leads\/([^/]+)$/.exec(path);
  if (lead) {
    if (event.httpMethod !== "PATCH") throw new RequestError(405, "METHOD_NOT_ALLOWED", "Use PATCH for this endpoint.");
    return { kind: "LEAD_UPDATE", leadId: lead[1]! };
  }
  throw new RequestError(404, "NOT_FOUND", "The requested endpoint was not found.");
}
function pageOptions(event: APIGatewayProxyEvent) {
  const values = event.queryStringParameters ?? {};
  const multiple = event.multiValueQueryStringParameters ?? {};
  if (Object.keys(values).some(name => !["cursor", "limit"].includes(name)) ||
    Object.entries(multiple).some(([name, list]) => !["cursor", "limit"].includes(name) ||
      !list || list.length !== 1 || list[0] !== values[name])) {
    throw new RequestError(400, "INVALID_REQUEST", "Only a single cursor and limit are supported.");
  }
  if (values.limit !== undefined && !/^[1-9][0-9]?$/.test(values.limit)) {
    throw new RequestError(400, "INVALID_REQUEST", "Provide a list limit between 1 and 50.");
  }
  return { ...(values.cursor === undefined ? {} : { cursor: values.cursor }),
    ...(values.limit === undefined ? {} : { limit: Number(values.limit) }) };
}

export interface BrokerHandlerDependencies extends ServiceDependencies {
  resolveIdentity?: CognitoIdentityResolver;
  createCore?: (tableName: string, region: string) => CoreRepository;
  createStore?: (tableName: string, region: string) => BrokerStore;
  createFinancials?: (core: CoreService, policyTableName: string, region: string) => PolicyFinancialsService;
}
export function createBrokerHandler(dependencies: BrokerHandlerDependencies = {}) {
  const resolve = dependencies.resolveIdentity ?? createCognitoIdentityResolver();
  const createCore = dependencies.createCore ?? ((name: string, region: string) => new CoreRepository(name, documentExecutor(region)));
  const createStore = dependencies.createStore ?? ((name: string, region: string) => new BrokerStore(name, documentExecutor(region)));
  const createFinancials = dependencies.createFinancials ?? ((core: CoreService, table: string, region: string) => {
    const records = new DynamoPolicyRepository(table, region);
    const workflow = new DynamoPolicyWorkflowRepository(table, region);
    const publication = new DynamoPolicyPublicationRepository(table, region);
    return new PolicyFinancialsService(new FinancialsService(core), new BenefitsService(core, records, workflow, publication, dependencies.now));
  });
  return withRequestLogging(async (event, context, environment) => {
    const target = route(event);
    if (!environment.CORE_TABLE_NAME || !process.env.POLICY_TABLE_NAME) {
      throw new RequestError(503, "BROKER_STORAGE_NOT_CONFIGURED", "The broker workspace is not configured.");
    }
    const identity = currentIdentityResponse(await resolve(event, environment), context.awsRequestId);
    const repository = createCore(environment.CORE_TABLE_NAME, environment.AWS_REGION);
    const core = new CoreService(repository, dependencies);
    const service = new BrokerService(core, repository, createStore(environment.CORE_TABLE_NAME, environment.AWS_REGION),
      createFinancials(core, process.env.POLICY_TABLE_NAME, environment.AWS_REGION), dependencies.now, dependencies.createId);
    if (target.kind === "PREVIEW") return jsonResponse(200, await service.preview(identity, parseJsonObject(event), context.awsRequestId));
    if (target.kind === "SAVE") return jsonResponse(201, await service.save(identity, target.customerId, parseJsonObject(event), context.awsRequestId));
    if (target.kind === "GET") return jsonResponse(200, await service.get(identity, target.customerId, target.proposalId!, context.awsRequestId));
    if (target.kind === "LIST") return jsonResponse(200, await service.list(identity, target.customerId, pageOptions(event), context.awsRequestId));
    if (target.kind === "DESIGNS") return jsonResponse(200, await service.listDesigns(identity, target.propertyId, pageOptions(event), context.awsRequestId));
    if (target.kind === "LEAD_UPDATE") return jsonResponse(200, await service.updateLead(identity, target.leadId, parseJsonObject(event), context.awsRequestId));
    throw new RequestError(404, "NOT_FOUND", "The requested endpoint was not found.");
  });
}
export const handler = createBrokerHandler();
