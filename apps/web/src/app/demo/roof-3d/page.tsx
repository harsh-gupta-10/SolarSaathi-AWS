import type { Metadata } from "next";
import Link from "next/link";
import { RoofLayoutViewer } from "../../../components/roof-layout-viewer";
import { demoRoof } from "../fixtures";

export const metadata: Metadata = { title: "3D roof demo | SolarSaathi" };

export default function Roof3dDemoPage() {
  return <main className="container py-10 md:py-16">
    <p className="mb-4 text-sm"><Link href="/app/analyze" className="text-primary underline underline-offset-4">← Back to roof analysis</Link></p>
    <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950" role="note">
      <strong>Demo fixture.</strong> This is a synthetic 10 × 10 m roof used to demonstrate the viewer. It is not a property assessment, a solar design, or a structural finding. No live API data is used.
    </div>
    <RoofLayoutViewer roof={demoRoof} analysisId="demo-fixture-only" />
  </main>;
}
