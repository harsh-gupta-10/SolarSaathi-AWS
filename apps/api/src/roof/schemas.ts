import { z } from "zod";

const point = z.object({ latitude: z.number().finite().min(-90).max(90), longitude: z.number().finite().min(-180).max(180) }).strict();
const bounds = z.object({ southwest: point, northeast: point }).strict().refine(value =>
  value.southwest.latitude <= value.northeast.latitude && value.southwest.longitude <= value.northeast.longitude);
const positiveArea = z.number().finite().positive().max(100_000);
const length = z.number().finite().positive().max(1_000);
const pitch = z.number().finite().min(0).max(90);
const azimuth = z.number().finite().min(0).max(360);
const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/);
export const MAX_STORED_ROOF_BYTES = 200_000;

export const roofPointSchema = point;
export const roofSegmentSchema = z.object({
  segmentId: z.string().min(1).max(80), areaSquareMeters: positiveArea,
  groundAreaSquareMeters: positiveArea.optional(), pitchDegrees: pitch.optional(), azimuthDegrees: azimuth.optional(),
  planeHeightAtCenterMeters: z.number().finite().min(-500).max(10_000).optional(),
  center: point.optional(), bounds: bounds.optional(), sunshineQuantiles: z.array(z.number().finite().nonnegative()).max(32).optional(),
}).strict();
export const normalizedRoofSchema = z.object({
  schemaVersion: z.literal(1), source: z.enum(["GOOGLE_SOLAR", "MANUAL"]), measuredAt: z.iso.datetime(),
  roofAreaSquareMeters: positiveArea, groundAreaSquareMeters: positiveArea.optional(),
  segmentCount: z.number().int().min(1).max(1_000), segments: z.array(roofSegmentSchema).min(1).max(1_000),
  center: point.optional(), bounds: bounds.optional(), buildingId: z.string().min(1).max(256).optional(),
  imageryDate: z.iso.date().optional(), imageryQuality: z.enum(["HIGH", "MEDIUM", "BASE"]).optional(),
  panelWidthMeters: length.optional(), panelHeightMeters: length.optional(), panelCapacityWatts: z.number().finite().positive().max(10_000).optional(),
  panelSuggestions: z.array(z.object({
    center: point, orientation: z.enum(["LANDSCAPE", "PORTRAIT"]),
    segmentIndex: z.number().int().nonnegative(), yearlyEnergyDcKwh: z.number().finite().nonnegative().optional(),
  }).strict()).max(1_000).optional(),
  manualDimensions: z.object({ lengthMeters: length.optional(), widthMeters: length.optional() }).strict().optional(),
}).strict().refine(value => value.segments.length === value.segmentCount &&
  (value.source === "MANUAL" ? !value.buildingId && !value.imageryDate && !value.panelSuggestions : !!value.buildingId && !!value.bounds) &&
  Buffer.byteLength(JSON.stringify(value), "utf8") <= MAX_STORED_ROOF_BYTES);

export const geocodeInputSchema = z.object({ propertyId: id }).strict();
export const insightsInputSchema = z.object({ propertyId: id, placeId: z.string().min(1).max(256), location: point }).strict();
export const confirmationInputSchema = z.object({ propertyId: id, previewId: id, confirmed: z.literal(true) }).strict();
function consistentManualArea(value: { roofAreaSquareMeters: number; lengthMeters?: number; widthMeters?: number; pitchDegrees?: number }) {
  if ((value.lengthMeters === undefined) !== (value.widthMeters === undefined)) return false;
  if (value.lengthMeters === undefined || value.widthMeters === undefined) return true;
  const expected = value.lengthMeters * value.widthMeters / Math.cos((value.pitchDegrees ?? 0) * Math.PI / 180);
  return value.roofAreaSquareMeters >= expected * 0.85 && value.roofAreaSquareMeters <= expected * 1.15;
}
export const manualMeasurementsSchema = z.object({
  roofAreaSquareMeters: positiveArea, lengthMeters: length.optional(), widthMeters: length.optional(),
  pitchDegrees: z.number().finite().min(0).max(75).optional(), azimuthDegrees: azimuth.optional(),
}).strict().refine(consistentManualArea);
export const roofConfirmationInputSchema = z.union([
  confirmationInputSchema,
  z.object({ propertyId: id, manual: manualMeasurementsSchema, confirmed: z.literal(true) }).strict(),
]);

export const geocodeProviderSchema = z.object({
  status: z.string(), results: z.array(z.object({
    place_id: z.string().min(1), formatted_address: z.string().min(1),
    geometry: z.object({ location: z.object({ lat: z.number().finite(), lng: z.number().finite() }), location_type: z.string() }).passthrough(),
    partial_match: z.boolean().optional(),
  }).passthrough()).optional(),
}).passthrough();

const googlePoint = point;
const googleStats = z.object({
  areaMeters2: positiveArea, groundAreaMeters2: positiveArea.optional(),
  sunshineQuantiles: z.array(z.number().finite().nonnegative()).max(32).optional(),
}).passthrough();
export const solarProviderSchema = z.object({
  name: z.string().regex(/^buildings\/[^/]+$/), center: googlePoint,
  boundingBox: z.object({ sw: googlePoint, ne: googlePoint }).refine(value =>
    value.sw.latitude <= value.ne.latitude && value.sw.longitude <= value.ne.longitude),
  imageryQuality: z.enum(["HIGH", "MEDIUM", "BASE"]).optional(),
  imageryDate: z.object({ year: z.number().int(), month: z.number().int(), day: z.number().int() }).optional(),
  solarPotential: z.object({
    wholeRoofStats: googleStats, buildingStats: googleStats.optional(),
    roofSegmentStats: z.array(z.object({
      stats: googleStats, center: googlePoint.optional(), boundingBox: z.object({ sw: googlePoint, ne: googlePoint }).optional(),
      pitchDegrees: pitch.optional(), azimuthDegrees: azimuth.optional(),
      planeHeightAtCenterMeters: z.number().finite().min(-500).max(10_000).optional(),
    }).passthrough()).min(1).max(1_000),
    panelWidthMeters: length.optional(), panelHeightMeters: length.optional(),
    panelCapacityWatts: z.number().finite().positive().max(10_000).optional(),
    solarPanels: z.array(z.object({
      center: googlePoint, orientation: z.string(),
      segmentIndex: z.number().int().nonnegative(), yearlyEnergyDcKwh: z.number().finite().nonnegative().optional(),
    }).passthrough()).max(1_000).optional(),
  }).passthrough(),
}).passthrough();
