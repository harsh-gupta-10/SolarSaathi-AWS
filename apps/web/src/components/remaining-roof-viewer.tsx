"use client";

import dynamic from "next/dynamic";
import { Component, useEffect, useState, type ReactNode } from "react";
import { Compass, Maximize2, Minus, Plus, RotateCcw, RotateCw } from "lucide-react";
import { Button } from "@solarsaathi/ui";
import type { DesignsResponse, DesignCandidate } from "../lib/designs-api";
import type { ViewCommand } from "./roof-layout-scene";

const RemainingRoofScene = dynamic(() => import("./remaining-roof-scene"), {
  ssr: false, loading: () => <p className="design-viewer-loading" role="status">Loading 3D concept…</p>,
});

function supportsWebGl(): boolean {
  try { const canvas = document.createElement("canvas"); return Boolean(canvas.getContext("webgl2") || canvas.getContext("webgl")); }
  catch { return false; }
}

class SceneBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <p className="design-viewer-loading" role="status">
    3D rendering stopped on this device. Use Plan or Text view for the same modeled geometry.</p> : this.props.children; }
}

function PlanView({ geometry, placement }: { geometry: DesignsResponse["geometry"]; placement?: DesignCandidate["placement"] }) {
  const points = geometry.segments.flatMap(item => item.corners);
  if (!points.length) return <p className="design-viewer-loading">No roof outline is available for this assessment. Use Text view for the measured area and limitations.</p>;
  const minX = Math.min(...points.map(point => point.x)), maxX = Math.max(...points.map(point => point.x));
  const minZ = Math.min(...points.map(point => point.z)), maxZ = Math.max(...points.map(point => point.z));
  const span = Math.max(maxX - minX, maxZ - minZ, 1), pad = span * 0.16;
  const coords = (corners: readonly { x: number; z: number }[]) => corners.map(point => `${point.x},${-point.z}`).join(" ");
  return <svg className="design-plan-svg" viewBox={`${minX - pad} ${-maxZ - pad} ${maxX - minX + 2 * pad} ${maxZ - minZ + 2 * pad}`}
    preserveAspectRatio="xMidYMid meet" role="img" aria-label={`Schematic roof plan with ${geometry.panels.length} modeled solar panels, showing ${geometry.freeZones.length} of ${geometry.totalFreeZoneCount} free zones${placement ? " and the selected concept footprint" : ""}`}>
    <title>Top-down schematic of roof, solar panels, modeled free zones and selected footprint</title>
    {geometry.segments.map(item => <polygon key={item.segmentId} points={coords(item.corners)} fill="#91b399"
      stroke="#d7e8ce" strokeWidth={span * 0.008} />)}
    {geometry.freeZones.map(item => <polygon key={item.zoneId} points={coords(item.corners)} fill="#c0ce8d"
      stroke="#e9df91" strokeWidth={span * 0.006} />)}
    {geometry.panels.map(item => <polygon key={item.panelId} points={coords(item.corners)} fill="#193f58"
      stroke="#ddba65" strokeWidth={span * 0.004} />)}
    {placement && <polygon points={coords(placement.corners)} fill="#e8a25d" fillOpacity="0.85"
      stroke="#ffedb6" strokeWidth={span * 0.012} />}
    <text x={maxX + pad * 0.6} y={-maxZ} textAnchor="middle" fill="#e3eee3" fontSize={span * 0.08} fontWeight="700">N</text>
  </svg>;
}

function TextView({ response, candidate }: { response: DesignsResponse; candidate?: DesignCandidate }) {
  const { planning, geometry } = response;
  return <div className="design-text-view"><h3>Modeled roof summary</h3>
    <dl><div><dt>Confirmed roof area</dt><dd>{planning.roofAreaSquareMeters.toFixed(1)} m²</dd></div>
      <div><dt>Solar panels in this plan</dt><dd>{response.system.panelCount}</dd></div>
      <div><dt>Modeled free zones</dt><dd>{geometry.totalFreeZoneCount}{geometry.totalFreeZoneCount > geometry.freeZones.length ? ` (${geometry.freeZones.length} shown)` : ""}</dd></div>
      <div><dt>Remaining projected area</dt><dd>{planning.remainingProjectedAreaSquareMeters === null ? "Undetermined" : `${planning.remainingProjectedAreaSquareMeters.toFixed(1)} m²`}</dd></div></dl>
    {candidate && <div className="design-text-candidate"><h4>Selected concept: {candidate.title}</h4><p>{candidate.reason}</p>
      <p>{candidate.placement ? `Highlighted footprint: ${candidate.placement.areaSquareMeters.toFixed(1)} m² in zone ${candidate.placement.zoneId}.` : "No defensible placement is available for this concept."}</p></div>}
    <p>This is a planning diagram. It does not verify loading, drainage, waterproofing, access or local approval.</p>
  </div>;
}

export function RemainingRoofViewer({ response, candidate }: { response: DesignsResponse; candidate?: DesignCandidate }) {
  const hasGeometry = response.geometry.segments.length > 0;
  const shownZoneCount = response.geometry.freeZones.length;
  const totalZoneCount = response.geometry.totalFreeZoneCount;
  const [webGl, setWebGl] = useState<"checking" | "available" | "unavailable">("checking");
  const [mode, setMode] = useState<"3d" | "plan" | "text">(hasGeometry ? "plan" : "text");
  const [reducedMotion, setReducedMotion] = useState(false);
  const [command, setCommand] = useState<ViewCommand>({ action: "reset", sequence: 0 });
  useEffect(() => {
    const available = supportsWebGl(); setWebGl(available ? "available" : "unavailable");
    if (available && hasGeometry) setMode("3d");
    const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!media) return;
    const update = () => setReducedMotion(media.matches); update(); media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [hasGeometry]);
  const send = (action: ViewCommand["action"]) => setCommand(previous => ({ action, sequence: previous.sequence + 1 }));
  return <section className="design-viewer" aria-labelledby="design-viewer-title"><div className="design-viewer-head"><div><span>Deterministic concept</span>
    <h2 id="design-viewer-title">Explore the remaining roof</h2><p>One selected footprint at a time. Solar panels, modeled edge setback and service paths remain reserved.
      {totalZoneCount > shownZoneCount && ` Showing ${shownZoneCount} of ${totalZoneCount} modeled free zones; area totals include every zone.`}</p></div>
    <span className="design-viewer-tag">{response.planning.fitStatus === "UNDETERMINED" ? "Fit undetermined" : "Space planning only"}</span></div>
    <div className="design-viewer-shell"><div className="design-viewer-toolbar" role="group" aria-label="Rooftop concept view">
      <Button variant={mode === "3d" ? "default" : "outline"} size="sm" disabled={webGl !== "available" || !hasGeometry}
        aria-pressed={mode === "3d"} onClick={() => setMode("3d")}>3D view</Button>
      <Button variant={mode === "plan" ? "default" : "outline"} size="sm" disabled={!hasGeometry}
        aria-pressed={mode === "plan"} onClick={() => setMode("plan")}>Plan view</Button>
      <Button variant={mode === "text" ? "default" : "outline"} size="sm" aria-pressed={mode === "text"}
        onClick={() => setMode("text")}>Text view</Button>
      {webGl === "unavailable" && <span>3D unavailable on this device.</span>}
    </div>
      <div className="design-viewer-stage">{mode === "3d" && webGl === "available" && hasGeometry ?
        <div className="design-canvas-wrap">
          <SceneBoundary key={response.analysisId}><RemainingRoofScene geometry={response.geometry} placement={candidate?.placement}
            command={command} reducedMotion={reducedMotion} /></SceneBoundary></div> :
        mode === "plan" && hasGeometry ? <PlanView geometry={response.geometry} placement={candidate?.placement} /> :
          <TextView response={response} candidate={candidate} />}</div>
      <div className="design-viewer-footer"><div className="design-legend"><span><i className="design-legend-roof" /> Roof</span><span><i className="design-legend-panel" /> Solar</span>
        <span><i className="design-legend-free" /> Modeled free zone</span><span><i className="design-legend-placement" /> Selected concept</span></div>
        {mode === "3d" && webGl === "available" && <div className="design-viewer-controls" role="group" aria-label="3D camera controls">
          <Button variant="outline" size="sm" aria-label="Rotate left" onClick={() => send("left")}><RotateCcw size={16} /></Button>
          <Button variant="outline" size="sm" aria-label="Rotate right" onClick={() => send("right")}><RotateCw size={16} /></Button>
          <Button variant="outline" size="sm" aria-label="Zoom in" onClick={() => send("in")}><Plus size={16} /></Button>
          <Button variant="outline" size="sm" aria-label="Zoom out" onClick={() => send("out")}><Minus size={16} /></Button>
          <Button variant="outline" size="sm" aria-label="Top view" onClick={() => send("top")}><Compass size={16} /></Button>
          <Button variant="outline" size="sm" aria-label="Reset view" onClick={() => send("reset")}><Maximize2 size={16} /></Button>
        </div>}</div></div>
    <p className="design-viewer-limit">Concept geometry is schematic. {response.planning.fitStatus === "MODELED_APPROXIMATE" ? "Google roof bounds are approximate. " : ""}Area fit is not structural safety or permission to build.</p>
  </section>;
}
