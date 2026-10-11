import { describe, expect, it, vi } from "vitest";
import { TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import type { BenefitsService } from "../src/benefits/service";
import type { CoreService, PropertyWriteScope } from "../src/data/service";
import { ApplicationService } from "../src/applications/service";
import { DynamoApplicationRepository, type ApplicationRepository } from "../src/applications/storage";
import type { ApplicationEventV1, SolarApplicationV1 } from "../src/applications/schema";
import { documentObjectKey, matchesSignature, type ApplicationDocumentStore, type StoredObjectInfo } from "../src/applications/documents";
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

const PDF_HEAD = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);
const sha = "f".repeat(64);

function fakeStore() {
  const objects = new Map<string, StoredObjectInfo>();
  const deleted: string[] = [];
  const store: ApplicationDocumentStore = {
    uploadTicket: vi.fn(async (key: string, contentType, _size, now: Date) => ({ url: `https://upload.example/${key}`,
      method: "PUT" as const, headers: { "content-type": contentType }, expiresAt: new Date(now.getTime() + 300_000).toISOString() })),
    inspect: async key => objects.get(key),
    downloadUrl: vi.fn(async key => `https://download.example/${key}`),
    delete: async key => { objects.delete(key); deleted.push(key); },
  };
  return { store, objects, deleted };
}

function setup(withStore = true) {
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
  const documents = fakeStore();
  const service = new ApplicationService(core, benefits, publication, repository,
    () => fixedNow, () => `id-${++counter}`, withStore ? documents.store : undefined);
  return { service, documents, records, events, core, benefits, setProcess: (value: typeof processSteps) => { processSteps = value; },
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
    const { application: documented, upload } = await fixture.service.addDocument(identity(), app.applicationId, {
      propertyId: app.propertyId, expectedRevision: 2, documentType: "BILL", label: "Electricity bill" });
    expect(upload).toBeUndefined();
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

describe("application document uploads", () => {
  const file = { contentType: "application/pdf", sizeBytes: 1_024, sha256: sha };

  async function pending(fixture = setup()) {
    const app = await fixture.service.create(identity(), request);
    const added = await fixture.service.addDocument(identity(), app.applicationId, { propertyId: app.propertyId,
      expectedRevision: 1, documentType: "BILL", label: "Electricity bill", file });
    const document = added.application.documents[0]!;
    return { fixture, app: added.application, document, upload: added.upload };
  }

  it("rejects unsupported types, oversize files and malformed hashes before writing", async () => {
    const fixture = setup();
    const app = await fixture.service.create(identity(), request);
    const base = { propertyId: app.propertyId, expectedRevision: 1, documentType: "BILL", label: "Bill" };
    for (const bad of [{ ...file, contentType: "text/html" }, { ...file, sizeBytes: 10 * 1024 * 1024 + 1 },
      { ...file, sizeBytes: 0 }, { ...file, sha256: "not-a-hash" }, { ...file, fileName: "../../etc/passwd" }]) {
      await expect(fixture.service.addDocument(identity(), app.applicationId, { ...base, file: bad }))
        .rejects.toMatchObject({ code: "INVALID_REQUEST" });
    }
    expect(fixture.records.get(app.applicationId)?.revision).toBe(1);
  });

  it("fails closed when document storage is not configured", async () => {
    const fixture = setup(false);
    const app = await fixture.service.create(identity(), request);
    await expect(fixture.service.addDocument(identity(), app.applicationId, { propertyId: app.propertyId,
      expectedRevision: 1, documentType: "BILL", label: "Bill", file })).rejects.toMatchObject({ code: "DOCUMENT_STORAGE_NOT_CONFIGURED" });
    expect(fixture.records.get(app.applicationId)?.documents).toEqual([]);
  });

  it("records a pending file under a server-built key and returns a short-lived upload ticket", async () => {
    const { app, document, upload } = await pending();
    expect(document.file).toMatchObject({ status: "PENDING_UPLOAD", contentType: "application/pdf", sizeBytes: 1_024,
      sha256Reported: sha, objectKey: documentObjectKey(app.createdByUserId, app.applicationId, document.documentId) });
    expect(document.file?.objectKey).toMatch(/^applications\/[a-f0-9]{32}\//);
    expect(upload).toMatchObject({ method: "PUT", headers: { "content-type": "application/pdf" } });
    expect(Date.parse(upload!.expiresAt) - fixedNow.getTime()).toBe(300_000);
  });

  it("confirms only an object with the declared size, type and signature", async () => {
    const { fixture, app, document } = await pending();
    const key = document.file!.objectKey;
    const action = { propertyId: app.propertyId, expectedRevision: app.revision };
    await expect(fixture.service.confirmDocument(identity(), app.applicationId, document.documentId, action))
      .rejects.toMatchObject({ code: "UPLOAD_NOT_FOUND" });
    // A missing upload can be retried with a fresh link for the same entry, without changing the record.
    const reissued = await fixture.service.confirmDocument(identity(), app.applicationId, document.documentId, { ...action, reissueUpload: true });
    expect(reissued.upload?.url).toContain(key);
    expect(reissued.application.revision).toBe(app.revision);
    fixture.documents.objects.set(key, { sizeBytes: 999, contentType: "application/pdf", head: PDF_HEAD });
    await expect(fixture.service.confirmDocument(identity(), app.applicationId, document.documentId, action))
      .rejects.toMatchObject({ code: "UPLOAD_MISMATCH" });
    expect(fixture.documents.deleted).toEqual([key]);
    fixture.documents.objects.set(key, { sizeBytes: 1_024, contentType: "application/pdf", head: new Uint8Array([0x3c, 0x68]) });
    await expect(fixture.service.confirmDocument(identity(), app.applicationId, document.documentId, action))
      .rejects.toMatchObject({ code: "UPLOAD_MISMATCH" });
    fixture.documents.objects.set(key, { sizeBytes: 1_024, contentType: "application/pdf", head: PDF_HEAD });
    await expect(fixture.service.confirmDocument(identity(), app.applicationId, document.documentId,
      { ...action, expectedRevision: action.expectedRevision + 5 })).rejects.toMatchObject({ code: "APPLICATION_CONFLICT" });
    const confirmed = await fixture.service.confirmDocument(identity(), app.applicationId, document.documentId, action);
    expect(confirmed.upload).toBeUndefined();
    expect(confirmed.application.documents[0]!.file).toMatchObject({ status: "UPLOADED", uploadedAt: fixedNow.toISOString(),
      expiresAt: new Date(fixedNow.getTime() + 365 * 86_400_000).toISOString() });
    expect(fixture.events.at(-1)).toMatchObject({ action: "DOCUMENT_UPLOADED", documentId: document.documentId });
    const download = await fixture.service.documentDownload(identity(), app.propertyId, app.applicationId, document.documentId);
    expect(download.url).toBe(`https://download.example/${key}`);
  });

  it("does not sign downloads for pending files or other properties", async () => {
    const { fixture, app, document } = await pending();
    await expect(fixture.service.documentDownload(identity(), app.propertyId, app.applicationId, document.documentId))
      .rejects.toMatchObject({ code: "FILE_NOT_UPLOADED" });
    await expect(fixture.service.documentDownload(identity(), "other-property", app.applicationId, document.documentId))
      .rejects.toThrow("foreign property");
    await expect(fixture.service.confirmDocument(identity(), app.applicationId, document.documentId,
      { propertyId: "other-property", expectedRevision: app.revision })).rejects.toThrow("foreign property");
    expect(fixture.documents.store.downloadUrl).not.toHaveBeenCalled();
  });

  it("deletes the stored object and its metadata with an audit event", async () => {
    const { fixture, app, document } = await pending();
    await expect(fixture.service.deleteDocument(identity(), app.applicationId, "missing-doc",
      { propertyId: app.propertyId, expectedRevision: app.revision })).rejects.toMatchObject({ code: "DOCUMENT_NOT_FOUND" });
    const next = await fixture.service.deleteDocument(identity(), app.applicationId, document.documentId,
      { propertyId: app.propertyId, expectedRevision: app.revision });
    expect(next.documents).toEqual([]);
    expect(fixture.documents.deleted).toEqual([document.file!.objectKey]);
    expect(fixture.events.at(-1)).toMatchObject({ action: "DOCUMENT_DELETED", documentId: document.documentId });
  });

  it("finishes removing the record on the latest revision when it changed while the file was being deleted", async () => {
    const { fixture, app, document } = await pending();
    const originalDelete = fixture.documents.store.delete;
    fixture.documents.store.delete = async key => {
      await originalDelete(key);
      // Another tab saves a step at the same moment.
      const record = fixture.records.get(app.applicationId)!;
      fixture.records.set(app.applicationId, { ...record, revision: record.revision + 1 });
    };
    const next = await fixture.service.deleteDocument(identity(), app.applicationId, document.documentId,
      { propertyId: app.propertyId, expectedRevision: app.revision });
    expect(next.documents).toEqual([]);
    expect(next.revision).toBe(app.revision + 2);
    expect(fixture.documents.deleted).toEqual([document.file!.objectKey]);
  });

  it("records nothing when the upload link cannot be signed", async () => {
    const fixture = setup();
    const app = await fixture.service.create(identity(), request);
    (fixture.documents.store.uploadTicket as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("signing failed"));
    await expect(fixture.service.addDocument(identity(), app.applicationId, { propertyId: app.propertyId,
      expectedRevision: 1, documentType: "BILL", label: "Electricity bill", file })).rejects.toThrow("signing failed");
    expect(fixture.records.get(app.applicationId)!.documents).toEqual([]);
    expect(fixture.events.map(event => event.action)).toEqual(["CREATED"]);
  });

  it("checks file signatures by declared type", () => {
    expect(matchesSignature("application/pdf", PDF_HEAD)).toBe(true);
    expect(matchesSignature("image/png", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true);
    expect(matchesSignature("image/jpeg", new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe(true);
    expect(matchesSignature("image/png", PDF_HEAD)).toBe(false);
    expect(matchesSignature("application/pdf", new Uint8Array([0x25]))).toBe(false);
  });
});

describe("S3 application document store", () => {
  it("signs content type and length into a five-minute upload URL and downloads as attachment", async () => {
    const { S3Client } = await import("@aws-sdk/client-s3");
    const { S3ApplicationDocumentStore } = await import("../src/applications/documents");
    const client = new S3Client({ region: "ap-south-1", requestChecksumCalculation: "WHEN_REQUIRED",
      credentials: { accessKeyId: "AKIDEXAMPLE", secretAccessKey: "secret-example" } });
    const store = new S3ApplicationDocumentStore("documents-bucket", "ap-south-1", client);
    const ticket = await store.uploadTicket("applications/abc/app/doc", "application/pdf", 2_048, fixedNow);
    const url = new URL(ticket.url);
    expect(url.searchParams.get("X-Amz-Expires")).toBe("300");
    expect(url.searchParams.get("X-Amz-SignedHeaders")?.split(";")).toEqual(expect.arrayContaining(["content-length", "content-type", "host"]));
    expect(url.searchParams.has("x-amz-checksum-crc32")).toBe(false);
    expect(ticket.headers).toEqual({ "content-type": "application/pdf" });
    const download = new URL(await store.downloadUrl("applications/abc/app/doc", "application/pdf"));
    expect(download.searchParams.get("response-content-disposition")).toBe("attachment");
  });
});

describe("application document routes", () => {
  it("routes document confirm, download and delete with the expected methods only", async () => {
    const { createApplicationsHandler } = await import("../src/handlers/applications");
    const handler = createApplicationsHandler({ resolveIdentity: vi.fn(async () => { throw new Error("not reached"); }) as never });
    const call = (httpMethod: string, path: string) => handler({ httpMethod, path, headers: {}, body: null,
      requestContext: {} } as never, { awsRequestId: "req-1" } as never);
    const code = async (httpMethod: string, path: string) => (await call(httpMethod, path)).statusCode;
    expect(await code("POST", "/v1/applications/app-1/documents/doc-1/download")).toBe(405);
    expect(await code("GET", "/v1/applications/app-1/documents/doc-1/confirm")).toBe(405);
    expect(await code("POST", "/v1/applications/app-1/documents/doc-1")).toBe(405);
    expect(await code("GET", "/v1/applications/app-1/documents/doc-1/unknown")).toBe(404);
    for (const [method, path] of [["GET", "/v1/applications/app-1/documents/doc-1/download"],
      ["POST", "/v1/applications/app-1/documents/doc-1/confirm"], ["DELETE", "/v1/applications/app-1/documents/doc-1"]]) {
      expect([404, 405]).not.toContain(await code(method!, path!));
    }
  });
});
