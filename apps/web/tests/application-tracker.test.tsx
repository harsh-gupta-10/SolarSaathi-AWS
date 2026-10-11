// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApplicationsPanel } from "../src/components/application-tracker";

const identity = vi.hoisted(() => ({ status: "signedIn" as "signedIn" | "signedOut", profile: { userId: "owner-one" } as
  { userId: string } | null }));
const api = vi.hoisted(() => ({ properties: vi.fn(), list: vi.fn(), get: vi.fn(), transition: vi.fn(),
  details: vi.fn(), document: vi.fn(), chatSuggestion: vi.fn(), uploadDocument: vi.fn(), confirmDocument: vi.fn(),
  documentDownloadUrl: vi.fn(), deleteDocument: vi.fn() }));
vi.mock("../src/auth/auth-provider", () => ({ useAuth: () => identity }));
vi.mock("../src/lib/applications-api", () => ({ applicationsApi: api,
  documentFileProblem: (file: File) => file.size > 10 * 1024 * 1024 ? "Choose a file of 10 MB or less." :
    ["application/pdf", "image/jpeg", "image/png"].includes(file.type) ? undefined : "Choose a PDF, JPEG or PNG file." }));
vi.mock("../src/lib/roof-api", () => ({ RoofRequestError: class extends Error {} }));

const citation = { schemaVersion: 1 as const, sourceId: "SRC#SYNTHETIC", sourceRegistryVersion: 1,
  documentId: "DOC#SYNTHETIC", documentVersion: 1, documentSha256: "a".repeat(64),
  publisherName: "Synthetic source", documentTitle: "Fictional process", sourceUrl: "https://example.com/fixture",
  retrievedAt: "2026-10-08T00:00:00.000Z", locator: { section: "Fixture" } };
const application = (propertyId: string, id: string) => ({ schemaVersion: 1, applicationId: id, propertyId,
  analysisId: "analysis-one", createdByUserId: "owner-one", policyId: "POLICY#SYNTHETIC", policyVersion: 1,
  benefitId: "BENEFIT#SYNTHETIC", ruleId: "RULE#SYNTHETIC", jurisdiction: "IN",
  system: { nominalKw: 3, actualDcKw: 3 }, benefitEvaluatedAt: "2026-10-08T00:00:00.000Z",
  benefitCountedAmountPaise: 100000, lastVerifiedAt: "2026-10-08T00:00:00.000Z",
  policyCitations: [citation], sourceChecks: [{ sourceId: citation.sourceId,
    lastCheckedAt: "2026-10-08T00:00:00.000Z", fresh: true, status: "HEALTHY" }],
  processSource: "VERIFIED_POLICY_SNAPSHOT", progressSource: "USER_REPORTED", status: "IN_PROGRESS",
  expectedNextStepId: "APPLICATION_SUBMITTED", steps: [{ stepId: "APPLICATION_SUBMITTED", order: 1,
    title: `Submit ${id}`, description: "Submit the synthetic fixture application.", required: true,
    citations: [citation], status: "PENDING", verificationStatus: "USER_REPORTED",
    updatedAt: "2026-10-08T00:00:00.000Z" }], documents: [], revision: 1,
  createdAt: "2026-10-08T00:00:00.000Z", updatedAt: "2026-10-08T00:00:00.000Z" });

beforeEach(() => {
  identity.status = "signedIn"; identity.profile = { userId: "owner-one" };
  Object.values(api).forEach(mock => mock.mockReset());
  api.properties.mockResolvedValue({ properties: [{ propertyId: "property-one", label: "Home one",
    address: "Private address one" }, { propertyId: "property-two", label: "Home two",
    address: "Private address two" }] });
  api.list.mockResolvedValue({ applications: [application("property-one", "application-one")] });
  api.get.mockImplementation(async (propertyId: string, id: string) => application(propertyId, id));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("application tracker account and property boundaries", () => {
  it("shows a retry instead of an empty assessment state when property loading fails", async () => {
    api.properties.mockRejectedValueOnce(new Error("network unavailable"));
    const user = userEvent.setup();
    render(<ApplicationsPanel />);
    await screen.findByRole("button", { name: "Retry loading properties" });
    expect(screen.queryByRole("heading", { name: "No property assessment yet" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Retry loading properties" }));
    expect(await screen.findByText(/Private address one/)).toBeTruthy();
  });
  it("shows a retry instead of an empty tracker state when application loading fails", async () => {
    api.list.mockRejectedValueOnce(new Error("network unavailable"));
    const user = userEvent.setup();
    render(<ApplicationsPanel />);
    await screen.findByRole("button", { name: "Retry loading applications" });
    expect(screen.queryByText("No application tracker has been created for this property.")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Retry loading applications" }));
    expect(await screen.findByRole("button", { name: /Synthetic/ })).toBeTruthy();
  });
  it("unmounts private application state when the signed-in account leaves", async () => {
    const user = userEvent.setup();
    const view = render(<ApplicationsPanel />);
    await screen.findByText(/Private address one/);
    await user.click(await screen.findByRole("button", { name: /Synthetic/ }));
    await screen.findByRole("heading", { name: "Submit application-one" });
    identity.status = "signedOut"; identity.profile = null; view.rerender(<ApplicationsPanel />);
    expect(screen.queryByText(/Private address one/)).toBeNull();
    expect(screen.queryByRole("heading", { name: "Submit application-one" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Sign in to view applications" })).toBeTruthy();
  });

  it("ignores an older property list response after the user switches properties", async () => {
    const user = userEvent.setup();
    let resolveOld!: (value: unknown) => void;
    api.list.mockImplementation((propertyId: string) => propertyId === "property-one" ?
      new Promise(resolve => { resolveOld = resolve; }) :
      Promise.resolve({ applications: [application("property-two", "application-two")] }));
    render(<ApplicationsPanel />);
    await screen.findByText(/Private address one/);
    await user.selectOptions(screen.getByLabelText("Property"), "property-two");
    await screen.findByText(/Policy v1.*updated/);
    resolveOld({ applications: [application("property-one", "application-one")] });
    await waitFor(() => expect(api.list).toHaveBeenCalledWith("property-two", undefined, expect.any(AbortSignal)));
    expect(screen.queryByRole("button", { name: /application-one/ })).toBeNull();
  });
});

describe("application document uploads", () => {
  async function openTracker() {
    const user = userEvent.setup({ applyAccept: false });
    render(<ApplicationsPanel />);
    await user.click(await screen.findByRole("button", { name: /Synthetic/ }));
    await screen.findByRole("heading", { name: "Documents" });
    return user;
  }
  const stored = (base: ReturnType<typeof application>, status: "UPLOADED" | "PENDING_UPLOAD") => ({ ...base, revision: 2,
    documents: [{ documentId: "doc-one", documentType: "ELECTRICITY_BILL", label: "October bill",
      recordedAt: "2026-10-08T00:00:00.000Z", verificationStatus: "USER_REPORTED",
      file: { objectKey: "applications/abc/application-one/doc-one", contentType: "application/pdf", sizeBytes: 2048,
        sha256Reported: "a".repeat(64), status, ...(status === "UPLOADED" ? { uploadedAt: "2026-10-08T00:00:00.000Z",
          expiresAt: "2027-10-08T00:00:00.000Z" } : {}) } }] });

  it("uploads a chosen file through the API client and shows its retention date", async () => {
    const user = await openTracker();
    api.uploadDocument.mockImplementation(async (current: ReturnType<typeof application>) => stored(current, "UPLOADED"));
    await user.selectOptions(screen.getByLabelText(/Document type/), "ELECTRICITY_BILL");
    await user.type(screen.getByLabelText(/Short label/), "October bill");
    const file = new File(["%PDF-1.7"], "bill.pdf", { type: "application/pdf" });
    await user.upload(screen.getByLabelText(/File \(optional\)/), file);
    await user.click(screen.getByRole("button", { name: "Upload document" }));
    await screen.findByText("File uploaded and stored privately.");
    expect(api.uploadDocument).toHaveBeenCalledWith(expect.objectContaining({ applicationId: "application-one" }),
      { documentType: "ELECTRICITY_BILL", label: "October bill" }, file);
    expect(api.document).not.toHaveBeenCalled();
    expect(screen.getByText(/deleted automatically on 8 Oct 2027/)).toBeTruthy();
  });

  it("rejects an unsupported file type before calling the API", async () => {
    const user = await openTracker();
    await user.selectOptions(screen.getByLabelText(/Document type/), "OTHER");
    await user.type(screen.getByLabelText(/Short label/), "Script");
    await user.upload(screen.getByLabelText(/File \(optional\)/), new File(["<html>"], "page.html", { type: "text/html" }));
    await user.click(screen.getByRole("button", { name: "Upload document" }));
    expect(await screen.findByText("Choose a PDF, JPEG or PNG file.")).toBeTruthy();
    expect(api.uploadDocument).not.toHaveBeenCalled();
  });

  it("requires a second click to delete a stored file", async () => {
    api.get.mockImplementation(async (propertyId: string, id: string) => stored(application(propertyId, id), "UPLOADED"));
    const user = await openTracker();
    api.deleteDocument.mockImplementation(async (current: ReturnType<typeof application>) => ({ ...current, documents: [], revision: 3 }));
    await user.click(screen.getByRole("button", { name: "Delete October bill" }));
    expect(api.deleteDocument).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Confirm delete" }));
    await screen.findByText("Document and file deleted.");
    expect(api.deleteDocument).toHaveBeenCalledWith(expect.objectContaining({ revision: 2 }), "doc-one");
  });

  it("offers a re-check for an unfinished upload instead of a download", async () => {
    api.get.mockImplementation(async (propertyId: string, id: string) => stored(application(propertyId, id), "PENDING_UPLOAD"));
    const user = await openTracker();
    expect(screen.queryByRole("button", { name: "Download" })).toBeNull();
    api.confirmDocument.mockImplementation(async (current: ReturnType<typeof application>) => stored({ ...current }, "UPLOADED"));
    await user.click(screen.getByRole("button", { name: "Check upload" }));
    await screen.findByText("File stored privately.");
    expect(api.confirmDocument).toHaveBeenCalledWith(expect.objectContaining({ revision: 2 }), "doc-one");
  });
});
