import type { Metadata } from "next";
import Link from "next/link";
import { designSolarSystem, getSystemDesignAssumptionsV1 } from "@solarsaathi/calculations";
import { RoofLayoutViewer } from "../../../components/roof-layout-viewer";
import { SystemDesignResults } from "../../../components/system-design-results";
import { demoRoof } from "../fixtures";

export const metadata: Metadata = { title: "System designer demo | SolarSaathi" };

// Synthetic inputs for visual QA only. This calculation never contacts an API or represents a live property.
const demoDesign = designSolarSystem(demoRoof,
  { kind: "CONSUMPTION", monthlyConsumptionKwh: 300, sanctionedLoadKw: 1.5 },
  getSystemDesignAssumptionsV1(demoRoof));

export default function SystemDesignerDemoPage() {
  return <main className="container py-10 md:py-16">
    <p className="mb-4 text-sm"><Link href="/app/analyze" className="text-primary underline underline-offset-4">← Back to roof analysis</Link></p>
    <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950" role="note"><strong>Demo fixture.</strong> This page uses a synthetic 10 × 10 m roof, 300 kWh/month electricity use and a 1.5 kW sanctioned load for local review context. It is not a live assessment or interconnection approval. No API request is made.</div>
    <RoofLayoutViewer roof={demoRoof} analysisId="system-demo-fixture-only" />
    <section className="system-designer" aria-labelledby="demo-system-title">
      <div className="system-designer-heading"><div><span className="system-designer-kicker">Deterministic demo result</span><h2 id="demo-system-title">Compare system sizes</h2><p>These results are calculated from the synthetic inputs above. In the application, a signed-in user supplies demand and receives a result for their confirmed roof from the backend.</p></div></div>
      <SystemDesignResults design={demoDesign} analysisId="demo-fixture-only" demo />
    </section>
  </main>;
}
