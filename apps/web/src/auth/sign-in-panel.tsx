"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Button } from "@solarsaathi/ui";
import { consumeReturnTo, rememberReturnTo } from "../lib/return-to";
import { useAuth } from "./auth-provider";

export function SignInPanel({ createAccount = false }: { createAccount?: boolean }) {
  const { status, configured, error, beginSignIn, refresh } = useAuth();
  const router = useRouter();
  const busy = status === "loading";

  useEffect(() => {
    // The hosted sign-in redirect leaves this page, so remember where the user was heading.
    rememberReturnTo(new URLSearchParams(window.location.search).get("returnTo"));
  }, []);

  useEffect(() => {
    if (status === "signedIn") router.replace(consumeReturnTo());
  }, [status, router]);
  return (
    <main className="auth-page">
      <section className="auth-card space-y-6" aria-labelledby="auth-title">
        <Link href="/" className="text-sm font-semibold">SolarSaathi</Link>
        <div className="space-y-3">
          <p className="eyebrow">Your solar workspace</p>
          <h1 id="auth-title">{createAccount ? "Create your account" : "Welcome to SolarSaathi"}</h1>
          <p>Sign in securely with Amazon Cognito. Its hosted page handles sign-in, account creation, verification, MFA and password reset.</p>
          {createAccount && <p>Continue to the hosted sign-in page, then choose its create-account option.</p>}
        </div>
        {status === "unconfigured" && (
          <p role="status">Account sign-in is not configured for this deployment. No demo or simulated login is available.</p>
        )}
        {busy && <p role="status" aria-live="polite">Checking your session or opening secure sign-in…</p>}
        {error && <p role="alert">{error}</p>}
        {status === "signedIn" ? (
          <Button asChild><Link href="/app">Continue to your workspace</Link></Button>
        ) : (
          <div className="auth-actions">
            <Button disabled={!configured || busy} onClick={() => void beginSignIn()}>
              {createAccount ? "Continue to create your account" : "Sign in or create an account"}
            </Button>
            {configured && status === "error" && (
              <Button variant="ghost" onClick={() => void refresh()}>Check session again</Button>
            )}
          </div>
        )}
        <p className="text-sm text-muted-foreground">Account identity does not grant access to private data. The backend verifies permissions separately.</p>
        <Link href="/demo" className="text-sm underline underline-offset-4">Explore the guided demo without an account</Link>
      </section>
    </main>
  );
}
