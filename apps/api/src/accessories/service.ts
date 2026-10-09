import type { CurrentIdentityResponse } from "@solarsaathi/types";
import { parseInput } from "../data/schemas";
import { RequestError } from "../lib/http";
import { SystemsService } from "../systems/service";
import { recommendAccessoriesV1 } from "./rules";
import { accessoryRecommendationRequestSchema, type AccessoryRecommendationResponseV1 } from "./schema";

export class AccessoriesService {
  constructor(private readonly systems: SystemsService) {}

  async recommend(identity: CurrentIdentityResponse, body: unknown, requestId: string): Promise<AccessoryRecommendationResponseV1> {
    const input = parseInput(accessoryRecommendationRequestSchema, body);
    const systemResponse = await this.systems.recommend(identity, {
      propertyId: input.propertyId, analysisId: input.analysisId, demand: input.demand,
      generationKwhPerKwYear: input.generationKwhPerKwYear,
    }, requestId);
    const { design } = systemResponse;
    const candidate = design.candidates.find(item => item.nominalKw === input.nominalKw);
    if (!candidate) throw new RequestError(400, "INVALID_CANDIDATE", "Select a supported system size from this roof design.");
    if (!candidate.recommendationEligible || candidate.estimatedAnnualGenerationKwh <= 0 ||
      candidate.roofFit === "UNDETERMINED" || candidate.roofFit === "EXCEEDS_MODELED_ROOF") {
      throw new RequestError(422, "CANDIDATE_UNFIT", "The selected system is not supported by this roof and demand estimate.");
    }
    const warnings = [
      "Electrical and structural compatibility require a site survey and qualified installer design.",
      "Accessory prices and accessory-specific policy requirements have not been verified.",
    ];
    if (input.goals?.evCharging || input.evStatus === "PLANNING" || input.evStatus === "OWNS_EV") {
      if (design.demand.sanctionedLoadKw === undefined) warnings.push("Sanctioned load was not supplied; EV charging capacity cannot be assessed.");
    }
    if (input.goals?.backupPower && input.inverterType === "GRID_TIED") {
      warnings.push("You reported a grid-tied inverter. It alone does not provide backup during an outage; a compatible system design is required.");
    }
    if (design.warnings.includes("GOOGLE_ROOF_FIT_APPROXIMATE") || design.warnings.includes("MANUAL_FIT_NEEDS_SITE_SURVEY")) {
      warnings.push("The roof fit is approximate and needs a site survey before equipment placement.");
    }
    return {
      schemaVersion: 1, source: "DETERMINISTIC_ACCESSORY_ADVISOR_V1", requestId,
      propertyId: input.propertyId, analysisId: input.analysisId,
      system: { nominalKw: candidate.nominalKw, actualDcKw: candidate.actualDcKw,
        minimumInverterAcKw: candidate.minimumInverterAcKw, roofSource: design.roof.source,
        generationBasis: candidate.generationBasis },
      recommendations: recommendAccessoriesV1(input), warnings,
      financialIntegration: { includedInBaseEstimate: false, benefitEligibilityEvaluated: false },
    };
  }
}
