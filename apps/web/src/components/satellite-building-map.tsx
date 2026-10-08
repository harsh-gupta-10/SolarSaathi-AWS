"use client";

import { useEffect, useRef, useState } from "react";
import type { RoofBounds, RoofPoint } from "@solarsaathi/types";

interface MapsPoint { lat(): number; lng(): number }
interface MapsListener { remove(): void }
interface MapsMap {
  addListener(name: string, callback: (event: { latLng?: MapsPoint }) => void): MapsListener;
  setCenter(point: { lat: number; lng: number }): void;
}
interface MapsCircle { setCenter(point: { lat: number; lng: number }): void; setMap(map: MapsMap | null): void }
interface MapsRectangle { setMap(map: MapsMap | null): void }
interface MapsApi {
  Map: new (element: HTMLElement, options: Record<string, unknown>) => MapsMap;
  Circle: new (options: Record<string, unknown>) => MapsCircle;
  Rectangle: new (options: Record<string, unknown>) => MapsRectangle;
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
    const finish = () => { delete global[callback]; };
    global[callback] = () => {
      finish();
      if (window.google?.maps) resolve(window.google.maps);
      else { loader = undefined; reject(new Error("Google Maps did not initialize.")); }
    };
    script.onerror = () => { finish(); loader = undefined; script.remove(); reject(new Error("Google Maps could not load.")); };
    script.async = true;
    script.src = `https://maps.googleapis.com/maps/api/js?${new URLSearchParams({ key, loading: "async", v: "weekly", callback, region: "IN" })}`;
    document.head.append(script);
  });
  return loader;
}

const toMapPoint = (point: RoofPoint) => ({ lat: point.latitude, lng: point.longitude });

export function SatelliteBuildingMap({ apiKey, center, point, roofCenter, roofBounds, onPointChange }: {
  apiKey: string; center: RoofPoint; point: RoofPoint; roofCenter?: RoofPoint; roofBounds?: RoofBounds;
  onPointChange: (point: RoofPoint) => void;
}) {
  const elementRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapsMap | null>(null);
  const circleRef = useRef<MapsCircle | null>(null);
  const roofCircleRef = useRef<MapsCircle | null>(null);
  const boundsRef = useRef<MapsRectangle | null>(null);
  const changeRef = useRef(onPointChange);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  useEffect(() => { changeRef.current = onPointChange; }, [onPointChange]);
  useEffect(() => {
    let active = true;
    let listener: MapsListener | undefined;
    void loadMaps(apiKey).then(maps => {
      if (!active || !elementRef.current) return;
      const map = new maps.Map(elementRef.current, { center: toMapPoint(center), zoom: 20, mapTypeId: "satellite",
        mapTypeControl: false, streetViewControl: false, fullscreenControl: false, zoomControl: true,
        scaleControl: true, keyboardShortcuts: true, clickableIcons: false, gestureHandling: "cooperative" });
      const solarColor = getComputedStyle(elementRef.current).getPropertyValue("--solar").trim() || "#e8b44b";
      const circle = new maps.Circle({ map, center: toMapPoint(point), radius: 4, strokeColor: solarColor, strokeWeight: 3,
        strokeOpacity: 1, fillColor: solarColor, fillOpacity: 0.45, clickable: false });
      mapRef.current = map;
      circleRef.current = circle;
      listener = map.addListener("click", event => {
        if (event.latLng) changeRef.current({ latitude: event.latLng.lat(), longitude: event.latLng.lng() });
      });
      setStatus("ready");
    }).catch(() => { if (active) setStatus("error"); });
    return () => { active = false; listener?.remove(); circleRef.current?.setMap(null); roofCircleRef.current?.setMap(null);
      boundsRef.current?.setMap(null); circleRef.current = null; roofCircleRef.current = null; boundsRef.current = null; mapRef.current = null; };
    // The map instance persists while the selected candidate changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey]);
  useEffect(() => { mapRef.current?.setCenter(toMapPoint(center)); }, [center]);
  useEffect(() => { circleRef.current?.setCenter(toMapPoint(point)); }, [point]);
  useEffect(() => {
    roofCircleRef.current?.setMap(null); boundsRef.current?.setMap(null);
    roofCircleRef.current = null; boundsRef.current = null;
    const map = mapRef.current;
    const maps = window.google?.maps;
    if (!map || !maps || !elementRef.current || status !== "ready") return;
    const primary = getComputedStyle(elementRef.current).getPropertyValue("--primary").trim() || "#12633f";
    if (roofCenter) roofCircleRef.current = new maps.Circle({ map, center: toMapPoint(roofCenter), radius: 5,
      strokeColor: primary, strokeWeight: 3, strokeOpacity: 1, fillColor: primary, fillOpacity: 0.35, clickable: false });
    if (roofBounds) boundsRef.current = new maps.Rectangle({ map, bounds: {
      south: roofBounds.southwest.latitude, west: roofBounds.southwest.longitude,
      north: roofBounds.northeast.latitude, east: roofBounds.northeast.longitude,
    }, strokeColor: primary, strokeWeight: 2, strokeOpacity: 0.9, fillOpacity: 0, clickable: false });
    return () => { roofCircleRef.current?.setMap(null); boundsRef.current?.setMap(null); };
  }, [roofCenter, roofBounds, status]);
  return <div className="relative min-h-72 overflow-hidden rounded-xl border bg-muted">
    <div ref={elementRef} className="absolute inset-0" role="region" aria-label="Satellite map for selecting your building" />
    {status === "loading" && <p className="absolute inset-0 flex items-center justify-center bg-muted p-6 text-center" role="status">Loading satellite map…</p>}
    {status === "error" && <p className="absolute inset-0 flex items-center justify-center bg-muted p-6 text-center" role="status">Satellite imagery could not load. Select the address result or enter coordinates below.</p>}
  </div>;
}
