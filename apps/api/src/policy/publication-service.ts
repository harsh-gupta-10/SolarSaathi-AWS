import { createHash, randomUUID } from "node:crypto";
import {
  benefitClauseClaimKeyV1, buildPolicyCitation, comparePolicyEvidence, compareSourceAuthority,
  policyBenefitRuleSchema, policyDocumentChunkSchema, policyDocumentSchema,
  policyFactSchema, policyLocatorSchema, policySourceSchema, policyVersionSchema,
  validateOfficialSourceRecord,
  type PolicyBenefitRuleV1, type PolicyDocumentV1, type PolicySourceV1,
} from "@solarsaathi/policy";
import { z } from "zod";
import { RequestError } from "../lib/http";
import type { PolicyRepository } from "./storage";
import type { PolicyWorkflowRepository } from "./workflow-storage";
import type { ActivePolicyBundleV1, PolicyPublicationDraftV1, PublicationAuditV1 } from "./publication-types";
import type { PolicyPublicationRepository } from "./publication-storage";

const hexId = (prefix: string) => z.string().regex(new RegExp(`^${prefix}#[a-f0-9]{32}$`));
const benefitId = z.string().regex(/^BENEFIT#[A-Za-z0-9][A-Za-z0-9#_-]{0,127}$/);
const draftRequest = z.object({ benefitId, sourceId: hexId("SRC"), documentId: hexId("DOC"),
  documentVersion: z.number().int().positive().max(1_000_000), locator: policyLocatorSchema,
  quotedEvidence: z.string().trim().min(10).max(1_600), rule: z.unknown(),
  clauseEvidence: z.array(z.object({ clauseKey: z.string().regex(/^[A-Z0-9_]{3,80}$/),
    locator: policyLocatorSchema, quotedEvidence: z.string().trim().min(10).max(1_600) }).strict()).max(50),
}).strict();
const transitionRequest = z.object({ expectedRevision: z.number().int().positive(),
  reason: z.string().trim().min(10).max(1_000).optional() }).strict();
const queueCursorSchema = z.object({ PK: z.string().regex(/^PUB_DRAFT#DRAFT#[a-f0-9]{32}$/),
  SK: z.literal("CURRENT"), GSI6PK: z.literal("POLICY_PUBLICATION_PENDING"),
  GSI6SK: z.string().max(160) }).strict();
function decodeQueueCursor(raw: string | undefined): Record<string, string> | undefined {
  if (!raw) return undefined;
  if (raw.length > 1_024 || !/^[A-Za-z0-9_-]+$/.test(raw)) {
    throw new RequestError(400, "INVALID_CURSOR", "The publication queue cursor is invalid.");
  }
  try {
    const parsed = queueCursorSchema.parse(JSON.parse(Buffer.from(raw, "base64url").toString("utf8")));
    return parsed;
  } catch { throw new RequestError(400, "INVALID_CURSOR", "The publication queue cursor is invalid."); }
}
const unavailable = () => new RequestError(503, "POLICY_PUBLICATION_UNAVAILABLE", "Policy publication is temporarily unavailable.");
const conflict = () => new RequestError(409, "POLICY_PUBLICATION_CONFLICT", "This policy publication changed. Refresh and retry.");
const digest = (input: string) => createHash("sha256").update(input).digest("hex");
const semanticRule = (rule: PolicyBenefitRuleV1) => JSON.parse(JSON.stringify(rule,
  (key, value: unknown) => ["ruleId", "policyId", "policyVersion", "factIds", "evidenceFactIds",
    "sizeEvidenceFactIds", "overlapEvidenceFactIds"].includes(key) ? undefined : value)) as unknown;
type NumericFact = { unit: "INR" | "INR_PER_KW" | "PERCENT" | "KW"; amount: number };
function numericFacts(rule: PolicyBenefitRuleV1): NumericFact[] {
  const values: NumericFact[] = [];
  switch (rule.amount.kind) {
    case "FIXED": values.push({ unit: "INR", amount: rule.amount.amountPaise / 100 }); break;
    case "PER_KW": values.push({ unit: "INR_PER_KW", amount: rule.amount.ratePaisePerKw / 100 }); break;
    case "PERCENT_ELIGIBLE_COST": values.push({ unit: "PERCENT", amount: rule.amount.basisPoints / 100 }); break;
    case "TIERED_KW": for (const tier of rule.amount.tiers) {
      values.push({ unit: "KW", amount: tier.upToWatts / 1_000 },
        { unit: "INR_PER_KW", amount: tier.ratePaisePerKw / 100 });
    } break;
  }
  if (rule.capPaise !== undefined) values.push({ unit: "INR", amount: rule.capPaise / 100 });
  if (rule.combinedCapPaise !== undefined) values.push({ unit: "INR", amount: rule.combinedCapPaise / 100 });
  return [...new Map(values.map(value => [`${value.unit}:${value.amount}`, value])).values()];
}
function quoteContainsNumericValues(quote: string, values: readonly NumericFact[]): boolean {
  const tokens = new Set((quote.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map(value => Number(value.replaceAll(",", ""))));
  return values.every(value => tokens.has(value.amount));
}
function requiredClauseKeys(rule: PolicyBenefitRuleV1): string[] {
  const keys = ["EFFECTIVE_PERIOD"];
  if (rule.capPaise !== undefined) keys.push("CAP");
  if (rule.combinedCapPaise !== undefined) keys.push("COMBINED_CAP");
  if (rule.minSystemWatts !== undefined || rule.maxSystemWatts !== undefined) keys.push("SYSTEM_SIZE");
  if (rule.overlapGroupId !== undefined) keys.push("OVERLAP");
  rule.eligibility.allOf.forEach((_, index) => keys.push(`ELIGIBILITY_ALL_${index}`));
  rule.eligibility.anyOf.forEach((group, outer) => group.forEach((_, inner) => keys.push(`ELIGIBILITY_ANY_${outer}_${inner}`)));
  rule.compatibility.forEach((edge, index) => {
    keys.push(`COMPATIBILITY_${index}`);
    edge.conditions?.forEach((_, conditionIndex) => keys.push(`COMPATIBILITY_${index}_CONDITION_${conditionIndex}`));
  });
  rule.processSteps?.forEach((_, index) => keys.push(`PROCESS_STEP_${index}`));
  return keys;
}
function clauseFactId(policyId: string, version: number, key: string): string {
  return `FACT#${digest(`${policyId}:${version}:clause:${key}`).slice(0, 32)}`;
}
function clauseClaimKey(rule: PolicyBenefitRuleV1, key: string): string {
  if (key === "SYSTEM_SIZE") return benefitClauseClaimKeyV1("SIZE", rule);
  if (key === "OVERLAP") return benefitClauseClaimKeyV1("OVERLAP", rule);
  const all = /^ELIGIBILITY_ALL_(\d+)$/.exec(key);
  if (all) return benefitClauseClaimKeyV1("ELIGIBILITY", rule.eligibility.allOf[Number(all[1])]);
  const any = /^ELIGIBILITY_ANY_(\d+)_(\d+)$/.exec(key);
  if (any) return benefitClauseClaimKeyV1("ELIGIBILITY",
    rule.eligibility.anyOf[Number(any[1])]?.[Number(any[2])]);
  const edgeCondition = /^COMPATIBILITY_(\d+)_CONDITION_(\d+)$/.exec(key);
  if (edgeCondition) return benefitClauseClaimKeyV1("ELIGIBILITY",
    rule.compatibility[Number(edgeCondition[1])]?.conditions?.[Number(edgeCondition[2])]);
  const edge = /^COMPATIBILITY_(\d+)$/.exec(key);
  if (edge) return benefitClauseClaimKeyV1("COMPATIBILITY", rule.compatibility[Number(edge[1])]);
  const processStep = /^PROCESS_STEP_(\d+)$/.exec(key);
  if (processStep) return benefitClauseClaimKeyV1("PROCESS_STEP", rule.processSteps?.[Number(processStep[1])]);
  return `benefit.${digest(rule.benefitId).slice(0, 20)}.${key.toLowerCase()}`;
}

function validateExcerpt(source: PolicySourceV1, document: PolicyDocumentV1,
  normalizedText: string, chunks: unknown[], locatorInput: unknown, quote: string) {
  const locator = policyLocatorSchema.parse(locatorInput);
  if (locator.charStart === undefined || locator.charEnd === undefined ||
    locator.charEnd - locator.charStart !== quote.length ||
    normalizedText.slice(locator.charStart, locator.charEnd) !== quote) {
    throw new RequestError(400, "EVIDENCE_QUOTE_MISMATCH", "The quote must match archived text at the cited offsets.");
  }
  const withinChunk = chunks.some(value => {
    const chunk = policyDocumentChunkSchema.safeParse(value);
    return chunk.success && chunk.data.sourceId === document.sourceId &&
      chunk.data.documentId === document.documentId && chunk.data.documentVersion === document.version &&
      chunk.data.locator.charStart !== undefined && chunk.data.locator.charEnd !== undefined &&
      locator.charStart! >= chunk.data.locator.charStart && locator.charEnd! <= chunk.data.locator.charEnd &&
      locator.pageNumber === chunk.data.locator.pageNumber &&
      locator.section === chunk.data.locator.section && locator.fragment === chunk.data.locator.fragment &&
      chunk.data.text.slice(locator.charStart! - chunk.data.locator.charStart,
        locator.charEnd! - chunk.data.locator.charStart) === quote;
  });
  if (!withinChunk) throw new RequestError(400, "EVIDENCE_QUOTE_MISMATCH", "The quote must match one archived evidence chunk.");
  return buildPolicyCitation(source, document, locator);
}
const conditional = (error: unknown) => {
  if (!(error instanceof Error)) return false;
  if (error.name === "ConditionalCheckFailedException") return true;
  if (error.name !== "TransactionCanceledException" || !("CancellationReasons" in error)) return false;
  const reasons = error.CancellationReasons;
  return Array.isArray(reasons) && reasons.some(reason => reason?.Code === "ConditionalCheckFailed") &&
    reasons.every(reason => ["None", "ConditionalCheckFailed"].includes(reason?.Code));
};
const recordAudit = (draft: PolicyPublicationDraftV1, action: PublicationAuditV1["action"],
  actorId: string, at: string, reason?: string): PublicationAuditV1 => ({ schemaVersion: 1,
  eventId: randomUUID(), draftId: draft.draftId, policyId: draft.policyId, action, actorId,
  occurredAt: at, ...(reason ? { reason } : {}) });

export function currentSourceFresh(source: PolicySourceV1,
  state: { lastCheckedAt?: string } | undefined, at: Date): boolean {
  if (!state?.lastCheckedAt || source.registryStatus !== "CURATED" || !source.enabled) return false;
  const checked = Date.parse(state.lastCheckedAt);
  return Number.isFinite(checked) && checked <= at.getTime() &&
    at.getTime() - checked <= source.freshnessWindowHours * 3_600_000;
}

export class PolicyPublicationService {
  constructor(private readonly records: PolicyRepository, private readonly workflow: PolicyWorkflowRepository,
    private readonly publication: PolicyPublicationRepository,
    private readonly archive: { getDerived(key: string, versionId: string): Promise<Uint8Array> },
    private readonly now: () => Date = () => new Date()) {}

  private async boundEvidence(sourceId: string, documentId: string, documentVersion: number,
    locatorInput: unknown, quote: string): Promise<{ source: PolicySourceV1; document: PolicyDocumentV1;
      citation: ReturnType<typeof buildPolicyCitation>; normalizedText: string; chunks: unknown[] }> {
    const [current, document] = await Promise.all([
      this.records.getSource(sourceId), this.records.getDocument(sourceId, documentId, documentVersion),
    ]);
    if (!current || !document) throw new RequestError(404, "EVIDENCE_NOT_FOUND", "The cited source or document was not found.");
    const parsedDocument = policyDocumentSchema.parse(document);
    const [source, crawl, latest] = await Promise.all([
      this.workflow.getSourceVersion(sourceId, parsedDocument.sourceRegistryVersion),
      this.workflow.getCrawlState(sourceId), this.workflow.latestDocument(sourceId, documentId),
    ]);
    if (!source || source.registryVersion !== current.registryVersion ||
      !currentSourceFresh(current, crawl, this.now()) || crawl?.status !== "READY" ||
      !!crawl.lastErrorCode || !latest || latest.version !== documentVersion ||
      latest.sha256 !== parsedDocument.sha256 || crawl?.lastDocumentId !== documentId ||
      crawl.lastDocumentVersion !== documentVersion || crawl.lastObservedSha256 !== parsedDocument.sha256 ||
      !parsedDocument.derivedS3Key || !parsedDocument.derivedS3VersionId || !parsedDocument.normalizedTextSha256) {
      throw new RequestError(409, "EVIDENCE_NOT_CURRENT", "A current curated source and archived document are required.");
    }
    const verifiedSource = validateOfficialSourceRecord(policySourceSchema.parse(source));
    const bytes = await this.archive.getDerived(parsedDocument.derivedS3Key, parsedDocument.derivedS3VersionId);
    const raw: unknown = JSON.parse(Buffer.from(bytes).toString("utf8"));
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw unavailable();
    const archive = raw as Record<string, unknown>;
    if (archive.sourceId !== sourceId || archive.documentId !== documentId ||
      archive.documentVersion !== documentVersion || archive.rawSha256 !== parsedDocument.sha256 ||
      archive.normalizedTextSha256 !== parsedDocument.normalizedTextSha256 ||
      typeof archive.normalizedText !== "string" || archive.normalizedText.length > 500_000 ||
      digest(archive.normalizedText) !== parsedDocument.normalizedTextSha256 ||
      !Array.isArray(archive.chunks) || archive.chunks.length > 1_000) throw unavailable();
    return { source: verifiedSource, document: parsedDocument,
      citation: validateExcerpt(verifiedSource, parsedDocument, archive.normalizedText,
        archive.chunks, locatorInput, quote), normalizedText: archive.normalizedText, chunks: archive.chunks };
  }

  async createDraft(body: unknown, actorId: string, requestId: string) {
    const input = draftRequest.safeParse(body);
    if (!input.success) throw new RequestError(400, "INVALID_REQUEST", "The publication draft contains invalid fields.");
    const at = this.now().toISOString();
    let evidence: Awaited<ReturnType<PolicyPublicationService["boundEvidence"]>>;
    try { evidence = await this.boundEvidence(input.data.sourceId, input.data.documentId,
      input.data.documentVersion, input.data.locator, input.data.quotedEvidence); }
    catch (error) { if (error instanceof RequestError) throw error; throw unavailable(); }
    const policyId = `POLICY#${digest(input.data.benefitId).slice(0, 32)}`;
    const active = await this.publication.getActive(policyId);
    const version = (active?.version.version ?? 0) + 1;
    const ruleId = `RULE#${digest(`${policyId}:${version}`).slice(0, 32)}`;
    const raw = input.data.rule;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new RequestError(400, "INVALID_RULE", "The benefit rule has invalid fields.");
    }
    const rawRule = raw as Record<string, unknown>;
    const eligibility = rawRule.eligibility;
    if (!eligibility || typeof eligibility !== "object" || Array.isArray(eligibility)) {
      throw new RequestError(400, "INVALID_RULE", "A cited eligibility restriction is required.");
    }
    const rawEligibility = eligibility as Record<string, unknown>;
    if (!Array.isArray(rawEligibility.allOf) || !Array.isArray(rawEligibility.anyOf) ||
      rawEligibility.allOf.length + rawEligibility.anyOf.length === 0 ||
      !Array.isArray(rawRule.compatibility)) {
      throw new RequestError(400, "INVALID_RULE", "A cited eligibility restriction is required.");
    }
    const withEvidence = { ...rawRule,
      ...(rawRule.minSystemWatts !== undefined || rawRule.maxSystemWatts !== undefined ?
        { sizeEvidenceFactIds: [clauseFactId(policyId, version, "SYSTEM_SIZE")] } : {}),
      ...(rawRule.overlapGroupId !== undefined ?
        { overlapEvidenceFactIds: [clauseFactId(policyId, version, "OVERLAP")] } : {}),
      eligibility: { allOf: rawEligibility.allOf.map((value, index) => ({ ...(value as object),
        evidenceFactIds: [clauseFactId(policyId, version, `ELIGIBILITY_ALL_${index}`)] })),
        anyOf: rawEligibility.anyOf.map((group, outer) => Array.isArray(group) ? group.map((value, inner) =>
          ({ ...(value as object), evidenceFactIds: [clauseFactId(policyId, version,
            `ELIGIBILITY_ANY_${outer}_${inner}`)] })) : group) },
      compatibility: rawRule.compatibility.map((value, index) => {
        const edge = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
        return { ...edge, evidenceFactIds: [clauseFactId(policyId, version, `COMPATIBILITY_${index}`)],
          ...(Array.isArray(edge.conditions) ? { conditions: edge.conditions.map((condition, conditionIndex) =>
            ({ ...(condition as object), evidenceFactIds: [clauseFactId(policyId, version,
              `COMPATIBILITY_${index}_CONDITION_${conditionIndex}`)] })) } : {}) };
      }),
      ...(Array.isArray(rawRule.processSteps) ? { processSteps: rawRule.processSteps.map((value, index) => ({
        ...(value as object), evidenceFactIds: [clauseFactId(policyId, version, `PROCESS_STEP_${index}`)],
      })) } : {}),
    };
    const preliminaryClauseKeys = ["EFFECTIVE_PERIOD",
      ...(rawRule.capPaise !== undefined ? ["CAP"] : []),
      ...(rawRule.combinedCapPaise !== undefined ? ["COMBINED_CAP"] : []),
      ...(rawRule.minSystemWatts !== undefined || rawRule.maxSystemWatts !== undefined ? ["SYSTEM_SIZE"] : []),
      ...(rawRule.overlapGroupId !== undefined ? ["OVERLAP"] : []),
      ...rawEligibility.allOf.map((_, index) => `ELIGIBILITY_ALL_${index}`),
      ...rawEligibility.anyOf.flatMap((group, outer) => Array.isArray(group) ?
        group.map((_, inner) => `ELIGIBILITY_ANY_${outer}_${inner}`) : []),
      ...rawRule.compatibility.flatMap((value, index) => {
        const edge = value && typeof value === "object" ? value as Record<string, unknown> : {};
        return [`COMPATIBILITY_${index}`, ...(Array.isArray(edge.conditions) ?
          edge.conditions.map((_, inner) => `COMPATIBILITY_${index}_CONDITION_${inner}`) : [])];
      }),
      ...(Array.isArray(rawRule.processSteps) ? rawRule.processSteps.map((_, index) => `PROCESS_STEP_${index}`) : [])];
    const preliminaryFactIds = [`FACT#${digest(`${policyId}:${version}:0`).slice(0, 32)}`,
      ...preliminaryClauseKeys.map(key => clauseFactId(policyId, version, key))];
    const provisional = policyBenefitRuleSchema.safeParse({ ...withEvidence, schemaVersion: 1,
      ruleId, benefitId: input.data.benefitId, policyId, policyVersion: version,
      factIds: preliminaryFactIds });
    if (!provisional.success) throw new RequestError(400, "INVALID_RULE", "The benefit rule has invalid fields.");
    const numeric = numericFacts(provisional.data);
    if (numeric.length === 0 || numeric.length > 50 || !quoteContainsNumericValues(input.data.quotedEvidence, numeric)) {
      throw new RequestError(400, "NUMERIC_EVIDENCE_MISMATCH", "The quoted official evidence must contain each stated amount, rate, tier and cap.");
    }
    const clauseKeys = requiredClauseKeys(provisional.data);
    if (clauseKeys.length > 50 || input.data.clauseEvidence.length !== clauseKeys.length ||
      new Set(input.data.clauseEvidence.map(value => value.clauseKey)).size !== clauseKeys.length ||
      clauseKeys.some(key => !input.data.clauseEvidence.some(value => value.clauseKey === key))) {
      throw new RequestError(400, "CLAUSE_EVIDENCE_REQUIRED", "Every rule clause needs a separate cited official excerpt.");
    }
    const clauseEvidence = clauseKeys.map(key => {
      const item = input.data.clauseEvidence.find(value => value.clauseKey === key)!;
      return { clauseKey: key, quotedEvidence: item.quotedEvidence,
        citation: validateExcerpt(evidence.source, evidence.document, evidence.normalizedText,
          evidence.chunks, item.locator, item.quotedEvidence) };
    });
    const factIds = [...numeric.map((_, index) => `FACT#${digest(`${policyId}:${version}:${index}`).slice(0, 32)}`),
      ...clauseKeys.map(key => clauseFactId(policyId, version, key))];
    const rule = policyBenefitRuleSchema.safeParse({ ...provisional.data, factIds });
    const sourceType = evidence.source.sourceType;
    const scopeAllowed = rule.success && (
      rule.data.scope === "CENTRAL" ? rule.data.jurisdiction === "IN" &&
        evidence.source.jurisdiction === "IN" && ["GOVERNMENT", "MNRE", "SCHEME_PORTAL", "OFFICIAL_NOTIFICATION"].includes(sourceType) :
      rule.data.scope === "STATE" ? rule.data.jurisdiction === evidence.source.jurisdiction &&
        rule.data.jurisdiction !== "IN" && ["STATE_ENERGY_DEPARTMENT", "RENEWABLE_AGENCY", "REGULATOR", "OFFICIAL_NOTIFICATION"].includes(sourceType) :
      rule.data.scope === "DISCOM" ? rule.data.jurisdiction === evidence.source.jurisdiction && sourceType === "DISCOM" :
      rule.data.scope === "LOCAL" ? rule.data.jurisdiction === evidence.source.jurisdiction &&
        ["STATE_ENERGY_DEPARTMENT", "GOVERNMENT", "OFFICIAL_NOTIFICATION"].includes(sourceType) :
      rule.data.jurisdiction === evidence.source.jurisdiction);
    if (!rule.success || !scopeAllowed) {
      throw new RequestError(400, "INVALID_RULE", "The rule does not match the cited source jurisdiction or supported schema.");
    }
    const draft: PolicyPublicationDraftV1 = { schemaVersion: 1, draftId: `DRAFT#${randomUUID().replaceAll("-", "")}`,
      policyId, benefitId: input.data.benefitId, version, status: "DRAFT", revision: 1, createdAt: at,
      authoredBy: actorId, sourceCuratorId: evidence.source.curatorId!, citation: evidence.citation,
      quotedEvidence: input.data.quotedEvidence, clauseEvidence, rule: rule.data };
    try { await this.publication.createDraft(draft, recordAudit(draft, "DRAFT_CREATED", actorId, at)); }
    catch (error) { throw conditional(error) ? conflict() : unavailable(); }
    return { schemaVersion: 1 as const, draft, requestId };
  }

  async queue(requestId: string, cursorInput?: string) {
    const cursor = decodeQueueCursor(cursorInput);
    try {
      const page = await this.publication.listPending(20, cursor);
      const current = await Promise.all(page.items.map(item => this.publication.getDraft(item.draftId)));
      return { schemaVersion: 1 as const,
        items: current.filter((item): item is PolicyPublicationDraftV1 => !!item && item.status === "PENDING_APPROVAL"),
        hasMore: !!page.cursor,
        ...(page.cursor ? { nextCursor: Buffer.from(JSON.stringify(page.cursor)).toString("base64url") } : {}),
        requestId };
    } catch { throw unavailable(); }
  }

  async detail(draftId: string, requestId: string) {
    if (!hexId("DRAFT").safeParse(draftId).success) throw new RequestError(400, "INVALID_REQUEST", "Invalid draft ID.");
    const draft = await this.publication.getDraft(draftId);
    if (!draft) throw new RequestError(404, "DRAFT_NOT_FOUND", "The publication draft was not found.");
    try {
      const [source, document, crawlState] = await Promise.all([
        this.records.getSource(draft.citation.sourceId),
        this.records.getDocument(draft.citation.sourceId, draft.citation.documentId, draft.citation.documentVersion),
        this.workflow.getCrawlState(draft.citation.sourceId),
      ]);
      if (!source || !document) throw unavailable();
      return { schemaVersion: 1 as const, draft, source, document, crawlState,
        sourceFresh: currentSourceFresh(source, crawlState, this.now()), requestId };
    } catch { throw unavailable(); }
  }

  async transition(draftId: string, action: "submit" | "publish" | "reject", body: unknown,
    actorId: string, requestId: string) {
    if (!hexId("DRAFT").safeParse(draftId).success) throw new RequestError(400, "INVALID_REQUEST", "Invalid draft ID.");
    const input = transitionRequest.safeParse(body);
    if (!input.success) throw new RequestError(400, "INVALID_REQUEST", "Invalid publication transition.");
    const draft = await this.publication.getDraft(draftId);
    if (!draft) throw new RequestError(404, "DRAFT_NOT_FOUND", "The publication draft was not found.");
    if (draft.revision !== input.data.expectedRevision || draft.status !== (action === "submit" ? "DRAFT" : "PENDING_APPROVAL")) throw conflict();
    if (action === "submit" && actorId !== draft.authoredBy) {
      throw new RequestError(403, "AUTHOR_REQUIRED", "Only the rule author may submit this draft.");
    }
    if (action !== "submit" && (actorId === draft.authoredBy || actorId === draft.sourceCuratorId)) {
      throw new RequestError(403, "SEPARATE_REVIEWER_REQUIRED", "A different administrator must review this rule.");
    }
    if (action !== "submit" && !input.data.reason) throw new RequestError(400, "REVIEW_REASON_REQUIRED", "Provide a review reason.");
    const at = this.now().toISOString();
    const next: PolicyPublicationDraftV1 = { ...draft, revision: draft.revision + 1,
      status: action === "submit" ? "PENDING_APPROVAL" : action === "publish" ? "PUBLISHED" : "REJECTED",
      ...(action === "submit" ? { submittedAt: at } : { reviewedAt: at, reviewedBy: actorId, reviewReason: input.data.reason }) };
    const event = recordAudit(next, action === "submit" ? "DRAFT_SUBMITTED" :
      action === "publish" ? "DRAFT_PUBLISHED" : "DRAFT_REJECTED", actorId, at, input.data.reason);
    if (action !== "publish") {
      try { await this.publication.transitionDraft(draft, next, event); }
      catch (error) { throw conditional(error) ? conflict() : unavailable(); }
      return { schemaVersion: 1 as const, draft: next, requestId };
    }
    let evidence: Awaited<ReturnType<PolicyPublicationService["boundEvidence"]>>;
    try { evidence = await this.boundEvidence(draft.citation.sourceId, draft.citation.documentId,
      draft.citation.documentVersion, draft.citation.locator, draft.quotedEvidence); }
    catch (error) { if (error instanceof RequestError) throw error; throw unavailable(); }
    if (JSON.stringify(evidence.citation) !== JSON.stringify(draft.citation) ||
      evidence.source.curatorId !== draft.sourceCuratorId) throw conflict();
    const crawl = await this.workflow.getCrawlState(evidence.source.sourceId);
    if (!crawl || !currentSourceFresh(evidence.source, crawl, this.now())) throw conflict();
    const active = await this.publication.getActive(draft.policyId);
    if (draft.version !== (active?.version.version ?? 0) + 1) throw conflict();
    const rule = policyBenefitRuleSchema.parse(draft.rule);
    const indiaToday = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric",
      month: "2-digit", day: "2-digit" }).format(this.now());
    if (rule.effectiveFrom > indiaToday || (rule.effectiveTo && rule.effectiveTo < indiaToday)) {
      throw new RequestError(409, "RULE_NOT_CURRENT", "Only rules currently in effect can be activated.");
    }
    const category = rule.scope === "CENTRAL" ? "CENTRAL_SUBSIDY" : rule.scope === "STATE" ? "STATE_SUBSIDY" :
      rule.scope === "DISCOM" ? "DISCOM_INCENTIVE" : rule.scope === "LOCAL" ? "LOCAL_BODY_INCENTIVE" : "OTHER";
    const numeric = numericFacts(rule);
    const clauseKeys = requiredClauseKeys(rule);
    const expectedFactIds = [...numeric.map((_, index) => `FACT#${digest(`${draft.policyId}:${draft.version}:${index}`).slice(0, 32)}`),
      ...clauseKeys.map(key => clauseFactId(draft.policyId, draft.version, key))];
    if (JSON.stringify(expectedFactIds) !== JSON.stringify(rule.factIds) ||
      !quoteContainsNumericValues(draft.quotedEvidence, numeric) ||
      draft.clauseEvidence.length !== clauseKeys.length) throw conflict();
    const verifiedClauses = clauseKeys.map(key => {
      const clause = draft.clauseEvidence.find(value => value.clauseKey === key);
      if (!clause) throw conflict();
      const citation = validateExcerpt(evidence.source, evidence.document, evidence.normalizedText,
        evidence.chunks, clause.citation.locator, clause.quotedEvidence);
      if (JSON.stringify(citation) !== JSON.stringify(clause.citation)) throw conflict();
      return clause;
    });
    const facts = numeric.map((value, index) => policyFactSchema.parse({ schemaVersion: 1,
      factId: expectedFactIds[index], policyId: draft.policyId, policyVersion: draft.version,
      category, jurisdiction: rule.jurisdiction,
      claimKey: `benefit.${digest(draft.benefitId).slice(0, 32)}`, statement: draft.quotedEvidence,
      value: { kind: "NUMBER", ...value },
      effectiveFrom: rule.effectiveFrom, effectiveTo: rule.effectiveTo, citation: evidence.citation,
      verificationStatus: "VERIFIED", lastVerifiedAt: at, verifiedBy: actorId, recordedAt: at }));
    for (const clause of verifiedClauses) {
      facts.push(policyFactSchema.parse({ schemaVersion: 1,
        factId: clauseFactId(draft.policyId, draft.version, clause.clauseKey),
        policyId: draft.policyId, policyVersion: draft.version, category, jurisdiction: rule.jurisdiction,
        claimKey: clauseClaimKey(rule, clause.clauseKey),
        statement: clause.quotedEvidence, value: { kind: "TEXT", text: clause.quotedEvidence },
        effectiveFrom: rule.effectiveFrom, effectiveTo: rule.effectiveTo, citation: clause.citation,
        verificationStatus: "VERIFIED", lastVerifiedAt: at, verifiedBy: actorId, recordedAt: at }));
    }
    const version = policyVersionSchema.parse({ schemaVersion: 1, policyId: draft.policyId,
      version: draft.version, ...(active ? { previousVersion: active.version.version } : {}),
      category, jurisdiction: rule.jurisdiction, status: "ACTIVE", verificationStatus: "VERIFIED",
      effectiveFrom: rule.effectiveFrom, effectiveTo: rule.effectiveTo, factIds: rule.factIds,
      documentRefs: [{ sourceId: evidence.source.sourceId, documentId: evidence.document.documentId,
        documentVersion: evidence.document.version, sha256: evidence.document.sha256 }],
      contentHash: digest(JSON.stringify({ benefitId: draft.benefitId,
        rule: semanticRule(rule), citation: evidence.citation, quote: draft.quotedEvidence,
        clauses: draft.clauseEvidence.map(item => ({ clauseKey: item.clauseKey,
          quotedEvidence: item.quotedEvidence, citation: item.citation })) })),
      createdAt: draft.createdAt, createdBy: draft.authoredBy, lastVerifiedAt: at, verifiedBy: actorId,
      approvedAt: at, approvedBy: actorId, activatedAt: at });
    if (active && (active.version.category !== version.category ||
      active.version.jurisdiction !== version.jurisdiction ||
      active.version.contentHash === version.contentHash ||
      active.benefitId !== draft.benefitId)) throw conflict();
    let publicationAudit = event;
    let priorSourceCondition: { sourceId: string; registryVersion: number; crawlRevision: number } | undefined;
    if (active) {
      const priorCitation = active.facts[0]?.citation;
      if (!priorCitation || active.facts.some(fact => fact.citation.sourceId !== priorCitation.sourceId)) throw conflict();
      if (priorCitation.sourceId !== evidence.source.sourceId) {
        const [priorSnapshot, priorCurrent, priorCrawl, priorDocument] = await Promise.all([
          this.workflow.getSourceVersion(priorCitation.sourceId, priorCitation.sourceRegistryVersion),
          this.records.getSource(priorCitation.sourceId),
          this.workflow.getCrawlState(priorCitation.sourceId),
          this.records.getDocument(priorCitation.sourceId, priorCitation.documentId, priorCitation.documentVersion),
        ]);
        if (!priorSnapshot || !priorDocument) throw unavailable();
        const priorSource = validateOfficialSourceRecord(policySourceSchema.parse(priorSnapshot));
        const priorDocumentParsed = policyDocumentSchema.parse(priorDocument);
        const priorCurrentFresh = !!priorCurrent && priorCurrent.registryVersion === priorSource.registryVersion &&
          currentSourceFresh(priorCurrent, priorCrawl, this.now()) &&
          priorCrawl?.lastDocumentId === priorCitation.documentId &&
          priorCrawl.lastDocumentVersion === priorCitation.documentVersion &&
          priorCrawl.lastObservedSha256 === priorCitation.documentSha256;
        if (!priorCurrentFresh || !priorCrawl) {
          throw new RequestError(409, "POLICY_SOURCE_PRECEDENCE_CONFLICT",
            "The active source requires a fresh official check before cross-source replacement.");
        }
        const priorForPrecedence = policySourceSchema.parse({ ...priorSource,
          healthStatus: priorCurrentFresh ? "HEALTHY" : "UNKNOWN",
          ...(priorCurrentFresh ? { lastCheckedAt: priorCrawl!.lastCheckedAt } : {}) });
        const proposedForPrecedence = policySourceSchema.parse({ ...evidence.source,
          healthStatus: "HEALTHY", lastCheckedAt: crawl.lastCheckedAt });
        const priorAmountFact = active.facts.find(fact => fact.value?.kind === "NUMBER" &&
          fact.claimKey === facts[0]?.claimKey);
        if (!priorAmountFact || priorDocumentParsed.sha256 !== priorCitation.documentSha256) throw unavailable();
        const precedence = comparePolicyEvidence(
          { source: proposedForPrecedence, document: evidence.document, version, fact: facts[0]! },
          { source: priorForPrecedence, document: priorDocumentParsed,
            version: active.version, fact: priorAmountFact }, this.now());
        if (compareSourceAuthority(evidence.source, priorSource) > 0 ||
          precedence.outcome !== "PREFER_LEFT" || !precedence.publishable) {
          throw new RequestError(409, "POLICY_SOURCE_PRECEDENCE_CONFLICT",
            "The new source does not outrank the active official source. Resolve this policy conflict separately.");
        }
        publicationAudit = { ...event, precedenceDecision: "REVIEWED_OFFICIAL_REPLACEMENT",
          precedenceReasonCode: precedence.reasonCode,
          supersededSourceId: priorSource.sourceId, supersededSourceAuthorityTier: priorSource.authorityTier,
          replacementSourceAuthorityTier: evidence.source.authorityTier };
        priorSourceCondition = { sourceId: priorSource.sourceId,
          registryVersion: priorSource.registryVersion, crawlRevision: priorCrawl.revision };
      } else publicationAudit = { ...event, precedenceDecision: "SAME_SOURCE" };
    }
    const bundle: ActivePolicyBundleV1 = { schemaVersion: 1, policyId: draft.policyId,
      benefitId: draft.benefitId, version, facts, rule, activatedAt: at };
    try { await this.publication.publish(draft, next, bundle, publicationAudit,
      evidence.source.registryVersion, crawl.revision, active?.version.version, priorSourceCondition); }
    catch (error) { throw conditional(error) ? conflict() : unavailable(); }
    return { schemaVersion: 1 as const, draft: next, publishedVersion: version, requestId };
  }
}
