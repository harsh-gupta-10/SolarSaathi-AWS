import type { NormalizedRoofV1, RoofPoint, RoofSegmentV1 } from "@solarsaathi/types";

/** Distances and positions are metres in a local east/up/north frame. */
export interface RoofLayoutPoint { x: number; y: number; z: number }
export type RoofLayoutCorners = [RoofLayoutPoint, RoofLayoutPoint, RoofLayoutPoint, RoofLayoutPoint];
export interface RoofLayoutBounds { min: RoofLayoutPoint; max: RoofLayoutPoint }
export type RoofGeometryKind = "GOOGLE_BOUNDS_APPROXIMATE" | "MANUAL_RECTANGLE" | "AREA_ONLY_ILLUSTRATION";
export type RoofFitStatus = "MODELED_APPROXIMATE" | "SPACE_FEASIBLE" | "UNDETERMINED";
export type RoofLayoutWarning =
  | "GOOGLE_BOUNDS_ARE_APPROXIMATE"
  | "SEGMENT_BOUNDS_MISSING"
  | "PANEL_SUGGESTIONS_MISSING"
  | "PANEL_DIMENSIONS_DIFFER_FROM_GOOGLE_MODEL"
  | "PANEL_SPECS_DIFFER_FROM_GOOGLE_MODEL"
  | "PANELS_FILTERED_FOR_CLEARANCE"
  | "PITCH_ASSUMED_FLAT"
  | "AREA_ONLY_MANUAL_ROOF"
  | "MANUAL_AREA_DIFFERS_FROM_DIMENSIONS"
  | "PANEL_LIMIT_REACHED"
  | "NEAR_VERTICAL_SEGMENT"
  | "NO_USABLE_GEOMETRY";

export interface RoofLayoutAssumptions {
  schemaVersion: 1;
  panelWidthMeters: number;
  panelHeightMeters: number;
  panelCapacityWatts: number;
  edgeSetbackMeters: number;
  panelGapMeters: number;
  servicePathWidthMeters: number;
  /** Vertical separation between the modeled roof plane and panel face. */
  mountingOffsetMeters: number;
  /** Allowed relative difference between reported surface area and dimensions before warning. */
  manualAreaToleranceFraction: number;
  /** Segments steeper than this are excluded from 3D placement for numerical stability. */
  maxModeledPitchDegrees: number;
  maxPanels: number;
}

export interface RoofLayoutSegment {
  segmentId: string;
  geometryKind: RoofGeometryKind;
  areaSquareMeters: number;
  pitchDegrees: number;
  azimuthDegrees: number;
  center: RoofLayoutPoint;
  /** Southwest, southeast, northeast, northwest in the local frame. */
  corners: RoofLayoutCorners;
}

export interface RoofLayoutPanel {
  panelId: string;
  segmentId: string;
  orientation: "LANDSCAPE" | "PORTRAIT";
  center: RoofLayoutPoint;
  corners: RoofLayoutCorners;
  yearlyEnergyDcKwh?: number;
}

export interface RoofLayout {
  schemaVersion: 1;
  coordinateSystem: "LOCAL_EAST_UP_NORTH_METERS";
  source: NormalizedRoofV1["source"];
  fitStatus: RoofFitStatus;
  bounds: RoofLayoutBounds | null;
  segments: RoofLayoutSegment[];
  panels: RoofLayoutPanel[];
  /** Null means the available geometry cannot support a defensible fit estimate. */
  panelCount: number | null;
  dcCapacityKw: number | null;
  clearances: Pick<RoofLayoutAssumptions, "edgeSetbackMeters" | "panelGapMeters" | "servicePathWidthMeters">;
  warnings: RoofLayoutWarning[];
}

interface Point2 { x: number; z: number }
interface Rectangle { minX: number; maxX: number; minZ: number; maxZ: number }
interface WorkingSegment {
  result: RoofLayoutSegment;
  rectangle: Rectangle;
  pitchRadians: number;
  azimuthRadians: number;
  center2: Point2;
  centerHeight: number;
}

const EARTH_RADIUS_METERS = 6_371_000;
const DEG_TO_RAD = Math.PI / 180;
const METRE_EPSILON = 1e-9;

function finite(value: number, label: string, minimum = -Infinity, maximum = Infinity): void {
  if (!Number.isFinite(value) || value < minimum || value > maximum) throw new RangeError(`Invalid ${label}.`);
}

function validate(roof: NormalizedRoofV1, assumptions: RoofLayoutAssumptions): void {
  if (roof.schemaVersion !== 1 || !["GOOGLE_SOLAR", "MANUAL"].includes(roof.source) ||
    !Array.isArray(roof.segments) || roof.segments.length !== roof.segmentCount || roof.segments.length === 0 ||
    assumptions.schemaVersion !== 1) throw new RangeError("Unsupported roof or layout assumptions.");
  finite(roof.roofAreaSquareMeters, "roof area", METRE_EPSILON);
  for (const segment of roof.segments) {
    finite(segment.areaSquareMeters, "segment area", METRE_EPSILON);
    if (segment.pitchDegrees !== undefined) finite(segment.pitchDegrees, "roof pitch", 0, 90);
    if (segment.azimuthDegrees !== undefined) finite(segment.azimuthDegrees, "roof azimuth", 0, 360);
  }
  finite(assumptions.panelWidthMeters, "panel width", METRE_EPSILON);
  finite(assumptions.panelHeightMeters, "panel height", METRE_EPSILON);
  finite(assumptions.panelCapacityWatts, "panel capacity", METRE_EPSILON);
  finite(assumptions.edgeSetbackMeters, "edge setback", 0);
  finite(assumptions.panelGapMeters, "panel gap", 0);
  finite(assumptions.servicePathWidthMeters, "service path width", 0);
  finite(assumptions.mountingOffsetMeters, "mounting offset", 0);
  finite(assumptions.manualAreaToleranceFraction, "manual area tolerance", 0, 1);
  finite(assumptions.maxModeledPitchDegrees, "maximum modeled pitch", 0, 89);
  if (!Number.isSafeInteger(assumptions.maxPanels) || assumptions.maxPanels < 1 || assumptions.maxPanels > 10_000) {
    throw new RangeError("Invalid maximum panel count.");
  }
}

function validPoint(point: RoofPoint | undefined): point is RoofPoint {
  return !!point && Number.isFinite(point.latitude) && Math.abs(point.latitude) <= 90 &&
    Number.isFinite(point.longitude) && Math.abs(point.longitude) <= 180;
}

function midpoint(segment: RoofSegmentV1): RoofPoint | undefined {
  if (!segment.bounds || !validPoint(segment.bounds.southwest) || !validPoint(segment.bounds.northeast)) return undefined;
  const { southwest, northeast } = segment.bounds;
  if (southwest.latitude >= northeast.latitude || southwest.longitude >= northeast.longitude) return undefined;
  return { latitude: (southwest.latitude + northeast.latitude) / 2, longitude: (southwest.longitude + northeast.longitude) / 2 };
}

function project(point: RoofPoint, origin: RoofPoint): Point2 {
  let longitudeDelta = point.longitude - origin.longitude;
  if (longitudeDelta > 180) longitudeDelta -= 360;
  if (longitudeDelta < -180) longitudeDelta += 360;
  return {
    x: EARTH_RADIUS_METERS * Math.cos(origin.latitude * DEG_TO_RAD) * longitudeDelta * DEG_TO_RAD,
    z: EARTH_RADIUS_METERS * (point.latitude - origin.latitude) * DEG_TO_RAD,
  };
}

function centerOf(rectangle: Rectangle): Point2 {
  return { x: (rectangle.minX + rectangle.maxX) / 2, z: (rectangle.minZ + rectangle.maxZ) / 2 };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function roofY(segment: WorkingSegment, point: Point2): number {
  const { center2, pitchRadians, azimuthRadians, centerHeight } = segment;
  return centerHeight - Math.tan(pitchRadians) *
    ((point.x - center2.x) * Math.sin(azimuthRadians) + (point.z - center2.z) * Math.cos(azimuthRadians));
}

function point3(segment: WorkingSegment, point: Point2, offset = 0): RoofLayoutPoint {
  return { x: point.x, y: roofY(segment, point) + offset, z: point.z };
}

function rectangleCorners(segment: WorkingSegment, rectangle: Rectangle): RoofLayoutCorners {
  return [
    point3(segment, { x: rectangle.minX, z: rectangle.minZ }),
    point3(segment, { x: rectangle.maxX, z: rectangle.minZ }),
    point3(segment, { x: rectangle.maxX, z: rectangle.maxZ }),
    point3(segment, { x: rectangle.minX, z: rectangle.maxZ }),
  ];
}

function makeSegment(source: RoofSegmentV1, rectangle: Rectangle, kind: RoofGeometryKind, centerHeight = 0): WorkingSegment {
  const pitchRadians = (source.pitchDegrees ?? 0) * DEG_TO_RAD;
  const azimuthRadians = (source.azimuthDegrees ?? 0) * DEG_TO_RAD;
  const center2 = centerOf(rectangle);
  const segment = {
    rectangle, pitchRadians, azimuthRadians, center2, centerHeight,
    result: { segmentId: source.segmentId, geometryKind: kind, areaSquareMeters: source.areaSquareMeters,
      pitchDegrees: source.pitchDegrees ?? 0, azimuthDegrees: source.azimuthDegrees ?? 0,
      center: { x: center2.x, y: centerHeight, z: center2.z }, corners: [] as unknown as RoofLayoutCorners },
  };
  segment.result.corners = rectangleCorners(segment, rectangle);
  return segment;
}

function googleSegment(source: RoofSegmentV1, origin: RoofPoint, maxModeledPitchDegrees: number): WorkingSegment | undefined {
  const middle = midpoint(source);
  if (!middle || !source.bounds || (source.pitchDegrees ?? 0) > maxModeledPitchDegrees) return undefined;
  const southwest = project(source.bounds.southwest, origin);
  const northeast = project(source.bounds.northeast, origin);
  const box: Rectangle = { minX: southwest.x, maxX: northeast.x, minZ: southwest.z, maxZ: northeast.z };
  const width = box.maxX - box.minX, depth = box.maxZ - box.minZ;
  if (width <= METRE_EPSILON || depth <= METRE_EPSILON) return undefined;
  const pitch = (source.pitchDegrees ?? 0) * DEG_TO_RAD;
  const targetGroundArea = source.groundAreaSquareMeters ?? source.areaSquareMeters * Math.cos(pitch);
  const scale = Math.min(1, Math.sqrt(targetGroundArea / (width * depth)));
  if (!Number.isFinite(scale) || scale <= 0) return undefined;
  const preferred = validPoint(source.center) ? project(source.center, origin) : project(middle, origin);
  const halfWidth = width * scale / 2, halfDepth = depth * scale / 2;
  const center = { x: clamp(preferred.x, box.minX + halfWidth, box.maxX - halfWidth),
    z: clamp(preferred.z, box.minZ + halfDepth, box.maxZ - halfDepth) };
  return makeSegment(source, {
    minX: center.x - halfWidth, maxX: center.x + halfWidth,
    minZ: center.z - halfDepth, maxZ: center.z + halfDepth,
  }, "GOOGLE_BOUNDS_APPROXIMATE", source.planeHeightAtCenterMeters ?? 0);
}

function manualSegment(roof: NormalizedRoofV1, assumptions: RoofLayoutAssumptions,
  warnings: Set<RoofLayoutWarning>): WorkingSegment | undefined {
  const source = roof.segments[0];
  if (!source || (source.pitchDegrees ?? 0) > assumptions.maxModeledPitchDegrees) return undefined;
  const dimensions = roof.manualDimensions;
  const hasDimensions = dimensions && Number.isFinite(dimensions.lengthMeters) && Number.isFinite(dimensions.widthMeters) &&
    (dimensions.lengthMeters ?? 0) > 0 && (dimensions.widthMeters ?? 0) > 0;
  const symbolicGroundSide = Math.sqrt(roof.roofAreaSquareMeters * Math.cos((source.pitchDegrees ?? 0) * DEG_TO_RAD));
  const width = hasDimensions ? dimensions.widthMeters! : symbolicGroundSide;
  const depth = hasDimensions ? dimensions.lengthMeters! : symbolicGroundSide;
  if (!hasDimensions) warnings.add("AREA_ONLY_MANUAL_ROOF");
  const surfaceAreaFromDimensions = width * depth / Math.cos((source.pitchDegrees ?? 0) * DEG_TO_RAD);
  if (hasDimensions && Math.abs(surfaceAreaFromDimensions - roof.roofAreaSquareMeters) /
    Math.max(surfaceAreaFromDimensions, roof.roofAreaSquareMeters) > assumptions.manualAreaToleranceFraction) {
    warnings.add("MANUAL_AREA_DIFFERS_FROM_DIMENSIONS");
  }
  return makeSegment(source, { minX: -width / 2, maxX: width / 2, minZ: -depth / 2, maxZ: depth / 2 },
    hasDimensions ? "MANUAL_RECTANGLE" : "AREA_ONLY_ILLUSTRATION");
}

function inset(rectangle: Rectangle, amount: number): Rectangle | undefined {
  const result = { minX: rectangle.minX + amount, maxX: rectangle.maxX - amount,
    minZ: rectangle.minZ + amount, maxZ: rectangle.maxZ - amount };
  return result.maxX - result.minX > METRE_EPSILON && result.maxZ - result.minZ > METRE_EPSILON ? result : undefined;
}

function serviceBands(rectangle: Rectangle, width: number): Rectangle[] {
  if (width === 0) return [rectangle];
  const bands: Rectangle[] = [];
  if (rectangle.maxX - rectangle.minX >= rectangle.maxZ - rectangle.minZ) {
    const middle = (rectangle.minZ + rectangle.maxZ) / 2;
    if (middle - width / 2 > rectangle.minZ) bands.push({ ...rectangle, maxZ: middle - width / 2 });
    if (middle + width / 2 < rectangle.maxZ) bands.push({ ...rectangle, minZ: middle + width / 2 });
  } else {
    const middle = (rectangle.minX + rectangle.maxX) / 2;
    if (middle - width / 2 > rectangle.minX) bands.push({ ...rectangle, maxX: middle - width / 2 });
    if (middle + width / 2 < rectangle.maxX) bands.push({ ...rectangle, minX: middle + width / 2 });
  }
  return bands;
}

function insideBands(points: Point2[], bands: Rectangle[]): boolean {
  return bands.some(band => points.every(point => point.x >= band.minX - METRE_EPSILON &&
    point.x <= band.maxX + METRE_EPSILON && point.z >= band.minZ - METRE_EPSILON && point.z <= band.maxZ + METRE_EPSILON));
}

function separatedByGap(first: Point2[], second: Point2[], gap: number): boolean {
  for (const polygon of [first, second]) {
    for (let index = 0; index < polygon.length; index++) {
      const a = polygon[index], b = polygon[(index + 1) % polygon.length];
      const dx = b.x - a.x, dz = b.z - a.z;
      const length = Math.hypot(dx, dz);
      if (length <= METRE_EPSILON) continue;
      const axisX = -dz / length, axisZ = dx / length;
      const aValues = first.map(point => point.x * axisX + point.z * axisZ);
      const bValues = second.map(point => point.x * axisX + point.z * axisZ);
      if (Math.max(...aValues) + gap <= Math.min(...bValues) + METRE_EPSILON ||
        Math.max(...bValues) + gap <= Math.min(...aValues) + METRE_EPSILON) return true;
    }
  }
  return false;
}

function panelFor(segment: WorkingSegment, center: Point2, orientation: RoofLayoutPanel["orientation"],
  assumptions: RoofLayoutAssumptions, panelId: string, yearlyEnergyDcKwh?: number): RoofLayoutPanel {
  const lateralWidth = orientation === "PORTRAIT" ? assumptions.panelWidthMeters : assumptions.panelHeightMeters;
  const slopeLength = orientation === "PORTRAIT" ? assumptions.panelHeightMeters : assumptions.panelWidthMeters;
  const lateral = { x: Math.cos(segment.azimuthRadians), z: -Math.sin(segment.azimuthRadians) };
  const downhill = { x: Math.sin(segment.azimuthRadians), z: Math.cos(segment.azimuthRadians) };
  const slopeFootprint = slopeLength * Math.cos(segment.pitchRadians);
  const corners2: Point2[] = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => ({
    x: center.x + u * lateralWidth / 2 * lateral.x + v * slopeFootprint / 2 * downhill.x,
    z: center.z + u * lateralWidth / 2 * lateral.z + v * slopeFootprint / 2 * downhill.z,
  }));
  return { panelId, segmentId: segment.result.segmentId, orientation,
    center: point3(segment, center, assumptions.mountingOffsetMeters),
    corners: corners2.map(point => point3(segment, point, assumptions.mountingOffsetMeters)) as RoofLayoutCorners,
    ...(yearlyEnergyDcKwh !== undefined ? { yearlyEnergyDcKwh } : {}),
  };
}

function footprint(panel: RoofLayoutPanel): Point2[] {
  return panel.corners.map(({ x, z }) => ({ x, z }));
}

function manualPanels(segment: WorkingSegment, assumptions: RoofLayoutAssumptions):
  { panels: RoofLayoutPanel[]; truncated: boolean } {
  const usable = inset(segment.rectangle, assumptions.edgeSetbackMeters);
  if (!usable) return { panels: [], truncated: false };
  const bands = serviceBands(usable, assumptions.servicePathWidthMeters);
  const generate = (orientation: RoofLayoutPanel["orientation"]): { panels: RoofLayoutPanel[]; potentialCount: number } => {
    const width = orientation === "PORTRAIT" ? assumptions.panelWidthMeters : assumptions.panelHeightMeters;
    const depth = orientation === "PORTRAIT" ? assumptions.panelHeightMeters : assumptions.panelWidthMeters;
    const panels: RoofLayoutPanel[] = [];
    let potentialCount = 0;
    for (const band of bands) {
      const columns = Math.max(0, Math.floor((band.maxX - band.minX + assumptions.panelGapMeters + METRE_EPSILON) /
        (width + assumptions.panelGapMeters)));
      const rows = Math.max(0, Math.floor((band.maxZ - band.minZ + assumptions.panelGapMeters + METRE_EPSILON) /
        (depth + assumptions.panelGapMeters)));
      potentialCount += rows * columns;
      for (let row = 0; row < rows && panels.length < assumptions.maxPanels; row++) {
        for (let column = 0; column < columns && panels.length < assumptions.maxPanels; column++) {
          const center = { x: band.minX + width / 2 + column * (width + assumptions.panelGapMeters),
            z: band.minZ + depth / 2 + row * (depth + assumptions.panelGapMeters) };
          // Manual dimensions are a conservative axis-aligned fit; the panel face follows the reported pitch.
          const corners2: Point2[] = [
            { x: center.x - width / 2, z: center.z - depth / 2 }, { x: center.x + width / 2, z: center.z - depth / 2 },
            { x: center.x + width / 2, z: center.z + depth / 2 }, { x: center.x - width / 2, z: center.z + depth / 2 },
          ];
          panels.push({ panelId: `manual-${panels.length + 1}`, segmentId: segment.result.segmentId, orientation,
            center: point3(segment, center, assumptions.mountingOffsetMeters),
            corners: corners2.map(point => point3(segment, point, assumptions.mountingOffsetMeters)) as RoofLayoutCorners });
        }
      }
    }
    return { panels, potentialCount };
  };
  const portrait = generate("PORTRAIT"), landscape = generate("LANDSCAPE");
  const selected = landscape.potentialCount > portrait.potentialCount ? landscape : portrait;
  return { panels: selected.panels, truncated: selected.potentialCount > assumptions.maxPanels };
}

function googlePanels(roof: NormalizedRoofV1, segments: Map<number, WorkingSegment>, origin: RoofPoint,
  assumptions: RoofLayoutAssumptions, warnings: Set<RoofLayoutWarning>): { panels: RoofLayoutPanel[]; evaluable: boolean } {
  if (!roof.panelSuggestions) { warnings.add("PANEL_SUGGESTIONS_MISSING"); return { panels: [], evaluable: false }; }
  if (roof.panelWidthMeters !== undefined && roof.panelHeightMeters !== undefined &&
    (Math.abs(roof.panelWidthMeters - assumptions.panelWidthMeters) > METRE_EPSILON ||
      Math.abs(roof.panelHeightMeters - assumptions.panelHeightMeters) > METRE_EPSILON)) {
    warnings.add("PANEL_DIMENSIONS_DIFFER_FROM_GOOGLE_MODEL");
  }
  const sameGooglePanelSpec = roof.panelWidthMeters !== undefined && roof.panelHeightMeters !== undefined &&
    roof.panelCapacityWatts !== undefined &&
    Math.abs(roof.panelWidthMeters - assumptions.panelWidthMeters) <= METRE_EPSILON &&
    Math.abs(roof.panelHeightMeters - assumptions.panelHeightMeters) <= METRE_EPSILON &&
    Math.abs(roof.panelCapacityWatts - assumptions.panelCapacityWatts) <= METRE_EPSILON;
  if (!sameGooglePanelSpec) warnings.add("PANEL_SPECS_DIFFER_FROM_GOOGLE_MODEL");
  const panels: RoofLayoutPanel[] = [];
  let evaluable = false;
  let filtered = false;
  for (let index = 0; index < roof.panelSuggestions.length; index++) {
    const suggestion = roof.panelSuggestions[index];
    const segment = segments.get(suggestion.segmentIndex);
    if (!segment || !validPoint(suggestion.center)) { filtered = true; continue; }
    evaluable = true;
    const usable = inset(segment.rectangle, assumptions.edgeSetbackMeters);
    const bands = usable ? serviceBands(usable, assumptions.servicePathWidthMeters) : [];
    const panel = panelFor(segment, project(suggestion.center, origin), suggestion.orientation,
      assumptions, `google-${index + 1}`, sameGooglePanelSpec ? suggestion.yearlyEnergyDcKwh : undefined);
    const polygon = footprint(panel);
    if (!insideBands(polygon, bands) || panels.some(existing => existing.segmentId === panel.segmentId &&
      !separatedByGap(footprint(existing), polygon, assumptions.panelGapMeters))) {
      filtered = true;
      continue;
    }
    if (panels.length === assumptions.maxPanels) { warnings.add("PANEL_LIMIT_REACHED"); break; }
    panels.push(panel);
  }
  if (filtered) warnings.add("PANELS_FILTERED_FOR_CLEARANCE");
  return { panels, evaluable };
}

function layoutBounds(segments: RoofLayoutSegment[], panels: RoofLayoutPanel[]): RoofLayoutBounds | null {
  const points = [...segments.flatMap(segment => segment.corners), ...panels.flatMap(panel => panel.corners)];
  if (!points.length) return null;
  return { min: { x: Math.min(...points.map(point => point.x)), y: Math.min(...points.map(point => point.y)),
    z: Math.min(...points.map(point => point.z)) },
  max: { x: Math.max(...points.map(point => point.x)), y: Math.max(...points.map(point => point.y)),
    z: Math.max(...points.map(point => point.z)) } };
}

/**
 * Produces a visual, deterministic fit model. Google bounds are rectangular approximations,
 * so their displayed edge clearance is never an engineering or installation approval.
 */
export function planRoofLayout(roof: NormalizedRoofV1, assumptions: RoofLayoutAssumptions): RoofLayout {
  validate(roof, assumptions);
  const warnings = new Set<RoofLayoutWarning>();
  const segmentModels = new Map<number, WorkingSegment>();
  let panels: RoofLayoutPanel[] = [];
  let fitStatus: RoofFitStatus = "UNDETERMINED";
  let panelCount: number | null = null;
  if (roof.source === "GOOGLE_SOLAR") {
    warnings.add("GOOGLE_BOUNDS_ARE_APPROXIMATE");
    const origin = [roof.center, ...roof.segments.map(segment => segment.center), ...roof.segments.map(midpoint)]
      .find(validPoint);
    if (origin) {
      roof.segments.forEach((segment, index) => {
        if (segment.pitchDegrees === undefined) warnings.add("PITCH_ASSUMED_FLAT");
        const model = googleSegment(segment, origin, assumptions.maxModeledPitchDegrees);
        if (model) segmentModels.set(index, model);
        else warnings.add((segment.pitchDegrees ?? 0) > assumptions.maxModeledPitchDegrees ?
          "NEAR_VERTICAL_SEGMENT" : "SEGMENT_BOUNDS_MISSING");
      });
      const selected = googlePanels(roof, segmentModels, origin, assumptions, warnings);
      panels = selected.panels;
      if (selected.evaluable || (roof.panelSuggestions?.length === 0 && segmentModels.size > 0)) {
        fitStatus = "MODELED_APPROXIMATE";
        panelCount = panels.length;
      }
    } else {
      warnings.add("NO_USABLE_GEOMETRY");
    }
  } else {
    if (roof.segments[0]?.pitchDegrees === undefined) warnings.add("PITCH_ASSUMED_FLAT");
    const manual = manualSegment(roof, assumptions, warnings);
    if (manual) {
      segmentModels.set(0, manual);
      if (manual.result.geometryKind === "MANUAL_RECTANGLE") {
        const selected = manualPanels(manual, assumptions);
        panels = selected.panels;
        fitStatus = "SPACE_FEASIBLE";
        panelCount = panels.length;
        if (selected.truncated) warnings.add("PANEL_LIMIT_REACHED");
      }
    } else warnings.add((roof.segments[0]?.pitchDegrees ?? 0) > assumptions.maxModeledPitchDegrees ?
      "NEAR_VERTICAL_SEGMENT" : "NO_USABLE_GEOMETRY");
  }
  const segments = Array.from(segmentModels.values(), model => model.result);
  if (!segments.length) warnings.add("NO_USABLE_GEOMETRY");
  return {
    schemaVersion: 1, coordinateSystem: "LOCAL_EAST_UP_NORTH_METERS", source: roof.source,
    fitStatus, bounds: layoutBounds(segments, panels), segments, panels, panelCount,
    dcCapacityKw: panelCount === null ? null : panelCount * assumptions.panelCapacityWatts / 1_000,
    clearances: { edgeSetbackMeters: assumptions.edgeSetbackMeters, panelGapMeters: assumptions.panelGapMeters,
      servicePathWidthMeters: assumptions.servicePathWidthMeters },
    warnings: Array.from(warnings),
  };
}
