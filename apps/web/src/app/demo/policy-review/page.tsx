import type { Metadata } from "next";
import Link from "next/link";
import { PolicyReviewPanel, type PolicyReviewDemoFixture } from "../../../components/policy-review-panel";

export const metadata: Metadata = { title: "Policy review demo | SolarSaathi" };

const checkedAt = "2026-10-08T10:30:00.000Z";
const sourceUrl = "https://example.invalid/illustrative-procedure";
const source: PolicyReviewDemoFixture["sources"][number] = {
  schemaVersion: 1, sourceId: "SRC#synthetic", registryVersion: 2,
  name: "Fictional rooftop procedure desk", publisherName: "Example Energy Office",
  jurisdiction: "IN-XX", sourceType: "STATE_ENERGY_DEPARTMENT", authorityTier: 1,
  canonicalUrl: sourceUrl, registryStatus: "CURATED", healthStatus: "HEALTHY",
  crawlFrequency: "DAILY", enabled: true, freshnessWindowHours: 48,
  lastCheckedAt: checkedAt,
};
const review: PolicyReviewDemoFixture["items"][number] = {
  schemaVersion: 1, reviewStatus: "PENDING_APPROVAL", revision: 1,
  detectedAt: checkedAt, detectedBy: "SYSTEM_CRAWLER", sourceCuratorId: "demo-curator",
  changeStatus: "INITIAL_REVIEW_REQUIRED", conflictFlags: [],
  candidate: {
    schemaVersion: 1, candidateId: `CAND#${"0".repeat(32)}`,
    sourceId: source.sourceId, documentId: "DOC#synthetic", documentVersion: 1,
    chunkId: "CHUNK#synthetic", claimKey: `claim.${"0".repeat(32)}`,
    jurisdiction: "IN-XX", categoryHint: "DOCUMENT_REQUIREMENT",
    quotedText: "In this fictional procedure, applicants include a roof photograph with the form.",
    citation: { sourceId: source.sourceId, sourceRegistryVersion: 2,
      documentId: "DOC#synthetic", documentVersion: 1, documentSha256: "0".repeat(64),
      publisherName: source.publisherName, documentTitle: "Illustrative procedure note",
      sourceUrl, retrievedAt: checkedAt, locator: { section: "Application documents", charStart: 14, charEnd: 89 } },
    amountMentions: [], dateMentions: [], capacityMentions: [],
    verificationStatus: "UNVERIFIED", reviewStatus: "PENDING_APPROVAL", extractedAt: checkedAt,
  },
};
const change: PolicyReviewDemoFixture["changes"][number] = {
  schemaVersion: 1, changeId: `CHANGE#${"1".repeat(32)}`, sourceId: source.sourceId,
  documentId: "DOC#synthetic", documentVersion: 1, detectedAt: checkedAt,
  runId: "00000000-0000-4000-8000-000000000001", reviewStatus: "PENDING_APPROVAL",
  revision: 1, detectedBy: "SYSTEM_CRAWLER", sourceCuratorId: "demo-curator",
  assessment: { schemaVersion: 1, sourceId: source.sourceId, documentId: "DOC#synthetic",
    documentVersion: 1, currentRawSha256: "0".repeat(64), currentNormalizedTextSha256: "1".repeat(64),
    status: "INITIAL_REVIEW_REQUIRED", reviewStatus: "PENDING_APPROVAL", candidateCount: 0,
    materialChanges: [] },
};
const demo: PolicyReviewDemoFixture = {
  items: [review], changes: [change], sources: [source],
  sourceStates: [{ sourceId: source.sourceId, sourceFresh: true,
    crawlState: { schemaVersion: 1, sourceId: source.sourceId, status: "READY", lastCheckedAt: checkedAt } }],
  detail: {
    candidate: review, source,
    document: { schemaVersion: 1, documentId: "DOC#synthetic", version: 1,
      title: "Illustrative procedure note", canonicalUrl: sourceUrl,
      sha256: "0".repeat(64), retrievedAt: checkedAt },
    crawlState: { schemaVersion: 1, sourceId: source.sourceId, status: "READY", lastCheckedAt: checkedAt },
    sourceFresh: true,
    audit: [{ schemaVersion: 1, eventId: "00000000-0000-4000-8000-000000000000",
      action: "DOCUMENT_CHANGED", occurredAt: checkedAt, actorId: "DEMO_SYSTEM",
      sourceId: source.sourceId, candidateId: review.candidate.candidateId }],
    requestId: "synthetic-demo",
  },
  changeDetail: { schemaVersion: 1, change, source,
    document: { schemaVersion: 1, documentId: "DOC#synthetic", version: 1,
      title: "Illustrative procedure note", canonicalUrl: sourceUrl,
      sha256: "0".repeat(64), retrievedAt: checkedAt },
    crawlState: { schemaVersion: 1, sourceId: source.sourceId, status: "READY", lastCheckedAt: checkedAt },
    sourceFresh: true, textPreview: "Fictional procedure note. Applicants may attach a roof photograph. This text is a synthetic interface fixture.",
    textTruncated: false, audit: [], requestId: "synthetic-demo" },
};

export default function PolicyReviewDemoPage() {
  return <main id="main-content" className="container py-10 md:py-16">
    <p className="mb-6 text-sm"><Link href="/app" className="text-primary underline underline-offset-4">← Back to workspace</Link></p>
    <PolicyReviewPanel demo={demo} />
  </main>;
}
