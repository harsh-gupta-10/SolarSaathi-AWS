"use client";

import { SignInLink } from "./sign-in-link";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ChevronLeft, CheckCircle2, ChevronRight, Layers, LocateFixed, MapPin, Ruler, ShieldCheck, Sun } from "lucide-react";
import { Button, Input, Label } from "@solarsaathi/ui";
import type { GeocodeCandidate, ManualRoofMeasurements, RoofConfirmationResponse, RoofPoint, RoofPreviewResponse } from "@solarsaathi/types";
import { useAuth } from "../auth/auth-provider";
import { ADDRESS_DRAFT_KEY, readAddressDraft, saveAddressDraft } from "../lib/address-draft";
import { getPublicEnvironment } from "../lib/env";
import { roofApi, RoofRequestError } from "../lib/roof-api";
import { brokerApi } from "../lib/broker-api";
import { AnalysisStepper } from "./analysis-stepper";
import { getStoredProperty, saveStoredProperty } from "../lib/properties-store";
import { AddressForm } from "./address-form";
import { SatelliteBuildingMap } from "./satellite-building-map";
import { RoofLayoutViewer } from "./roof-layout-viewer";
import type { RoofOutline } from "@solarsaathi/calculations";
import { SystemDesigner, type SystemDesignOutcome } from "./system-designer";
import { FinancialEstimator } from "./financial-estimator";
import { BenefitEvaluator } from "./benefit-evaluator";
import type { FinancialEstimateResponse } from "../lib/financial-api";
import { DraftSaveIndicator, hasSavedDesignInputs } from "../lib/analysis-draft";
import { AnalysisDraftScope, RoofOutlineDraftBridge } from "./roof-outline-draft";
import { focusHeading, useRevealOnChange } from "../lib/reveal";

type Busy = "property" | "geocode" | "insights" | "building" | "roof" | "manual";
const parseNumber = (value: string, min: number, max: number): number | undefined => {
  const number = Number(value);
  return value.trim() && Number.isFinite(number) && number >= min && number <= max ? number : undefined;
};
type Step = 1 | 2 | 3 | 4 | 5 | 6;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

/** Properties created in this browser session (as opposed to a link the user opened). */
const createdHere = new Set<string>();

/** Keeps the saved property and analysis in the address bar so a reload or shared tab returns to the same work. */
function syncLocation(propertyId?: string, analysisId?: string) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (propertyId) url.searchParams.set("propertyId", propertyId); else url.searchParams.delete("propertyId");
  if (analysisId) url.searchParams.set("analysisId", analysisId); else url.searchParams.delete("analysisId");
  if (url.toString() !== window.location.href) window.history.replaceState(window.history.state, "", url);
}

/** Back / next controls that stay visible at the bottom of the screen on long steps. */
function StepActions({ back, next, nextHref, nextLabel, nextHint }: {
  back?: () => void; next?: () => void; nextHref?: string; nextLabel: string; nextHint?: string;
}) {
  return (
    <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-background/95 p-3 backdrop-blur">
      {back ? <Button variant="outline" size="sm" onClick={back}><ChevronLeft className="size-4" aria-hidden="true" /> Back</Button> : <span />}
      <div className="flex items-center gap-3">
        {!next && !nextHref && nextHint && <span className="text-xs text-muted-foreground">{nextHint}</span>}
        {nextHref
          ? <Button asChild size="sm" className="gap-1.5"><Link href={nextHref}>{nextLabel} <ChevronRight className="size-4" aria-hidden="true" /></Link></Button>
          : <Button size="sm" onClick={next} disabled={!next} className="gap-1.5">{nextLabel} <ChevronRight className="size-4" aria-hidden="true" /></Button>}
      </div>
    </div>
  );
}

const errorText = (error: unknown) => error instanceof RoofRequestError ? error.message : "This step could not be completed. Try again.";

export function AnalyzeStart() {
  const { status, profile } = useAuth();
  const [activeTab, setActiveTab] = useState<Step>(1);
  const [design, setDesign] = useState<SystemDesignOutcome>();
  const [estimate, setEstimate] = useState<FinancialEstimateResponse>();
  const stepperRef = useRef<HTMLDivElement>(null);
  const stepContentRef = useRef<HTMLDivElement>(null);
  const firstStep = useRef(true);
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
  // The building outline the user traced on the map (3D view only). A different building starts again from Google's box.
  const [userOutline, setUserOutline] = useState<RoofOutline>();
  useEffect(() => { setUserOutline(undefined); }, [preview?.previewId]);
  const [buildingConfirmed, setBuildingConfirmed] = useState(false);
  const [result, setResult] = useState<RoofConfirmationResponse>();
  const [manualMode, setManualMode] = useState(false);
  const [manual, setManual] = useState({ area: "", length: "", width: "", pitch: "", azimuth: "" });
  const [busy, setBusy] = useState<Busy>();
  const [error, setError] = useState<string>();
  const [existingLookup, setExistingLookup] = useState(false);
  const [existingLookupError, setExistingLookupError] = useState<string>();
  const [gpsLocating, setGpsLocating] = useState(false);
  const [gpsError, setGpsError] = useState<string>();
  const [gpsSuccess, setGpsSuccess] = useState<string>();
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
    setGpsLocating(false); setGpsError(undefined); setGpsSuccess(undefined);
    setDesign(undefined); setEstimate(undefined);
    // A property this page added to the address bar belongs to the previous session; an opened link is re-checked
    // for the new account instead (the backend enforces ownership).
    const linked = new URLSearchParams(window.location.search).get("propertyId");
    if (linked && createdHere.has(linked)) syncLocation(undefined, undefined);
    setActiveTab(1);
  }, [account, status]);

  useEffect(() => {
    if (!account) return;
    const params = new URLSearchParams(window.location.search);
    const linkedPropertyId = params.get("propertyId");
    const linkedAnalysisId = params.get("analysisId");
    if (!linkedPropertyId) return;
    if (!ID_PATTERN.test(linkedPropertyId) || (linkedAnalysisId !== null && !ID_PATTERN.test(linkedAnalysisId))) {
      setExistingLookupError("This property link is invalid. Open the property from your workspace again."); return;
    }
    const controller = new AbortController(); propertyLookup.current = controller;
    setExistingLookup(true); setExistingLookupError(undefined);
    void (async () => {
      const property = await brokerApi.property(linkedPropertyId, controller.signal);
      if (controller.signal.aborted) return;
      setAddress(property.address); setPropertyId(property.propertyId); setEditing(false); setCustomerName("");
      // Reopen the saved roof: the linked analysis, or the most recent confirmed one for this property.
      let analysisId: string | undefined;
      try { analysisId = linkedAnalysisId ?? await roofApi.latestAnalysisId(property.propertyId, controller.signal); }
      catch { analysisId = undefined; }
      if (!analysisId || controller.signal.aborted) return;
      try {
        const saved = await roofApi.analysis(property.propertyId, analysisId, controller.signal);
        if (controller.signal.aborted) return;
        setResult(saved);
        syncLocation(property.propertyId, saved.analysisId);
        // Continue where the user left off: sizing answers saved for this roof reopen the sizing step. Later steps
        // need fresh backend results, which are never stored, so they are not restored.
        const resume = profile?.userId ? await hasSavedDesignInputs(profile.userId, property.propertyId, saved.analysisId, controller.signal) : false;
        if (!controller.signal.aborted) setActiveTab(resume ? 4 : 3);
      } catch (failure) {
        if (controller.signal.aborted) return;
        // An expired or deleted analysis just means the roof must be confirmed again. Any other failure keeps the
        // property usable and the link intact (a reload retries) and says the saved roof could not be loaded.
        if (failure instanceof RoofRequestError && failure.code === "NOT_FOUND") syncLocation(property.propertyId, undefined);
        else setError(`Your saved roof could not be loaded: ${errorText(failure)}`);
      }
    })().catch(failure => {
      if (controller.signal.aborted) return;
      // Fallback for homeowners loading their saved properties from My Properties
      const localProp = getStoredProperty(linkedPropertyId, profile?.userId);
      if (localProp) {
        setAddress(localProp.address);
        setPropertyId(localProp.propertyId);
        setEditing(false);
        setCustomerName("");
        if (localProp.roofAreaSquareMeters) {
          const restoredSource: "GOOGLE_SOLAR" | "MANUAL" = localProp.source === "MANUAL" ? "MANUAL" : "GOOGLE_SOLAR";
          setResult({
            schemaVersion: 1,
            source: restoredSource,
            requestId: `req-${localProp.propertyId}`,
            analysisId: localProp.analysisId || `analysis-${localProp.propertyId}`,
            roof: {
              schemaVersion: 1,
              source: restoredSource,
              measuredAt: localProp.updatedAt || new Date().toISOString(),
              roofAreaSquareMeters: localProp.roofAreaSquareMeters,
              segmentCount: localProp.segmentCount || 1,
              segments: [{ segmentId: "roof-1", areaSquareMeters: localProp.roofAreaSquareMeters }],
            },
          });
          setActiveTab(3);
        }
        return;
      }
      setExistingLookupError(errorText(failure));
    }).finally(() => { if (!controller.signal.aborted) setExistingLookup(false); });
    return () => controller.abort();
  }, [account, profile?.userId]);

  // Move the reader to the top of each new step and put keyboard focus on its heading.
  useEffect(() => {
    if (firstStep.current) { firstStep.current = false; return; }
    const reduce = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    stepperRef.current?.scrollIntoView?.({ behavior: reduce ? "auto" : "smooth", block: "start" });
    const frame = requestAnimationFrame(() => focusHeading(stepContentRef.current));
    return () => cancelAnimationFrame(frame);
  }, [activeTab]);

  // A new confirmed roof invalidates downstream results (their inputs stay in the saved draft).
  useEffect(() => { setDesign(undefined); setEstimate(undefined); }, [result?.analysisId]);
  useEffect(() => { if (propertyId) syncLocation(propertyId, result?.analysisId); }, [propertyId, result?.analysisId]);

  const buildingRevealRef = useRevealOnChange<HTMLDivElement>(preview?.previewId);
  const roofRevealRef = useRevealOnChange<HTMLDivElement>(buildingConfirmed ? preview?.previewId : undefined);

  function reset() {
    request.current?.abort(); request.current = null;
    propertyLookup.current?.abort(); propertyLookup.current = null;
    locationAttempt.current += 1;
    setBusy(undefined); setError(undefined); setExistingLookup(false); setExistingLookupError(undefined); setPropertyId(undefined); setCandidates([]);
    setSelected(undefined); setPoint(undefined); setMapCenter(undefined); setDeviceLocation(undefined);
    setLocationStatus("idle"); setLocationMessage(undefined); setPreview(undefined);
    setBuildingConfirmed(false); setResult(undefined); setManualMode(false);
    setGpsLocating(false); setGpsError(undefined); setGpsSuccess(undefined);
    setDesign(undefined); setEstimate(undefined);
    syncLocation(undefined, undefined);
    setActiveTab(1);
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

  async function ensureProperty(signal: AbortSignal, addrOverride?: string) {
    if (propertyId) return propertyId;
    const targetAddress = addrOverride ?? address;
    if (!targetAddress || status !== "signedIn" || !profile) throw new RoofRequestError("SESSION_UNAVAILABLE", "Sign in and enter a property address first.");
    if (profile.role === "BROKER" && !customerName.trim()) throw new RoofRequestError("CUSTOMER_REQUIRED", "Enter the customer’s name before creating a broker property.");
    await roofApi.bootstrap(signal);
    const customerId = profile.role === "BROKER" ? await roofApi.createCustomer(customerName.trim(), signal) : undefined;
    const id = await roofApi.createProperty(targetAddress, customerId, signal);
    createdHere.add(id);
    if (!signal.aborted) {
      setPropertyId(id);
      saveStoredProperty({
        propertyId: id,
        label: customerName.trim() ? `${customerName.trim()} - Rooftop` : "My Home Rooftop",
        address: targetAddress,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }, profile.userId);
    }
    return id;
  }

  function handleAutoFetchLocation() {
    setGpsError(undefined);
    setGpsSuccess(undefined);
    if (typeof window === "undefined" || !navigator?.geolocation) {
      setGpsError("Geolocation is not supported by your browser. Please enter your address manually.");
      return;
    }
    setGpsLocating(true);
    try {
      navigator.geolocation.getCurrentPosition(
        async position => {
          const { latitude: lat, longitude: lng, accuracy } = position.coords;
          if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
            setGpsLocating(false);
            setGpsError("Device returned invalid GPS coordinates. Please enter your address manually.");
            return;
          }
          const current: RoofPoint = { latitude: lat, longitude: lng };
          const formattedAddress = `Current location (${Math.abs(lat).toFixed(5)}° ${lat >= 0 ? "N" : "S"}, ${Math.abs(lng).toFixed(5)}° ${lng >= 0 ? "E" : "W"})`;
          try {
            saveAddressDraft(sessionStorage, formattedAddress);
          } catch {
            // sessionStorage blocked
          }
          setAddress(formattedAddress);
          setEditing(false);
          setPoint(current);
          setLatitude(lat.toFixed(6));
          setLongitude(lng.toFixed(6));
          setMapCenter(current);
          setDeviceLocation({ point: current, accuracyMeters: accuracy });
          setLocationStatus("ready");
          setLocationMessage(`Device location detected (accuracy ~${Math.round(accuracy)} m).`);

          const gpsCandidate: GeocodeCandidate = {
            placeId: `gps-${lat.toFixed(4)}-${lng.toFixed(4)}`,
            address: formattedAddress,
            location: current,
            locationType: "APPROXIMATE",
            partialMatch: false,
          };
          setCandidates([gpsCandidate]);
          setSelected(gpsCandidate);
          setGpsSuccess(`GPS location locked (~${Math.round(accuracy)}m accuracy).`);

          // The device position only centers the map. The user still picks the building themselves.
          setGpsLocating(false);
          if (status === "signedIn" && profile) {
            run("property", async signal => {
              await ensureProperty(signal, formattedAddress);
              if (!signal.aborted) setActiveTab(2);
            });
          }
        },
        failure => {
          setGpsLocating(false);
          if (failure.code === 1) {
            setGpsError("Location permission denied. Please allow location access in your browser or enter your address manually.");
          } else if (failure.code === 3) {
            setGpsError("Location request timed out. Please try again or enter your address manually.");
          } else {
            setGpsError("Could not retrieve device location. Please enter your address manually.");
          }
        },
        { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
      );
    } catch {
      setGpsLocating(false);
      setGpsError("Could not initiate location request. Please enter your address manually.");
    }
  }

  function findBuilding() {
    run("property", async signal => {
      const id = await ensureProperty(signal);
      if (signal.aborted) return;
      setBusy("geocode");
      const data = await roofApi.geocode(id, signal);
      if (signal.aborted) return;
      setManualMode(false);
      setCandidates(data.candidates);
      setActiveTab(2);
      if (data.candidates.length === 1) choose(data.candidates[0]);
      if (!data.candidates.length) setError("No address match was found. Check your address or enter roof measurements manually.");
    });
  }

  function startManual() {
    request.current?.abort(); setBusy(undefined); setError(undefined);
    locationAttempt.current += 1;
    setDeviceLocation(undefined); setLocationStatus("idle"); setLocationMessage(undefined);
    setManualMode(true); setCandidates([]); setSelected(undefined); setPreview(undefined); setResult(undefined);
    setActiveTab(2);
  }

  function inspectAt(housePoint: RoofPoint) {
    if (!propertyId || !selected) return;
    run("insights", async signal => {
      const data = await roofApi.insights(propertyId, selected, housePoint, signal);
      if (!signal.aborted) {
        setPreview(data);
        setBuildingConfirmed(false);
        if (data.roof?.center) {
          setPoint(data.roof.center);
          setLatitude(data.roof.center.latitude.toFixed(6));
          setLongitude(data.roof.center.longitude.toFixed(6));
          setMapCenter(data.roof.center);
        }
      }
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
      if (!signal.aborted) {
        setResult(data);
        setActiveTab(3);
        if (profile?.userId && address) {
          saveStoredProperty({
            propertyId,
            label: customerName.trim() ? `${customerName.trim()} - Rooftop` : "My Home Rooftop",
            address,
            analysisId: data.analysisId,
            roofAreaSquareMeters: data.roof.roofAreaSquareMeters,
            segmentCount: data.roof.segmentCount,
            source: data.source,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }, profile.userId);
        }
      }
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
      if (!signal.aborted) {
        setResult(data);
        setActiveTab(3);
        if (profile?.userId && address) {
          saveStoredProperty({
            propertyId: id,
            label: customerName.trim() ? `${customerName.trim()} - Rooftop` : "My Home Rooftop",
            address,
            analysisId: data.analysisId,
            roofAreaSquareMeters: data.roof.roofAreaSquareMeters,
            segmentCount: data.roof.segmentCount,
            source: "MANUAL",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }, profile.userId);
        }
      }
    });
  }

  const enabled = status === "signedIn" && !!profile && accountRef.current === account && !!address && !editing && !existingLookup && !existingLookupError;
  const visibleAddress = accountRef.current === account ? address : null;
  const visibleResult = enabled ? result : undefined;
  const mapReady = Boolean(mapKey && selected && point);

  const canAccessTab2 = candidates.length > 0 || manualMode || Boolean(preview) || Boolean(result);
  const canAccessTab3 = Boolean(visibleResult || preview);
  const canAccessTab4 = Boolean(visibleResult && propertyId);
  const canAccessTab5 = canAccessTab4 && Boolean(design?.response.design.recommendation);
  const canAccessTab6 = canAccessTab5 && Boolean(estimate);
  const draftScope = profile && propertyId && visibleResult ? { userId: profile.userId, propertyId, analysisId: visibleResult.analysisId } : undefined;

  return (
    <>
      <div className="page-heading">
        <h1>Find your roof, then verify it.</h1>
        <p>Choose the right building and check its measurements before saving an assessment.</p>
      </div>

      <div ref={stepperRef} className="sticky top-0 z-20 -mx-2 bg-muted/95 px-2 pt-2 backdrop-blur">
        <AnalysisStepper active={activeTab} onSelect={step => setActiveTab(step as Step)} steps={[
          { number: 1, label: "Address", reachable: true },
          { number: 2, label: "Find building", reachable: canAccessTab2 },
          { number: 3, label: "Roof model", reachable: canAccessTab3 },
          { number: 4, label: "System size", reachable: canAccessTab4 },
          { number: 5, label: "Cost & savings", reachable: canAccessTab5 },
          { number: 6, label: "Subsidies & apply", reachable: canAccessTab6 },
        ]} />
      </div>
      <div ref={stepContentRef}>

      {/* Auth Gate Note */}
      {status !== "signedIn" && (
        <div className="availability-note mb-6">
          <ShieldCheck aria-hidden="true" />
          <div>
            <h2>Sign in to save a roof assessment</h2>
            <p>
              {status === "unconfigured"
                ? "Account sign-in is not configured for this deployment. Your address remains a tab draft; no analysis has run."
                : "Your address remains a tab draft until your account is connected."}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {status === "signedOut" && (
                <SignInLink />
              )}
              {(status === "signedOut" || status === "unconfigured") && (
                <>
                  <Button asChild variant="outline">
                    <Link href="/demo/roof-3d">Explore 3D demo</Link>
                  </Button>
                  <Button asChild variant="outline">
                    <Link href="/demo/system-designer">Try system designer demo</Link>
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
      {status !== "signedIn" && (
        <p className="mt-4 text-sm text-muted-foreground">
          <Link href="/demo/roof-3d" className="font-medium text-primary underline underline-offset-4">
            Explore a sample 3D roof
          </Link>{" "}
          while live analysis is being configured.
        </p>
      )}

      {/* TAB 1: Address & Property Profile */}
      {activeTab === 1 && (
        <div className="space-y-6">
          <section className="workspace-start" aria-labelledby="address-draft-title">
            <div className="flex items-start justify-between gap-4 mb-4">
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center size-10 rounded-xl bg-primary/10 text-primary shrink-0">
                  <MapPin className="size-5" aria-hidden="true" />
                </div>
                <div>
                  <h2 id="address-draft-title" className="text-xl font-bold tracking-tight text-foreground m-0">
                    Property Location &amp; Rooftop Details
                  </h2>
                  <p className="text-xs text-muted-foreground mt-0.5 m-0">
                    Enter your street address or auto-detect via GPS to inspect your rooftop solar geometry.
                  </p>
                </div>
              </div>
            </div>

            {/* GPS Auto-Fetch Feature Callout */}
            <div className="mb-5 rounded-xl border border-primary/20 bg-primary/5 p-3.5 transition-colors">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                    <LocateFixed className={`size-4 ${gpsLocating ? "animate-spin" : ""}`} />
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-foreground m-0">Auto-Fetch Current Location (GPS)</p>
                    <p className="text-[11px] text-muted-foreground m-0">
                      Grant browser permission to automatically detect your coordinates and inspect your roof on satellite view.
                    </p>
                  </div>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="default"
                  onClick={handleAutoFetchLocation}
                  disabled={gpsLocating}
                  className="shrink-0 text-xs font-semibold shadow-xs"
                >
                  {gpsLocating ? (
                    <>
                      <span className="inline-block size-3 border-2 border-current border-r-transparent rounded-full animate-spin mr-1.5" />
                      Locating rooftop…
                    </>
                  ) : (
                    <>
                      <LocateFixed className="size-3.5 mr-1.5" />
                      Auto-Fetch Location
                    </>
                  )}
                </Button>
              </div>
              {gpsSuccess && (
                <p className="mt-2 text-xs text-primary font-medium m-0 flex items-center gap-1.5">
                  <CheckCircle2 className="size-3.5" />
                  {gpsSuccess}
                </p>
              )}
              {gpsError && (
                <div className="mt-2.5 flex items-start gap-2 rounded-lg bg-amber-500/10 border border-amber-500/30 p-2.5 text-xs text-amber-800 dark:text-amber-200">
                  <span className="font-bold shrink-0">⚠️</span>
                  <span className="flex-1">{gpsError}</span>
                  <button type="button" onClick={() => setGpsError(undefined)} className="ml-1 text-xs font-bold hover:underline">✕</button>
                </div>
              )}
            </div>

            {existingLookup && accountRef.current === account ? (
              <p role="status">Loading the saved property…</p>
            ) : visibleAddress === null ? (
              <p role="status">Loading your tab’s draft…</p>
            ) : visibleAddress && !editing ? (
              <div className="rounded-xl border bg-muted/20 p-4 space-y-3">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div>
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-primary">Selected Property Address</span>
                    <p className="draft-address font-semibold text-foreground text-base mt-0.5">{visibleAddress}</p>
                    <p className="muted text-xs">
                      {propertyId
                        ? "Saved property in your organization. The address was loaded from the backend."
                        : "This is a browser tab draft until you start an assessment."}
                    </p>
                  </div>
                </div>
                <div className="draft-actions flex flex-wrap gap-2 pt-1">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      reset();
                      setEditing(true);
                    }}
                  >
                    Edit address
                  </Button>
                  <Button variant="ghost" size="sm" onClick={clear}>
                    Clear draft
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <AddressForm
                  key={visibleAddress ?? ""}
                  initialAddress={visibleAddress ?? ""}
                  compact
                  onSaved={value => {
                    reset();
                    setAddress(value);
                    setEditing(false);
                  }}
                />
              </div>
            )}

            {profile?.role === "BROKER" && enabled && !propertyId && (
              <div className="mt-5 max-w-md">
                <Label htmlFor="roof-customer-name">Customer name</Label>
                <Input
                  id="roof-customer-name"
                  value={customerName}
                  maxLength={120}
                  onChange={event => setCustomerName(event.target.value)}
                />
                <p className="form-hint">A broker assessment must belong to a customer in your organization.</p>
              </div>
            )}
          </section>

          {existingLookupError && (
            <div className="mt-4">
              <p role="alert" className="form-error">
                {existingLookupError}
              </p>
              <Button
                type="button"
                variant="outline"
                className="mt-3"
                onClick={() => {
                  reset();
                  setEditing(true);
                }}
              >
                Enter another address
              </Button>
            </div>
          )}

          {enabled && (
            <div className="rounded-xl border bg-background p-6 space-y-4">
              <h3 className="font-semibold text-foreground">Find Building or Enter Measurements</h3>
              <p className="text-sm text-muted-foreground">
                We use Google Solar satellite mapping to automatically measure your roof plane, tilt, and azimuth. You can also input your own roof measurements manually.
              </p>
              <div className="flex flex-wrap gap-3">
                {!manualMode && (
                  <Button onClick={findBuilding} disabled={!!busy}>
                    {busy === "property"
                      ? "Saving property…"
                      : busy === "geocode"
                      ? "Finding address…"
                      : candidates.length
                      ? "Search address again"
                      : "Find my building"}
                  </Button>
                )}
                <Button
                  variant="outline"
                  disabled={!!busy}
                  onClick={() => {
                    if (manualMode) {
                      setManualMode(false);
                      setError(undefined);
                    } else startManual();
                  }}
                >
                  {manualMode ? "Use satellite lookup" : "Enter roof measurements manually"}
                </Button>
                {candidates.length > 0 && (
                  <Button variant="secondary" onClick={() => setActiveTab(2)}>
                    Continue to Satellite Map →
                  </Button>
                )}
              </div>
              {error && <p className="form-error" role="alert">{error}</p>}
            </div>
          )}
        </div>
      )}

      {/* TAB 2: Satellite Map & Building Confirmation */}
      {activeTab === 2 && enabled && (
        <section className="space-y-6" aria-label="Building and roof analysis">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
            <div>
              <h2 className="text-xl font-semibold">Step 2: Building &amp; Roof Verification</h2>
              <p className="text-xs text-muted-foreground">Verify the building footprint and satellite solar roof segments.</p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => setActiveTab(1)}>
                ← Back to Address
              </Button>
              {visibleResult && (
                <Button size="sm" onClick={() => setActiveTab(3)} className="gap-1.5">
                  Next: roof model <ChevronRight className="size-4" aria-hidden="true" />
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                disabled={!!busy}
                onClick={() => {
                  if (manualMode) {
                    setManualMode(false);
                    setError(undefined);
                  } else startManual();
                }}
              >
                {manualMode ? "Use satellite lookup" : "Enter roof measurements manually"}
              </Button>
            </div>
          </div>

          {error && <p className="form-error" role="alert">{error}</p>}

          {!manualMode && candidates.length > 0 && (
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(19rem,1fr)]">
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h3 className="text-lg font-medium">Select your building</h3>
                  {mapReady && (
                    <Button
                      variant="outline"
                      onClick={locateOnce}
                      disabled={locationStatus === "locating"}
                      aria-label="Show my current location on the map"
                    >
                      <LocateFixed aria-hidden="true" className="mr-2 size-4" />
                      {locationStatus === "locating" ? "Finding your location…" : "Use my location"}
                    </Button>
                  )}
                </div>
                {locationMessage && (
                  <p
                    className={locationStatus === "error" ? "form-error" : "text-sm text-muted-foreground"}
                    role={locationStatus === "error" ? "alert" : "status"}
                  >
                    {locationMessage}
                  </p>
                )}
                {mapReady ? (
                  <SatelliteBuildingMap
                    apiKey={mapKey!}
                    center={mapCenter ?? selected!.location}
                    point={point!}
                    deviceLocation={deviceLocation}
                    roof={preview?.roof}
                    outline={userOutline}
                    onOutlineChange={setUserOutline}
                    onPointChange={selectHouseOnMap}
                  />
                ) : (
                  <div
                    className="flex min-h-72 items-center justify-center rounded-xl border bg-muted p-6 text-center text-muted-foreground"
                    role="status"
                  >
                    {mapKey
                      ? "Choose an address match to view satellite imagery."
                      : "Satellite map is not configured. You can still select an address match and use coordinates."}
                  </div>
                )}
                {preview?.roof.center && (
                  <div className="rounded-lg border bg-background/80 p-3 text-xs space-y-2">
                    <p className="font-medium text-foreground">
                      Building detected: {preview.roof.center.latitude.toFixed(6)}°, {preview.roof.center.longitude.toFixed(6)}°
                    </p>
                    <p className="text-muted-foreground">
                      {point &&
                      Math.abs(point.latitude - preview.roof.center.latitude) < 0.00002 &&
                      Math.abs(point.longitude - preview.roof.center.longitude) < 0.00002
                        ? "✓ Pin is snapped directly to the building roof center."
                        : "Selected pin and roof center differ slightly."}{" "}
                      The green boundary shows Google Solar&apos;s building footprint.
                    </p>
                    {point &&
                      (Math.abs(point.latitude - preview.roof.center.latitude) >= 0.00002 ||
                        Math.abs(point.longitude - preview.roof.center.longitude) >= 0.00002) && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            if (preview.roof.center) {
                              setPoint(preview.roof.center);
                              setLatitude(preview.roof.center.latitude.toFixed(6));
                              setLongitude(preview.roof.center.longitude.toFixed(6));
                              setMapCenter(preview.roof.center);
                            }
                          }}
                        >
                          Snap pin to roof center
                        </Button>
                      )}
                  </div>
                )}
                <p className="text-sm text-muted-foreground">
                  Tap your house on the satellite map to load a Google Solar roof preview and building overlay.
                </p>
              </div>

              <div className="space-y-5 rounded-xl border bg-background p-5">
                <fieldset className="space-y-3">
                  <legend className="mb-3 font-semibold">Address matches</legend>
                  {candidates.map(item => (
                    <label key={item.placeId} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border p-3">
                      <input
                        type="radio"
                        name="geocode-candidate"
                        checked={selected?.placeId === item.placeId}
                        onChange={() => choose(item)}
                        className="mt-1"
                      />
                      <span>
                        <strong className="block font-medium">{item.address}</strong>
                        <small className="text-muted-foreground">
                          {item.partialMatch ? "Partial match — verify carefully" : "Google Geocoding result"}
                        </small>
                      </span>
                    </label>
                  ))}
                </fieldset>

                {selected && point && (
                  <>
                    <fieldset className="grid grid-cols-2 gap-3">
                      <legend className="mb-2 font-semibold">Building point</legend>
                      <div>
                        <Label htmlFor="roof-latitude">Latitude</Label>
                        <Input
                          id="roof-latitude"
                          inputMode="decimal"
                          value={latitude}
                          onChange={event => setLatitude(event.target.value)}
                        />
                      </div>
                      <div>
                        <Label htmlFor="roof-longitude">Longitude</Label>
                        <Input
                          id="roof-longitude"
                          inputMode="decimal"
                          value={longitude}
                          onChange={event => setLongitude(event.target.value)}
                        />
                      </div>
                    </fieldset>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        onClick={() => {
                          const lat = parseNumber(latitude, -90, 90);
                          const lng = parseNumber(longitude, -180, 180);
                          if (lat === undefined || lng === undefined) {
                            setError("Enter valid latitude and longitude coordinates.");
                            return;
                          }
                          changePoint({ latitude: lat, longitude: lng });
                        }}
                      >
                        Use coordinates
                      </Button>
                      <Button variant="ghost" onClick={() => changePoint(selected.location)}>
                        Use address point
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Your selected house must be near the saved address.
                    </p>
                    <Button onClick={() => inspectAt(point)} disabled={!!busy} className="w-full">
                      {busy === "insights" ? "Checking this building…" : preview ? "Refresh roof preview" : "Inspect roof at this point"}
                    </Button>
                  </>
                )}
              </div>
            </div>
          )}

          <div ref={buildingRevealRef} />
          {preview && !manualMode && (
            <section className="rounded-xl border bg-background p-6" aria-labelledby="building-confirm-title">
              <h2 id="building-confirm-title" className="text-xl">
                Is this the correct building?
              </h2>
              <p className="mt-2 text-muted-foreground">
                Google modeled {preview.roof.roofAreaSquareMeters.toFixed(1)} m² of roof across {preview.roof.segmentCount} segment
                {preview.roof.segmentCount === 1 ? "" : "s"}. Some roof portions may not be characterized.
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                {preview.roof.imageryDate ? "Imagery date: " + preview.roof.imageryDate + ". " : "Imagery date unavailable. "}
                {preview.roof.imageryQuality ? "Imagery quality: " + preview.roof.imageryQuality + "." : "Imagery quality unavailable."}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">Source: Includes solar data from Google.</p>
              <div className="mt-5 flex flex-wrap gap-3">
                <Button onClick={confirmBuilding} disabled={!!busy || buildingConfirmed}>
                  {buildingConfirmed ? "Building confirmed" : busy === "building" ? "Confirming building…" : "Yes, this is my building"}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setPreview(undefined);
                    setBuildingConfirmed(false);
                  }}
                >
                  Choose another point
                </Button>
              </div>
            </section>
          )}

          <div ref={roofRevealRef} />
          {preview && buildingConfirmed && !manualMode && (
            <section className="rounded-xl border bg-background p-6" aria-labelledby="roof-confirm-title">
              <Ruler aria-hidden="true" className="mb-3 text-primary" />
              <h2 id="roof-confirm-title" className="text-xl">
                Are these roof measurements right?
              </h2>
              <p className="mt-2 text-muted-foreground">
                Modeled roof area: <strong>{preview.roof.roofAreaSquareMeters.toFixed(1)} m²</strong>. Modeled segments:{" "}
                <strong>{preview.roof.segmentCount}</strong>.
              </p>
              <ul className="mt-4 grid gap-2 text-sm">
                {preview.roof.segments.map(segment => (
                  <li key={segment.segmentId} className="flex justify-between gap-3 border-b py-2">
                    <span>{segment.segmentId}</span>
                    <span>{segment.areaSquareMeters.toFixed(1)} m²</span>
                  </li>
                ))}
              </ul>
              <p className="mt-4 text-sm text-muted-foreground">
                Satellite estimate, not a complete site survey or structural assessment. Source: Includes solar data from Google.
              </p>
              <div className="mt-5 flex flex-wrap gap-3">
                <Button onClick={confirmRoof} disabled={!!busy}>
                  {busy === "roof" ? "Saving assessment…" : "Yes, save these measurements"}
                </Button>
                <Button variant="outline" onClick={startManual}>
                  Use my measurements instead
                </Button>
              </div>
            </section>
          )}

          {manualMode && (
            <form onSubmit={submitManual} noValidate className="rounded-xl border bg-background p-6" aria-labelledby="manual-roof-title">
              <Ruler aria-hidden="true" className="mb-3 text-primary" />
              <h2 id="manual-roof-title" className="text-xl">
                Enter your roof measurements
              </h2>
              <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
                Use measurements you know. Area is required; other fields are optional. Horizontal length and width must be entered together.
              </p>
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="manual-area">Roof surface area (m²)</Label>
                  <Input
                    id="manual-area"
                    type="number"
                    inputMode="decimal"
                    min="0"
                    max="100000"
                    step="any"
                    required
                    value={manual.area}
                    onChange={event => setManual({ ...manual, area: event.target.value })}
                  />
                </div>
                <div />
                <div>
                  <Label htmlFor="manual-length">Horizontal length (m, optional)</Label>
                  <Input
                    id="manual-length"
                    type="number"
                    inputMode="decimal"
                    min="0"
                    max="1000"
                    step="any"
                    value={manual.length}
                    onChange={event => setManual({ ...manual, length: event.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="manual-width">Horizontal width (m, optional)</Label>
                  <Input
                    id="manual-width"
                    type="number"
                    inputMode="decimal"
                    min="0"
                    max="1000"
                    step="any"
                    value={manual.width}
                    onChange={event => setManual({ ...manual, width: event.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="manual-pitch">Pitch (degrees, optional)</Label>
                  <Input
                    id="manual-pitch"
                    type="number"
                    inputMode="decimal"
                    min="0"
                    max="75"
                    step="any"
                    value={manual.pitch}
                    onChange={event => setManual({ ...manual, pitch: event.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="manual-azimuth">Orientation (degrees, optional)</Label>
                  <Input
                    id="manual-azimuth"
                    type="number"
                    inputMode="decimal"
                    min="0"
                    max="360"
                    step="any"
                    value={manual.azimuth}
                    onChange={event => setManual({ ...manual, azimuth: event.target.value })}
                  />
                </div>
              </div>
              <div className="mt-6 flex flex-wrap gap-3">
                <Button type="submit" disabled={!!busy}>
                  {busy === "manual" ? "Saving your measurements…" : "Confirm and save my measurements"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setManualMode(false);
                    setError(undefined);
                  }}
                >
                  Switch to satellite lookup
                </Button>
              </div>
            </form>
          )}
        </section>
      )}

      {/* One draft provider covers the roof view and steps 4–6, so the traced outline saves with the other answers. */}
      <AnalysisDraftScope scope={draftScope}>
      <RoofOutlineDraftBridge key={draftScope?.analysisId ?? "none"} outline={userOutline} onRestore={setUserOutline} />
      {/* TAB 3: 3D Roof Model & Measurements */}
      {activeTab === 3 && (
        <section className="space-y-6" aria-label="3D Roof Model">
          {visibleResult ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
                <div>
                  <h2 className="text-xl font-semibold">Step 3: 3D Roof Model &amp; Solar Planes</h2>
                  <p className="text-xs text-muted-foreground">Interactive 3D visualization of modeled segments and pitch.</p>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => setActiveTab(2)}>
                    ← Back to Pin Map
                  </Button>
                  <Button size="sm" onClick={() => setActiveTab(4)} className="gap-1.5">
                    Proceed to Solar Sizing <ChevronRight className="size-4" />
                  </Button>
                </div>
              </div>

              <section className="rounded-xl border bg-background p-6" aria-labelledby="assessment-saved-title">
                <CheckCircle2 aria-hidden="true" className="mb-3 text-primary" />
                <h2 id="assessment-saved-title" className="text-lg font-semibold">Roof measurements saved</h2>
                <p className="mt-2 text-foreground">
                  <strong>{visibleResult.roof.roofAreaSquareMeters.toFixed(1)} m²</strong> across{" "}
                  <strong>{visibleResult.roof.segmentCount}</strong> segment{visibleResult.roof.segmentCount === 1 ? "" : "s"}.
                </p>
                <p className="mt-2 text-sm text-muted-foreground">
                  Source: {visibleResult.source === "MANUAL" ? "your measurements" : "Includes solar data from Google"}. Assessment ID:{" "}
                  <code>{visibleResult.analysisId}</code>. This does not establish structural suitability or a final solar design.
                </p>
              </section>

              <RoofLayoutViewer key={visibleResult.analysisId} roof={visibleResult.roof} analysisId={visibleResult.analysisId} footprintOverride={userOutline} />

              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-muted/40 p-4">
                <span className="text-sm text-muted-foreground">Measurements confirmed and saved to your account.</span>
                <div className="flex items-center gap-3">
                  <Button variant="outline" asChild size="sm">
                    <Link href="/app/properties">View in My Properties</Link>
                  </Button>
                  <Button size="sm" onClick={() => setActiveTab(4)} className="gap-1.5">
                    Continue to Sizing &amp; Subsidies <ChevronRight className="size-4" />
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <div className="rounded-xl border bg-muted/30 p-8 text-center space-y-3">
              <Layers className="mx-auto size-8 text-muted-foreground" />
              <h3 className="font-semibold text-lg">No roof measurements verified yet</h3>
              <p className="text-sm text-muted-foreground max-w-md mx-auto">
                Complete Step 1 (Address) and Step 2 (Satellite Verification).
              </p>
              <div className="flex justify-center gap-3 pt-2">
                <Button variant="outline" onClick={() => setActiveTab(1)}>Go to Step 1</Button>
              </div>
            </div>
          )}
        </section>
      )}

      {/* TABS 4–6: size, cost and benefits. Answers are kept in the analysis draft (this device + account). */}
      {activeTab >= 4 && (
        <section className="space-y-6" aria-label="Solar system, cost and subsidies">
          {visibleResult && propertyId && draftScope ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
                <div>
                  <h2 className="text-xl font-semibold">
                    {activeTab === 4 ? "Step 4: Choose a system size" : activeTab === 5 ? "Step 5: Cost and savings" : "Step 6: Subsidies and applying"}
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    {activeTab === 4 ? "Compare system sizes that fit your confirmed roof."
                      : activeTab === 5 ? "Turn your installer's quote into a 25-year savings scenario."
                        : "Check verified government benefits and start your application checklist."}
                  </p>
                </div>
                <DraftSaveIndicator />
              </div>

              {activeTab === 4 && (
                <>
                  <SystemDesigner key={`${propertyId}:${visibleResult.analysisId}`} propertyId={propertyId} analysisId={visibleResult.analysisId}
                    initialResult={design} onResult={outcome => { setDesign(outcome); setEstimate(undefined); }} />
                  <StepActions back={() => setActiveTab(3)} next={canAccessTab5 ? () => setActiveTab(5) : undefined}
                    nextLabel="Next: cost and savings" nextHint="Compare system sizes to continue." />
                </>
              )}
              {activeTab === 5 && design?.response.design.recommendation && (
                <>
                  <FinancialEstimator key={design.response.requestId} propertyId={propertyId} analysisId={visibleResult.analysisId}
                    demand={design.demand} generationKwhPerKwYear={design.generationKwhPerKwYear}
                    candidates={design.response.design.candidates} recommendedNominalKw={design.response.design.recommendation.nominalKw}
                    initialResult={estimate} onResult={setEstimate} />
                  <StepActions back={() => setActiveTab(4)} next={canAccessTab6 ? () => setActiveTab(6) : undefined}
                    nextLabel="Next: subsidies" nextHint="Estimate the cash flow to continue." />
                </>
              )}
              {activeTab === 6 && design && estimate && (
                <>
                  <BenefitEvaluator propertyId={propertyId} analysisId={visibleResult.analysisId} demand={design.demand}
                    generationKwhPerKwYear={design.generationKwhPerKwYear} nominalKw={estimate.system.nominalKw}
                    grossSystemCostRupees={estimate.financial.input.quote.grossSystemCostRupees}
                    financialInputs={{ grossSystemCostRupees: estimate.financial.input.quote.grossSystemCostRupees,
                      selfConsumptionFraction: estimate.financial.input.usage.selfConsumptionFraction,
                      importTariffRupeesPerKwh: estimate.financial.input.usage.importTariffRupeesPerKwh,
                      exportRateRupeesPerKwh: estimate.financial.input.usage.exportRateRupeesPerKwh,
                      annualMaintenanceRupees: estimate.financial.input.assumptions.annualMaintenanceRupees }} />
                  <StepActions back={() => setActiveTab(5)} nextLabel="View my applications" nextHref="/app/applications" />
                </>
              )}
              {((activeTab === 5 && !design?.response.design.recommendation) || (activeTab === 6 && !(design && estimate))) && (
                <div className="rounded-xl border bg-muted/30 p-6 text-center">
                  <p className="text-sm text-muted-foreground">Your answers are saved. Finish the previous step to see this one.</p>
                  <Button className="mt-3" variant="outline" onClick={() => setActiveTab(activeTab === 5 ? 4 : 5)}>Go to previous step</Button>
                </div>
              )}
            </>
          ) : (
            <div className="rounded-xl border bg-muted/30 p-8 text-center space-y-3">
              <Sun className="mx-auto size-8 text-muted-foreground" />
              <h3 className="font-semibold text-lg">Complete Roof Analysis First</h3>
              <p className="text-sm text-muted-foreground max-w-md mx-auto">
                Solar sizing requires confirmed roof geometry. Finish Step 1 &amp; 2 first.
              </p>
              <div className="flex justify-center gap-3 pt-2">
                <Button variant="outline" onClick={() => setActiveTab(1)}>Start at Step 1</Button>
              </div>
            </div>
          )}
        </section>
      )}
      </AnalysisDraftScope>
      </div>
    </>
  );
}
