import type { Metadata } from "next";
import Link from "next/link";
import { FinancialResults } from "../../../components/financial-results";
import { PolicyFinancialResults } from "../../../components/policy-financial-results";
import { demoFinancialResponse } from "../system-financial-fixture";
import { demoPolicyFinancialResponse } from "../policy-financial-fixture";

export const metadata: Metadata = { title: "Policy financial demo | SolarSaathi", robots: { index: false, follow: false } };

export default function PolicyFinancialDemoPage() {
  return <main className="container py-10 md:py-16">
    <p className="mb-4 text-sm"><Link href="/demo/system-designer" className="text-primary underline underline-offset-4">← Back to system demo</Link></p>
    <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950" role="note"><strong>Synthetic policy demo.</strong> The benefit, policy version, citation, quote and energy values on this page are fictional test fixtures. No live policy was checked and no API request was made. Actual benefits require current official sources and application approval.</div>
    <FinancialResults response={demoFinancialResponse} demo />
    <PolicyFinancialResults response={demoPolicyFinancialResponse} />
  </main>;
}
