"use client";

import Link from "next/link";
import { Button } from "@solarsaathi/ui";
import { useAuth } from "./auth-provider";
import { ApiIdentityPanel } from "./api-identity-panel";

export function AccountPanel() {
  const { status, profile, error, configured, refresh, signOut } = useAuth();
  return (
    <section className="surface-card space-y-5 p-6" aria-labelledby="account-title">
      <h2 id="account-title">Your account</h2>
      {status === "loading" && <p role="status">Checking your account…</p>}
      {status === "unconfigured" && <p role="status">Account sign-in is not configured for this deployment.</p>}
      {error && <p role="alert">{error}</p>}
      {status === "signedIn" && profile && (
        <>
          <dl className="grid gap-3 break-words">
            <div><dt className="text-sm text-muted-foreground">Name</dt><dd>{profile.name || "Not provided"}</dd></div>
            <div><dt className="text-sm text-muted-foreground">Email</dt><dd>{profile.email || "Not provided"}</dd></div>
            <div><dt className="text-sm text-muted-foreground">Account ID</dt><dd>{profile.cognitoSub}</dd></div>
            <div><dt className="text-sm text-muted-foreground">Account role (identity display)</dt><dd>{profile.role === "BROKER" ? "Broker" : "Homeowner"}</dd></div>
            <div><dt className="text-sm text-muted-foreground">Organization</dt><dd>{profile.organizationId || "No organization assigned"}</dd></div>
          </dl>
          <Button variant="outline" onClick={() => void signOut()}>Sign out</Button>
        </>
      )}
      {status === "signedOut" && <Button asChild><Link href="/auth/sign-in">Sign in to your account</Link></Button>}
      {configured && status === "error" && (
        <div className="auth-actions">
          <Button variant="outline" onClick={() => void refresh()}>Check session again</Button>
          <Button asChild><Link href="/auth/sign-in">Sign in again</Link></Button>
          <Button variant="ghost" onClick={() => void signOut()}>Sign out</Button>
        </div>
      )}
      <ApiIdentityPanel />
      <p className="text-sm text-muted-foreground">These details show your Cognito identity only. Workspace access, organization membership and ownership must be verified by the backend.</p>
    </section>
  );
}
