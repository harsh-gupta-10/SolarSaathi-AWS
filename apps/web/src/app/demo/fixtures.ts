import type { NormalizedRoofV1 } from "@solarsaathi/types";

/** Synthetic geometry used only by public demo pages. Never persisted or sent to the API. */
export const demoRoof: NormalizedRoofV1 = {
  schemaVersion: 1,
  source: "MANUAL",
  measuredAt: "2026-01-01T00:00:00.000Z",
  roofAreaSquareMeters: 100,
  segmentCount: 1,
  segments: [{ segmentId: "demo-rectangle", areaSquareMeters: 100, pitchDegrees: 8, azimuthDegrees: 180 }],
  manualDimensions: { lengthMeters: 10, widthMeters: 10 },
};
