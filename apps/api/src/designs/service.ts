import { createHash } from "node:crypto";
import { designSolarSystem, getSystemDesignAssumptionsV1 } from "@solarsaathi/calculations";
import type { CurrentIdentityResponse } from "@solarsaathi/types";
import { identifier, parseInput } from "../data/schemas";
import { keys } from "../data/keys";
import { CoreService } from "../data/service";
import { RequestError } from "../lib/http";
import { applyStoredTemplate, planRemainingSpaceV1, templateSpecFor } from "./geometry";
import type { DesignAssetStore, DesignImageGenerator } from "./image";
import { designGenerationRequestSchema, designImageQuerySchema, designRecommendationRequestSchema,
  fingerprintSchema, type DesignGenerationResponseV1, type DesignRecommendationResponseV1 } from "./schema";
import { DesignStore, type StoredDesignTemplate, type StoredUserDesign } from "./store";

const noFit = () => new RequestError(422, "CANDIDATE_UNFIT", "The selected system is not supported by this roof and demand estimate.");
const missing = () => new RequestError(404, "NOT_FOUND", "The requested design was not found.");

export interface DesignServiceDependencies { now?: () => Date }

export class DesignsService {
  private readonly now: () => Date;
  constructor(private readonly core: CoreService, private readonly store?: DesignStore,
    private readonly imageGenerator?: DesignImageGenerator, private readonly assets?: DesignAssetStore,
    dependencies: DesignServiceDependencies = {}) {
    this.now = dependencies.now ?? (() => new Date());
  }

  async recommend(identity: CurrentIdentityResponse, body: unknown, requestId: string): Promise<DesignRecommendationResponseV1> {
    const input = parseInput(designRecommendationRequestSchema, body);
    const analysis = await this.core.getAnalysis(identity, input.propertyId, input.analysisId);
    if (!analysis.roofModel) throw new RequestError(409, "ROOF_MODEL_REQUIRED", "Confirm roof measurements before planning remaining space.");
    const assumptions = { ...getSystemDesignAssumptionsV1(analysis.roofModel),
      generationKwhPerKwYear: input.generationKwhPerKwYear };
    let design;
    try { design = designSolarSystem(analysis.roofModel, input.demand, assumptions); }
    catch (error) {
      if (!(error instanceof RangeError)) throw error;
      throw new RequestError(503, "DESIGN_GEOMETRY_UNAVAILABLE", "The confirmed roof could not be modeled.");
    }
    if (design.roof.fitStatus === "UNDETERMINED") {
      throw new RequestError(422, "ROOF_GEOMETRY_UNDETERMINED", "Confirm roof dimensions and panel placement before planning remaining space.");
    }
    const candidate = design.candidates.find(value => value.nominalKw === input.nominalKw);
    if (!candidate) throw new RequestError(400, "INVALID_CANDIDATE", "Select a supported system size from this roof design.");
    if (!candidate.recommendationEligible || candidate.estimatedAnnualGenerationKwh <= 0 ||
      candidate.roofFit === "UNDETERMINED" || candidate.roofFit === "EXCEEDS_MODELED_ROOF") throw noFit();
    const result = planRemainingSpaceV1(analysis.roofModel, assumptions, candidate, requestId,
      input.propertyId, input.analysisId, input.preferences?.categories);
    if (this.store) {
      let lookupFailed = false;
      await Promise.all(result.candidates.map(async concept => {
        try {
          const stored = await this.store!.getTemplate(concept.fingerprint);
          if (stored?.category === concept.category && stored.candidateId === concept.candidateId)
            applyStoredTemplate(concept, result.geometry.freeZones, stored);
        } catch { lookupFailed = true; }
      }));
      if (lookupFailed) result.warnings.push("Stored concept templates are temporarily unavailable; deterministic concepts remain available.");
    }
    return result;
  }

  async generate(identity: CurrentIdentityResponse, body: unknown, requestId: string): Promise<DesignGenerationResponseV1> {
    const input = parseInput(designGenerationRequestSchema, body);
    const recommendation = await this.recommend(identity, {
      propertyId: input.propertyId, analysisId: input.analysisId, nominalKw: input.nominalKw,
      demand: input.demand, generationKwhPerKwYear: input.generationKwhPerKwYear,
      ...(input.preferences ? { preferences: input.preferences } : {}),
    }, requestId);
    const candidate = recommendation.candidates.find(value => value.candidateId === input.candidateId);
    if (!candidate || candidate.status !== "SPACE_FEASIBLE" || !candidate.placement) {
      throw new RequestError(422, "DESIGN_SPACE_UNAVAILABLE", "The selected concept does not fit a modeled clear zone.");
    }
    const analysis = await this.core.getAnalysis(identity, input.propertyId, input.analysisId);
    const warnings = [...recommendation.warnings];
    let template: StoredDesignTemplate | undefined;
    const designSpec = templateSpecFor(candidate);
    if (this.store && designSpec) {
      try {
        template = await this.store.createTemplate({ PK: `DESIGN#${candidate.fingerprint}`, SK: "VERSION#1",
          entityType: "DESIGN_TEMPLATE", schemaVersion: 1, fingerprint: candidate.fingerprint,
          category: candidate.category, candidateId: candidate.candidateId, roofSource: analysis.roof.source,
          roofAreaBucket: Math.floor(analysis.roof.roofAreaSquareMeters / 10), solarKw: input.nominalKw,
          freeAreaBucket: Math.floor((recommendation.planning.remainingProjectedAreaSquareMeters ?? 0) / 5),
          designSpec, createdAt: this.now().toISOString() });
      } catch { warnings.push("Template storage is unavailable; the deterministic concept remains usable."); }
    }
    if (template && !applyStoredTemplate(candidate, recommendation.geometry.freeZones, template)) {
      template = undefined;
      warnings.push("The stored template does not fit this modeled clear zone; the deterministic concept remains usable.");
    }
    if (!template) candidate.template.status = "DETERMINISTIC_FALLBACK";
    const image = { status: input.render === "TEMPLATE" ? "NOT_REQUESTED" as const : "UNAVAILABLE" as const,
      propertyScoped: false, visualAccuracy: "INSPIRATIONAL_ONLY" as const,
      ...(input.render === "IMAGE" ? { reason: "Image generation or private asset storage is unavailable; use the deterministic 3D concept." } : {}) };
    let designId: string | undefined;
    let imageResult: DesignGenerationResponseV1["concept"]["image"] = image;
    if (input.render === "IMAGE" && this.store && template && this.imageGenerator && this.assets) {
      const nowEpoch = Math.floor(this.now().getTime() / 1_000);
      const sourceExpiry = analysis.expiresAtEpochSeconds;
      if (sourceExpiry !== undefined && sourceExpiry <= nowEpoch + 2 * 86_400) {
        warnings.push("The confirmed Google roof is close to expiry; image storage is skipped to respect source retention.");
      } else {
        const newId = createHash("sha256").update(`${input.propertyId}\0${input.analysisId}\0${candidate.candidateId}\0${candidate.fingerprint}`)
          .digest("hex").slice(0, 32);
        const expiresAtEpochSeconds = Math.min(nowEpoch + 86_400, sourceExpiry ?? Number.MAX_SAFE_INTEGER);
        let claimed = false;
        try { claimed = await this.store.claimImageGeneration(input.propertyId, newId, analysis.ownerUserId,
          identity.profile.userId, input.analysisId, candidate.fingerprint, this.now(), sourceExpiry); }
        catch { warnings.push("Image generation could not be reserved; use the deterministic concept."); }
        if (!claimed) {
          const existing = await this.store.getUserDesign(input.propertyId, newId).catch(() => undefined);
          if (existing?.imageS3Key && existing.expiresAtEpochSeconds > nowEpoch &&
            existing.ownerUserId === analysis.ownerUserId && existing.orgId === analysis.orgId &&
            existing.analysisId === input.analysisId && existing.fingerprint === candidate.fingerprint &&
            existing.imageS3Key === `generated/${input.propertyId}/${input.analysisId}/${newId}.png`) {
            try {
              const url = await this.assets.signedUrl(existing.imageS3Key);
              if (url.startsWith("https://")) {
                designId = newId;
                imageResult = { status: "READY", url, expiresAt: new Date(this.now().getTime() + 300_000).toISOString(),
                  source: "BEDROCK_NOVA_CANVAS", propertyScoped: true, visualAccuracy: "INSPIRATIONAL_ONLY" };
              }
            } catch { warnings.push("The saved image cannot be opened now; use the deterministic concept."); }
          }
        } else {
          let imageKey: string | undefined;
          try {
            const bytes = await this.imageGenerator.generate(candidate.category);
            if (bytes) {
              imageKey = `generated/${input.propertyId}/${input.analysisId}/${newId}.png`;
              await this.assets.put(imageKey, bytes);
            }
          } catch { imageKey = undefined; }
          const record: StoredUserDesign = { PK: `PROPERTY#${input.propertyId}`, SK: `DESIGN#${newId}`,
            entityType: "USER_DESIGN", schemaVersion: 1, designId: newId, propertyId: input.propertyId,
            analysisId: input.analysisId, ownerUserId: analysis.ownerUserId, orgId: analysis.orgId,
            candidateId: candidate.candidateId, fingerprint: candidate.fingerprint,
            ...(imageKey ? { imageS3Key: imageKey } : {}), createdAt: this.now().toISOString(),
            expiresAtEpochSeconds,
            ...(sourceExpiry === undefined ? {} : keys.googleRetention(expiresAtEpochSeconds)) };
          try {
            await this.store.createUserDesign(record);
            designId = newId;
            if (imageKey) {
              try {
                const url = await this.assets.signedUrl(imageKey);
                if (url.startsWith("https://")) {
                  imageResult = { status: "READY", url, expiresAt: new Date(this.now().getTime() + 300_000).toISOString(),
                    source: "BEDROCK_NOVA_CANVAS", propertyScoped: true, visualAccuracy: "INSPIRATIONAL_ONLY" };
                }
              } catch { warnings.push("The generated image cannot be opened now; the deterministic concept remains available."); }
            }
          } catch {
            if (imageKey) await this.assets.delete(imageKey).catch(() => undefined);
            warnings.push("The design could not be saved; the deterministic concept remains available.");
          }
        }
      }
    }
    return { schemaVersion: 1, source: "ROOFTOP_DESIGN_CONCEPT_V1", requestId,
      propertyId: input.propertyId, analysisId: input.analysisId, ...(designId ? { designId } : {}),
      candidate, concept: { template: { status: template ? "STORED" : "DETERMINISTIC_FALLBACK",
        fingerprint: candidate.fingerprint, ...(template ? { templateId: template.fingerprint } : {}) },
      image: imageResult }, warnings };
  }

  async template(identity: CurrentIdentityResponse, fingerprintValue: unknown, requestId: string) {
    const fingerprint = parseInput(fingerprintSchema, fingerprintValue);
    await this.core.getUser(identity);
    const stored = this.store ? await this.store.getTemplate(fingerprint) : undefined;
    return { schemaVersion: 1 as const, source: this.store ? "DYNAMODB" as const : "UNAVAILABLE" as const,
      requestId, templates: stored ? [{ templateId: stored.fingerprint, fingerprint: stored.fingerprint,
        category: stored.category, candidateId: stored.candidateId, roofSource: stored.roofSource,
        roofAreaBucket: stored.roofAreaBucket, solarKw: stored.solarKw, freeAreaBucket: stored.freeAreaBucket,
        designSpec: stored.designSpec, createdAt: stored.createdAt }] : [] };
  }

  async image(identity: CurrentIdentityResponse, designIdValue: unknown, query: unknown, requestId: string) {
    const designId = parseInput(identifier, designIdValue);
    const { propertyId } = parseInput(designImageQuerySchema, query);
    await this.core.getProperty(identity, propertyId);
    if (!this.store || !this.assets) throw missing();
    const record = await this.store.getUserDesign(propertyId, designId);
    if (!record || !record.imageS3Key || record.expiresAtEpochSeconds <= Math.floor(this.now().getTime() / 1_000)) throw missing();
    const analysis = await this.core.getAnalysis(identity, propertyId, record.analysisId);
    if (analysis.ownerUserId !== record.ownerUserId || analysis.orgId !== record.orgId) throw missing();
    if (record.imageS3Key !== `generated/${propertyId}/${record.analysisId}/${designId}.png`) throw missing();
    const url = await this.assets.signedUrl(record.imageS3Key);
    if (!url.startsWith("https://")) throw new RequestError(503, "DESIGN_IMAGE_UNAVAILABLE", "The private design image could not be opened.");
    return { schemaVersion: 1 as const, source: "PROPERTY_SCOPED_IMAGE" as const, requestId,
      designId, status: "READY" as const, url, expiresAt: new Date(this.now().getTime() + 300_000).toISOString(),
      visualAccuracy: "INSPIRATIONAL_ONLY" as const };
  }
}
