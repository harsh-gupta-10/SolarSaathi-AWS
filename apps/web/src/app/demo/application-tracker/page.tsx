import type { Metadata } from "next";
import Link from "next/link";
import { ApplicationDetails } from "../../../components/application-tracker";
import type { SolarApplication } from "../../../lib/applications-api";

export const metadata: Metadata = { title: "Application tracker demo | SolarSaathi",
  robots: { index: false, follow: false } };

const at = "2026-10-09T08:00:00.000Z";
const citation = { schemaVersion: 1 as const, sourceId: "SRC#SYNTHETIC_FIXTURE", sourceRegistryVersion: 1,
  documentId: "DOC#SYNTHETIC_FIXTURE", documentVersion: 1, documentSha256: "a".repeat(64),
  publisherName: "Synthetic demo source", documentTitle: "Fictional process fixture",
  sourceUrl: "https://example.com/fixture", retrievedAt: at,
  locator: { section: "Fictional demo excerpt", charStart: 0, charEnd: 30 } };
const application: SolarApplication = { schemaVersion: 1, applicationId: "synthetic-application",
  propertyId: "synthetic-property", analysisId: "synthetic-analysis", createdByUserId: "synthetic-homeowner",
  policyId: "POLICY#SYNTHETIC_DEMO", policyVersion: 1, benefitId: "BENEFIT#SYNTHETIC_DEMO",
  ruleId: "RULE#SYNTHETIC_DEMO", jurisdiction: "IN", system: { nominalKw: 3, actualDcKw: 3.3 },
  benefitEvaluatedAt: at, benefitCountedAmountPaise: 5000000, lastVerifiedAt: at,
  policyCitations: [citation], sourceChecks: [{ sourceId: citation.sourceId,
    lastCheckedAt: at, fresh: true, status: "HEALTHY" }],
  processSource: "VERIFIED_POLICY_SNAPSHOT", progressSource: "USER_REPORTED",
  status: "IN_PROGRESS", expectedNextStepId: "INSTALLATION", referenceNumber: "DEMO-12345",
  vendorName: "Example installer", revision: 3, createdAt: at, updatedAt: at,
  steps: [
    { stepId: "APPLICATION_SUBMITTED", order: 1, title: "Submit a fictional application",
      description: "A synthetic process step for visual inspection of the tracker.", required: true,
      citations: [citation], status: "COMPLETED", verificationStatus: "USER_REPORTED", updatedAt: at,
      completedAt: at, note: "Synthetic acknowledgement recorded for demo." },
    { stepId: "INSTALLATION", order: 2, title: "Record installation progress",
      description: "A synthetic process step for visual inspection of the tracker.", required: true,
      citations: [citation], status: "IN_PROGRESS", verificationStatus: "USER_REPORTED", updatedAt: at,
      startedAt: at },
    { stepId: "FINAL_REVIEW", order: 3, title: "Review the fictional process",
      description: "A synthetic process step for visual inspection of the tracker.", required: false,
      citations: [citation], status: "PENDING", verificationStatus: "USER_REPORTED", updatedAt: at },
  ], documents: [{ documentId: "synthetic-document", documentType: "ACKNOWLEDGEMENT",
    label: "Fictional acknowledgement", obtainedOn: "2026-10-09", recordedAt: at,
    verificationStatus: "USER_REPORTED" }],
};

export default function ApplicationTrackerDemoPage() {
  return <main className="container py-10 md:py-16"><p className="mb-4 text-sm"><Link href="/demo/policy-financial"
    className="text-primary underline underline-offset-4">← Back to policy financial demo</Link></p>
    <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950" role="note">
      <strong>Synthetic application demo.</strong> Every policy, process step, source, progress status, reference and document on this page is a fictional test fixture. Controls are disabled. No live policy or official portal was checked.</div>
    <ApplicationDetails initial={application} demo /></main>;
}
