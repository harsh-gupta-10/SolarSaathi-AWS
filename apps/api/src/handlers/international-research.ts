import type { APIGatewayProxyEvent } from "aws-lambda";
import { createCognitoIdentityResolver, type CognitoIdentityResolver } from "../auth/cognito";
import { currentIdentityResponse } from "../auth/profile";
import { documentExecutor } from "../data/client";
import { ResearchCache } from "../international/cache";
import { researchInputSchema } from "../international/schema";
import { AmazonCountryLocator, InternationalResearchService, type CountryLocator } from "../international/service";
import { BraveOfficialDiscovery, type Discovery } from "../international/search";
import { jsonResponse, parseJsonObject, RequestError, withRequestLogging } from "../lib/http";

export interface InternationalResearchDependencies {
  resolveIdentity?: CognitoIdentityResolver;
  locator?: CountryLocator;
  discovery?: Discovery;
  cache?: ResearchCache;
  now?: () => Date;
}

function correctRoute(event: APIGatewayProxyEvent) {
  const path = event.resource.startsWith("/v1/") ? event.resource : `/v1${event.resource}`;
  if (path !== "/v1/policies/research") throw new RequestError(404, "NOT_FOUND", "The requested endpoint was not found.");
  if (event.httpMethod !== "POST") throw new RequestError(405, "METHOD_NOT_ALLOWED", "Use POST for research.");
}

export function createInternationalResearchHandler(dependencies: InternationalResearchDependencies = {}) {
  const resolveIdentity = dependencies.resolveIdentity ?? createCognitoIdentityResolver();
  return withRequestLogging(async (event, context, environment) => {
    correctRoute(event);
    const user = await resolveIdentity(event, environment);
    const identity = currentIdentityResponse(user, context.awsRequestId);
    if (!identity.emailVerified) throw new RequestError(403, "VERIFIED_ACCOUNT_REQUIRED", "Verify your email before researching policies.");
    const parsed = researchInputSchema.safeParse(parseJsonObject(event, 2_048));
    if (!parsed.success) throw new RequestError(400, "INVALID_REQUEST", "Select a country or share a valid location and optional jurisdiction context.");
    const tableName = process.env.CORE_TABLE_NAME;
    if (!tableName || !/^[A-Za-z0-9_.-]{3,255}$/.test(tableName)) {
      throw new RequestError(503, "DATABASE_NOT_CONFIGURED", "The research cache is not configured.");
    }
    const service = new InternationalResearchService(
      dependencies.locator ?? new AmazonCountryLocator(environment.AWS_REGION),
      dependencies.discovery ?? new BraveOfficialDiscovery(process.env.BRAVE_SEARCH_API_KEY),
      dependencies.cache ?? new ResearchCache(tableName, documentExecutor(environment.AWS_REGION)),
      dependencies.now,
    );
    return jsonResponse(200, await service.research(parsed.data, context.awsRequestId));
  });
}

export const handler = createInternationalResearchHandler();
