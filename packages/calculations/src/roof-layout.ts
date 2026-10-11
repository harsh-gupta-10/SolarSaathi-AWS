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
  | "PANELS_REGULAR_GRID"
  | "PANELS_CLIPPED_TO_OUTLINE"
  | "OUTLINE_OVERRIDE_UNUSABLE"
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
  /**
   * Counter-clockwise from above, starting at the corner nearest southwest. The rectangle is rotated to the
   * segment azimuth (folded into ±45°), so with azimuth 0/90/180/270 the order is southwest, southeast,
   * northeast, northwest.
   */
  corners: RoofLayoutCorners;
}

/** A ground-plan point in the same local east/north metres as the layout. */
export interface RoofLayoutPlanPoint { x: number; z: number }

export interface RoofLayoutPanel {
  panelId: string;
  segmentId: string;
  orientation: "LANDSCAPE" | "PORTRAIT";
  center: RoofLayoutPoint;
  corners: RoofLayoutCorners;
  yearlyEnergyDcKwh?: number;
}

/** Optional user-adjusted building outline. It changes the drawn footprint and where panels may sit, nothing else. */
export interface RoofLayoutOptions {
  /** At least three latitude/longitude corners; only used for Google roofs, which are georeferenced. */
  footprintOverride?: readonly RoofPoint[];
  /**
   * How Google roofs receive panels. `PROVIDER_SUGGESTIONS` (default, used for sizing) keeps Google's own panel
   * positions that survive the setbacks, so capacity never exceeds what Google judged viable. `REGULAR_GRID`
   * (used for the 3D view) fills each roof plane that has suggestions with an aligned grid of whole panels.
   */
  panelFill?: "PROVIDER_SUGGESTIONS" | "REGULAR_GRID";
}

export interface RoofLayout {
  schemaVersion: 1;
  coordinateSystem: "LOCAL_EAST_UP_NORTH_METERS";
  source: NormalizedRoofV1["source"];
  fitStatus: RoofFitStatus;
  bounds: RoofLayoutBounds | null;
  /**
   * One approximate building outline: the convex hull of the modeled segment rectangles, counter-clockwise from
   * above. It is shared by the 3D walls and the satellite-map overlay; it is not a surveyed footprint.
   */
  footprint: RoofLayoutPlanPoint[];
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
/** A rotated plan frame: local x runs along `axisU`, local z along `axisV`, both unit vectors. */
interface Frame { origin: Point2; axisU: Point2; axisV: Point2 }
interface WorkingSegment {
  result: RoofLayoutSegment;
  /** Segment rectangle in its own frame's local coordinates. */
  rectangle: Rectangle;
  frame: Frame;
  pitchRadians: number;
  azimuthRadians: number;
  center2: Point2;
  centerHeight: number;
}

const EARTH_RADIUS_METERS = 6_371_000;
const DEG_TO_RAD = Math.PI / 180;
const METRE_EPSILON = 1e-9;
/** An outline smaller than this is treated as collapsed (for example, all corners dragged onto one line). */
/** An outline smaller than this has collapsed onto a line and is not usable. Shared with roof-outline.ts. */
export const MIN_OUTLINE_AREA_SQUARE_METERS = 4;

/** Area of a simple polygon, m² (shoelace). */
export function polygonArea(points: readonly RoofLayoutPlanPoint[]): number {
  let twice = 0;
  for (let index = 0; index < points.length; index++) {
    const a = points[index], b = points[(index + 1) % points.length];
    twice += a.x * b.z - b.x * a.z;
  }
  return Math.abs(twice) / 2;
}

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

function unproject(point: Point2, origin: RoofPoint): RoofPoint {
  return {
    latitude: origin.latitude + point.z / EARTH_RADIUS_METERS / DEG_TO_RAD,
    longitude: origin.longitude + point.x / (EARTH_RADIUS_METERS * Math.cos(origin.latitude * DEG_TO_RAD)) / DEG_TO_RAD,
  };
}

function centerOf(rectangle: Rectangle): Point2 {
  return { x: (rectangle.minX + rectangle.maxX) / 2, z: (rectangle.minZ + rectangle.maxZ) / 2 };
}

const IDENTITY_FRAME: Frame = { origin: { x: 0, z: 0 }, axisU: { x: 1, z: 0 }, axisV: { x: 0, z: 1 } };

function toWorld(frame: Frame, local: Point2): Point2 {
  return { x: frame.origin.x + local.x * frame.axisU.x + local.z * frame.axisV.x,
    z: frame.origin.z + local.x * frame.axisU.z + local.z * frame.axisV.z };
}

function toLocal(frame: Frame, world: Point2): Point2 {
  const dx = world.x - frame.origin.x, dz = world.z - frame.origin.z;
  return { x: dx * frame.axisU.x + dz * frame.axisU.z, z: dx * frame.axisV.x + dz * frame.axisV.z };
}

/**
 * Folds an azimuth into the plan rotation nearest to north-aligned, in [-45°, 45°). A roof plane's downhill
 * direction is perpendicular or parallel to its edges, so this rotation squares the rectangle with the plane.
 */
export function segmentPlanRotationDegrees(azimuthDegrees: number): number {
  return ((azimuthDegrees % 90) + 90 + 45) % 90 - 45;
}

function rotatedFrame(origin: Point2, rotationDegrees: number): Frame {
  const angle = rotationDegrees * DEG_TO_RAD;
  // axisV has compass bearing `rotationDegrees`; axisU is 90° clockwise from it.
  return { origin, axisU: { x: Math.cos(angle), z: -Math.sin(angle) }, axisV: { x: Math.sin(angle), z: Math.cos(angle) } };
}

/**
 * Side lengths of a rectangle rotated by `rotationDegrees` that fits the axis-aligned box `width` × `depth`
 * (east × north) and does not exceed `groundArea`. For an exact rotated rectangle the box is reproduced; for an
 * irregular plane, both sides are scaled uniformly down to the reported ground area.
 */
export function fitRotatedRectangle(width: number, depth: number, groundArea: number, rotationDegrees: number):
  { along: number; across: number } {
  const angle = rotationDegrees * DEG_TO_RAD;
  const c = Math.abs(Math.cos(angle)), s = Math.abs(Math.sin(angle));
  let along: number, across: number;
  if (s <= METRE_EPSILON) { along = width; across = depth; } else {
    // width = along·c + across·s and depth = along·s + across·c.
    const sum = (width + depth) / (c + s);
    const difference = c - s > 1e-3 ? (width - depth) / (c - s) : 0;
    along = (sum + difference) / 2; across = (sum - difference) / 2;
    if (along <= METRE_EPSILON || across <= METRE_EPSILON) { along = sum / 2; across = sum / 2; }
  }
  const area = along * across;
  const areaScale = groundArea > 0 && area > groundArea ? Math.sqrt(groundArea / area) : 1;
  along *= areaScale; across *= areaScale;
  const fitScale = Math.min(1, width / (along * c + across * s), depth / (along * s + across * c));
  return { along: along * fitScale, across: across * fitScale };
}

/** Convex hull (Andrew's monotone chain), counter-clockwise when viewed from above (x east, z north). */
export function convexHull(points: readonly RoofLayoutPlanPoint[]): RoofLayoutPlanPoint[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.z - b.z);
  if (sorted.length < 3) return sorted;
  const cross = (o: Point2, a: Point2, b: Point2) => (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);
  const lower: Point2[] = [], upper: Point2[] = [];
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= METRE_EPSILON) lower.pop();
    lower.push(point);
  }
  for (const point of [...sorted].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= METRE_EPSILON) upper.pop();
    upper.push(point);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)].map(({ x, z }) => ({ x, z }));
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
  return ([
    { x: rectangle.minX, z: rectangle.minZ }, { x: rectangle.maxX, z: rectangle.minZ },
    { x: rectangle.maxX, z: rectangle.maxZ }, { x: rectangle.minX, z: rectangle.maxZ },
  ] as Point2[]).map(local => point3(segment, toWorld(segment.frame, local))) as RoofLayoutCorners;
}

function makeSegment(source: RoofSegmentV1, rectangle: Rectangle, kind: RoofGeometryKind, centerHeight = 0,
  frame: Frame = IDENTITY_FRAME): WorkingSegment {
  const pitchRadians = (source.pitchDegrees ?? 0) * DEG_TO_RAD;
  const azimuthRadians = (source.azimuthDegrees ?? 0) * DEG_TO_RAD;
  const center2 = toWorld(frame, centerOf(rectangle));
  const segment = {
    rectangle, frame, pitchRadians, azimuthRadians, center2, centerHeight,
    result: { segmentId: source.segmentId, geometryKind: kind, areaSquareMeters: source.areaSquareMeters,
      pitchDegrees: source.pitchDegrees ?? 0, azimuthDegrees: source.azimuthDegrees ?? 0,
      center: { x: center2.x, y: centerHeight, z: center2.z }, corners: [] as unknown as RoofLayoutCorners },
  };
  segment.result.corners = rectangleCorners(segment, rectangle);
  return segment;
}

/**
 * Google gives each roof plane an axis-aligned bounding box. The plane is modeled as a rectangle rotated to its
 * azimuth that fits inside that box with the reported ground area, so rotated houses are not drawn as
 * north-aligned boxes.
 */
function googleSegment(source: RoofSegmentV1, origin: RoofPoint, maxModeledPitchDegrees: number,
  centerHeight: number): WorkingSegment | undefined {
  const middle = midpoint(source);
  if (!middle || !source.bounds || (source.pitchDegrees ?? 0) > maxModeledPitchDegrees) return undefined;
  const southwest = project(source.bounds.southwest, origin);
  const northeast = project(source.bounds.northeast, origin);
  const box: Rectangle = { minX: southwest.x, maxX: northeast.x, minZ: southwest.z, maxZ: northeast.z };
  const width = box.maxX - box.minX, depth = box.maxZ - box.minZ;
  if (width <= METRE_EPSILON || depth <= METRE_EPSILON) return undefined;
  const pitch = (source.pitchDegrees ?? 0) * DEG_TO_RAD;
  const targetGroundArea = source.groundAreaSquareMeters ?? source.areaSquareMeters * Math.cos(pitch);
  if (!Number.isFinite(targetGroundArea) || targetGroundArea <= 0) return undefined;
  const rotation = segmentPlanRotationDegrees(source.azimuthDegrees ?? 0);
  const { along, across } = fitRotatedRectangle(width, depth, targetGroundArea, rotation);
  if (!(along > METRE_EPSILON && across > METRE_EPSILON)) return undefined;
  const angle = rotation * DEG_TO_RAD;
  const c = Math.abs(Math.cos(angle)), s = Math.abs(Math.sin(angle));
  const halfBoxX = (along * c + across * s) / 2, halfBoxZ = (along * s + across * c) / 2;
  const preferred = validPoint(source.center) ? project(source.center, origin) : project(middle, origin);
  const center = { x: clamp(preferred.x, box.minX + halfBoxX, box.maxX - halfBoxX),
    z: clamp(preferred.z, box.minZ + halfBoxZ, box.maxZ - halfBoxZ) };
  return makeSegment(source, { minX: -along / 2, maxX: along / 2, minZ: -across / 2, maxZ: across / 2 },
    "GOOGLE_BOUNDS_APPROXIMATE", centerHeight, rotatedFrame(center, rotation));
}

/**
 * Google plane heights are metres above sea level. Heights are made relative to the lowest modeled plane so the
 * model sits near y = 0; if any modeled plane lacks a height, all planes are modeled at the same relative height.
 */
function relativePlaneHeights(segments: readonly RoofSegmentV1[], maxModeledPitchDegrees: number): number[] {
  // Only planes that can be modeled set the baseline: a dropped near-vertical or bounds-less plane must not lift the rest.
  const modeled = segments.filter(segment => segment.bounds && (segment.pitchDegrees ?? 0) <= maxModeledPitchDegrees);
  const heights = modeled.map(segment => segment.planeHeightAtCenterMeters);
  if (!heights.length || !heights.every((height): height is number => height !== undefined && Number.isFinite(height))) {
    return segments.map(() => 0);
  }
  const base = Math.min(...heights);
  return segments.map(segment => (segment.planeHeightAtCenterMeters ?? base) - base);
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
            center: point3(segment, toWorld(segment.frame, center), assumptions.mountingOffsetMeters),
            corners: corners2.map(point => point3(segment, toWorld(segment.frame, point), assumptions.mountingOffsetMeters)) as RoofLayoutCorners });
        }
      }
    }
    return { panels, potentialCount };
  };
  const portrait = generate("PORTRAIT"), landscape = generate("LANDSCAPE");
  const selected = landscape.potentialCount > portrait.potentialCount ? landscape : portrait;
  return { panels: selected.panels, truncated: selected.potentialCount > assumptions.maxPanels };
}

/** True when `point` lies inside the counter-clockwise convex `polygon`, at least `margin` metres from every edge. */
function insideConvex(polygon: readonly Point2[], point: Point2, margin: number): boolean {
  for (let index = 0; index < polygon.length; index++) {
    const a = polygon[index], b = polygon[(index + 1) % polygon.length];
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    if (length <= METRE_EPSILON) continue;
    if (((b.x - a.x) * (point.z - a.z) - (b.z - a.z) * (point.x - a.x)) / length < margin - METRE_EPSILON) return false;
  }
  return true;
}

/** Google's own suggested positions, kept where they respect the modeled setbacks, aisle and each other. */
function providerPanels(roof: NormalizedRoofV1, segments: Map<number, WorkingSegment>, origin: RoofPoint,
  assumptions: RoofLayoutAssumptions, warnings: Set<RoofLayoutWarning>, outline: readonly Point2[] | undefined):
  { panels: RoofLayoutPanel[]; evaluable: boolean } {
  const sameGooglePanelSpec = googleSpecChecks(roof, assumptions, warnings);
  if (sameGooglePanelSpec === undefined) return { panels: [], evaluable: false };
  const panels: RoofLayoutPanel[] = [];
  let evaluable = false, filtered = false, clipped = false;
  const suggestions = roof.panelSuggestions ?? [];
  for (let index = 0; index < suggestions.length; index++) {
    const suggestion = suggestions[index];
    const segment = segments.get(suggestion.segmentIndex);
    if (!segment || !validPoint(suggestion.center)) { filtered = true; continue; }
    evaluable = true;
    const usable = inset(segment.rectangle, assumptions.edgeSetbackMeters);
    const bands = usable ? serviceBands(usable, assumptions.servicePathWidthMeters) : [];
    const panel = panelFor(segment, project(suggestion.center, origin), suggestion.orientation,
      assumptions, `google-${index + 1}`, sameGooglePanelSpec ? suggestion.yearlyEnergyDcKwh : undefined);
    const polygon = footprint(panel);
    if (outline && !polygon.every(corner => insideConvex(outline, corner, assumptions.edgeSetbackMeters))) {
      clipped = true; continue;
    }
    if (!insideBands(polygon.map(point => toLocal(segment.frame, point)), bands) ||
      panels.some(existing => existing.segmentId === panel.segmentId &&
        !separatedByGap(footprint(existing), polygon, assumptions.panelGapMeters))) {
      filtered = true;
      continue;
    }
    if (panels.length === assumptions.maxPanels) { warnings.add("PANEL_LIMIT_REACHED"); break; }
    panels.push(panel);
  }
  if (filtered) warnings.add("PANELS_FILTERED_FOR_CLEARANCE");
  if (clipped) warnings.add("PANELS_CLIPPED_TO_OUTLINE");
  return { panels, evaluable };
}

/**
 * Returns whether Google's panel spec equals the layout assumptions (true/false), or undefined when Google gave no
 * suggestions at all. Adds the spec warnings.
 */
function googleSpecChecks(roof: NormalizedRoofV1, assumptions: RoofLayoutAssumptions,
  warnings: Set<RoofLayoutWarning>): boolean | undefined {
  if (!roof.panelSuggestions) { warnings.add("PANEL_SUGGESTIONS_MISSING"); return undefined; }
  if (roof.panelWidthMeters !== undefined && roof.panelHeightMeters !== undefined &&
    (Math.abs(roof.panelWidthMeters - assumptions.panelWidthMeters) > METRE_EPSILON ||
      Math.abs(roof.panelHeightMeters - assumptions.panelHeightMeters) > METRE_EPSILON)) {
    warnings.add("PANEL_DIMENSIONS_DIFFER_FROM_GOOGLE_MODEL");
  }
  const same = roof.panelWidthMeters !== undefined && roof.panelHeightMeters !== undefined &&
    roof.panelCapacityWatts !== undefined &&
    Math.abs(roof.panelWidthMeters - assumptions.panelWidthMeters) <= METRE_EPSILON &&
    Math.abs(roof.panelHeightMeters - assumptions.panelHeightMeters) <= METRE_EPSILON &&
    Math.abs(roof.panelCapacityWatts - assumptions.panelCapacityWatts) <= METRE_EPSILON;
  if (!same) warnings.add("PANEL_SPECS_DIFFER_FROM_GOOGLE_MODEL");
  return same;
}

/** Whether the roof plane's downhill direction runs along the frame's local z axis (true) or its x axis (false). */
function downhillAlongLocalZ(segment: WorkingSegment): boolean {
  const downhill = { x: Math.sin(segment.azimuthRadians), z: Math.cos(segment.azimuthRadians) };
  return Math.abs(downhill.x * segment.frame.axisV.x + downhill.z * segment.frame.axisV.z) >= 0.5;
}

/**
 * A regular grid of whole panels filling the segment's usable area (edge setbacks and service path respected),
 * aligned to the roof plane. Panels are centred in each band so the leftover space is shared equally.
 */
function gridPanels(segment: WorkingSegment, assumptions: RoofLayoutAssumptions, idPrefix: string): RoofLayoutPanel[] {
  const usable = inset(segment.rectangle, assumptions.edgeSetbackMeters);
  if (!usable) return [];
  const bands = serviceBands(usable, assumptions.servicePathWidthMeters);
  const alongZ = downhillAlongLocalZ(segment);
  const generate = (orientation: RoofLayoutPanel["orientation"]) => {
    const lateral = orientation === "PORTRAIT" ? assumptions.panelWidthMeters : assumptions.panelHeightMeters;
    const slope = (orientation === "PORTRAIT" ? assumptions.panelHeightMeters : assumptions.panelWidthMeters) *
      Math.cos(segment.pitchRadians);
    const sizeU = alongZ ? lateral : slope, sizeZ = alongZ ? slope : lateral;
    const centers: Point2[] = [];
    for (const band of bands) {
      const columns = Math.max(0, Math.floor((band.maxX - band.minX + assumptions.panelGapMeters + METRE_EPSILON) /
        (sizeU + assumptions.panelGapMeters)));
      const rows = Math.max(0, Math.floor((band.maxZ - band.minZ + assumptions.panelGapMeters + METRE_EPSILON) /
        (sizeZ + assumptions.panelGapMeters)));
      const slackU = (band.maxX - band.minX) - (columns * sizeU + Math.max(0, columns - 1) * assumptions.panelGapMeters);
      const slackZ = (band.maxZ - band.minZ) - (rows * sizeZ + Math.max(0, rows - 1) * assumptions.panelGapMeters);
      for (let row = 0; row < rows; row++) {
        for (let column = 0; column < columns; column++) {
          centers.push(toWorld(segment.frame, {
            x: band.minX + slackU / 2 + sizeU / 2 + column * (sizeU + assumptions.panelGapMeters),
            z: band.minZ + slackZ / 2 + sizeZ / 2 + row * (sizeZ + assumptions.panelGapMeters),
          }));
        }
      }
    }
    return { orientation, centers };
  };
  const portrait = generate("PORTRAIT"), landscape = generate("LANDSCAPE");
  const chosen = landscape.centers.length > portrait.centers.length ? landscape : portrait;
  return chosen.centers.map((center, index) =>
    panelFor(segment, center, chosen.orientation, assumptions, `${idPrefix}-${index + 1}`));
}

/**
 * Google roof planes are filled with a regular grid of whole panels inside each plane's setbacks. Google's own
 * suggestions decide which planes receive panels (a plane with none is left empty) and supply per-panel yearly
 * energy where a suggestion falls on a grid position; they are not used as panel positions, because Google's
 * positions are scattered by shading and use a different panel size.
 */
function gridPanelsForRoof(roof: NormalizedRoofV1, segments: Map<number, WorkingSegment>, origin: RoofPoint,
  assumptions: RoofLayoutAssumptions, warnings: Set<RoofLayoutWarning>, outline: readonly Point2[] | undefined):
  { panels: RoofLayoutPanel[]; evaluable: boolean } {
  const sameGooglePanelSpec = googleSpecChecks(roof, assumptions, warnings);
  if (sameGooglePanelSpec === undefined) return { panels: [], evaluable: false };
  let evaluable = false, skipped = false, clipped = false;
  const suggestionsBySegment = new Map<number, { point: Point2; energy?: number }[]>();
  for (const suggestion of roof.panelSuggestions ?? []) {
    if (!segments.has(suggestion.segmentIndex) || !validPoint(suggestion.center)) { skipped = true; continue; }
    evaluable = true;
    const list = suggestionsBySegment.get(suggestion.segmentIndex) ?? [];
    list.push({ point: project(suggestion.center, origin), energy: sameGooglePanelSpec ? suggestion.yearlyEnergyDcKwh : undefined });
    suggestionsBySegment.set(suggestion.segmentIndex, list);
  }
  const withEnergy: RoofLayoutPanel[] = [], withoutEnergy: RoofLayoutPanel[] = [];
  let limitReached = false;
  for (const [index, segment] of segments) {
    const suggestions = suggestionsBySegment.get(index);
    if (!suggestions) continue;
    const candidates = gridPanels(segment, assumptions, `grid-${index + 1}`).filter(panel => {
      if (!outline) return true;
      const inside = footprint(panel).every(corner => insideConvex(outline, corner, assumptions.edgeSetbackMeters));
      if (!inside) clipped = true;
      return inside;
    });
    const matched = new Map<RoofLayoutPanel, number>();
    const reach = Math.hypot(assumptions.panelWidthMeters, assumptions.panelHeightMeters) / 2;
    for (const suggestion of [...suggestions].sort((a, b) => (b.energy ?? -1) - (a.energy ?? -1))) {
      if (suggestion.energy === undefined) continue;
      let best: RoofLayoutPanel | undefined, bestDistance = reach;
      for (const panel of candidates) {
        if (matched.has(panel)) continue;
        const distance = Math.hypot(panel.center.x - suggestion.point.x, panel.center.z - suggestion.point.z);
        if (distance <= bestDistance) { best = panel; bestDistance = distance; }
      }
      if (best) matched.set(best, suggestion.energy);
    }
    for (const panel of candidates) {
      const energy = matched.get(panel);
      if (energy !== undefined) withEnergy.push({ ...panel, yearlyEnergyDcKwh: energy });
      else withoutEnergy.push(panel);
    }
  }
  withEnergy.sort((a, b) => (b.yearlyEnergyDcKwh ?? 0) - (a.yearlyEnergyDcKwh ?? 0));
  let panels = [...withEnergy, ...withoutEnergy];
  if (panels.length > assumptions.maxPanels) { panels = panels.slice(0, assumptions.maxPanels); limitReached = true; }
  if (limitReached) warnings.add("PANEL_LIMIT_REACHED");
  if (skipped) warnings.add("PANELS_FILTERED_FOR_CLEARANCE");
  if (clipped) warnings.add("PANELS_CLIPPED_TO_OUTLINE");
  if (evaluable) warnings.add("PANELS_REGULAR_GRID");
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
function layoutOrigin(roof: NormalizedRoofV1): RoofPoint | undefined {
  return [roof.center, ...roof.segments.map(segment => segment.center), ...roof.segments.map(midpoint)].find(validPoint);
}

function googleSegmentModels(roof: NormalizedRoofV1, origin: RoofPoint, assumptions: RoofLayoutAssumptions,
  warnings: Set<RoofLayoutWarning>): Map<number, WorkingSegment> {
  const models = new Map<number, WorkingSegment>();
  const heights = relativePlaneHeights(roof.segments, assumptions.maxModeledPitchDegrees);
  roof.segments.forEach((segment, index) => {
    if (segment.pitchDegrees === undefined) warnings.add("PITCH_ASSUMED_FLAT");
    const model = googleSegment(segment, origin, assumptions.maxModeledPitchDegrees, heights[index]);
    if (model) models.set(index, model);
    else warnings.add((segment.pitchDegrees ?? 0) > assumptions.maxModeledPitchDegrees ?
      "NEAR_VERTICAL_SEGMENT" : "SEGMENT_BOUNDS_MISSING");
  });
  return models;
}

function footprintOf(segments: readonly RoofLayoutSegment[]): RoofLayoutPlanPoint[] {
  return convexHull(segments.flatMap(segment => segment.corners.map(({ x, z }) => ({ x, z }))));
}

/**
 * The approximate building outline from Google roof planes as latitude/longitude, counter-clockwise. It is the
 * same outline as `RoofLayout.footprint` and is meant for a map overlay labelled approximate. Returns null for
 * manual roofs or when no plane can be modeled.
 */
export function googleBuildingOutline(roof: NormalizedRoofV1, assumptions: RoofLayoutAssumptions): RoofPoint[] | null {
  validate(roof, assumptions);
  if (roof.source !== "GOOGLE_SOLAR") return null;
  const origin = layoutOrigin(roof);
  if (!origin) return null;
  const segments = Array.from(googleSegmentModels(roof, origin, assumptions, new Set()).values(), model => model.result);
  const outline = footprintOf(segments);
  return outline.length >= 3 ? outline.map(point => unproject(point, origin)) : null;
}

export function planRoofLayout(roof: NormalizedRoofV1, assumptions: RoofLayoutAssumptions,
  options: RoofLayoutOptions = {}): RoofLayout {
  validate(roof, assumptions);
  let outline: Point2[] | undefined;
  const warnings = new Set<RoofLayoutWarning>();
  let segmentModels = new Map<number, WorkingSegment>();
  let panels: RoofLayoutPanel[] = [];
  let fitStatus: RoofFitStatus = "UNDETERMINED";
  let panelCount: number | null = null;
  if (roof.source === "GOOGLE_SOLAR") {
    warnings.add("GOOGLE_BOUNDS_ARE_APPROXIMATE");
    const origin = layoutOrigin(roof);
    if (origin) {
      segmentModels = googleSegmentModels(roof, origin, assumptions, warnings);
      // A hand-traced outline only shapes the illustrative regular-grid view. The provider-suggestion path is the sizing
      // path and must never depend on an unverified drawing, so the override is ignored there.
      if (options.footprintOverride && options.panelFill === "REGULAR_GRID") {
        const corners = options.footprintOverride.filter(validPoint).map(point => project(point, origin));
        const hull = corners.length >= 3 ? convexHull(corners) : [];
        if (hull.length >= 3 && polygonArea(hull) >= MIN_OUTLINE_AREA_SQUARE_METERS) outline = hull;
        else warnings.add("OUTLINE_OVERRIDE_UNUSABLE");
      }
      const fill = options.panelFill === "REGULAR_GRID" ? gridPanelsForRoof : providerPanels;
      const selected = fill(roof, segmentModels, origin, assumptions, warnings, outline);
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
    fitStatus, bounds: layoutBounds(segments, panels), footprint: outline ?? footprintOf(segments), segments, panels, panelCount,
    dcCapacityKw: panelCount === null ? null : panelCount * assumptions.panelCapacityWatts / 1_000,
    clearances: { edgeSetbackMeters: assumptions.edgeSetbackMeters, panelGapMeters: assumptions.panelGapMeters,
      servicePathWidthMeters: assumptions.servicePathWidthMeters },
    warnings: Array.from(warnings),
  };
}
