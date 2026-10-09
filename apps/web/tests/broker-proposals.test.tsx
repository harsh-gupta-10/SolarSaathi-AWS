// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrokerProposals } from "../src/components/broker-proposals";
import { demoPolicyFinancialResponse } from "../src/app/demo/policy-financial-fixture";
import type { BrokerCustomer, BrokerProperty } from "../src/lib/broker-api";
import type { BrokerProposalPreview, BrokerProposalSnapshot } from "../src/lib/broker-proposals-api";

const mocks = vi.hoisted(() => ({ list: vi.fn(), get: vi.fn(), preview: vi.fn(), save: vi.fn(), analyses: vi.fn() }));
vi.mock("../src/lib/broker-proposals-api", () => ({ brokerProposalsApi: mocks }));
vi.mock("../src/lib/advisor-api", () => ({ advisorApi: { analyses: mocks.analyses } }));
afterEach(cleanup);
beforeEach(() => { Object.values(mocks).forEach(mock => mock.mockReset()); });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
const createdAt = "2026-10-09T08:00:00.000Z";
const customers: BrokerCustomer[] = ["cust-a", "cust-b"].map((customerId, index) => ({ schemaVersion: 1,
  customerId, kind: "CUSTOMER", status: "NEW", name: index ? "Second customer" : "First customer",
  createdAt, updatedAt: createdAt }));
const properties: BrokerProperty[] = [
  { schemaVersion: 1, propertyId: "synthetic-property", customerId: "cust-a", label: "First roof", address: "Example Road, Pune 411001", createdAt, updatedAt: createdAt },
  { schemaVersion: 1, propertyId: "property-b", customerId: "cust-a", label: "Second roof", address: "Example Road, Nagpur 440001", createdAt, updatedAt: createdAt },
];
const summary = { proposalId: "proposal-a", customerId: "cust-a", propertyId: "synthetic-property",
  analysisId: "synthetic-analysis", createdAt, status: "UNAVAILABLE" as const,
  policyStatus: "UNAVAILABLE" as const, documentStatus: "NOT_GENERATED" as const,
  policyVersionIds: [], sourceLastCheckedAt: null, freshnessStatus: "RECHECK_REQUIRED" as const,
  expiresAt: "2026-11-09T08:00:00.000Z" };
const snapshot: BrokerProposalSnapshot = { ...summary, financials: demoPolicyFinancialResponse };
const preview: BrokerProposalPreview = { customerId: "cust-a", propertyId: "synthetic-property",
  analysisId: "synthetic-analysis", createdAt, status: "UNAVAILABLE", documentStatus: "NOT_GENERATED",
  financials: demoPolicyFinancialResponse };
function view() {
  return render(<BrokerProposals customers={{ items: customers, loading: false }}
    properties={{ items: properties, loading: false }} onMoreCustomers={() => undefined} onMoreProperties={() => undefined} />);
}

describe("broker proposal scope", () => {
  it("drops a late saved-proposal response after switching customers", async () => {
    const late = deferred<BrokerProposalSnapshot>();
    mocks.list.mockImplementation((customerId: string) => Promise.resolve({ customerId,
      proposals: customerId === "cust-a" ? [summary] : [] }));
    mocks.get.mockReturnValue(late.promise);
    mocks.analyses.mockResolvedValue({ analyses: [], nextCursor: undefined });
    view();
    await userEvent.selectOptions(screen.getByLabelText("Customer"), "cust-a");
    await userEvent.click(await screen.findByRole("button", { name: /Base estimate only/ }));
    await userEvent.selectOptions(screen.getByLabelText("Customer"), "cust-b");
    await act(async () => late.resolve(snapshot));
    expect(screen.queryByText("Saved immutable snapshot")).toBeNull();
    expect((screen.getByLabelText("Customer") as HTMLSelectElement).value).toBe("cust-b");
  });

  it("keeps analysis loading independent of form edits and drops a late preview after switching roofs", async () => {
    const analysis = deferred<{ analyses: Array<{ analysisId: string; propertyId: string; source: "MANUAL";
      measuredAt: string; roofAreaSquareMeters: number; segmentCount: number }> }>();
    const late = deferred<BrokerProposalPreview>();
    mocks.list.mockImplementation((customerId: string) => Promise.resolve({ customerId, proposals: [] }));
    mocks.analyses.mockImplementation((propertyId: string) => propertyId === "synthetic-property" ? analysis.promise :
      Promise.resolve({ analyses: [] }));
    mocks.preview.mockReturnValue(late.promise);
    view();
    await userEvent.selectOptions(screen.getByLabelText("Customer"), "cust-a");
    await userEvent.selectOptions(screen.getByLabelText("Property"), "synthetic-property");
    fireEvent.change(screen.getByLabelText("Monthly electricity consumption (kWh)"), { target: { value: "300" } });
    await act(async () => analysis.resolve({ analyses: [{ analysisId: "synthetic-analysis", propertyId: "synthetic-property",
      source: "MANUAL", measuredAt: createdAt, roofAreaSquareMeters: 80, segmentCount: 1 }] }));
    expect(screen.getByRole("option", { name: /80\.0 m²/ })).toBeTruthy();
    await userEvent.selectOptions(screen.getByLabelText("Confirmed roof analysis"), "synthetic-analysis");
    for (const [label, value] of [
      ["Assumed annual yield (kWh per kW)", "1500"], ["Gross installed quote (₹)", "200000"],
      ["Solar energy used on site (%)", "70"], ["Avoidable import energy rate (₹/kWh)", "8"],
      ["Assumed export credit (₹/kWh)", "0"], ["Year-one maintenance (₹)", "3000"],
    ] as const) fireEvent.change(screen.getByLabelText(label), { target: { value } });
    await userEvent.click(screen.getByRole("button", { name: "Preview proposal" }));
    await waitFor(() => expect(mocks.preview).toHaveBeenCalledTimes(1));
    await userEvent.selectOptions(screen.getByLabelText("Property"), "property-b");
    await act(async () => late.resolve(preview));
    expect(screen.queryByText("Unsaved preview")).toBeNull();
    expect((screen.getByLabelText("Property") as HTMLSelectElement).value).toBe("property-b");
  });
});
