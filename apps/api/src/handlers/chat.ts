import type { APIGatewayProxyEvent } from "aws-lambda";
import { createCognitoIdentityResolver, type CognitoIdentityResolver } from "../auth/cognito";
import { currentIdentityResponse } from "../auth/profile";
import { AdvisorService } from "../advisor/service";
import { BedrockFactSelector, type FactSelector } from "../advisor/bedrock";
import { ApplicationService } from "../applications/service";
import { DynamoApplicationRepository, type ApplicationRepository } from "../applications/storage";
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

export interface AdvisorHandlerDependencies extends ServiceDependencies {
  resolveIdentity?: CognitoIdentityResolver;
  createCore?: (tableName: string, region: string) => CoreRepository;
  createRecords?: (tableName: string, region: string) => PolicyRepository;
  createWorkflow?: (tableName: string, region: string) => PolicyWorkflowRepository;
  createPublication?: (tableName: string, region: string) => PolicyPublicationRepository;
  createApplications?: (coreTable: string, policyTable: string, region: string) => ApplicationRepository;
  selector?: FactSelector;
}

function route(event: APIGatewayProxyEvent) {
  const stage = event.requestContext?.stage;
  const relative = stage && event.path.startsWith(`/${stage}/`) ? event.path.slice(stage.length + 1) : event.path;
  const path = relative.startsWith("/v1/") ? relative : `/v1${relative}`;
  if (path !== "/v1/advisor/solar" && path !== "/v1/chat") {
    throw new RequestError(404, "NOT_FOUND", "The requested endpoint was not found.");
  }
  if (event.httpMethod !== "POST") throw new RequestError(405, "METHOD_NOT_ALLOWED", "Use POST for this endpoint.");
}

export function createAdvisorHandler(dependencies: AdvisorHandlerDependencies = {}) {
  const resolveIdentity = dependencies.resolveIdentity ?? createCognitoIdentityResolver();
  const selectors = new Map<string, FactSelector>();
  return withRequestLogging(async (event, context, environment) => {
    route(event);
    if (!environment.CORE_TABLE_NAME || !process.env.POLICY_TABLE_NAME) {
      throw new RequestError(503, "ADVISOR_STORAGE_NOT_CONFIGURED", "Grounded advisor storage is not configured.");
    }
    const body = parseJsonObject(event);
    const identity = currentIdentityResponse(await resolveIdentity(event, environment), context.awsRequestId);
    const core = new CoreService((dependencies.createCore ?? ((name, region) =>
      new CoreRepository(name, documentExecutor(region))))(environment.CORE_TABLE_NAME, environment.AWS_REGION), dependencies);
    const policyTable = process.env.POLICY_TABLE_NAME;
    const makeRecords = dependencies.createRecords ?? ((name, region) => new DynamoPolicyRepository(name, region));
    const makeWorkflow = dependencies.createWorkflow ?? ((name, region) => new DynamoPolicyWorkflowRepository(name, region));
    const makePublication = dependencies.createPublication ?? ((name, region) => new DynamoPolicyPublicationRepository(name, region));
    const records = makeRecords(policyTable, environment.AWS_REGION);
    const workflow = makeWorkflow(policyTable, environment.AWS_REGION);
    const publication = makePublication(policyTable, environment.AWS_REGION);
    const makeApplications = dependencies.createApplications ?? ((coreTable, policyName, region) =>
      new DynamoApplicationRepository(coreTable, policyName, region));
    const applications = makeApplications(environment.CORE_TABLE_NAME, policyTable, environment.AWS_REGION);
    const benefits = new BenefitsService(core, records, workflow, publication, dependencies.now);
    const baseFinancials = new FinancialsService(core);
    const policyFinancials = new PolicyFinancialsService(baseFinancials, benefits);
    const appService = new ApplicationService(core, benefits, publication, applications, dependencies.now, dependencies.createId);
    let selector = dependencies.selector;
    if (!selector && environment.BEDROCK_MODEL_ID) {
      const region = environment.BEDROCK_REGION ?? environment.AWS_REGION;
      const key = `${region}\0${environment.BEDROCK_MODEL_ID}`;
      selector = selectors.get(key);
      if (!selector) {
        selector = new BedrockFactSelector(environment.BEDROCK_MODEL_ID, region);
        if (selectors.size >= 2) selectors.delete(selectors.keys().next().value!);
        selectors.set(key, selector);
      }
    }
    return jsonResponse(200, await new AdvisorService(core, policyFinancials, baseFinancials, appService, selector)
      .answer(identity, body, context.awsRequestId));
  });
}

export const handler = createAdvisorHandler();
