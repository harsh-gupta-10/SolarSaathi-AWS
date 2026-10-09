import type { Metadata } from "next";
import Link from "next/link";
import { AccessoriesResult } from "../../../components/accessories-workspace";
import type { AccessoriesResponse } from "../../../lib/accessories-api";
import { demoFinancialResponse } from "../system-financial-fixture";

export const metadata: Metadata = { title: "Accessories demo | SolarSaathi", robots: { index: false, follow: false } };

const demo: AccessoriesResponse = { schemaVersion: 1, source: "DETERMINISTIC_ACCESSORY_ADVISOR_V1",
  requestId: "synthetic-accessories-demo", propertyId: "synthetic-property", analysisId: "synthetic-analysis",
  system: { nominalKw: demoFinancialResponse.system.nominalKw,
    actualDcKw: demoFinancialResponse.system.actualDcKw,
    minimumInverterAcKw: demoFinancialResponse.system.minimumInverterAcKw, roofSource: "MANUAL",
    generationBasis: "ASSUMED_YIELD" },
  recommendations: [
    { id: "demo-monitoring", title: "Production monitoring", category: "MONITORING", classification: "RECOMMENDED",
      score: 82, reason: "In this fictional example, the homeowner asked to see how much the system produces.",
      compatibility: "REQUIRES_REVIEW", safetyNotes: ["An installer would check the example inverter and data connection."],
      policyRelevance: { status: "NOT_EVALUATED", note: "Fictional fixture; no real policy check was performed." },
      costRange: { status: "UNAVAILABLE", currency: "INR", note: "No sourced price is available in this fixture." } },
    { id: "demo-surge", title: "Surge protection review", category: "ELECTRICAL_SAFETY",
      classification: "STRONGLY_RECOMMENDED", score: 90,
      reason: "The fictional installation needs a qualified electrical designer to assess protective devices.",
      compatibility: "REQUIRES_REVIEW", safetyNotes: ["A qualified installer must size and select devices for the actual site."],
      policyRelevance: { status: "NOT_EVALUATED", note: "Fictional fixture; no electrical rule was checked." },
      costRange: { status: "UNAVAILABLE", currency: "INR", note: "No sourced price is available in this fixture." } },
    { id: "demo-battery", title: "Battery storage", category: "BACKUP", classification: "OPTIONAL", score: 53,
      reason: "In this fictional example, backup power matters, but no inverter compatibility has been confirmed.",
      compatibility: "REQUIRES_REVIEW", safetyNotes: ["Electrical architecture and protected loads require specialist review."],
      policyRelevance: { status: "NOT_EVALUATED", note: "Fictional fixture; benefit eligibility was not checked." },
      costRange: { status: "UNAVAILABLE", currency: "INR", note: "No sourced price is available in this fixture." } },
  ], warnings: ["This synthetic result is for layout inspection only; no real roof or equipment has been evaluated."],
  financialIntegration: { includedInBaseEstimate: false, benefitEligibilityEvaluated: false } };

export default function AccessoriesDemoPage() {
  return <main className="container py-10 md:py-16"><p className="mb-4 text-sm"><Link href="/demo"
    className="font-medium text-primary underline underline-offset-4">← Back to guided demo</Link></p>
    <div className="mb-6 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950" role="note">
      <strong>Synthetic accessories demo.</strong> Every property, roof, system, classification, relevance score and recommendation below is fictional.
      No live account, API, supplier, policy source or price was checked.</div>
    <div className="mx-auto max-w-5xl"><AccessoriesResult response={demo} demo /></div></main>;
}
