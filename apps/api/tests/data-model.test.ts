import { GetCommand, PutCommand, QueryCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { describe, expect, it } from "vitest";
import { databaseError } from "../src/data/client";
import { keys } from "../src/data/keys";
import { CoreRepository } from "../src/data/repository";
import {
  bootstrapInputSchema, cachePayloadSchema, contactInputSchema, entitySchema, pageInputSchema, parseInput, parseStored, propertyInputSchema,
} from "../src/data/schemas";
import { actorId, conditionalError, identity, orgRecord, roof, setupData } from "./data-fixtures";

describe("core keys and schemas", () => {
  it.each([
    [keys.user("u"), "USER#u", "PROFILE"], [keys.organization("o"), "ORG#o", "PROFILE"],
    [keys.customer("o", "c"), "ORG#o", "CUSTOMER#c"], [keys.property("c", "p"), "CUSTOMER#c", "PROPERTY#p"],
    [keys.locator("p"), "PROPERTY#p", "LOCATOR"], [keys.analysis("p", "a"), "PROPERTY#p", "ANALYSIS#a"],
    [keys.lead("o", "l"), "ORG#o", "LEAD#l"], [keys.cache("p", "fingerprint", 12), "CACHE#p#fingerprint", "VERSION#12"],
  ])("preserves document keys %j", (key, PK, SK) => { expect(key).toEqual({ PK, SK }); });

  it("sets exactly the owner and tenant property indexes", () => {
    expect(keys.propertyIndexes("u", "o", "p")).toEqual({ GSI1PK: "USER#u", GSI1SK: "PROPERTY#p", GSI2PK: "ORG#o", GSI2SK: "PROPERTY#p" });
  });

  it("validates all eight stored record kinds and rejects poisoning independently", async () => {
    const { service, memory } = setupData();
    const home = identity();
    await service.bootstrap(home, {});
    const property = await service.createProperty(home, { label: "Home", address: "123 Example Road Mumbai" });
    await service.saveAnalysis(home, property.propertyId, roof);
    await service.saveCache(home, property.propertyId, "cache-key", 1, Math.floor(Date.parse(roof.measuredAt) / 1000) + 60, roof);
    const broker = identity("broker-id", "BROKER");
    await service.bootstrap(broker, {});
    await service.createLead(broker, { name: "Customer" });
    const records = Array.from(memory.records.values());
    expect(new Set(records.map(record => record.entityType)).size).toBe(8);
    for (const record of records) {
      expect(entitySchema.safeParse(record).success).toBe(true);
      for (const poison of [{ PK: "OTHER#record" }, { revision: 0 }, { revision: 1.5 }, { schemaVersion: 2 },
        { createdAt: "bad-date" }, { updatedAt: "2020-01-01T00:00:00.000Z" }, { finance: { subsidy: 999 } }]) {
        expect(entitySchema.safeParse({ ...record, ...poison }).success, `${record.entityType}: ${JSON.stringify(poison)}`).toBe(false);
      }
    }
    const storedProperty = memory.read(keys.property(property.customerId, property.propertyId))!;
    expect(entitySchema.safeParse({ ...storedProperty, GSI1PK: "USER#someone-else" }).success).toBe(false);
    expect(entitySchema.safeParse({ ...storedProperty, address: "short" }).success).toBe(false);
    expect(entitySchema.safeParse({ ...storedProperty, address: "x".repeat(301) }).success).toBe(false);
    expect(entitySchema.safeParse({ ...orgRecord("org", actorId), memberUserIds: [actorId, actorId] }).success).toBe(false);
    expect(entitySchema.safeParse(orgRecord("org", actorId, ["another-member"])).success).toBe(false);
    expect(entitySchema.safeParse({ ...orgRecord("org", actorId, ["someone-else"], "PERSONAL") }).success).toBe(false);
  });

  it.each([
    [bootstrapInputSchema, { role: "BROKER" }], [bootstrapInputSchema, { orgId: "forged" }],
    [contactInputSchema, { name: "A", ownerUserId: "forged" }], [contactInputSchema, { name: "A", status: "COMPLETED" }],
    [contactInputSchema, { name: "A", email: "invalid" }], [contactInputSchema, { name: "A", phone: "not-phone" }],
    [contactInputSchema, { name: "A\nB" }], [contactInputSchema, { name: "x".repeat(121) }],
    [propertyInputSchema, { label: "Home", address: "123 Example Road", propertyId: "forged" }],
    [propertyInputSchema, { label: "Home", address: "123 Example Road", latitude: 20 }],
    [propertyInputSchema, { label: "Home", address: "123 Example Road", roofArea: 999 }],
    [pageInputSchema, { limit: 51 }], [pageInputSchema, { limit: 0 }], [pageInputSchema, { cursor: "x".repeat(2049) }],
    [cachePayloadSchema, { ...roof, grossCost: 100 }], [cachePayloadSchema, { ...roof, source: "AI" }],
    [cachePayloadSchema, { ...roof, roofAreaSquareMeters: Number.POSITIVE_INFINITY }],
    [cachePayloadSchema, { ...roof, huge: "x".repeat(16_385) }],
  ])("strictly rejects arbitrary public/internal payloads %j", (schema, value) => {
    expect(() => parseInput<unknown>(schema, value)).toThrowError(expect.objectContaining({ statusCode: 400, code: "INVALID_REQUEST" }));
  });

  it("returns safe errors for unknown/malformed SDK records and wrong keys", async () => {
    expect(() => parseStored(entitySchema, { entityType: "USER" })).toThrowError(expect.objectContaining({ statusCode: 503 }));
    const wrong = new CoreRepository("test-table", async () => ({ Item: orgRecord("other-org", actorId) }));
    await expect(wrong.getOrganization("requested-org")).rejects.toMatchObject({ statusCode: 503, code: "DATABASE_UNAVAILABLE" });
    const nonArray = new CoreRepository("test-table", async () => ({ Items: "not-an-array" as unknown as unknown[] }));
    await expect(nonArray.listLeads({ actorUserId: actorId, orgId: "org", kind: "leads" }, 20)).rejects.toMatchObject({ statusCode: 503 });
  });
});

describe("repository command constraints", () => {
  it("never scans; strongly reads; uses conditional immutable Put and transactions", async () => {
    const { service, repository, memory } = setupData();
    const broker = identity(actorId, "BROKER");
    await service.bootstrap(broker, {});
    await service.createCustomer(broker, { name: "Customer" });
    await service.listCustomers(broker);
    await repository.putImmutable(orgRecord("standalone", actorId));
    expect(memory.commands.every(command => [GetCommand, PutCommand, QueryCommand, TransactWriteCommand].some(type => command instanceof type))).toBe(true);
    for (const command of memory.commands) {
      if (command instanceof GetCommand) expect(command.input.ConsistentRead).toBe(true);
      if (command instanceof PutCommand) expect(command.input.ConditionExpression).toContain("attribute_not_exists");
    }
    await expect(repository.putImmutable(orgRecord("standalone", actorId))).rejects.toMatchObject({ statusCode: 409 });
    expect(memory.read(keys.organization("standalone"))?.revision).toBe(1);
    expect(() => new CoreRepository("", memory.execute)).toThrowError(expect.objectContaining({ code: "DATABASE_NOT_CONFIGURED" }));
  });

  it.each(["ProvisionedThroughputExceededException", "ResourceNotFoundException", "AccessDeniedException", "AbortError"])("maps %s to a safe outage", name => {
    const result = databaseError(Object.assign(new Error("private provider error"), { name }));
    expect(result).toMatchObject({ statusCode: 503, code: "DATABASE_UNAVAILABLE" });
    expect(result.message).not.toContain("private");
  });

  it("only calls an identified conditional cancellation a conflict", () => {
    expect(databaseError(conditionalError())).toMatchObject({ statusCode: 409 });
    expect(databaseError(Object.assign(new Error(), { name: "TransactionCanceledException" }))).toMatchObject({ statusCode: 503 });
    expect(databaseError(Object.assign(new Error(), { name: "TransactionCanceledException", CancellationReasons: [{ Code: "ConditionalCheckFailed" }, { Code: "ProvisionedThroughputExceeded" }] }))).toMatchObject({ statusCode: 503 });
  });
});
