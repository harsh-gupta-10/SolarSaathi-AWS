import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Building2, ClipboardList, FileText, Sun, Users } from "lucide-react";

export const metadata: Metadata = { title: "Broker workspace demo | SolarSaathi", robots: { index: false, follow: false } };

export default function BrokerDemoPage() {
  return <main className="container py-10 md:py-16"><p className="mb-4 text-sm"><Link href="/app"
    className="font-medium text-primary underline underline-offset-4">← Back to workspace</Link></p>
    <div className="mb-6 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950" role="note">
      <strong>Synthetic broker workspace demo.</strong> Every customer, property, roof, lead and status below is fictional.
      No live account, proposal, official policy, customer contact or application portal was accessed.</div>
    <div className="broker-workspace"><header className="broker-hero"><div><div className="broker-hero-mark"><Sun size={20} aria-hidden="true" />SolarSaathi for consultants</div>
      <h1>One clear record for every rooftop.</h1><p>This offline layout shows how a broker can move from a customer record to a roof assessment and a source-backed proposal.</p></div>
      <div className="broker-hero-model" aria-hidden="true"><span className="broker-model-base" /><span className="broker-model-roof" /><span className="broker-model-solar" /><span className="broker-model-sun" /></div></header>
      <div className="broker-pulse" aria-label="Fictional record counts"><div><Users aria-hidden="true" /><span>Fictional customers</span><strong>2</strong></div><div><Building2 aria-hidden="true" /><span>Fictional properties</span><strong>2</strong></div><div><ClipboardList aria-hidden="true" /><span>Fictional leads</span><strong>1</strong></div></div>
      <div className="broker-columns"><section className="broker-panel" aria-labelledby="demo-customers-title"><div className="broker-panel-head"><div><h2 id="demo-customers-title">Example customers</h2><p>Read-only test fixture</p></div><Users aria-hidden="true" /></div>
        <ul className="broker-compact-list"><li><strong>Demo customer A</strong><span>Example home · fictional Pune address</span><small>Illustration only</small></li><li><strong>Demo customer B</strong><span>Example home · fictional Nagpur address</span><small>Illustration only</small></li></ul></section>
        <div className="broker-detail-stack"><section className="broker-panel" aria-labelledby="demo-flow-title"><div className="broker-panel-head"><div><h2 id="demo-flow-title">Example proposal flow</h2><p>What the connected workspace asks for.</p></div><FileText aria-hidden="true" /></div>
          <ol className="broker-demo-steps"><li>Choose a customer and one of their saved properties.</li><li>Choose a confirmed, unexpired roof analysis.</li><li>Enter a real quote, energy assumptions and known applicant facts.</li><li>Review the deterministic estimate and cited policy decisions, then save a private snapshot.</li></ol>
          <p className="broker-help">No amount, eligibility result, document or government status is claimed by this demo.</p></section>
          <section className="broker-panel" aria-labelledby="demo-status-title"><div className="broker-panel-head"><div><h2 id="demo-status-title">Status boundaries</h2><p>Illustrative copy in the live workflow.</p></div><ClipboardList aria-hidden="true" /></div>
            <p className="broker-help">Application steps are user reported. Rooftop images are inspirational. Saved proposals are as-of snapshots and need policy rechecking before sharing.</p></section></div></div>
      <div className="broker-demo-next"><Link href="/app/customers">Open connected customer workspace <ArrowRight size={16} aria-hidden="true" /></Link></div>
    </div></main>;
}
