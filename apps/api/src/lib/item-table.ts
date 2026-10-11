import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  BatchWriteCommand, DeleteCommand, DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { databaseError } from "../data/client";

/**
 * Narrow, domain-shaped access to the core table for chat, proposals, idempotency and price benchmarks.
 * Every conditional operation is an explicit method so tests can use an exact in-memory model and so no caller can
 * issue an arbitrary expression. All items carry PK/SK and may carry `expiresAtEpochSeconds` (the table TTL).
 */
export interface ItemKey { PK: string; SK: string }
export type Item = ItemKey & Record<string, unknown>;
export interface ItemPage { items: Item[]; lastKey?: ItemKey }
export interface QueryPrefixInput { pk: string; skPrefix: string; limit: number; startKey?: ItemKey; descending?: boolean }

export interface ItemTable {
  get(key: ItemKey): Promise<Item | undefined>;
  /** Returns false when `ifAbsent` was requested and the item already existed. */
  put(item: Item, options?: { ifAbsent?: boolean }): Promise<boolean>;
  /** Applies `set` only when every attribute in `ifEquals` currently has the stated value. */
  updateIf(key: ItemKey, set: Record<string, unknown>, ifEquals: Record<string, unknown>): Promise<boolean>;
  delete(key: ItemKey): Promise<void>;
  deleteMany(keys: readonly ItemKey[]): Promise<void>;
  queryPrefix(input: QueryPrefixInput): Promise<ItemPage>;
  /** Atomic counter. With `max`, the add is refused (ok=false) if it would push the counter above `max`. */
  increment(key: ItemKey, input: { field: string; by: number; max?: number; expiresAtEpochSeconds: number }):
  Promise<{ ok: boolean; value: number }>;
}

const SAFE_FIELD = /^[A-Za-z][A-Za-z0-9]{0,63}$/;

export class DynamoItemTable implements ItemTable {
  private readonly client: DynamoDBDocumentClient;
  constructor(private readonly tableName: string, region: string, client?: DynamoDBDocumentClient) {
    this.client = client ?? DynamoDBDocumentClient.from(new DynamoDBClient({ region, maxAttempts: 2,
      requestHandler: { connectionTimeout: 1_000, requestTimeout: 3_000 } }),
    { marshallOptions: { removeUndefinedValues: true } });
  }
  private options() { return { abortSignal: AbortSignal.timeout(5_000) }; }
  private conditional(error: unknown) { return error instanceof Error && error.name === "ConditionalCheckFailedException"; }

  async get(key: ItemKey) {
    try {
      const result = await this.client.send(new GetCommand({ TableName: this.tableName, Key: key, ConsistentRead: true }), this.options());
      return result.Item as Item | undefined;
    } catch (error) { throw databaseError(error); }
  }

  async put(item: Item, options: { ifAbsent?: boolean } = {}) {
    try {
      await this.client.send(new PutCommand({ TableName: this.tableName, Item: item,
        ...(options.ifAbsent ? { ConditionExpression: "attribute_not_exists(PK)" } : {}) }), this.options());
      return true;
    } catch (error) {
      if (options.ifAbsent && this.conditional(error)) return false;
      throw databaseError(error);
    }
  }

  async updateIf(key: ItemKey, set: Record<string, unknown>, ifEquals: Record<string, unknown>) {
    const names: Record<string, string> = {};
    const values: Record<string, unknown> = {};
    const assignments = Object.entries(set).map(([field, value], index) => {
      if (!SAFE_FIELD.test(field)) throw new RangeError("Unsafe attribute name.");
      names[`#s${index}`] = field; values[`:s${index}`] = value;
      return `#s${index} = :s${index}`;
    });
    const conditions = ["attribute_exists(PK)", ...Object.entries(ifEquals).map(([field, value], index) => {
      if (!SAFE_FIELD.test(field)) throw new RangeError("Unsafe attribute name.");
      names[`#c${index}`] = field; values[`:c${index}`] = value;
      return `#c${index} = :c${index}`;
    })];
    try {
      await this.client.send(new UpdateCommand({ TableName: this.tableName, Key: key,
        UpdateExpression: `SET ${assignments.join(", ")}`, ConditionExpression: conditions.join(" AND "),
        ExpressionAttributeNames: names, ExpressionAttributeValues: values }), this.options());
      return true;
    } catch (error) {
      if (this.conditional(error)) return false;
      throw databaseError(error);
    }
  }

  async delete(key: ItemKey) {
    try { await this.client.send(new DeleteCommand({ TableName: this.tableName, Key: key }), this.options()); }
    catch (error) { throw databaseError(error); }
  }

  async deleteMany(keys: readonly ItemKey[]) {
    try {
      for (let offset = 0; offset < keys.length; offset += 25) {
        let pending: Array<{ DeleteRequest: { Key: ItemKey } }> = keys.slice(offset, offset + 25)
          .map(Key => ({ DeleteRequest: { Key } }));
        for (let attempt = 0; pending.length && attempt < 5; attempt++) {
          const result = await this.client.send(new BatchWriteCommand({ RequestItems: { [this.tableName]: pending } }), this.options());
          pending = (result.UnprocessedItems?.[this.tableName] ?? []) as typeof pending;
        }
        if (pending.length) throw new Error("UNPROCESSED_DELETES");
      }
    } catch (error) { throw databaseError(error); }
  }

  async queryPrefix(input: QueryPrefixInput): Promise<ItemPage> {
    try {
      const result = await this.client.send(new QueryCommand({ TableName: this.tableName,
        KeyConditionExpression: input.skPrefix ? "PK = :pk AND begins_with(SK, :prefix)" : "PK = :pk",
        ExpressionAttributeValues: { ":pk": input.pk, ...(input.skPrefix ? { ":prefix": input.skPrefix } : {}) },
        Limit: input.limit, ScanIndexForward: !input.descending, ConsistentRead: true,
        ExclusiveStartKey: input.startKey }), this.options());
      return { items: (result.Items ?? []) as Item[], lastKey: result.LastEvaluatedKey as ItemKey | undefined };
    } catch (error) { throw databaseError(error); }
  }

  async increment(key: ItemKey, input: { field: string; by: number; max?: number; expiresAtEpochSeconds: number }) {
    if (!SAFE_FIELD.test(input.field)) throw new RangeError("Unsafe attribute name.");
    try {
      const result = await this.client.send(new UpdateCommand({ TableName: this.tableName, Key: key,
        UpdateExpression: "ADD #f :by SET expiresAtEpochSeconds = :ttl",
        ...(input.max === undefined ? {} : { ConditionExpression: "attribute_not_exists(#f) OR #f <= :limit" }),
        ExpressionAttributeNames: { "#f": input.field },
        ExpressionAttributeValues: { ":by": input.by, ":ttl": input.expiresAtEpochSeconds,
          ...(input.max === undefined ? {} : { ":limit": input.max - input.by }) },
        ReturnValues: "UPDATED_NEW" }), this.options());
      return { ok: true, value: Number(result.Attributes?.[input.field] ?? input.by) };
    } catch (error) {
      if (this.conditional(error)) return { ok: false, value: input.max ?? 0 };
      throw databaseError(error);
    }
  }
}
