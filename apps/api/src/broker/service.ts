import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { calculateBaseFinancialsV1, calculatePolicyFinancialsV1, type BaseFinancialInputV1 } from "@solarsaathi/calculations";
import { benefitStackResultSchema } from "@solarsaathi/policy";
import type { CurrentIdentityResponse } from "@solarsaathi/types";
import { z } from "zod";
import { CoreRepository } from "../data/repository";
import { CoreService } from "../data/service";
import { identifier, pageInputSchema, parseInput, type StoredLead } from "../data/schemas";
import { leadDto } from "../data/dto";
import { keys } from "../data/keys";
import { userDesignSchema } from "../designs/store";
import { type PolicyFinancialEstimateResponse, PolicyFinancialsService } from "../financials/policy-service";
import { policyFinancialEstimateRequestSchema } from "../financials/policy-schema";
import { RequestError } from "../lib/http";
import { BrokerStore, type StoredProposal } from "./store";

const previewInput = policyFinancialEstimateRequestSchema.extend({ customerId: identifier }).strict();
const leadStages = ["NEW", "CONTACTED", "SITE_VISIT", "PROPOSAL", "INSTALLATION", "COMPLETED"] as const;
const leadUpdateInput = z.object({ expectedRevision: z.number().int().positive(),
  status: z.enum(["CONTACTED", "SITE_VISIT", "PROPOSAL", "INSTALLATION", "COMPLETED", "LOST"]),
}).strict();
const snapshotShape = z.object({ schemaVersion: z.literal(1),
  source: z.literal("DETERMINISTIC_POLICY_FINANCIAL_V1"), propertyId: identifier, analysisId: identifier,
  requestId: z.string().min(1).max(128), status: z.enum(["AVAILABLE", "UNAVAILABLE"]),
  roofSource: z.enum(["GOOGLE_SOLAR", "MANUAL"]),
  system: z.object({ nominalKw: z.number().finite().positive(), actualDcKw: z.number().finite().positive() }).passthrough(),
  systemDesignWarnings: z.array(z.string().max(100)).max(40),
  base: z.object({ schemaVersion: z.literal(1), source: z.literal("DETERMINISTIC_BASE_FINANCIAL_V1"),
    policyBenefitsEvaluated: z.literal(false), financingModeled: z.literal(false), horizonYears: z.literal(25),
    input: z.unknown(), annualRows: z.array(z.unknown()).length(25), totals: z.unknown(),
  }).passthrough(),
  benefits: z.object({ schemaVersion: z.literal(1), source: z.literal("DETERMINISTIC_BENEFIT_STACK_V1"),
    status: z.enum(["AVAILABLE", "UNAVAILABLE"]), propertyId: identifier, analysisId: identifier,
    system: z.object({ nominalKw: z.number().finite().positive(), actualDcKw: z.number().finite().positive() }),
    result: benefitStackResultSchema.optional(),
  }).passthrough(),
  projection: z.unknown().optional(),
}).passthrough();
function verifiedSnapshot(input: unknown): PolicyFinancialEstimateResponse {
  const checked = snapshotShape.safeParse(input);
  if (!checked.success) throw new RequestError(503, "DATABASE_UNAVAILABLE", "The saved proposal could not be verified.");
  const value = checked.data;
  if (value.benefits.propertyId !== value.propertyId || value.benefits.analysisId !== value.analysisId ||
    value.benefits.system.nominalKw !== value.system.nominalKw || value.benefits.system.actualDcKw !== value.system.actualDcKw ||
    (value.benefits.status === "AVAILABLE") !== (value.benefits.result !== undefined) ||
    (value.status === "AVAILABLE") !== (value.projection !== undefined)) {
    throw new RequestError(503, "DATABASE_UNAVAILABLE", "The saved proposal could not be verified.");
  }
  try {
    const recalculatedBase = calculateBaseFinancialsV1(value.base.input as BaseFinancialInputV1);
    if (!isDeepStrictEqual(JSON.parse(JSON.stringify(value.base)), JSON.parse(JSON.stringify(recalculatedBase)))) throw new Error("Base mismatch");
    if (recalculatedBase.input.system.nominalKw !== value.system.nominalKw) throw new Error("nominal mismatch");
    if (recalculatedBase.input.system.actualDcKw !== value.system.actualDcKw) throw new Error("actual mismatch");
    if (value.status === "AVAILABLE") {
      if (!value.benefits.result) throw new Error("Benefit result absent");
      const recalculatedProjection = calculatePolicyFinancialsV1({ base: recalculatedBase, benefits: value.benefits.result });
      if (!isDeepStrictEqual(JSON.parse(JSON.stringify(value.projection)), JSON.parse(JSON.stringify(recalculatedProjection)))) throw new Error("Projection mismatch");
    }
  } catch { throw new RequestError(503, "DATABASE_UNAVAILABLE", "The saved proposal could not be verified."); }
  return value as unknown as PolicyFinancialEstimateResponse;
}
const missing = () => new RequestError(404, "NOT_FOUND", "The requested broker record was not found.");
const brokerOnly = (identity: CurrentIdentityResponse) => {
  if (identity.profile.role !== "BROKER") throw new RequestError(403, "FORBIDDEN", "This operation requires a broker account.");
};
type ProposalStatus = StoredProposal["status"];

export class BrokerService {
  constructor(private readonly core: CoreService, private readonly repository: CoreRepository,
    private readonly store: BrokerStore, private readonly policyFinancials: PolicyFinancialsService,
    private readonly now: () => Date = () => new Date(), private readonly createId: () => string = randomUUID) {}

  private async account(identity: CurrentIdentityResponse) {
    brokerOnly(identity);
    // CoreService rechecks Cognito identity, stored role and current organization membership.
    const current = await this.core.getUser(identity);
    if (current.role !== "BROKER" || !current.organizationId) throw missing();
    const [user, organization] = await Promise.all([
      this.repository.getUser(current.userId), this.repository.getOrganization(current.organizationId),
    ]);
    if (!user || !organization || user.role !== "BROKER" || user.orgId !== organization.orgId ||
      !organization.memberUserIds.includes(user.userId)) throw missing();
    return { user, organization };
  }
  private async customer(identity: CurrentIdentityResponse, customerId: string) {
    parseInput(identifier, customerId);
    const account = await this.account(identity);
    const customer = await this.repository.getCustomer(account.organization.orgId, customerId);
    if (!customer || customer.kind !== "CUSTOMER" || customer.orgId !== account.organization.orgId) throw missing();
    return { ...account, customer };
  }
  private async property(identity: CurrentIdentityResponse, propertyId: string) {
    parseInput(identifier, propertyId);
    const account = await this.account(identity);
    const propertyDto = await this.core.getProperty(identity, propertyId);
    const customer = await this.repository.getCustomer(account.organization.orgId, propertyDto.customerId);
    const property = await this.repository.getProperty(propertyDto.customerId, propertyId);
    if (!customer || customer.kind !== "CUSTOMER" || !property || property.orgId !== account.organization.orgId ||
      property.customerId !== customer.customerId) throw missing();
    return { ...account, customer, property };
  }
  private async analysis(identity: CurrentIdentityResponse, customerId: string, propertyId: string, analysisId: string) {
    const scope = await this.property(identity, propertyId);
    if (scope.customer.customerId !== customerId) throw missing();
    const analysis = await this.core.getAnalysis(identity, propertyId, analysisId);
    if (analysis.orgId !== scope.organization.orgId || analysis.ownerUserId !== scope.property.ownerUserId ||
      analysis.propertyId !== scope.property.propertyId || !analysis.roofModel) throw missing();
    return { ...scope, analysis };
  }

  private status(financials: PolicyFinancialEstimateResponse): ProposalStatus {
    if (financials.status !== "AVAILABLE") return "UNAVAILABLE";
    return financials.benefits.status === "AVAILABLE" && financials.benefits.result.coverageComplete ? "AVAILABLE" : "PARTIAL";
  }
  private provenance(financials: PolicyFinancialEstimateResponse) {
    if (financials.benefits.status !== "AVAILABLE") return { policyVersionIds: [], sourceLastCheckedAt: null,
      sourceHealthyAtSnapshot: false };
    const decisions = financials.benefits.result.decisions;
    const policyVersionIds = [...new Set(decisions.map(decision => `${decision.policyId}@${decision.policyVersion}`))].sort();
    const dates = decisions.flatMap(decision => decision.sourceChecks.map(check => check.lastCheckedAt).filter((value): value is string => !!value));
    const checks = decisions.flatMap(decision => decision.sourceChecks);
    return { policyVersionIds, sourceLastCheckedAt: dates.length ? new Date(Math.min(...dates.map(date => Date.parse(date)))).toISOString() : null,
      sourceHealthyAtSnapshot: checks.length > 0 && checks.every(check => check.fresh && check.status === "HEALTHY") };
  }
  private freshness(record: StoredProposal) {
    const age = this.now().getTime() - Date.parse(record.createdAt);
    const checked = record.sourceLastCheckedAt ? Date.parse(record.sourceLastCheckedAt) : Number.NaN;
    return record.policyStatus === "AVAILABLE" && record.sourceHealthyAtSnapshot && age >= 0 && age <= 86_400_000 &&
      Number.isFinite(checked) && this.now().getTime() - checked <= 86_400_000
      ? "AS_OF_SNAPSHOT" as const : "RECHECK_REQUIRED" as const;
  }
  private summary(record: StoredProposal) {
    return { proposalId: record.proposalId, customerId: record.customerId,
      propertyId: record.propertyId, analysisId: record.analysisId, createdAt: record.createdAt,
      status: record.status, policyStatus: record.policyStatus, documentStatus: record.documentStatus,
      policyVersionIds: record.policyVersionIds, sourceLastCheckedAt: record.sourceLastCheckedAt,
      freshnessStatus: this.freshness(record), expiresAt: new Date(record.expiresAtEpochSeconds * 1_000).toISOString() };
  }
  async preview(identity: CurrentIdentityResponse, body: unknown, requestId: string) {
    const input = parseInput(previewInput, body);
    await this.analysis(identity, input.customerId, input.propertyId, input.analysisId);
    const { customerId, ...financialInput } = input;
    const financials = verifiedSnapshot(await this.policyFinancials.estimate(identity, financialInput, requestId));
    const at = this.now().toISOString();
    return { schemaVersion: 1 as const, source: "BROKER_PROPOSAL_PREVIEW_V1" as const, requestId,
      proposal: { customerId, propertyId: input.propertyId, analysisId: input.analysisId,
        createdAt: at, status: this.status(financials), documentStatus: "NOT_GENERATED" as const,
        financials } };
  }
  async save(identity: CurrentIdentityResponse, customerId: string, body: unknown, requestId: string) {
    parseInput(identifier, customerId);
    const input = parseInput(policyFinancialEstimateRequestSchema, body);
    const scope = await this.analysis(identity, customerId, input.propertyId, input.analysisId);
    const financials = verifiedSnapshot(await this.policyFinancials.estimate(identity, input, requestId));
    const writeScope = await this.core.getPropertyWriteScope(identity, input.propertyId);
    if (writeScope.actorRole !== "BROKER" || writeScope.actorUserId !== scope.user.userId ||
      writeScope.orgId !== scope.organization.orgId || writeScope.customerId !== customerId ||
      writeScope.propertyOwnerUserId !== scope.property.ownerUserId ||
      writeScope.propertyRevision !== scope.property.revision ||
      writeScope.organizationRevision !== scope.organization.revision) throw missing();
    const snapshotJson = JSON.stringify(financials);
    if (Buffer.byteLength(snapshotJson, "utf8") > 300_000) throw new RequestError(413, "PROPOSAL_TOO_LARGE", "The policy scenario is too large to save as one proposal.");
    const at = this.now();
    const proposalId = `${at.toISOString().replace(/[-:.TZ]/g, "")}_${this.createId()}`;
    parseInput(identifier, proposalId);
    const expiresAtEpochSeconds = Math.min(Math.floor(at.getTime() / 1_000) + 180 * 86_400,
      scope.analysis.expiresAtEpochSeconds ?? Number.MAX_SAFE_INTEGER);
    if (expiresAtEpochSeconds <= Math.floor(at.getTime() / 1_000)) throw missing();
    const provenance = this.provenance(financials);
    const record: StoredProposal = {
      PK: `CUSTOMER#${customerId}`, SK: `PROPOSAL#${proposalId}`, entityType: "BROKER_PROPOSAL", schemaVersion: 1,
      proposalId, orgId: scope.organization.orgId, customerId, propertyId: input.propertyId, analysisId: input.analysisId,
      createdByUserId: scope.user.userId, createdAt: at.toISOString(), updatedAt: at.toISOString(), revision: 1,
      status: this.status(financials), policyStatus: financials.benefits.status, documentStatus: "NOT_GENERATED",
      ...provenance, snapshotJson, snapshotSha256: BrokerStore.snapshotHash(snapshotJson), expiresAtEpochSeconds,
      ...(scope.analysis.expiresAtEpochSeconds === undefined ? {} : {
        GSI3PK: "GOOGLE_ROOF_RETENTION" as const, GSI3SK: expiresAtEpochSeconds,
      }),
    };
    await this.store.createProposal(record, [
      { ...keys.user(scope.user.userId), revision: writeScope.userRevision,
        conditionExpression: "#revision = :revision AND #org = :org AND #role = :role",
        names: { "#org": "orgId", "#role": "role" },
        values: { ":org": scope.organization.orgId, ":role": "BROKER" } },
      { ...keys.organization(scope.organization.orgId), revision: scope.organization.revision,
        conditionExpression: "#revision = :revision AND #kind = :kind AND contains(#members, :actor)",
        names: { "#kind": "kind", "#members": "memberUserIds" },
        values: { ":kind": "BROKER", ":actor": scope.user.userId } },
      { ...keys.customer(scope.organization.orgId, customerId), revision: scope.customer.revision,
        conditionExpression: "#revision = :revision AND #org = :org AND #kind = :kind",
        names: { "#org": "orgId", "#kind": "kind" },
        values: { ":org": scope.organization.orgId, ":kind": "CUSTOMER" } },
      { ...keys.property(customerId, input.propertyId), revision: scope.property.revision,
        conditionExpression: "#revision = :revision AND #org = :org AND #owner = :owner AND #customer = :customer",
        names: { "#org": "orgId", "#owner": "ownerUserId", "#customer": "customerId" },
        values: { ":org": scope.organization.orgId, ":owner": scope.property.ownerUserId, ":customer": customerId } },
      { ...keys.locator(input.propertyId), revision: writeScope.locatorRevision,
        conditionExpression: "#revision = :revision AND #org = :org AND #owner = :owner AND #customer = :customer",
        names: { "#org": "orgId", "#owner": "ownerUserId", "#customer": "customerId" },
        values: { ":org": scope.organization.orgId, ":owner": scope.property.ownerUserId, ":customer": customerId } },
      { ...keys.analysis(input.propertyId, input.analysisId), revision: scope.analysis.revision,
        conditionExpression: "#revision = :revision AND #org = :org AND #owner = :owner AND #property = :property",
        names: { "#org": "orgId", "#owner": "ownerUserId", "#property": "propertyId" },
        values: { ":org": scope.organization.orgId, ":owner": scope.property.ownerUserId, ":property": input.propertyId } },
    ]);
    return { schemaVersion: 1 as const, source: "BROKER_PROPOSAL_SNAPSHOT_V1" as const, requestId,
      proposal: { ...this.summary(record), financials } };
  }
  async get(identity: CurrentIdentityResponse, customerId: string, proposalId: string, requestId: string) {
    const scope = await this.customer(identity, customerId);
    parseInput(identifier, proposalId);
    const record = await this.store.getProposal(customerId, proposalId);
    if (!record || record.orgId !== scope.organization.orgId ||
      record.expiresAtEpochSeconds <= Math.floor(this.now().getTime() / 1_000)) throw missing();
    const property = await this.core.getProperty(identity, record.propertyId);
    if (property.customerId !== customerId) throw missing();
    let parsed: unknown;
    try { parsed = JSON.parse(record.snapshotJson); }
    catch { throw new RequestError(503, "DATABASE_UNAVAILABLE", "The saved proposal could not be verified."); }
    const financials = verifiedSnapshot(parsed);
    if (financials.propertyId !== record.propertyId || financials.analysisId !== record.analysisId ||
      financials.benefits.status !== record.policyStatus || this.status(financials) !== record.status) {
      throw new RequestError(503, "DATABASE_UNAVAILABLE", "The saved proposal could not be verified.");
    }
    return { schemaVersion: 1 as const, source: "BROKER_PROPOSAL_SNAPSHOT_V1" as const, requestId,
      proposal: { ...this.summary(record), financials } };
  }
  async list(identity: CurrentIdentityResponse, customerId: string, options: unknown, requestId: string) {
    const scope = await this.customer(identity, customerId);
    const page = parseInput(pageInputSchema, options);
    const result = await this.store.listProposals(customerId, page.limit, page.cursor);
    if (result.items.some(record => record.orgId !== scope.organization.orgId)) throw missing();
    const nowEpoch = Math.floor(this.now().getTime() / 1_000);
    return { schemaVersion: 1 as const, source: "BROKER_PROPOSAL_SNAPSHOT_V1" as const, requestId, customerId,
      proposals: result.items.filter(record => record.expiresAtEpochSeconds > nowEpoch).map(record => this.summary(record)),
      ...(result.nextCursor ? { nextCursor: result.nextCursor } : {}) };
  }
  async listDesigns(identity: CurrentIdentityResponse, propertyId: string, options: unknown, requestId: string) {
    const scope = await this.property(identity, propertyId);
    const page = parseInput(pageInputSchema, options);
    const result = await this.store.listDesigns(propertyId, page.limit, page.cursor);
    const records = result.items.map(item => {
      const parsed = userDesignSchema.safeParse(item);
      if (!parsed.success) throw new RequestError(503, "DATABASE_UNAVAILABLE", "Saved design data could not be verified.");
      return parsed.data;
    });
    if (records.some(record => record.propertyId !== propertyId || record.orgId !== scope.organization.orgId ||
      record.ownerUserId !== scope.property.ownerUserId)) throw missing();
    const nowEpoch = Math.floor(this.now().getTime() / 1_000);
    return { schemaVersion: 1 as const, source: "PROPERTY_DESIGN_RECORDS_V1" as const, requestId, propertyId,
      designs: records.filter(record => record.expiresAtEpochSeconds > nowEpoch).map(record => ({
        designId: record.designId, analysisId: record.analysisId, candidateId: record.candidateId,
        fingerprint: record.fingerprint, createdAt: record.createdAt,
        imageStatus: record.imageS3Key ? "READY" as const : "UNAVAILABLE" as const,
        visualAccuracy: "INSPIRATIONAL_ONLY" as const,
      })), ...(result.nextCursor ? { nextCursor: result.nextCursor } : {}) };
  }

  async updateLead(identity: CurrentIdentityResponse, leadId: string, body: unknown, requestId: string) {
    parseInput(identifier, leadId);
    const input = parseInput(leadUpdateInput, body);
    const account = await this.account(identity);
    const previous = await this.repository.getLead(account.organization.orgId, leadId);
    if (!previous || previous.orgId !== account.organization.orgId) throw missing();
    if (previous.revision !== input.expectedRevision) throw new RequestError(409, "LEAD_REVISION_CONFLICT", "Refresh the lead before changing its stage.");
    const from = leadStages.indexOf(previous.status as typeof leadStages[number]);
    const to = leadStages.indexOf(input.status as typeof leadStages[number]);
    if (previous.status === "LOST" || previous.status === "COMPLETED" || input.status === previous.status ||
      (input.status !== "LOST" && (from < 0 || to <= from))) {
      throw new RequestError(409, "INVALID_LEAD_TRANSITION", "Choose a later lead stage or mark it lost.");
    }
    const at = this.now().toISOString();
    const next: StoredLead = { ...previous, status: input.status, revision: previous.revision + 1, updatedAt: at };
    const event = { PK: `ORG#${account.organization.orgId}`,
      SK: `LEAD_EVENT#${leadId}#${String(next.revision).padStart(12, "0")}`,
      entityType: "BROKER_LEAD_EVENT" as const, schemaVersion: 1 as const, orgId: account.organization.orgId,
      leadId, revision: next.revision, actorUserId: account.user.userId,
      previousStatus: previous.status, status: next.status, occurredAt: at };
    await this.store.updateLead(previous, next, event, { actorUserId: account.user.userId,
      userRevision: account.user.revision, orgRevision: account.organization.revision });
    return { schemaVersion: 1 as const, source: "DYNAMODB" as const, requestId, lead: leadDto(next) };
  }
}
