"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { CheckCircle2, LocateFixed, MapPin, Ruler, ShieldCheck } from "lucide-react";
import { Button, Input, Label } from "@solarsaathi/ui";
import type { GeocodeCandidate, ManualRoofMeasurements, RoofConfirmationResponse, RoofPoint, RoofPreviewResponse } from "@solarsaathi/types";
import { useAuth } from "../auth/auth-provider";
import { ADDRESS_DRAFT_KEY, readAddressDraft } from "../lib/address-draft";
import { getPublicEnvironment } from "../lib/env";
import { roofApi, RoofRequestError } from "../lib/roof-api";
import { brokerApi } from "../lib/broker-api";
import { AddressForm } from "./address-form";
import { SatelliteBuildingMap } from "./satellite-building-map";
import { RoofLayoutViewer } from "./roof-layout-viewer";
import { SystemDesigner } from "./system-designer";

type Busy = "property" | "geocode" | "insights" | "building" | "roof" | "manual";
const parseNumber = (value: string, min: number, max: number): number | undefined => {
  const number = Number(value);
  return value.trim() && Number.isFinite(number) && number >= min && number <= max ? number : undefined;
};
const errorText = (error: unknown) => error instanceof RoofRequestError ? error.message : "This step could not be completed. Try again.";

export function AnalyzeStart() {
  const { status, profile } = useAuth();
  const [address, setAddress] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [customerName, setCustomerName] = useState("");
  const [propertyId, setPropertyId] = useState<string>();
  const [candidates, setCandidates] = useState<GeocodeCandidate[]>([]);
  const [selected, setSelected] = useState<GeocodeCandidate>();
  const [point, setPoint] = useState<RoofPoint>();
  const [mapCenter, setMapCenter] = useState<RoofPoint>();
  const [deviceLocation, setDeviceLocation] = useState<{ point: RoofPoint; accuracyMeters: number }>();
  const [locationStatus, setLocationStatus] = useState<"idle" | "locating" | "ready" | "error">("idle");
  const [locationMessage, setLocationMessage] = useState<string>();
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [preview, setPreview] = useState<RoofPreviewResponse>();
  const [buildingConfirmed, setBuildingConfirmed] = useState(false);
  const [result, setResult] = useState<RoofConfirmationResponse>();
  const [manualMode, setManualMode] = useState(false);
  const [manual, setManual] = useState({ area: "", length: "", width: "", pitch: "", azimuth: "" });
  const [busy, setBusy] = useState<Busy>();
  const [error, setError] = useState<string>();
  const [existingLookup, setExistingLookup] = useState(false);
  const [existingLookupError, setExistingLookupError] = useState<string>();
  const request = useRef<AbortController | null>(null);
  const propertyLookup = useRef<AbortController | null>(null);
  const locationAttempt = useRef(0);
  const account = status === "signedIn" && profile ? `${profile.userId}:${profile.organizationId ?? ""}:${profile.role}` : undefined;
  const accountRef = useRef(account);
  const mapKey = getPublicEnvironment().NEXT_PUBLIC_GOOGLE_MAPS_KEY;
  useEffect(() => { try { setAddress(readAddressDraft(sessionStorage)); } catch { setAddress(""); } }, []);
  useEffect(() => () => { request.current?.abort(); locationAttempt.current += 1; }, []);
  useEffect(() => {
    if (status === "loading" || accountRef.current === account) return;
    accountRef.current = account;
    request.current?.abort(); request.current = null;
    propertyLookup.current?.abort(); propertyLookup.current = null;
    locationAttempt.current += 1;
    try { setAddress(readAddressDraft(sessionStorage)); } catch { setAddress(""); }
    setEditing(false); setCustomerName("");
    setBusy(undefined); setError(undefined); setPropertyId(undefined); setCandidates([]);
    setExistingLookup(false); setExistingLookupError(undefined);
    setSelected(undefined); setPoint(undefined); setMapCenter(undefined); setDeviceLocation(undefined);
    setLocationStatus("idle"); setLocationMessage(undefined); setPreview(undefined);
    setBuildingConfirmed(false); setResult(undefined); setManualMode(false);
  }, [account, status]);
  useEffect(() => {
    if (!account) return;
    const linkedPropertyId = new URLSearchParams(window.location.search).get("propertyId");
    if (!linkedPropertyId) return;
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(linkedPropertyId)) {
      setExistingLookupError("This property link is invalid. Open the property from your workspace again."); return;
    }
    const controller = new AbortController(); propertyLookup.current = controller;
    setExistingLookup(true); setExistingLookupError(undefined);
    void brokerApi.property(linkedPropertyId, controller.signal).then(property => {
      if (controller.signal.aborted) return;
      setAddress(property.address); setPropertyId(property.propertyId); setEditing(false); setCustomerName("");
    }).catch(failure => {
      if (!controller.signal.aborted) setExistingLookupError(errorText(failure));
    }).finally(() => { if (!controller.signal.aborted) setExistingLookup(false); });
    return () => controller.abort();
  }, [account]);

  function reset() {
    request.current?.abort(); request.current = null;
    propertyLookup.current?.abort(); propertyLookup.current = null;
    locationAttempt.current += 1;
    setBusy(undefined); setError(undefined); setExistingLookup(false); setExistingLookupError(undefined); setPropertyId(undefined); setCandidates([]);
    setSelected(undefined); setPoint(undefined); setMapCenter(undefined); setDeviceLocation(undefined);
    setLocationStatus("idle"); setLocationMessage(undefined); setPreview(undefined);
    setBuildingConfirmed(false); setResult(undefined); setManualMode(false);
  }
  function clear() {
    reset();
    try { sessionStorage.removeItem(ADDRESS_DRAFT_KEY); setAddress(""); setEditing(false); }
    catch { setEditing(true); }
  }
  function choose(candidate: GeocodeCandidate) {
    request.current?.abort(); setBusy(undefined);
    locationAttempt.current += 1;
    setMapCenter(candidate.location); setDeviceLocation(undefined); setLocationStatus("idle"); setLocationMessage(undefined);
    setSelected(candidate); changePoint(candidate.location);
  }
  function changePoint(next: RoofPoint) {
    locationAttempt.current += 1;
    if (locationStatus === "locating") { setLocationStatus("idle"); setLocationMessage(undefined); }
    request.current?.abort(); setBusy(undefined);
    setPoint(next); setLatitude(next.latitude.toFixed(6)); setLongitude(next.longitude.toFixed(6));
    setPreview(undefined); setBuildingConfirmed(false); setResult(undefined); setError(undefined);
  }
  function run(action: Busy, task: (signal: AbortSignal) => Promise<void>) {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller; setBusy(action); setError(undefined);
    void task(controller.signal).catch(failure => { if (!controller.signal.aborted) setError(errorText(failure)); })
      .finally(() => { if (request.current === controller) { request.current = null; setBusy(undefined); } });
  }
  async function ensureProperty(signal: AbortSignal) {
    if (propertyId) return propertyId;
    if (!address || status !== "signedIn" || !profile) throw new RoofRequestError("SESSION_UNAVAILABLE", "Sign in and enter a property address first.");
    if (profile.role === "BROKER" && !customerName.trim()) throw new RoofRequestError("CUSTOMER_REQUIRED", "Enter the customer’s name before creating a broker property.");
    await roofApi.bootstrap(signal);
    const customerId = profile.role === "BROKER" ? await roofApi.createCustomer(customerName.trim(), signal) : undefined;
    const id = await roofApi.createProperty(address, customerId, signal);
    if (!signal.aborted) setPropertyId(id);
    return id;
  }
  function findBuilding() {
    run("property", async signal => {
      const id = await ensureProperty(signal);
      if (signal.aborted) return;
      setBusy("geocode");
      const data = await roofApi.geocode(id, signal);
      if (signal.aborted) return;
      setManualMode(false); setCandidates(data.candidates);
      if (data.candidates.length === 1) choose(data.candidates[0]);
      if (!data.candidates.length) setError("No address match was found. Check your address or enter roof measurements manually.");
    });
  }
  function startManual() {
    request.current?.abort(); setBusy(undefined); setError(undefined);
    locationAttempt.current += 1;
    setDeviceLocation(undefined); setLocationStatus("idle"); setLocationMessage(undefined);
    setManualMode(true); setCandidates([]); setSelected(undefined); setPreview(undefined); setResult(undefined);
  }
  function inspectAt(housePoint: RoofPoint) {
    if (!propertyId || !selected) return;
    run("insights", async signal => {
      const data = await roofApi.insights(propertyId, selected, housePoint, signal);
      if (!signal.aborted) { setPreview(data); setBuildingConfirmed(false); }
    });
  }
  function selectHouseOnMap(housePoint: RoofPoint) {
    changePoint(housePoint);
    inspectAt(housePoint);
  }
  function locateOnce() {
    const attempt = ++locationAttempt.current;
    setLocationMessage(undefined);
    setLocationStatus("locating");
    if (!navigator.geolocation) {
      setLocationStatus("error");
      setLocationMessage("Your browser cannot share its location. Select your house on the map or use coordinates.");
      return;
    }
    try {
      navigator.geolocation.getCurrentPosition(position => {
        if (attempt !== locationAttempt.current) return;
        const { latitude: lat, longitude: lng, accuracy } = position.coords;
        if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180 ||
          !Number.isFinite(accuracy) || accuracy < 0) {
          setLocationStatus("error");
          setLocationMessage("Your device returned an invalid location. Select your house on the map instead.");
          return;
        }
        const current = { latitude: lat, longitude: lng };
        request.current?.abort(); request.current = null; setBusy(undefined);
        setPreview(undefined); setBuildingConfirmed(false); setResult(undefined); setError(undefined);
        setDeviceLocation({ point: current, accuracyMeters: accuracy });
        setMapCenter(current); setLocationStatus("ready");
        setLocationMessage(`Device location shown in blue (accuracy about ${Math.round(accuracy)} m). Your house is selected separately.`);
      }, failure => {
        if (attempt !== locationAttempt.current) return;
        setLocationStatus("error");
        setLocationMessage(failure.code === 1 ? "Location permission was denied. Allow it in your browser settings, or select your house on the map." :
          failure.code === 3 ? "Finding your location timed out. Try again, or select your house on the map." :
            "Your device location is unavailable. Select your house on the map or use coordinates.");
      }, { enableHighAccuracy: true, maximumAge: 0, timeout: 10_000 });
    } catch {
      if (attempt !== locationAttempt.current) return;
      setLocationStatus("error");
      setLocationMessage("Your browser could not request location. Select your house on the map or use coordinates.");
    }
  }
  function confirmBuilding() {
    if (!propertyId || !preview) return;
    run("building", async signal => {
      const data = await roofApi.confirmBuilding(propertyId, preview.previewId, signal);
      if (!signal.aborted) { setPreview(data); setBuildingConfirmed(true); }
    });
  }
  function confirmRoof() {
    if (!propertyId || !preview || !buildingConfirmed) return;
    run("roof", async signal => {
      const data = await roofApi.confirmRoof(propertyId, preview.previewId, signal);
      if (!signal.aborted) setResult(data);
    });
  }
  function submitManual(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const area = parseNumber(manual.area, 0.000001, 100_000);
    const length = manual.length.trim() ? parseNumber(manual.length, 0.000001, 1_000) : undefined;
    const width = manual.width.trim() ? parseNumber(manual.width, 0.000001, 1_000) : undefined;
    const pitch = manual.pitch.trim() ? parseNumber(manual.pitch, 0, 75) : undefined;
    const azimuth = manual.azimuth.trim() ? parseNumber(manual.azimuth, 0, 360) : undefined;
    if (!area || Boolean(manual.length.trim()) !== Boolean(manual.width.trim()) ||
      (manual.length.trim() && !length) || (manual.width.trim() && !width) ||
      (manual.pitch.trim() && pitch === undefined) || (manual.azimuth.trim() && azimuth === undefined)) {
      setError("Enter a positive area up to 100,000 m². Supply both dimensions together; pitch must be 0–75° and orientation 0–360°.");
      return;
    }
    if (area && length && width) {
      const expectedArea = length * width / Math.cos((pitch ?? 0) * Math.PI / 180);
      if (area < expectedArea * 0.85 || area > expectedArea * 1.15) {
        setError("Roof area must be within 15% of length × width adjusted for pitch. Check the measurements or leave both dimensions blank.");
        return;
      }
    }
    const measurements: ManualRoofMeasurements = { roofAreaSquareMeters: area,
      ...(length && width ? { lengthMeters: length, widthMeters: width } : {}),
      ...(pitch !== undefined ? { pitchDegrees: pitch } : {}),
      ...(azimuth !== undefined ? { azimuthDegrees: azimuth } : {}) };
    run("manual", async signal => {
      const id = await ensureProperty(signal);
      if (signal.aborted) return;
      const data = await roofApi.confirmManualRoof(id, measurements, signal);
      if (!signal.aborted) setResult(data);
    });
  }
  const enabled = status === "signedIn" && !!profile && accountRef.current === account && !!address && !editing && !existingLookup && !existingLookupError;
  const visibleAddress = accountRef.current === account ? address : null;
  const visibleResult = enabled ? result : undefined;
  const activeStep = visibleResult || (enabled && (manualMode || buildingConfirmed)) ? 3 : enabled && (candidates.length || preview) ? 2 : 1;
  const mapReady = Boolean(mapKey && selected && point);
  return <>
    <div className="page-heading"><h1>Find your roof, then verify it.</h1><p>Choose the right building and check its measurements before saving an assessment.</p></div>
    <ol className="analysis-progress" aria-label="Roof analysis steps">
      <li aria-current={activeStep === 1 ? "step" : undefined}>1. Address</li>
      <li aria-current={activeStep === 2 ? "step" : undefined}>2. Building</li>
      <li aria-current={activeStep === 3 ? "step" : undefined}>3. Roof</li>
    </ol>
    <section className="workspace-start" aria-labelledby="address-draft-title"><MapPin className="start-icon" aria-hidden="true" /><h2 id="address-draft-title">Your property address</h2>
      {existingLookup && accountRef.current === account ? <p role="status">Loading the saved property…</p> : visibleAddress === null ? <p role="status">Loading your tab’s draft…</p> : visibleAddress && !editing ? <><p className="draft-address">{visibleAddress}</p><p className="muted">{propertyId ? "Saved property in your organization. The address was loaded from the backend." : "This is a browser tab draft until you start an assessment."}</p><div className="draft-actions"><Button variant="outline" onClick={() => { reset(); setEditing(true); }}>Edit address</Button><Button variant="ghost" onClick={clear}>Clear draft</Button></div></> : <AddressForm key={visibleAddress ?? ""} initialAddress={visibleAddress ?? ""} compact onSaved={value => { reset(); setAddress(value); setEditing(false); }} />}
      {profile?.role === "BROKER" && enabled && !propertyId && <div className="mt-5 max-w-md"><Label htmlFor="roof-customer-name">Customer name</Label><Input id="roof-customer-name" value={customerName} maxLength={120} onChange={event => setCustomerName(event.target.value)} /><p className="form-hint">A broker assessment must belong to a customer in your organization.</p></div>}
    </section>
    {existingLookupError && <div className="mt-4"><p role="alert" className="form-error">{existingLookupError}</p><Button type="button" variant="outline" className="mt-3" onClick={() => { reset(); setEditing(true); }}>Enter another address</Button></div>}
    {status !== "signedIn" && <div className="availability-note"><ShieldCheck aria-hidden="true" /><div><h2>Sign in to save a roof assessment</h2><p>{status === "unconfigured" ? "Account sign-in is not configured for this deployment. Your address remains a tab draft; no analysis has run." : "Your address remains a tab draft until your account is connected."}</p><div className="mt-4 flex flex-wrap gap-2">{status === "signedOut" && <Button asChild><Link href="/auth/sign-in">Sign in</Link></Button>}{(status === "signedOut" || status === "unconfigured") && <><Button asChild variant="outline"><Link href="/demo/roof-3d">Explore 3D demo</Link></Button><Button asChild variant="outline"><Link href="/demo/system-designer">Try system designer demo</Link></Button></>}</div></div></div>}
    {status !== "signedIn" && <p className="mt-4 text-sm text-muted-foreground"><Link href="/demo/roof-3d" className="font-medium text-primary underline underline-offset-4">Explore a sample 3D roof</Link> while live analysis is being configured.</p>}
    {enabled && !visibleResult && <section className="space-y-5" aria-label="Building and roof analysis">
      <div className="flex flex-wrap gap-3">
        {!manualMode && <Button onClick={findBuilding} disabled={!!busy}>{busy === "property" ? "Saving property…" : busy === "geocode" ? "Finding address…" : candidates.length ? "Search address again" : "Find my building"}</Button>}
        <Button variant="outline" disabled={!!busy} onClick={() => { if (manualMode) { setManualMode(false); setError(undefined); } else startManual(); }}>{manualMode ? "Use satellite lookup" : "Enter roof measurements manually"}</Button>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      {!manualMode && candidates.length > 0 && <div className="grid gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(19rem,1fr)]">
        <div className="space-y-3"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl">Select your building</h2>{mapReady && <Button variant="outline" onClick={locateOnce} disabled={locationStatus === "locating"} aria-label="Show my current location on the map"><LocateFixed aria-hidden="true" className="mr-2 size-4" />{locationStatus === "locating" ? "Finding your location…" : "Use my location"}</Button>}</div>
          {locationMessage && <p className={locationStatus === "error" ? "form-error" : "text-sm text-muted-foreground"} role={locationStatus === "error" ? "alert" : "status"}>{locationMessage}</p>}
          {mapReady ? <SatelliteBuildingMap apiKey={mapKey!} center={mapCenter ?? selected!.location} point={point!} deviceLocation={deviceLocation} roofCenter={preview?.roof.center} roofBounds={preview?.roof.bounds} onPointChange={selectHouseOnMap} /> : <div className="flex min-h-72 items-center justify-center rounded-xl border bg-muted p-6 text-center text-muted-foreground" role="status">{mapKey ? "Choose an address match to view satellite imagery." : "Satellite map is not configured. You can still select an address match and use coordinates."}</div>}
          {preview?.roof.center && <p className="text-sm text-muted-foreground">Google returned building center: {preview.roof.center.latitude.toFixed(6)}°, {preview.roof.center.longitude.toFixed(6)}°. Compare this with your selected point ({point?.latitude.toFixed(6)}°, {point?.longitude.toFixed(6)}°). {preview.roof.bounds ? "The green outline on the map is an approximate bounding box, not an exact roof shape." : "A roof outline was not provided."}</p>}
          {mapReady && preview?.roof.center && <p className="text-xs text-muted-foreground">Amber circle: your selected point. Green circle: Google building center.</p>}
          <p className="text-sm text-muted-foreground">Tap your house on the satellite map to load a Google Solar roof preview and approximate building overlay. The overlay is a bounding box, not a surveyed roof outline. You can also use the address point or coordinates.</p>
        </div>
        <div className="space-y-5 rounded-xl border bg-background p-5"><fieldset className="space-y-3"><legend className="mb-3 font-semibold">Address matches</legend>{candidates.map(item => <label key={item.placeId} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border p-3"><input type="radio" name="geocode-candidate" checked={selected?.placeId === item.placeId} onChange={() => choose(item)} className="mt-1" /><span><strong className="block font-medium">{item.address}</strong><small className="text-muted-foreground">{item.partialMatch ? "Partial match — verify carefully" : "Google Geocoding result"}</small></span></label>)}</fieldset>
          {selected && point && <><fieldset className="grid grid-cols-2 gap-3"><legend className="mb-2 font-semibold">Building point</legend><div><Label htmlFor="roof-latitude">Latitude</Label><Input id="roof-latitude" inputMode="decimal" value={latitude} onChange={event => setLatitude(event.target.value)} /></div><div><Label htmlFor="roof-longitude">Longitude</Label><Input id="roof-longitude" inputMode="decimal" value={longitude} onChange={event => setLongitude(event.target.value)} /></div></fieldset><div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => { const lat = parseNumber(latitude, -90, 90); const lng = parseNumber(longitude, -180, 180); if (lat === undefined || lng === undefined) { setError("Enter valid latitude and longitude coordinates."); return; } changePoint({ latitude: lat, longitude: lng }); }}>Use coordinates</Button><Button variant="ghost" onClick={() => changePoint(selected.location)}>Use address point</Button></div><p className="text-xs text-muted-foreground">Your selected house must be near the saved address. Device location only recenters the map; it does not choose a house.</p><Button onClick={() => inspectAt(point)} disabled={!!busy} className="w-full">{busy === "insights" ? "Checking this building…" : preview ? "Refresh roof preview" : "Inspect roof at this point"}</Button></>}
        </div>
      </div>}
      {preview && !manualMode && <section className="rounded-xl border bg-background p-6" aria-labelledby="building-confirm-title"><h2 id="building-confirm-title" className="text-xl">Is this the correct building?</h2><p className="mt-2 text-muted-foreground">Google modeled {preview.roof.roofAreaSquareMeters.toFixed(1)} m² of roof across {preview.roof.segmentCount} segment{preview.roof.segmentCount === 1 ? "" : "s"}. Some roof portions may not be characterized.</p><p className="mt-2 text-sm text-muted-foreground">{preview.roof.imageryDate ? "Imagery date: " + preview.roof.imageryDate + ". " : "Imagery date unavailable. "}{preview.roof.imageryQuality ? "Imagery quality: " + preview.roof.imageryQuality + "." : "Imagery quality unavailable."}</p><p className="mt-2 text-xs text-muted-foreground">Source: Includes solar data from Google.</p><div className="mt-5 flex flex-wrap gap-3"><Button onClick={confirmBuilding} disabled={!!busy || buildingConfirmed}>{buildingConfirmed ? "Building confirmed" : busy === "building" ? "Confirming building…" : "Yes, this is my building"}</Button><Button variant="outline" onClick={() => { setPreview(undefined); setBuildingConfirmed(false); }}>Choose another point</Button></div></section>}
      {preview && buildingConfirmed && !manualMode && <section className="rounded-xl border bg-background p-6" aria-labelledby="roof-confirm-title"><Ruler aria-hidden="true" className="mb-3 text-primary" /><h2 id="roof-confirm-title" className="text-xl">Are these roof measurements right?</h2><p className="mt-2 text-muted-foreground">Modeled roof area: <strong>{preview.roof.roofAreaSquareMeters.toFixed(1)} m²</strong>. Modeled segments: <strong>{preview.roof.segmentCount}</strong>.</p><ul className="mt-4 grid gap-2 text-sm">{preview.roof.segments.map(segment => <li key={segment.segmentId} className="flex justify-between gap-3 border-b py-2"><span>{segment.segmentId}</span><span>{segment.areaSquareMeters.toFixed(1)} m²</span></li>)}</ul><p className="mt-4 text-sm text-muted-foreground">Satellite estimate, not a complete site survey or structural assessment. Source: Includes solar data from Google.</p><div className="mt-5 flex flex-wrap gap-3"><Button onClick={confirmRoof} disabled={!!busy}>{busy === "roof" ? "Saving assessment…" : "Yes, save these measurements"}</Button><Button variant="outline" onClick={startManual}>Use my measurements instead</Button></div></section>}
      {manualMode && <form onSubmit={submitManual} noValidate className="rounded-xl border bg-background p-6" aria-labelledby="manual-roof-title"><Ruler aria-hidden="true" className="mb-3 text-primary" /><h2 id="manual-roof-title" className="text-xl">Enter your roof measurements</h2><p className="mt-2 max-w-2xl text-sm text-muted-foreground">Use measurements you know. This path does not use Google roof data or check structural safety. Area is required; other fields are optional. Length and width are the horizontal footprint dimensions. The roof surface area must agree within 15% of length × width adjusted for pitch.</p><div className="mt-5 grid gap-4 sm:grid-cols-2"><div><Label htmlFor="manual-area">Roof surface area (m²)</Label><Input id="manual-area" type="number" inputMode="decimal" min="0" max="100000" step="any" required value={manual.area} onChange={event => setManual({ ...manual, area: event.target.value })} /></div><div /><div><Label htmlFor="manual-length">Horizontal length (m, optional)</Label><Input id="manual-length" type="number" inputMode="decimal" min="0" max="1000" step="any" value={manual.length} onChange={event => setManual({ ...manual, length: event.target.value })} /></div><div><Label htmlFor="manual-width">Horizontal width (m, optional)</Label><Input id="manual-width" type="number" inputMode="decimal" min="0" max="1000" step="any" value={manual.width} onChange={event => setManual({ ...manual, width: event.target.value })} /></div><div><Label htmlFor="manual-pitch">Pitch (degrees, optional)</Label><Input id="manual-pitch" type="number" inputMode="decimal" min="0" max="75" step="any" value={manual.pitch} onChange={event => setManual({ ...manual, pitch: event.target.value })} /></div><div><Label htmlFor="manual-azimuth">Orientation (degrees, optional)</Label><Input id="manual-azimuth" type="number" inputMode="decimal" min="0" max="360" step="any" value={manual.azimuth} onChange={event => setManual({ ...manual, azimuth: event.target.value })} /></div></div><Button type="submit" className="mt-6" disabled={!!busy}>{busy === "manual" ? "Saving your measurements…" : "Confirm and save my measurements"}</Button></form>}
    </section>}
    {visibleResult && <section className="rounded-xl border bg-background p-6" aria-labelledby="assessment-saved-title"><CheckCircle2 aria-hidden="true" className="mb-3 text-primary" /><h2 id="assessment-saved-title">Roof measurements saved</h2><p className="mt-2">{visibleResult.roof.roofAreaSquareMeters.toFixed(1)} m² across {visibleResult.roof.segmentCount} segment{visibleResult.roof.segmentCount === 1 ? "" : "s"}.</p><p className="mt-2 text-sm text-muted-foreground">Source: {visibleResult.source === "MANUAL" ? "your measurements" : "Includes solar data from Google"}. Assessment ID: {visibleResult.analysisId}. This does not establish structural suitability or a final solar design.</p></section>}
    {visibleResult && <RoofLayoutViewer key={visibleResult.analysisId} roof={visibleResult.roof} analysisId={visibleResult.analysisId} />}
    {visibleResult && propertyId && <SystemDesigner key={`${propertyId}:${visibleResult.analysisId}`} propertyId={propertyId} analysisId={visibleResult.analysisId} />}
  </>;
}
