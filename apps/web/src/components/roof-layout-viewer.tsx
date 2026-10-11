"use client";

import dynamic from "next/dynamic";
import { Component, useEffect, useMemo, useState, type ReactNode } from "react";
import { Box, Compass, Maximize2, Minus, Plus, RotateCcw, RotateCw } from "lucide-react";
import { Button } from "@solarsaathi/ui";
import { getRoofLayoutAssumptionsV1, planRoofLayout, type RoofLayout } from "@solarsaathi/calculations";
import type { NormalizedRoofV1 } from "@solarsaathi/types";
import type { ViewCommand } from "./roof-layout-scene";
import { roofLayoutWarningText } from "../lib/roof-layout-copy";

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
  return (
    <svg className="roof-plan-svg" viewBox={viewBox} preserveAspectRatio="xMidYMid meet" role="img"
      aria-label={`Schematic top-down roof plan with ${layout.segments.length} roof segments and ${layout.panels.length} proposed panels`}>
      <title>Roof and proposed solar panel plan</title>
      {layout.footprint.length >= 3 && (
        <polygon points={points(layout.footprint)} fill="none" stroke="#d9e6da" strokeDasharray={`${span * 0.02} ${span * 0.015}`}
          strokeWidth={span * 0.005} />
      )}
      {layout.segments.map((segment, index) => (
        <polygon key={segment.segmentId} points={points(segment.corners)}
          fill={segment.geometryKind === "AREA_ONLY_ILLUSTRATION" ? "#84948a" : index % 2 === 0 ? "#9ac7a2" : "#b1d2af"}
          stroke="#d7ead5" strokeWidth={span * 0.008} />
      ))}
      {layout.panels.map(panel => (
        <polygon key={panel.panelId} points={points(panel.corners)}
          fill="#17475b" stroke="#e8b44b" strokeWidth={span * 0.004} />
      ))}
      <text x={maxX + pad * 0.6} y={-maxZ} textAnchor="middle" fill="#d9e6da" fontSize={span * 0.08} fontWeight="600">N</text>
    </svg>
  );
}

export function RoofLayoutViewer({ roof, analysisId }: { roof: NormalizedRoofV1; analysisId: string }) {
  const assumptions = useMemo(() => getRoofLayoutAssumptionsV1(roof), [roof]);
  // The planner's own fit is shown as-is: panels stay on their roof plane, inside its setbacks and service path.
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
      ? "Each Google roof plane is approximated as a rectangle turned to its direction, not traced roof edges."
      : "Roof rectangle uses the dimensions you entered.";

  return (
    <section className="roof-layout-section" aria-labelledby="roof-layout-title">
      <div className="roof-layout-heading">
        <div>
          <span className="roof-layout-kicker"><Box size={17} aria-hidden="true" /> Deterministic layout</span>
          <h2 id="roof-layout-title">Explore your roof in 3D</h2>
          <p>{status}. {geometryLabel} This view is a planning concept, not a site survey or structural approval.</p>
        </div>
        <span className="roof-layout-badge">{layout.fitStatus === "UNDETERMINED" ? "Fit undetermined" : "Planning view"}</span>
      </div>
      <div className="roof-layout-grid">
        <div className="roof-viewer">
          <div className="roof-viewer-toolbar flex flex-wrap items-center justify-between gap-2" role="group" aria-label="Roof view">
            <div className="flex items-center gap-1.5">
              <Button variant={mode === "3d" ? "default" : "outline"} size="sm" disabled={webGl !== "available"} aria-pressed={mode === "3d"} onClick={() => setMode("3d")}>3D view</Button>
              <Button variant={mode === "plan" ? "default" : "outline"} size="sm" aria-pressed={mode === "plan"} onClick={() => setMode("plan")}>Plan view</Button>
            </div>
            {webGl === "unavailable" && <span className="roof-viewer-state">3D is unavailable on this device.</span>}
          </div>
          <div className="roof-viewer-stage">
            {mode === "3d" && webGl === "available" ? (
              <SceneBoundary key={analysisId}>
                <RoofLayoutScene layout={layout} command={command} reducedMotion={reducedMotion} />
              </SceneBoundary>
            ) : (
              <PlanView layout={layout} />
            )}
          </div>
          <div className="roof-viewer-footer">
            {mode === "3d" && webGl === "available" ? (
              <div className="roof-viewer-controls" role="group" aria-label="3D camera controls">
                <Button variant="outline" size="sm" onClick={() => send("left")} aria-label="Rotate left"><RotateCcw size={16} /></Button>
                <Button variant="outline" size="sm" onClick={() => send("right")} aria-label="Rotate right"><RotateCw size={16} /></Button>
                <Button variant="outline" size="sm" onClick={() => send("in")} aria-label="Zoom in"><Plus size={16} /></Button>
                <Button variant="outline" size="sm" onClick={() => send("out")} aria-label="Zoom out"><Minus size={16} /></Button>
                <Button variant="outline" size="sm" onClick={() => send("top")} aria-label="Top view"><Compass size={16} /></Button>
                <Button variant="outline" size="sm" onClick={() => send("reset")} aria-label="Reset view"><Maximize2 size={16} /></Button>
              </div>
            ) : <span>Top-down schematic · north is up</span>}
            <span>{mode === "3d" ? "Drag to orbit · scroll or pinch to zoom" : "Measured and approximate geometry shown to scale"}</span>
          </div>
        </div>
        <div className="roof-layout-details">
          <div className="roof-layout-metric">
            <span>Panels under these assumptions</span>
            <strong>{layout.panelCount === null ? "Undetermined" : layout.panelCount}</strong>
          </div>
          <div className="roof-layout-metric">
            <span>Proposed DC capacity</span>
            <strong>{layout.dcCapacityKw === null ? "Undetermined" : `${layout.dcCapacityKw.toFixed(2)} kW`}</strong>
          </div>
          <div className="roof-layout-metric">
            <span>{roof.source === "GOOGLE_SOLAR" ? "Google modeled roof area" : "Entered roof surface area"}</span>
            <strong>{roof.roofAreaSquareMeters.toFixed(1)} m²</strong>
          </div>
          <div className="roof-layout-assumptions">
            <h3>Planning assumptions</h3>
            <p>Panel: {assumptions.panelWidthMeters.toFixed(2)} × {assumptions.panelHeightMeters.toFixed(2)} m, {assumptions.panelCapacityWatts} W. Edge setback: {assumptions.edgeSetbackMeters} m. Panel gap: {assumptions.panelGapMeters} m. Service path: {assumptions.servicePathWidthMeters} m.</p>
            <p>These distances are modeling inputs, not verified regulatory clearances. A site survey and installer review are required.</p>
          </div>
          {roof.source === "GOOGLE_SOLAR" && <p className="roof-layout-attribution">Source: Includes solar data from Google.</p>}
        </div>
      </div>
      {layout.warnings.length > 0 && (
        <div className="roof-layout-warnings">
          <h3>Layout limits</h3>
          <ul>{layout.warnings.map(warning => <li key={warning}>{roofLayoutWarningText[warning]}</li>)}</ul>
        </div>
      )}
    </section>
  );
}
