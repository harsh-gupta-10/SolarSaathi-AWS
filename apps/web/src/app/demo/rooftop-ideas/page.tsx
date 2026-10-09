import type { Metadata } from "next";
import Link from "next/link";
import { RooftopIdeasResult } from "../../../components/rooftop-ideas-workspace";
import type { DesignsResponse } from "../../../lib/designs-api";
import { demoRoof } from "../fixtures";
import { demoFinancialResponse } from "../system-financial-fixture";

export const metadata: Metadata = { title: "Rooftop ideas demo | SolarSaathi", robots: { index: false, follow: false } };

const rectangle = (minX: number, maxX: number, minZ: number, maxZ: number): DesignsResponse["geometry"]["segments"][number]["corners"] => [
  { x: minX, y: 0, z: minZ }, { x: maxX, y: 0, z: minZ },
  { x: maxX, y: 0, z: maxZ }, { x: minX, y: 0, z: maxZ },
];
const fingerprint = "a".repeat(64);
const demo: DesignsResponse = { schemaVersion: 1, source: "DETERMINISTIC_REMAINING_SPACE_V1",
  requestId: "synthetic-rooftop-demo", propertyId: "synthetic-property", analysisId: "synthetic-analysis",
  system: { nominalKw: demoFinancialResponse.system.nominalKw,
    actualDcKw: demoFinancialResponse.system.actualDcKw,
    panelCount: demoFinancialResponse.system.panelCount },
  planning: { fitStatus: "SPACE_FEASIBLE", roofAreaSquareMeters: demoRoof.roofAreaSquareMeters,
    modeledUsableProjectedAreaSquareMeters: 30, reservedSolarProjectedAreaSquareMeters: 24,
    remainingProjectedAreaSquareMeters: 6, assumptions: { edgeSetbackMeters: 0.5,
      servicePathWidthMeters: 0.8, solarBufferMeters: 0.75 } },
  geometry: { coordinateSystem: "LOCAL_EAST_UP_NORTH_METERS",
    segments: [{ segmentId: "synthetic-segment", corners: rectangle(0, 10, 0, 10) }],
    panels: Array.from({ length: demoFinancialResponse.system.panelCount }, (_, index) => ({ panelId: `synthetic-panel-${index + 1}`,
      segmentId: "synthetic-segment", corners: rectangle(index % 2 ? 2.6 : 1, index % 2 ? 4.1 : 2.5,
        1 + Math.floor(index / 2) * 1.2, 2.1 + Math.floor(index / 2) * 1.2) })),
    freeZones: [{ zoneId: "synthetic-zone", segmentId: "synthetic-segment",
      corners: rectangle(5, 8, 2, 4), areaSquareMeters: 6 }], totalFreeZoneCount: 1 },
  candidates: [
    { candidateId: "drying", category: "DRYING", title: "Fictional drying corner", status: "SPACE_FEASIBLE",
      reason: "This made-up plan illustrates how a modeled free zone could fit a small light-use footprint.",
      requiredAreaSquareMeters: 4, modeledAreaSquareMeters: 6,
      placement: { zoneId: "synthetic-zone", corners: rectangle(5.5, 7.5, 2, 4), areaSquareMeters: 4 },
      requiresStructuralReview: true, safetyNotes: ["Fictional example: roof access and loading have not been checked."],
      fingerprint, template: { status: "DETERMINISTIC_FALLBACK" }, image: { status: "NOT_REQUESTED" } },
    { candidateId: "garden", category: "GARDEN", title: "Fictional light planter area", status: "SPACE_FEASIBLE",
      reason: "This synthetic footprint fits the drawn free zone; it says nothing about wet soil load or waterproofing.",
      requiredAreaSquareMeters: 6, modeledAreaSquareMeters: 6,
      placement: { zoneId: "synthetic-zone", corners: rectangle(5, 8, 2, 4), areaSquareMeters: 6 },
      requiresStructuralReview: true, safetyNotes: ["Wet soil and planters need real structural and waterproofing review."],
      fingerprint, template: { status: "DETERMINISTIC_FALLBACK" }, image: { status: "NOT_REQUESTED" } },
    { candidateId: "seating", category: "SEATING", title: "Fictional seating nook", status: "NOT_SPACE_FEASIBLE",
      reason: "In this demo scenario, the supposed seating footprint does not fit the illustrative safety buffers.",
      requiredAreaSquareMeters: 6.25, requiresStructuralReview: true,
      safetyNotes: ["Furniture and occupancy loads need a real structural review."],
      fingerprint, template: { status: "DETERMINISTIC_FALLBACK" }, image: { status: "NOT_REQUESTED" } },
  ], warnings: ["Every roof, panel, free zone, dimension, candidate and feasibility result on this page is a fictional test fixture."],
};

export default function RooftopIdeasDemoPage() {
  return <main className="container py-10 md:py-16"><p className="mb-4 text-sm"><Link href="/demo"
    className="font-medium text-primary underline underline-offset-4">← Back to guided demo</Link></p>
    <div className="mb-6 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950" role="note">
      <strong>Synthetic rooftop ideas demo.</strong> All roof geometry, solar panels, free space, measurements and concepts below are fictional.
      No live property, Google Solar data, installer, structural review, template store or AI image service was checked.</div>
    <div className="mx-auto max-w-5xl"><RooftopIdeasResult response={demo} demo /></div></main>;
}
