// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { verifyBackendIdentity, BackendIdentityError } from "../src/auth/backend-identity";
import { ApiIdentityPanel } from "../src/auth/api-identity-panel";
import type { UserProfile } from "@solarsaathi/types";

const mock = vi.hoisted(() => ({
  api: "https://api.example.com/v1" as string | undefined,
  session: vi.fn(),
  status: "signedIn",
  profile: { userId: "user-1", cognitoSub: "user-1", email: "user@example.com", name: "User", role: "HOMEOWNER" } as UserProfile | null,
}));
vi.mock("aws-amplify/auth", () => ({ fetchAuthSession: mock.session }));
vi.mock("../src/lib/env", () => ({ getPublicEnvironment: () => ({ NEXT_PUBLIC_API_BASE_URL: mock.api }) }));
vi.mock("../src/auth/auth-provider", () => ({ useAuth: () => ({ status: mock.status, profile: mock.profile }) }));
const identity = { profile: { userId: "user-1", cognitoSub: "user-1", email: "user@example.com", name: "User", role: "HOMEOWNER" }, emailVerified: true, source: "COGNITO", requestId: "request-1" };
const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => {
  mock.api = "https://api.example.com/v1";
  mock.status = "signedIn";
  mock.profile = { ...identity.profile, role: "HOMEOWNER" };
  mock.session.mockReset().mockResolvedValue({ tokens: { accessToken: { toString: () => "test-access-token-marker" }, idToken: { toString: () => "test-id-token-marker" } } });
  fetchMock.mockReset().mockResolvedValue(new Response(JSON.stringify(identity), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("backend identity client", () => {
  it("uses the access token only, fixed GET endpoint, no cookies, redirects or response caching", async () => {
    expect(await verifyBackendIdentity("user-1")).toEqual(identity);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.example.com/v1/me");
    expect(init).toMatchObject({ method: "GET", credentials: "omit", cache: "no-store", redirect: "error", headers: { authorization: "Bearer test-access-token-marker" } });
    expect(JSON.stringify(init)).not.toContain("test-id-token-marker");
  });
  it.each([undefined, "https://api.example.com/v1?key=private-marker", "https://api.example.com/v1#private-marker"])("does not send a request when the endpoint is unconfigured or ambiguous", async value => {
    mock.api = value;
    await expect(verifyBackendIdentity("user-1")).rejects.toMatchObject({ code: "API_NOT_CONFIGURED" });
    expect(mock.session).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("rejects an absent session without sending credentials", async () => {
    mock.session.mockResolvedValue({});
    await expect(verifyBackendIdentity("user-1")).rejects.toMatchObject({ code: "SESSION_UNAVAILABLE" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each([401, 403])("maps unauthorized response %s to a safe sign-in recovery", async status => {
    fetchMock.mockResolvedValue(new Response("private-token-marker", { status }));
    await expect(verifyBackendIdentity("user-1")).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
  it("distinguishes missing backend configuration without exposing server messages", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: { code: "AUTH_NOT_CONFIGURED", message: "private-marker" } }), { status: 503 }));
    const result = await verifyBackendIdentity("user-1").catch(error => error as BackendIdentityError);
    expect(result).toMatchObject({ code: "AUTH_NOT_CONFIGURED" });
    expect(String(result)).not.toContain("private-marker");
  });
  it.each([
    { ...identity, profile: { ...identity.profile, userId: "other-user" } },
    { ...identity, profile: { ...identity.profile, cognitoSub: "other-user" } },
    { ...identity, source: "DEMO" },
    { ...identity, accessToken: "private-marker" },
    { ...identity, profile: { ...identity.profile, role: "ADMIN", token: "private-marker" } },
  ])("rejects mismatched or unexpected identities", async body => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));
    await expect(verifyBackendIdentity("user-1")).rejects.toMatchObject({ code: "INVALID_IDENTITY" });
  });
  it("redacts SDK/network errors", async () => {
    mock.session.mockRejectedValue(new Error("private-sdk-marker"));
    const result = await verifyBackendIdentity("user-1").catch(error => error);
    expect(String(result)).not.toContain("private-sdk-marker");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("times out even if the SDK session operation never settles", async () => {
    vi.useFakeTimers();
    mock.session.mockReturnValue(new Promise(() => undefined));
    const result = verifyBackendIdentity("user-1").catch(error => error);
    await vi.advanceTimersByTimeAsync(8_000);
    expect(await result).toMatchObject({ code: "TIMEOUT" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("does not start any session or network operation when already cancelled", async () => {
    const controller = new AbortController(); controller.abort();
    await expect(verifyBackendIdentity("user-1", controller.signal)).rejects.toMatchObject({ code: "CANCELLED" });
    expect(mock.session).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("honors caller cancellation while waiting on the session", async () => {
    mock.session.mockReturnValue(new Promise(() => undefined));
    const controller = new AbortController();
    const result = verifyBackendIdentity("user-1", controller.signal).catch(error => error);
    controller.abort();
    expect(await result).toMatchObject({ code: "CANCELLED" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
describe("API connection UI", () => {
  it("does not fake verification or offer a request without an API", () => {
    mock.api = undefined;
    render(<ApiIdentityPanel />);
    expect(screen.getByText(/No identity check has been performed/)).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("checks identity only after a signed-in user requests it", async () => {
    render(<ApiIdentityPanel />);
    expect(fetchMock).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Verify API connection" }));
    expect((await screen.findByRole("status")).textContent).toContain("Backend identity verified");
    expect(screen.getByText(/does not confirm property ownership/)).toBeTruthy();
  });
  it("clears a prior identity verification after the account changes", async () => {
    const { rerender } = render(<ApiIdentityPanel />);
    await userEvent.click(screen.getByRole("button", { name: "Verify API connection" }));
    await screen.findByRole("status");
    mock.profile = { ...identity.profile, userId: "user-2", cognitoSub: "user-2", role: "HOMEOWNER" };
    rerender(<ApiIdentityPanel />);
    expect(screen.queryByRole("status")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("keeps the action disabled when signed out", () => {
    mock.status = "signedOut"; mock.profile = null;
    render(<ApiIdentityPanel />);
    expect((screen.getByRole("button", { name: "Verify API connection" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
