import { createHash } from "node:crypto";
import { GetCommand, PutCommand, QueryCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { z } from "zod";
import { databaseError, databaseUnavailable, type CoreExecutor } from "../data/client";
import { identifier } from "../data/schemas";
import { leadSchema, type StoredLead } from "../data/schemas";
import { RequestError } from "../lib/http";

const iso = z.iso.datetime({ offset: true });
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const status = z.enum(["AVAILABLE", "PARTIAL", "UNAVAILABLE"]);
const proposalSchema = z.object({
  PK: z.string(), SK: z.string(), entityType: z.literal("BROKER_PROPOSAL"), schemaVersion: z.literal(1),
  proposalId: identifier, orgId: identifier, customerId: identifier, propertyId: identifier,
  analysisId: identifier, createdByUserId: identifier, createdAt: iso, updatedAt: iso,
  revision: z.literal(1), status, policyStatus: z.enum(["AVAILABLE", "UNAVAILABLE"]),
  documentStatus: z.literal("NOT_GENERATED"), policyVersionIds: z.array(z.string().max(180)).max(16),
  sourceLastCheckedAt: iso.nullable(), sourceHealthyAtSnapshot: z.boolean(),
  snapshotJson: z.string().min(2).max(300_000), snapshotSha256: sha256,
  expiresAtEpochSeconds: z.number().int().positive(),
  GSI3PK: z.literal("GOOGLE_ROOF_RETENTION").optional(), GSI3SK: z.number().int().positive().optional(),
}).strict().refine(value => value.PK === `CUSTOMER#${value.customerId}` && value.SK === `PROPOSAL#${value.proposalId}` &&
  value.updatedAt === value.createdAt && ((value.GSI3PK === undefined && value.GSI3SK === undefined) ||
    (value.GSI3PK === "GOOGLE_ROOF_RETENTION" && value.GSI3SK === value.expiresAtEpochSeconds)));
export type StoredProposal = z.infer<typeof proposalSchema>;
const leadStatus = z.enum(["NEW", "CONTACTED", "SITE_VISIT", "PROPOSAL", "INSTALLATION", "COMPLETED", "LOST"]);
const leadEventSchema = z.object({
  PK: z.string(), SK: z.string(), entityType: z.literal("BROKER_LEAD_EVENT"), schemaVersion: z.literal(1),
  orgId: identifier, leadId: identifier, revision: z.number().int().positive(),
  actorUserId: identifier, previousStatus: leadStatus, status: leadStatus, occurredAt: iso,
}).strict().refine(value => value.PK === `ORG#${value.orgId}` &&
  value.SK === `LEAD_EVENT#${value.leadId}#${String(value.revision).padStart(12, "0")}`);
export type StoredLeadEvent = z.infer<typeof leadEventSchema>;

export interface ProposalGuard {
  PK: string; SK: string; revision: number;
  conditionExpression?: string;
  names?: Record<string, string>;
  values?: Record<string, string | number>;
}
function checked<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw databaseUnavailable();
  return result.data;
}
function scopedCursor(cursor: string | undefined, scope: { kind: "proposals" | "designs"; id: string }) {
  if (cursor === undefined) return undefined;
  if (cursor.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw new RequestError(400, "INVALID_CURSOR", "Use a cursor from this listing.");
  try {
    const bytes = Buffer.from(cursor, "base64url");
    if (bytes.toString("base64url") !== cursor) throw new Error("Noncanonical cursor");
    const value = JSON.parse(bytes.toString("utf8")) as Record<string, unknown>;
    const key = value.key as Record<string, unknown> | undefined;
    const pk = scope.kind === "proposals" ? `CUSTOMER#${scope.id}` : `PROPERTY#${scope.id}`;
    const prefix = scope.kind === "proposals" ? "PROPOSAL#" : "DESIGN#";
    if (value.v !== 1 || value.kind !== scope.kind || value.id !== scope.id || !key ||
      Object.keys(key).length !== 2 || key.PK !== pk || typeof key.SK !== "string" ||
      !key.SK.startsWith(prefix) || !identifier.safeParse(key.SK.slice(prefix.length)).success) throw new Error("Wrong cursor scope");
    return { PK: pk, SK: key.SK };
  } catch { throw new RequestError(400, "INVALID_CURSOR", "Use a cursor from this listing."); }
}
function nextCursor(key: unknown, scope: { kind: "proposals" | "designs"; id: string }) {
  if (key === undefined) return undefined;
  const value = key as Record<string, unknown>;
  const pk = scope.kind === "proposals" ? `CUSTOMER#${scope.id}` : `PROPERTY#${scope.id}`;
  const prefix = scope.kind === "proposals" ? "PROPOSAL#" : "DESIGN#";
  if (!value || Object.keys(value).length !== 2 || value.PK !== pk || typeof value.SK !== "string" ||
    !value.SK.startsWith(prefix) || !identifier.safeParse(value.SK.slice(prefix.length)).success) throw databaseUnavailable();
  return Buffer.from(JSON.stringify({ v: 1, ...scope, key: { PK: value.PK, SK: value.SK } })).toString("base64url");
}

export class BrokerStore {
  constructor(private readonly tableName: string, private readonly execute: CoreExecutor) {}
  private async send(command: GetCommand | QueryCommand | PutCommand | TransactWriteCommand) {
    try { return await this.execute(command); } catch (error) { throw databaseError(error); }
  }
  static snapshotHash(json: string) { return createHash("sha256").update(json).digest("hex"); }

  async createProposal(record: StoredProposal, guards: ProposalGuard[]) {
    checked(proposalSchema, record);
    if (guards.length !== 6 || Buffer.byteLength(record.snapshotJson, "utf8") > 300_000 ||
      BrokerStore.snapshotHash(record.snapshotJson) !== record.snapshotSha256) throw databaseUnavailable();
    await this.send(new TransactWriteCommand({ TransactItems: [
      ...guards.map(guard => ({ ConditionCheck: { TableName: this.tableName,
        Key: { PK: guard.PK, SK: guard.SK }, ConditionExpression: guard.conditionExpression ?? "#revision = :revision",
        ExpressionAttributeNames: { "#revision": "revision", ...guard.names },
        ExpressionAttributeValues: { ":revision": guard.revision, ...guard.values } } })),
      { Put: { TableName: this.tableName, Item: record,
        ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)" } },
    ] }));
  }
  async getProposal(customerId: string, proposalId: string) {
    const { Item } = await this.send(new GetCommand({ TableName: this.tableName,
      Key: { PK: `CUSTOMER#${customerId}`, SK: `PROPOSAL#${proposalId}` }, ConsistentRead: true }));
    if (!Item) return undefined;
    const record = checked(proposalSchema, Item);
    if (record.customerId !== customerId || record.proposalId !== proposalId ||
      BrokerStore.snapshotHash(record.snapshotJson) !== record.snapshotSha256) throw databaseUnavailable();
    return record;
  }
  async listProposals(customerId: string, limit: number, cursor?: string) {
    const scope = { kind: "proposals" as const, id: customerId };
    const key = scopedCursor(cursor, scope);
    const { Items, LastEvaluatedKey } = await this.send(new QueryCommand({ TableName: this.tableName,
      KeyConditionExpression: "#pk = :pk AND begins_with(#sk, :prefix)",
      ExpressionAttributeNames: { "#pk": "PK", "#sk": "SK" },
      ExpressionAttributeValues: { ":pk": `CUSTOMER#${customerId}`, ":prefix": "PROPOSAL#" },
      Limit: limit, ConsistentRead: true, ScanIndexForward: false, ...(key ? { ExclusiveStartKey: key } : {}),
    }));
    if (Items !== undefined && !Array.isArray(Items)) throw databaseUnavailable();
    const items = (Items ?? []).map(item => checked(proposalSchema, item));
    if (items.some(item => item.customerId !== customerId || BrokerStore.snapshotHash(item.snapshotJson) !== item.snapshotSha256)) throw databaseUnavailable();
    const cursorOut = nextCursor(LastEvaluatedKey, scope);
    return { items, ...(cursorOut ? { nextCursor: cursorOut } : {}) };
  }
  async listDesigns(propertyId: string, limit: number, cursor?: string) {
    const scope = { kind: "designs" as const, id: propertyId };
    const key = scopedCursor(cursor, scope);
    const { Items, LastEvaluatedKey } = await this.send(new QueryCommand({ TableName: this.tableName,
      KeyConditionExpression: "#pk = :pk AND begins_with(#sk, :prefix)",
      ExpressionAttributeNames: { "#pk": "PK", "#sk": "SK" },
      ExpressionAttributeValues: { ":pk": `PROPERTY#${propertyId}`, ":prefix": "DESIGN#" },
      Limit: limit, ConsistentRead: true, ScanIndexForward: false, ...(key ? { ExclusiveStartKey: key } : {}),
    }));
    if (Items !== undefined && !Array.isArray(Items)) throw databaseUnavailable();
    const cursorOut = nextCursor(LastEvaluatedKey, scope);
    return { items: Items ?? [], ...(cursorOut ? { nextCursor: cursorOut } : {}) };
  }

  async updateLead(previous: StoredLead, next: StoredLead, event: StoredLeadEvent,
    scope: { actorUserId: string; userRevision: number; orgRevision: number }) {
    checked(leadSchema, previous); checked(leadSchema, next); checked(leadEventSchema, event);
    if (previous.orgId !== next.orgId || previous.leadId !== next.leadId ||
      next.revision !== previous.revision + 1 || event.revision !== next.revision ||
      event.orgId !== next.orgId || event.leadId !== next.leadId ||
      event.previousStatus !== previous.status || event.status !== next.status ||
      scope.actorUserId !== event.actorUserId) throw databaseUnavailable();
    await this.send(new TransactWriteCommand({ TransactItems: [
      { ConditionCheck: { TableName: this.tableName, Key: { PK: `USER#${scope.actorUserId}`, SK: "PROFILE" },
        ConditionExpression: "#revision = :revision AND #org = :org AND #role = :role",
        ExpressionAttributeNames: { "#revision": "revision", "#org": "orgId", "#role": "role" },
        ExpressionAttributeValues: { ":revision": scope.userRevision, ":org": next.orgId, ":role": "BROKER" } } },
      { ConditionCheck: { TableName: this.tableName, Key: { PK: `ORG#${next.orgId}`, SK: "PROFILE" },
        ConditionExpression: "#revision = :revision AND #kind = :kind AND contains(#members, :actor)",
        ExpressionAttributeNames: { "#revision": "revision", "#kind": "kind", "#members": "memberUserIds" },
        ExpressionAttributeValues: { ":revision": scope.orgRevision, ":kind": "BROKER", ":actor": scope.actorUserId } } },
      { Put: { TableName: this.tableName, Item: next,
        ConditionExpression: "#revision = :revision AND #status = :status AND #org = :org",
        ExpressionAttributeNames: { "#revision": "revision", "#status": "status", "#org": "orgId" },
        ExpressionAttributeValues: { ":revision": previous.revision, ":status": previous.status, ":org": previous.orgId } } },
      { Put: { TableName: this.tableName, Item: event,
        ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)" } },
    ] }));
  }
}
