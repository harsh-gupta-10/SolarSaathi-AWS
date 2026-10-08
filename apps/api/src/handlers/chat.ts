import { notImplemented, parseJsonObject, withRequestLogging } from "../lib/http";

export const handler = withRequestLogging((event, context) => {
  parseJsonObject(event);
  return notImplemented("The grounded solar advisor is not available yet; planned for Phase 13.", context.awsRequestId);
});
