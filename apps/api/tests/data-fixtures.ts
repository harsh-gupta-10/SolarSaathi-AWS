import { GetCommand, PutCommand, QueryCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import type { CurrentIdentityResponse } from "@solarsaathi/types";
import type { CoreCommand, CoreExecutor } from "../src/data/client";
import { CoreRepository } from "../src/data/repository";
import { CoreService } from "../src/data/service";
import { keys, type EntityKey } from "../src/data/keys";

export const actorId = "11111111-1111-4111-8111-111111111111";
export const otherId = "22222222-2222-4222-8222-222222222222";
export const fixedNow = new Date("2026-10-08T10:00:00.000Z");
export const roof = { schemaVersion: 1 as const, source: "MANUAL" as const, measuredAt: fixedNow.toISOString(), roofAreaSquareMeters: 90, segmentCount: 2 };
export function identity(userId = actorId, role: "HOMEOWNER" | "BROKER" = "HOMEOWNER", organizationId?: string): CurrentIdentityResponse {
  return {
    profile: { userId, cognitoSub: userId, email: "user@example.com", name: "Solar User", role, ...(organizationId ? { organizationId } : {}) },
    emailVerified: true, source: "COGNITO", requestId: "test-request-id",
  };
}
const recordKey = (key: EntityKey) => `${key.PK}\u0000${key.SK}`;
export function conditionalError() { return Object.assign(new Error("private SDK marker"), { name: "ConditionalCheckFailedException" }); }

// Test-only executor implements atomic conditions, revision checks and scoped Query semantics.
export class MemoryExecutor {
  readonly records = new Map<string, Record<string, unknown>>();
  readonly commands: CoreCommand[] = [];
  failNext?: Error;
  beforeTransaction?: () => void;
  seed(record: EntityKey & Record<string, unknown>) { this.records.set(recordKey(record), structuredClone(record)); }
  read(key: EntityKey) { return this.records.get(recordKey(key)); }
  delete(key: EntityKey) { this.records.delete(recordKey(key)); }

  execute: CoreExecutor = async command => {
    this.commands.push(command);
    if (this.failNext) { const error = this.failNext; this.failNext = undefined; throw error; }
    if (command instanceof GetCommand) return { Item: structuredClone(this.records.get(recordKey(command.input.Key as EntityKey))) };
    if (command instanceof PutCommand) {
      const item = command.input.Item as EntityKey & Record<string, unknown>;
      if (command.input.ConditionExpression !== "attribute_not_exists(PK) AND attribute_not_exists(SK)") throw new Error("Unsafe unconditional put");
      if (this.records.has(recordKey(item))) throw conditionalError();
      this.seed(item); return {};
    }
    if (command instanceof TransactWriteCommand) {
      this.beforeTransaction?.();
      const items = command.input.TransactItems ?? [];
      const seen = new Set<string>();
      const reasons = items.map(item => {
        const key = (item.Put?.Item ?? item.ConditionCheck?.Key) as EntityKey;
        if (seen.has(recordKey(key))) throw new Error("Duplicate transaction key");
        seen.add(recordKey(key));
        if (item.Put) {
          if (item.Put.ConditionExpression === "attribute_not_exists(PK) AND attribute_not_exists(SK)") {
            return { Code: this.records.has(recordKey(key)) ? "ConditionalCheckFailed" : "None" };
          }
          if (item.Put.ConditionExpression === "#revision = :revision AND #status = :status AND #org = :org") {
            const previous = this.read(key);
            const values = item.Put.ExpressionAttributeValues!;
            return { Code: previous && previous.revision === values[":revision"] && previous.status === values[":status"] &&
              previous.orgId === values[":org"] ? "None" : "ConditionalCheckFailed" };
          }
          throw new Error("Unsafe unconditional transaction put");
        }
        if (!item.ConditionCheck || !item.ConditionCheck.ConditionExpression?.startsWith("#revision = :revision")) throw new Error("Unsupported transaction condition");
        const check = item.ConditionCheck;
        const expression = check.ConditionExpression!;
        const stored = this.read(key);
        const names = check.ExpressionAttributeNames ?? {};
        const values = check.ExpressionAttributeValues ?? {};
        const equals = [...expression.matchAll(/(#[A-Za-z]+) = (:[A-Za-z]+)/g)].every(([, name, token]) =>
          stored?.[names[name!]!] === values[token!]);
        const membership = !expression.includes("contains(#members, :actor)") ||
          (Array.isArray(stored?.[names["#members"]!]) &&
            (stored[names["#members"]!] as unknown[]).includes(values[":actor"]));
        return { Code: equals && membership ? "None" : "ConditionalCheckFailed" };
      });
      if (reasons.some(reason => reason.Code !== "None")) {
        throw Object.assign(new Error("private transaction marker"), { name: "TransactionCanceledException", CancellationReasons: reasons });
      }
      for (const item of items) if (item.Put) this.seed(item.Put.Item as EntityKey & Record<string, unknown>);
      return {};
    }
    if (command instanceof QueryCommand) {
      const input = command.input;
      if (input.KeyConditionExpression !== "#pk = :pk AND begins_with(#sk, :prefix)") throw new Error("Unsupported query");
      const partition = input.ExpressionAttributeNames!["#pk"];
      const sort = input.ExpressionAttributeNames!["#sk"];
      const values = input.ExpressionAttributeValues!;
      const matches = Array.from(this.records.values()).filter(record => record[partition] === values[":pk"] &&
        typeof record[sort] === "string" && (record[sort] as string).startsWith(values[":prefix"]));
      matches.sort((a, b) => (a[sort] as string).localeCompare(b[sort] as string));
      const exclusive = input.ExclusiveStartKey;
      const remaining = exclusive ? matches.filter(record => (record[sort] as string) > exclusive[sort]) : matches;
      const page = remaining.slice(0, input.Limit ?? 20);
      const last = page.at(-1);
      const lastKey = last && remaining.length > page.length ? {
        PK: last.PK, SK: last.SK, ...(input.IndexName ? { [partition]: last[partition], [sort]: last[sort] } : {}),
      } : undefined;
      return { Items: structuredClone(page), ...(lastKey ? { LastEvaluatedKey: lastKey } : {}) };
    }
    throw new Error("Unexpected SDK operation");
  };
}

export function setupData() {
  const memory = new MemoryExecutor();
  const repository = new CoreRepository("test-core-table", memory.execute);
  let sequence = 0;
  const service = new CoreService(repository, { now: () => fixedNow, createId: () => `generated-${++sequence}` });
  return { memory, repository, service };
}

export function orgRecord(orgId: string, ownerUserId: string, members: string[] = [ownerUserId], kind: "BROKER" | "PERSONAL" = "BROKER") {
  return {
    ...keys.organization(orgId), schemaVersion: 1 as const, revision: 1, createdAt: fixedNow.toISOString(), updatedAt: fixedNow.toISOString(),
    entityType: "ORGANIZATION" as const, orgId, ownerUserId, memberUserIds: members, kind, name: "Verified organization",
  };
}
