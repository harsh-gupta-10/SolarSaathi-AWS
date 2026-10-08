import type { APIGatewayProxyEvent } from "aws-lambda";
import { createCognitoIdentityResolver, type CognitoIdentityResolver } from "../auth/cognito";
import { currentIdentityResponse } from "../auth/profile";
import { BenefitsService } from "../benefits/service";
import { documentExecutor } from "../data/client";
import { CoreRepository } from "../data/repository";
import { CoreService, type ServiceDependencies } from "../data/service";
import { FinancialsService } from "../financials/service";
import { PolicyFinancialsService } from "../financials/policy-service";
import { jsonResponse, parseJsonObject, RequestError, withRequestLogging } from "../lib/http";
import { DynamoPolicyPublicationRepository, type PolicyPublicationRepository } from "../policy/publication-storage";
import { DynamoPolicyRepository, type PolicyRepository } from "../policy/storage";
import { DynamoPolicyWorkflowRepository, type PolicyWorkflowRepository } from "../policy/workflow-storage";

const PATH = "/v1/financials/policy-backed/estimate";

export interface PolicyFinancialsHandlerDependencies extends ServiceDependencies {
  resolveIdentity?: CognitoIdentityResolver;
  createCore?: (tableName: string, region: string) => CoreRepository;
  createRecords?: (tableName: string, region: string) => PolicyRepository;
  createWorkflow?: (tableName: string, region: string) => PolicyWorkflowRepository;
  createPublication?: (tableName: string, region: string) => PolicyPublicationRepository;
}

export function createPolicyFinancialsHandler(dependencies: PolicyFinancialsHandlerDependencies = {}) {
  const resolveIdentity = dependencies.resolveIdentity ?? createCognitoIdentityResolver();
  return withRequestLogging(async (event: APIGatewayProxyEvent, context, environment) => {
    const stage = event.requestContext?.stage;
    const relative = stage && event.path.startsWith(`/${stage}/`) ? event.path.slice(stage.length + 1) : event.path;
    const path = relative.startsWith("/v1/") ? relative : `/v1${relative}`;
    const resource = event.resource.startsWith("/v1/") ? event.resource : `/v1${event.resource}`;
    if (path !== PATH && resource !== PATH) throw new RequestError(404, "NOT_FOUND", "The requested endpoint was not found.");
    if (event.httpMethod !== "POST") throw new RequestError(405, "METHOD_NOT_ALLOWED", "Use POST for this endpoint.");
    if (!environment.CORE_TABLE_NAME || !process.env.POLICY_TABLE_NAME) {
      throw new RequestError(503, "POLICY_FINANCIAL_STORAGE_NOT_CONFIGURED", "Policy-backed estimates are not configured.");
    }
    const body = parseJsonObject(event);
    const identity = currentIdentityResponse(await resolveIdentity(event, environment), context.awsRequestId);
    const core = new CoreService((dependencies.createCore ?? ((name, region) =>
      new CoreRepository(name, documentExecutor(region))))(environment.CORE_TABLE_NAME, environment.AWS_REGION), dependencies);
    const table = process.env.POLICY_TABLE_NAME;
    const records = (dependencies.createRecords ?? ((name, region) =>
      new DynamoPolicyRepository(name, region)))(table, environment.AWS_REGION);
    const workflow = (dependencies.createWorkflow ?? ((name, region) =>
      new DynamoPolicyWorkflowRepository(name, region)))(table, environment.AWS_REGION);
    const publication = (dependencies.createPublication ?? ((name, region) =>
      new DynamoPolicyPublicationRepository(name, region)))(table, environment.AWS_REGION);
    const financials = new FinancialsService(core);
    const benefits = new BenefitsService(core, records, workflow, publication, dependencies.now);
    return jsonResponse(200, await new PolicyFinancialsService(financials, benefits)
      .estimate(identity, body, context.awsRequestId));
  });
}

export const handler = createPolicyFinancialsHandler();
