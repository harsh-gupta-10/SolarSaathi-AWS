import { designSolarSystem, getSystemDesignAssumptionsV1, type SystemDesignResult } from "@solarsaathi/calculations";
import type { CurrentIdentityResponse } from "@solarsaathi/types";
import { CoreService } from "../data/service";
import { parseInput } from "../data/schemas";
import { RequestError } from "../lib/http";
import { systemRecommendationRequestSchema } from "./schema";

export interface SystemRecommendationResponse {
  schemaVersion: 1;
  source: "DETERMINISTIC_SYSTEM_DESIGN";
  requestId: string;
  propertyId: string;
  analysisId: string;
  design: SystemDesignResult;
}

export class SystemsService {
  constructor(private readonly core: CoreService) {}

  async recommend(identity: CurrentIdentityResponse, body: unknown, requestId: string): Promise<SystemRecommendationResponse> {
    const input = parseInput(systemRecommendationRequestSchema, body);
    const analysis = await this.core.getAnalysis(identity, input.propertyId, input.analysisId);
    if (!analysis.roofModel) {
      throw new RequestError(409, "ROOF_MODEL_REQUIRED", "Confirm a roof with dimensions or Google Solar data before designing a system.");
    }
    const assumptions = { ...getSystemDesignAssumptionsV1(analysis.roofModel),
      generationKwhPerKwYear: input.generationKwhPerKwYear };
    let design: SystemDesignResult;
    try {
      design = designSolarSystem(analysis.roofModel, input.demand, assumptions);
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
      throw new RequestError(503, "SYSTEM_DESIGN_UNAVAILABLE", "The stored roof model could not be used for system design.");
    }
    return { schemaVersion: 1, source: "DETERMINISTIC_SYSTEM_DESIGN", requestId,
      propertyId: input.propertyId, analysisId: input.analysisId, design };
  }
}
