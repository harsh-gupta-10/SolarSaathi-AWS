import type { Metadata } from "next";
import Link from "next/link";
import { AdvisorAnswer } from "../../../components/advisor-workspace";
import type { AdvisorResponse } from "../../../lib/advisor-api";
import { demoRoof } from "../fixtures";
import { demoCitation, demoSourceId } from "../policy-financial-fixture";

export const metadata: Metadata = { title: "Advisor demo | SolarSaathi", robots: { index: false, follow: false } };

const at = "2026-10-09T08:00:00.000Z";
const demo: AdvisorResponse = { schemaVersion: 1, source: "GROUNDED_ADVISOR_V1", requestId: "synthetic-advisor-demo",
  propertyId: "synthetic-property", analysisId: "synthetic-analysis", status: "ANSWERED",
  mode: "DETERMINISTIC_FALLBACK",
  answer: `This fictional ${demoRoof.roofAreaSquareMeters} m² roof and central-benefit fixture illustrate how a response can cite both user-entered geometry and a policy record. The example benefit has no real government source, and other policy scopes remain unverified. Check current official sources before making an application decision.`,
  cards: [{ id: "roof-demo", kind: "ROOF", provenance: "USER_MEASURED",
    statement: `The example user entered a ${demoRoof.roofAreaSquareMeters} m² roof area. This is a fictional layout fixture, not a property measurement.` },
  { id: "policy-demo", kind: "BENEFIT", provenance: "VERIFIED_POLICY",
    statement: "A fictional central benefit is selected within the synthetic rule fixture; state, DISCOM, local and other coverage is unverified.",
    policyId: "POLICY#SYNTHETIC_DEMO", policyVersion: 1, jurisdiction: "IN",
    effectiveFrom: "2026-01-01", verificationStatus: "VERIFIED", lastVerifiedAt: at,
    sourceChecks: [{ sourceId: demoSourceId, lastCheckedAt: at, fresh: true, status: "HEALTHY" }],
    citations: [demoCitation] }],
  selectedCardIds: ["roof-demo", "policy-demo"],
  caveats: ["This demonstration contains no real roof analysis, government benefit or live source check."],
  missingContext: [],
};

export default function AdvisorDemoPage() {
  return <main className="container py-10 md:py-16"><p className="mb-4 text-sm"><Link href="/demo"
    className="font-medium text-primary underline underline-offset-4">← Back to guided demo</Link></p>
    <div className="mb-6 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950" role="note">
      <strong>Synthetic advisor demo.</strong> Every roof, policy, source, date and statement below is a fictional fixture.
      No live account, API, government source or AI model was checked. No official claim should be inferred.</div>
    <div className="mx-auto max-w-4xl"><AdvisorAnswer response={demo} demo /></div></main>;
}
