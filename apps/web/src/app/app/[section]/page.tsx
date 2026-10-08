import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, FileCheck2, Layers } from "lucide-react";
import { Button } from "@solarsaathi/ui";
import { navigationItem, sectionKeys } from "../../../lib/navigation";
import { AnalyzeStart } from "../../../components/analyze-start";
import { AccountPanel } from "../../../auth/account-panel";

export function generateStaticParams() { return sectionKeys().map(section => ({ section })); }
export default async function WorkspaceSection({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  const item = navigationItem(section);
  if (!item || section === "overview") notFound();
  if (section === "analyze") return <AnalyzeStart />;
  if (section === "benefits") return <><div className="page-heading"><h1>Government Benefits</h1><p>See verified incentives for a saved roof and compatible system.</p></div>
    <section className="benefits-entry" aria-labelledby="benefits-entry-title"><div><span>Policy checked · India</span>
      <h2 id="benefits-entry-title">Start with your property assessment</h2>
      <p>Benefit rules depend on the installation, property, customer and scheme. Confirm a roof, compare system sizes and enter a gross quote to evaluate eligibility. The result explains included, excluded and unknown benefits with official sources.</p>
      <Button asChild><Link href="/app/analyze">Analyze a roof <ArrowRight size={16} aria-hidden="true" /></Link></Button></div>
      <div className="benefits-entry-notes"><FileCheck2 size={27} aria-hidden="true" /><h3>How results are handled</h3><ul>
        <li>Only active rules approved by a policy administrator can produce an amount.</li>
        <li>Compatibility, exclusions and caps are evaluated together.</li>
        <li>Incomplete policy coverage and unanswered eligibility questions stay visible.</li>
      </ul></div></section></>;
  if (section === "settings") return <><div className="page-heading"><h1>Account and workspace</h1><p>Your identity, role and organization details.</p></div><AccountPanel /></>;
  if (section === "help") return <><div className="page-heading"><h1>A clearer journey, step by step.</h1><p>What the workspace can do, and what comes next.</p></div><section className="help-content"><details open><summary>What can I do now?</summary><p>Save an address draft in this browser tab. When sign-in and the analysis API are configured, you can select a building or enter measurements manually, confirm the roof, compare system sizes, model base cash flow and check published benefit rules.</p></details><details><summary>Where is my address stored?</summary><p>The draft stays in this browser tab. Starting an authenticated assessment creates a property through the backend API. Clear the draft from Analyze Roof when you no longer need it.</p></details><details><summary>Are rooftop concepts engineering approvals?</summary><p>No. Concepts are inspirational. Confirmed geometry can establish only space feasibility, not the structural safety of an addition.</p></details><details><summary>Are benefits guaranteed?</summary><p>No. Benefits require verified rules, compatibility checks and official processing. No subsidy amount is shown until those checks can be performed.</p></details></section></>;
  return <><div className="page-heading"><h1>{item.label}</h1><p>{item.description}</p></div><section className="feature-empty" aria-labelledby="feature-state"><Layers size={36} aria-hidden="true" /><h2 id="feature-state">This part of your journey is in development.</h2><p>Planned for Phase {item.phase}. No live data or sample results are presented here.</p><Button asChild variant="outline"><Link href="/app"><ArrowLeft aria-hidden="true" />Back to overview</Link></Button></section></>;
}
