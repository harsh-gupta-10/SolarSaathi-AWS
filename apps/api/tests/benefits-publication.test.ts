import { describe, expect, it, vi } from "vitest";
import type { APIGatewayProxyEvent } from "aws-lambda";
import { ingestPolicyDocument, policyDocumentSchema, policySourceSchema,
  type PolicyDocumentV1, type PolicySourceV1 } from "@solarsaathi/policy";
import { BenefitsService } from "../src/benefits/service";
import { createPolicyPublicationHandler } from "../src/handlers/policy-publication";
import { PolicyPublicationService } from "../src/policy/publication-service";
import { DynamoPolicyPublicationRepository, type PolicyPublicationRepository } from "../src/policy/publication-storage";
import type { ActivePolicyBundleV1, PolicyPublicationDraftV1, PolicyRollbackRequestV1,
  PolicyRollbackAuditV1, PublicationAuditV1 } from "../src/policy/publication-types";
import type { PolicyRepository } from "../src/policy/storage";
import type { PolicyWorkflowRepository } from "../src/policy/workflow-storage";
import type { PolicyCrawlStateV1 } from "../src/policy/workflow-types";
import { normalizeManual } from "../src/roof/normalize";
import { fixedNow, identity, otherId, setupData } from "./data-fixtures";
import { context, request, sub, userOutput } from "./auth-fixtures";

const curator = "curator-admin";
const author = "author-admin";
const reviewer = "reviewer-admin";
const sourceId = `SRC#${"a".repeat(32)}`;
const documentId = `DOC#${"b".repeat(32)}`;
const quoteText = "Central subsidy INR 1000 for 2 kW residential rooftop solar effective from 2026-01-01. Submit the application through the official portal.";

async function setup() {
  const source = policySourceSchema.parse({ schemaVersion: 1, sourceId, registryVersion: 2,
    name: "Official national source", publisherName: "MNRE", jurisdiction: "IN", sourceType: "MNRE",
    authorityTier: 1, registryStatus: "CURATED", healthStatus: "UNKNOWN",
    canonicalUrl: "https://mnre.gov.in/solar/", allowedHosts: ["mnre.gov.in"],
    crawlFrequency: "DAILY", enabled: true, freshnessWindowHours: 24,
    curatorId: curator, curatedAt: fixedNow.toISOString(),
    createdAt: fixedNow.toISOString(), updatedAt: fixedNow.toISOString() });
  const raw = Buffer.from(`<html><body><p>${quoteText}</p></body></html>`);
  const ingested = await ingestPolicyDocument({ sourceId, documentId, documentVersion: 1,
    mimeType: "text/html", bytes: raw });
  const chunk = ingested.chunks.find(value => value.text.includes(quoteText))!;
  const excerpt = (text: string) => {
    const start = ingested.normalizedText.indexOf(text);
    if (start < 0) throw new Error("Missing test excerpt");
    return { quotedEvidence: text, locator: { ...chunk.locator, charStart: start, charEnd: start + text.length } };
  };
  const document = policyDocumentSchema.parse({ schemaVersion: 1, sourceId, documentId,
    sourceRegistryVersion: 2, version: 1, title: "Official national notice", documentType: "SCHEME_NOTIFICATION",
    mimeType: "text/html", canonicalUrl: source.canonicalUrl,
    sha256: ingested.sha256, normalizedTextSha256: ingested.normalizedTextSha256,
    retrievedAt: fixedNow.toISOString(), derivedS3Key: `derived/${"a".repeat(32)}/${"b".repeat(32)}/v00000001/${"c".repeat(64)}.json`,
    derivedS3VersionId: "s3-v1", chunkCount: ingested.chunks.length });
  let current: PolicySourceV1 = source;
  let latest: PolicyDocumentV1 = document;
  let priorSource: PolicySourceV1 | undefined;
  let priorDocument: PolicyDocumentV1 | undefined;
  let priorState: PolicyCrawlStateV1 | undefined;
  let lastPublicationAudit: PublicationAuditV1 | undefined;
  let state: PolicyCrawlStateV1 = { schemaVersion: 1, sourceId, revision: 2, status: "READY",
    nextDueAtEpochSeconds: Math.floor(fixedNow.getTime() / 1_000) + 86_400,
    lastCheckedAt: fixedNow.toISOString(), lastDocumentId: documentId, lastDocumentVersion: 1,
    lastObservedSha256: document.sha256, failureCount: 0 };
  const drafts = new Map<string, PolicyPublicationDraftV1>();
  const active = new Map<string, ActivePolicyBundleV1>();
  const published = new Map<string, Map<number, ActivePolicyBundleV1>>();
  const rollbacks = new Map<string, PolicyRollbackRequestV1>();
  const records = { getSource: async (id: string) => id === sourceId ? current : priorSource,
    getDocument: async (id: string) => id === sourceId ? document : priorDocument,
    putSource: async () => {}, putDocument: async () => {} } as PolicyRepository;
  const workflow = { getSourceVersion: async (id: string) => id === sourceId ? source : priorSource,
    getCrawlState: async (id: string) => id === sourceId ? state : priorState,
    latestDocument: async () => latest } as unknown as PolicyWorkflowRepository;
  const archive = { getDerived: async () => Buffer.from(JSON.stringify({ schemaVersion: 1,
    sourceId, documentId, documentVersion: 1, rawSha256: document.sha256,
    normalizedTextSha256: ingested.normalizedTextSha256, normalizedText: ingested.normalizedText,
    chunks: ingested.chunks })) };
  const publication = {
    getDraft: async (id: string) => drafts.get(id),
    createDraft: async (draft: PolicyPublicationDraftV1) => { drafts.set(draft.draftId, draft); },
    transitionDraft: async (_previous: PolicyPublicationDraftV1, next: PolicyPublicationDraftV1) => { drafts.set(next.draftId, next); },
    listPending: async (limit: number, cursor?: Record<string, string>) => {
      const pending = [...drafts.values()].filter(value => value.status === "PENDING_APPROVAL");
      const start = cursor ? pending.findIndex(value => `PUB_DRAFT#${value.draftId}` === cursor.PK) + 1 : 0;
      const items = pending.slice(start, start + limit);
      const last = items.at(-1);
      return { items, ...(last && start + limit < pending.length ? { cursor: {
        PK: `PUB_DRAFT#${last.draftId}`, SK: "CURRENT", GSI6PK: "POLICY_PUBLICATION_PENDING",
        GSI6SK: `${last.submittedAt}#${last.draftId}` } } : {}) };
    },
    getActive: async (id: string) => active.get(id),
    getPublished: async (id: string, version: number) => published.get(id)?.get(version),
    listPublished: async (id: string) => ({ items: [...(published.get(id)?.values() ?? [])]
      .sort((a, b) => b.version.version - a.version.version) }),
    listActiveCatalog: async (jurisdiction: string) => ({ items: [...active.values()]
      .filter(value => value.rule.jurisdiction === jurisdiction) }),
    listActive: async (jurisdictions: readonly string[]) => [...active.values()]
      .filter(value => jurisdictions.includes(value.rule.jurisdiction)),
    publish: async (_previous: PolicyPublicationDraftV1, next: PolicyPublicationDraftV1,
      bundle: ActivePolicyBundleV1, _audit: PublicationAuditV1) => {
      lastPublicationAudit = _audit;
      drafts.set(next.draftId, next); active.set(bundle.policyId, bundle);
      const versions = published.get(bundle.policyId) ?? new Map<number, ActivePolicyBundleV1>();
      versions.set(bundle.version.version, bundle); published.set(bundle.policyId, versions);
    },
    getRollback: async (id: string) => rollbacks.get(id),
    listPendingRollbacks: async () => ({ items: [...rollbacks.values()].filter(value => value.status === "PENDING_APPROVAL") }),
    createRollback: async (value: PolicyRollbackRequestV1) => { rollbacks.set(value.rollbackId, value); },
    rejectRollback: async (_previous: PolicyRollbackRequestV1, next: PolicyRollbackRequestV1) => {
      rollbacks.set(next.rollbackId, next);
    },
    activateRollback: async (_previous: PolicyRollbackRequestV1, next: PolicyRollbackRequestV1,
      bundle: ActivePolicyBundleV1) => {
      rollbacks.set(next.rollbackId, next); active.set(bundle.policyId, bundle);
      const versions = published.get(bundle.policyId) ?? new Map<number, ActivePolicyBundleV1>();
      versions.set(bundle.version.version, bundle); published.set(bundle.policyId, versions);
    },
  } as PolicyPublicationRepository;
  const publicationService = new PolicyPublicationService(records, workflow, publication, archive, () => fixedNow);
  const data = setupData();
  await data.service.bootstrap(identity(), {});
  await data.service.bootstrap(identity(otherId), {});
  const property = await data.service.createProperty(identity(), { label: "Home", address: "123 Example Road, Mumbai" });
  const roof = normalizeManual({ roofAreaSquareMeters: 100, lengthMeters: 10, widthMeters: 10 }, fixedNow.toISOString());
  const analysis = await data.service.saveManualRoof(identity(), property.propertyId, roof);
  const benefits = new BenefitsService(data.service, records, workflow, publication, () => fixedNow);
  const evaluate = { propertyId: property.propertyId, analysisId: analysis.analysisId,
    demand: { kind: "CONSUMPTION", monthlyConsumptionKwh: 600 }, generationKwhPerKwYear: 1_500,
    nominalKw: 3, applicantFacts: { country: "IN", customerType: "RESIDENTIAL" } };
  const draftRequest = { benefitId: "BENEFIT#synthetic-national-test", sourceId, documentId,
    documentVersion: 1, locator: chunk.locator, quotedEvidence: chunk.text,
    clauseEvidence: [
      { clauseKey: "EFFECTIVE_PERIOD", ...excerpt("effective from 2026-01-01") },
      { clauseKey: "ELIGIBILITY_ALL_0", ...excerpt("residential rooftop solar") },
    ],
    rule: { scope: "CENTRAL", jurisdiction: "IN", effectiveFrom: "2026-01-01",
      amount: { kind: "FIXED", amountPaise: 100_000 },
      eligibility: { allOf: [{ kind: "CUSTOMER_TYPE", oneOf: ["RESIDENTIAL"] }], anyOf: [] },
      compatibility: [] } };
  return { publicationService, benefits, evaluate, draftRequest, document, chunk, source, excerpt,
    createBenefitsAt: (now: () => Date) => new BenefitsService(data.service, records, workflow, publication, now),
    setState: (value: PolicyCrawlStateV1) => { state = value; }, getState: () => state,
    setCurrent: (value: PolicySourceV1) => { current = value; },
    setPrior: (value: { source: PolicySourceV1; document: PolicyDocumentV1; state: PolicyCrawlStateV1 }) => {
      priorSource = value.source; priorDocument = value.document; priorState = value.state;
    },
    getLastPublicationAudit: () => lastPublicationAudit,
    setLatest: (value: PolicyDocumentV1) => { latest = value; },
    getActive: () => [...active.values()][0],
    getPublished: (version: number) => [...published.values()][0]?.get(version),
    getRollback: (id: string) => rollbacks.get(id),
    setActive: (value: ActivePolicyBundleV1) => { active.set(value.policyId, value); },
    property, analysis };
}

describe("verified benefit publication and owner-scoped evaluation", () => {
  it("pages published history and restores verified prior semantics as a new version after independent review", async () => {
    const test = await setup();
    const first = await test.publicationService.createDraft(test.draftRequest, author, "req");
    await test.publicationService.transition(first.draft.draftId, "submit", { expectedRevision: 1 }, author, "req");
    await test.publicationService.transition(first.draft.draftId, "publish",
      { expectedRevision: 2, reason: "Verified the original official notice." }, reviewer, "req");
    const secondInput = { ...test.draftRequest,
      rule: { ...test.draftRequest.rule, maxSystemWatts: 2_000 },
      clauseEvidence: [...test.draftRequest.clauseEvidence,
        { clauseKey: "SYSTEM_SIZE", ...test.excerpt("for 2 kW residential rooftop solar") }] };
    const second = await test.publicationService.createDraft(secondInput, author, "req");
    await test.publicationService.transition(second.draft.draftId, "submit", { expectedRevision: 1 }, author, "req");
    await test.publicationService.transition(second.draft.draftId, "publish",
      { expectedRevision: 2, reason: "Verified the separate system-size clause." }, reviewer, "req");
    const policyId = first.draft.policyId;
    const catalog = await test.publicationService.activeCatalog("IN", undefined, "req");
    expect(catalog.items).toMatchObject([{ policyId, version: 2, sourceFresh: true }]);
    const history = await test.publicationService.versions(policyId, undefined, "req");
    expect(history.items.map(item => [item.version, item.isCurrent])).toEqual([[2, true], [1, false]]);
    expect((await test.publicationService.versionDetail(policyId, "1", "req"))).toMatchObject({
      currentVersion: 2, isCurrent: false, bundle: { version: { version: 1 } }, sourceFresh: true,
    });
    const requested = await test.publicationService.createRollback({ policyId, targetVersion: 1,
      expectedActiveVersion: 2, reason: "Restore the prior verified rule after reviewing the latest official text." },
    "rollback-requester", "req");
    expect((await test.publicationService.rollbackQueue(undefined, "req")).items[0]?.rollbackId)
      .toBe(requested.rollback.rollbackId);
    await expect(test.publicationService.reviewRollback(requested.rollback.rollbackId, "approve",
      { expectedRevision: 1, reason: "Checked current official source and complete citation." }, author, "req"))
      .rejects.toMatchObject({ code: "SEPARATE_REVIEWER_REQUIRED" });
    const approved = await test.publicationService.reviewRollback(requested.rollback.rollbackId, "approve",
      { expectedRevision: 1, reason: "Checked current official source and complete citation." }, reviewer, "req");
    const restored = test.getActive()!;
    expect(approved.rollback).toMatchObject({ status: "APPROVED", activatedVersion: 3, revision: 2 });
    expect(restored).toMatchObject({ version: { version: 3, previousVersion: 2,
      contentHash: test.getPublished(1)?.version.contentHash }, rule: { policyVersion: 3 } });
    expect(restored.rule).not.toHaveProperty("maxSystemWatts");
    expect(restored.rule.factIds).toEqual(restored.facts.map(fact => fact.factId));
    expect(restored.rule.factIds.some(id => test.getPublished(1)?.rule.factIds.includes(id))).toBe(false);
    expect(restored.facts.every(fact => fact.policyVersion === 3 && fact.verifiedBy === reviewer)).toBe(true);
    expect((await test.publicationService.versions(policyId, undefined, "req")).items
      .map(item => [item.version, item.isCurrent])).toEqual([[3, true], [2, false], [1, false]]);
    const next = await test.publicationService.createDraft(secondInput, author, "req");
    expect(next.draft.version).toBe(4);
  });

  it("rejects rollback when the historical document is no longer the latest crawl", async () => {
    const test = await setup();
    const first = await test.publicationService.createDraft(test.draftRequest, author, "req");
    await test.publicationService.transition(first.draft.draftId, "submit", { expectedRevision: 1 }, author, "req");
    await test.publicationService.transition(first.draft.draftId, "publish",
      { expectedRevision: 2, reason: "Verified the original official notice." }, reviewer, "req");
    const secondInput = { ...test.draftRequest, rule: { ...test.draftRequest.rule, maxSystemWatts: 2_000 },
      clauseEvidence: [...test.draftRequest.clauseEvidence,
        { clauseKey: "SYSTEM_SIZE", ...test.excerpt("for 2 kW residential rooftop solar") }] };
    const second = await test.publicationService.createDraft(secondInput, author, "req");
    await test.publicationService.transition(second.draft.draftId, "submit", { expectedRevision: 1 }, author, "req");
    await test.publicationService.transition(second.draft.draftId, "publish",
      { expectedRevision: 2, reason: "Verified the separate system-size clause." }, reviewer, "req");
    const requested = await test.publicationService.createRollback({ policyId: first.draft.policyId,
      targetVersion: 1, expectedActiveVersion: 2,
      reason: "Restore the earlier rule after a second check of the official text." }, "rollback-requester", "req");
    test.setLatest(policyDocumentSchema.parse({ ...test.document, version: 2 }));
    await expect(test.publicationService.reviewRollback(requested.rollback.rollbackId, "approve",
      { expectedRevision: 1, reason: "Reviewed the historical evidence before approval." }, reviewer, "req"))
      .rejects.toMatchObject({ statusCode: 409, code: "ROLLBACK_TARGET_NOT_CURRENT" });
    expect(test.getActive()?.version.version).toBe(2);
  });

  it("publishes a sourced process checklist only with exact archived excerpts", async () => {
    const test = await setup();
    const request = { ...test.draftRequest,
      rule: { ...test.draftRequest.rule, processSteps: [{ stepId: "APPLICATION_SUBMITTED", order: 1,
        title: "Submit the application", description: "Submit the application through the official portal.",
        required: true }] },
      clauseEvidence: [...test.draftRequest.clauseEvidence,
        { clauseKey: "PROCESS_STEP_0", ...test.excerpt("Submit the application through the official portal.") }] };
    await expect(test.publicationService.createDraft({ ...request,
      clauseEvidence: test.draftRequest.clauseEvidence }, author, "req"))
      .rejects.toMatchObject({ code: "CLAUSE_EVIDENCE_REQUIRED" });
    const created = await test.publicationService.createDraft(request, author, "req");
    const factId = created.draft.rule.processSteps?.[0]?.evidenceFactIds[0];
    expect(factId).toBeTruthy();
    expect(created.draft.rule.factIds).toContain(factId);
    await test.publicationService.transition(created.draft.draftId, "submit", { expectedRevision: 1 }, author, "req");
    await test.publicationService.transition(created.draft.draftId, "publish",
      { expectedRevision: 2, reason: "Verified the archived process clause." }, reviewer, "req");
    expect(test.getActive()?.facts.find(fact => fact.factId === factId)).toMatchObject({
      verificationStatus: "VERIFIED", value: { kind: "TEXT" },
      statement: "Submit the application through the official portal.",
    });
  });

  it("publishes only independently reviewed numeric evidence and evaluates a trusted owned system", async () => {
    const test = await setup();
    expect(await test.benefits.evaluate(identity(), test.evaluate, "req")).toMatchObject({
      status: "UNAVAILABLE", reasonCodes: ["NO_ACTIVE_VERIFIED_RULES"] });
    const created = await test.publicationService.createDraft(test.draftRequest, author, "req");
    expect(created.draft).toMatchObject({ status: "DRAFT", revision: 1,
      rule: { factIds: [expect.any(String), expect.any(String), expect.any(String)] } });
    const id = created.draft.draftId;
    await test.publicationService.transition(id, "submit", { expectedRevision: 1 }, author, "req");
    await expect(test.publicationService.transition(id, "publish",
      { expectedRevision: 2, reason: "Checked the official notice." }, author, "req"))
      .rejects.toMatchObject({ statusCode: 403 });
    await expect(test.publicationService.transition(id, "publish",
      { expectedRevision: 2, reason: "Checked the official notice." }, curator, "req"))
      .rejects.toMatchObject({ statusCode: 403 });
    const published = await test.publicationService.transition(id, "publish",
      { expectedRevision: 2, reason: "Checked the official notice." }, reviewer, "req");
    expect(published).toMatchObject({ draft: { status: "PUBLISHED" },
      publishedVersion: { status: "ACTIVE", verificationStatus: "VERIFIED" } });
    const result = await test.benefits.evaluate(identity(), test.evaluate, "req");
    expect(result).toMatchObject({ status: "AVAILABLE", applicantFactsSource: "USER_DECLARED",
      eligibilityNotGuaranteed: true, result: { totalEligibleBenefitPaise: 100_000,
        coverageComplete: false, decisions: [{ verificationStatus: "VERIFIED", status: "SELECTED",
          sourceChecks: [{ lastCheckedAt: fixedNow.toISOString(), fresh: true }] }] } });
    let clockTick = 0;
    const clockResult = await test.createBenefitsAt(() => new Date(fixedNow.getTime() + clockTick++))
      .evaluate(identity(), test.evaluate, "clock-req");
    expect(clockResult.status).toBe("AVAILABLE");
    if (clockResult.status === "AVAILABLE") expect(clockResult.result.evaluatedAt).toBe(clockResult.evaluatedAt);
    test.setState({ ...test.getState(), status: "ERROR", lastErrorCode: "TIMEOUT" });
    expect(await test.benefits.evaluate(identity(), test.evaluate, "req")).toMatchObject({
      status: "AVAILABLE", result: { warnings: expect.arrayContaining(["SOURCE_CHECK_DEGRADED"]) } });
    test.setState({ ...test.getState(), status: "READY", lastErrorCode: undefined });
    const duplicate = await test.publicationService.createDraft(test.draftRequest, author, "req");
    await test.publicationService.transition(duplicate.draft.draftId, "submit", { expectedRevision: 1 }, author, "req");
    await expect(test.publicationService.transition(duplicate.draft.draftId, "publish",
      { expectedRevision: 2, reason: "Reviewed duplicate official evidence." }, reviewer, "req"))
      .rejects.toMatchObject({ statusCode: 409, code: "POLICY_PUBLICATION_CONFLICT" });
    await expect(test.benefits.evaluate(identity(otherId), test.evaluate, "req"))
      .rejects.toMatchObject({ statusCode: 404 });
    await expect(test.benefits.evaluate(identity(), { ...test.evaluate, roof: { source: "GOOGLE_SOLAR" } }, "req"))
      .rejects.toMatchObject({ statusCode: 400 });
    test.setState({ ...test.getState(), lastDocumentVersion: 2, lastObservedSha256: "f".repeat(64) });
    expect(await test.benefits.evaluate(identity(), test.evaluate, "req")).toMatchObject({
      status: "UNAVAILABLE", reasonCodes: ["NO_CURRENT_VERIFIED_RULES"] });
    test.setState({ ...test.getState(), lastDocumentVersion: 1, lastObservedSha256: test.document.sha256 });
    test.setCurrent(policySourceSchema.parse({ ...test.source, registryVersion: 3 }));
    await expect(test.benefits.evaluate(identity(), test.evaluate, "req"))
      .rejects.toMatchObject({ statusCode: 503, code: "BENEFIT_EVALUATION_UNAVAILABLE" });
  });

  it("rejects forged citation locations, old archives, unhealthy source and unsupported authority scope", async () => {
    const test = await setup();
    await expect(test.publicationService.createDraft({ ...test.draftRequest,
      rule: { ...test.draftRequest.rule, eligibility: { allOf: [], anyOf: [] } } }, author, "req"))
      .rejects.toMatchObject({ statusCode: 400, code: "INVALID_RULE" });
    await expect(test.publicationService.createDraft({ ...test.draftRequest,
      clauseEvidence: test.draftRequest.clauseEvidence.slice(0, 1) }, author, "req"))
      .rejects.toMatchObject({ statusCode: 400, code: "CLAUSE_EVIDENCE_REQUIRED" });
    await expect(test.publicationService.createDraft({ ...test.draftRequest,
      clauseEvidence: test.draftRequest.clauseEvidence.map(item => item.clauseKey === "ELIGIBILITY_ALL_0" ?
        { ...item, locator: { ...item.locator, section: "Forged section" } } : item) }, author, "req"))
      .rejects.toMatchObject({ statusCode: 400, code: "EVIDENCE_QUOTE_MISMATCH" });
    await expect(test.publicationService.createDraft({ ...test.draftRequest,
      locator: { ...test.chunk.locator, section: "Forged page" } }, author, "req"))
      .rejects.toMatchObject({ statusCode: 400, code: "EVIDENCE_QUOTE_MISMATCH" });
    test.setLatest({ ...test.document, version: 2 });
    await expect(test.publicationService.createDraft(test.draftRequest, author, "req"))
      .rejects.toMatchObject({ statusCode: 409, code: "EVIDENCE_NOT_CURRENT" });
    test.setLatest(test.document);
    test.setState({ ...test.getState(), status: "ERROR", lastErrorCode: "RATE_LIMITED" });
    await expect(test.publicationService.createDraft(test.draftRequest, author, "req"))
      .rejects.toMatchObject({ statusCode: 409, code: "EVIDENCE_NOT_CURRENT" });
    test.setState({ ...test.getState(), status: "READY", lastErrorCode: undefined });
    await expect(test.publicationService.createDraft({ ...test.draftRequest,
      rule: { ...test.draftRequest.rule, scope: "STATE", jurisdiction: "IN-MH" } }, author, "req"))
      .rejects.toMatchObject({ statusCode: 400, code: "INVALID_RULE" });
  });

  it("does not activate an expired or future-dated rule", async () => {
    const test = await setup();
    const expired = await test.publicationService.createDraft({ ...test.draftRequest,
      rule: { ...test.draftRequest.rule, effectiveTo: "2026-10-07" } }, author, "req");
    await test.publicationService.transition(expired.draft.draftId, "submit", { expectedRevision: 1 }, author, "req");
    await expect(test.publicationService.transition(expired.draft.draftId, "publish",
      { expectedRevision: 2, reason: "Reviewed rule effective dates." }, reviewer, "req"))
      .rejects.toMatchObject({ statusCode: 409, code: "RULE_NOT_CURRENT" });
    const future = await test.publicationService.createDraft({ ...test.draftRequest,
      rule: { ...test.draftRequest.rule, effectiveFrom: "2026-10-09" } }, author, "req");
    await test.publicationService.transition(future.draft.draftId, "submit", { expectedRevision: 1 }, author, "req");
    await expect(test.publicationService.transition(future.draft.draftId, "publish",
      { expectedRevision: 2, reason: "Reviewed rule effective dates." }, reviewer, "req"))
      .rejects.toMatchObject({ statusCode: 409, code: "RULE_NOT_CURRENT" });
  });

  it("keeps a review queue with more than 20 drafts drainable", async () => {
    const test = await setup();
    for (let index = 0; index < 21; index++) {
      const created = await test.publicationService.createDraft(test.draftRequest, author, "req");
      await test.publicationService.transition(created.draft.draftId, "submit", { expectedRevision: 1 }, author, "req");
    }
    const page = await test.publicationService.queue("req");
    expect(page.items).toHaveLength(20);
    expect(page.hasMore).toBe(true);
    expect(page.nextCursor).toEqual(expect.any(String));
    const second = await test.publicationService.queue("req", page.nextCursor);
    expect(second.items).toHaveLength(1);
    expect(second.hasMore).toBe(false);
    await expect(test.publicationService.queue("req", "bad cursor!"))
      .rejects.toMatchObject({ statusCode: 400, code: "INVALID_CURSOR" });
  });

  it("rejects unresolved equal-authority cross-source replacement", async () => {
    const test = await setup();
    const first = await test.publicationService.createDraft(test.draftRequest, author, "req");
    await test.publicationService.transition(first.draft.draftId, "submit", { expectedRevision: 1 }, author, "req");
    await test.publicationService.transition(first.draft.draftId, "publish",
      { expectedRevision: 2, reason: "Verified the original official notice." }, reviewer, "req");
    const otherSourceId = `SRC#${"e".repeat(32)}`;
    const otherDocumentId = `DOC#${"d".repeat(32)}`;
    const priorSource = policySourceSchema.parse({ ...test.source, sourceId: otherSourceId,
      name: "Official national scheme portal", publisherName: "PM Surya Ghar", sourceType: "SCHEME_PORTAL",
      canonicalUrl: "https://solarrooftop.pmsuryaghar.gov.in/", allowedHosts: ["solarrooftop.pmsuryaghar.gov.in"] });
    const priorDocument = policyDocumentSchema.parse({ ...test.document, sourceId: otherSourceId,
      documentId: otherDocumentId, canonicalUrl: priorSource.canonicalUrl, sha256: "d".repeat(64) });
    const priorState: PolicyCrawlStateV1 = { ...test.getState(), sourceId: otherSourceId,
      lastDocumentId: otherDocumentId, lastObservedSha256: priorDocument.sha256 };
    test.setPrior({ source: priorSource, document: priorDocument, state: priorState });
    const prior = structuredClone(test.getActive()!);
    prior.version.contentHash = "f".repeat(64);
    prior.version.documentRefs = [{ sourceId: otherSourceId, documentId: otherDocumentId,
      documentVersion: 1, sha256: priorDocument.sha256 }];
    prior.facts = prior.facts.map(fact => ({ ...fact,
      ...(fact.value?.kind === "NUMBER" ? { value: { kind: "NUMBER" as const, unit: "INR" as const, amount: 2_000 } } : {}),
      citation: { ...fact.citation, sourceId: otherSourceId, documentId: otherDocumentId,
        documentSha256: priorDocument.sha256, sourceUrl: priorSource.canonicalUrl,
        publisherName: priorSource.publisherName } }));
    test.setActive(prior);
    const second = await test.publicationService.createDraft(test.draftRequest, author, "req");
    await test.publicationService.transition(second.draft.draftId, "submit", { expectedRevision: 1 }, author, "req");
    await expect(test.publicationService.transition(second.draft.draftId, "publish",
      { expectedRevision: 2, reason: "Reviewed conflicting official evidence." }, reviewer, "req"))
      .rejects.toMatchObject({ statusCode: 409, code: "POLICY_SOURCE_PRECEDENCE_CONFLICT" });
    expect(test.getLastPublicationAudit()?.precedenceDecision).not.toBe("REVIEWED_OFFICIAL_REPLACEMENT");
    test.setPrior({ source: priorSource,
      document: policyDocumentSchema.parse({ ...priorDocument, documentType: "OFFICIAL_WEBPAGE" }),
      state: priorState });
    await test.publicationService.transition(second.draft.draftId, "publish",
      { expectedRevision: 2, reason: "The new official notification outranks the older official web page." }, reviewer, "req");
    expect(test.getLastPublicationAudit()).toMatchObject({
      precedenceDecision: "REVIEWED_OFFICIAL_REPLACEMENT",
      precedenceReasonCode: "STRONGER_DOCUMENT_TYPE", supersededSourceId: otherSourceId,
      replacementSourceAuthorityTier: 1, supersededSourceAuthorityTier: 1,
    });
  });

  it("fails closed on truncated active index pages and pins prior crawl state in publication", async () => {
    const calls: unknown[] = [];
    const client = { send: vi.fn(async (command: unknown) => {
      calls.push(command);
      return { Items: [], LastEvaluatedKey: { GSI5PK: "ACTIVE_POLICY_BENEFITS#IN", GSI5SK: "policy" } };
    }) } as unknown as ConstructorParameters<typeof DynamoPolicyPublicationRepository>[2];
    const repository = new DynamoPolicyPublicationRepository("test-policy", "ap-south-1", client);
    await expect(repository.listActive(["IN"], 17)).rejects.toBeInstanceOf(RangeError);
    const test = await setup();
    const created = await test.publicationService.createDraft(test.draftRequest, author, "req");
    const event: PublicationAuditV1 = { schemaVersion: 1, eventId: "event", draftId: created.draft.draftId,
      policyId: created.draft.policyId, action: "DRAFT_PUBLISHED", actorId: reviewer,
      occurredAt: fixedNow.toISOString() };
    await repository.publish(created.draft, { ...created.draft, status: "PUBLISHED", revision: 2 },
      { schemaVersion: 1, policyId: created.draft.policyId, benefitId: created.draft.benefitId,
        version: { ...test.getActive()?.version, version: 1 } as ActivePolicyBundleV1["version"],
        facts: [], rule: created.draft.rule, activatedAt: fixedNow.toISOString() },
      event, 2, 2, 1, { sourceId: `SRC#${"e".repeat(32)}`, registryVersion: 3, crawlRevision: 7 });
    const transaction = calls.at(-1) as { input: { TransactItems: Array<{ ConditionCheck?: { Key: { PK: string; SK: string } } }> } };
    expect(transaction.input.TransactItems.filter(item => item.ConditionCheck)
      .map(item => item.ConditionCheck?.Key)).toEqual(expect.arrayContaining([
        { PK: `SOURCE#SRC#${"e".repeat(32)}`, SK: "CURRENT" },
        { PK: `SOURCE#SRC#${"e".repeat(32)}`, SK: "CRAWL_STATE" },
      ]));
  });

  it("conditions rollback activation on reviewer state, both official sources and the exact active version", async () => {
    const transactions: Array<{ input: { TransactItems: Array<{
      ConditionCheck?: { Key: { PK: string; SK: string } };
      Put?: { Item: { PK: string; SK: string }; ConditionExpression: string } }> } }> = [];
    const client = { send: vi.fn(async (command: unknown) => {
      transactions.push(command as typeof transactions[number]); return {};
    }) } as unknown as ConstructorParameters<typeof DynamoPolicyPublicationRepository>[2];
    const repository = new DynamoPolicyPublicationRepository("test-policy", "ap-south-1", client);
    const test = await setup();
    const created = await test.publicationService.createDraft(test.draftRequest, author, "req");
    const base = test.getActive() ?? { schemaVersion: 1, policyId: created.draft.policyId,
      benefitId: created.draft.benefitId, version: {} as ActivePolicyBundleV1["version"],
      facts: [], rule: created.draft.rule, activatedAt: fixedNow.toISOString() };
    const bundle = { ...base, version: { ...base.version, version: 3 } } as ActivePolicyBundleV1;
    const previous: PolicyRollbackRequestV1 = { schemaVersion: 1,
      rollbackId: `ROLLBACK#${"f".repeat(32)}`, policyId: created.draft.policyId,
      targetVersion: 1, expectedActiveVersion: 2, status: "PENDING_APPROVAL", revision: 1,
      requestedAt: fixedNow.toISOString(), requestedBy: "rollback-requester",
      requestReason: "Restore the prior verified official rule.", targetSourceId: sourceId,
      targetSourceCuratorId: curator, targetVersionAuthorId: author };
    const next: PolicyRollbackRequestV1 = { ...previous, status: "APPROVED", revision: 2,
      reviewedAt: fixedNow.toISOString(), reviewedBy: reviewer,
      reviewReason: "Checked both official sources and the current active version.", activatedVersion: 3 };
    const audit: PolicyRollbackAuditV1 = { schemaVersion: 1, eventId: "synthetic-event",
      rollbackId: previous.rollbackId, policyId: previous.policyId, action: "ROLLBACK_APPROVED",
      actorId: reviewer, occurredAt: fixedNow.toISOString(), reason: next.reviewReason!,
      expectedActiveVersion: 2, targetVersion: 1, activatedVersion: 3 };
    const priorSourceId = `SRC#${"e".repeat(32)}`;
    await repository.activateRollback(previous, next, bundle, audit, 2, 7,
      { sourceId: priorSourceId, registryVersion: 4, crawlRevision: 9 });
    const writes = transactions.at(-1)!.input.TransactItems;
    expect(writes.filter(item => item.ConditionCheck).map(item => item.ConditionCheck?.Key))
      .toEqual(expect.arrayContaining([
        { PK: `SOURCE#${sourceId}`, SK: "CURRENT" },
        { PK: `SOURCE#${sourceId}`, SK: "CRAWL_STATE" },
        { PK: `SOURCE#${priorSourceId}`, SK: "CURRENT" },
        { PK: `SOURCE#${priorSourceId}`, SK: "CRAWL_STATE" },
      ]));
    const pointer = writes.find(item => item.Put?.Item.SK === "ACTIVE")?.Put;
    expect(pointer?.ConditionExpression).toBe("activeVersion = :prior");
    expect(writes.some(item => item.Put?.Item.SK === "VERSION#00000003" &&
      item.Put.ConditionExpression.includes("attribute_not_exists"))).toBe(true);
    expect(writes.some(item => item.Put?.Item.SK === "ACTIVATION#VERSION#00000003")).toBe(true);
    expect(writes.some(item => item.Put?.Item.PK === `POLICY_ROLLBACK#${previous.rollbackId}` &&
      item.Put.Item.SK === "CURRENT" && item.Put.ConditionExpression.includes("revision = :revision"))).toBe(true);
  });

  it("denies unverified or non-admin callers before touching publication storage", async () => {
    vi.stubEnv("ENVIRONMENT", "test"); vi.stubEnv("LOG_LEVEL", "error");
    vi.stubEnv("AWS_REGION", "ap-south-1"); vi.stubEnv("POLICY_TABLE_NAME", "test-policy");
    vi.stubEnv("POLICY_DOCUMENT_BUCKET", "test-policy-documents");
    let groups: string[] = [];
    let verified = "true";
    let storageCalls = 0;
    const handler = createPolicyPublicationHandler({
      resolveIdentity: async () => ({ sub, groups, attributes: userOutput({ email_verified: verified }).UserAttributes }),
      createRecords: () => { storageCalls++; throw new Error("storage must not be reached"); },
    });
    const event = { ...request(), path: "/v1/admin/policy/benefits/drafts",
      resource: "/admin/policy/benefits/drafts", httpMethod: "POST",
      headers: { "content-type": "application/json" }, body: JSON.stringify({}) } as APIGatewayProxyEvent;
    expect((await handler(event, context)).statusCode).toBe(403);
    groups = ["ADMIN_POLICY"]; verified = "false";
    expect((await handler(event, context)).statusCode).toBe(403);
    groups = []; verified = "true";
    expect((await handler({ ...event, path: "/v1/admin/policy/benefits/active",
      resource: "/admin/policy/benefits/active", httpMethod: "GET" }, context)).statusCode).toBe(403);
    expect((await handler({ ...event, path: "/v1/admin/policy/benefits/rollbacks",
      resource: "/admin/policy/benefits/rollbacks" }, context)).statusCode).toBe(403);
    expect((await handler({ ...event, path: `/v1/admin/policy/benefits/versions/${encodeURIComponent(`POLICY#${"a".repeat(32)}`)}/1`,
      resource: "/admin/policy/benefits/versions/{policyId}/{version}", httpMethod: "GET" }, context)).statusCode).toBe(403);
    expect((await handler({ ...event, path: `/v1/admin/policy/benefits/rollbacks/${encodeURIComponent(`ROLLBACK#${"a".repeat(32)}`)}/approve`,
      resource: "/admin/policy/benefits/rollbacks/{rollbackId}/approve" }, context)).statusCode).toBe(403);
    expect(storageCalls).toBe(0);
    vi.unstubAllEnvs();
  });
});
