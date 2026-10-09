"use client";

import dynamic from "next/dynamic";
import { Component, useEffect, useMemo, useState, type ReactNode } from "react";
import { Box, Compass, Grid, Maximize2, Minus, Plus, RotateCcw, RotateCw } from "lucide-react";
import { Button } from "@solarsaathi/ui";
import { getRoofLayoutAssumptionsV1, planRoofLayout, type RoofLayout, type RoofLayoutAssumptions, type RoofLayoutCorners, type RoofLayoutPanel } from "@solarsaathi/calculations";
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

/**
 * Organizes scattered/zigzag solar panel suggestions into a professional, cohesive,
 * building-aligned solar array (e.g. 2x3 or 3x2 aligned grid for 6 panels).
 */
function buildAlignedProfessionalLayout(layout: RoofLayout, assumptions: RoofLayoutAssumptions): RoofLayout {
  if (!layout.segments.length || !layout.panels.length) return layout;

  const targetCount = layout.panelCount ?? layout.panels.length;
  if (targetCount <= 0) return layout;

  const segment = layout.segments[0];
  const corners = segment.corners;
  if (corners.length < 4) return layout;

  const c0 = corners[0], c1 = corners[1], c2 = corners[2], c3 = corners[3];
  const ux = c1.x - c0.x, uy = c1.y - c0.y, uz = c1.z - c0.z;
  const vx = c3.x - c0.x, vy = c3.y - c0.y, vz = c3.z - c0.z;
  const lenU = Math.hypot(ux, uy, uz) || 1;
  const lenV = Math.hypot(vx, vy, vz) || 1;
  const uDir = { x: ux / lenU, y: uy / lenU, z: uz / lenU };
  const vDir = { x: vx / lenV, y: vy / lenV, z: vz / lenV };

  const nx = uDir.y * vDir.z - uDir.z * vDir.y;
  const ny = uDir.z * vDir.x - uDir.x * vDir.z;
  const nz = uDir.x * vDir.y - uDir.y * vDir.x;
  const lenN = Math.hypot(nx, ny, nz) || 1;
  let norm = { x: nx / lenN, y: ny / lenN, z: nz / lenN };
  if (norm.y < 0) {
    norm = { x: -norm.x, y: -norm.y, z: -norm.z };
  }

  const segCenter = {
    x: (c0.x + c1.x + c2.x + c3.x) / 4,
    y: (c0.y + c1.y + c2.y + c3.y) / 4,
    z: (c0.z + c1.z + c2.z + c3.z) / 4,
  };

  // Determine grid columns and rows to arrange targetCount panels neatly without zigzag
  let cols: number;
  let rows: number;

  if (targetCount === 6) {
    if (lenU >= lenV) {
      cols = 3;
      rows = 2;
    } else {
      cols = 2;
      rows = 3;
    }
  } else if (targetCount <= 4) {
    cols = Math.min(targetCount, 2);
    rows = Math.ceil(targetCount / cols);
  } else if (targetCount === 8) {
    if (lenU >= lenV) {
      cols = 4;
      rows = 2;
    } else {
      cols = 2;
      rows = 4;
    }
  } else if (targetCount === 9) {
    cols = 3;
    rows = 3;
  } else if (targetCount === 10) {
    if (lenU >= lenV) {
      cols = 5;
      rows = 2;
    } else {
      cols = 2;
      rows = 5;
    }
  } else if (targetCount === 12) {
    if (lenU >= lenV) {
      cols = 4;
      rows = 3;
    } else {
      cols = 3;
      rows = 4;
    }
  } else {
    cols = Math.max(1, Math.min(targetCount, Math.round(Math.sqrt(targetCount * (lenU / lenV)))));
    rows = Math.ceil(targetCount / cols);
  }

  // Standard full-size commercial/residential module dimensions (e.g. 550W Tier-1 mono PERC)
  // Ensures panels are clearly visible, full-size, and aligned to the building structure
  const pWidth = Math.max(assumptions.panelWidthMeters, 1.13);
  const pHeight = Math.max(assumptions.panelHeightMeters, 2.18);
  const clampGap = 0.04;
  const mountElevation = 0.08;

  const arrayWidth = cols * pWidth + (cols - 1) * clampGap;
  const arrayDepth = rows * pHeight + (rows - 1) * clampGap;

  const newPanels: RoofLayoutPanel[] = [];
  let placed = 0;

  for (let r = 0; r < rows && placed < targetCount; r++) {
    for (let c = 0; c < cols && placed < targetCount; c++) {
      placed++;
      const uOffset = -arrayWidth / 2 + pWidth / 2 + c * (pWidth + clampGap);
      const vOffset = -arrayDepth / 2 + pHeight / 2 + r * (pHeight + clampGap);

      const pCenter = {
        x: segCenter.x + uOffset * uDir.x + vOffset * vDir.x + norm.x * mountElevation,
        y: segCenter.y + uOffset * uDir.y + vOffset * vDir.y + norm.y * mountElevation,
        z: segCenter.z + uOffset * uDir.z + vOffset * vDir.z + norm.z * mountElevation,
      };

      const halfW = pWidth / 2;
      const halfH = pHeight / 2;

      const pCorners = [
        {
          x: pCenter.x - halfW * uDir.x - halfH * vDir.x,
          y: pCenter.y - halfW * uDir.y - halfH * vDir.y,
          z: pCenter.z - halfW * uDir.z - halfH * vDir.z,
        },
        {
          x: pCenter.x + halfW * uDir.x - halfH * vDir.x,
          y: pCenter.y + halfW * uDir.y - halfH * vDir.y,
          z: pCenter.z + halfW * uDir.z - halfH * vDir.z,
        },
        {
          x: pCenter.x + halfW * uDir.x + halfH * vDir.x,
          y: pCenter.y + halfW * uDir.y + halfH * vDir.y,
          z: pCenter.z + halfW * uDir.z + halfH * vDir.z,
        },
        {
          x: pCenter.x - halfW * uDir.x + halfH * vDir.x,
          y: pCenter.y - halfW * uDir.y + halfH * vDir.y,
          z: pCenter.z - halfW * uDir.z + halfH * vDir.z,
        },
      ];

      newPanels.push({
        panelId: `panel-${placed}`,
        segmentId: segment.segmentId,
        orientation: pWidth <= pHeight ? "PORTRAIT" : "LANDSCAPE",
        center: pCenter,
        corners: pCorners as unknown as RoofLayoutCorners,
        yearlyEnergyDcKwh: layout.panels[placed - 1]?.yearlyEnergyDcKwh,
      });
    }
  }

  const allPoints = [...layout.segments.flatMap(s => s.corners), ...newPanels.flatMap(p => p.corners)];
  const updatedBounds = allPoints.length
    ? {
        min: {
          x: Math.min(...allPoints.map(p => p.x)),
          y: Math.min(...allPoints.map(p => p.y)),
          z: Math.min(...allPoints.map(p => p.z)),
        },
        max: {
          x: Math.max(...allPoints.map(p => p.x)),
          y: Math.max(...allPoints.map(p => p.y)),
          z: Math.max(...allPoints.map(p => p.z)),
        },
      }
    : layout.bounds;

  return {
    ...layout,
    bounds: updatedBounds,
    panels: newPanels,
    panelCount: newPanels.length,
    dcCapacityKw: (newPanels.length * assumptions.panelCapacityWatts) / 1000,
  };
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
  const rawLayout = useMemo(() => planRoofLayout(roof, assumptions), [roof, assumptions]);
  const [alignedArray, setAlignedArray] = useState(true);

  const layout = useMemo(() => {
    if (!alignedArray || !rawLayout.panels.length) return rawLayout;
    return buildAlignedProfessionalLayout(rawLayout, assumptions);
  }, [alignedArray, rawLayout, assumptions]);

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
            {rawLayout.panels.length > 0 && (
              <Button
                variant={alignedArray ? "secondary" : "outline"}
                size="sm"
                onClick={() => setAlignedArray(!alignedArray)}
                className="text-xs gap-1.5"
                title="Toggle between aligned professional array and raw provider suggestions"
              >
                <Grid className="size-3.5" aria-hidden="true" />
                {alignedArray ? "Professional Array (Aligned)" : "Raw Suggestions"}
              </Button>
            )}
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
