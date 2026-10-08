import { createCognitoIdentityResolver, type CognitoIdentityResolver } from "../auth/cognito";
import { currentIdentityResponse } from "../auth/profile";
import { jsonResponse, RequestError, withRequestLogging } from "../lib/http";

export function createProfileHandler(resolveIdentity: CognitoIdentityResolver = createCognitoIdentityResolver()) {
  return withRequestLogging(async (event, context, environment) => {
    if (event.httpMethod !== "GET") {
      throw new RequestError(405, "METHOD_NOT_ALLOWED", "Use GET /v1/me for current identity.");
    }
    const identity = await resolveIdentity(event, environment);
    return jsonResponse(200, currentIdentityResponse(identity, context.awsRequestId));
  });
}

export const handler = createProfileHandler();
