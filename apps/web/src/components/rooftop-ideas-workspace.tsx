"use client";

import { SignInLink } from "./sign-in-link";
import Link from "next/link";
import Image from "next/image";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowRight, Box, CircleHelp, Compass, Flower2, Home, Leaf, LoaderCircle, ShieldCheck,
  Shirt, Sparkles, Sun, Users, Wind } from "lucide-react";
import { Button, Input, Label } from "@solarsaathi/ui";
import type { SystemDemand } from "@solarsaathi/calculations";
import { useAuth } from "../auth/auth-provider";
import { applicationsApi, type PropertyChoice } from "../lib/applications-api";
import { advisorApi, type AdvisorAnalysis } from "../lib/advisor-api";
import { designsApi, type DesignCandidate, type DesignCategory, type DesignGenerationResponse,
  type DesignsRequest, type DesignsResponse } from "../lib/designs-api";
import { RoofRequestError } from "../lib/roof-api";
import { RemainingRoofViewer } from "./remaining-roof-viewer";

const categoryDetails = {
  DRYING: { label: "Drying corner", Icon: Shirt },
  SEATING: { label: "Seating", Icon: Users },
  GARDEN: { label: "Light garden", Icon: Flower2 },
  STRETCH: { label: "Stretch space", Icon: Wind },
} as const;
const statusCopy: Record<DesignCandidate["status"], string> = {
  SPACE_FEASIBLE: "Space-feasible", NOT_SPACE_FEASIBLE: "No modeled fit", UNDETERMINED: "Fit undetermined",
};
const bounded = (raw: string, min: number, max: number) => {
  const value = Number(raw);
  return raw.trim() && Number.isFinite(value) && value >= min && value <= max ? value : undefined;
};
const date = (value: string) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric",
  timeZone: "Asia/Kolkata" }).format(new Date(value));
const errorText = (error: unknown) => error instanceof RoofRequestError ?
  error.code === "ROOF_GEOMETRY_UNDETERMINED" ? "This confirmed roof has only an area. Add measured dimensions or a supported roof outline in Analyze Roof before planning a remaining-space footprint." :
  error.code === "CANDIDATE_UNFIT" ? "That solar system does not fit the saved roof and demand. Choose a smaller candidate or revisit the roof assessment." :
    error.message : "The rooftop concept could not be prepared. Try again.";

interface Fields {
  basis: "CONSUMPTION" | "BILL"; monthlyKwh: string; bill: string; tariff: string;
  sanctionedLoad: string; yield: string; nominalKw: string; categories: DesignCategory[];
}
const empty: Fields = { basis: "CONSUMPTION", monthlyKwh: "", bill: "", tariff: "", sanctionedLoad: "",
  yield: "", nominalKw: "", categories: [] };
function requestFrom(fields: Fields, propertyId: string, analysisId: string): DesignsRequest | undefined {
  const generationKwhPerKwYear = bounded(fields.yield, 500, 2_500);
  const nominalKw = bounded(fields.nominalKw, 0.25, 100);
  const sanctionedLoadKw = fields.sanctionedLoad.trim() ? bounded(fields.sanctionedLoad, 0.25, 1_000) : undefined;
  if (generationKwhPerKwYear === undefined || nominalKw === undefined ||
    fields.sanctionedLoad.trim() && sanctionedLoadKw === undefined) return undefined;
  let demand: SystemDemand;
  if (fields.basis === "CONSUMPTION") {
    const monthlyConsumptionKwh = bounded(fields.monthlyKwh, 1, 100_000);
    if (monthlyConsumptionKwh === undefined) return undefined;
    demand = { kind: "CONSUMPTION", monthlyConsumptionKwh, ...(sanctionedLoadKw === undefined ? {} : { sanctionedLoadKw }) };
  } else {
    const monthlyBillRupees = bounded(fields.bill, 1, 1_000_000), tariffRupeesPerKwh = bounded(fields.tariff, 0.1, 100);
    if (monthlyBillRupees === undefined || tariffRupeesPerKwh === undefined) return undefined;
    demand = { kind: "BILL", monthlyBillRupees, tariffRupeesPerKwh,
      ...(sanctionedLoadKw === undefined ? {} : { sanctionedLoadKw }) };
  }
  return { propertyId, analysisId, demand, generationKwhPerKwYear, nominalKw,
    ...(fields.categories.length ? { preferences: { categories: fields.categories } } : {}) };
}

function ConceptCard({ candidate, selected, demo, onSelect }: { candidate: DesignCandidate; selected: boolean; demo: boolean; onSelect: () => void }) {
  const { Icon, label } = categoryDetails[candidate.category];
  return <article className={`design-candidate design-candidate-${candidate.status.toLowerCase()}`} data-selected={selected}>
    <div className="design-candidate-symbol"><Icon size={23} strokeWidth={1.8} aria-hidden="true" /></div>
    <div className="design-candidate-content"><div className="design-candidate-top"><span>{label}{demo ? " · Fictional fixture" : ""}</span><span className="design-candidate-status">{statusCopy[candidate.status]}</span></div>
      <h3>{candidate.title}</h3><p>{candidate.reason}</p>
      <dl><div><dt>Concept footprint</dt><dd>{candidate.requiredAreaSquareMeters.toFixed(1)} m²</dd></div>
        <div><dt>Placement</dt><dd>{candidate.placement ? `Modeled free zone ${candidate.placement.zoneId}` : "Not placed"}</dd></div></dl>
      <div className="design-candidate-safety"><ShieldCheck size={16} aria-hidden="true" /><span>Structural and site review required for every concept.</span></div>
      <Button type="button" variant={selected ? "default" : "outline"} size="sm" aria-pressed={selected} onClick={onSelect}>
        {selected ? "Selected for preview" : "Inspect this idea"}</Button></div></article>;
}

export function RooftopIdeasResult({ response, input, demo = false }: { response: DesignsResponse; input?: DesignsRequest; demo?: boolean }) {
  const [selectedId, setSelectedId] = useState(response.candidates.find(item => item.status === "SPACE_FEASIBLE")?.candidateId ??
    response.candidates[0]?.candidateId ?? "");
  const [generated, setGenerated] = useState<DesignGenerationResponse>();
  const [generating, setGenerating] = useState<"TEMPLATE" | "IMAGE">();
  const [generationError, setGenerationError] = useState<string>();
  const [attemptedImageIds, setAttemptedImageIds] = useState<Set<string>>(() => new Set());
  const generationRef = useRef<AbortController | null>(null);
  useEffect(() => () => { generationRef.current?.abort(); generationRef.current = null; }, []);
  const selected = response.candidates.find(item => item.candidateId === selectedId);
  const imageAttempted = selected ? attemptedImageIds.has(selected.candidateId) : false;
  function choose(id: string) {
    generationRef.current?.abort(); generationRef.current = null;
    setGenerated(undefined); setGenerating(undefined); setGenerationError(undefined); setSelectedId(id);
  }
  function generate(render: "TEMPLATE" | "IMAGE") {
    if (!input || !selected || selected.status !== "SPACE_FEASIBLE" || demo || render === "IMAGE" && imageAttempted) return;
    generationRef.current?.abort();
    const controller = new AbortController(); generationRef.current = controller;
    if (render === "IMAGE") setAttemptedImageIds(previous => new Set(previous).add(selected.candidateId));
    setGenerating(render); setGenerated(undefined); setGenerationError(undefined);
    void designsApi.generate(input, selected, render, controller.signal).then(result => {
      if (!controller.signal.aborted) setGenerated(result);
    }).catch(error => { if (!controller.signal.aborted) setGenerationError(errorText(error)); })
      .finally(() => { if (generationRef.current === controller) { generationRef.current = null; setGenerating(undefined); } });
  }
  const area = response.planning.remainingProjectedAreaSquareMeters;
  return <section className="design-result" aria-labelledby="design-result-title">
    <div className="design-result-overview"><div><span className="design-overline">{demo ? "Fictional geometry preview" : "Server-modeled space"}</span>
      <h2 id="design-result-title">Room beyond the solar layout</h2><p>These placements are alternatives. Selecting one does not mean the other ideas fit at the same time.</p></div>
      <div className="design-area-number"><strong>{area === null ? "Undetermined" : `${area.toFixed(1)} m²`}</strong><span>remaining projected area{area === null ? "" : ` · approximately ${Math.round(area * 10.7639).toLocaleString("en-IN")} sq ft`}</span>
        {response.geometry.totalFreeZoneCount > response.geometry.freeZones.length && <small>Area includes all {response.geometry.totalFreeZoneCount} modeled zones; the scene shows {response.geometry.freeZones.length}.</small>}</div></div>
    <div className="design-metrics"><div><span>Confirmed roof</span><strong>{response.planning.roofAreaSquareMeters.toFixed(1)} m²</strong></div>
      <div><span>Modeled usable after setbacks and path</span><strong>{response.planning.modeledUsableProjectedAreaSquareMeters === null ? "Undetermined" : `${response.planning.modeledUsableProjectedAreaSquareMeters.toFixed(1)} m²`}</strong></div>
      <div><span>Reserved for solar with buffer</span><strong>{response.planning.reservedSolarProjectedAreaSquareMeters === null ? "Undetermined" : `${response.planning.reservedSolarProjectedAreaSquareMeters.toFixed(1)} m²`}</strong></div>
      <div><span>Solar plan</span><strong>{response.system.panelCount} panels · {response.system.actualDcKw.toFixed(2)} kW DC</strong></div></div>
    <div className="design-assumptions"><h3>What this model keeps clear</h3><p>Edge setback {response.planning.assumptions.edgeSetbackMeters} m · service path {response.planning.assumptions.servicePathWidthMeters} m · solar buffer {response.planning.assumptions.solarBufferMeters} m. These are planning assumptions, not verified local code clearances.</p></div>
    <RemainingRoofViewer response={response} candidate={selected} />
    <div className="design-ideas-heading"><div><span className="design-overline">Concept choices</span><h2>Choose one concept to inspect</h2><p>A space-feasible label checks an approximate footprint only. It says nothing about load, waterproofing or permission.</p></div></div>
    {response.candidates.length ? <div className="design-candidate-grid">{response.candidates.map(candidate => <ConceptCard key={candidate.candidateId}
      candidate={candidate} demo={demo} selected={candidate.candidateId === selectedId} onSelect={() => choose(candidate.candidateId)} />)}</div> :
      <p className="design-empty-result">No concepts match these category preferences. Select other categories and run the plan again.</p>}
    {selected && <section className="design-selected" aria-labelledby="design-selected-title"><div><span className="design-overline">Selected concept</span><h2 id="design-selected-title">{selected.title}</h2>
      <p>{selected.reason}</p><ul>{selected.safetyNotes.map(note => <li key={note}>{note}</li>)}</ul>
      <p className="design-selected-limit">Space-feasible only where shown. A qualified structural review and site-specific electrical, waterproofing and access checks are required before any build.</p></div>
      <div className="design-concept-actions"><p>Reusable template: {selected.template.status === "STORED" ? "stored version available" : "deterministic fallback"}. Image: {generated?.concept.image.status === "READY" ? "inspirational concept ready" :
        generated?.concept.image.status === "UNAVAILABLE" ? "unavailable; 3D and plan remain available" : "not requested"}.</p>
        {selected.status === "SPACE_FEASIBLE" && !demo && <><Button type="button" variant="outline" disabled={!!generating}
          onClick={() => generate("TEMPLATE")}>Use a reusable template</Button><Button type="button" disabled={!!generating || imageAttempted}
          onClick={() => generate("IMAGE")}>{generating === "IMAGE" ? "Generating concept…" :
            imageAttempted ? "Image request used for this roof concept" : "Request inspirational image"}</Button>
          <small>One image attempt per property, analysis and concept. The 3D and plan views remain available.</small></>}
        {demo && <p>This fictional preview cannot generate an image or save a template.</p>}
        {generating && <p role="status"><LoaderCircle size={16} aria-hidden="true" /> Checking the selected concept…</p>}
        {generationError && <p role="alert" className="design-error">{generationError}</p>}
        {generated && <div className="design-concept-state"><strong>{generated.concept.template.status === "STORED" ? "Stored generic template" : "Deterministic fallback concept"}</strong>
          <p>Template fingerprint {generated.concept.template.fingerprint.slice(0, 12)}… · {generated.concept.image.status === "READY" ? "property-scoped image" : "3D and plan stay available"}</p>
          {generated.concept.image.status === "UNAVAILABLE" && <p>{generated.concept.image.reason || "Image generation is unavailable for this concept."}</p>}
          {generated.concept.image.status === "READY" && generated.concept.image.url && <figure><Image src={generated.concept.image.url}
            alt={`Inspirational AI concept for ${selected.title}; not an accurate rendering of this property`}
            width={800} height={600} unoptimized loading="eager" referrerPolicy="no-referrer" /><figcaption>AI-generated inspiration only. This is not a site survey, construction drawing or structural approval.</figcaption></figure>}</div>}
      </div></section>}
    {response.warnings.length > 0 && <div className="design-warnings"><h3>Before you plan any rooftop use</h3><ul>{response.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul></div>}
    {!demo && <small className="design-request">Request {response.requestId}. This recommendation is read-only. Reusable templates are generic; a requested image, when available, is scoped to this property and analysis.</small>}
  </section>;
}

export function RooftopIdeasWorkspace() {
  const { status, profile } = useAuth();
  const owner = status === "signedIn" ? profile?.userId : undefined;
  const ownerRef = useRef(owner);
  const requestRef = useRef<AbortController | null>(null);
  const ownerEpoch = useRef(0), propertyEpoch = useRef(0);
  const propertyPageRef = useRef<AbortController | null>(null), analysisPageRef = useRef<AbortController | null>(null);
  const [properties, setProperties] = useState<PropertyChoice[]>([]), [propertyCursor, setPropertyCursor] = useState<string>();
  const [propertyId, setPropertyId] = useState("");
  const [analyses, setAnalyses] = useState<AdvisorAnalysis[]>([]), [analysisCursor, setAnalysisCursor] = useState<string>();
  const [analysisId, setAnalysisId] = useState("");
  const [fields, setFields] = useState<Fields>(empty);
  const [submitted, setSubmitted] = useState<{ response: DesignsResponse; input: DesignsRequest }>();
  const [loadingProperties, setLoadingProperties] = useState(false), [loadingAnalyses, setLoadingAnalyses] = useState(false);
  const [morePropertiesBusy, setMorePropertiesBusy] = useState(false), [moreAnalysesBusy, setMoreAnalysesBusy] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string>(), [contextError, setContextError] = useState<string>();
  function clearResult() { requestRef.current?.abort(); requestRef.current = null; setSubmitted(undefined); setBusy(false); setError(undefined); }
  function update<K extends keyof Fields>(key: K, value: Fields[K]) { clearResult(); setFields(previous => ({ ...previous, [key]: value })); }
  useEffect(() => {
    ownerRef.current = owner; ownerEpoch.current += 1; propertyPageRef.current?.abort(); propertyPageRef.current = null;
    setMorePropertiesBusy(false); requestRef.current?.abort(); requestRef.current = null;
    setProperties([]); setPropertyCursor(undefined); setPropertyId(""); setAnalyses([]); setAnalysisId("");
    setSubmitted(undefined); setBusy(false); setError(undefined); setContextError(undefined);
    if (!owner) return;
    const controller = new AbortController(); setLoadingProperties(true);
    void applicationsApi.properties(undefined, controller.signal).then(page => {
      if (controller.signal.aborted) return;
      setProperties(page.properties); setPropertyCursor(page.nextCursor); setPropertyId(page.properties[0]?.propertyId ?? "");
    }).catch(failure => { if (!controller.signal.aborted) setError(errorText(failure)); })
      .finally(() => { if (!controller.signal.aborted) setLoadingProperties(false); });
    return () => { controller.abort(); propertyPageRef.current?.abort(); propertyPageRef.current = null; };
  }, [owner]);
  useEffect(() => {
    propertyEpoch.current += 1; clearResult(); analysisPageRef.current?.abort(); analysisPageRef.current = null;
    setMoreAnalysesBusy(false); setAnalyses([]); setAnalysisCursor(undefined); setAnalysisId(""); setContextError(undefined);
    if (!owner || !propertyId) return;
    const controller = new AbortController(); setLoadingAnalyses(true);
    void advisorApi.analyses(propertyId, undefined, controller.signal).then(page => {
      if (controller.signal.aborted) return;
      setAnalyses(page.analyses); setAnalysisCursor(page.nextCursor); setAnalysisId(page.analyses[0]?.analysisId ?? "");
    }).catch(failure => { if (!controller.signal.aborted) setContextError(errorText(failure)); })
      .finally(() => { if (!controller.signal.aborted) setLoadingAnalyses(false); });
    return () => { controller.abort(); analysisPageRef.current?.abort(); analysisPageRef.current = null; };
  }, [owner, propertyId]);
  useEffect(() => { clearResult(); }, [analysisId]);
  const visible = status === "signedIn" && !!owner && ownerRef.current === owner;
  const chosenAnalysis = analyses.find(item => item.analysisId === analysisId);
  async function moreProperties() {
    if (!propertyCursor || propertyPageRef.current) return;
    const epoch = ownerEpoch.current, controller = new AbortController(); propertyPageRef.current = controller;
    setMorePropertiesBusy(true);
    try { const page = await applicationsApi.properties(propertyCursor, controller.signal);
      if (epoch === ownerEpoch.current && !controller.signal.aborted) { setProperties(previous => [...previous, ...page.properties]); setPropertyCursor(page.nextCursor); }
    } catch (failure) { if (epoch === ownerEpoch.current && !controller.signal.aborted) setError(errorText(failure)); }
    finally { if (propertyPageRef.current === controller) { propertyPageRef.current = null; setMorePropertiesBusy(false); } }
  }
  async function moreAnalyses() {
    if (!analysisCursor || analysisPageRef.current) return;
    const epoch = propertyEpoch.current, controller = new AbortController(); analysisPageRef.current = controller;
    setMoreAnalysesBusy(true);
    try { const page = await advisorApi.analyses(propertyId, analysisCursor, controller.signal);
      if (epoch === propertyEpoch.current && !controller.signal.aborted) { setAnalyses(previous => [...previous, ...page.analyses]); setAnalysisCursor(page.nextCursor); }
    } catch (failure) { if (epoch === propertyEpoch.current && !controller.signal.aborted) setContextError(errorText(failure)); }
    finally { if (analysisPageRef.current === controller) { analysisPageRef.current = null; setMoreAnalysesBusy(false); } }
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!propertyId || !analysisId) { setError("Choose an owned property and confirmed roof before planning the remaining space."); return; }
    const input = requestFrom(fields, propertyId, analysisId);
    if (!input) { setError("Enter valid electricity demand, a supported solar system size and an annual generation assumption. Check optional sanctioned load too."); return; }
    clearResult(); const controller = new AbortController(); requestRef.current = controller; setBusy(true);
    void designsApi.recommend(input, controller.signal).then(response => {
      if (!controller.signal.aborted) setSubmitted({ response, input });
    }).catch(failure => { if (!controller.signal.aborted) setError(errorText(failure)); })
      .finally(() => { if (requestRef.current === controller) { requestRef.current = null; setBusy(false); } });
  }
  if (!visible) return <section className="design-signin"><ShieldCheck size={28} aria-hidden="true" />
    <h1>{status === "unconfigured" ? "Rooftop ideas are not connected here yet" : "Sign in to explore the space after solar"}</h1>
    <p>{status === "unconfigured" ? "Account sign-in and design APIs are not configured in this deployment. A separate synthetic preview shows the layout." :
      "This planner uses your saved, confirmed roof and a fitting solar layout."}</p>
    {status === "signedOut" && <SignInLink />}
    {(status === "signedOut" || status === "unconfigured") && <Button asChild variant="outline"><Link href="/demo/rooftop-ideas">View synthetic preview</Link></Button>}
    {status === "loading" && <p role="status">Checking your account…</p>}</section>;
  return <div className="design-page"><header className="design-hero"><div><span><Sun size={17} aria-hidden="true" /> Roof life after solar</span>
    <h1>Make room for what comes next.</h1><p>Explore the space a modeled solar layout leaves open. Every highlighted idea preserves the modeled panel area, edge setback and service path.</p>
    <small>Space-feasible is a geometry check. Structure, waterproofing, access and local permissions still need professional review.</small></div>
    <div className="design-hero-relief" aria-hidden="true"><span /><span /><span /><Leaf size={35} /></div></header>
    <div className="design-layout"><aside className="design-context" aria-labelledby="design-context-title"><div className="design-context-heading"><Compass size={19} aria-hidden="true" /><h2 id="design-context-title">Choose your roof</h2></div>
      <p>Your property and roof assessment remain account scoped. The service recomputes the solar layout before finding free space.</p>
      {loadingProperties ? <p role="status">Loading properties…</p> : !properties.length ? <div className="design-context-empty"><CircleHelp size={21} aria-hidden="true" /><p>No saved property is available.</p><Link href="/app/analyze">Analyze a roof <ArrowRight size={16} aria-hidden="true" /></Link></div> : <>
        <div className="design-field"><Label htmlFor="design-property">Property</Label><select id="design-property" value={propertyId} onChange={event => { clearResult(); setPropertyId(event.target.value); }}>
          {properties.map(item => <option key={item.propertyId} value={item.propertyId}>{item.label || item.address || item.propertyId}</option>)}</select></div>
        {propertyCursor && <button type="button" className="design-more" disabled={morePropertiesBusy} onClick={() => void moreProperties()}>{morePropertiesBusy ? "Loading properties…" : "Load more properties"}</button>}
        <div className="design-field"><Label htmlFor="design-analysis">Confirmed roof assessment</Label><select id="design-analysis" value={analysisId}
          disabled={loadingAnalyses || !analyses.length} onChange={event => { clearResult(); setAnalysisId(event.target.value); }}>
          {!analyses.length && <option value="">{loadingAnalyses ? "Loading assessments…" : "No confirmed roof"}</option>}
          {analyses.map(item => <option key={item.analysisId} value={item.analysisId}>{date(item.measuredAt)} · {item.roofAreaSquareMeters.toFixed(1)} m² · {item.source === "GOOGLE_SOLAR" ? "Google" : "manual"}</option>)}</select></div>
        {analysisCursor && <button type="button" className="design-more" disabled={moreAnalysesBusy} onClick={() => void moreAnalyses()}>{moreAnalysesBusy ? "Loading assessments…" : "Load more assessments"}</button>}
        {contextError && <p role="alert" className="design-error">{contextError}</p>}
        {chosenAnalysis && <div className="design-roof-card"><Home size={21} aria-hidden="true" /><div><strong>{chosenAnalysis.roofAreaSquareMeters.toFixed(1)} m²</strong><span>Confirmed roof · {chosenAnalysis.segmentCount} segment{chosenAnalysis.segmentCount === 1 ? "" : "s"}</span>
          <small>{chosenAnalysis.source === "GOOGLE_SOLAR" ? "Approximate Google Solar bounds" : "User-entered dimensions or area"}</small></div></div>}
        {!loadingAnalyses && !analyses.length && <p className="design-context-help">Confirm roof measurements in <Link href="/app/analyze">Analyze Roof</Link> first.</p>}
      </>}
      <div className="design-context-foot"><ShieldCheck size={17} aria-hidden="true" /><span>An area-only roof may need measured dimensions before a footprint can be placed.</span></div></aside>
      <div className="design-main"><form className="design-form" onSubmit={submit} noValidate><div className="design-form-heading"><span><Box size={16} aria-hidden="true" /> Solar-first layout</span><h2>Set the planning context</h2><p>Use the same demand and system assumptions as the solar designer. The backend checks fit on the saved roof.</p></div>
        <fieldset className="design-demand"><legend>How do you know your electricity use?</legend><label><input type="radio" name="design-demand" checked={fields.basis === "CONSUMPTION"} onChange={() => update("basis", "CONSUMPTION")} /> Monthly units</label><label><input type="radio" name="design-demand" checked={fields.basis === "BILL"} onChange={() => update("basis", "BILL")} /> Bill and tariff</label></fieldset>
        <div className="design-input-grid">{fields.basis === "CONSUMPTION" ? <div><Label htmlFor="design-kwh">Monthly electricity use (kWh)</Label><Input id="design-kwh" type="number" inputMode="decimal" min="1" max="100000" step="any" value={fields.monthlyKwh} onChange={event => update("monthlyKwh", event.target.value)} /></div> : <><div><Label htmlFor="design-bill">Monthly bill (₹)</Label><Input id="design-bill" type="number" inputMode="decimal" min="1" max="1000000" step="any" value={fields.bill} onChange={event => update("bill", event.target.value)} /></div><div><Label htmlFor="design-tariff">Effective tariff (₹/kWh)</Label><Input id="design-tariff" type="number" inputMode="decimal" min="0.1" max="100" step="any" value={fields.tariff} onChange={event => update("tariff", event.target.value)} /></div></>}
          <div><Label htmlFor="design-nominal">Planning solar system</Label><select id="design-nominal" value={fields.nominalKw} onChange={event => update("nominalKw", event.target.value)}><option value="">Choose a candidate</option>{[1, 2, 3, 5, 7.5, 10].map(size => <option key={size} value={size}>{size} kW</option>)}</select><small>Must fit the confirmed roof and demand.</small></div>
          <div><Label htmlFor="design-yield">Annual generation assumption (kWh per kW)</Label><Input id="design-yield" type="number" inputMode="decimal" min="500" max="2500" step="any" value={fields.yield} onChange={event => update("yield", event.target.value)} /><small>Planning input, not a measured site yield.</small></div>
          <div><Label htmlFor="design-load">Sanctioned load (kW, optional)</Label><Input id="design-load" type="number" inputMode="decimal" min="0.25" max="1000" step="any" value={fields.sanctionedLoad} onChange={event => update("sanctionedLoad", event.target.value)} /></div></div>
        <fieldset className="design-preferences"><legend>Ideas to explore</legend><p>Leave all clear to compare every category.</p><div>{(Object.keys(categoryDetails) as DesignCategory[]).map(category => {
          const { Icon, label } = categoryDetails[category];
          return <label key={category}><input type="checkbox" checked={fields.categories.includes(category)}
            onChange={event => update("categories", event.target.checked ? [...fields.categories, category] : fields.categories.filter(value => value !== category))} />
            <Icon size={19} aria-hidden="true" />{label}</label>;
        })}</div></fieldset>
        <div className="design-submit"><Button type="submit" disabled={!chosenAnalysis || busy}>{busy ? "Modeling roof space…" : "Explore remaining space"}<ArrowRight size={17} aria-hidden="true" /></Button><span>No structural or policy approval is implied.</span></div>
        {busy && <p role="status" className="design-status"><LoaderCircle size={16} aria-hidden="true" /> Rechecking panel placement, setbacks and free zones…</p>}
        {error && <div className="design-error" role="alert"><p>{error}</p>{error.includes("only an area") && <Link href="/app/analyze">Return to roof analysis <ArrowRight size={15} aria-hidden="true" /></Link>}</div>}
      </form>
      {submitted ? <RooftopIdeasResult key={submitted.response.requestId} response={submitted.response} input={submitted.input} /> :
        <div className="design-awaiting"><Sparkles size={24} aria-hidden="true" /><h2>Your rooftop plan starts with a fitting solar layout</h2><p>After checking your saved roof, the service will show modeled free zones, concept footprints and a 3D, plan or text view.</p></div>}
      </div></div></div>;
}
