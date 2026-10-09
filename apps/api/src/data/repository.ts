import { GetCommand, PutCommand, QueryCommand, TransactWriteCommand, type TransactWriteCommandInput } from "@aws-sdk/lib-dynamodb";
import type { z } from "zod";
import { RequestError } from "../lib/http";
import { databaseError, databaseUnavailable, type CoreExecutor } from "./client";
import { decodeCursor, encodeCursor, type ListScope } from "./cursor";
import { keys, type EntityKey } from "./keys";
import {
  analysisSchema, buildingConfirmationSchema, cacheSchema, customerSchema, entitySchema, leadSchema, locatorSchema,
  roofPreviewSchema,
  organizationSchema, parseStored, propertySchema, userSchema,
  type StoredEntity, type StoredOrganization,
} from "./schemas";

export interface RecordGuard { key: EntityKey; revision: number }
export interface StoredPage<T> { items: T[]; nextCursor?: string }

export class CoreRepository {
  constructor(private readonly tableName: string, private readonly execute: CoreExecutor) {
    if (!tableName?.trim()) throw new RequestError(503, "DATABASE_NOT_CONFIGURED", "The core database is not configured.");
  }

  private async send(command: Parameters<CoreExecutor>[0]) {
    try {
      const result = await this.execute(command);
      if (!result || typeof result !== "object") throw databaseUnavailable();
      return result;
    } catch (error) { throw databaseError(error); }
  }

  private async get<T>(key: EntityKey, schema: z.ZodType<T>): Promise<T | undefined> {
    const { Item } = await this.send(new GetCommand({ TableName: this.tableName, Key: key, ConsistentRead: true }));
    if (Item === undefined) return undefined;
    const record = parseStored(schema, Item);
    const storedKey = parseStored(entitySchema, record);
    if (storedKey.PK !== key.PK || storedKey.SK !== key.SK) throw databaseUnavailable();
    return record;
  }

  getUser(userId: string) { return this.get(keys.user(userId), userSchema); }
  getOrganization(orgId: string) { return this.get(keys.organization(orgId), organizationSchema); }
  getCustomer(orgId: string, customerId: string) { return this.get(keys.customer(orgId, customerId), customerSchema); }
  getLead(orgId: string, leadId: string) { return this.get(keys.lead(orgId, leadId), leadSchema); }
  getLocator(propertyId: string) { return this.get(keys.locator(propertyId), locatorSchema); }
  getProperty(customerId: string, propertyId: string) { return this.get(keys.property(customerId, propertyId), propertySchema); }
  getAnalysis(propertyId: string, analysisId: string) { return this.get(keys.analysis(propertyId, analysisId), analysisSchema); }
  getRoofPreview(propertyId: string, previewId: string) { return this.get(keys.roofPreview(propertyId, previewId), roofPreviewSchema); }
  getBuildingConfirmation(propertyId: string, previewId: string) { return this.get(keys.buildingConfirmation(propertyId, previewId), buildingConfirmationSchema); }
  getCache(propertyId: string, cacheKey: string, version: number) {
    return this.get(keys.cache(propertyId, cacheKey, version), cacheSchema);
  }

  async putImmutable(record: StoredEntity): Promise<void> {
    const item = parseStored(entitySchema, record);
    await this.send(new PutCommand({
      TableName: this.tableName, Item: item,
      ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)",
    }));
  }

  async transactCreate(records: StoredEntity[], guards: RecordGuard[] = []): Promise<void> {
    if (records.length === 0 || records.length + guards.length > 25) throw databaseUnavailable();
    const items: NonNullable<TransactWriteCommandInput["TransactItems"]> = [
      ...guards.map(guard => ({ ConditionCheck: {
        TableName: this.tableName, Key: guard.key, ConditionExpression: "#revision = :revision",
        ExpressionAttributeNames: { "#revision": "revision" }, ExpressionAttributeValues: { ":revision": guard.revision },
      } })),
      ...records.map(record => ({ Put: {
        TableName: this.tableName, Item: parseStored(entitySchema, record),
        ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)",
      } })),
    ];
    await this.send(new TransactWriteCommand({ TransactItems: items }));
  }

  organizationGuard(organization: StoredOrganization): RecordGuard {
    return { key: keys.organization(organization.orgId), revision: organization.revision };
  }

  private async list<T>(scope: ListScope, schema: z.ZodType<T>, limit: number, cursor?: string): Promise<StoredPage<T>> {
    const key = decodeCursor(cursor, scope);
    const index = scope.kind === "owner-properties" ? "GSI1" : scope.kind === "org-properties" ? "GSI2" : undefined;
    if (key && index) {
      // A forged index cursor cannot smuggle an unrelated customer's base-table key.
      const record = await this.getProperty(key.PK.slice(9), key.SK.slice(9));
      if (!record || record.orgId !== scope.orgId || (index === "GSI1" && record.ownerUserId !== scope.actorUserId)) {
        throw new RequestError(400, "INVALID_CURSOR", "Use a pagination cursor from this account and listing.");
      }
    }
    const prefix = index ? "PROPERTY#" : scope.kind === "customers" ? "CUSTOMER#" : "LEAD#";
    const { Items, LastEvaluatedKey } = await this.send(new QueryCommand({
      TableName: this.tableName, ...(index ? { IndexName: index } : { ConsistentRead: true }),
      KeyConditionExpression: "#pk = :pk AND begins_with(#sk, :prefix)",
      ExpressionAttributeNames: { "#pk": index ? `${index}PK` : "PK", "#sk": index ? `${index}SK` : "SK" },
      ExpressionAttributeValues: { ":pk": scope.kind === "owner-properties" ? `USER#${scope.actorUserId}` : `ORG#${scope.orgId}`, ":prefix": prefix },
      Limit: limit, ...(key ? { ExclusiveStartKey: key } : {}),
    }));
    if (Items !== undefined && !Array.isArray(Items)) throw databaseUnavailable();
    const items = (Items ?? []).map(item => parseStored(schema, item));
    for (const item of items) {
      const record = parseStored(entitySchema, item);
      if (!("orgId" in record) || record.orgId !== scope.orgId ||
        (scope.kind === "owner-properties" && (!("ownerUserId" in record) || record.ownerUserId !== scope.actorUserId))) throw databaseUnavailable();
    }
    let nextCursor: string | undefined;
    try { nextCursor = encodeCursor(LastEvaluatedKey, scope); } catch { throw databaseUnavailable(); }
    return { items, ...(nextCursor ? { nextCursor } : {}) };
  }

  listCustomers(scope: ListScope, limit: number, cursor?: string) { return this.list(scope, customerSchema, limit, cursor); }
  listLeads(scope: ListScope, limit: number, cursor?: string) { return this.list(scope, leadSchema, limit, cursor); }
  listProperties(scope: ListScope, limit: number, cursor?: string) { return this.list(scope, propertySchema, limit, cursor); }

  async listAnalyses(propertyId: string, limit: number, cursor?: string) {
    let key: EntityKey | undefined;
    if (cursor !== undefined) {
      if (cursor.length > 1_024 || !/^[A-Za-z0-9_-]+$/.test(cursor)) {
        throw new RequestError(400, "INVALID_CURSOR", "Use a cursor from this property listing.");
      }
      try {
        const decoded = Buffer.from(cursor, "base64url");
        if (decoded.toString("base64url") !== cursor) throw new Error("Noncanonical cursor");
        const envelope = JSON.parse(decoded.toString("utf8")) as Record<string, unknown>;
        const value = envelope.key as Record<string, unknown> | undefined;
        if (envelope.v !== 1 || envelope.propertyId !== propertyId || !value || Object.keys(value).length !== 2 ||
          value.PK !== `PROPERTY#${propertyId}` || typeof value.SK !== "string" ||
          !/^ANALYSIS#[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value.SK)) throw new Error("Wrong scope");
        key = { PK: value.PK, SK: value.SK } as EntityKey;
      } catch { throw new RequestError(400, "INVALID_CURSOR", "Use a cursor from this property listing."); }
    }
    const { Items, LastEvaluatedKey } = await this.send(new QueryCommand({ TableName: this.tableName,
      KeyConditionExpression: "#pk = :pk AND begins_with(#sk, :prefix)",
      ExpressionAttributeNames: { "#pk": "PK", "#sk": "SK" },
      ExpressionAttributeValues: { ":pk": `PROPERTY#${propertyId}`, ":prefix": "ANALYSIS#" },
      Limit: limit, ConsistentRead: true, ...(key ? { ExclusiveStartKey: key } : {}),
    }));
    if (Items !== undefined && !Array.isArray(Items)) throw databaseUnavailable();
    const items = (Items ?? []).map(item => parseStored(analysisSchema, item));
    if (items.some(item => item.propertyId !== propertyId)) throw databaseUnavailable();
    let nextCursor: string | undefined;
    if (LastEvaluatedKey !== undefined) {
      const value = LastEvaluatedKey as Record<string, unknown>;
      if (value.PK !== `PROPERTY#${propertyId}` || typeof value.SK !== "string" ||
        !/^ANALYSIS#[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value.SK)) throw databaseUnavailable();
      nextCursor = Buffer.from(JSON.stringify({ v: 1, propertyId, key: { PK: value.PK, SK: value.SK } })).toString("base64url");
    }
    return { items, ...(nextCursor ? { nextCursor } : {}) };
  }
}
