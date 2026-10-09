import { randomUUID } from "node:crypto";
import type { CurrentIdentityResponse } from "@solarsaathi/types";
import type { PolicyCitationV1 } from "@solarsaathi/policy";
import { BenefitsService } from "../benefits/service";
import { CoreService } from "../data/service";
import { identifier, parseInput } from "../data/schemas";
import { RequestError } from "../lib/http";
import type { PolicyPublicationRepository } from "../policy/publication-storage";
import { addDocumentSchema, chatUpdateSchema, createApplicationSchema, transitionStepSchema, updateDetailsSchema,
  storedApplicationSchema, type ApplicationEventV1, type ApplicationStepStatus, type SolarApplicationV1 } from "./schema";
import type { ApplicationRepository } from "./storage";

interface PublishedProcessStep {
  stepId: string; order: number; title: string; description: string; required: boolean; evidenceFactIds: string[];
}

const unavailable = () => new RequestError(409, "PROCESS_TEMPLATE_UNAVAILABLE",
  "This benefit has no current verified application process. Its official checklist is unavailable.");
const missing = () => new RequestError(404, "NOT_FOUND", "The application was not found for this property.");
const conflict = () => new RequestError(409, "APPLICATION_CONFLICT", "The application changed. Refresh and try again.");

function progress(steps: SolarApplicationV1["steps"]): Pick<SolarApplicationV1, "status" | "expectedNextStepId"> {
  const status = steps.every(step => step.status === "COMPLETED" || !step.required && step.status === "NOT_APPLICABLE") ? "COMPLETED" :
    steps.some(step => step.status === "BLOCKED") ? "BLOCKED" : "IN_PROGRESS";
  const next = steps.find(step => step.required && step.status !== "COMPLETED") ??
    steps.find(step => step.status !== "COMPLETED" && step.status !== "NOT_APPLICABLE");
  return { status, expectedNextStepId: status === "COMPLETED" ? null : next?.stepId ?? null };
}

const equivalents: Readonly<Record<string, string>> = {
  apply: "application", applied: "application", application: "application", submit: "application",
  submitted: "application", submission: "application", install: "installation",
  installed: "installation", installation: "installation", select: "selection", selected: "selection",
  selection: "selection", inspect: "inspection", inspected: "inspection", inspection: "inspection",
  commission: "commissioning", commissioned: "commissioning", commissioning: "commissioning",
  payment: "payment", paid: "payment", subsidy: "subsidy", vendor: "vendor", meter: "meter",
};
function words(value: string) {
  return value.toLowerCase().match(/[a-z]{4,}/g)?.map(word => equivalents[word] ?? word) ?? [];
}
function proposedStatus(message: string, title: string, required: boolean): SolarApplicationV1["steps"][number]["status"] | null {
  const text = message.toLowerCase().trim();
  if (!required && /^(?:this|the) step (?:is )?not applicable[.!]?$/i.test(text)) return "NOT_APPLICABLE";
  if (/[?]/.test(text) || /\b(?:not|never|haven't|hasn't|didn't|don't|won't|will|might|maybe|planning|plan|intend|want|need|should|could|if)\b/.test(text)) return null;
  const aboutStep = /\b(?:this|the) step\b/.test(text) || words(title).some(word => words(text).includes(word));
  if (!aboutStep) return null;
  if (/^(?:i|we) (?:am|are) (?:blocked|stuck)\b/.test(text)) return "BLOCKED";
  if (/^(?:i|we) (?:am|are) working on\b/.test(text) || /^(?:i|we) (?:have )?(?:started|begun)\b/.test(text)) return "IN_PROGRESS";
  if (/^(?:i|we) (?:(?:have|has) )?(?:already )?(?:completed|finished|submitted|received|installed|selected|uploaded|obtained|done)\b/.test(text)) return "COMPLETED";
  return null;
}

function cursorValue(cursor: string | undefined, propertyId: string, actorId: string,
  kind: "applications" | "events", applicationId?: string): Record<string, string> | undefined {
  if (cursor === undefined) return undefined;
  if (cursor.length > 2_048 || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw new RequestError(400, "INVALID_CURSOR", "Use a valid listing cursor.");
  try {
    const decoded = Buffer.from(cursor, "base64url");
    if (decoded.toString("base64url") !== cursor) throw new Error("Noncanonical cursor");
    const parsed: unknown = JSON.parse(decoded.toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid cursor");
    const value = parsed as Record<string, unknown>;
    const key = value.key as Record<string, unknown> | undefined;
    const expectedPK = kind === "applications" ? `PROPERTY#${propertyId}` : `APPLICATION#${applicationId}`;
    const prefix = kind === "applications" ? "APPLICATION#" : "EVENT#";
    if (value.v !== 1 || value.propertyId !== propertyId || value.actorId !== actorId || value.kind !== kind ||
      value.applicationId !== (applicationId ?? null) || !key || Object.keys(key).length !== 2 ||
      key.PK !== expectedPK || typeof key.SK !== "string" || !key.SK.startsWith(prefix) || key.SK.length > 256) {
      throw new Error("Wrong cursor scope");
    }
    return { PK: key.PK, SK: key.SK } as Record<string, string>;
  } catch { throw new RequestError(400, "INVALID_CURSOR", "Use a valid listing cursor."); }
}

function encodeCursor(key: Record<string, string> | undefined, propertyId: string, actorId: string,
  kind: "applications" | "events", applicationId?: string): string | undefined {
  return key ? Buffer.from(JSON.stringify({ v: 1, propertyId, actorId, kind,
    applicationId: applicationId ?? null, key })).toString("base64url") : undefined;
}

export class ApplicationService {
  constructor(private readonly core: CoreService, private readonly benefits: BenefitsService,
    private readonly publication: PolicyPublicationRepository, private readonly repository: ApplicationRepository,
    private readonly now: () => Date = () => new Date(), private readonly createId: () => string = randomUUID) {}

  async create(identity: CurrentIdentityResponse, body: unknown): Promise<SolarApplicationV1> {
    const input = parseInput(createApplicationSchema, body);
    // The selected benefit is recomputed against an owned, unexpired stored roof and current official evidence.
    const { policyId, ...evaluationInput } = input;
    const evaluation = await this.benefits.evaluate(identity, evaluationInput, this.createId());
    if (evaluation.status !== "AVAILABLE") throw unavailable();
    const decision = evaluation.result.decisions.find(item => item.policyId === policyId && item.status === "SELECTED");
    if (!decision || !decision.countedAmountPaise || decision.countedAmountPaise <= 0) {
      throw new RequestError(409, "BENEFIT_NOT_SELECTED", "Choose a currently selected verified benefit before tracking its application.");
    }
    if (decision.sourceChecks.length === 0 || decision.sourceChecks.some(check => !check.fresh || check.status !== "HEALTHY")) {
      throw unavailable();
    }
    const active = await this.publication.getActive(policyId);
    if (!active || active.policyId !== policyId || active.version.policyId !== policyId ||
      active.rule.policyId !== policyId || active.version.version !== decision.policyVersion ||
      active.rule.policyVersion !== decision.policyVersion || active.rule.ruleId !== decision.ruleId ||
      active.rule.benefitId !== decision.benefitId || active.version.status !== "ACTIVE" ||
      active.version.verificationStatus !== "VERIFIED") throw unavailable();
    const template = (active.rule as typeof active.rule & { processSteps?: PublishedProcessStep[] }).processSteps;
    if (!template?.length || template.length > 20) throw unavailable();
    const sorted = [...template].sort((a, b) => a.order - b.order);
    if (new Set(sorted.map(step => step.stepId)).size !== sorted.length ||
      new Set(sorted.map(step => step.order)).size !== sorted.length) throw unavailable();
    const facts = new Map(active.facts.map(fact => [fact.factId, fact]));
    const steps = sorted.map(step => {
      if (!step.evidenceFactIds.length) throw unavailable();
      const citations: PolicyCitationV1[] = step.evidenceFactIds.map(id => {
        const fact = facts.get(id);
        if (!fact || fact.policyId !== policyId || fact.policyVersion !== decision.policyVersion ||
          fact.verificationStatus !== "VERIFIED" || fact.value?.kind !== "TEXT" ||
          !decision.factIds.includes(id)) throw unavailable();
        return fact.citation;
      });
      return { stepId: step.stepId, order: step.order, title: step.title, description: step.description,
        required: step.required, citations, status: "PENDING" as const,
        verificationStatus: "USER_REPORTED" as const, updatedAt: this.now().toISOString() };
    });
    const at = this.now().toISOString();
    const applicationId = this.createId();
    const record = storedApplicationSchema.parse({ schemaVersion: 1, applicationId,
      propertyId: input.propertyId, analysisId: input.analysisId, createdByUserId: identity.profile.userId,
      policyId, policyVersion: decision.policyVersion, benefitId: decision.benefitId,
      ruleId: decision.ruleId, jurisdiction: decision.jurisdiction,
      system: evaluation.system, benefitEvaluatedAt: evaluation.evaluatedAt,
      benefitCountedAmountPaise: decision.countedAmountPaise, lastVerifiedAt: decision.lastVerifiedAt,
      policyCitations: decision.citations, sourceChecks: decision.sourceChecks,
      processSource: "VERIFIED_POLICY_SNAPSHOT", progressSource: "USER_REPORTED",
      ...progress(steps), steps, documents: [], revision: 1, createdAt: at, updatedAt: at });
    const event: ApplicationEventV1 = { schemaVersion: 1, eventId: this.createId(), applicationId,
      propertyId: input.propertyId, actorId: identity.profile.userId, occurredAt: at, action: "CREATED" };
    await this.repository.create(record, event, active.version.version);
    return record;
  }

  private async owned(identity: CurrentIdentityResponse, propertyId: string, applicationId: string) {
    parseInput(identifier, propertyId); parseInput(identifier, applicationId);
    await this.core.getProperty(identity, propertyId);
    const record = await this.repository.get(propertyId, applicationId);
    if (!record || record.propertyId !== propertyId || record.applicationId !== applicationId) throw missing();
    return record;
  }

  async get(identity: CurrentIdentityResponse, propertyId: string, applicationId: string) {
    return this.owned(identity, propertyId, applicationId);
  }

  async list(identity: CurrentIdentityResponse, propertyId: string, limit = 20, cursor?: string) {
    parseInput(identifier, propertyId);
    if (!Number.isInteger(limit) || limit < 1 || limit > 30) throw new RequestError(400, "INVALID_REQUEST", "Use a limit from 1 to 30.");
    await this.core.getProperty(identity, propertyId);
    const page = await this.repository.list(propertyId, limit,
      cursorValue(cursor, propertyId, identity.profile.userId, "applications"));
    if (page.items.some(item => item.propertyId !== propertyId)) throw new RequestError(503, "DATABASE_UNAVAILABLE", "Application data is temporarily unavailable.");
    return { applications: page.items, nextCursor: encodeCursor(page.cursor, propertyId, identity.profile.userId, "applications") };
  }

  async transition(identity: CurrentIdentityResponse, applicationId: string, stepId: string, body: unknown) {
    const input = parseInput(transitionStepSchema, body);
    parseInput(identifier, applicationId);
    if (!/^[A-Z][A-Z0-9_]{1,63}$/.test(stepId)) throw new RequestError(400, "INVALID_REQUEST", "Provide a valid policy step ID.");
    const current = await this.owned(identity, input.propertyId, applicationId);
    if (current.revision !== input.expectedRevision) throw conflict();
    const step = current.steps.find(item => item.stepId === stepId);
    if (!step) throw new RequestError(404, "STEP_NOT_FOUND", "The step is not in this policy checklist.");
    if (step.status === input.status) throw new RequestError(409, "NO_STATE_CHANGE", "Choose a different state for this step.");
    if (step.required && input.status === "NOT_APPLICABLE") {
      throw new RequestError(422, "REQUIRED_STEP", "A required policy step cannot be marked not applicable.");
    }
    if (["COMPLETED", "NOT_APPLICABLE"].includes(step.status) && !input.note) {
      throw new RequestError(422, "CORRECTION_NOTE_REQUIRED", "Explain why a completed or skipped step is being changed.");
    }
    const at = this.now().toISOString();
    const nextSteps = current.steps.map(item => item.stepId !== stepId ? item : {
      ...item, status: input.status, updatedAt: at,
      ...(input.status === "IN_PROGRESS" && !item.startedAt ? { startedAt: at } : {}),
      ...(input.status === "COMPLETED" ? { completedAt: at } : { completedAt: undefined }),
      ...(input.note ? { note: input.note } : {}),
    });
    const next = storedApplicationSchema.parse({ ...current, ...progress(nextSteps), steps: nextSteps,
      revision: current.revision + 1, updatedAt: at });
    const event: ApplicationEventV1 = { schemaVersion: 1, eventId: this.createId(), applicationId,
      propertyId: input.propertyId, actorId: identity.profile.userId, occurredAt: at,
      action: "STEP_TRANSITION", stepId, fromStatus: step.status, toStatus: input.status,
      ...(input.note ? { note: input.note } : {}) };
    await this.repository.replace(current, next, event);
    return next;
  }

  async updateDetails(identity: CurrentIdentityResponse, applicationId: string, body: unknown) {
    const input = parseInput(updateDetailsSchema, body);
    const current = await this.owned(identity, input.propertyId, applicationId);
    if (current.revision !== input.expectedRevision) throw conflict();
    const changes: string[] = [];
    const nextValues: Record<string, unknown> = { ...current };
    for (const field of ["referenceNumber", "vendorName"] as const) {
      if (input[field] !== undefined) {
        const value = input[field] ?? undefined;
        if (current[field] !== value) changes.push(field);
        if (value === undefined) delete nextValues[field]; else nextValues[field] = value;
      }
    }
    if (!changes.length) throw new RequestError(409, "NO_STATE_CHANGE", "The application details did not change.");
    const at = this.now().toISOString();
    const next = storedApplicationSchema.parse({ ...nextValues, revision: current.revision + 1, updatedAt: at });
    await this.repository.replace(current, next, { schemaVersion: 1, eventId: this.createId(), applicationId,
      propertyId: input.propertyId, actorId: identity.profile.userId, occurredAt: at,
      action: "DETAILS_UPDATED", changedFields: changes });
    return next;
  }

  async addDocument(identity: CurrentIdentityResponse, applicationId: string, body: unknown) {
    const input = parseInput(addDocumentSchema, body);
    const current = await this.owned(identity, input.propertyId, applicationId);
    if (current.revision !== input.expectedRevision) throw conflict();
    if (current.documents.length >= 30) throw new RequestError(422, "DOCUMENT_LIMIT", "This tracker already has 30 document notes.");
    const at = this.now().toISOString();
    const documentId = this.createId();
    const document = { documentId, documentType: input.documentType, label: input.label,
      ...(input.obtainedOn ? { obtainedOn: input.obtainedOn } : {}), recordedAt: at,
      verificationStatus: "USER_REPORTED" as const };
    const next = storedApplicationSchema.parse({ ...current, documents: [...current.documents, document],
      revision: current.revision + 1, updatedAt: at });
    await this.repository.replace(current, next, { schemaVersion: 1, eventId: this.createId(), applicationId,
      propertyId: input.propertyId, actorId: identity.profile.userId, occurredAt: at,
      action: "DOCUMENT_RECORDED", documentId });
    return next;
  }

  async events(identity: CurrentIdentityResponse, propertyId: string, applicationId: string,
    limit = 20, cursor?: string) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 30) throw new RequestError(400, "INVALID_REQUEST", "Use a limit from 1 to 30.");
    await this.owned(identity, propertyId, applicationId);
    const page = await this.repository.listEvents(applicationId, limit,
      cursorValue(cursor, propertyId, identity.profile.userId, "events", applicationId));
    if (page.items.some(item => item.propertyId !== propertyId || item.applicationId !== applicationId)) {
      throw new RequestError(503, "DATABASE_UNAVAILABLE", "Application history is temporarily unavailable.");
    }
    return { events: page.items, nextCursor: encodeCursor(page.cursor, propertyId, identity.profile.userId, "events", applicationId) };
  }

  async chatUpdate(identity: CurrentIdentityResponse, applicationId: string, body: unknown) {
    const input = parseInput(chatUpdateSchema, body);
    const application = await this.owned(identity, input.propertyId, applicationId);
    const step = application.steps.find(item => item.stepId === input.stepId);
    if (!step) throw new RequestError(404, "STEP_NOT_FOUND", "The step is not in this policy checklist.");
    const statuses: ApplicationStepStatus[] = ["PENDING", "IN_PROGRESS", "COMPLETED", "BLOCKED",
      ...(!step.required ? ["NOT_APPLICABLE" as const] : [])];
    return { action: "CONFIRMATION_REQUIRED" as const, requiresConfirmation: true as const,
      messageStored: false as const, applicationId, stepId: step.stepId, stepTitle: step.title,
      currentStatus: step.status, proposedStatus: proposedStatus(input.message, step.title, step.required),
      suggestedNote: input.message, revision: application.revision,
      allowedStatuses: statuses.filter(status => status !== step.status),
    };
  }
}
