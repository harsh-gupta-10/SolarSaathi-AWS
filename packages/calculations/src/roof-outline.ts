import type { NormalizedRoofV1, RoofPoint } from "@solarsaathi/types";
import { convexHull, MIN_OUTLINE_AREA_SQUARE_METERS, polygonArea } from "./roof-layout";

/**
 * A user-adjustable building outline: four corners, counter-clockwise from the southwest when automatic. It is an
 * approximate sketch drawn on satellite imagery for the 3D view. It is not a survey and never feeds sizing.
 */
export type RoofOutline = [RoofPoint, RoofPoint, RoofPoint, RoofPoint];

const EARTH_RADIUS_METERS = 6_371_000;
const DEG_TO_RAD = Math.PI / 180;
const COORDINATE_DECIMALS = 6;
/** A corner may not be moved further than this from the roof centre; guards against stray taps and bad data. */
export const MAX_OUTLINE_RADIUS_METERS = 200;

const valid = (point: RoofPoint | undefined): point is RoofPoint => !!point && Number.isFinite(point.latitude) &&
  Math.abs(point.latitude) <= 90 && Number.isFinite(point.longitude) && Math.abs(point.longitude) <= 180;

function toPlan(point: RoofPoint, origin: RoofPoint) {
  return { x: EARTH_RADIUS_METERS * Math.cos(origin.latitude * DEG_TO_RAD) * (point.longitude - origin.longitude) * DEG_TO_RAD,
    z: EARTH_RADIUS_METERS * (point.latitude - origin.latitude) * DEG_TO_RAD };
}
function fromPlan(point: { x: number; z: number }, origin: RoofPoint): RoofPoint {
  return { latitude: origin.latitude + point.z / EARTH_RADIUS_METERS / DEG_TO_RAD,
    longitude: origin.longitude + point.x / (EARTH_RADIUS_METERS * Math.cos(origin.latitude * DEG_TO_RAD)) / DEG_TO_RAD };
}

/**
 * The starting outline: Google's whole-building bounding box (south-west, south-east, north-east, north-west).
 * It always contains the building, so the user only has to pull corners in. Falls back to the union of the
 * roof-segment boxes when the building box is missing.
 */
export function autoBuildingOutline(roof: NormalizedRoofV1): RoofOutline | undefined {
  const boxes = roof.bounds ? [roof.bounds] : roof.segments.flatMap(segment => segment.bounds ? [segment.bounds] : []);
  const points = boxes.flatMap(box => [box.southwest, box.northeast]).filter(valid);
  if (points.length < 2) return undefined;
  const south = Math.min(...points.map(point => point.latitude)), north = Math.max(...points.map(point => point.latitude));
  const west = Math.min(...points.map(point => point.longitude)), east = Math.max(...points.map(point => point.longitude));
  if (!(north > south && east > west)) return undefined;
  return [{ latitude: south, longitude: west }, { latitude: south, longitude: east },
    { latitude: north, longitude: east }, { latitude: north, longitude: west }] as RoofOutline;
}

/** `lat,lng;lat,lng;lat,lng;lat,lng` at 6 decimals (about 11 cm): roughly 85 characters, well under a draft value limit. */
export function encodeRoofOutline(outline: readonly RoofPoint[]): string {
  return outline.map(point => `${point.latitude.toFixed(COORDINATE_DECIMALS)},${point.longitude.toFixed(COORDINATE_DECIMALS)}`).join(";");
}

/** Strict inverse of `encodeRoofOutline`; any malformed, out-of-range or collapsed value gives undefined. */
export function decodeRoofOutline(text: string | undefined): RoofOutline | undefined {
  if (!text || text.length > 200) return undefined;
  const parts = text.split(";");
  if (parts.length !== 4) return undefined;
  const points: RoofPoint[] = [];
  for (const part of parts) {
    const match = /^(-?\d{1,2}(?:\.\d{1,6})?),(-?\d{1,3}(?:\.\d{1,6})?)$/.exec(part);
    if (!match) return undefined;
    const point = { latitude: Number(match[1]), longitude: Number(match[2]) };
    if (!valid(point)) return undefined;
    points.push(point);
  }
  const outline = points as RoofOutline;
  return outlineAreaSquareMeters(outline) >= MIN_OUTLINE_AREA_SQUARE_METERS ? outline : undefined;
}

/** The outline's convex hull, counter-clockwise: what the map draws and the 3D view uses, so a crossed quad still works. */
export function outlineHull(outline: readonly RoofPoint[]): RoofPoint[] {
  const points = outline.filter(valid);
  if (points.length < 3) return [];
  const origin = points[0];
  return convexHull(points.map(point => toPlan(point, origin))).map(point => fromPlan(point, origin));
}

export function outlineAreaSquareMeters(outline: readonly RoofPoint[]): number {
  const points = outline.filter(valid);
  if (points.length < 3) return 0;
  const origin = points[0];
  return polygonArea(convexHull(points.map(point => toPlan(point, origin))));
}

/** Moves one corner to a dragged position. Returns the original outline when the move is invalid. */
export function moveOutlineCorner(outline: RoofOutline, index: number, to: RoofPoint, anchor?: RoofPoint): RoofOutline {
  if (!Number.isInteger(index) || index < 0 || index >= outline.length || !valid(to)) return outline;
  // Distance is measured from a fixed anchor (the roof centre, i.e. the automatic outline's centre) so repeated drags
  // cannot walk the outline away. Without an anchor it falls back to the centre of the other three corners.
  const others = outline.filter((_, position) => position !== index);
  const centre = valid(anchor) ? anchor : { latitude: others.reduce((sum, point) => sum + point.latitude, 0) / 3,
    longitude: others.reduce((sum, point) => sum + point.longitude, 0) / 3 };
  const away = toPlan(to, centre);
  if (Math.hypot(away.x, away.z) > MAX_OUTLINE_RADIUS_METERS) return outline;
  const next = outline.map((point, position) => position === index ? { latitude: to.latitude, longitude: to.longitude } : point) as RoofOutline;
  return outlineAreaSquareMeters(next) >= MIN_OUTLINE_AREA_SQUARE_METERS ? next : outline;
}

/** Keyboard alternative to dragging: moves a corner by a number of metres east and north. */
export function nudgeOutlineCorner(outline: RoofOutline, index: number, eastMeters: number, northMeters: number, anchor?: RoofPoint): RoofOutline {
  if (!Number.isInteger(index) || index < 0 || index >= outline.length || !Number.isFinite(eastMeters) || !Number.isFinite(northMeters)) return outline;
  const current = outline[index];
  return moveOutlineCorner(outline, index, fromPlan({ x: eastMeters, z: northMeters }, current), anchor);
}
