import type { Metadata } from "next";
import Link from "next/link";
import { AdvisorAnswer } from "../../../components/advisor-workspace";
import type { AdvisorResponse } from "../../../lib/advisor-api";

export const metadata: Metadata = { title: "Advisor demo | SolarSaathi", robots: { index: false, follow: false } };

const at = "2026-10-09T08:00:00.000Z";
const fictionalCitation = { schemaVersion: 1 as const, sourceId: "SRC#SYNTHETIC", sourceRegistryVersion: 1,
  documentId: "DOC#SYNTHETIC", documentVersion: 1, documentSha256: "a".repeat(64),
  publisherName: "Fictional source", documentTitle: "Synthetic policy fixture",
  sourceUrl: "https://example.com/fixture", retrievedAt: at,
  locator: { section: "Fictional example", charStart: 0, charEnd: 30 } };
const demo: AdvisorResponse = { schemaVersion: 1, source: "GROUNDED_ADVISOR_V1", requestId: "synthetic-advisor-demo",
  propertyId: "synthetic-property", analysisId: "synthetic-analysis", status: "ANSWERED",
  mode: "DETERMINISTIC_FALLBACK",
  answer: "This example roof has a user-entered area and a fictional process record. In a real assessment, the advisor would explain only the records available for your selected property. Check official sources before making an application decision.",
  cards: [{ id: "roof-demo", kind: "ROOF", provenance: "USER_MEASURED",
    statement: "The example user entered a 48 m² roof area. This is a fictional layout fixture, not a property measurement." },
  { id: "policy-demo", kind: "BENEFIT", provenance: "VERIFIED_POLICY",
    statement: "A fictional scheme requires a separate official application step in this synthetic example.",
    policyId: "POLICY#SYNTHETIC", policyVersion: 1, jurisdiction: "IN",
    effectiveFrom: "2026-01-01", verificationStatus: "VERIFIED", lastVerifiedAt: at,
    sourceChecks: [{ sourceId: "SRC#SYNTHETIC", lastCheckedAt: at, fresh: true, status: "HEALTHY" }],
    citations: [fictionalCitation] }],
  selectedCardIds: ["roof-demo", "policy-demo"],
  caveats: ["This demonstration contains no real roof analysis, government benefit or live source check."],
  missingContext: [],
};

export default function AdvisorDemoPage() {
  return <main className="container py-10 md:py-16"><p className="mb-4 text-sm"><Link href="/app/advisor"
    className="font-medium text-primary underline underline-offset-4">← Back to advisor</Link></p>
    <div className="mb-6 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950" role="note">
      <strong>Synthetic advisor demo.</strong> Every roof, policy, source, date and statement below is a fictional fixture.
      No live account, API, government source or AI model was checked. No official claim should be inferred.</div>
    <div className="mx-auto max-w-4xl"><AdvisorAnswer response={demo} demo /></div></main>;
}
