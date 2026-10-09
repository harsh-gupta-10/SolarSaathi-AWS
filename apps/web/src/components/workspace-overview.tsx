"use client";

import Link from "next/link";
import { ArrowRight, Building2, Check, FileCheck2, Search, Sun, Users } from "lucide-react";
import { Button } from "@solarsaathi/ui";
import { AddressForm } from "./address-form";
import { useWorkspaceRole } from "./workspace-role";
import { BrokerWorkspace } from "./broker-workspace";

export function WorkspaceOverview() {
  const { role } = useWorkspaceRole();
  const broker = role === "BROKER";
  if (broker) return <BrokerWorkspace section="overview" />;
  return <>
    <div className="page-heading"><p className="muted">{broker ? "Consultant workspace" : "Homeowner workspace"}</p><h1>{broker ? "Clarity for every customer." : "Start with the roof you have."}</h1><p>{broker ? "Keep customer decisions and their source trails in one place." : "A good solar decision starts with confirmed measurements, not guesses."}</p></div>
    <section className="workspace-start" aria-labelledby="start-title">
      <div className="start-icon">{broker ? <Users aria-hidden="true" /> : <Sun aria-hidden="true" />}</div>
      <h2 id="start-title">{broker ? "Your customer workspace is taking shape" : "Plan your first rooftop"}</h2>
      <p>{broker ? "Start with a customer name and property address. Your account and the analysis service must be connected to save the assessment." : "Save a property address as a draft, then inspect the building and confirm roof measurements when your account and analysis service are connected."}</p>
      <AddressForm compact />
    </section>
    <section aria-labelledby="next-title"><div className="section-heading compact"><h2 id="next-title">What comes next</h2><p>Each step opens when the underlying information is ready.</p></div><ol className="workspace-steps">
      <li><Search aria-hidden="true" /><div><h3>Confirm the building and roof</h3><p>Google Solar or your own measurements need your confirmation before system design.</p></div><span>Available when connected</span></li>
      <li><FileCheck2 aria-hidden="true" /><div><h3>Compare costs and compatible benefits</h3><p>Policy versions and sources accompany every eligible amount.</p></div><span>In development</span></li>
      <li><Check aria-hidden="true" /><div><h3>Follow the application process</h3><p>A checklist tied to the applicable verified policy.</p></div><span>In development</span></li>
    </ol></section>
    <div className="workspace-help"><Building2 aria-hidden="true" /><p>Your address stays in this tab until you start an authenticated assessment. Saved measurements are shown only after the API confirms them.</p><Button asChild variant="ghost"><Link href="/app/help">How this works<ArrowRight aria-hidden="true" /></Link></Button></div>
  </>;
}
