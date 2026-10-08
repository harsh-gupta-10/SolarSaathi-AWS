import type { CurrentIdentityResponse, RoofConfirmationResponse, RoofGeocodeResponse, RoofPreviewResponse } from "@solarsaathi/types";
import { CoreService } from "../data/service";
import { parseInput } from "../data/schemas";
import { RequestError } from "../lib/http";
import { GoogleRoofClient } from "./google";
import { distanceMeters, normalizeGeocoding, normalizeManual, normalizeSolar } from "./normalize";
import {
  confirmationInputSchema, geocodeInputSchema, insightsInputSchema, roofConfirmationInputSchema,
} from "./schemas";

export class RoofService {
  constructor(private readonly core: CoreService, private readonly google: GoogleRoofClient,
    private readonly now: () => Date = () => new Date()) {}

  async geocode(identity: CurrentIdentityResponse, input: unknown, requestId: string): Promise<RoofGeocodeResponse> {
    const { propertyId } = parseInput(geocodeInputSchema, input);
    const property = await this.core.getProperty(identity, propertyId);
    const candidates = normalizeGeocoding(await this.google.geocode(property.address));
    return { schemaVersion: 1, source: "GOOGLE_GEOCODING", requestId, candidates };
  }

  async buildingInsights(identity: CurrentIdentityResponse, input: unknown, requestId: string): Promise<RoofPreviewResponse> {
    const { propertyId, placeId, location } = parseInput(insightsInputSchema, input);
    const property = await this.core.getProperty(identity, propertyId);
    const candidates = normalizeGeocoding(await this.google.geocode(property.address));
    const candidate = candidates.find(value => value.placeId === placeId);
    if (!candidate || distanceMeters(candidate.location, location) > 250) {
      throw new RequestError(400, "BUILDING_SELECTION_INVALID", "Select a building near the address result or update the property address.");
    }
    const roof = normalizeSolar(await this.google.buildingInsights(location), this.now().toISOString());
    if (!roof.center || distanceMeters(roof.center, location) > 75) {
      throw new RequestError(404, "SOLAR_BUILDING_NOT_FOUND", "No supported building was found at that point. Select the building again or enter roof measurements manually.");
    }
    const preview = await this.core.saveRoofPreview(identity, propertyId, placeId, location, roof);
    return { schemaVersion: 1, source: "GOOGLE_SOLAR", requestId, previewId: preview.previewId, roof: preview.roof };
  }

  async confirmBuilding(identity: CurrentIdentityResponse, input: unknown, requestId: string): Promise<RoofPreviewResponse> {
    const { propertyId, previewId } = parseInput(confirmationInputSchema, input);
    const preview = await this.core.confirmBuilding(identity, propertyId, previewId);
    return { schemaVersion: 1, source: "GOOGLE_SOLAR", requestId, previewId, roof: preview.roof };
  }

  async confirmRoof(identity: CurrentIdentityResponse, input: unknown, requestId: string): Promise<RoofConfirmationResponse> {
    const value = parseInput(roofConfirmationInputSchema, input);
    if ("manual" in value) {
      const roof = normalizeManual(value.manual, this.now().toISOString());
      const analysis = await this.core.saveManualRoof(identity, value.propertyId, roof);
      return { schemaVersion: 1, source: "MANUAL", requestId, analysisId: analysis.analysisId, roof };
    }
    const analysis = await this.core.saveConfirmedRoof(identity, value.propertyId, value.previewId);
    if (!analysis.roofModel) throw new RequestError(503, "DATABASE_UNAVAILABLE", "Stored roof data could not be verified.");
    return { schemaVersion: 1, source: "GOOGLE_SOLAR", requestId, analysisId: analysis.analysisId, roof: analysis.roofModel };
  }
}
