import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Globe2, ShieldAlert } from "lucide-react";

export const metadata: Metadata = { title: "International research demo | SolarSaathi", robots: { index: false, follow: false } };

export default function InternationalDemoPage() {
  return <main className="container py-10 md:py-16"><p className="mb-4 text-sm"><Link href="/app/international"
    className="font-medium text-primary underline underline-offset-4">← Back to source research</Link></p>
    <div className="mb-6 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950" role="note">
      <strong>Synthetic international research demo.</strong> The country, source and retrieval date below are fictional UI examples.
      No location was requested, authority page was fetched, policy was verified, or benefit was calculated.</div>
    <div className="international-workspace"><header className="international-hero"><div><span><Globe2 size={18} aria-hidden="true" /> International source research</span>
      <h1>Know what is sourced before you decide.</h1><p>This offline example illustrates the evidence and coverage limits of a connected source check.</p></div>
      <div className="international-globe" aria-hidden="true"><span className="international-globe-sphere" /><span className="international-globe-ring one" /><span className="international-globe-ring two" /><span className="international-globe-pin" /></div></header>
      <section className="international-result" aria-labelledby="demo-international-title"><div className="international-result-head"><div><span className="international-result-status" data-status="INCOMPLETE">Fictional example · incomplete</span>
        <h2 id="demo-international-title">Example country source check</h2><p>Example region · utility not supplied</p></div><ShieldAlert aria-hidden="true" /></div>
        <div className="international-evidence-strip"><div><span>Retrieved</span><strong>Illustrative timestamp only</strong></div><div><span>Country identified by</span><strong>Fictional form entry</strong></div><div><span>Research copy</span><strong>Nothing stored in this demo</strong></div></div>
        <div className="international-boundary" role="note"><ShieldAlert size={19} aria-hidden="true" /><p>The connected lookup reports only selected source pages. A listed source does not establish countrywide coverage, eligibility, subsidy amount or application approval.</p></div>
        <div className="international-source-head"><div><h3>What a source card would show</h3><p>In the connected result, check the authority website, source date and retrieval time.</p></div><strong>1</strong></div>
        <ul className="international-sources"><li><div><span>Fictional example · not a policy source</span><h4>Example solar information page</h4><p>Fictional publisher: example.invalid</p></div>
          <dl><div><dt>Source date</dt><dd>Unknown</dd></div><div><dt>Retrieved</dt><dd>Illustrative only</dd></div></dl><p>example.invalid/solar-example · deliberately not linked</p></li></ul>
        <p className="international-request">No live source, policy amount or eligibility decision is included in this demo.</p></section>
      <div className="broker-demo-next"><Link href="/app/international">Open connected research <ArrowRight size={16} aria-hidden="true" /></Link></div></div></main>;
}
