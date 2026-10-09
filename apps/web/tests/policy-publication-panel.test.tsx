// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PolicyPublicationPanel } from "../src/components/policy-publication-panel";

const api = vi.hoisted(() => ({ queue: vi.fn(), detail: vi.fn(), create: vi.fn(), transition: vi.fn() }));
vi.mock("../src/lib/policy-publication-api", () => ({ policyPublicationApi: api }));

const draft = { schemaVersion: 1, draftId: `DRAFT#${"a".repeat(32)}`, policyId: "POLICY#example",
  benefitId: "BENEFIT#EXAMPLE", version: 1, status: "PENDING_APPROVAL", revision: 2,
  createdAt: "2026-10-08T10:00:00.000Z", submittedAt: "2026-10-08T11:00:00.000Z",
  authoredBy: "author-1", sourceCuratorId: "curator-1", quotedEvidence: "Illustrative official quotation.",
  citation: { sourceId: "SRC#example", documentId: "DOC#example", documentVersion: 1,
    sourceRegistryVersion: 1, documentSha256: "a".repeat(64), publisherName: "Example agency",
    documentTitle: "Example circular", sourceUrl: "https://example.invalid/circular", retrievedAt: "2026-10-08T09:00:00.000Z",
    locator: { charStart: 0, charEnd: 32 } },
  clauseEvidence: [{ clauseKey: "EFFECTIVE_PERIOD", quotedEvidence: "Illustrative effective date wording.",
    citation: { sourceId: "SRC#example", documentId: "DOC#example", documentVersion: 1,
      sourceRegistryVersion: 1, documentSha256: "a".repeat(64), publisherName: "Example agency",
      documentTitle: "Example circular", sourceUrl: "https://example.invalid/circular", retrievedAt: "2026-10-08T09:00:00.000Z",
      locator: { charStart: 33, charEnd: 67 } } }],
  rule: { schemaVersion: 1, ruleId: "RULE#example", benefitId: "BENEFIT#EXAMPLE",
    policyId: "POLICY#example", policyVersion: 1, factIds: ["FACT#example"], scope: "STATE",
    jurisdiction: "IN-XX", effectiveFrom: "2026-10-01", amount: { kind: "FIXED", amountPaise: 100 },
    eligibility: { allOf: [], anyOf: [] }, compatibility: [] },
};
const detail = { schemaVersion: 1, draft, source: { sourceId: "SRC#example", publisherName: "Example agency",
  registryStatus: "CURATED", registryVersion: 1, canonicalUrl: "https://example.invalid/circular", freshnessWindowHours: 48 },
  document: { documentId: "DOC#example", version: 1, sha256: "a".repeat(64), title: "Example circular",
    canonicalUrl: "https://example.invalid/circular" }, crawlState: { lastCheckedAt: "2026-10-08T09:00:00.000Z" },
  sourceFresh: true, requestId: "request-1" };

beforeEach(() => {
  api.queue.mockReset(); api.detail.mockReset(); api.create.mockReset(); api.transition.mockReset();
  api.queue.mockResolvedValue({ schemaVersion: 1, items: [draft], hasMore: false, requestId: "request-1" });
  api.detail.mockResolvedValue(detail);
  api.transition.mockResolvedValue({ schemaVersion: 1, draft: { ...draft, status: "PUBLISHED", revision: 3 },
    publishedVersion: { version: 1, status: "ACTIVE" }, requestId: "request-2" });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("policy publication review", () => {
  it("hides decision controls from the rule author", async () => {
    const user = userEvent.setup();
    render(<PolicyPublicationPanel userId="author-1" demo={false} />);
    await user.click(await screen.findByRole("button", { name: /EXAMPLE/ }));
    await screen.findByText(/The author or source curator cannot review/);
    expect(screen.queryByRole("button", { name: "Review and publish" })).toBeNull();
  });

  it("requires a separate reviewer to record a reason before publication", async () => {
    const user = userEvent.setup();
    render(<PolicyPublicationPanel userId="reviewer-1" demo={false} />);
    await user.click(await screen.findByRole("button", { name: /EXAMPLE/ }));
    await screen.findByText("Example agency");
    await user.click(screen.getByRole("button", { name: "Review and publish" }));
    const confirm = screen.getByRole("button", { name: "Confirm publication" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    await user.type(screen.getByLabelText("Review reason (at least 10 characters)"), "Checked the exact official rule and exclusions");
    await user.click(confirm);
    expect(api.transition).toHaveBeenCalledWith("reviewer-1", draft.draftId, "publish", 2,
      "Checked the exact official rule and exclusions");
  }, 10_000);

  it("does not call policy APIs in the synthetic preview", () => {
    render(<PolicyPublicationPanel userId="SYNTHETIC_DEMO" demo />);
    expect(screen.getByText(/Rule creation and publication are disabled/)).toBeTruthy();
    expect(api.queue).not.toHaveBeenCalled();
  });

  it("loads the next pending review page without duplicating drafts", async () => {
    const user = userEvent.setup();
    const another = { ...draft, draftId: `DRAFT#${"b".repeat(32)}`, benefitId: "BENEFIT#SECOND" };
    api.queue.mockResolvedValueOnce({ schemaVersion: 1, items: [draft], hasMore: true,
      nextCursor: "opaque-cursor", requestId: "request-1" })
      .mockResolvedValueOnce({ schemaVersion: 1, items: [draft, another], hasMore: false,
        requestId: "request-2" });
    render(<PolicyPublicationPanel userId="reviewer-1" demo={false} />);
    await user.click(await screen.findByRole("button", { name: "Load more drafts" }));
    await screen.findByRole("button", { name: /SECOND/ });
    expect(api.queue).toHaveBeenCalledWith("reviewer-1", undefined, "opaque-cursor");
    expect(screen.getAllByRole("button", { name: /EXAMPLE/ })).toHaveLength(1);
  });
});
