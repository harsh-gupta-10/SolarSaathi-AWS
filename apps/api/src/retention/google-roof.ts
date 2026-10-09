import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DeleteCommand, DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";

export const RETENTION_INDEX = "GSI3";
export const RETENTION_PARTITION = "GOOGLE_ROOF_RETENTION";
export const RETENTION_PAGE_SIZE = 100;
export const RETENTION_MAX_PAGES = 5;
const DELETE_CONCURRENCY = 10;

export type RetentionCommand = QueryCommand | DeleteCommand;
export type RetentionResult = { Items?: unknown[]; LastEvaluatedKey?: Record<string, unknown> };
export type RetentionExecutor = (command: RetentionCommand) => Promise<RetentionResult>;

export function createRetentionExecutor(region: string): RetentionExecutor {
  const client = DynamoDBDocumentClient.from(new DynamoDBClient({
    region, maxAttempts: 2, requestHandler: { connectionTimeout: 1_000, requestTimeout: 2_000 },
  }), { marshallOptions: { removeUndefinedValues: true } });
  return async command => {
    const options = { abortSignal: AbortSignal.timeout(5_000) };
    if (command instanceof QueryCommand) return client.send(command, options);
    await client.send(command, options);
    return {};
  };
}

function expiredKey(value: unknown, cutoff: number) {
  if (!value || typeof value !== "object") throw new Error("Invalid retention index entry");
  const item = value as Record<string, unknown>;
  if (typeof item.PK !== "string" || typeof item.SK !== "string" ||
    item.GSI3PK !== RETENTION_PARTITION || typeof item.GSI3SK !== "number" ||
    !Number.isSafeInteger(item.GSI3SK) || item.GSI3SK < 1 || item.GSI3SK > cutoff) {
    throw new Error("Invalid retention index entry");
  }
  return { PK: item.PK, SK: item.SK, expiresAtEpochSeconds: item.GSI3SK };
}

function alreadyRemoved(error: unknown): boolean {
  return error instanceof Error && error.name === "ConditionalCheckFailedException";
}

export interface RetentionSweepResult {
  pages: number;
  examined: number;
  deleted: number;
  alreadyRemoved: number;
  backlog: boolean;
}

export async function purgeExpiredGoogleRoofs(tableName: string, execute: RetentionExecutor,
  cutoffEpochSeconds: number): Promise<RetentionSweepResult> {
  if (!tableName || !Number.isSafeInteger(cutoffEpochSeconds) || cutoffEpochSeconds < 1) {
    throw new Error("Retention cleanup is not configured");
  }
  let cursor: Record<string, unknown> | undefined;
  let pages = 0, examined = 0, deleted = 0, removed = 0;
  do {
    const result = await execute(new QueryCommand({
      TableName: tableName, IndexName: RETENTION_INDEX,
      KeyConditionExpression: "#retention = :retention AND #expiry <= :cutoff",
      ProjectionExpression: "#pk,#sk,#retention,#expiry",
      ExpressionAttributeNames: { "#pk": "PK", "#sk": "SK", "#retention": "GSI3PK", "#expiry": "GSI3SK" },
      ExpressionAttributeValues: { ":retention": RETENTION_PARTITION, ":cutoff": cutoffEpochSeconds },
      Limit: RETENTION_PAGE_SIZE, ScanIndexForward: true,
      ...(cursor ? { ExclusiveStartKey: cursor } : {}),
    }));
    pages++;
    if (result.Items !== undefined && !Array.isArray(result.Items)) throw new Error("Invalid retention index response");
    const keys = (result.Items ?? []).map(item => expiredKey(item, cutoffEpochSeconds));
    examined += keys.length;
    for (let offset = 0; offset < keys.length; offset += DELETE_CONCURRENCY) {
      const batch = keys.slice(offset, offset + DELETE_CONCURRENCY);
      const outcomes = await Promise.all(batch.map(async key => {
        try {
          await execute(new DeleteCommand({
            TableName: tableName, Key: { PK: key.PK, SK: key.SK },
            ConditionExpression: "attribute_exists(#pk) AND #retention = :retention AND #expiry = :expected AND #ttl = :expected AND #kind IN (:preview,:analysis,:cache,:design,:claim)",
            ExpressionAttributeNames: { "#pk": "PK", "#retention": "GSI3PK", "#expiry": "GSI3SK",
              "#ttl": "expiresAtEpochSeconds", "#kind": "entityType" },
            ExpressionAttributeValues: { ":retention": RETENTION_PARTITION, ":expected": key.expiresAtEpochSeconds,
              ":preview": "ROOF_PREVIEW", ":analysis": "SOLAR_ANALYSIS", ":cache": "SOLAR_CACHE",
              ":design": "USER_DESIGN", ":claim": "DESIGN_GENERATION_CLAIM" },
          }));
          return "deleted" as const;
        } catch (error) {
          if (alreadyRemoved(error)) return "already-removed" as const;
          throw error;
        }
      }));
      deleted += outcomes.filter(outcome => outcome === "deleted").length;
      removed += outcomes.filter(outcome => outcome === "already-removed").length;
    }
    cursor = result.LastEvaluatedKey;
  } while (cursor && pages < RETENTION_MAX_PAGES);
  return { pages, examined, deleted, alreadyRemoved: removed, backlog: !!cursor };
}
