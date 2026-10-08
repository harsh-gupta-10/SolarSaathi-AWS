import { DeleteCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRetentionHandler } from "../src/handlers/retention";
import { purgeExpiredGoogleRoofs, RETENTION_MAX_PAGES, RETENTION_PAGE_SIZE, type RetentionExecutor } from "../src/retention/google-roof";

const cutoff = 1_800_000_000;
const entry = (id: string, expiry = cutoff - 1) => ({ PK: `PROPERTY#${id}`, SK: `ROOF_PREVIEW#${id}`,
  GSI3PK: "GOOGLE_ROOF_RETENTION", GSI3SK: expiry });
const conditional = () => Object.assign(new Error("already removed"), { name: "ConditionalCheckFailedException" });

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe("Google roof hard-delete sweep", () => {
  it("queries only the sparse expiry index and conditionally deletes bounded, paginated items", async () => {
    const commands: (QueryCommand | DeleteCommand)[] = [];
    let page = 0;
    const execute: RetentionExecutor = async command => {
      commands.push(command);
      if (command instanceof QueryCommand) {
        page++;
        return page === 1 ? { Items: [entry("one"), entry("gone")], LastEvaluatedKey: { ...entry("gone") } } :
          { Items: [entry("two")] };
      }
      if (command.input.Key?.PK === "PROPERTY#gone") throw conditional();
      return {};
    };
    const result = await purgeExpiredGoogleRoofs("core-table", execute, cutoff);
    expect(result).toEqual({ pages: 2, examined: 3, deleted: 2, alreadyRemoved: 1, backlog: false });
    const queries = commands.filter(command => command instanceof QueryCommand);
    expect(queries).toHaveLength(2);
    expect(queries[0].input).toMatchObject({ TableName: "core-table", IndexName: "GSI3", Limit: RETENTION_PAGE_SIZE,
      KeyConditionExpression: "#retention = :retention AND #expiry <= :cutoff", ScanIndexForward: true });
    expect(queries[0].input).not.toHaveProperty("ConsistentRead");
    expect(queries[1].input.ExclusiveStartKey).toEqual(entry("gone"));
    const deletes = commands.filter(command => command instanceof DeleteCommand);
    expect(deletes).toHaveLength(3);
    for (const deletion of deletes) {
      expect(deletion.input.ConditionExpression).toContain("#kind IN (:preview,:analysis,:cache)");
      expect(deletion.input.ExpressionAttributeValues?.[":expected"]).toBe(cutoff - 1);
      expect(deletion.input).not.toHaveProperty("ReturnValuesOnConditionCheckFailure");
    }
  });

  it("stops after the fixed page budget and reports backlog for alarming", async () => {
    let queries = 0;
    const execute: RetentionExecutor = async command => {
      if (command instanceof QueryCommand) {
        queries++;
        return { Items: [entry(`item-${queries}`)], LastEvaluatedKey: entry(`item-${queries}`) };
      }
      return {};
    };
    const result = await purgeExpiredGoogleRoofs("core-table", execute, cutoff);
    expect(queries).toBe(RETENTION_MAX_PAGES);
    expect(result).toMatchObject({ pages: RETENTION_MAX_PAGES, examined: RETENTION_MAX_PAGES,
      deleted: RETENTION_MAX_PAGES, backlog: true });
  });

  it("rejects malformed index entries and never deletes a non-expired or unindexed item", async () => {
    const deleted = vi.fn();
    const execute: RetentionExecutor = async command => {
      if (command instanceof DeleteCommand) { deleted(); return {}; }
      return { Items: [entry("future", cutoff + 1)] };
    };
    await expect(purgeExpiredGoogleRoofs("core-table", execute, cutoff)).rejects.toThrow("Invalid retention index entry");
    expect(deleted).not.toHaveBeenCalled();
  });

  it("sanitizes scheduled handler failures and surfaces backlog through Lambda Errors", async () => {
    vi.stubEnv("ENVIRONMENT", "test"); vi.stubEnv("AWS_REGION", "ap-south-1");
    vi.stubEnv("CORE_TABLE_NAME", "core-table");
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const failed = createRetentionHandler({ now: () => new Date(cutoff * 1_000), createExecutor: () => async () => {
      throw new Error("private SDK payload");
    } });
    await expect(failed()).rejects.toThrow("Google roof retention cleanup failed");
    const backlog = createRetentionHandler({ now: () => new Date(cutoff * 1_000), createExecutor: () => async command =>
      command instanceof QueryCommand ? { Items: [], LastEvaluatedKey: entry("cursor") } : {} });
    await expect(backlog()).rejects.toThrow("Google roof retention cleanup failed");
    expect(JSON.stringify(vi.mocked(console.log).mock.calls)).not.toContain("private SDK payload");
  });
});
