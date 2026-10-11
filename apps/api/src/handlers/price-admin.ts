import type { APIGatewayProxyEvent } from "aws-lambda";
import { createHash } from "node:crypto";
import { createCognitoIdentityResolver, type CognitoIdentityResolver } from "../auth/cognito";
import { currentIdentityResponse } from "../auth/profile";
import { parseInput } from "../data/schemas";
import { DynamoItemTable, type ItemTable } from "../lib/item-table";
import { jsonResponse, parseJsonObject, RequestError, withRequestLogging } from "../lib/http";
import { approveSchema, createCandidateSchema, listBenchmarksQuerySchema, priceBenchmarkSchema, rejectSchema } from "../pricing/schema";
import { PriceBenchmarkStore } from "../pricing/store";

type Route = { kind: "list" | "create" } | { kind: "detail" | "approve" | "reject"; id: string };

function route(event: APIGatewayProxyEvent): Route {
  const stage = event.requestContext?.stage;
  const relative = stage && event.path.startsWith(`/${stage}/`) ? event.path.slice(stage.length + 1) : event.path;
  const path = (relative.startsWith("/v1/") ? relative : `/v1${relative}`).replace(/\/$/, "");
  if (path === "/v1/admin/pricing/benchmarks") {
    if (event.httpMethod === "GET") return { kind: "list" };
    if (event.httpMethod === "POST") return { kind: "create" };
    throw new RequestError(405, "METHOD_NOT_ALLOWED", "Use GET or POST.");
  }
  const match = path.match(/^\/v1\/admin\/pricing\/benchmarks\/(PB-[A-Za-z0-9-]{4,64})(?:\/(approve|reject))?$/);
  if (!match) throw new RequestError(404, "NOT_FOUND", "The requested endpoint was not found.");
  const kind = (match[2] ?? "detail") as "detail" | "approve" | "reject";
  if (event.httpMethod !== (kind === "detail" ? "GET" : "POST")) throw new RequestError(405, "METHOD_NOT_ALLOWED", "Use the supported method.");
  return { kind, id: match[1]! };
}

export interface PriceAdminDependencies {
  resolveIdentity?: CognitoIdentityResolver;
  createItems?: (table: string, region: string) => ItemTable;
  now?: () => Date;
}

export function createPriceAdminHandler(dependencies: PriceAdminDependencies = {}) {
  const resolveIdentity = dependencies.resolveIdentity ?? createCognitoIdentityResolver();
  return withRequestLogging(async (event, context, environment) => {
    const selected = route(event);
    const user = await resolveIdentity(event, environment);
    const identity = currentIdentityResponse(user, context.awsRequestId);
    if (!identity.emailVerified || !user.groups.some(group => group === "ADMIN_POLICY" || group === "ADMIN")) {
      throw new RequestError(403, "POLICY_ADMIN_REQUIRED", "A verified policy administrator account is required.");
    }
    const table = environment.CORE_TABLE_NAME;
    if (!table) throw new RequestError(503, "DATABASE_NOT_CONFIGURED", "The core database is not configured.");
    const now = dependencies.now ?? (() => new Date());
    const store = new PriceBenchmarkStore((dependencies.createItems ?? ((name, region) => new DynamoItemTable(name, region)))(table, environment.AWS_REGION), now);
    const actor = identity.profile.userId;
    if (selected.kind === "list") {
      const query = parseInput(listBenchmarksQuerySchema, { ...(event.queryStringParameters ?? {}) });
      let startKey;
      if (query.cursor) {
        try {
          const parsed = JSON.parse(Buffer.from(query.cursor, "base64url").toString("utf8")) as { PK?: string; SK?: string };
          if (parsed.PK !== `PRICE_STATUS#${query.status}` || typeof parsed.SK !== "string") throw new Error("scope");
          startKey = { PK: parsed.PK, SK: parsed.SK };
        } catch { throw new RequestError(400, "INVALID_CURSOR", "Use a pagination cursor from this listing."); }
      }
      const page = await store.list(query.status, 25, startKey);
      return jsonResponse(200, { status: query.status, benchmarks: page.items,
        ...(page.lastKey ? { nextCursor: Buffer.from(JSON.stringify(page.lastKey)).toString("base64url") } : {}) });
    }
    if (selected.kind === "detail") {
      const found = await store.get(selected.id);
      if (!found) throw new RequestError(404, "BENCHMARK_NOT_FOUND", "The price benchmark was not found.");
      return jsonResponse(200, found);
    }
    const body = parseJsonObject(event, 8_192);
    if (selected.kind === "create") {
      const input = parseInput(createCandidateSchema, body);
      const idSource = JSON.stringify([input.scope, input.sizeBand, input.moduleClass, input.inverterType, input.rupeesPerKw, input.source.url, input.publishedOn]);
      const benchmark = parseInput(priceBenchmarkSchema, { schemaVersion: 1, benchmarkId: `PB-${createHash("sha256").update(idSource).digest("hex").slice(0, 24)}`,
        ...input, lastCheckedAt: now().toISOString(), status: "CANDIDATE" });
      const { stored, created } = await store.createCandidate(benchmark, { createdBy: actor });
      return jsonResponse(created ? 201 : 200, stored);
    }
    if (!("id" in selected)) throw new RequestError(404, "NOT_FOUND", "The requested endpoint was not found.");
    if (selected.kind === "approve") return jsonResponse(200, await store.approve(selected.id, actor, parseInput(approveSchema, body)));
    return jsonResponse(200, await store.reject(selected.id, actor, parseInput(rejectSchema, body).reason));
  });
}

export const handler = createPriceAdminHandler();
