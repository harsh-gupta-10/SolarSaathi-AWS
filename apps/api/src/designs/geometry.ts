import { createHash } from "node:crypto";
import { planRoofLayout, type RoofLayoutCorners, type RoofLayoutPoint } from "@solarsaathi/calculations";
import type { NormalizedRoofV1 } from "@solarsaathi/types";
import type { SystemCandidate, SystemDesignAssumptionsV1 } from "@solarsaathi/calculations";
import type { DesignCandidateV1, DesignCategory, DesignRecommendationResponseV1, ZoneV1 } from "./schema";
import type { StoredDesignTemplate } from "./store";

interface Rect { minX: number; maxX: number; minZ: number; maxZ: number }
interface ZoneRect { rect: Rect; segmentId: string; segmentCorners: RoofLayoutCorners }
const SOLAR_BUFFER_METERS = 0.75;
const MAX_SEGMENTS = 32;
const MAX_SELECTED_PANELS = 80;
const MAX_FREE_RECTS = 1_000;
const MAX_RETURNED_ZONES = 40;

const concepts: ReadonlyArray<{ candidateId: DesignCandidateV1["candidateId"]; category: DesignCategory;
  title: string; width: number; depth: number; safetyNotes: string[] }> = [
  { candidateId: "drying", category: "DRYING", title: "Open-air drying corner", width: 2, depth: 2,
    safetyNotes: ["Use only a removable light-use layout after roof access and load review.", "Keep solar service paths clear."] },
  { candidateId: "seating", category: "SEATING", title: "Small seating nook", width: 2.5, depth: 2.5,
    safetyNotes: ["Furniture, shade and occupancy loads need structural review.", "Do not anchor anything to the roof without a professional design."] },
  { candidateId: "garden", category: "GARDEN", title: "Light planter concept", width: 3, depth: 2,
    safetyNotes: ["Wet soil and planters can be heavy; structural and waterproofing review is required.", "Keep drainage and solar service paths clear."] },
  { candidateId: "stretch", category: "STRETCH", title: "Open-air stretch space", width: 2, depth: 2,
    safetyNotes: ["This is an empty-space concept, not approval for a gym or equipment load.", "Maintain safe roof access and solar clearances."] },
];

function box(corners: RoofLayoutCorners): Rect {
  return { minX: Math.min(...corners.map(point => point.x)), maxX: Math.max(...corners.map(point => point.x)),
    minZ: Math.min(...corners.map(point => point.z)), maxZ: Math.max(...corners.map(point => point.z)) };
}
function area(rect: Rect) { return Math.max(0, rect.maxX - rect.minX) * Math.max(0, rect.maxZ - rect.minZ); }
function subtract(rect: Rect, blocker: Rect): Rect[] {
  const overlap = { minX: Math.max(rect.minX, blocker.minX), maxX: Math.min(rect.maxX, blocker.maxX),
    minZ: Math.max(rect.minZ, blocker.minZ), maxZ: Math.min(rect.maxZ, blocker.maxZ) };
  if (area(overlap) <= 1e-9) return [rect];
  return [
    { minX: rect.minX, maxX: overlap.minX, minZ: rect.minZ, maxZ: rect.maxZ },
    { minX: overlap.maxX, maxX: rect.maxX, minZ: rect.minZ, maxZ: rect.maxZ },
    { minX: overlap.minX, maxX: overlap.maxX, minZ: rect.minZ, maxZ: overlap.minZ },
    { minX: overlap.minX, maxX: overlap.maxX, minZ: overlap.maxZ, maxZ: rect.maxZ },
  ].filter(next => area(next) > 1e-6);
}
function serviceBands(rect: Rect, width: number): Rect[] {
  if (width <= 0) return [rect];
  if (rect.maxX - rect.minX >= rect.maxZ - rect.minZ) {
    const middle = (rect.minZ + rect.maxZ) / 2;
    return [
      { ...rect, maxZ: middle - width / 2 },
      { ...rect, minZ: middle + width / 2 },
    ].filter(band => area(band) > 1e-6);
  }
  const middle = (rect.minX + rect.maxX) / 2;
  return [
    { ...rect, maxX: middle - width / 2 },
    { ...rect, minX: middle + width / 2 },
  ].filter(band => area(band) > 1e-6);
}
function cornersOnPlane(rect: Rect, surface: RoofLayoutCorners): RoofLayoutCorners {
  const bounds = box(surface);
  const southwest = surface[0], southeast = surface[1], northwest = surface[3];
  const height = (x: number, z: number) => southwest.y +
    (x - bounds.minX) / Math.max(1e-9, bounds.maxX - bounds.minX) * (southeast.y - southwest.y) +
    (z - bounds.minZ) / Math.max(1e-9, bounds.maxZ - bounds.minZ) * (northwest.y - southwest.y);
  const point = (x: number, z: number): RoofLayoutPoint => ({ x, y: height(x, z), z });
  return [point(rect.minX, rect.minZ), point(rect.maxX, rect.minZ),
    point(rect.maxX, rect.maxZ), point(rect.minX, rect.maxZ)];
}
function fingerprint(category: DesignCategory, roof: NormalizedRoofV1, candidate: SystemCandidate,
  zone: ZoneV1 | undefined, remaining: number | null): string {
  const zoneBox = zone ? box(zone.corners) : undefined;
  const normalized = { v: 1, category, roofSource: roof.source,
    areaBucket: Math.floor(roof.roofAreaSquareMeters / 10),
    remainingBucket: remaining === null ? -1 : Math.floor(remaining / 5),
    solarKw: candidate.nominalKw,
    widthBucket: zoneBox ? Math.floor((zoneBox.maxX - zoneBox.minX) / 2) : -1,
    depthBucket: zoneBox ? Math.floor((zoneBox.maxZ - zoneBox.minZ) / 2) : -1 };
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

export function planRemainingSpaceV1(roof: NormalizedRoofV1, assumptions: SystemDesignAssumptionsV1,
  candidate: SystemCandidate, requestId: string, propertyId: string, analysisId: string,
  categories?: DesignCategory[]): DesignRecommendationResponseV1 {
  const layout = planRoofLayout(roof, assumptions.roofLayout);
  const selectedPanels = layout.panels.slice(0, candidate.panelCount);
  const warnings = ["Space-feasible means approximate horizontal geometry only; no structural capacity, waterproofing or local rules were verified.",
    "Candidate placements are alternatives, not a combined layout or construction approval."];
  const tooComplex = layout.segments.length > MAX_SEGMENTS || selectedPanels.length > MAX_SELECTED_PANELS;
  if (tooComplex) warnings.push("The roof model exceeds the bounded concept geometry; placement is undetermined.");
  if (layout.fitStatus === "MODELED_APPROXIMATE") warnings.push("Google Solar roof bounds are approximate rectangles, not a site survey.");
  if (layout.fitStatus === "UNDETERMINED") warnings.push("Measured dimensions and panel placement are needed before remaining space can be estimated.");
  const projectedRoof = layout.segments.reduce((sum, segment) => sum + area(box(segment.corners)), 0);
  const overlappingBounds = roof.source === "GOOGLE_SOLAR" && (projectedRoof > roof.roofAreaSquareMeters * 1.15 ||
    layout.segments.some((segment, index) => layout.segments.slice(index + 1).some(other => {
      const first = box(segment.corners), second = box(other.corners);
      return area({ minX: Math.max(first.minX, second.minX), maxX: Math.min(first.maxX, second.maxX),
        minZ: Math.max(first.minZ, second.minZ), maxZ: Math.min(first.maxZ, second.maxZ) }) > 1e-6;
    })));
  if (overlappingBounds) warnings.push("Modeled segment bounds overlap or exceed measured roof area; placement is undetermined.");
  const determined = layout.fitStatus !== "UNDETERMINED" && !tooComplex && !overlappingBounds &&
    selectedPanels.length === candidate.panelCount;
  const segmentGeometry = tooComplex ? [] : layout.segments.map(segment => ({ segmentId: segment.segmentId,
    corners: segment.corners }));
  const panelGeometry = tooComplex ? [] : selectedPanels.map(panel => ({ panelId: panel.panelId,
    segmentId: panel.segmentId, corners: panel.corners }));
  let modeledUsable: number | null = null;
  let reservedSolar: number | null = null;
  let remaining: number | null = null;
  let zones: ZoneV1[] = [];
  if (determined) {
    const all: ZoneRect[] = [];
    let beforeSolar = 0;
    for (const segment of layout.segments) {
      const outer = box(segment.corners);
      const inset = { minX: outer.minX + layout.clearances.edgeSetbackMeters,
        maxX: outer.maxX - layout.clearances.edgeSetbackMeters,
        minZ: outer.minZ + layout.clearances.edgeSetbackMeters,
        maxZ: outer.maxZ - layout.clearances.edgeSetbackMeters };
      let rectangles = serviceBands(inset, layout.clearances.servicePathWidthMeters);
      beforeSolar += rectangles.reduce((sum, rect) => sum + area(rect), 0);
      for (const panel of selectedPanels.filter(item => item.segmentId === segment.segmentId)) {
        const footprint = box(panel.corners);
        const block = { minX: footprint.minX - SOLAR_BUFFER_METERS,
          maxX: footprint.maxX + SOLAR_BUFFER_METERS,
          minZ: footprint.minZ - SOLAR_BUFFER_METERS,
          maxZ: footprint.maxZ + SOLAR_BUFFER_METERS };
        rectangles = rectangles.flatMap(rect => subtract(rect, block));
        if (rectangles.length > MAX_FREE_RECTS) break;
      }
      if (rectangles.length > MAX_FREE_RECTS || all.length + rectangles.length > MAX_FREE_RECTS) {
        warnings.push("The free-space geometry is too fragmented for a bounded placement model.");
        break;
      }
      all.push(...rectangles.map(rect => ({ rect, segmentId: segment.segmentId, segmentCorners: segment.corners })));
    }
    if (all.length <= MAX_FREE_RECTS && !warnings.some(value => value.includes("too fragmented"))) {
      modeledUsable = beforeSolar;
      remaining = all.reduce((sum, zone) => sum + area(zone.rect), 0);
      reservedSolar = Math.max(0, modeledUsable - remaining);
      zones = all.sort((a, b) => area(b.rect) - area(a.rect))
        .map((zone, index) => ({ zoneId: `zone-${index + 1}`, segmentId: zone.segmentId,
          corners: cornersOnPlane(zone.rect, zone.segmentCorners), areaSquareMeters: area(zone.rect) }));
    }
  }
  const fitStatus = remaining === null ? "UNDETERMINED" : layout.fitStatus;
  const chosen = concepts.filter(concept => !categories || categories.includes(concept.category));
  const candidates: DesignCandidateV1[] = chosen.map(concept => {
    const requiredAreaSquareMeters = concept.width * concept.depth;
    const zone = zones.find(item => {
      const bounds = box(item.corners);
      return (bounds.maxX - bounds.minX >= concept.width && bounds.maxZ - bounds.minZ >= concept.depth) ||
        (bounds.maxX - bounds.minX >= concept.depth && bounds.maxZ - bounds.minZ >= concept.width);
    });
    const zoneBounds = zone ? box(zone.corners) : undefined;
    const width = zoneBounds && zoneBounds.maxX - zoneBounds.minX >= concept.width &&
      zoneBounds.maxZ - zoneBounds.minZ >= concept.depth ? concept.width : concept.depth;
    const depth = width === concept.width ? concept.depth : concept.width;
    const placementRect = zoneBounds ? { minX: zoneBounds.minX + (zoneBounds.maxX - zoneBounds.minX - width) / 2,
      maxX: zoneBounds.minX + (zoneBounds.maxX - zoneBounds.minX + width) / 2,
      minZ: zoneBounds.minZ + (zoneBounds.maxZ - zoneBounds.minZ - depth) / 2,
      maxZ: zoneBounds.minZ + (zoneBounds.maxZ - zoneBounds.minZ + depth) / 2 } : undefined;
    const placement = zone && placementRect ? { zoneId: zone.zoneId,
      corners: cornersOnPlane(placementRect, zone.corners), areaSquareMeters: requiredAreaSquareMeters } : undefined;
    const status = remaining === null ? "UNDETERMINED" : placement ? "SPACE_FEASIBLE" : "NOT_SPACE_FEASIBLE";
    return { candidateId: concept.candidateId, category: concept.category, title: concept.title, status,
      reason: status === "SPACE_FEASIBLE" ? "A modeled clear zone fits this concept after edge, service-path and solar buffers. A site and structural review is required."
        : status === "UNDETERMINED" ? "The roof model does not support a defensible remaining-space placement."
          : "No modeled clear zone meets this concept's minimum dimensions after reserved clearances.",
      requiredAreaSquareMeters, ...(zone ? { modeledAreaSquareMeters: zone.areaSquareMeters } : {}),
      ...(placement ? { placement } : {}), requiresStructuralReview: true as const,
      safetyNotes: concept.safetyNotes, fingerprint: fingerprint(concept.category, roof, candidate, zone, remaining),
      template: { status: "DETERMINISTIC_FALLBACK" as const }, image: { status: "NOT_REQUESTED" as const } };
  });
  const returnedZones = visibleZones(zones, candidates);
  if (returnedZones.length < zones.length) {
    warnings.push(`Only ${returnedZones.length} of ${zones.length} modeled free zones are shown in the bounded scene.`);
  }
  return { schemaVersion: 1, source: "DETERMINISTIC_REMAINING_SPACE_V1", requestId, propertyId, analysisId,
    system: { nominalKw: candidate.nominalKw, actualDcKw: candidate.actualDcKw, panelCount: candidate.panelCount },
    planning: { fitStatus, roofAreaSquareMeters: roof.roofAreaSquareMeters,
      modeledUsableProjectedAreaSquareMeters: modeledUsable,
      reservedSolarProjectedAreaSquareMeters: reservedSolar,
      remainingProjectedAreaSquareMeters: remaining,
      assumptions: { edgeSetbackMeters: layout.clearances.edgeSetbackMeters,
        servicePathWidthMeters: layout.clearances.servicePathWidthMeters, solarBufferMeters: SOLAR_BUFFER_METERS } },
    geometry: { coordinateSystem: "LOCAL_EAST_UP_NORTH_METERS", segments: segmentGeometry,
      panels: panelGeometry, freeZones: returnedZones, totalFreeZoneCount: zones.length }, candidates, warnings };
}

export function visibleZones(zones: ZoneV1[], candidates: DesignCandidateV1[]): ZoneV1[] {
  const selectedZoneIds = new Set(candidates.flatMap(item => item.placement ? [item.placement.zoneId] : []));
  const returned = zones.slice(0, MAX_RETURNED_ZONES - candidates.length);
  for (const zone of zones) {
    if (selectedZoneIds.has(zone.zoneId) && !returned.some(item => item.zoneId === zone.zoneId)) returned.push(zone);
  }
  return returned;
}

export function templateSpecFor(candidate: DesignCandidateV1): StoredDesignTemplate["designSpec"] | undefined {
  if (!candidate.placement) return undefined;
  const footprint = box(candidate.placement.corners);
  const width = footprint.maxX - footprint.minX;
  const depth = footprint.maxZ - footprint.minZ;
  if (width <= 0 || depth <= 0) return undefined;
  const rounded = (value: number) => Math.round(value * 10_000) / 10_000;
  return { layoutVersion: 1, footprintWidthMeters: rounded(Math.max(width, depth)),
    footprintDepthMeters: rounded(Math.min(width, depth)),
    placementStrategy: "CENTER_LARGEST_FITTING_ZONE_ALLOW_ROTATION",
    requiredAreaSquareMeters: candidate.requiredAreaSquareMeters, safetyNotes: candidate.safetyNotes };
}

export function applyStoredTemplate(candidate: DesignCandidateV1, zones: ZoneV1[],
  stored: StoredDesignTemplate): boolean {
  const expected = templateSpecFor(candidate);
  const spec = stored.designSpec;
  if (!expected || spec.layoutVersion !== 1 ||
    spec.placementStrategy !== "CENTER_LARGEST_FITTING_ZONE_ALLOW_ROTATION" ||
    Math.abs(spec.requiredAreaSquareMeters - expected.requiredAreaSquareMeters) > 1e-6 ||
    Math.abs(spec.footprintWidthMeters * spec.footprintDepthMeters - spec.requiredAreaSquareMeters) > 1e-6 ||
    Math.abs(Math.min(spec.footprintWidthMeters, spec.footprintDepthMeters) -
      Math.min(expected.footprintWidthMeters, expected.footprintDepthMeters)) > 1e-6 ||
    Math.abs(Math.max(spec.footprintWidthMeters, spec.footprintDepthMeters) -
      Math.max(expected.footprintWidthMeters, expected.footprintDepthMeters)) > 1e-6 ||
    JSON.stringify(spec.safetyNotes) !== JSON.stringify(expected.safetyNotes)) return false;
  const zone = zones.find(item => item.zoneId === candidate.placement?.zoneId);
  if (!zone) return false;
  const bounds = box(zone.corners);
  const zoneWidth = bounds.maxX - bounds.minX;
  const zoneDepth = bounds.maxZ - bounds.minZ;
  const orientations = [[spec.footprintWidthMeters, spec.footprintDepthMeters],
    [spec.footprintDepthMeters, spec.footprintWidthMeters]] as const;
  const fit = orientations.find(([width, depth]) => zoneWidth + 1e-6 >= width && zoneDepth + 1e-6 >= depth);
  if (!fit) return false;
  const [width, depth] = fit;
  const placed = { minX: bounds.minX + (zoneWidth - width) / 2, maxX: bounds.minX + (zoneWidth + width) / 2,
    minZ: bounds.minZ + (zoneDepth - depth) / 2, maxZ: bounds.minZ + (zoneDepth + depth) / 2 };
  candidate.placement = { zoneId: zone.zoneId, corners: cornersOnPlane(placed, zone.corners),
    areaSquareMeters: spec.requiredAreaSquareMeters };
  candidate.template.status = "STORED";
  return true;
}
