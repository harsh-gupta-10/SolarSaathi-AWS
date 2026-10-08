import { designSolarSystem, getSystemDesignAssumptionsV1 } from "@solarsaathi/calculations";
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
const unavailable = () => new RequestError(503, "BENEFIT_EVALUATION_UNAVAILABLE", "Verified policy evaluation is temporarily unavailable.");

export class BenefitsService {
  constructor(private readonly core: CoreService, private readonly records: PolicyRepository,
    private readonly workflow: PolicyWorkflowRepository, private readonly publication: PolicyPublicationRepository,
    private readonly now: () => Date = () => new Date()) {}

  async evaluate(identity: CurrentIdentityResponse, body: unknown, requestId: string) {
    const input = parseInput(benefitEvaluateRequestSchema, body);
    const analysis = await this.core.getAnalysis(identity, input.propertyId, input.analysisId);
    if (!analysis.roofModel) throw new RequestError(409, "ROOF_MODEL_REQUIRED", "Confirm a roof before evaluating benefits.");
    let system;
    try {
      const design = designSolarSystem(analysis.roofModel, input.demand,
        { ...getSystemDesignAssumptionsV1(analysis.roofModel),
          generationKwhPerKwYear: input.generationKwhPerKwYear });
      system = design.candidates.find(candidate => candidate.nominalKw === input.nominalKw);
      if (!system) throw new RequestError(400, "INVALID_CANDIDATE", "Select a supported system size.");
      if (!system.recommendationEligible || system.estimatedAnnualGenerationKwh <= 0 ||
        system.roofFit === "UNDETERMINED" || system.roofFit === "EXCEEDS_MODELED_ROOF") {
        throw new RequestError(422, "CANDIDATE_UNFIT", "The selected system does not fit this confirmed roof and demand estimate.");
      }
    } catch (error) {
      if (error instanceof RequestError) throw error;
      throw unavailable();
    }
    const systemSummary = { nominalKw: system.nominalKw, actualDcKw: system.actualDcKw };
    const common = { schemaVersion: 1 as const, source: "DETERMINISTIC_BENEFIT_STACK_V1" as const,
      requestId, propertyId: input.propertyId, analysisId: input.analysisId,
      system: systemSummary, evaluatedAt: this.now().toISOString(), coverage,
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
      const loadBundle = async (bundle: typeof bundles[number]) => {
        if (bundle.schemaVersion !== 1 || bundle.policyId !== bundle.version.policyId ||
          bundle.rule.policyId !== bundle.policyId || bundle.rule.policyVersion !== bundle.version.version ||
          bundle.benefitId !== bundle.rule.benefitId ||
          bundle.facts.length !== bundle.rule.factIds.length ||
          bundle.facts.some((fact, index) => fact.factId !== bundle.rule.factIds[index])) throw unavailable();
        const version = policyVersionSchema.parse(bundle.version);
        const facts = bundle.facts.map(item => policyFactSchema.parse(item));
        if (version.status !== "ACTIVE" || version.verificationStatus !== "VERIFIED" ||
          facts.some(fact => fact.verificationStatus !== "VERIFIED")) throw unavailable();
        const citation = facts[0]!.citation;
        const [sourceVersion, currentSource, document, state] = await Promise.all([
          this.workflow.getSourceVersion(citation.sourceId, citation.sourceRegistryVersion),
          this.records.getSource(citation.sourceId),
          this.records.getDocument(citation.sourceId, citation.documentId, citation.documentVersion),
          this.workflow.getCrawlState(citation.sourceId),
        ]);
        if (!sourceVersion || !currentSource || !document ||
          currentSource.registryVersion !== sourceVersion.registryVersion ||
          document.sha256 !== citation.documentSha256) throw unavailable();
        const source = validateOfficialSourceRecord(policySourceSchema.parse(sourceVersion));
        const archived = policyDocumentSchema.parse(document);
        const bundleEvidence = facts.map(fact => ({ source, document: archived, version, fact }));
        const fresh = currentSourceFresh(currentSource, state, this.now()) &&
          state?.lastDocumentId === citation.documentId &&
          state.lastDocumentVersion === citation.documentVersion &&
          state.lastObservedSha256 === citation.documentSha256;
        const status = !fresh ? "STALE" : state.status === "ERROR" ? "DEGRADED" : "HEALTHY";
        return { bundleEvidence, health: { sourceId: source.sourceId, status,
          ...(state?.lastCheckedAt ? { lastCheckedAt: state.lastCheckedAt } : {}) } as PolicySourceHealthV1 };
      };
      for (let offset = 0; offset < bundles.length; offset += 4) {
        const loaded = await Promise.all(bundles.slice(offset, offset + 4).map(loadBundle));
        for (const item of loaded) {
          evidence.push(...item.bundleEvidence);
          const existingHealth = sourceHealth.find(value => value.sourceId === item.health.sourceId);
          if (existingHealth) {
            if (item.health.status === "STALE") existingHealth.status = "STALE";
          } else sourceHealth.push(item.health);
        }
      }
      if (sourceHealth.every(item => item.status === "STALE")) return { ...common,
        status: "UNAVAILABLE" as const, reasonCodes: ["NO_CURRENT_VERIFIED_RULES"] };
      const result = evaluateBenefitStackV1({ at: this.now(),
        context: benefitEvaluationContextSchema.parse({ ...input.applicantFacts,
          systemWatts: Math.round(system.actualDcKw * 1_000),
          ...(input.eligibleQuotedCostPaise !== undefined ? { eligibleQuotedCostPaise: input.eligibleQuotedCostPaise } : {}) }),
        rules: bundles.map(bundle => bundle.rule), evidence, sourceHealth, coverage });
      return { ...common, status: "AVAILABLE" as const, result };
    } catch (error) {
      if (error instanceof RequestError) throw error;
      throw unavailable();
    }
  }
}
