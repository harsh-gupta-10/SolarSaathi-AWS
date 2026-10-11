"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { autoBuildingOutline, moveOutlineCorner, nudgeOutlineCorner, outlineAreaSquareMeters, outlineHull, type RoofOutline } from "@solarsaathi/calculations";
import type { NormalizedRoofV1, RoofPoint } from "@solarsaathi/types";

interface MapsPoint { lat(): number; lng(): number }
interface MapsListener { remove(): void }
interface MapsMap {
  addListener(name: string, callback: (event: { latLng?: MapsPoint }) => void): MapsListener;
  setCenter(point: { lat: number; lng: number }): void;
}
interface MapsCircle { setCenter(point: { lat: number; lng: number }): void; setMap(map: MapsMap | null): void }
interface MapsPolygon { setMap(map: MapsMap | null): void; setPath?(path: { lat: number; lng: number }[]): void }
interface MapsMarker {
  addListener(name: string, callback: (event: { latLng?: MapsPoint }) => void): MapsListener;
  setPosition(point: { lat: number; lng: number }): void;
  setMap(map: MapsMap | null): void;
}
interface MapsApi {
  Marker?: new (options: Record<string, unknown>) => MapsMarker;
  Map: new (element: HTMLElement, options: Record<string, unknown>) => MapsMap;
  Circle: new (options: Record<string, unknown>) => MapsCircle;
  Polygon: new (options: Record<string, unknown>) => MapsPolygon;
}
declare global { interface Window { google?: { maps: MapsApi } } }

let loader: Promise<MapsApi> | undefined;
function loadMaps(key: string): Promise<MapsApi> {
  if (window.google?.maps) return Promise.resolve(window.google.maps);
  if (loader) return loader;
  loader = new Promise((resolve, reject) => {
    const callback = `solarsaathiMapReady${Math.random().toString(36).slice(2)}`;
    const global = window as unknown as Record<string, unknown>;
    const script = document.createElement("script");
    let finished = false;
    const finish = () => {
      if (finished) return false;
      finished = true; window.clearTimeout(timeout); delete global[callback];
      return true;
    };
    const fail = (message: string) => {
      if (!finish()) return;
      loader = undefined; script.remove(); reject(new Error(message));
    };
    const timeout = window.setTimeout(() => fail("Google Maps took too long to load."), 15_000);
    global[callback] = () => {
      if (!finish()) return;
      if (window.google?.maps) resolve(window.google.maps);
      else { loader = undefined; script.remove(); reject(new Error("Google Maps did not initialize.")); }
    };
    script.onerror = () => fail("Google Maps could not load.");
    script.async = true;
    script.src = `https://maps.googleapis.com/maps/api/js?${new URLSearchParams({ key, loading: "async", v: "weekly", callback, region: "IN" })}`;
    document.head.append(script);
  });
  return loader;
}

const toMapPoint = (point: RoofPoint) => ({ lat: point.latitude, lng: point.longitude });

/** Beyond this distance between the tap and Google's building centre, ask the user to double-check the building. */
const FAR_FROM_TAP_METERS = 20;

function distanceMeters(a: RoofPoint, b: RoofPoint): number {
  const radians = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * radians, dLng = (b.longitude - a.longitude) * radians;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * radians) * Math.cos(b.latitude * radians) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

const QUALITY_LABEL: Record<NonNullable<NormalizedRoofV1["imageryQuality"]>, string> = {
  HIGH: "high", MEDIUM: "medium", BASE: "basic",
};

const NUDGE_METERS = 1;
const CORNER_NAMES = ["Corner 1 (starts south-west)", "Corner 2 (starts south-east)", "Corner 3 (starts north-east)", "Corner 4 (starts north-west)"];

export function SatelliteBuildingMap({ apiKey, center, point, deviceLocation, roof, outline: userOutline, onOutlineChange, onPointChange }: {
  apiKey: string; center: RoofPoint; point: RoofPoint; deviceLocation?: { point: RoofPoint; accuracyMeters: number };
  /** The returned Google Solar building preview. Its bounding box is the automatic starting outline. */
  roof?: NormalizedRoofV1;
  /** The outline the user adjusted, if any. Without it the automatic outline is shown. */
  outline?: RoofOutline;
  /** Called with the adjusted outline, or undefined when the user resets to the automatic one. Omit to hide editing. */
  onOutlineChange?: (outline: RoofOutline | undefined) => void;
  onPointChange: (point: RoofPoint) => void;
}) {
  const roofCenter = roof?.center;
  const automatic = useMemo(() => roof ? autoBuildingOutline(roof) : undefined, [roof]);
  const outline = userOutline ?? automatic;
  const adjusted = Boolean(userOutline);
  const editable = Boolean(onOutlineChange && outline);
  const outlineChangeRef = useRef(onOutlineChange);
  useEffect(() => { outlineChangeRef.current = onOutlineChange; }, [onOutlineChange]);
  const [corner, setCorner] = useState(0);
  const [announcement, setAnnouncement] = useState("");
  const outlineArea = outline ? Math.round(outlineAreaSquareMeters(outline)) : undefined;
  const commit = (next: RoofOutline, index: number) => {
    outlineChangeRef.current?.(next);
    setAnnouncement(`${CORNER_NAMES[index].split(" (")[0]} moved. Outline area is about ${Math.round(outlineAreaSquareMeters(next))} square metres.`);
  };
  const tapDistance = roofCenter ? distanceMeters(point, roofCenter) : undefined;
  const elementRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapsMap | null>(null);
  const circleRef = useRef<MapsCircle | null>(null);
  const roofCircleRef = useRef<MapsCircle | null>(null);
  const deviceCircleRef = useRef<MapsCircle | null>(null);
  const accuracyCircleRef = useRef<MapsCircle | null>(null);
  const boundsRef = useRef<MapsPolygon | null>(null);
  const markersRef = useRef<MapsMarker[]>([]);
  const changeRef = useRef(onPointChange);
  const centerRef = useRef(center);
  const pointRef = useRef(point);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [loadAttempt, setLoadAttempt] = useState(0);
  useEffect(() => { changeRef.current = onPointChange; }, [onPointChange]);
  useEffect(() => { centerRef.current = center; mapRef.current?.setCenter(toMapPoint(center)); }, [center]);
  useEffect(() => { pointRef.current = point; circleRef.current?.setCenter(toMapPoint(point)); }, [point]);
  useEffect(() => {
    let active = true;
    let listener: MapsListener | undefined;
    setStatus("loading");
    void loadMaps(apiKey).then(maps => {
      if (!active || !elementRef.current) return;
      // tilt/heading 0 keeps straight-down imagery: 45° oblique tiles shift roofs away from their ground outline.
      const map = new maps.Map(elementRef.current, { center: toMapPoint(centerRef.current), zoom: 20, mapTypeId: "satellite",
        tilt: 0, heading: 0, rotateControl: false, mapTypeControl: false, streetViewControl: false, fullscreenControl: false, zoomControl: true,
        scaleControl: true, keyboardShortcuts: true, clickableIcons: false, gestureHandling: "cooperative" });
      const solarColor = getComputedStyle(elementRef.current).getPropertyValue("--solar").trim() || "#e8b44b";
      const circle = new maps.Circle({ map, center: toMapPoint(pointRef.current), radius: 4, strokeColor: solarColor, strokeWeight: 3,
        strokeOpacity: 1, fillColor: solarColor, fillOpacity: 0.45, clickable: false });
      mapRef.current = map;
      circleRef.current = circle;
      listener = map.addListener("click", event => {
        if (event.latLng) changeRef.current({ latitude: event.latLng.lat(), longitude: event.latLng.lng() });
      });
      setStatus("ready");
    }).catch(() => { if (active) setStatus("error"); });
    return () => { active = false; listener?.remove(); circleRef.current?.setMap(null); roofCircleRef.current?.setMap(null);
      deviceCircleRef.current?.setMap(null); accuracyCircleRef.current?.setMap(null); boundsRef.current?.setMap(null);
      markersRef.current.forEach(marker => marker.setMap(null)); markersRef.current = [];
      circleRef.current = null; roofCircleRef.current = null; deviceCircleRef.current = null;
      accuracyCircleRef.current = null; boundsRef.current = null; mapRef.current = null; };
    // The map instance persists while the selected candidate changes.
  }, [apiKey, loadAttempt]);
  useEffect(() => {
    deviceCircleRef.current?.setMap(null); accuracyCircleRef.current?.setMap(null);
    deviceCircleRef.current = null; accuracyCircleRef.current = null;
    const map = mapRef.current;
    const maps = window.google?.maps;
    if (!map || !maps || !deviceLocation || status !== "ready") return;
    const blue = "#2563eb";
    accuracyCircleRef.current = new maps.Circle({ map, center: toMapPoint(deviceLocation.point),
      radius: Math.max(deviceLocation.accuracyMeters, 3), strokeColor: blue, strokeWeight: 1,
      strokeOpacity: 0.7, fillColor: blue, fillOpacity: 0.11, clickable: false });
    deviceCircleRef.current = new maps.Circle({ map, center: toMapPoint(deviceLocation.point), radius: 3,
      strokeColor: "#ffffff", strokeWeight: 2, strokeOpacity: 1, fillColor: blue, fillOpacity: 1, clickable: false });
    return () => { deviceCircleRef.current?.setMap(null); accuracyCircleRef.current?.setMap(null); };
  }, [deviceLocation, status]);
  useEffect(() => {
    roofCircleRef.current?.setMap(null);
    roofCircleRef.current = null;
    const map = mapRef.current;
    const maps = window.google?.maps;
    if (!map || !maps || !elementRef.current || status !== "ready") return;
    const primary = getComputedStyle(elementRef.current).getPropertyValue("--primary").trim() || "#12633f";
    if (roofCenter) {
      roofCircleRef.current = new maps.Circle({ map, center: toMapPoint(roofCenter), radius: 1.5,
        strokeColor: primary, strokeWeight: 3, strokeOpacity: 1, fillColor: primary, fillOpacity: 0.35, clickable: false });
      if (typeof (map as unknown as { panTo?: (point: { lat: number; lng: number }) => void }).panTo === "function") {
        (map as unknown as { panTo: (point: { lat: number; lng: number }) => void }).panTo(toMapPoint(roofCenter));
      }
    }
    return () => { roofCircleRef.current?.setMap(null); };
  }, [roofCenter, status]);
  // The outline polygon (its convex hull, so a crossed quad still draws cleanly) with a draggable handle per corner.
  useEffect(() => {
    boundsRef.current?.setMap(null); boundsRef.current = null;
    markersRef.current.forEach(marker => marker.setMap(null)); markersRef.current = [];
    const map = mapRef.current;
    const maps = window.google?.maps;
    if (!map || !maps || !elementRef.current || status !== "ready" || !outline) return;
    const primary = getComputedStyle(elementRef.current).getPropertyValue("--primary").trim() || "#12633f";
    const hullPath = (corners: readonly RoofPoint[]) => outlineHull(corners).map(toMapPoint);
    const polygon = new maps.Polygon({ map, paths: hullPath(outline), strokeColor: primary,
      strokeWeight: 3, strokeOpacity: 1, fillColor: primary, fillOpacity: 0.16, clickable: false });
    boundsRef.current = polygon;
    if (editable && maps.Marker) {
      markersRef.current = outline.map((corner, index) => {
        const marker = new maps.Marker!({ map, position: toMapPoint(corner), draggable: true, title: `${CORNER_NAMES[index]}: drag to adjust the outline`,
          label: String(index + 1) });
        const preview = (event: { latLng?: MapsPoint }) => {
          if (!event.latLng) return;
          const moved = moveOutlineCorner(outline, index, { latitude: event.latLng.lat(), longitude: event.latLng.lng() }, roofCenter);
          polygon.setPath?.(hullPath(moved));
        };
        marker.addListener("drag", preview);
        marker.addListener("dragend", event => {
          if (!event.latLng) return;
          const moved = moveOutlineCorner(outline, index, { latitude: event.latLng.lat(), longitude: event.latLng.lng() }, roofCenter);
          if (moved === outline) { marker.setPosition(toMapPoint(corner)); polygon.setPath?.(hullPath(outline)); return; }
          commit(moved, index);
        });
        return marker;
      });
    }
    return () => { polygon.setMap(null); markersRef.current.forEach(marker => marker.setMap(null)); markersRef.current = []; boundsRef.current = null; };
  }, [outline, editable, status, roofCenter]);
  return <div>
  <div className="relative min-h-72 overflow-hidden rounded-xl border bg-muted">
    <div ref={elementRef} className="absolute inset-0" role="region" aria-label="Satellite map for selecting your building" />
    {status === "loading" && <p className="absolute inset-0 flex items-center justify-center bg-muted p-6 text-center" role="status">Loading satellite map…</p>}
    {status === "error" && <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-muted p-6 text-center" role="status">
      <p>Satellite imagery could not load. Select the address result or enter coordinates below.</p>
      <button type="button" className="rounded-md border border-current px-4 py-2 font-medium underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2" onClick={() => setLoadAttempt(value => value + 1)}>Retry satellite map</button>
    </div>}
    {status === "ready" && <div className="pointer-events-none absolute bottom-3 left-3 right-3 flex flex-wrap gap-x-3 gap-y-1 rounded-md bg-background/95 px-3 py-2 text-xs font-medium shadow-sm" aria-hidden="true">
      <span>● Amber: selected house</span>{roofCenter && <span>● Green dot: detected building center</span>}{deviceLocation && <span>● Blue: device location</span>}{outline && <span>▱ Green: approximate building outline{editable ? ", numbered corners can be dragged" : ""}</span>}
    </div>}
  </div>
  {roof && outline && <div className="mt-2 space-y-2 text-sm text-muted-foreground">
    <p>
      <strong className="text-foreground">{adjusted ? "Outline adjusted by you" : "Automatic outline (approximate)"}</strong>
      {outlineArea !== undefined && <> · about {outlineArea} m² on the ground</>}
      {roof.imageryDate || roof.imageryQuality ? ` · imagery ${[roof.imageryDate, roof.imageryQuality && `${QUALITY_LABEL[roof.imageryQuality]} quality`].filter(Boolean).join(", ")}` : ""}
    </p>
    <p>
      {adjusted
        ? "You moved the corners to match the house on the photo."
        : "The automatic outline is Google's building box, which always contains the building but can be larger than the house."}
      {" "}It may sit a few metres off the satellite photo, which can be from a different date. It is not a survey.
      {editable && " Drag the numbered corners, or use the controls below, to trace your house."}
      {" "}Your outline changes the 3D view only; system sizing still uses Google&apos;s modeled roof or your measurements.
    </p>
    {editable && outline && <fieldset className="flex flex-wrap items-end gap-3 rounded-lg border p-3">
      <legend className="px-1 text-xs font-medium text-foreground">Adjust the outline without dragging</legend>
      <label className="grid gap-1 text-xs font-medium text-foreground">Corner to move
        <select className="h-11 rounded-md border bg-background px-2 text-sm font-normal" value={corner} onChange={event => setCorner(Number(event.target.value))}>
          {CORNER_NAMES.map((name, index) => <option key={name} value={index}>{name}</option>)}
        </select>
      </label>
      <div className="flex flex-wrap gap-2" role="group" aria-label={`Move ${CORNER_NAMES[corner].split(" (")[0]}`}>
        {([["North", 0, NUDGE_METERS], ["South", 0, -NUDGE_METERS], ["West", -NUDGE_METERS, 0], ["East", NUDGE_METERS, 0]] as const).map(([label, east, north]) =>
          <button key={label} type="button" className="min-h-11 rounded-md border px-3 text-sm font-medium hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
            onClick={() => { const moved = nudgeOutlineCorner(outline, corner, east, north, roofCenter); if (moved !== outline) commit(moved, corner); else setAnnouncement("That move would make the outline too small or too large, so it was not applied."); }}>
            {label} {NUDGE_METERS} m
          </button>)}
      </div>
      <button type="button" disabled={!adjusted} className="min-h-11 rounded-md border px-3 text-sm font-medium hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
        onClick={() => { outlineChangeRef.current?.(undefined); setAnnouncement("Outline reset to the automatic outline."); }}>
        Reset to automatic outline
      </button>
    </fieldset>}
    <p className="sr-only" role="status" aria-live="polite">{announcement}</p>
  </div>}
  {tapDistance !== undefined && tapDistance > FAR_FROM_TAP_METERS && <p className="mt-2 text-sm font-medium" role="status">
    The building Google found is about {Math.round(tapDistance)} m from where you tapped. Check that it is your house before confirming, or tap closer to the middle of your roof.
  </p>}
  </div>;
}
