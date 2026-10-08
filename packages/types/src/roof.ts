import type { AnalysisSource } from "./index";

export interface RoofPoint {
  latitude: number;
  longitude: number;
}

export interface RoofBounds {
  southwest: RoofPoint;
  northeast: RoofPoint;
}

export interface GeocodeCandidate {
  placeId: string;
  address: string;
  location: RoofPoint;
  locationType: string;
  partialMatch: boolean;
}

export interface RoofSegmentV1 {
  segmentId: string;
  areaSquareMeters: number;
  groundAreaSquareMeters?: number;
  pitchDegrees?: number;
  azimuthDegrees?: number;
  planeHeightAtCenterMeters?: number;
  center?: RoofPoint;
  bounds?: RoofBounds;
  sunshineQuantiles?: number[];
}

export interface SolarPanelSuggestionV1 {
  center: RoofPoint;
  orientation: "LANDSCAPE" | "PORTRAIT";
  segmentIndex: number;
  yearlyEnergyDcKwh?: number;
}

export interface NormalizedRoofV1 {
  schemaVersion: 1;
  source: AnalysisSource;
  measuredAt: string;
  roofAreaSquareMeters: number;
  groundAreaSquareMeters?: number;
  segmentCount: number;
  segments: RoofSegmentV1[];
  center?: RoofPoint;
  bounds?: RoofBounds;
  buildingId?: string;
  imageryDate?: string;
  imageryQuality?: "HIGH" | "MEDIUM" | "BASE";
  panelWidthMeters?: number;
  panelHeightMeters?: number;
  panelCapacityWatts?: number;
  panelSuggestions?: SolarPanelSuggestionV1[];
  manualDimensions?: {
    lengthMeters?: number;
    widthMeters?: number;
  };
}

export interface ManualRoofMeasurements {
  roofAreaSquareMeters: number;
  lengthMeters?: number;
  widthMeters?: number;
  pitchDegrees?: number;
  azimuthDegrees?: number;
}

export interface RoofApiResponse {
  schemaVersion: 1;
  requestId: string;
}

export interface RoofGeocodeResponse extends RoofApiResponse {
  source: "GOOGLE_GEOCODING";
  candidates: GeocodeCandidate[];
}

export interface RoofPreviewResponse extends RoofApiResponse {
  source: "GOOGLE_SOLAR";
  previewId: string;
  roof: NormalizedRoofV1;
}

export interface RoofConfirmationResponse extends RoofApiResponse {
  source: AnalysisSource;
  analysisId: string;
  roof: NormalizedRoofV1;
}
