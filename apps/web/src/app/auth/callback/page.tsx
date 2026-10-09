"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@solarsaathi/ui";
import { useAuth } from "../../../auth/auth-provider";

export default function AuthCallbackPage() {
  const { status, oauthStatus, error } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (status === "signedIn") router.replace("/app");
  }, [status, router]);
  const failed = status === "error" || status === "unconfigured" || oauthStatus === "failed";
  return (
    <main className="auth-page">
      <section className="auth-card space-y-6" aria-labelledby="callback-title">
        <h1 id="callback-title">{failed ? "Sign-in needs another try" : "Completing secure sign-in"}</h1>
        {failed ? (
          <>
            <p role="alert">{error || "Account sign-in is not configured for this deployment."}</p>
            <Button asChild><Link href="/auth/sign-in">Return to sign-in</Link></Button>
          </>
        ) : (
          <p role="status" aria-live="polite">
            {oauthStatus === "complete" ? "Signed in. Opening your workspace…" : "Verifying your account. Please keep this page open…"}
          </p>
        )}
      </section>
    </main>
  );
}
