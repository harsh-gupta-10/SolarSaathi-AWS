"use client";

import {
  createContext, useCallback, useContext, useEffect, useRef, useState,
  type ReactNode,
} from "react";
import {
  fetchAuthSession, fetchUserAttributes, getCurrentUser,
  signInWithRedirect, signOut as sdkSignOut,
} from "aws-amplify/auth";
import { Hub } from "aws-amplify/utils";
import { getAuthConfiguration } from "./auth-config";
import { getAuthProfile, type AuthProfile } from "./auth-profile";
import { configureCognitoClient } from "./auth-client";

export type AuthStatus = "unconfigured" | "loading" | "signedOut" | "signedIn" | "error";
export type OAuthStatus = "idle" | "processing" | "complete" | "failed";
export const OAUTH_WAIT_MS = 30_000;
const SESSION_ERROR = "Your session could not be verified. Please sign in again.";
const CALLBACK_ERROR = "Sign-in could not be completed. Please start a new sign-in.";
const CONFIG_ERROR = "Sign-in is unavailable for this deployment. Please contact support.";

export interface AuthContextValue {
  status: AuthStatus;
  profile: AuthProfile | null;
  error: string | null;
  configured: boolean;
  googleEnabled: boolean;
  oauthStatus: OAuthStatus;
  beginSignIn: (provider?: "Google") => Promise<void>;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

type AuthState = Pick<AuthContextValue, "status" | "profile" | "error">;
type Actions = Pick<AuthContextValue, "beginSignIn" | "refresh" | "signOut">;
const AuthContext = createContext<AuthContextValue | null>(null);

function clearCallbackParameters() {
  // Strip all callback data, including untrusted return URLs and OAuth errors.
  window.history.replaceState(window.history.state, "", "/auth/callback");
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading", profile: null, error: null });
  const [configured, setConfigured] = useState(false);
  const [googleEnabled, setGoogleEnabled] = useState(false);
  const [oauthStatus, setOAuthStatus] = useState<OAuthStatus>("idle");
  const actions = useRef<Actions | null>(null);

  useEffect(() => {
    let active = true;
    let ready = false;
    let oauthCompleted = false;
    let revision = 0;
    let callback: OAuthStatus = "idle";
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const isCallback = window.location.pathname === "/auth/callback";
    const config = getAuthConfiguration(window.location.origin);
    const update = (next: AuthState) => { if (active) setState(next); };
    const finishCallback = (next: "complete" | "failed") => {
      if (!active) return;
      callback = next;
      clearTimeout(timeout);
      clearCallbackParameters();
      setOAuthStatus(next);
    };
    const fail = (message = SESSION_ERROR) => {
      revision += 1;
      if (callback === "processing") finishCallback("failed");
      update({ status: "error", profile: null, error: message });
    };
    const restore = async (forceRefresh = false) => {
      if (!active || !ready || config.status !== "ready" || callback === "failed" ||
        (callback === "processing" && !oauthCompleted)) return;
      const request = ++revision;
      update({ status: "loading", profile: null, error: null });
      try {
        const session = await fetchAuthSession({ forceRefresh });
        if (!active || request !== revision) return;
        if (!session.tokens) {
          // Amplify's asynchronous PKCE exchange may still be in flight.
          if (callback === "processing") return;
          update({ status: "signedOut", profile: null, error: null });
          return;
        }
        const [user, attributes] = await Promise.all([getCurrentUser(), fetchUserAttributes()]);
        if (!active || request !== revision) return;
        const profile = getAuthProfile(user, session, attributes);
        if (callback === "processing") finishCallback("complete");
        update({ status: "signedIn", profile, error: null });
      } catch {
        if (active && request === revision) fail(callback === "processing" ? CALLBACK_ERROR : SESSION_ERROR);
      }
    };

    if (config.status !== "ready") {
      if (isCallback) finishCallback("failed");
      update({ status: config.status, profile: null, error: config.status === "error" ? CONFIG_ERROR : null });
      return () => { active = false; };
    }

    const params = new URLSearchParams(window.location.search);
    if (isCallback) {
      callback = "processing";
      setOAuthStatus("processing");
      timeout = setTimeout(() => fail(CALLBACK_ERROR), OAUTH_WAIT_MS);
    }
    const unsubscribe = Hub.listen("auth", ({ payload }) => {
      if (!active || callback === "failed") return;
      switch (payload.event) {
        case "signInWithRedirect":
          oauthCompleted = true;
          void restore();
          break;
        case "signedIn":
        case "tokenRefresh":
          void restore();
          break;
        case "signedOut":
          revision += 1;
          if (callback === "processing") { fail(CALLBACK_ERROR); break; }
          update({ status: "signedOut", profile: null, error: null });
          break;
        case "tokenRefresh_failure":
          fail();
          break;
        case "signInWithRedirect_failure":
          fail(CALLBACK_ERROR);
          break;
      }
    });

    actions.current = {
      refresh: () => restore(true),
      beginSignIn: async (provider) => {
        if (!active || !ready) return;
        if (provider === "Google" && !config.googleEnabled) {
          fail("Google sign-in is not enabled. Please use the secure sign-in page.");
          return;
        }
        revision += 1;
        update({ status: "loading", profile: null, error: null });
        try {
          await signInWithRedirect(provider ? { provider } : undefined);
        } catch {
          fail("Sign-in could not be started. Please try again.");
        }
      },
      signOut: async () => {
        if (!active || !ready) return;
        revision += 1;
        update({ status: "loading", profile: null, error: null });
        try {
          // Amplify also redirects through Cognito logout for hosted sessions.
          await sdkSignOut();
          update({ status: "signedOut", profile: null, error: null });
        } catch {
          fail("Sign-out could not be completed. Please try again.");
        }
      },
    };

    async function initialize() {
      try {
        // Register the OAuth listener before configuring; it handles code + PKCE.
        await import("aws-amplify/auth/enable-oauth-listener");
        if (!active || config.status !== "ready") return;
        configureCognitoClient(config, window.location.protocol);
        ready = true;
        setConfigured(true);
        setGoogleEnabled(config.googleEnabled);
        if (isCallback && !params.has("error") && (!params.get("code") || !params.get("state"))) {
          fail(CALLBACK_ERROR);
          return;
        }
        if (!isCallback) await restore();
      } catch {
        ready = false;
        setConfigured(false);
        fail(isCallback ? CALLBACK_ERROR : CONFIG_ERROR);
      }
    }
    void initialize();
    return () => {
      active = false;
      revision += 1;
      clearTimeout(timeout);
      unsubscribe?.();
      actions.current = null;
    };
  }, []);

  const beginSignIn = useCallback(async (provider?: "Google") => { await actions.current?.beginSignIn(provider); }, []);
  const refresh = useCallback(async () => { await actions.current?.refresh(); }, []);
  const signOut = useCallback(async () => { await actions.current?.signOut(); }, []);
  return (
    <AuthContext.Provider value={{ ...state, configured, googleEnabled, oauthStatus, beginSignIn, refresh, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth requires AuthProvider");
  return context;
}
