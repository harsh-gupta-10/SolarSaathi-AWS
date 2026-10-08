import type { RoofLayoutWarning } from "@solarsaathi/calculations";

export const roofLayoutWarningText: Record<RoofLayoutWarning, string> = {
  GOOGLE_BOUNDS_ARE_APPROXIMATE: "Google supplies bounding boxes, not exact roof outlines.",
  SEGMENT_BOUNDS_MISSING: "Some roof segments have no usable bounds and cannot be modeled for panel fit.",
  PANEL_SUGGESTIONS_MISSING: "Google did not return usable panel positions for this roof.",
  PANEL_DIMENSIONS_DIFFER_FROM_GOOGLE_MODEL: "The selected panel size differs from the size used for Google's suggestions.",
  PANEL_SPECS_DIFFER_FROM_GOOGLE_MODEL: "Panel dimensions or capacity differ from Google's model, so provider energy estimates are not shown.",
  PANELS_FILTERED_FOR_CLEARANCE: "Some suggested panels were removed by the modeled setback or service path.",
  AREA_ONLY_MANUAL_ROOF: "Area alone cannot determine roof shape or panel fit; the drawing is symbolic.",
  MANUAL_AREA_DIFFERS_FROM_DIMENSIONS: "Entered area and footprint dimensions differ; check them with an installer.",
  PANEL_LIMIT_REACHED: "The layout reached its panel count limit.",
  NEAR_VERTICAL_SEGMENT: "A near-vertical segment was excluded from the layout.",
  PITCH_ASSUMED_FLAT: "Roof pitch was not provided; the drawing uses a flat plane for illustration.",
  NO_USABLE_GEOMETRY: "The available measurements cannot support a panel layout.",
};
