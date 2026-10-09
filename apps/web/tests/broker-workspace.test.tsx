// @vitest-environment jsdom
import React from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrokerWorkspace } from "../src/components/broker-workspace";
import type { AuthProfile } from "../src/auth/auth-profile";

const state = vi.hoisted(() => ({ profile: null as AuthProfile | null,
  bootstrap: vi.fn(), customers: vi.fn(), properties: vi.fn(), leads: vi.fn() }));
vi.mock("../src/auth/auth-provider", () => ({ useAuth: () => ({ status: "signedIn", profile: state.profile }) }));
vi.mock("../src/components/workspace-role", () => ({ useWorkspaceRole: () => ({ role: "BROKER" }) }));
vi.mock("../src/lib/roof-api", () => ({ roofApi: { bootstrap: state.bootstrap },
  RoofRequestError: class extends Error { constructor(public code: string, message: string) { super(message); } } }));
vi.mock("../src/lib/broker-api", () => ({ brokerApi: { customers: state.customers,
  properties: state.properties, leads: state.leads } }));
beforeEach(() => { state.profile = { userId: "broker-a", cognitoSub: "broker-a", email: "a@example.com",
  name: "Broker A", role: "BROKER", organizationId: "org-a" };
  state.bootstrap.mockReset().mockResolvedValue({});
  state.customers.mockReset(); state.properties.mockReset().mockResolvedValue({ properties: [] });
  state.leads.mockReset().mockResolvedValue({ leads: [] });
});
afterEach(cleanup);
function deferred<T>() { let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }

describe("broker account state", () => {
  it("does not show old organization customers when an in-flight list finishes after account change", async () => {
    const oldPage = deferred<{ customers: Array<{ customerId: string; name: string; createdAt: string }> }>();
    state.customers.mockImplementationOnce(() => oldPage.promise).mockResolvedValueOnce({ customers: [{
      customerId: "customer-b", name: "Second account customer", createdAt: "2026-10-09T08:00:00.000Z",
    }] });
    const view = render(<BrokerWorkspace section="customers" />);
    await waitFor(() => expect(state.customers).toHaveBeenCalledTimes(1));
    state.profile = { userId: "broker-b", cognitoSub: "broker-b", email: "b@example.com",
      name: "Broker B", role: "BROKER", organizationId: "org-b" };
    view.rerender(<BrokerWorkspace section="customers" />);
    expect(await screen.findByText("Second account customer")).toBeTruthy();
    await act(async () => oldPage.resolve({ customers: [{ customerId: "customer-a", name: "Old account customer",
      createdAt: "2026-10-09T08:00:00.000Z" }] }));
    expect(screen.queryByText("Old account customer")).toBeNull();
    expect(screen.getByText("Second account customer")).toBeTruthy();
  });
});
