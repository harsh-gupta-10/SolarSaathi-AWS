"use client";

import Link from "next/link";
import { ArrowRight, Building2, Check, FileCheck2, KeyRound, Lock, Search, Sun, Users } from "lucide-react";
import { Button } from "@solarsaathi/ui";
import { AddressForm } from "./address-form";
import { useWorkspaceRole } from "./workspace-role";
import { BrokerWorkspace } from "./broker-workspace";
import { useAuth } from "../auth/auth-provider";

export function WorkspaceOverview() {
  const { role } = useWorkspaceRole();
  const auth = useAuth();
  const status = auth?.status ?? "unconfigured";
  const configured = auth?.configured ?? false;
  const googleEnabled = auth?.googleEnabled ?? false;
  const beginSignIn = auth?.beginSignIn;
  const busy = status === "loading";
  const broker = role === "BROKER";

  if (broker) return <BrokerWorkspace section="overview" />;

  return (
    <>
      {status !== "signedIn" && (
        <section
          className="mb-8 rounded-2xl border-2 border-primary/25 bg-card p-6 shadow-sm transition-all hover:border-primary/45"
          aria-labelledby="auth-prompt-title"
        >
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
                <Lock className="size-3.5" aria-hidden="true" />
                <span>Account sign-in recommended</span>
              </div>
              <h2 id="auth-prompt-title" className="text-2xl font-bold tracking-tight text-foreground">
                Connect your account
              </h2>
              <p className="max-w-xl text-sm text-muted-foreground leading-relaxed">
                Sign in with <strong>Google</strong> or <strong>Amazon Cognito</strong> to save satellite roof measurements, calculate verified Indian government subsidies (PM Surya Ghar &amp; Maharashtra policies), and export proposals.
              </p>
            </div>
            <div className="flex flex-col gap-2.5 sm:min-w-64">
              <Button
                type="button"
                className="w-full flex items-center justify-center gap-2.5 bg-primary font-medium text-primary-foreground shadow-sm hover:opacity-95"
                disabled={!configured || busy || !beginSignIn}
                onClick={() => void beginSignIn?.(googleEnabled ? "Google" : undefined)}
              >
                <svg className="size-4" viewBox="0 0 24 24" aria-hidden="true">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
                </svg>
                <span>Continue with Google</span>
              </Button>
              <Button
                type="button"
                variant="outline"
                className="w-full flex items-center justify-center gap-2 border-input font-medium hover:bg-muted"
                disabled={!configured || busy || !beginSignIn}
                onClick={() => void beginSignIn?.()}
              >
                <KeyRound className="size-4 text-muted-foreground" aria-hidden="true" />
                <span>Sign in with Amazon / Email</span>
              </Button>
              <div className="flex items-center justify-between text-xs text-muted-foreground pt-1">
                <Link href="/auth/sign-in" className="underline underline-offset-4 hover:text-foreground">
                  Hosted login
                </Link>
                <span>•</span>
                <span className="text-muted-foreground/80">Guest preview enabled below</span>
              </div>
            </div>
          </div>
        </section>
      )}

      <div className="page-heading">
        <p className="muted">{broker ? "Consultant workspace" : "Homeowner workspace"}</p>
        <h1>{broker ? "Clarity for every customer." : "Start with the roof you have."}</h1>
        <p>{broker ? "Keep customer decisions and their source trails in one place." : "A good solar decision starts with confirmed measurements, not guesses."}</p>
      </div>

      <section className="workspace-start" aria-labelledby="start-title">
        <div className="start-icon">{broker ? <Users aria-hidden="true" /> : <Sun aria-hidden="true" />}</div>
        <h2 id="start-title">{broker ? "Your customer workspace is taking shape" : "Plan your first rooftop"}</h2>
        <p>
          {broker
            ? "Start with a customer name and property address. Your account and the analysis service must be connected to save the assessment."
            : "Save a property address as a draft, then inspect the building and confirm roof measurements when your account and analysis service are connected."}
        </p>
        <AddressForm compact />
      </section>

      <section aria-labelledby="next-title">
        <div className="section-heading compact">
          <h2 id="next-title">What comes next</h2>
          <p>Each step opens when the underlying information is ready.</p>
        </div>
        <ol className="workspace-steps">
          <li>
            <Search aria-hidden="true" />
            <div>
              <h3>Confirm the building and roof</h3>
              <p>Google Solar or your own measurements need your confirmation before system design.</p>
            </div>
            <span>Available when connected</span>
          </li>
          <li>
            <FileCheck2 aria-hidden="true" />
            <div>
              <h3>Compare costs and compatible benefits</h3>
              <p>Policy versions and sources accompany every eligible amount.</p>
            </div>
            <span>In development</span>
          </li>
          <li>
            <Check aria-hidden="true" />
            <div>
              <h3>Follow the application process</h3>
              <p>A checklist tied to the applicable verified policy.</p>
            </div>
            <span>In development</span>
          </li>
        </ol>
      </section>

      <div className="workspace-help">
        <Building2 aria-hidden="true" />
        <p>Your address stays in this tab until you start an authenticated assessment. Saved measurements are shown only after the API confirms them.</p>
        <Button asChild variant="ghost">
          <Link href="/app/help">How this works<ArrowRight aria-hidden="true" /></Link>
        </Button>
      </div>
    </>
  );
}
