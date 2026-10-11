"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { getRoofLayoutAssumptionsV1, googleBuildingOutline } from "@solarsaathi/calculations";
import type { NormalizedRoofV1, RoofPoint } from "@solarsaathi/types";

interface MapsPoint { lat(): number; lng(): number }
interface MapsListener { remove(): void }
interface MapsMap {
  addListener(name: string, callback: (event: { latLng?: MapsPoint }) => void): MapsListener;
  setCenter(point: { lat: number; lng: number }): void;
}
interface MapsCircle { setCenter(point: { lat: number; lng: number }): void; setMap(map: MapsMap | null): void }
interface MapsPolygon { setMap(map: MapsMap | null): void }
interface MapsApi {
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

/** The modeled outline from Google roof planes, or Google's whole-building box when no plane can be modeled. */
function buildingOutline(roof: NormalizedRoofV1): { path: RoofPoint[]; kind: "OUTLINE" | "BOUNDS" } | undefined {
  try {
    const outline = googleBuildingOutline(roof, getRoofLayoutAssumptionsV1(roof));
    if (outline) return { path: outline, kind: "OUTLINE" };
  } catch { /* Unsupported geometry falls back to the provider bounds below. */ }
  if (!roof.bounds) return undefined;
  const { southwest, northeast } = roof.bounds;
  return { kind: "BOUNDS", path: [southwest, { latitude: southwest.latitude, longitude: northeast.longitude }, northeast,
    { latitude: northeast.latitude, longitude: southwest.longitude }] };
}

const QUALITY_LABEL: Record<NonNullable<NormalizedRoofV1["imageryQuality"]>, string> = {
  HIGH: "high", MEDIUM: "medium", BASE: "basic",
};

export function SatelliteBuildingMap({ apiKey, center, point, deviceLocation, roof, onPointChange }: {
  apiKey: string; center: RoofPoint; point: RoofPoint; deviceLocation?: { point: RoofPoint; accuracyMeters: number };
  /** The returned Google Solar building preview, drawn as an approximate outline. */
  roof?: NormalizedRoofV1;
  onPointChange: (point: RoofPoint) => void;
}) {
  const roofCenter = roof?.center;
  const outline = useMemo(() => roof ? buildingOutline(roof) : undefined, [roof]);
  const tapDistance = roofCenter ? distanceMeters(point, roofCenter) : undefined;
  const elementRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapsMap | null>(null);
  const circleRef = useRef<MapsCircle | null>(null);
  const roofCircleRef = useRef<MapsCircle | null>(null);
  const deviceCircleRef = useRef<MapsCircle | null>(null);
  const accuracyCircleRef = useRef<MapsCircle | null>(null);
  const boundsRef = useRef<MapsPolygon | null>(null);
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
    roofCircleRef.current?.setMap(null); boundsRef.current?.setMap(null);
    roofCircleRef.current = null; boundsRef.current = null;
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
    if (outline) boundsRef.current = new maps.Polygon({ map, paths: outline.path.map(toMapPoint), strokeColor: primary,
      strokeWeight: 3, strokeOpacity: 1, fillColor: primary, fillOpacity: 0.16, clickable: false });
    return () => { roofCircleRef.current?.setMap(null); boundsRef.current?.setMap(null); };
  }, [roofCenter, outline, status]);
  return <div>
  <div className="relative min-h-72 overflow-hidden rounded-xl border bg-muted">
    <div ref={elementRef} className="absolute inset-0" role="region" aria-label="Satellite map for selecting your building" />
    {status === "loading" && <p className="absolute inset-0 flex items-center justify-center bg-muted p-6 text-center" role="status">Loading satellite map…</p>}
    {status === "error" && <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-muted p-6 text-center" role="status">
      <p>Satellite imagery could not load. Select the address result or enter coordinates below.</p>
      <button type="button" className="rounded-md border border-current px-4 py-2 font-medium underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2" onClick={() => setLoadAttempt(value => value + 1)}>Retry satellite map</button>
    </div>}
    {status === "ready" && <div className="pointer-events-none absolute bottom-3 left-3 right-3 flex flex-wrap gap-x-3 gap-y-1 rounded-md bg-background/95 px-3 py-2 text-xs font-medium shadow-sm" aria-hidden="true">
      <span>● Amber: selected house</span>{roofCenter && <span>● Green dot: detected building center</span>}{deviceLocation && <span>● Blue: device location</span>}{outline && <span>▱ Green: approximate building outline</span>}
    </div>}
  </div>
  {roof && outline && <p className="mt-2 text-sm text-muted-foreground">
    {outline.kind === "OUTLINE"
      ? "The green outline is modeled from Google Solar roof planes"
      : "The green box is Google's approximate building bounds"}
    {roof.imageryDate || roof.imageryQuality ? ` (imagery ${[roof.imageryDate, roof.imageryQuality && `${QUALITY_LABEL[roof.imageryQuality]} quality`].filter(Boolean).join(", ")})` : ""}.
    {" "}It is approximate and may sit a few metres off the satellite photo, which can be from a different date. It is not a survey.
  </p>}
  {tapDistance !== undefined && tapDistance > FAR_FROM_TAP_METERS && <p className="mt-2 text-sm font-medium" role="status">
    The building Google found is about {Math.round(tapDistance)} m from where you tapped. Check that it is your house before confirming, or tap closer to the middle of your roof.
  </p>}
  </div>;
}
