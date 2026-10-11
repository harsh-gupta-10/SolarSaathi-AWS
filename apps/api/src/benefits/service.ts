import { designSolarSystem, getSystemDesignAssumptionsV1, type SystemCandidate } from "@solarsaathi/calculations";
import {
  benefitEvaluationContextSchema, evaluateBenefitStackV1, policyDocumentSchema, policyFactSchema,
  policySourceSchema, policyVersionSchema, validateOfficialSourceRecord,
  type PolicyEvidenceV1, type PolicySourceHealthV1,
} from "@solarsaathi/policy";
import type { CurrentIdentityResponse } from "@solarsaathi/types";
import { z } from "zod";
import { CoreService } from "../data/service";
import { identifier, parseInput } from "../data/schemas";
import { RequestError } from "../lib/http";
import type { PolicyRepository } from "../policy/storage";
import type { PolicyWorkflowRepository } from "../policy/workflow-storage";
import type { PolicyPublicationRepository } from "../policy/publication-storage";
import { currentSourceFresh } from "../policy/publication-service";
import { systemDemandSchema } from "../systems/schema";

const applicantFacts = benefitEvaluationContextSchema.omit({ systemWatts: true, eligibleQuotedCostPaise: true });
export const benefitEvaluateRequestSchema = z.object({ propertyId: identifier, analysisId: identifier,
  demand: systemDemandSchema, generationKwhPerKwYear: z.number().finite().min(500).max(2_500),
  nominalKw: z.number().finite().min(0.1).max(100),
  eligibleQuotedCostPaise: z.number().int().safe().positive().max(1_000_000_000_000).optional(),
  applicantFacts,
}).strict().refine(value => value.applicantFacts.country === "IN");

const coverage = { central: false, state: false, discom: false, local: false, other: false } as const;
/** A published record failed a deterministic integrity or provenance check (as opposed to an infrastructure failure). */
class BundleIntegrityError extends Error { constructor() { super("Published policy record failed verification."); this.name = "BundleIntegrityError"; } }
const unavailable = () => new RequestError(503, "BENEFIT_EVALUATION_UNAVAILABLE", "Verified policy evaluation is temporarily unavailable.");

export class BenefitsService {
  constructor(private readonly core: CoreService, private readonly records: PolicyRepository,
    private readonly workflow: PolicyWorkflowRepository, private readonly publication: PolicyPublicationRepository,
    private readonly now: () => Date = () => new Date()) {}

  async evaluate(identity: CurrentIdentityResponse, body: unknown, requestId: string,
    trustedSystem?: { propertyId: string; analysisId: string; system: SystemCandidate }) {
    const input = parseInput(benefitEvaluateRequestSchema, body);
    let system: SystemCandidate;
    if (trustedSystem) {
      // Only the server-side composite service can supply a candidate after its own owned-analysis check.
      if (trustedSystem.propertyId !== input.propertyId || trustedSystem.analysisId !== input.analysisId ||
        trustedSystem.system.nominalKw !== input.nominalKw || !trustedSystem.system.recommendationEligible ||
        trustedSystem.system.estimatedAnnualGenerationKwh <= 0 || trustedSystem.system.actualDcKw <= 0 ||
        trustedSystem.system.roofFit === "UNDETERMINED" || trustedSystem.system.roofFit === "EXCEEDS_MODELED_ROOF") {
        throw unavailable();
      }
      system = trustedSystem.system;
    } else {
      const analysis = await this.core.getAnalysis(identity, input.propertyId, input.analysisId);
      if (!analysis.roofModel) throw new RequestError(409, "ROOF_MODEL_REQUIRED", "Confirm a roof before evaluating benefits.");
      try {
        const design = designSolarSystem(analysis.roofModel, input.demand,
          { ...getSystemDesignAssumptionsV1(analysis.roofModel),
            generationKwhPerKwYear: input.generationKwhPerKwYear });
        const selected = design.candidates.find(candidate => candidate.nominalKw === input.nominalKw);
        if (!selected) throw new RequestError(400, "INVALID_CANDIDATE", "Select a supported system size.");
        if (!selected.recommendationEligible || selected.estimatedAnnualGenerationKwh <= 0 ||
          selected.roofFit === "UNDETERMINED" || selected.roofFit === "EXCEEDS_MODELED_ROOF") {
          throw new RequestError(422, "CANDIDATE_UNFIT", "The selected system does not fit this confirmed roof and demand estimate.");
        }
        system = selected;
      } catch (error) {
        if (error instanceof RequestError) throw error;
        throw unavailable();
      }
    }
    const systemSummary = { nominalKw: system.nominalKw, actualDcKw: system.actualDcKw };
    const evaluatedAt = this.now();
    const common = { schemaVersion: 1 as const, source: "DETERMINISTIC_BENEFIT_STACK_V1" as const,
      requestId, propertyId: input.propertyId, analysisId: input.analysisId,
      system: systemSummary, evaluatedAt: evaluatedAt.toISOString(), coverage,
      applicantFactsSource: "USER_DECLARED" as const, eligibilityNotGuaranteed: true as const };
    try {
      const jurisdictions = [input.applicantFacts.country];
      if (input.applicantFacts.state) jurisdictions.push(`${jurisdictions.at(-1)}-${input.applicantFacts.state}`);
      if (input.applicantFacts.state && input.applicantFacts.district) jurisdictions.push(`${jurisdictions.at(-1)}-${input.applicantFacts.district}`);
      if (input.applicantFacts.state && input.applicantFacts.district && input.applicantFacts.localBody) {
        jurisdictions.push(`${jurisdictions.at(-1)}-${input.applicantFacts.localBody}`);
      }
      let bundles;
      try { bundles = await this.publication.listActive(jurisdictions, 17); }
      catch (error) {
        if (error instanceof RangeError) return { ...common, status: "UNAVAILABLE" as const,
          reasonCodes: ["RULE_CATALOG_LIMIT"] };
        throw error;
      }
      if (bundles.length > 16) return { ...common, status: "UNAVAILABLE" as const,
        reasonCodes: ["RULE_CATALOG_LIMIT"] };
      if (!bundles.length) return { ...common, status: "UNAVAILABLE" as const,
        reasonCodes: ["NO_ACTIVE_VERIFIED_RULES"] };
      const evidence: PolicyEvidenceV1[] = [];
      const sourceHealth: PolicySourceHealthV1[] = [];
      // A bundle that fails its integrity or provenance checks is excluded on its own: it can never contribute an amount,
      // and it must not hide the other verified rules. Only the policy ID is logged (never content).
      const failedPolicyIds: string[] = [];
      const loadBundle = async (bundle: typeof bundles[number]) => {
        if (bundle.schemaVersion !== 1 || bundle.policyId !== bundle.version.policyId ||
          bundle.rule.policyId !== bundle.policyId || bundle.rule.policyVersion !== bundle.version.version ||
          bundle.benefitId !== bundle.rule.benefitId ||
          bundle.facts.length !== bundle.rule.factIds.length ||
          bundle.facts.some((fact, index) => fact.factId !== bundle.rule.factIds[index])) throw new BundleIntegrityError();
        const version = policyVersionSchema.parse(bundle.version);
        const facts = bundle.facts.map(item => policyFactSchema.parse(item));
        if (version.status !== "ACTIVE" || version.verificationStatus !== "VERIFIED" ||
          facts.some(fact => fact.verificationStatus !== "VERIFIED")) throw new BundleIntegrityError();
        // Every fact is backed by its own citation; load each distinct source/document once so a multi-source
        // rule is checked against all of its sources instead of only the first fact's.
        const citations = new Map<string, typeof facts[number]["citation"]>();
        for (const fact of facts) {
          const c = fact.citation;
          citations.set(`${c.sourceId}|${c.sourceRegistryVersion}|${c.documentId}|${c.documentVersion}`, c);
        }
        const loadedCitations = new Map<string, { source: ReturnType<typeof validateOfficialSourceRecord>;
          archived: ReturnType<typeof policyDocumentSchema.parse>; health: PolicySourceHealthV1 }>();
        for (const [citationKey, citation] of citations) {
          const [sourceVersion, currentSource, document, state] = await Promise.all([
            this.workflow.getSourceVersion(citation.sourceId, citation.sourceRegistryVersion),
            this.records.getSource(citation.sourceId),
            this.records.getDocument(citation.sourceId, citation.documentId, citation.documentVersion),
            this.workflow.getCrawlState(citation.sourceId),
          ]);
          if (!sourceVersion || !currentSource || !document || document.sha256 !== citation.documentSha256) {
            throw new BundleIntegrityError();
          }
          const source = validateOfficialSourceRecord(policySourceSchema.parse(sourceVersion));
          const archived = policyDocumentSchema.parse(document);
          const fresh = currentSource.registryVersion === sourceVersion.registryVersion &&
            currentSourceFresh(currentSource, state, evaluatedAt) &&
            state?.lastDocumentId === citation.documentId &&
            state.lastDocumentVersion === citation.documentVersion &&
            state.lastObservedSha256 === citation.documentSha256;
          const stateStatus: unknown = state?.status;
          const status = stateStatus === "ERROR" || !!state?.lastErrorCode ||
            stateStatus !== undefined && stateStatus !== "READY" && stateStatus !== "RUNNING" ? "FAILED" :
            stateStatus === "RUNNING" ? "DEGRADED" :
              stateStatus === "READY" && fresh ? "HEALTHY" : "STALE";
          loadedCitations.set(citationKey, { source, archived, health: { sourceId: source.sourceId, status,
            ...(state?.lastCheckedAt ? { lastCheckedAt: state.lastCheckedAt } : {}) } as PolicySourceHealthV1 });
        }
        const bundleEvidence = facts.map(fact => {
          const c = fact.citation;
          const loaded = loadedCitations.get(`${c.sourceId}|${c.sourceRegistryVersion}|${c.documentId}|${c.documentVersion}`)!;
          return { source: loaded.source, document: loaded.archived, version, fact };
        });
        return { bundleEvidence, healths: [...loadedCitations.values()].map(value => value.health) };
      };
      const usable: typeof bundles = [];
      for (let offset = 0; offset < bundles.length; offset += 4) {
        const slice = bundles.slice(offset, offset + 4);
        const loaded = await Promise.all(slice.map(async bundle => {
          try { return { bundle, loaded: await loadBundle(bundle) }; }
          catch (error) {
            // Only deterministic verification failures exclude a record. Infrastructure errors (DynamoDB/S3 throttling,
            // timeouts) must still surface as a retryable 503 rather than be reported as a bad record.
            if (!(error instanceof BundleIntegrityError || error instanceof z.ZodError || error instanceof RangeError)) throw error;
            failedPolicyIds.push(String(bundle.policyId));
            console.error(JSON.stringify({ event: "POLICY_BUNDLE_FAILED_VERIFICATION", policyId: bundle.policyId,
              policyVersion: bundle.rule?.policyVersion, reason: error instanceof Error ? error.name : "unknown" }));
            return undefined;
          }
        }));
        for (const entry of loaded) {
          if (!entry) continue;
          usable.push(entry.bundle);
          const item = entry.loaded;
          evidence.push(...item.bundleEvidence);
          for (const health of item.healths) {
            const existingHealth = sourceHealth.find(value => value.sourceId === health.sourceId);
            if (existingHealth) {
              const priority = { HEALTHY: 0, DEGRADED: 1, STALE: 2, FAILED: 3 } as const;
              if (priority[health.status] > priority[existingHealth.status]) existingHealth.status = health.status;
            } else sourceHealth.push(health);
          }
        }
      }
      // If any applicable rule failed verification, no amount is returned: a dropped rule could be a competitor of, or
      // exclusive with, a rule that passed, so a partial total could be wrong rather than merely lower. Fail closed.
      if (failedPolicyIds.length) return { ...common, status: "UNAVAILABLE" as const,
        reasonCodes: ["POLICY_RECORD_FAILED_VERIFICATION"] };
      if (sourceHealth.every(item => item.status !== "HEALTHY")) return { ...common,
        status: "UNAVAILABLE" as const, reasonCodes: ["NO_CURRENT_VERIFIED_RULES",
          ...(sourceHealth.some(item => item.status === "FAILED" || item.status === "DEGRADED") ?
            ["SOURCE_CHECK_DEGRADED"] : [])] };
      const result = evaluateBenefitStackV1({ at: evaluatedAt,
        context: benefitEvaluationContextSchema.parse({ ...input.applicantFacts,
          systemWatts: Math.round(system.actualDcKw * 1_000),
          ...(input.eligibleQuotedCostPaise !== undefined ? { eligibleQuotedCostPaise: input.eligibleQuotedCostPaise } : {}) }),
        rules: usable.map(bundle => bundle.rule), evidence, sourceHealth, coverage });
      return { ...common, status: "AVAILABLE" as const, result };
    } catch (error) {
      if (error instanceof RequestError) throw error;
      throw unavailable();
    }
  }
}
