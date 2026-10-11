import { TransactWriteCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { describe, expect, it } from "vitest";
import { decodeCursor } from "../src/data/cursor";
import { keys } from "../src/data/keys";
import { CoreService } from "../src/data/service";
import { actorId, fixedNow, identity, orgRecord, otherId, roof, setupData } from "./data-fixtures";
const propertyBody = { label: "Main residence", address: "123 Example Road, Mumbai" };
const forbidden = { statusCode: 403, code: "FORBIDDEN" };
const notFound = { statusCode: 404, code: "NOT_FOUND" };

describe("atomic account bootstrap", () => {
  it("stores a personal user, private organization and SELF customer in one conditional transaction", async () => {
    const { service, memory } = setupData();
    const result = await service.bootstrap(identity(), {});
    expect(result.user).toMatchObject({ userId: actorId, role: "HOMEOWNER" });
    expect(result.organization.kind).toBe("PERSONAL");
    expect(result.customer?.kind).toBe("SELF");
    expect(memory.records.size).toBe(3);
    const transactions = memory.commands.filter(command => command instanceof TransactWriteCommand);
    expect(transactions).toHaveLength(1);
    expect((transactions[0] as TransactWriteCommand).input.TransactItems).toHaveLength(3);
    const organization = memory.read(keys.organization(result.organization.organizationId))!;
    expect(organization).toMatchObject({ ownerUserId: actorId, memberUserIds: [actorId] });
  });

  it("creates a broker-owned organization without fabricating a customer", async () => {
    const { service, memory } = setupData();
    const result = await service.bootstrap(identity(actorId, "BROKER"), { organizationName: "My solar consultancy" });
    expect(result.organization).toMatchObject({ kind: "BROKER", name: "My solar consultancy" });
    expect(result.customer).toBeUndefined();
    expect(memory.records.size).toBe(2);
  });

  it("is idempotent across retries and concurrent bootstrap calls without orphan records", async () => {
    const { service, memory } = setupData();
    const results = await Promise.all(Array.from({ length: 8 }, () => service.bootstrap(identity(), {})));
    for (const result of results) expect(result).toEqual(results[0]);
    expect(memory.records.size).toBe(3);
    const again = await service.bootstrap(identity(), {});
    expect(again).toEqual(results[0]);
    expect(memory.records.size).toBe(3);
  });

  it("never treats uncommitted transaction failure as an idempotent success", async () => {
    const { service, memory } = setupData();
    memory.beforeTransaction = () => { memory.seed(orgRecord("generated-1", otherId, [otherId], "PERSONAL")); };
    await expect(service.bootstrap(identity(), {})).rejects.toMatchObject({ statusCode: 409 });
    expect(memory.read(keys.user(actorId))).toBeUndefined();
    expect(Array.from(memory.records.values()).some(record => record.entityType === "CUSTOMER")).toBe(false);
  });

  it("requires verified email and rejects caller identity/organization/role assignment", async () => {
    const { service, memory } = setupData();
    await expect(service.bootstrap({ ...identity(), emailVerified: false }, {})).rejects.toMatchObject(forbidden);
    for (const body of [{ role: "BROKER" }, { organizationId: "other" }, { userId: "other" }, { members: [actorId] }, { organizationName: "Injected organization" }]) {
      await expect(service.bootstrap(identity(), body)).rejects.toMatchObject({ statusCode: 400 });
    }
    expect(memory.records.size).toBe(0);
  });

  it("links verified org context only with stored compatible owner/member membership", async () => {
    const { service, memory } = setupData();
    const broker = identity(actorId, "BROKER", "existing-org");
    await expect(service.bootstrap(broker, {})).rejects.toMatchObject(forbidden);
    memory.seed(orgRecord("existing-org", otherId));
    await expect(service.bootstrap(broker, {})).rejects.toMatchObject(forbidden);
    memory.seed(orgRecord("existing-org", otherId, [actorId, otherId]));
    const result = await service.bootstrap(broker, { organizationName: "Cannot rename stored org" });
    expect(result.organization.name).toBe("Verified organization");
    expect(memory.records.size).toBe(2);
    expect((memory.commands.filter(command => command instanceof TransactWriteCommand).at(-1) as TransactWriteCommand).input.TransactItems?.[0].ConditionCheck).toBeDefined();
    await expect(service.bootstrap(identity(actorId, "BROKER", "different-org"), {})).rejects.toMatchObject(forbidden);
    expect(memory.read(keys.user(actorId))?.orgId).toBe("existing-org");
    expect(await service.bootstrap(broker, {})).toEqual(result);
  });

  it("does not move canonical tenant records after role changes or incompatible org configuration", async () => {
    const { service, memory } = setupData();
    const broker = identity(actorId, "BROKER");
    const result = await service.bootstrap(broker, {});
    await expect(service.bootstrap(identity(), {})).rejects.toMatchObject(forbidden);
    await expect(service.listCustomers(identity())).rejects.toMatchObject(forbidden);
    memory.seed({ ...orgRecord(result.organization.organizationId, actorId, [actorId], "PERSONAL"), revision: 2 });
    await expect(service.createLead(broker, { name: "Lead" })).rejects.toMatchObject(forbidden);
    expect(memory.read(keys.user(actorId))?.orgId).toBe(result.organization.organizationId);
  });
});

describe("stored canonical tenant and owner authorization", () => {
  it("returns 404 for an unbootstrapped user rather than synthesizing a profile", async () => {
    const { service, memory } = setupData();
    await expect(service.getUser(identity())).rejects.toMatchObject(notFound);
    expect(memory.records.size).toBe(0);
  });

  it("denies homeowner tenant operations even after a profile exists", async () => {
    const { service } = setupData();
    await service.bootstrap(identity(), {});
    await expect(service.listCustomers(identity())).rejects.toMatchObject(forbidden);
    await expect(service.createCustomer(identity(), { name: "Not allowed" })).rejects.toMatchObject(forbidden);
    await expect(service.listLeads(identity())).rejects.toMatchObject(forbidden);
    await expect(service.createLead(identity(), { name: "Not allowed" })).rejects.toMatchObject(forbidden);
  });

  it("limits homeowners to own customer and property metadata", async () => {
    const { service, memory } = setupData();
    await service.bootstrap(identity(), {});
    await service.bootstrap(identity(otherId), {});
    const first = await service.createProperty(identity(), propertyBody);
    await service.createProperty(identity(otherId), propertyBody);
    await expect(service.getProperty(identity(otherId), first.propertyId)).rejects.toMatchObject(notFound);
    await expect(service.createProperty(identity(), { ...propertyBody, customerId: first.customerId })).rejects.toMatchObject({ statusCode: 400 });
    expect((await service.listProperties(identity())).properties).toEqual([first]);
    expect(memory.commands.filter(command => command instanceof QueryCommand).at(-1)?.input.IndexName).toBe("GSI1");
  });

  it("deletes only an owned property, its locator and its core child records", async () => {
    const { service, memory } = setupData();
    await service.bootstrap(identity(), {});
    await service.bootstrap(identity(otherId), {});
    const first = await service.createProperty(identity(), propertyBody);
    const kept = await service.createProperty(identity(), propertyBody);
    const analysis = await service.saveAnalysis(identity(), first.propertyId, roof);
    const keptAnalysis = await service.saveAnalysis(identity(), kept.propertyId, roof);
    await expect(service.deleteProperty(identity(otherId), first.propertyId)).rejects.toMatchObject(notFound);
    expect(memory.read(keys.locator(first.propertyId))).toBeDefined();
    expect(await service.deleteProperty(identity(), first.propertyId)).toEqual({ deleted: { propertyId: first.propertyId } });
    expect(memory.read(keys.property(first.customerId, first.propertyId))).toBeUndefined();
    expect(memory.read(keys.locator(first.propertyId))).toBeUndefined();
    expect(memory.read(keys.analysis(first.propertyId, analysis.analysisId))).toBeUndefined();
    expect(memory.read(keys.analysis(kept.propertyId, keptAnalysis.analysisId))).toBeDefined();
    expect((await service.listProperties(identity())).properties).toEqual([kept]);
    await expect(service.getProperty(identity(), first.propertyId)).rejects.toMatchObject(notFound);
    await expect(service.deleteProperty(identity(), first.propertyId)).rejects.toMatchObject(notFound);
  });

  it("purges applications, application events and design records with the property", async () => {
    const { service, memory } = setupData();
    await service.bootstrap(identity(), {});
    const property = await service.createProperty(identity(), propertyBody);
    const other = await service.createProperty(identity(), propertyBody);
    const seeded = [
      { PK: `PROPERTY#${property.propertyId}`, SK: "APPLICATION#app-1" },
      { PK: "APPLICATION#app-1", SK: "EVENT#2026-10-01T00:00:00.000Z#evt-1" },
      { PK: `PROPERTY#${property.propertyId}`, SK: "DESIGN#design-1" },
      { PK: `PROPERTY#${property.propertyId}`, SK: "DESIGN_CLAIM#design-1" },
    ];
    const kept = { PK: `PROPERTY#${other.propertyId}`, SK: "APPLICATION#app-2" };
    for (const key of [...seeded, kept]) memory.seed({ ...key, revision: 1 });
    await service.deleteProperty(identity(), property.propertyId);
    for (const key of seeded) expect(memory.read(key)).toBeUndefined();
    expect(memory.read(kept)).toBeDefined();
  });

  it("does not delete a property whose revision changed after authorization", async () => {
    const { service, memory } = setupData();
    await service.bootstrap(identity(), {});
    const property = await service.createProperty(identity(), propertyBody);
    const key = keys.property(property.customerId, property.propertyId);
    memory.beforeTransaction = () => { memory.seed({ ...memory.read(key)!, ...key, revision: 2 }); };
    await expect(service.deleteProperty(identity(), property.propertyId)).rejects.toMatchObject({ statusCode: 409 });
    expect(memory.read(keys.locator(property.propertyId))).toBeDefined();
  });

  it("does not leak cross-org customer existence and properties between brokers", async () => {
    const { service } = setupData();
    const one = identity(actorId, "BROKER"), two = identity(otherId, "BROKER");
    await service.bootstrap(one, {}); await service.bootstrap(two, {});
    const customer = await service.createCustomer(one, { name: "Private customer", email: "customer@example.com", phone: "+919876543210" });
    const property = await service.createProperty(one, { ...propertyBody, customerId: customer.customerId });
    await service.createLead(one, { name: "Private lead" });
    await expect(service.createProperty(two, { ...propertyBody, customerId: customer.customerId })).rejects.toMatchObject(notFound);
    await expect(service.createProperty(two, { ...propertyBody, customerId: "not-real" })).rejects.toMatchObject(notFound);
    await expect(service.getProperty(two, property.propertyId)).rejects.toMatchObject(notFound);
    expect((await service.listCustomers(two)).customers).toEqual([]);
    expect((await service.listLeads(two)).leads).toEqual([]);
    expect((await service.listProperties(two)).properties).toEqual([]);
  });

  it("permits same-tenant brokers with stored membership to list org properties via GSI2", async () => {
    const { service, memory } = setupData();
    const one = identity(actorId, "BROKER");
    const bootstrap = await service.bootstrap(one, {});
    const orgId = bootstrap.organization.organizationId;
    memory.seed(orgRecord(orgId, actorId, [actorId, otherId]));
    const two = identity(otherId, "BROKER", orgId);
    await service.bootstrap(two, {});
    const customer = await service.createCustomer(one, { name: "Shared customer" });
    const property = await service.createProperty(one, { ...propertyBody, customerId: customer.customerId });
    expect(await service.getProperty(two, property.propertyId)).toEqual(property);
    expect((await service.listProperties(two)).properties).toEqual([property]);
    expect(memory.commands.filter(command => command instanceof QueryCommand).at(-1)?.input.IndexName).toBe("GSI2");
    memory.seed({ ...orgRecord(orgId, actorId, [actorId]), revision: 2 });
    await expect(service.listCustomers(two)).rejects.toMatchObject(forbidden);
    await expect(service.getProperty(two, property.propertyId)).rejects.toMatchObject(forbidden);
  });

  it("checks membership revision atomically before state changes", async () => {
    const { service, memory } = setupData();
    const broker = identity(actorId, "BROKER");
    const result = await service.bootstrap(broker, {});
    const size = memory.records.size;
    memory.beforeTransaction = () => { memory.seed({ ...orgRecord(result.organization.organizationId, otherId, [otherId]), revision: 2 }); };
    await expect(service.createCustomer(broker, { name: "Race" })).rejects.toMatchObject({ statusCode: 409 });
    expect(memory.records.size).toBe(size);
  });

  it("captures current user, organization, property and locator revisions for later transactional writes", async () => {
    const { service, memory } = setupData();
    const broker = identity(actorId, "BROKER");
    const account = await service.bootstrap(broker, {});
    const customer = await service.createCustomer(broker, { name: "Customer" });
    const property = await service.createProperty(broker, { ...propertyBody, customerId: customer.customerId });
    const scope = await service.getPropertyWriteScope(broker, property.propertyId);
    expect(scope).toMatchObject({ actorUserId: actorId, actorRole: "BROKER",
      orgId: account.organization.organizationId, organizationKind: "BROKER",
      propertyId: property.propertyId, customerId: customer.customerId, propertyOwnerUserId: actorId,
      organizationRevision: 1, userRevision: 1, propertyRevision: 1, locatorRevision: 1 });
    memory.seed({ ...orgRecord(account.organization.organizationId, otherId, [otherId]), revision: 2 });
    await expect(service.getPropertyWriteScope(broker, property.propertyId)).rejects.toMatchObject(forbidden);
  });

  it("projects DTOs without storage or ACL keys, exposing only the lead's optimistic revision", async () => {
    const { service } = setupData();
    const broker = identity(actorId, "BROKER");
    const bootstrap = await service.bootstrap(broker, {});
    const customer = await service.createCustomer(broker, { name: "Customer" });
    const property = await service.createProperty(broker, { ...propertyBody, customerId: customer.customerId });
    const lead = await service.createLead(broker, { name: "Lead" });
    expect(lead.status).toBe("NEW");
    const generalDto = JSON.stringify([bootstrap, customer, property, await service.listCustomers(broker), await service.listProperties(broker)]);
    expect(generalDto).not.toMatch(/"PK"|"SK"|GSI|ownerUserId|memberUserIds|revision|entityType|expiresAtEpochSeconds|selfCustomerId/);
    const leadDto = JSON.stringify([lead, await service.listLeads(broker)]);
    expect(lead).toHaveProperty("revision", 1);
    expect(leadDto).not.toMatch(/"PK"|"SK"|GSI|ownerUserId|memberUserIds|entityType|expiresAtEpochSeconds|selfCustomerId/);
    expect(property).not.toHaveProperty("latitude");
    expect(property).not.toHaveProperty("grossCost");
  });
});

describe("scope-bound cursor pagination", () => {
  it("pages customers, leads, homeowner properties and broker properties without scans", async () => {
    const { service } = setupData();
    const home = identity(), broker = identity(otherId, "BROKER");
    await service.bootstrap(home, {}); await service.bootstrap(broker, {});
    for (let i = 0; i < 3; i++) {
      await service.createProperty(home, propertyBody);
      const customer = await service.createCustomer(broker, { name: `Customer ${i}` });
      await service.createProperty(broker, { ...propertyBody, customerId: customer.customerId });
      await service.createLead(broker, { name: `Lead ${i}` });
    }
    const customerPage = await service.listCustomers(broker, { limit: 1 });
    expect(customerPage.customers).toHaveLength(1);
    expect((await service.listCustomers(broker, { limit: 2, cursor: customerPage.nextCursor })).customers).toHaveLength(2);
    const leadPage = await service.listLeads(broker, { limit: 1 });
    expect((await service.listLeads(broker, { limit: 2, cursor: leadPage.nextCursor })).leads).toHaveLength(2);
    for (const actor of [home, broker]) {
      const first = await service.listProperties(actor, { limit: 1 });
      const second = await service.listProperties(actor, { limit: 2, cursor: first.nextCursor });
      expect(first.properties).toHaveLength(1); expect(second.properties).toHaveLength(2);
      expect(second.nextCursor).toBeUndefined();
      expect(second.properties.map(record => record.propertyId)).not.toContain(first.properties[0].propertyId);
    }
  });

  it("rejects actor/scope tampering, malformed cursors and supplied raw keys", async () => {
    const { service } = setupData();
    const broker = identity(actorId, "BROKER");
    const result = await service.bootstrap(broker, {});
    await service.createCustomer(broker, { name: "One" }); await service.createCustomer(broker, { name: "Two" });
    const first = await service.listCustomers(broker, { limit: 1 });
    const envelope = JSON.parse(Buffer.from(first.nextCursor!, "base64url").toString("utf8"));
    const scope = { actorUserId: actorId, orgId: result.organization.organizationId, kind: "customers" as const };
    for (const cursor of ["not-json", "@@@", "x".repeat(2049), first.nextCursor! + "=", ...[
      { ...envelope, actorUserId: otherId }, { ...envelope, orgId: "other-org" }, { ...envelope, kind: "leads" },
      { ...envelope, key: { ...envelope.key, PK: "ORG#other-org" } }, { ...envelope, key: { ...envelope.key, SK: "LEAD#id" } },
      { ...envelope, key: { ...envelope.key, injected: "raw-key" } }, { PK: "ORG#other-org", SK: "CUSTOMER#id" },
    ].map(value => Buffer.from(JSON.stringify(value)).toString("base64url"))]) {
      expect(() => decodeCursor(cursor, scope)).toThrowError(expect.objectContaining({ statusCode: 400, code: "INVALID_CURSOR" }));
    }
    await expect(service.listLeads(broker, { cursor: first.nextCursor })).rejects.toMatchObject({ code: "INVALID_CURSOR" });
  });

  it("rejects forged property continuation base keys even with a valid asserted actor/index scope", async () => {
    const { service } = setupData();
    const firstActor = identity(), secondActor = identity(otherId);
    const firstOrg = await service.bootstrap(firstActor, {}); await service.bootstrap(secondActor, {});
    const alien = await service.createProperty(secondActor, propertyBody);
    const forged = Buffer.from(JSON.stringify({
      v: 1, actorUserId: actorId, orgId: firstOrg.organization.organizationId, kind: "owner-properties",
      key: { ...keys.property(alien.customerId, alien.propertyId), GSI1PK: `USER#${actorId}`, GSI1SK: `PROPERTY#${alien.propertyId}` },
    })).toString("base64url");
    await expect(service.listProperties(firstActor, { cursor: forged })).rejects.toMatchObject({ statusCode: 400, code: "INVALID_CURSOR" });
  });
});

describe("internal analysis/cache integrity and logical TTL", () => {
  it("persists only validated roof metadata, protects immutable IDs and cache versions", async () => {
    const { service, repository, memory } = setupData();
    const home = identity(); await service.bootstrap(home, {});
    const property = await service.createProperty(home, propertyBody);
    const analysis = await service.saveAnalysis(home, property.propertyId, roof);
    expect(await service.getAnalysis(home, property.propertyId, analysis.analysisId)).toEqual(analysis);
    await expect(repository.putImmutable({ ...analysis, roof: { ...roof, roofAreaSquareMeters: 120 } })).rejects.toMatchObject({ statusCode: 409 });
    expect((await service.getAnalysis(home, property.propertyId, analysis.analysisId)).roof.roofAreaSquareMeters).toBe(90);
    const expires = Math.floor(fixedNow.getTime() / 1000) + 60;
    const cached = await service.saveCache(home, property.propertyId, "fingerprint", 1, expires, roof);
    expect(await service.getCache(home, property.propertyId, "fingerprint", 1)).toEqual(cached);
    await expect(service.saveCache(home, property.propertyId, "fingerprint", 1, expires + 60, roof)).rejects.toMatchObject({ statusCode: 409 });
    await service.saveCache(home, property.propertyId, "fingerprint", 2, expires + 60, roof);
    expect(memory.read(keys.cache(property.propertyId, "fingerprint", 1))?.expiresAtEpochSeconds).toBe(expires);
    for (const input of [{ ...roof, subsidy: 123 }, { ...roof, analysisId: "forged" }, { ...roof, ownerUserId: "forged" }]) {
      await expect(service.saveAnalysis(home, property.propertyId, input)).rejects.toMatchObject({ statusCode: 400 });
    }
  });

  it("rejects invalid cache versions, expiry and bounded payloads before persistence", async () => {
    const { service, memory } = setupData();
    const home = identity(); await service.bootstrap(home, {});
    const property = await service.createProperty(home, propertyBody);
    const now = Math.floor(fixedNow.getTime() / 1000);
    for (const [version, expires] of [[0, now + 60], [1.5, now + 60], [1, now], [1, -1]]) {
      await expect(service.saveCache(home, property.propertyId, "fingerprint", version, expires, roof)).rejects.toMatchObject({ statusCode: 400 });
    }
    await expect(service.saveCache(home, property.propertyId, "fingerprint", 1, now + 60, { ...roof, raw: "x".repeat(16_385) })).rejects.toMatchObject({ statusCode: 400 });
    expect(Array.from(memory.records.values()).some(record => record.entityType === "SOLAR_CACHE")).toBe(false);
  });

  it("ignores expired cache records while DynamoDB TTL deletion is delayed", async () => {
    const { service, repository, memory } = setupData();
    const home = identity(); await service.bootstrap(home, {});
    const property = await service.createProperty(home, propertyBody);
    const expires = Math.floor(fixedNow.getTime() / 1000) + 60;
    await service.saveCache(home, property.propertyId, "fingerprint", 1, expires, roof);
    const atExpiry = new CoreService(repository, { now: () => new Date(expires * 1000) });
    expect(await atExpiry.getCache(home, property.propertyId, "fingerprint", 1)).toBeUndefined();
    expect(memory.read(keys.cache(property.propertyId, "fingerprint", 1))).toBeDefined();
  });

  it("keeps equal cache fingerprints isolated for distinct properties", async () => {
    const { service, memory } = setupData();
    const home = identity(), other = identity(otherId);
    await service.bootstrap(home, {}); await service.bootstrap(other, {});
    const first = await service.createProperty(home, propertyBody);
    const second = await service.createProperty(other, propertyBody);
    const expires = Math.floor(fixedNow.getTime() / 1000) + 60;
    const firstPayload = roof;
    const secondPayload = { ...roof, roofAreaSquareMeters: 110 };
    await service.saveCache(home, first.propertyId, "same-fingerprint", 1, expires, firstPayload);
    await service.saveCache(other, second.propertyId, "same-fingerprint", 1, expires, secondPayload);
    expect((await service.getCache(home, first.propertyId, "same-fingerprint", 1))?.payload).toEqual(firstPayload);
    expect((await service.getCache(other, second.propertyId, "same-fingerprint", 1))?.payload).toEqual(secondPayload);
    expect(memory.read(keys.cache(first.propertyId, "same-fingerprint", 1))).toBeDefined();
    expect(memory.read(keys.cache(second.propertyId, "same-fingerprint", 1))).toBeDefined();
  });

  it("does not reveal another property/tenant's cache and protects analysis ownership", async () => {
    const { service } = setupData();
    const home = identity(), other = identity(otherId);
    await service.bootstrap(home, {}); await service.bootstrap(other, {});
    const property = await service.createProperty(home, propertyBody);
    const alien = await service.createProperty(other, propertyBody);
    const expires = Math.floor(fixedNow.getTime() / 1000) + 60;
    await service.saveCache(home, property.propertyId, "fingerprint", 1, expires, roof);
    expect(await service.getCache(other, alien.propertyId, "fingerprint", 1)).toBeUndefined();
    await expect(service.saveAnalysis(other, property.propertyId, roof)).rejects.toMatchObject(notFound);
    await expect(service.getAnalysis(other, property.propertyId, "any-analysis")).rejects.toMatchObject(notFound);
    await expect(service.saveCache(other, property.propertyId, "new-key", 1, expires, roof)).rejects.toMatchObject(notFound);
  });
});
