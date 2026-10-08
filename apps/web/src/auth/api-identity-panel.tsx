"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@solarsaathi/ui";
import { useAuth } from "./auth-provider";
import { BackendIdentityError, identityEndpoint, verifyBackendIdentity } from "./backend-identity";

export function ApiIdentityPanel() {
  const { status, profile } = useAuth();
  const [state, setState] = useState<"idle" | "checking" | "verified" | "error">("idle");
  const [message, setMessage] = useState("");
  const active = useRef<AbortController | null>(null);
  const configured = Boolean(identityEndpoint());
  const userId = profile?.cognitoSub;
  useEffect(() => {
    active.current?.abort();
    setState("idle"); setMessage("");
    return () => active.current?.abort();
  }, [userId, status]);
  async function check() {
    if (status !== "signedIn" || !userId || !configured) return;
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setState("checking"); setMessage("");
    try {
      await verifyBackendIdentity(userId, controller.signal);
      if (!controller.signal.aborted) setState("verified");
    } catch (error) {
      if (!controller.signal.aborted) {
        setState("error");
        setMessage(error instanceof BackendIdentityError ? error.message : "The identity service is unavailable. Try again later.");
      }
    }
  }
  return <section className="space-y-3 rounded-lg border border-border p-4" aria-labelledby="api-identity-title">
    <h3 id="api-identity-title">Backend identity connection</h3>
    {!configured ? <p className="text-sm text-muted-foreground">The backend API is not configured yet. No identity check has been performed.</p> : <>
      <p className="text-sm text-muted-foreground">Check that the API accepts your current Cognito access token. This does not confirm property ownership or organization membership.</p>
      <Button variant="outline" disabled={status !== "signedIn" || !userId || state === "checking"} onClick={() => void check()}>{state === "checking" ? "Checking API identity…" : "Verify API connection"}</Button>
    </>}
    {state === "verified" && <p role="status">Backend identity verified for the current session.</p>}
    {state === "error" && <p role="alert">{message}</p>}
  </section>;
}
