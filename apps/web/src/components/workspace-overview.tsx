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
                Sign in with your email address and password to save satellite roof measurements, calculate verified Indian government subsidies (PM Surya Ghar &amp; Maharashtra policies), and manage your properties.
              </p>
            </div>
            <div className="flex flex-col gap-2.5 sm:min-w-64">
              <Button
                type="button"
                className="w-full flex items-center justify-center gap-2 bg-primary font-medium text-primary-foreground shadow-sm hover:opacity-95"
                disabled={!configured || busy || !beginSignIn}
                onClick={() => void beginSignIn?.()}
              >
                <KeyRound className="size-4" aria-hidden="true" />
                <span>Sign in with Email &amp; Password</span>
              </Button>
              <div className="flex items-center justify-between text-xs text-muted-foreground pt-1">
                <Link href="/auth/sign-in" className="underline underline-offset-4 hover:text-foreground">
                  Login &amp; Register page
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
