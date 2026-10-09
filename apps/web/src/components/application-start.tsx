"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, ClipboardList } from "lucide-react";
import { Button } from "@solarsaathi/ui";
import type { BenefitEvaluationResponse } from "../lib/benefits-api";
import { applicationsApi, type CreateApplicationInput, type SolarApplication } from "../lib/applications-api";
import { RoofRequestError } from "../lib/roof-api";
import { ApplicationDetails } from "./application-tracker";

export function ApplicationStart({ response, input }: { response: BenefitEvaluationResponse;
  input: Omit<CreateApplicationInput, "policyId"> }) {
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const [application, setApplication] = useState<SolarApplication>();
  const selected = response.result?.decisions.filter(decision => decision.status === "SELECTED" &&
    (decision.countedAmountPaise ?? 0) > 0) ?? [];

  async function start(policyId: string) {
    setBusy(policyId); setError(undefined);
    try { setApplication(await applicationsApi.create({ ...input, policyId })); }
    catch (cause) { setError(cause instanceof RoofRequestError ? cause.message :
      "The application tracker could not be started. Try again."); }
    finally { setBusy(undefined); }
  }

  if (!selected.length) return null;
  return <section className="tracker-entry" aria-labelledby="tracker-entry-title">
    <div><span><ClipboardList size={17} aria-hidden="true" /> Next in your journey</span>
      <h3 id="tracker-entry-title">Track an application</h3>
      <p>Choose a selected benefit. A tracker opens only when its current, verified policy has a sourced process checklist. Creating a tracker does not submit an official application.</p></div>
    <div className="tracker-entry-actions">{selected.map(decision => <Button key={decision.policyId} type="button"
      variant="outline" onClick={() => void start(decision.policyId)} disabled={!!busy}>
      {busy === decision.policyId ? "Checking process…" : `Start ${decision.scope.toLowerCase()} tracker`}
      <ArrowRight size={15} aria-hidden="true" /></Button>)}</div>
    {error && <p className="form-error" role="alert">{error}</p>}
    {application && <><p className="tracker-notice" role="status">Tracker created from verified policy v{application.policyVersion}.
      <Link href="/app/applications">View all applications</Link></p><ApplicationDetails key={application.applicationId} initial={application} /></>}
  </section>;
}
