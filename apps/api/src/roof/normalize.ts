import type { GeocodeCandidate, ManualRoofMeasurements, NormalizedRoofV1, RoofPoint } from "@solarsaathi/types";
import { RequestError } from "../lib/http";
import { geocodeProviderSchema, MAX_STORED_ROOF_BYTES, normalizedRoofSchema, solarProviderSchema } from "./schemas";

const upstreamFailure = () => new RequestError(502, "GOOGLE_RESPONSE_INVALID", "Google returned roof data that could not be verified.");

export function distanceMeters(a: RoofPoint, b: RoofPoint): number {
  const latitude = (a.latitude - b.latitude) * Math.PI / 180;
  const longitude = (a.longitude - b.longitude) * Math.PI / 180;
  const meanLatitude = ((a.latitude + b.latitude) / 2) * Math.PI / 180;
  return 6_371_000 * Math.hypot(latitude, Math.cos(meanLatitude) * longitude);
}

export function normalizeGeocoding(input: unknown): GeocodeCandidate[] {
  const parsed = geocodeProviderSchema.safeParse(input);
  if (!parsed.success) throw upstreamFailure();
  const { status, results } = parsed.data;
  if (status === "ZERO_RESULTS") return [];
  if (status === "OVER_QUERY_LIMIT") throw new RequestError(503, "GOOGLE_QUOTA_EXCEEDED", "Address lookup is temporarily unavailable. Try again later or enter roof measurements manually.");
  if (status !== "OK") throw new RequestError(503, "GOOGLE_GEOCODING_UNAVAILABLE", "Address lookup is temporarily unavailable. Try again later or enter roof measurements manually.");
  if (!results?.length) throw upstreamFailure();
  return results.slice(0, 5).map(result => {
    const candidate = {
      placeId: result.place_id, address: result.formatted_address,
      location: { latitude: result.geometry.location.lat, longitude: result.geometry.location.lng },
      locationType: result.geometry.location_type, partialMatch: result.partial_match === true,
    };
    if (!Number.isFinite(candidate.location.latitude) || Math.abs(candidate.location.latitude) > 90 ||
      !Number.isFinite(candidate.location.longitude) || Math.abs(candidate.location.longitude) > 180) throw upstreamFailure();
    return candidate;
  });
}

function imageDate(value: { year: number; month: number; day: number } | undefined): string | undefined {
  if (!value) return undefined;
  const date = new Date(Date.UTC(value.year, value.month - 1, value.day));
  if (date.getUTCFullYear() !== value.year || date.getUTCMonth() + 1 !== value.month || date.getUTCDate() !== value.day) throw upstreamFailure();
  return date.toISOString().slice(0, 10);
}

export function normalizeSolar(input: unknown, measuredAt: string): NormalizedRoofV1 {
  const parsed = solarProviderSchema.safeParse(input);
  if (!parsed.success) throw upstreamFailure();
  const result = parsed.data;
  const potential = result.solarPotential;
  const roof: NormalizedRoofV1 = {
    schemaVersion: 1, source: "GOOGLE_SOLAR", measuredAt,
    roofAreaSquareMeters: potential.wholeRoofStats.areaMeters2,
    ...(potential.wholeRoofStats.groundAreaMeters2 ? { groundAreaSquareMeters: potential.wholeRoofStats.groundAreaMeters2 } : {}),
    segmentCount: potential.roofSegmentStats.length,
    segments: potential.roofSegmentStats.map((segment, index) => ({
      segmentId: `google-segment-${index}`, areaSquareMeters: segment.stats.areaMeters2,
      ...(segment.stats.groundAreaMeters2 ? { groundAreaSquareMeters: segment.stats.groundAreaMeters2 } : {}),
      ...(segment.pitchDegrees !== undefined ? { pitchDegrees: segment.pitchDegrees } : {}),
      ...(segment.azimuthDegrees !== undefined ? { azimuthDegrees: segment.azimuthDegrees } : {}),
      ...(segment.planeHeightAtCenterMeters !== undefined ? { planeHeightAtCenterMeters: segment.planeHeightAtCenterMeters } : {}),
      ...(segment.center ? { center: segment.center } : {}),
      ...(segment.boundingBox ? { bounds: { southwest: segment.boundingBox.sw, northeast: segment.boundingBox.ne } } : {}),
      ...(segment.stats.sunshineQuantiles ? { sunshineQuantiles: segment.stats.sunshineQuantiles } : {}),
    })),
    center: result.center, buildingId: result.name,
    bounds: { southwest: result.boundingBox.sw, northeast: result.boundingBox.ne },
    ...(result.imageryQuality ? { imageryQuality: result.imageryQuality } : {}),
    ...(result.imageryDate ? { imageryDate: imageDate(result.imageryDate) } : {}),
    ...(potential.panelWidthMeters ? { panelWidthMeters: potential.panelWidthMeters } : {}),
    ...(potential.panelHeightMeters ? { panelHeightMeters: potential.panelHeightMeters } : {}),
    ...(potential.panelCapacityWatts ? { panelCapacityWatts: potential.panelCapacityWatts } : {}),
    ...(potential.solarPanels ? { panelSuggestions: potential.solarPanels.filter(panel =>
      (panel.orientation === "LANDSCAPE" || panel.orientation === "PORTRAIT") &&
      panel.segmentIndex < potential.roofSegmentStats.length).map(panel => ({
      center: panel.center, orientation: panel.orientation as "LANDSCAPE" | "PORTRAIT", segmentIndex: panel.segmentIndex,
      ...(panel.yearlyEnergyDcKwh !== undefined ? { yearlyEnergyDcKwh: panel.yearlyEnergyDcKwh } : {}),
    })) } : {}),
  };
  if (Buffer.byteLength(JSON.stringify(roof), "utf8") > MAX_STORED_ROOF_BYTES) {
    throw new RequestError(422, "SOLAR_ROOF_TOO_COMPLEX", "The roof model is too detailed to save. Enter roof measurements manually.");
  }
  if (!normalizedRoofSchema.safeParse(roof).success) throw upstreamFailure();
  return roof;
}

export function normalizeManual(input: ManualRoofMeasurements, measuredAt: string): NormalizedRoofV1 {
  const roof: NormalizedRoofV1 = {
    schemaVersion: 1, source: "MANUAL", measuredAt,
    roofAreaSquareMeters: input.roofAreaSquareMeters, segmentCount: 1,
    segments: [{ segmentId: "manual-segment-0", areaSquareMeters: input.roofAreaSquareMeters,
      ...(input.pitchDegrees !== undefined ? { pitchDegrees: input.pitchDegrees } : {}),
      ...(input.azimuthDegrees !== undefined ? { azimuthDegrees: input.azimuthDegrees } : {}),
    }],
    ...(input.lengthMeters !== undefined && input.widthMeters !== undefined ? {
      manualDimensions: { lengthMeters: input.lengthMeters, widthMeters: input.widthMeters },
    } : {}),
  };
  if (!normalizedRoofSchema.safeParse(roof).success) throw new RequestError(400, "INVALID_REQUEST", "The manual roof measurements are not supported.");
  return roof;
}
