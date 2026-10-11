import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applicationsApi, documentFileProblem, type SolarApplication } from "../src/lib/applications-api";

const mocks = vi.hoisted(() => ({ session: vi.fn() }));
vi.mock("../src/lib/env", () => ({ getPublicEnvironment: () => ({ NEXT_PUBLIC_API_BASE_URL: "https://api.example.com/v1" }) }));
vi.mock("aws-amplify/auth", () => ({ fetchAuthSession: mocks.session }));

beforeEach(() => { mocks.session.mockResolvedValue({ tokens: { accessToken: { toString: () => "access-token" } } }); });
afterEach(() => { mocks.session.mockReset(); vi.unstubAllGlobals(); });

describe("application API client", () => {
  it("scopes GET lists to an encoded property with a bearer token and no cookies", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, status: 200,
      json: async () => ({ schemaVersion: 1, source: "DYNAMODB_APPLICATION_TRACKER_V1", requestId: "request-1",
        applications: [], nextCursor: "opaque" }) });
    vi.stubGlobal("fetch", fetcher);
    await expect(applicationsApi.list("property-one", "cursor-value")).resolves.toMatchObject({ applications: [], nextCursor: "opaque" });
    expect(fetcher).toHaveBeenCalledWith("https://api.example.com/v1/applications?propertyId=property-one&cursor=cursor-value",
      expect.objectContaining({ method: "GET", credentials: "omit", redirect: "error", cache: "no-store",
        headers: expect.objectContaining({ authorization: "Bearer access-token" }) }));
    expect(fetcher.mock.calls[0]?.[1]).not.toHaveProperty("body");
  });
});

const at = "2026-10-08T00:00:00.000Z";
const citation = { schemaVersion: 1, sourceId: "SRC#S", sourceRegistryVersion: 1, documentId: "DOC#S", documentVersion: 1,
  documentSha256: "a".repeat(64), publisherName: "Synthetic", documentTitle: "Fixture", sourceUrl: "https://example.com/f",
  retrievedAt: at, locator: { section: "Fixture" } };
const app = (documents: unknown[] = [], revision = 1) => ({ schemaVersion: 1, applicationId: "application-one",
  propertyId: "property-one", analysisId: "analysis-one", createdByUserId: "owner", policyId: "POLICY#S", policyVersion: 1,
  benefitId: "BENEFIT#S", ruleId: "RULE#S", jurisdiction: "IN", system: { nominalKw: 3, actualDcKw: 3 },
  benefitEvaluatedAt: at, benefitCountedAmountPaise: 1, lastVerifiedAt: at, policyCitations: [citation],
  sourceChecks: [{ sourceId: "SRC#S", lastCheckedAt: at, fresh: true, status: "HEALTHY" }],
  processSource: "VERIFIED_POLICY_SNAPSHOT", progressSource: "USER_REPORTED", status: "IN_PROGRESS", expectedNextStepId: null,
  steps: [{ stepId: "APPLY", order: 1, title: "Apply", description: "Apply.", required: true, citations: [citation],
    status: "PENDING", verificationStatus: "USER_REPORTED", updatedAt: at }], documents, revision, createdAt: at, updatedAt: at });
const envelope = { schemaVersion: 1, source: "DYNAMODB_APPLICATION_TRACKER_V1", requestId: "request-1" };
const pendingDoc = { documentId: "doc-one", documentType: "ELECTRICITY_BILL", label: "Bill", recordedAt: at,
  verificationStatus: "USER_REPORTED", file: { objectKey: "applications/abc/application-one/doc-one",
    contentType: "application/pdf", sizeBytes: 8, sha256Reported: "b".repeat(64), status: "PENDING_UPLOAD" } };
const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

describe("application document client", () => {
  it("validates file type and size locally", () => {
    expect(documentFileProblem(new File(["x"], "a.txt", { type: "text/plain" }))).toMatch(/PDF/);
    expect(documentFileProblem(new File([], "a.pdf", { type: "application/pdf" }))).toMatch(/empty/);
    expect(documentFileProblem(new File(["%PDF-"], "a.pdf", { type: "application/pdf" }))).toBeUndefined();
  });

  it("records, uploads straight to S3 without credentials, then confirms", async () => {
    const upload = { url: "https://bucket.s3.ap-south-1.amazonaws.com/applications/abc?X-Amz-Signature=x", method: "PUT",
      headers: { "content-type": "application/pdf" }, expiresAt: at };
    const fetcher = vi.fn()
      .mockResolvedValueOnce(ok({ ...envelope, application: app([pendingDoc], 2), upload }))
      .mockResolvedValueOnce({ ok: true, status: 200 })
      .mockResolvedValueOnce(ok({ ...envelope, application: app([{ ...pendingDoc, file: { ...pendingDoc.file, status: "UPLOADED" } }], 3) }));
    vi.stubGlobal("fetch", fetcher);
    const file = new File(["%PDF-1.7"], "bill.pdf", { type: "application/pdf" });
    const result = await applicationsApi.uploadDocument(app() as SolarApplication, { documentType: "ELECTRICITY_BILL", label: "Bill" }, file);
    expect(result.documents[0]?.file?.status).toBe("UPLOADED");
    const recorded = JSON.parse(fetcher.mock.calls[0]![1].body as string);
    expect(recorded.file).toMatchObject({ contentType: "application/pdf", sizeBytes: 8 });
    expect(recorded.file.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(String(fetcher.mock.calls[1]![0])).toBe(upload.url);
    expect(fetcher.mock.calls[1]![1]).toMatchObject({ method: "PUT", body: file, credentials: "omit", redirect: "error" });
    expect(fetcher.mock.calls[1]![1].headers).not.toHaveProperty("authorization");
    expect(fetcher.mock.calls[2]![0]).toBe("https://api.example.com/v1/applications/application-one/documents/doc-one/confirm");
  });

  it("retries an unfinished upload with a fresh link and refuses a different file", async () => {
    const upload = { url: "https://bucket.s3.ap-south-1.amazonaws.com/applications/abc?X-Amz-Signature=y", method: "PUT",
      headers: { "content-type": "application/pdf" }, expiresAt: at };
    const fetcher = vi.fn()
      .mockResolvedValueOnce(ok({ ...envelope, application: app([pendingDoc], 2), upload }))
      .mockResolvedValueOnce({ ok: true, status: 200 })
      .mockResolvedValueOnce(ok({ ...envelope, application: app([{ ...pendingDoc, file: { ...pendingDoc.file, status: "UPLOADED" } }], 3) }));
    vi.stubGlobal("fetch", fetcher);
    const pendingApp = app([pendingDoc], 2) as SolarApplication;
    await expect(applicationsApi.retryUpload(pendingApp, "doc-one", new File(["%PDF-1.7 longer"], "x.pdf", { type: "application/pdf" })))
      .rejects.toMatchObject({ code: "INVALID_FILE" });
    expect(fetcher).not.toHaveBeenCalled();
    const result = await applicationsApi.retryUpload(pendingApp, "doc-one", new File(["%PDF-1.7"], "bill.pdf", { type: "application/pdf" }));
    expect(result.documents[0]?.file?.status).toBe("UPLOADED");
    expect(JSON.parse(fetcher.mock.calls[0]![1].body as string)).toMatchObject({ reissueUpload: true, expectedRevision: 2 });
    expect(String(fetcher.mock.calls[1]![0])).toBe(upload.url);
  });

  it("refuses to send a file to a non-S3 upload address", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(ok({ ...envelope, application: app([pendingDoc], 2),
      upload: { url: "https://evil.example.com/collect", method: "PUT", headers: {}, expiresAt: at } }));
    vi.stubGlobal("fetch", fetcher);
    await expect(applicationsApi.uploadDocument(app() as SolarApplication, { documentType: "ELECTRICITY_BILL", label: "Bill" },
      new File(["%PDF-"], "a.pdf", { type: "application/pdf" }))).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("deletes with property and revision in the query", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(ok({ ...envelope, application: app([], 3) }));
    vi.stubGlobal("fetch", fetcher);
    await applicationsApi.deleteDocument(app([pendingDoc], 2) as SolarApplication, "doc-one");
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.example.com/v1/applications/application-one/documents/doc-one?propertyId=property-one&expectedRevision=2",
      expect.objectContaining({ method: "DELETE" }));
  });
});
