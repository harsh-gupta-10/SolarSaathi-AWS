import type { Metadata } from "next";
import Link from "next/link";
import { RoofLayoutViewer } from "../../../components/roof-layout-viewer";
import { SystemDesignResults } from "../../../components/system-design-results";
import { FinancialResults } from "../../../components/financial-results";
import { demoRoof } from "../fixtures";
import { demoDesign, demoFinancialResponse } from "../system-financial-fixture";

export const metadata: Metadata = { title: "System designer demo | SolarSaathi" };

export default function SystemDesignerDemoPage() {
  return <main className="container py-10 md:py-16">
    <p className="mb-4 text-sm"><Link href="/app/analyze" className="text-primary underline underline-offset-4">← Back to roof analysis</Link></p>
    <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950" role="note"><strong>Demo fixture.</strong> This page uses a synthetic 10 × 10 m roof, 300 kWh/month electricity use, a 1.5 kW sanctioned load for review context, and a hypothetical ₹2,00,000 installed quote with explicit tariff and maintenance assumptions. It is not a live assessment, vendor offer, or interconnection approval. No API request is made.</div>
    <RoofLayoutViewer roof={demoRoof} analysisId="system-demo-fixture-only" />
    <section className="system-designer" aria-labelledby="demo-system-title">
      <div className="system-designer-heading"><div><span className="system-designer-kicker">Deterministic demo result</span><h2 id="demo-system-title">Compare system sizes</h2><p>These results are calculated from the synthetic inputs above. In the application, a signed-in user supplies demand and receives a result for their confirmed roof from the backend.</p></div></div>
      <SystemDesignResults design={demoDesign} analysisId="demo-fixture-only" demo />
      <FinancialResults response={demoFinancialResponse} demo />
    </section>
  </main>;
}
