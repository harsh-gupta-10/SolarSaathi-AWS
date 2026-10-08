import type { APIGatewayProxyEvent } from "aws-lambda";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PolicyDocumentV1, PolicySourceV1 } from "@solarsaathi/policy";
import { createPolicyHandler } from "../src/handlers/policy";
import { PolicyService } from "../src/policy/service";
import { DynamoPolicyRepository, type PolicyObjectStore, type PolicyRepository } from "../src/policy/storage";
import { context, request, sub, userOutput } from "./auth-fixtures";
import { fixedNow } from "./data-fixtures";

const sourceRequest = {
  name: "Ministry of New and Renewable Energy", publisherName: "MNRE", jurisdiction: "IN",
  sourceType: "MNRE", canonicalUrl: "https://mnre.gov.in/solar/", crawlFrequency: "WEEKLY",
  freshnessWindowHours: 168,
};
const html = Buffer.from("<html><head><title>Solar guidance</title></head><body><h1 id='solar'>Solar guidance</h1><p>Official document text.</p></body></html>");

class MemoryPolicyRepository implements PolicyRepository {
  readonly sources = new Map<string, PolicySourceV1>();
  readonly documents = new Map<string, PolicyDocumentV1>();
  async getSource(id: string) { return this.sources.get(id); }
  async putSource(source: PolicySourceV1) {
    if (this.sources.has(source.sourceId)) throw Object.assign(new Error("duplicate"), { name: "ConditionalCheckFailedException" });
    this.sources.set(source.sourceId, source);
  }
  async getDocument(sourceId: string, documentId: string, version: number) {
    return this.documents.get(`${sourceId}:${documentId}:${version}`);
  }
  async putDocument(document: PolicyDocumentV1) {
    const key = `${document.sourceId}:${document.documentId}:${document.version}`;
    if (this.documents.has(key)) throw Object.assign(new Error("duplicate"), { name: "ConditionalCheckFailedException" });
    this.documents.set(key, document);
  }
}

class MemoryPolicyObjects implements PolicyObjectStore {
  readonly objects = new Map<string, { body: Uint8Array; contentType: string; hash: string }>();
  writes = 0;
  async putImmutable(key: string, body: Uint8Array, contentType: string, hash: string) {
    const existing = this.objects.get(key);
    if (existing && (Buffer.compare(Buffer.from(existing.body), Buffer.from(body)) !== 0 || existing.hash !== hash)) {
      throw new Error("object overwrite attempted");
    }
    if (!existing) { this.objects.set(key, { body, contentType, hash }); this.writes++; }
    return "immutable-version-1";
  }
}

function documentRequest(sourceId: string, content = html) {
  return { sourceId, version: 1, title: "Solar guidance", documentType: "OFFICIAL_WEBPAGE",
    mimeType: "text/html", contentBase64: content.toString("base64") };
}

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.stubEnv("ENVIRONMENT", "test"); vi.stubEnv("LOG_LEVEL", "info"); vi.stubEnv("AWS_REGION", "ap-south-1");
  vi.stubEnv("POLICY_TABLE_NAME", "test-policy-table"); vi.stubEnv("POLICY_DOCUMENT_BUCKET", "test-policy-documents");
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe("private policy source and document ingestion", () => {
  it("registers only an exact official URL as a proposed, disabled, idempotent source", async () => {
    const repo = new MemoryPolicyRepository(); const objects = new MemoryPolicyObjects();
    const service = new PolicyService(repo, objects, () => fixedNow);
    const first = await service.registerSource(sourceRequest, "req");
    expect(first).toMatchObject({ created: true, source: { schemaVersion: 1, registryVersion: 1,
      registryStatus: "PROPOSED", enabled: false, authorityTier: 1,
      canonicalUrl: "https://mnre.gov.in/solar/", allowedHosts: ["mnre.gov.in"] } });
    expect((await service.registerSource(sourceRequest, "req")).created).toBe(false);
    expect(repo.sources.size).toBe(1);
    for (const url of ["http://mnre.gov.in/solar/", "https://mnre.gov.in.evil.test/solar/",
      "https://user@mnre.gov.in/solar/", "https://127.0.0.1/solar/", "https://pmsuryaghar.gov.in/"]) {
      await expect(service.registerSource({ ...sourceRequest, canonicalUrl: url }, "req"))
        .rejects.toMatchObject({ statusCode: 400 });
    }
    await expect(service.registerSource({ ...sourceRequest, allowedHosts: ["evil.test"] }, "req"))
      .rejects.toMatchObject({ statusCode: 400 });
    await expect(service.registerSource({ ...sourceRequest, name: "changed" }, "req"))
      .rejects.toMatchObject({ statusCode: 409 });
  });

  it("archives raw and extracted chunks in immutable versioned objects, then writes metadata once", async () => {
    const repo = new MemoryPolicyRepository(); const objects = new MemoryPolicyObjects();
    const service = new PolicyService(repo, objects, () => fixedNow);
    const { source } = await service.registerSource(sourceRequest, "req");
    const first = await service.ingestDocument(documentRequest(source.sourceId), "req");
    expect(first).toMatchObject({ created: true, document: { sourceId: source.sourceId,
      sourceRegistryVersion: 1, version: 1, mimeType: "text/html", chunkCount: 1,
      s3VersionId: "immutable-version-1", derivedS3VersionId: "immutable-version-1" } });
    expect(first.document.s3Key).toMatch(/^raw\/[a-f0-9]+\/[a-f0-9]+\/v00000001\/[a-f0-9]{64}\.html$/);
    expect(first.document.derivedS3Key).toMatch(/^derived\/[a-f0-9]+\/[a-f0-9]+\/v00000001\/[a-f0-9]{64}\.json$/);
    const extracted = JSON.parse(Buffer.from(objects.objects.get(first.document.derivedS3Key!)!.body).toString("utf8"));
    expect(extracted.normalizedText).toContain("Official document text.");
    expect(extracted.chunks[0]).toMatchObject({ sourceId: source.sourceId, documentId: first.document.documentId,
      documentVersion: 1, locator: { charStart: expect.any(Number), charEnd: expect.any(Number) } });
    expect((await service.ingestDocument(documentRequest(source.sourceId), "req")).created).toBe(false);
    expect(objects.writes).toBe(2);
    expect(repo.documents.size).toBe(1);
    await expect(service.ingestDocument(documentRequest(source.sourceId,
      Buffer.from("<html><body><p>Conflicting revision.</p></body></html>")), "req"))
      .rejects.toMatchObject({ statusCode: 409 });
    expect(objects.writes).toBe(2);
  });

  it("keeps separate same-host document URL series under one official source", async () => {
    const repo = new MemoryPolicyRepository(); const objects = new MemoryPolicyObjects();
    const service = new PolicyService(repo, objects, () => fixedNow);
    const { source } = await service.registerSource(sourceRequest, "req");
    const first = await service.ingestDocument(documentRequest(source.sourceId), "req");
    const circular = await service.ingestDocument({ ...documentRequest(source.sourceId),
      documentUrl: "https://mnre.gov.in/solar/circular-2026.html", title: "Circular" }, "req");
    expect(circular.document.documentId).not.toBe(first.document.documentId);
    expect(circular.document.canonicalUrl).toBe("https://mnre.gov.in/solar/circular-2026.html");
    expect(repo.documents.size).toBe(2);
    for (const documentUrl of ["https://energy.maharashtra.gov.in/solar/circular.pdf",
      "https://mnre.gov.in.evil.test/solar/circular.pdf", "http://mnre.gov.in/solar/circular.pdf"]) {
      await expect(service.ingestDocument({ ...documentRequest(source.sourceId), documentUrl }, "req"))
        .rejects.toMatchObject({ statusCode: 400, code: "INVALID_DOCUMENT_URL" });
    }
  });

  it("rejects oversize, malformed, unsupported, and unregistered documents before object writes", async () => {
    const repo = new MemoryPolicyRepository(); const objects = new MemoryPolicyObjects();
    const service = new PolicyService(repo, objects, () => fixedNow);
    const { source } = await service.registerSource(sourceRequest, "req");
    await expect(service.ingestDocument(documentRequest("SRC#00000000000000000000000000000000"), "req"))
      .rejects.toMatchObject({ statusCode: 404 });
    for (const invalid of [
      { ...documentRequest(source.sourceId), contentBase64: Buffer.alloc(2_000_001, 65).toString("base64") },
      { ...documentRequest(source.sourceId), contentBase64: "!!!" },
      { ...documentRequest(source.sourceId), contentBase64: Buffer.from("not html").toString("base64") },
      { ...documentRequest(source.sourceId), mimeType: "image/png" },
      { ...documentRequest(source.sourceId), canonicalUrl: "https://evil.test" },
    ]) await expect(service.ingestDocument(invalid, "req")).rejects.toMatchObject({ statusCode: expect.any(Number) });
    expect(objects.writes).toBe(0);
  });

  it("requires a verified ADMIN_POLICY or ADMIN Cognito group before parsing or writing", async () => {
    const repo = new MemoryPolicyRepository(); const objects = new MemoryPolicyObjects();
    let groups: string[] = [];
    let verified = "true";
    const handler = createPolicyHandler({
      resolveIdentity: async () => ({ sub, groups, attributes: userOutput({ email_verified: verified }).UserAttributes }),
      createRepository: () => repo, createObjectStore: () => objects, now: () => fixedNow,
    });
    const event = (body: unknown): APIGatewayProxyEvent => ({ ...request(), resource: "/admin/policy/sources",
      path: "/v1/admin/policy/sources", httpMethod: "POST", body: JSON.stringify(body),
      headers: { "content-type": "application/json" } });
    expect((await handler(event(sourceRequest), context)).statusCode).toBe(403);
    groups = ["ADMIN_POLICY"]; verified = "false";
    expect((await handler(event(sourceRequest), context)).statusCode).toBe(403);
    verified = "true";
    const response = await handler(event(sourceRequest), context);
    expect(response.statusCode).toBe(201);
    expect(JSON.parse(response.body).source.registryStatus).toBe("PROPOSED");
    groups = ["ADMIN"];
    expect((await handler(event(sourceRequest), context)).statusCode).toBe(200);
    expect(repo.sources.size).toBe(1);
    const wrong = { ...event(sourceRequest), httpMethod: "PUT" };
    expect((await handler(wrong, context)).statusCode).toBe(405);
    const sourceId = JSON.parse(response.body).source.sourceId as string;
    const documentEvent = { ...event(documentRequest(sourceId)), resource: "/admin/policy/documents",
      path: "/v1/admin/policy/documents" };
    const documentResponse = await handler(documentEvent, context);
    expect(documentResponse.statusCode).toBe(201);
    expect(JSON.parse(documentResponse.body).document).toMatchObject({ sourceId,
      s3VersionId: "immutable-version-1", derivedS3VersionId: "immutable-version-1" });
    expect(documentResponse.body).not.toContain("Official document text.");
  });

  it("does not publish document metadata when derived object storage fails, then retries safely", async () => {
    const repo = new MemoryPolicyRepository(); const objects = new MemoryPolicyObjects();
    const service = new PolicyService(repo, objects, () => fixedNow);
    const { source } = await service.registerSource(sourceRequest, "req");
    const original = objects.putImmutable.bind(objects);
    let failDerived = true;
    objects.putImmutable = async (key, bytes, contentType, hash) => {
      if (key.startsWith("derived/") && failDerived) { failDerived = false; throw new Error("temporary storage failure"); }
      return original(key, bytes, contentType, hash);
    };
    await expect(service.ingestDocument(documentRequest(source.sourceId), "req"))
      .rejects.toMatchObject({ statusCode: 503 });
    expect(repo.documents.size).toBe(0);
    const retry = await service.ingestDocument(documentRequest(source.sourceId), "req");
    expect(retry.created).toBe(true);
    expect(objects.writes).toBe(2);
  });

  it("atomically creates a CURRENT source record and immutable version snapshot", async () => {
    const send = vi.fn().mockResolvedValue({});
    const repository = new DynamoPolicyRepository("test-policy-table", "ap-south-1",
      { send } as unknown as DynamoDBDocumentClient);
    const service = new PolicyService(repository, new MemoryPolicyObjects(), () => fixedNow);
    send.mockResolvedValueOnce({});
    await service.registerSource(sourceRequest, "req");
    const transaction = send.mock.calls[1]?.[0];
    expect(transaction).toBeInstanceOf(TransactWriteCommand);
    const puts = transaction.input.TransactItems?.map((entry: { Put?: { Item?: Record<string, unknown>; ConditionExpression?: string } }) => entry.Put);
    expect(puts?.map((entry: { Item?: Record<string, unknown> }) => entry.Item?.SK)).toEqual([
      "CURRENT", "VERSION#00000001",
    ]);
    expect(puts?.every((entry: { ConditionExpression?: string }) =>
      entry.ConditionExpression === "attribute_not_exists(PK) AND attribute_not_exists(SK)")).toBe(true);
    expect(puts?.every((entry: { Item?: Record<string, unknown> }) =>
      (entry.Item?.value as PolicySourceV1).registryStatus === "PROPOSED")).toBe(true);
  });

  it("treats only a concurrent conditional source registration as an idempotent race", async () => {
    const repo = new MemoryPolicyRepository();
    const service = new PolicyService(repo, new MemoryPolicyObjects(), () => fixedNow);
    const cancellation = Object.assign(new Error("transaction canceled"), { name: "TransactionCanceledException",
      CancellationReasons: [{ Code: "ConditionalCheckFailed" }, { Code: "None" }] });
    repo.putSource = async source => { repo.sources.set(source.sourceId, source); throw cancellation; };
    expect((await service.registerSource(sourceRequest, "req")).created).toBe(false);
    repo.sources.clear();
    repo.putSource = async source => { repo.sources.set(source.sourceId, { ...source, name: "Different" }); throw cancellation; };
    await expect(service.registerSource(sourceRequest, "req")).rejects.toMatchObject({ statusCode: 409 });
    repo.sources.clear();
    repo.putSource = async () => { throw Object.assign(new Error("capacity"), { name: "TransactionCanceledException",
      CancellationReasons: [{ Code: "ProvisionedThroughputExceeded" }] }); };
    await expect(service.registerSource(sourceRequest, "req")).rejects.toMatchObject({ statusCode: 503 });
  });
});
