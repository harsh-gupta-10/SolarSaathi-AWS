import { describe, expect, it, vi } from "vitest";
import { TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import type { BenefitsService } from "../src/benefits/service";
import type { CoreService, PropertyWriteScope } from "../src/data/service";
import { ApplicationService } from "../src/applications/service";
import { DynamoApplicationRepository, type ApplicationRepository } from "../src/applications/storage";
import type { ApplicationEventV1, SolarApplicationV1 } from "../src/applications/schema";
import type { PolicyPublicationRepository } from "../src/policy/publication-storage";
import type { ActivePolicyBundleV1 } from "../src/policy/publication-types";
import { fixedNow, identity } from "./data-fixtures";

const policyId = `POLICY#${"a".repeat(32)}`;
const factId = `FACT#${"b".repeat(32)}`;
const citation = { schemaVersion: 1 as const, sourceId: `SRC#${"c".repeat(32)}`, sourceRegistryVersion: 2,
  documentId: `DOC#${"d".repeat(32)}`, documentVersion: 1, documentSha256: "e".repeat(64),
  publisherName: "Synthetic official fixture", documentTitle: "Synthetic process fixture",
  sourceUrl: "https://mnre.gov.in/fixture", retrievedAt: fixedNow.toISOString(), locator: { charStart: 1, charEnd: 40 } };
const request = { propertyId: "property-1", analysisId: "analysis-1", policyId,
  demand: { kind: "CONSUMPTION", monthlyConsumptionKwh: 600 },
  generationKwhPerKwYear: 1_500, nominalKw: 3,
  applicantFacts: { country: "IN", customerType: "RESIDENTIAL" } };
const writeScope: PropertyWriteScope = { actorUserId: "actor", actorRole: "BROKER", userRevision: 3,
  orgId: "org-1", organizationKind: "BROKER", organizationRevision: 7, propertyId: "property-1",
  customerId: "customer-1", propertyOwnerUserId: "actor", propertyRevision: 2, locatorRevision: 4 };

function setup() {
  const records = new Map<string, SolarApplicationV1>();
  const events: ApplicationEventV1[] = [];
  const core = { getProperty: vi.fn(async (_identity, propertyId: string) => {
    if (propertyId !== "property-1") throw new Error("foreign property");
    return { propertyId };
  }), getPropertyWriteScope: vi.fn(async (_identity, propertyId: string) => {
    if (propertyId !== "property-1") throw new Error("foreign property");
    return writeScope;
  }) } as unknown as CoreService;
  let processSteps: Array<{ stepId: string; order: number; title: string; description: string;
    required: boolean; evidenceFactIds: string[] }> | undefined = [
    { stepId: "APPLY", order: 1, title: "Apply", description: "Submit a synthetic application fixture.",
      required: true, evidenceFactIds: [factId] },
    { stepId: "VENDOR", order: 2, title: "Select vendor", description: "Choose a synthetic fixture vendor.",
      required: false, evidenceFactIds: [factId] },
  ];
  let selected = true;
  let sourceStatus: "HEALTHY" | "DEGRADED" = "HEALTHY";
  const benefits = { evaluate: vi.fn(async () => ({
    status: "AVAILABLE" as const, system: { nominalKw: 3, actualDcKw: 3.03 }, evaluatedAt: fixedNow.toISOString(),
    result: { decisions: [{ policyId, policyVersion: 1, ruleId: "RULE#fixture", benefitId: "BENEFIT#fixture",
      jurisdiction: "IN", status: selected ? "SELECTED" : "UNKNOWN", countedAmountPaise: selected ? 100_000 : undefined,
      factIds: [factId], citations: [citation], sourceChecks: [{ sourceId: citation.sourceId,
        lastCheckedAt: fixedNow.toISOString(), fresh: true, status: sourceStatus }], lastVerifiedAt: fixedNow.toISOString() }] },
  })) } as unknown as BenefitsService;
  const publication = { getActive: vi.fn(async () => ({
    schemaVersion: 1, policyId, benefitId: "BENEFIT#fixture", version: { version: 1, status: "ACTIVE",
      policyId, verificationStatus: "VERIFIED" }, rule: { policyId, policyVersion: 1,
      ruleId: "RULE#fixture", benefitId: "BENEFIT#fixture", processSteps },
    facts: [{ factId, policyId, policyVersion: 1, verificationStatus: "VERIFIED",
      value: { kind: "TEXT", text: "Synthetic fixture process" }, citation }],
  }) as unknown as ActivePolicyBundleV1) } as unknown as PolicyPublicationRepository;
  const repository: ApplicationRepository = {
    get: async (_propertyId, appId) => records.get(appId),
    list: async () => ({ items: [...records.values()] }),
    create: async (record, event) => { records.set(record.applicationId, record); events.push(event); },
    replace: async (previous, next, event) => {
      if (records.get(previous.applicationId)?.revision !== previous.revision) throw new Error("Conditional conflict");
      records.set(next.applicationId, next); events.push(event);
    },
    listEvents: async () => ({ items: [...events].reverse() }),
  };
  let counter = 0;
  const service = new ApplicationService(core, benefits, publication, repository,
    () => fixedNow, () => `id-${++counter}`);
  return { service, records, events, core, benefits, setProcess: (value: typeof processSteps) => { processSteps = value; },
    setSelected: (value: boolean) => { selected = value; }, setSourceStatus: (value: typeof sourceStatus) => { sourceStatus = value; } };
}

describe("Phase 12 application tracker", () => {
  it("creates a policy-specific snapshot with cited steps and user-reported progress", async () => {
    const fixture = setup();
    const app = await fixture.service.create(identity(), request);
    expect((fixture.benefits.evaluate as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]).not.toHaveProperty("policyId");
    expect(app).toMatchObject({ policyId, policyVersion: 1, processSource: "VERIFIED_POLICY_SNAPSHOT",
      progressSource: "USER_REPORTED", status: "IN_PROGRESS", expectedNextStepId: "APPLY", revision: 1 });
    expect(app.steps).toEqual(expect.arrayContaining([expect.objectContaining({
      stepId: "APPLY", citations: [citation], status: "PENDING", verificationStatus: "USER_REPORTED" })]));
    expect(app.documents).toEqual([]);
    expect(fixture.events).toMatchObject([{ action: "CREATED" }]);
  });

  it("fails closed when a selected benefit lacks a verified process or is not selected", async () => {
    const fixture = setup();
    fixture.setProcess(undefined);
    await expect(fixture.service.create(identity(), request)).rejects.toMatchObject({ code: "PROCESS_TEMPLATE_UNAVAILABLE" });
    fixture.setSelected(false);
    await expect(fixture.service.create(identity(), request)).rejects.toMatchObject({ code: "BENEFIT_NOT_SELECTED" });
    expect(fixture.records.size).toBe(0);
  });

  it("does not create a new official-process snapshot from degraded source health", async () => {
    const fixture = setup();
    fixture.setSourceStatus("DEGRADED");
    await expect(fixture.service.create(identity(), request)).rejects.toMatchObject({ code: "PROCESS_TEMPLATE_UNAVAILABLE" });
    expect(fixture.records.size).toBe(0);
  });

  it("revision-checks transitions, requires correction notes, and derives next policy step", async () => {
    const fixture = setup();
    const app = await fixture.service.create(identity(), request);
    await expect(fixture.service.transition(identity(), app.applicationId, "APPLY", {
      propertyId: app.propertyId, expectedRevision: 2, status: "COMPLETED" })).rejects.toMatchObject({ code: "APPLICATION_CONFLICT" });
    const updated = await fixture.service.transition(identity(), app.applicationId, "APPLY", {
      propertyId: app.propertyId, expectedRevision: 1, status: "COMPLETED", note: "I submitted it" });
    expect(updated).toMatchObject({ revision: 2, status: "IN_PROGRESS", expectedNextStepId: "VENDOR" });
    expect(updated.steps[0]).toMatchObject({ completedAt: fixedNow.toISOString(), verificationStatus: "USER_REPORTED" });
    await expect(fixture.service.transition(identity(), app.applicationId, "APPLY", {
      propertyId: app.propertyId, expectedRevision: 2, status: "IN_PROGRESS" })).rejects.toMatchObject({ code: "CORRECTION_NOTE_REQUIRED" });
    const done = await fixture.service.transition(identity(), app.applicationId, "VENDOR", {
      propertyId: app.propertyId, expectedRevision: 2, status: "NOT_APPLICABLE" });
    expect(done).toMatchObject({ status: "COMPLETED", expectedNextStepId: null });
    expect(fixture.events).toMatchObject([{ action: "CREATED" }, { action: "STEP_TRANSITION", fromStatus: "PENDING", toStatus: "COMPLETED" },
      { action: "STEP_TRANSITION", fromStatus: "PENDING", toStatus: "NOT_APPLICABLE" }]);
  });

  it("records reference, vendor and metadata only with audit, rejecting invalid document content", async () => {
    const fixture = setup();
    const app = await fixture.service.create(identity(), request);
    const detailed = await fixture.service.updateDetails(identity(), app.applicationId, {
      propertyId: app.propertyId, expectedRevision: 1, referenceNumber: "REF-42", vendorName: "Example vendor" });
    expect(detailed).toMatchObject({ referenceNumber: "REF-42", vendorName: "Example vendor", revision: 2 });
    await expect(fixture.service.addDocument(identity(), app.applicationId, { propertyId: app.propertyId,
      expectedRevision: 2, documentType: "BILL", label: "Electricity bill", contentBase64: "secret" }))
      .rejects.toMatchObject({ code: "INVALID_REQUEST" });
    const documented = await fixture.service.addDocument(identity(), app.applicationId, { propertyId: app.propertyId,
      expectedRevision: 2, documentType: "BILL", label: "Electricity bill" });
    expect(documented.documents[0]).toMatchObject({ documentType: "BILL", verificationStatus: "USER_REPORTED" });
    expect(fixture.events.map(event => event.action)).toEqual(["CREATED", "DETAILS_UPDATED", "DOCUMENT_RECORDED"]);
  });

  it("scope-binds listing cursors and checks property access on every read", async () => {
    const fixture = setup();
    const app = await fixture.service.create(identity(), request);
    expect((await fixture.service.list(identity(), app.propertyId)).applications).toHaveLength(1);
    await expect(fixture.service.list(identity(), "other-property")).rejects.toThrow("foreign property");
    await expect(fixture.service.events(identity(), app.propertyId, app.applicationId, 20, "bad"))
      .rejects.toMatchObject({ code: "INVALID_CURSOR" });
  });

  it("suggests only explicit selected-step chat states and never mutates before confirmation", async () => {
    const fixture = setup();
    const app = await fixture.service.create(identity(), request);
    const explicit = await fixture.service.chatUpdate(identity(), app.applicationId, {
      propertyId: app.propertyId, stepId: "APPLY", message: "I submitted my application today." });
    expect(explicit).toMatchObject({ action: "CONFIRMATION_REQUIRED", requiresConfirmation: true,
      messageStored: false, proposedStatus: "COMPLETED", revision: 1 });
    const ambiguous = await fixture.service.chatUpdate(identity(), app.applicationId, {
      propertyId: app.propertyId, stepId: "APPLY", message: "I might submit my application tomorrow." });
    expect(ambiguous.proposedStatus).toBeNull();
    const unrelated = await fixture.service.chatUpdate(identity(), app.applicationId, {
      propertyId: app.propertyId, stepId: "APPLY", message: "I installed the panels today." });
    expect(unrelated.proposedStatus).toBeNull();
    const optional = await fixture.service.chatUpdate(identity(), app.applicationId, {
      propertyId: app.propertyId, stepId: "VENDOR", message: "This step is not applicable." });
    expect(optional.proposedStatus).toBe("NOT_APPLICABLE");
    expect(fixture.records.get(app.applicationId)?.revision).toBe(1);
    expect(fixture.events).toHaveLength(1);
  });

  it("guards current policy, membership, role, ownership and revision in DynamoDB transactions", async () => {
    const send = vi.fn(async (command: unknown) => { expect(command).toBeDefined(); return {}; });
    const repository = new DynamoApplicationRepository("core-table", "policy-table", "ap-south-1", { send } as never);
    const app = await setup().service.create(identity(), request);
    const event: ApplicationEventV1 = { schemaVersion: 1, eventId: "event-id", applicationId: app.applicationId,
      propertyId: app.propertyId, actorId: "actor", occurredAt: fixedNow.toISOString(), action: "CREATED" };
    await repository.create(app, event, 1, writeScope);
    const command = send.mock.calls[0]![0] as TransactWriteCommand;
    expect(command.input.TransactItems?.[0]?.ConditionCheck).toMatchObject({ TableName: "core-table",
      Key: { PK: "ORG#org-1", SK: "PROFILE" },
      ConditionExpression: expect.stringContaining("contains(#members, :actor)"),
      ExpressionAttributeValues: expect.objectContaining({ ":revision": 7, ":actor": "actor" }) });
    expect(command.input.TransactItems?.[1]?.ConditionCheck).toMatchObject({ TableName: "core-table",
      Key: { PK: "USER#actor", SK: "PROFILE" },
      ExpressionAttributeValues: expect.objectContaining({ ":revision": 3, ":role": "BROKER" }) });
    expect(command.input.TransactItems?.[2]?.ConditionCheck).toMatchObject({ TableName: "core-table",
      Key: { PK: "CUSTOMER#customer-1", SK: "PROPERTY#property-1" },
      ExpressionAttributeValues: expect.objectContaining({ ":revision": 2, ":owner": "actor" }) });
    expect(command.input.TransactItems?.[3]?.ConditionCheck).toMatchObject({ TableName: "core-table",
      Key: { PK: "PROPERTY#property-1", SK: "LOCATOR" },
      ExpressionAttributeValues: expect.objectContaining({ ":revision": 4, ":customer": "customer-1" }) });
    expect(command.input.TransactItems?.[4]?.ConditionCheck).toMatchObject({ TableName: "policy-table",
      ConditionExpression: expect.stringContaining("activeVersion = :version") });
    await repository.replace(app, { ...app, revision: 2 }, { ...event, eventId: "event-id-2", action: "STEP_TRANSITION" }, writeScope);
    const update = send.mock.calls[1]![0] as TransactWriteCommand;
    expect(update.input.TransactItems?.slice(0, 4).every(item => item.ConditionCheck?.TableName === "core-table")).toBe(true);
    expect(update.input.TransactItems?.[4]?.Put?.ConditionExpression).toContain("revision = :revision");
    expect(update.input.TransactItems?.[5]?.Put?.Item).toMatchObject({ entityType: "APPLICATION_EVENT" });
  });
});
