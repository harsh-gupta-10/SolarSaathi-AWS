import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import { RequestError } from "../lib/http";

export type CoreCommand = GetCommand | PutCommand | QueryCommand | TransactWriteCommand;
export interface CoreExecutionResult { Item?: unknown; Items?: unknown[]; LastEvaluatedKey?: unknown }
export type CoreExecutor = (command: CoreCommand) => Promise<CoreExecutionResult>;

export const databaseUnavailable = () => new RequestError(503, "DATABASE_UNAVAILABLE", "The database is temporarily unavailable.");
export const databaseConflict = () => new RequestError(409, "DATABASE_CONFLICT", "The record already exists or has changed. Retry after refreshing.");

export function databaseError(error: unknown): RequestError {
  if (error instanceof RequestError) return error;
  if (error instanceof Error) {
    if (error.name === "ConditionalCheckFailedException") return databaseConflict();
    if (error.name === "TransactionCanceledException" && "CancellationReasons" in error) {
      const reasons = error.CancellationReasons;
      if (Array.isArray(reasons) && reasons.some(reason => reason?.Code === "ConditionalCheckFailed") &&
        reasons.every(reason => ["None", "ConditionalCheckFailed"].includes(reason?.Code))) return databaseConflict();
    }
  }
  return databaseUnavailable();
}

export function createDocumentExecutor(region: string): CoreExecutor {
  const client = DynamoDBDocumentClient.from(new DynamoDBClient({
    region, maxAttempts: 2,
    requestHandler: { connectionTimeout: 1_000, requestTimeout: 2_000 },
  }), { marshallOptions: { removeUndefinedValues: true } });
  return async command => {
    const options = { abortSignal: AbortSignal.timeout(4_000) };
    if (command instanceof GetCommand) return client.send(command, options);
    if (command instanceof QueryCommand) return client.send(command, options);
    if (command instanceof PutCommand) await client.send(command, options);
    else await client.send(command, options);
    return {};
  };
}

const executors = new Map<string, CoreExecutor>();
export function documentExecutor(region: string): CoreExecutor {
  const cached = executors.get(region);
  if (cached) return cached;
  const executor = createDocumentExecutor(region);
  if (executors.size >= 4) executors.delete(executors.keys().next().value!);
  executors.set(region, executor);
  return executor;
}
