// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PolicyReviewPanel } from "../src/components/policy-review-panel";

const auth = vi.hoisted(() => ({ status: "signedIn", profile: { userId: "admin-1", policyAdmin: true } }));
const api = vi.hoisted(() => ({ queue: vi.fn(), sources: vi.fn(), registerSource: vi.fn(),
  detail: vi.fn(), changeDetail: vi.fn(), curate: vi.fn(), crawl: vi.fn(), review: vi.fn(), changeReview: vi.fn() }));
vi.mock("../src/auth/auth-provider", () => ({ useAuth: () => auth }));
vi.mock("../src/lib/policy-review-api", () => ({ policyReviewApi: api }));
vi.mock("../src/components/policy-publication-panel", () => ({ PolicyPublicationPanel: () => <p>Rules</p> }));
vi.mock("../src/components/policy-monitoring-panel", () => ({ PolicyMonitoringPanel: () => <p>Monitoring</p> }));
vi.mock("../src/components/policy-version-panel", () => ({ PolicyVersionPanel: () => <p>Versions</p> }));

const registry = [{ host: "official.example.gov", sourceType: "STATE_ENERGY_DEPARTMENT", jurisdiction: "IN-MH" }];
const source = { schemaVersion: 1, sourceId: "SRC#synthetic", registryVersion: 1, name: "Example energy office",
  publisherName: "Example office", jurisdiction: "IN-MH", sourceType: "STATE_ENERGY_DEPARTMENT",
  canonicalUrl: "https://official.example.gov/circular", authorityTier: 1, registryStatus: "CURATED",
  healthStatus: "STALE", crawlFrequency: "MONTHLY", enabled: true, freshnessWindowHours: 720 };
beforeEach(() => { Object.values(api).forEach(mock => mock.mockReset());
  api.queue.mockResolvedValue({ items: [], changes: [], nextCursor: undefined });
  api.sources.mockResolvedValue({ sources: [source], sourceStates: [{ sourceId: source.sourceId, sourceFresh: false,
    healthStatus: "STALE", warnings: ["SOURCE_CHECK_OVERDUE"] }], registerableHosts: registry,
    hostRegistryVersion: 1, nextCursor: undefined });
  api.registerSource.mockResolvedValue({ source, created: true }); });
afterEach(cleanup);

describe("policy source registry console", () => {
  it("uses server-reviewed host binding for registration and displays stale-source health", async () => {
    render(<PolicyReviewPanel />);
    await userEvent.click(screen.getByRole("button", { name: /Official sources/ }));
    expect(await screen.findByText("Example energy office")).toBeTruthy();
    expect(screen.getByText("Source check overdue")).toBeTruthy();
    await userEvent.type(screen.getByLabelText("Source name"), "Another example source");
    await userEvent.type(screen.getByLabelText("Official publisher"), "Example public office");
    await userEvent.selectOptions(screen.getByLabelText("Reviewed official host"),
      "official.example.gov|STATE_ENERGY_DEPARTMENT|IN-MH");
    await userEvent.clear(screen.getByLabelText("Canonical official HTTPS URL"));
    await userEvent.type(screen.getByLabelText("Canonical official HTTPS URL"), "https://official.example.gov/new-circular");
    await userEvent.click(screen.getByRole("button", { name: "Propose source for curation" }));
    await waitFor(() => expect(api.registerSource).toHaveBeenCalledWith("admin-1", expect.objectContaining({
      jurisdiction: "IN-MH", sourceType: "STATE_ENERGY_DEPARTMENT",
      canonicalUrl: "https://official.example.gov/new-circular",
    }), expect.any(AbortSignal)));
    expect(await screen.findByText(/evidence needs separate review before a benefit can be published/i)).toBeTruthy();
  }, 10_000);

  it("keeps source pagination available after an empty first page", async () => {
    api.sources.mockResolvedValueOnce({ sources: [], sourceStates: [], registerableHosts: registry,
      hostRegistryVersion: 1, nextCursor: "next-source" })
      .mockResolvedValueOnce({ sources: [source], sourceStates: [{ sourceId: source.sourceId, sourceFresh: false,
        healthStatus: "STALE", warnings: ["SOURCE_CHECK_OVERDUE"] }], registerableHosts: registry,
        hostRegistryVersion: 1 });
    render(<PolicyReviewPanel />);
    await userEvent.click(screen.getByRole("button", { name: /Official sources/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Load more sources" }));
    expect(api.sources.mock.calls[1][2]).toBe("next-source");
    expect(await screen.findByText("Example energy office")).toBeTruthy();
  });
});
