import { notImplemented, parseJsonObject, withRequestLogging } from "../lib/http";

export const handler = withRequestLogging((event, context) => {
  parseJsonObject(event);
  return notImplemented("Roof analysis is not available yet; planned for Phase 4.", context.awsRequestId);
});
