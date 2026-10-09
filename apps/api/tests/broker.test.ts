import { TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyEvent } from "aws-lambda";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PolicyFinancialsService } from "../src/financials/policy-service";
import { FinancialsService } from "../src/financials/service";
import { BrokerService } from "../src/broker/service";
import { BrokerStore } from "../src/broker/store";
import { createBrokerHandler } from "../src/handlers/broker";
import { keys } from "../src/data/keys";
import { normalizeManual } from "../src/roof/normalize";
import { fixedNow, identity, setupData, type MemoryExecutor } from "./data-fixtures";
import { context, request as apiRequest } from "./auth-fixtures";

const actor = identity(undefined, "BROKER");
const request = (propertyId: string, analysisId: string) => ({ propertyId, analysisId,
  demand: { kind: "CONSUMPTION", monthlyConsumptionKwh: 600 }, generationKwhPerKwYear: 1_500, nominalKw: 3,
  financialInputs: { grossSystemCostRupees: 200_000, selfConsumptionFraction: 0.7,
    importTariffRupeesPerKwh: 10, exportRateRupeesPerKwh: 3, annualMaintenanceRupees: 5_000 },
  applicantFacts: { country: "IN", state: "MH", customerType: "RESIDENTIAL" },
});
function financials(base: Awaited<ReturnType<FinancialsService["estimate"]>>) {
  return { schemaVersion: 1, source: "DETERMINISTIC_POLICY_FINANCIAL_V1", status: "UNAVAILABLE", requestId: "r1",
    propertyId: base.propertyId, analysisId: base.analysisId, roofSource: base.roofSource, system: base.system,
    systemDesignWarnings: base.systemDesignWarnings, base: base.financial,
    benefits: { schemaVersion: 1, source: "DETERMINISTIC_BENEFIT_STACK_V1", status: "UNAVAILABLE",
      propertyId: base.propertyId, analysisId: base.analysisId,
      system: { nominalKw: base.system.nominalKw, actualDcKw: base.system.actualDcKw },
      reasonCodes: ["NO_ACTIVE_VERIFIED_RULES"] },
    reasonCodes: ["NO_ACTIVE_VERIFIED_RULES"] };
}
async function setup() {
  const data = setupData();
  await data.service.bootstrap(actor, { organizationName: "Solar practice" });
  const customer = await data.service.createCustomer(actor, { name: "Client One", email: "private@example.com" });
  const property = await data.service.createProperty(actor, { customerId: customer.customerId,
    label: "Roof", address: "123 Example Road, Mumbai" });
  const analysis = await data.service.saveManualRoof(actor, property.propertyId,
    normalizeManual({ roofAreaSquareMeters: 100, lengthMeters: 10, widthMeters: 10 }, fixedNow.toISOString()));
  const store = new BrokerStore("test-core-table", data.memory.execute);
  const params = request(property.propertyId, analysis.analysisId);
  const base = await new FinancialsService(data.service).estimate(actor, { propertyId: params.propertyId,
    analysisId: params.analysisId, demand: params.demand, generationKwhPerKwYear: params.generationKwhPerKwYear,
    nominalKw: params.nominalKw, financialInputs: params.financialInputs }, "r1");
  const policy = { estimate: async () => financials(base) } as unknown as PolicyFinancialsService;
  const broker = new BrokerService(data.service, data.repository, store, policy,
    () => fixedNow, () => "proposal-id");
  return { ...data, store, broker, customer, property, analysis, policy };
}
function proposalTransactions(memory: MemoryExecutor) {
  return memory.commands.filter(command => command instanceof TransactWriteCommand)
    .filter(command => command.input.TransactItems?.some(item => item.Put?.Item?.entityType === "BROKER_PROPOSAL"));
}

describe("broker proposal snapshots", () => {
  it("previews then saves a dated, immutable base-only snapshot without applicant facts or contact data", async () => {
    const { broker, memory, customer, property, analysis } = await setup();
    const body = request(property.propertyId, analysis.analysisId);
    const preview = await broker.preview(actor, { customerId: customer.customerId, ...body }, "r1");
    expect(preview.proposal).toMatchObject({ status: "UNAVAILABLE", documentStatus: "NOT_GENERATED",
      financials: { benefits: { status: "UNAVAILABLE" } } });
    const saved = await broker.save(actor, customer.customerId, body, "r1");
    expect(saved.proposal).toMatchObject({ customerId: customer.customerId, status: "UNAVAILABLE",
      policyStatus: "UNAVAILABLE", freshnessStatus: "RECHECK_REQUIRED", policyVersionIds: [],
      documentStatus: "NOT_GENERATED" });
    const transaction = proposalTransactions(memory)[0]!;
    expect(transaction.input.TransactItems).toHaveLength(7);
    expect(transaction.input.TransactItems!.slice(0, 6).every(item => item.ConditionCheck?.ConditionExpression?.startsWith("#revision = :revision"))).toBe(true);
    expect(transaction.input.TransactItems!.slice(0, 6).map(item => item.ConditionCheck?.Key?.PK)).toEqual([
      `USER#${actor.profile.userId}`, expect.stringMatching(/^ORG#/), expect.stringMatching(/^ORG#/),
      expect.stringMatching(/^CUSTOMER#/), `PROPERTY#${property.propertyId}`, `PROPERTY#${property.propertyId}`,
    ]);
    expect(transaction.input.TransactItems![1]!.ConditionCheck?.ConditionExpression).toContain("contains(#members, :actor)");
    const record = transaction.input.TransactItems!.at(-1)!.Put!.Item!;
    expect(record.snapshotJson).not.toMatch(/private@example\.com|applicantFacts|123 Example Road|presigned|s3:\/\//);
    const detail = await broker.get(actor, customer.customerId, saved.proposal.proposalId, "r2");
    expect(detail.proposal.financials).toEqual(preview.proposal.financials);
    const listed = await broker.list(actor, customer.customerId, { limit: 10 }, "r3");
    expect(listed.proposals).toHaveLength(1);
    expect(listed.proposals[0]).not.toHaveProperty("financials");
    expect(await broker.listDesigns(actor, property.propertyId, { limit: 10 }, "r4")).toMatchObject({ designs: [] });
  });

  it("rejects a different customer, homeowner role and revoked broker membership", async () => {
    const { broker, service, memory, property, analysis } = await setup();
    const other = await service.createCustomer(actor, { name: "Client Two" });
    const body = request(property.propertyId, analysis.analysisId);
    await expect(broker.preview(actor, { customerId: other.customerId, ...body }, "r1"))
      .rejects.toMatchObject({ statusCode: 404 });
    await expect(broker.save(actor, other.customerId, body, "r1")).rejects.toMatchObject({ statusCode: 404 });
    await expect(broker.list(identity(), other.customerId, {}, "r1")).rejects.toMatchObject({ statusCode: 403 });
    const orgId = memory.read(keys.user(actor.profile.userId))!.orgId as string;
    memory.seed({ ...memory.read(keys.organization(orgId))!, ...keys.organization(orgId), memberUserIds: ["other-user"], ownerUserId: "other-user", revision: 2 });
    await expect(broker.list(actor, other.customerId, {}, "r1")).rejects.toMatchObject({ statusCode: 403 });
  });

  it("condition-checks current membership at save even if a writer fails to bump the revision", async () => {
    const { broker, memory, customer, property, analysis } = await setup();
    const orgId = memory.read(keys.user(actor.profile.userId))!.orgId as string;
    memory.beforeTransaction = () => {
      memory.beforeTransaction = undefined;
      memory.seed({ ...memory.read(keys.organization(orgId))!, ...keys.organization(orgId), memberUserIds: ["other-user"], ownerUserId: "other-user", revision: 1 });
    };
    await expect(broker.save(actor, customer.customerId, request(property.propertyId, analysis.analysisId), "r1"))
      .rejects.toMatchObject({ statusCode: 409, code: "DATABASE_CONFLICT" });
    expect(proposalTransactions(memory)).toHaveLength(1);
  });

  it("rejects forged proposal cursors and corrupted stored snapshot bytes", async () => {
    const { broker, memory, customer, property, analysis } = await setup();
    const saved = await broker.save(actor, customer.customerId, request(property.propertyId, analysis.analysisId), "r1");
    await expect(broker.list(actor, customer.customerId, { cursor: "forged" }, "r2"))
      .rejects.toMatchObject({ statusCode: 400, code: "INVALID_CURSOR" });
    const key = { PK: `CUSTOMER#${customer.customerId}`, SK: `PROPOSAL#${saved.proposal.proposalId}` };
    memory.seed({ ...memory.read(key)!, ...key, snapshotJson: '{"status":"AVAILABLE"}' });
    await expect(broker.get(actor, customer.customerId, saved.proposal.proposalId, "r3"))
      .rejects.toMatchObject({ statusCode: 503, code: "DATABASE_UNAVAILABLE" });
    const tampered = structuredClone(saved.proposal.financials);
    tampered.base.annualRows[0]!.netCashFlowRupees += 1;
    const snapshotJson = JSON.stringify(tampered);
    memory.seed({ ...memory.read(key)!, ...key, snapshotJson,
      snapshotSha256: BrokerStore.snapshotHash(snapshotJson) });
    await expect(broker.get(actor, customer.customerId, saved.proposal.proposalId, "r4"))
      .rejects.toMatchObject({ statusCode: 503, code: "DATABASE_UNAVAILABLE" });
  });

  it("lists only current property-scoped design records after broker authorization", async () => {
    const { broker, memory, property, analysis } = await setup();
    const orgId = memory.read(keys.user(actor.profile.userId))!.orgId as string;
    const saved = { PK: `PROPERTY#${property.propertyId}`, SK: "DESIGN#concept-one",
      entityType: "USER_DESIGN", schemaVersion: 1, designId: "concept-one", propertyId: property.propertyId,
      analysisId: analysis.analysisId, ownerUserId: actor.profile.userId, orgId, candidateId: "garden",
      fingerprint: "a".repeat(64), imageS3Key: `generated/${property.propertyId}/${analysis.analysisId}/concept-one.png`,
      createdAt: fixedNow.toISOString(), expiresAtEpochSeconds: Math.floor(fixedNow.getTime() / 1_000) + 3_600 };
    memory.seed(saved);
    expect((await broker.listDesigns(actor, property.propertyId, { limit: 10 }, "r1")).designs)
      .toMatchObject([{ designId: "concept-one", imageStatus: "READY", visualAccuracy: "INSPIRATIONAL_ONLY" }]);
    await expect(broker.listDesigns(actor, property.propertyId, { cursor: "forged" }, "r2"))
      .rejects.toMatchObject({ statusCode: 400, code: "INVALID_CURSOR" });
    memory.seed({ ...saved, ownerUserId: "foreign-owner" });
    await expect(broker.listDesigns(actor, property.propertyId, { limit: 10 }, "r3"))
      .rejects.toMatchObject({ statusCode: 404 });
  });
});

describe("broker lead stages", () => {
  it("moves a lead forward with an immutable audit event and rejects stale or backward transitions", async () => {
    const { broker, service, memory } = await setup();
    const lead = await service.createLead(actor, { name: "New enquiry", phone: "+919876543210" });
    expect(lead).toMatchObject({ status: "NEW", revision: 1 });
    const updated = await broker.updateLead(actor, lead.leadId, { expectedRevision: 1, status: "CONTACTED" }, "r1");
    expect(updated.lead).toMatchObject({ status: "CONTACTED", revision: 2 });
    const orgId = memory.read(keys.user(actor.profile.userId))!.orgId as string;
    expect(memory.read(keys.lead(orgId, lead.leadId))).toMatchObject({ status: "CONTACTED", revision: 2 });
    expect(memory.read({ PK: `ORG#${orgId}`, SK: `LEAD_EVENT#${lead.leadId}#000000000002` }))
      .toMatchObject({ previousStatus: "NEW", status: "CONTACTED", actorUserId: actor.profile.userId });
    await expect(broker.updateLead(actor, lead.leadId, { expectedRevision: 1, status: "PROPOSAL" }, "r2"))
      .rejects.toMatchObject({ statusCode: 409, code: "LEAD_REVISION_CONFLICT" });
    await expect(broker.updateLead(actor, lead.leadId, { expectedRevision: 2, status: "NEW" }, "r3"))
      .rejects.toMatchObject({ statusCode: 400 });
    await broker.updateLead(actor, lead.leadId, { expectedRevision: 2, status: "LOST" }, "r4");
    await expect(broker.updateLead(actor, lead.leadId, { expectedRevision: 3, status: "PROPOSAL" }, "r5"))
      .rejects.toMatchObject({ statusCode: 409, code: "INVALID_LEAD_TRANSITION" });
  });

  it("rejects revoked membership at the lead write transaction", async () => {
    const { broker, service, memory } = await setup();
    const lead = await service.createLead(actor, { name: "New enquiry" });
    const orgId = memory.read(keys.user(actor.profile.userId))!.orgId as string;
    memory.beforeTransaction = () => {
      memory.beforeTransaction = undefined;
      memory.seed({ ...memory.read(keys.organization(orgId))!, ...keys.organization(orgId),
        memberUserIds: ["other-user"], ownerUserId: "other-user" });
    };
    await expect(broker.updateLead(actor, lead.leadId, { expectedRevision: 1, status: "CONTACTED" }, "r1"))
      .rejects.toMatchObject({ statusCode: 409, code: "DATABASE_CONFLICT" });
    expect(memory.read(keys.lead(orgId, lead.leadId))).toMatchObject({ status: "NEW", revision: 1 });
  });
});

afterEach(() => { vi.unstubAllEnvs(); });
describe("broker HTTP routes", () => {
  it("routes preview and lead patch with broker identity and rejects wrong methods before reading identity", async () => {
    const data = await setup();
    vi.stubEnv("ENVIRONMENT", "test"); vi.stubEnv("LOG_LEVEL", "error");
    vi.stubEnv("CORE_TABLE_NAME", "test-core-table"); vi.stubEnv("POLICY_TABLE_NAME", "test-policy-table");
    vi.stubEnv("AWS_REGION", "ap-south-1");
    const resolveIdentity = async () => ({ sub: actor.profile.userId, groups: ["BROKER"], attributes: [
      { Name: "sub", Value: actor.profile.userId }, { Name: "email", Value: actor.profile.email },
      { Name: "email_verified", Value: "true" }, { Name: "name", Value: actor.profile.name },
    ] });
    const handler = createBrokerHandler({ resolveIdentity, createCore: () => data.repository,
      createStore: () => data.store, createFinancials: () => data.policy, now: () => fixedNow,
      createId: () => "proposal-id" });
    const invoke = (path: string, method: string, body?: unknown) => handler({ ...apiRequest(),
      resource: path, path, httpMethod: method, body: body === undefined ? null : JSON.stringify(body),
      headers: { ...apiRequest().headers, "content-type": "application/json" },
    } as APIGatewayProxyEvent, context);
    const preview = await invoke("/v1/broker/proposals/preview", "POST", {
      customerId: data.customer.customerId, ...request(data.property.propertyId, data.analysis.analysisId),
    });
    expect(preview.statusCode).toBe(200);
    expect(JSON.parse(preview.body).proposal).toMatchObject({ documentStatus: "NOT_GENERATED", status: "UNAVAILABLE" });
    const lead = await data.service.createLead(actor, { name: "Phone enquiry" });
    const changed = await invoke(`/v1/broker/leads/${lead.leadId}`, "PATCH", { expectedRevision: 1, status: "CONTACTED" });
    expect(changed.statusCode).toBe(200);
    expect(JSON.parse(changed.body).lead).toMatchObject({ status: "CONTACTED", revision: 2 });
    expect((await invoke("/v1/broker/proposals/preview", "GET")).statusCode).toBe(405);
    expect((await invoke("/v1/broker/unknown", "GET")).statusCode).toBe(404);
  });
});
