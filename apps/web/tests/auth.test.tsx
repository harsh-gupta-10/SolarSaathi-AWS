// @vitest-environment jsdom
import React, { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { AuthSession } from "aws-amplify/auth";
import { AuthProvider, OAUTH_WAIT_MS, useAuth, type AuthContextValue } from "../src/auth/auth-provider";
import { AccountPanel } from "../src/auth/account-panel";
import { SignInPanel } from "../src/auth/sign-in-panel";
import AuthCallbackPage from "../src/app/auth/callback/page";
import { getAuthConfiguration } from "../src/auth/auth-config";
import { getAuthProfile } from "../src/auth/auth-profile";
import { createAuthCookieStorage } from "../src/auth/auth-storage";

type HubListener = (capsule: { payload: { event: string; data?: unknown } }) => void;
const sdk = vi.hoisted(() => ({
  configure: vi.fn(), session: vi.fn(), user: vi.fn(), attributes: vi.fn(),
  redirect: vi.fn(), signOut: vi.fn(), storage: vi.fn(), tokenConfig: vi.fn(), cookie: vi.fn(), env: vi.fn(),
  replace: vi.fn(), listeners: new Set<HubListener>(), unsubscribe: vi.fn(),
}));
vi.mock("aws-amplify", () => ({ Amplify: { configure: sdk.configure } }));
vi.mock("aws-amplify/auth", () => ({
  fetchAuthSession: sdk.session, getCurrentUser: sdk.user, fetchUserAttributes: sdk.attributes,
  signInWithRedirect: sdk.redirect, signOut: sdk.signOut,
}));
vi.mock("aws-amplify/auth/cognito", () => ({ cognitoUserPoolsTokenProvider: { setKeyValueStorage: sdk.storage, setAuthConfig: sdk.tokenConfig } }));
vi.mock("aws-amplify/auth/enable-oauth-listener", () => ({}));
vi.mock("aws-amplify/utils", () => ({
  CookieStorage: class { constructor(options: unknown) { sdk.cookie(options); } },
  Hub: { listen: (_channel: string, listener: HubListener) => {
    sdk.listeners.add(listener);
    return () => { sdk.unsubscribe(); sdk.listeners.delete(listener); };
  } },
}));
vi.mock("../src/lib/env", () => ({ getPublicEnvironment: sdk.env }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: sdk.replace }) }));

const environment = {
  NEXT_PUBLIC_COGNITO_USER_POOL_ID: "ap-south-1_example",
  NEXT_PUBLIC_COGNITO_CLIENT_ID: "publicclient",
  NEXT_PUBLIC_COGNITO_DOMAIN: "example.auth.ap-south-1.amazoncognito.com",
  NEXT_PUBLIC_COGNITO_REDIRECT_SIGN_IN: "http://localhost:3000/auth/callback",
  NEXT_PUBLIC_COGNITO_REDIRECT_SIGN_OUT: "http://localhost:3000/auth/sign-in",
  NEXT_PUBLIC_COGNITO_GOOGLE_ENABLED: "true",
};
const session = {
  tokens: {
    idToken: {
      payload: { sub: "user-sub", token_use: "id", email: "homeowner@example.test", name: "Example Homeowner", "custom:organizationId": "org-example" },
      toString: () => "RAW_ID_TOKEN_DO_NOT_DISPLAY",
    },
    accessToken: { payload: { sub: "user-sub", token_use: "access", "cognito:groups": ["BROKER"] }, toString: () => "RAW_ACCESS_TOKEN_DO_NOT_DISPLAY" },
  },
} as AuthSession;
let current: AuthContextValue;
function Probe() {
  current = useAuth();
  return <><span data-testid="status">{current.status}</span><span data-testid="oauth">{current.oauthStatus}</span></>;
}
function mount(children: React.ReactNode = <AccountPanel />) {
  return render(<AuthProvider><Probe />{children}</AuthProvider>);
}
async function settled(status: string) {
  await waitFor(() => expect(screen.getByTestId("status").textContent).toBe(status));
}
async function emit(event: string, data?: unknown) {
  await act(async () => { for (const listener of sdk.listeners) listener({ payload: { event, data } }); });
}
function callbackUrl(query = "code=PRIVATE_CODE&state=PRIVATE_STATE&returnTo=https%3A%2F%2Funtrusted.test") {
  window.history.replaceState(null, "", `/auth/callback?${query}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  sdk.listeners.clear();
  sdk.env.mockReturnValue({ ...environment });
  sdk.configure.mockImplementation(() => undefined);
  sdk.session.mockResolvedValue(session);
  sdk.user.mockResolvedValue({ userId: "user-sub", username: "internal-name" });
  sdk.attributes.mockResolvedValue({ sub: "user-sub", email: "homeowner@example.test", name: "Example Homeowner" });
  sdk.redirect.mockResolvedValue(undefined);
  sdk.signOut.mockResolvedValue(undefined);
  window.history.replaceState(null, "", "/app/settings");
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe("Cognito configuration and storage", () => {
  it("fails closed without a complete config and guards every action", async () => {
    sdk.env.mockReturnValue({ NEXT_PUBLIC_COGNITO_USER_POOL_ID: "ap-south-1_example" });
    mount(<SignInPanel />);
    await settled("unconfigured");
    expect(screen.getByText(/No demo or simulated login/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Continue to secure sign-in" }).hasAttribute("disabled")).toBe(true);
    await act(async () => { await current.beginSignIn(); await current.refresh(); await current.signOut(); });
    expect(sdk.configure).not.toHaveBeenCalled();
    expect(sdk.session).not.toHaveBeenCalled();
    expect(sdk.redirect).not.toHaveBeenCalled();
    expect(sdk.signOut).not.toHaveBeenCalled();
  });
  it("redacts invalid environment errors", async () => {
    sdk.env.mockImplementation(() => { throw new Error("PRIVATE_CONFIG_VALUE"); });
    mount(<SignInPanel />);
    await settled("error");
    expect(screen.getByRole("alert").textContent).toContain("unavailable for this deployment");
    expect(document.body.textContent).not.toContain("PRIVATE_CONFIG_VALUE");
    expect(sdk.configure).not.toHaveBeenCalled();
  });
  it.each([
    { NEXT_PUBLIC_COGNITO_REDIRECT_SIGN_IN: "https://other-deployment.test/auth/callback" },
    { NEXT_PUBLIC_COGNITO_REDIRECT_SIGN_OUT: "https://other-deployment.test/auth/sign-in" },
    { NEXT_PUBLIC_COGNITO_REDIRECT_SIGN_IN: "http://localhost:3000/auth/callback?returnTo=/admin" },
    { NEXT_PUBLIC_COGNITO_REDIRECT_SIGN_OUT: "http://localhost:3000/auth/sign-in#secret" },
    { NEXT_PUBLIC_COGNITO_REDIRECT_SIGN_IN: "http://localhost:3000/not-callback" },
    { NEXT_PUBLIC_COGNITO_DOMAIN: "https://example.test" },
  ])("rejects unsafe deployment-specific redirects/domain: %j", (override) => {
    sdk.env.mockReturnValue({ ...environment, ...override });
    expect(getAuthConfiguration(window.location.origin).status).toBe("error");
  });
  it("uses code + PKCE, no secret, and one-day SameSite=Lax cookies instead of localStorage tokens", async () => {
    const persist = vi.spyOn(Storage.prototype, "setItem");
    mount();
    await settled("signedIn");
    expect(sdk.configure).toHaveBeenCalledWith({ Auth: { Cognito: {
      userPoolId: environment.NEXT_PUBLIC_COGNITO_USER_POOL_ID,
      userPoolClientId: environment.NEXT_PUBLIC_COGNITO_CLIENT_ID,
      loginWith: { oauth: {
        domain: environment.NEXT_PUBLIC_COGNITO_DOMAIN,
        scopes: ["openid", "email", "profile", "aws.cognito.signin.user.admin"],
        redirectSignIn: [environment.NEXT_PUBLIC_COGNITO_REDIRECT_SIGN_IN],
        redirectSignOut: [environment.NEXT_PUBLIC_COGNITO_REDIRECT_SIGN_OUT], responseType: "code",
      } },
    } } }, { Auth: { tokenProvider: { setKeyValueStorage: sdk.storage, setAuthConfig: sdk.tokenConfig } } });
    expect(sdk.tokenConfig).toHaveBeenCalledTimes(1);
    expect(sdk.cookie).toHaveBeenCalledWith({ path: "/", secure: false, sameSite: "lax", expires: 1 });
    expect(sdk.storage).toHaveBeenCalledTimes(1);
    expect(sdk.storage.mock.invocationCallOrder[0]).toBeLessThan(sdk.configure.mock.invocationCallOrder[0]!);
    expect(persist).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
  });
  it("enables secure cookies on HTTPS", async () => {
    createAuthCookieStorage("https:");
    expect(sdk.cookie).toHaveBeenCalledWith({ path: "/", secure: true, sameSite: "lax", expires: 1 });
    sdk.env.mockReturnValue({ ...environment, NEXT_PUBLIC_COGNITO_REDIRECT_SIGN_IN: "https://app.example.test/auth/callback", NEXT_PUBLIC_COGNITO_REDIRECT_SIGN_OUT: "https://app.example.test/auth/sign-in" });
    expect(getAuthConfiguration("https://app.example.test").status).toBe("ready");
    expect(getAuthConfiguration("http://app.example.test").status).toBe("error");
  });
  it("guards actions when Amplify configuration fails", async () => {
    sdk.configure.mockImplementation(() => { throw new Error("RAW_CONFIGURATION_ERROR"); });
    mount();
    await settled("error");
    await act(async () => { await current.beginSignIn(); await current.refresh(); await current.signOut(); });
    expect(current.configured).toBe(false);
    expect(sdk.redirect).not.toHaveBeenCalled();
    expect(sdk.session).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain("RAW_CONFIGURATION_ERROR");
  });
});

describe("session restore and identity display", () => {
  it("restores identity with Cognito broker group and read-only organization, never raw tokens", async () => {
    mount();
    await settled("signedIn");
    expect(current.profile).toEqual({ userId: "user-sub", cognitoSub: "user-sub", email: "homeowner@example.test", name: "Example Homeowner", role: "BROKER", organizationId: "org-example" });
    expect(screen.getByText("Example Homeowner")).toBeTruthy();
    expect(screen.getByText("Broker")).toBeTruthy();
    expect(document.body.textContent).not.toContain("RAW_ID_TOKEN");
    expect(document.body.textContent).not.toContain("RAW_ACCESS_TOKEN");
    expect(Object.keys(current)).not.toContain("tokens");
  });
  it("does not turn writable attributes, role previews, admin groups or string groups into broker access", async () => {
    sdk.session.mockResolvedValue({ tokens: { ...session.tokens, accessToken: { payload: { sub: "user-sub", token_use: "access", "cognito:groups": ["ADMIN", "ADMIN_POLICY"] } } } });
    sdk.attributes.mockResolvedValue({ sub: "user-sub", "custom:role": "BROKER", "custom:organizationId": "org-admin-assigned" });
    sessionStorage.setItem("solarsaathi.navigation-preview.v1", "BROKER");
    mount();
    await settled("signedIn");
    expect(current.profile?.role).toBe("HOMEOWNER");
    expect(current.profile?.policyAdmin).toBe(true);
    expect(current.profile?.organizationId).toBe("org-admin-assigned");
    const stringGroup = { tokens: { ...session.tokens, accessToken: { payload: { sub: "user-sub", token_use: "access", "cognito:groups": "BROKER" } } } } as unknown as AuthSession;
    expect(getAuthProfile({ userId: "user-sub", username: "username" }, stringGroup, {})).toMatchObject({ role: "HOMEOWNER" });
    expect(getAuthProfile({ userId: "user-sub", username: "username" }, stringGroup, {}).policyAdmin).toBeUndefined();
  });
  it("restores the signed-out state when there are no tokens", async () => {
    sdk.session.mockResolvedValue({});
    mount();
    await settled("signedOut");
    expect(sdk.user).not.toHaveBeenCalled();
    expect(current.profile).toBeNull();
  });
  it.each(["session", "user", "attributes"] as const)("fails closed and sanitizes %s errors", async (operation) => {
    sdk[operation].mockRejectedValue(new Error("RAW_TOKEN_OR_SERVICE_ERROR"));
    mount();
    await settled("error");
    expect(current.profile).toBeNull();
    expect(document.body.textContent).not.toContain("RAW_TOKEN_OR_SERVICE_ERROR");
  });
  it("rejects mismatched identities instead of displaying another user's profile", async () => {
    sdk.user.mockResolvedValue({ userId: "another-user", username: "username" });
    mount();
    await settled("error");
    expect(current.profile).toBeNull();
  });
  it.each([
    { tokens: { accessToken: session.tokens!.accessToken } },
    { tokens: { ...session.tokens, accessToken: { payload: { sub: "another-user", token_use: "access" } } } },
    { tokens: { ...session.tokens, idToken: { payload: { sub: "user-sub", token_use: "access" } } } },
  ])("rejects incomplete or inconsistent identity tokens: %j", async (malformed) => {
    sdk.session.mockResolvedValue(malformed);
    mount();
    await settled("error");
    expect(current.profile).toBeNull();
  });
  it("clears profile on refresh failure and can recover through an explicit session refresh", async () => {
    mount();
    await settled("signedIn");
    await emit("tokenRefresh_failure", new Error("PRIVATE_REFRESH_ERROR"));
    await settled("error");
    expect(current.profile).toBeNull();
    await act(async () => { await current.refresh(); });
    await settled("signedIn");
    expect(sdk.session).toHaveBeenLastCalledWith({ forceRefresh: true });
  });
  it("reacts to sign-out and refreshed sessions, and removes Hub listeners on unmount", async () => {
    const view = mount();
    await settled("signedIn");
    await emit("signedOut");
    await settled("signedOut");
    await emit("tokenRefresh");
    await settled("signedIn");
    view.unmount();
    expect(sdk.listeners.size).toBe(0);
    expect(sdk.unsubscribe).toHaveBeenCalled();
  });
  it("does not restore stale in-flight identity after sign-out", async () => {
    let release!: (session: AuthSession) => void;
    sdk.session.mockReturnValue(new Promise<AuthSession>((resolve) => { release = resolve; }));
    mount();
    await waitFor(() => expect(sdk.session).toHaveBeenCalled());
    await emit("signedOut");
    await act(async () => { release(session); });
    await settled("signedOut");
    expect(current.profile).toBeNull();
  });
  it("configures and restores once under React StrictMode", async () => {
    render(<StrictMode><AuthProvider><Probe /></AuthProvider></StrictMode>);
    await settled("signedIn");
    expect(sdk.configure).toHaveBeenCalledTimes(1);
    expect(sdk.listeners.size).toBe(1);
  });
});

describe("hosted sign-in and sign-out actions", () => {
  it("uses the same honest hosted flow for sign-in and account creation", async () => {
    sdk.session.mockResolvedValue({});
    const first = mount(<SignInPanel createAccount />);
    await settled("signedOut");
    expect(screen.getByText(/then choose its create-account option/)).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Continue to secure sign-in" }));
    await waitFor(() => expect(sdk.redirect).toHaveBeenCalledWith(undefined));
    first.unmount();
    mount(<SignInPanel />);
    await settled("signedOut");
    fireEvent.click(screen.getByRole("button", { name: "Create an account on the hosted page" }));
    await waitFor(() => expect(sdk.redirect).toHaveBeenCalledTimes(2));
  });
  it("starts Google federation only when enabled", async () => {
    sdk.session.mockResolvedValue({});
    mount(<SignInPanel />);
    await settled("signedOut");
    fireEvent.click(screen.getByRole("button", { name: "Continue with Google" }));
    await waitFor(() => expect(sdk.redirect).toHaveBeenCalledWith({ provider: "Google" }));
  });
  it("hides and guards disabled Google federation", async () => {
    sdk.env.mockReturnValue({ ...environment, NEXT_PUBLIC_COGNITO_GOOGLE_ENABLED: "false" });
    sdk.session.mockResolvedValue({});
    mount(<SignInPanel />);
    await settled("signedOut");
    expect(screen.queryByRole("button", { name: "Continue with Google" })).toBeNull();
    await act(async () => { await current.beginSignIn("Google"); });
    expect(sdk.redirect).not.toHaveBeenCalled();
  });
  it("sanitizes redirect errors and re-enables recovery", async () => {
    sdk.session.mockResolvedValue({});
    sdk.redirect.mockRejectedValue(new Error("PRIVATE_REDIRECT_ERROR"));
    mount(<SignInPanel />);
    await settled("signedOut");
    fireEvent.click(screen.getByRole("button", { name: "Continue to secure sign-in" }));
    await settled("error");
    expect(screen.getByRole("alert").textContent).toContain("could not be started");
    expect(document.body.textContent).not.toContain("PRIVATE_REDIRECT_ERROR");
  });
  it("signs out using Amplify's hosted-session logout and drops identity", async () => {
    mount();
    await settled("signedIn");
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await settled("signedOut");
    expect(sdk.signOut).toHaveBeenCalledWith();
    expect(current.profile).toBeNull();
  });
  it("keeps a failed sign-out fail-closed with safe recovery controls", async () => {
    sdk.signOut.mockRejectedValue(new Error("PRIVATE_SIGNOUT_ERROR"));
    mount();
    await settled("signedIn");
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await settled("error");
    expect(current.profile).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain("could not be completed");
    expect(document.body.textContent).not.toContain("PRIVATE_SIGNOUT_ERROR");
  });
});

describe("OAuth callback processing", () => {
  it("waits for SDK exchange success, preserves code/state until processing, and always redirects to /app", async () => {
    callbackUrl();
    mount(<AuthCallbackPage />);
    await waitFor(() => expect(sdk.configure).toHaveBeenCalled());
    expect(current.oauthStatus).toBe("processing");
    expect(current.status).toBe("loading");
    expect(sdk.session).not.toHaveBeenCalled();
    expect(window.location.search).toContain("PRIVATE_CODE");
    expect(window.location.search).toContain("PRIVATE_STATE");
    expect(document.body.textContent).not.toContain("PRIVATE_CODE");
    expect(document.body.textContent).not.toContain("PRIVATE_STATE");
    await emit("signedIn");
    expect(sdk.replace).not.toHaveBeenCalled();
    expect(window.location.search).toContain("PRIVATE_CODE");
    await emit("signInWithRedirect");
    await settled("signedIn");
    await waitFor(() => expect(sdk.replace).toHaveBeenCalledWith("/app"));
    expect(window.location.search).toBe("");
    expect(window.location.hash).toBe("");
    expect(sdk.replace).not.toHaveBeenCalledWith("https://untrusted.test");
  });
  it("does not rewrite workspace URLs when a session fails after callback navigation", async () => {
    callbackUrl();
    mount(<AuthCallbackPage />);
    await waitFor(() => expect(sdk.configure).toHaveBeenCalled());
    await emit("signInWithRedirect");
    await settled("signedIn");
    window.history.replaceState(null, "", "/app/settings?tab=account");
    await emit("tokenRefresh_failure");
    await settled("error");
    expect(window.location.pathname).toBe("/app/settings");
    expect(window.location.search).toBe("?tab=account");
    expect(current.profile).toBeNull();
  });
  it("does not prematurely report signed-out while the callback has no session yet", async () => {
    callbackUrl();
    sdk.session.mockResolvedValue({});
    mount(<AuthCallbackPage />);
    await waitFor(() => expect(sdk.configure).toHaveBeenCalled());
    await emit("signInWithRedirect");
    expect(current.status).toBe("loading");
    expect(window.location.search).toContain("PRIVATE_CODE");
    sdk.session.mockResolvedValue(session);
    await emit("signedIn");
    await settled("signedIn");
    expect(window.location.search).toBe("");
  });
  it("clears callback parameters only after an SDK failure and never exposes raw failure details", async () => {
    callbackUrl("error=access_denied&error_description=PRIVATE_ERROR&state=PRIVATE_STATE");
    mount(<AuthCallbackPage />);
    await waitFor(() => expect(sdk.configure).toHaveBeenCalled());
    expect(window.location.search).toContain("PRIVATE_ERROR");
    await emit("signInWithRedirect_failure", new Error("RAW_OAUTH_ERROR"));
    await settled("error");
    expect(current.oauthStatus).toBe("failed");
    expect(window.location.search).toBe("");
    expect(document.body.textContent).not.toContain("PRIVATE_ERROR");
    expect(document.body.textContent).not.toContain("RAW_OAUTH_ERROR");
    expect(sdk.replace).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "Return to sign-in" }).getAttribute("href")).toBe("/auth/sign-in");
  });
  it("bounds a stalled exchange, clears the code on failure and ignores late completion", async () => {
    vi.useFakeTimers();
    callbackUrl();
    mount(<AuthCallbackPage />);
    await act(async () => { await Promise.resolve(); });
    expect(current.oauthStatus).toBe("processing");
    expect(window.location.search).toContain("PRIVATE_CODE");
    await act(async () => { vi.advanceTimersByTime(OAUTH_WAIT_MS); });
    expect(current.status).toBe("error");
    expect(current.profile).toBeNull();
    expect(window.location.search).toBe("");
    await emit("signInWithRedirect");
    expect(current.status).toBe("error");
    expect(sdk.replace).not.toHaveBeenCalled();
  });
  it.each(["", "code=PRIVATE_CODE", "state=PRIVATE_STATE"])("rejects missing callback arguments: %s", async (query) => {
    callbackUrl(query);
    mount(<AuthCallbackPage />);
    await settled("error");
    expect(current.oauthStatus).toBe("failed");
    expect(window.location.search).toBe("");
    expect(sdk.replace).not.toHaveBeenCalled();
  });
  it("cleans the callback and reports an honest unconfigured state", async () => {
    callbackUrl();
    sdk.env.mockReturnValue({});
    mount(<AuthCallbackPage />);
    await settled("unconfigured");
    expect(window.location.search).toBe("");
    expect(screen.getByRole("alert").textContent).toContain("not configured");
    expect(sdk.replace).not.toHaveBeenCalled();
  });
});
