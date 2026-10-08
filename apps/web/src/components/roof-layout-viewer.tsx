"use client";

import dynamic from "next/dynamic";
import { Component, useEffect, useMemo, useState, type ReactNode } from "react";
import { Box, Compass, Maximize2, Minus, Plus, RotateCcw, RotateCw } from "lucide-react";
import { Button } from "@solarsaathi/ui";
import { planRoofLayout, type RoofLayout, type RoofLayoutAssumptions } from "@solarsaathi/calculations";
import type { NormalizedRoofV1 } from "@solarsaathi/types";
import type { ViewCommand } from "./roof-layout-scene";

const warningText: Record<RoofLayout["warnings"][number], string> = {
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

const RoofLayoutScene = dynamic(() => import("./roof-layout-scene"), {
  ssr: false,
  loading: () => <p className="roof-viewer-loading" role="status">Loading 3D roof view…</p>,
});

function supportsWebGl(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch { return false; }
}

class SceneBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed
      ? <p className="roof-viewer-loading" role="status">3D rendering stopped on this device. Select Plan view to inspect the same layout.</p>
      : this.props.children;
  }
}

function PlanView({ layout }: { layout: RoofLayout }) {
  const corners = layout.segments.flatMap(segment => segment.corners);
  if (!corners.length) return <p className="roof-viewer-loading">A roof outline is unavailable for this assessment.</p>;
  const minX = Math.min(...corners.map(point => point.x));
  const maxX = Math.max(...corners.map(point => point.x));
  const minZ = Math.min(...corners.map(point => point.z));
  const maxZ = Math.max(...corners.map(point => point.z));
  const span = Math.max(maxX - minX, maxZ - minZ, 1);
  const pad = span * 0.15;
  const viewBox = `${minX - pad} ${-maxZ - pad} ${maxX - minX + pad * 2} ${maxZ - minZ + pad * 2}`;
  const points = (shape: readonly { x: number; z: number }[]) => shape.map(point => `${point.x},${-point.z}`).join(" ");
  return <svg className="roof-plan-svg" viewBox={viewBox} preserveAspectRatio="xMidYMid meet" role="img"
    aria-label={`Schematic top-down roof plan with ${layout.segments.length} roof segments and ${layout.panels.length} proposed panels`}>
    <title>Roof and proposed solar panel plan</title>
    {layout.segments.map((segment, index) => <polygon key={segment.segmentId} points={points(segment.corners)}
      fill={segment.geometryKind === "AREA_ONLY_ILLUSTRATION" ? "#84948a" : index % 2 === 0 ? "#9ac7a2" : "#b1d2af"}
      stroke="#d7ead5" strokeWidth={span * 0.008} />)}
    {layout.panels.map(panel => <polygon key={panel.panelId} points={points(panel.corners)}
      fill="#17475b" stroke="#e8b44b" strokeWidth={span * 0.004} />)}
    <text x={maxX + pad * 0.6} y={-maxZ} textAnchor="middle" fill="#d9e6da" fontSize={span * 0.08} fontWeight="600">N</text>
  </svg>;
}

function assumptionsFor(roof: NormalizedRoofV1): RoofLayoutAssumptions {
  return {
    schemaVersion: 1,
    panelWidthMeters: roof.panelWidthMeters ?? 1.1,
    panelHeightMeters: roof.panelHeightMeters ?? 2,
    panelCapacityWatts: roof.panelCapacityWatts ?? 550,
    edgeSetbackMeters: 0.5,
    panelGapMeters: 0.05,
    servicePathWidthMeters: 0.75,
    mountingOffsetMeters: 0.1,
    maxModeledPitchDegrees: 85,
    manualAreaToleranceFraction: 0.05,
    maxPanels: 300,
  };
}

export function RoofLayoutViewer({ roof, analysisId }: { roof: NormalizedRoofV1; analysisId: string }) {
  const assumptions = useMemo(() => assumptionsFor(roof), [roof]);
  const layout = useMemo(() => planRoofLayout(roof, assumptions), [roof, assumptions]);
  const [webGl, setWebGl] = useState<"checking" | "available" | "unavailable">("checking");
  const [mode, setMode] = useState<"3d" | "plan">("plan");
  const [reducedMotion, setReducedMotion] = useState(false);
  const [command, setCommand] = useState<ViewCommand>({ action: "reset", sequence: 0 });

  useEffect(() => {
    const available = supportsWebGl();
    setWebGl(available ? "available" : "unavailable");
    if (available) setMode("3d");
    const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!media) return;
    const update = () => setReducedMotion(media.matches);
    update(); media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  const send = (action: ViewCommand["action"]) => setCommand(previous => ({ action, sequence: previous.sequence + 1 }));
  const status = layout.fitStatus === "MODELED_APPROXIMATE" ? "Approximate roof model" : layout.fitStatus === "SPACE_FEASIBLE" ? "Space-feasible plan" : "Illustrative roof only";
  const geometryLabel = layout.segments.some(segment => segment.geometryKind === "AREA_ONLY_ILLUSTRATION")
    ? "Roof shape is symbolic because only area was provided."
    : layout.segments.some(segment => segment.geometryKind === "GOOGLE_BOUNDS_APPROXIMATE")
      ? "Google bounds are approximate boxes, not traced roof edges."
      : "Roof rectangle uses the dimensions you entered.";

  return <section className="roof-layout-section" aria-labelledby="roof-layout-title">
    <div className="roof-layout-heading">
      <div><span className="roof-layout-kicker"><Box size={17} aria-hidden="true" /> Deterministic layout</span><h2 id="roof-layout-title">Explore your roof in 3D</h2>
        <p>{status}. {geometryLabel} This view is a planning concept, not a site survey or structural approval.</p></div>
      <span className="roof-layout-badge">{layout.fitStatus === "UNDETERMINED" ? "Fit undetermined" : "Planning view"}</span>
    </div>
    <div className="roof-layout-grid">
      <div className="roof-viewer">
        <div className="roof-viewer-toolbar" role="group" aria-label="Roof view">
          <Button variant={mode === "3d" ? "default" : "outline"} size="sm" disabled={webGl !== "available"} aria-pressed={mode === "3d"} onClick={() => setMode("3d")}>3D view</Button>
          <Button variant={mode === "plan" ? "default" : "outline"} size="sm" aria-pressed={mode === "plan"} onClick={() => setMode("plan")}>Plan view</Button>
          {webGl === "unavailable" && <span className="roof-viewer-state">3D is unavailable on this device.</span>}
        </div>
        <div className="roof-viewer-stage">
          {mode === "3d" && webGl === "available" ? <SceneBoundary key={analysisId}><RoofLayoutScene layout={layout} command={command} reducedMotion={reducedMotion} /></SceneBoundary> : <PlanView layout={layout} />}
        </div>
        <div className="roof-viewer-footer">
          {mode === "3d" && webGl === "available" ? <div className="roof-viewer-controls" role="group" aria-label="3D camera controls">
            <Button variant="outline" size="sm" onClick={() => send("left")} aria-label="Rotate left"><RotateCcw size={16} /></Button>
            <Button variant="outline" size="sm" onClick={() => send("right")} aria-label="Rotate right"><RotateCw size={16} /></Button>
            <Button variant="outline" size="sm" onClick={() => send("in")} aria-label="Zoom in"><Plus size={16} /></Button>
            <Button variant="outline" size="sm" onClick={() => send("out")} aria-label="Zoom out"><Minus size={16} /></Button>
            <Button variant="outline" size="sm" onClick={() => send("top")} aria-label="Top view"><Compass size={16} /></Button>
            <Button variant="outline" size="sm" onClick={() => send("reset")} aria-label="Reset view"><Maximize2 size={16} /></Button>
          </div> : <span>Top-down schematic · north is up</span>}
          <span>{mode === "3d" ? "Drag to orbit · scroll or pinch to zoom" : "Measured and approximate geometry shown to scale"}</span>
        </div>
      </div>
      <div className="roof-layout-details">
        <div className="roof-layout-metric"><span>Panels under these assumptions</span><strong>{layout.panelCount === null ? "Undetermined" : layout.panelCount}</strong></div>
        <div className="roof-layout-metric"><span>Proposed DC capacity</span><strong>{layout.dcCapacityKw === null ? "Undetermined" : `${layout.dcCapacityKw.toFixed(2)} kW`}</strong></div>
        <div className="roof-layout-metric"><span>{roof.source === "GOOGLE_SOLAR" ? "Google modeled roof area" : "Entered roof surface area"}</span><strong>{roof.roofAreaSquareMeters.toFixed(1)} m²</strong></div>
        <div className="roof-layout-assumptions"><h3>Planning assumptions</h3><p>Panel: {assumptions.panelWidthMeters.toFixed(2)} × {assumptions.panelHeightMeters.toFixed(2)} m, {assumptions.panelCapacityWatts} W. Edge setback: {assumptions.edgeSetbackMeters} m. Panel gap: {assumptions.panelGapMeters} m. Service path: {assumptions.servicePathWidthMeters} m.</p><p>These distances are modeling inputs, not verified regulatory clearances. A site survey and installer review are required.</p></div>
        {roof.source === "GOOGLE_SOLAR" && <p className="roof-layout-attribution">Source: Includes solar data from Google.</p>}
      </div>
    </div>
    {layout.warnings.length > 0 && <div className="roof-layout-warnings"><h3>Layout limits</h3><ul>{layout.warnings.map(warning => <li key={warning}>{warningText[warning]}</li>)}</ul></div>}
  </section>;
}
