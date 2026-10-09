"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Activity, ArrowRight, BatteryCharging, Bolt, ChevronDown, CircleHelp, Home, Leaf,
  MapPin, PlugZap, ShieldCheck, SlidersHorizontal, Sparkles, Wrench } from "lucide-react";
import { Button, Input, Label } from "@solarsaathi/ui";
import type { SystemDemand } from "@solarsaathi/calculations";
import { useAuth } from "../auth/auth-provider";
import { accessoriesApi, type AccessoriesRequest, type AccessoriesResponse } from "../lib/accessories-api";
import { advisorApi, type AdvisorAnalysis } from "../lib/advisor-api";
import { applicationsApi, type PropertyChoice } from "../lib/applications-api";
import { RoofRequestError } from "../lib/roof-api";

const categories = {
  ELECTRICAL_SAFETY: { label: "Electrical safety", Icon: ShieldCheck },
  MONITORING: { label: "Monitoring", Icon: Activity },
  BACKUP: { label: "Backup", Icon: BatteryCharging },
  EV: { label: "EV charging", Icon: PlugZap },
  MAINTENANCE: { label: "Maintenance", Icon: Wrench },
};
type Category = keyof typeof categories;
const classifications: Record<AccessoriesResponse["recommendations"][number]["classification"], string> = {
  REQUIRED_BY_RULE: "Required by verified rule", STRONGLY_RECOMMENDED: "Strongly recommended",
  RECOMMENDED: "Recommended", OPTIONAL: "Optional", NOT_RECOMMENDED: "Not recommended",
};
const compatibility: Record<AccessoriesResponse["recommendations"][number]["compatibility"], string> = {
  COMPATIBLE: "Planning fit", REQUIRES_REVIEW: "Installer review needed", NOT_RECOMMENDED: "Not recommended for this setup",
};
const errorText = (error: unknown) => error instanceof RoofRequestError ? error.message :
  "Recommendations could not be prepared. Check your inputs and try again.";
const bounded = (raw: string, min: number, max: number) => {
  const value = Number(raw);
  return raw.trim() && Number.isFinite(value) && value >= min && value <= max ? value : undefined;
};
const date = (value: string) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric",
  timeZone: "Asia/Kolkata" }).format(new Date(value));

interface InputFields {
  demandBasis: "CONSUMPTION" | "BILL"; monthlyKwh: string; monthlyBill: string; tariff: string;
  sanctionedLoad: string; generationYield: string; nominalKw: string;
  backupPower: boolean; evCharging: boolean; monitoring: boolean; easierMaintenance: boolean;
  inverterType: "" | "GRID_TIED" | "HYBRID" | "UNKNOWN";
  evStatus: "" | "NONE" | "PLANNING" | "OWNS_EV";
  lightningExposure: "" | "UNKNOWN" | "REPORTED_HIGH" | "REPORTED_NORMAL";
  birdActivity: "" | "YES" | "NO"; safeCleaningAccess: "" | "UNKNOWN" | "YES" | "NO";
}
const empty: InputFields = { demandBasis: "CONSUMPTION", monthlyKwh: "", monthlyBill: "", tariff: "",
  sanctionedLoad: "", generationYield: "", nominalKw: "", backupPower: false, evCharging: false,
  monitoring: false, easierMaintenance: false, inverterType: "", evStatus: "", lightningExposure: "",
  birdActivity: "", safeCleaningAccess: "" };

function requestFrom(fields: InputFields, propertyId: string, analysisId: string): AccessoriesRequest | undefined {
  const generationKwhPerKwYear = bounded(fields.generationYield, 500, 2_500);
  const nominalKw = bounded(fields.nominalKw, 0.1, 100);
  const sanctionedLoadKw = fields.sanctionedLoad.trim() ? bounded(fields.sanctionedLoad, 0.25, 1_000) : undefined;
  if (generationKwhPerKwYear === undefined || nominalKw === undefined ||
    fields.sanctionedLoad.trim() && sanctionedLoadKw === undefined) return undefined;
  let demand: SystemDemand;
  if (fields.demandBasis === "CONSUMPTION") {
    const monthlyConsumptionKwh = bounded(fields.monthlyKwh, 1, 100_000);
    if (monthlyConsumptionKwh === undefined) return undefined;
    demand = { kind: "CONSUMPTION", monthlyConsumptionKwh, ...(sanctionedLoadKw === undefined ? {} : { sanctionedLoadKw }) };
  } else {
    const monthlyBillRupees = bounded(fields.monthlyBill, 1, 1_000_000);
    const tariffRupeesPerKwh = bounded(fields.tariff, 0.1, 100);
    if (monthlyBillRupees === undefined || tariffRupeesPerKwh === undefined) return undefined;
    demand = { kind: "BILL", monthlyBillRupees, tariffRupeesPerKwh,
      ...(sanctionedLoadKw === undefined ? {} : { sanctionedLoadKw }) };
  }
  return { propertyId, analysisId, nominalKw, demand, generationKwhPerKwYear,
    goals: { backupPower: fields.backupPower, evCharging: fields.evCharging,
      monitoring: fields.monitoring, easierMaintenance: fields.easierMaintenance },
    ...(fields.inverterType ? { inverterType: fields.inverterType } : {}),
    ...(fields.evStatus ? { evStatus: fields.evStatus } : {}),
    site: { ...(fields.lightningExposure ? { lightningExposure: fields.lightningExposure } : {}),
      ...(fields.birdActivity ? { birdActivity: fields.birdActivity === "YES" } : {}),
      ...(fields.safeCleaningAccess ? { safeCleaningAccess: fields.safeCleaningAccess } : {}) } };
}

export function AccessoriesResult({ response, demo = false }: { response: AccessoriesResponse; demo?: boolean }) {
  const [filter, setFilter] = useState<Category | "ALL">("ALL");
  const [showFullReview, setShowFullReview] = useState(false);
  const useful = response.recommendations.filter(item => item.classification !== "NOT_RECOMMENDED");
  const shown = filter === "ALL" ? showFullReview ? response.recommendations : useful.slice(0, 4) :
    response.recommendations.filter(item => item.category === filter);
  const counts = Object.fromEntries(Object.keys(categories).map(category => [category,
    response.recommendations.filter(item => item.category === category).length])) as Record<Category, number>;
  return <section className="accessory-result" aria-labelledby="accessory-result-heading">
    <header className="accessory-result-head"><div><span className="accessory-overline">{demo ? "Fictional fixture" : "Your saved-roof result"}</span>
      <h2 id="accessory-result-heading">Equipment worth considering</h2><p>The service first checks system fit against your saved roof and demand. Relevance scores use your stated goals and installation details plus baseline safety checks, never paid placement.</p></div>
      <div className="accessory-system-stamp"><span>{response.system.nominalKw} kW planning candidate</span><strong>{response.system.actualDcKw.toLocaleString("en-IN", { maximumFractionDigits: 2 })} kW DC</strong>
        <small>Minimum modeled inverter {response.system.minimumInverterAcKw.toLocaleString("en-IN", { maximumFractionDigits: 2 })} kW AC</small>
        <small>{response.system.roofSource === "GOOGLE_SOLAR" ? "Google Solar modeled roof" : "User-measured roof"} · {response.system.generationBasis === "ASSUMED_YIELD" ? "assumed yield" : "Google energy estimate"}</small></div></header>
    <div className="accessory-filter" aria-label="Filter recommendations by category">
      <button type="button" aria-pressed={filter === "ALL"} onClick={() => setFilter("ALL")}>Overview <span>{useful.length}</span></button>
      {(Object.keys(categories) as Category[]).filter(category => counts[category] > 0).map(category => <button type="button"
        key={category} aria-pressed={filter === category} onClick={() => setFilter(category)}>{categories[category].label} <span>{counts[category]}</span></button>)}
    </div>
    {shown.length ? <div className="accessory-list">{shown.map(item => {
      const Icon = categories[item.category].Icon;
      return <article key={item.id} className={`accessory-card accessory-card-${item.classification.toLowerCase()}`}>
        <div className="accessory-card-icon"><Icon size={24} strokeWidth={1.7} aria-hidden="true" /></div>
        <div className="accessory-card-body"><div className="accessory-card-top"><span>{categories[item.category].label}{demo ? " · Fictional fixture" : ""}</span><span className="accessory-classification">{classifications[item.classification]}</span></div>
          <h3>{item.title}</h3><p className="accessory-reason">{item.reason}</p>
          <div className="accessory-card-meta"><div><strong>Compatibility</strong><p>{compatibility[item.compatibility]}</p></div>
            <div><strong>Relevance</strong><p>{item.score}/100 deterministic planning relevance</p></div></div>
          {item.safetyNotes.length > 0 && <div className="accessory-safety"><strong><ShieldCheck size={16} aria-hidden="true" /> Safety review</strong><ul>{item.safetyNotes.map(note => <li key={note}>{note}</li>)}</ul></div>}
          <div className="accessory-card-foot"><p><strong>Policy: not evaluated.</strong> {item.policyRelevance.note}</p>
            <p><strong>Cost: unavailable.</strong> {item.costRange.note}</p></div></div></article>;
    })}</div> : <p className="accessory-no-results">No items in this category for the current plan. Choose another category.</p>}
    {filter === "ALL" && response.recommendations.length > shown.length && <button type="button" className="accessory-expand"
      onClick={() => setShowFullReview(true)}>Show full review ({response.recommendations.length} items, including those not recommended)</button>}
    {filter === "ALL" && showFullReview && response.recommendations.length > 4 && <button type="button" className="accessory-expand"
      onClick={() => setShowFullReview(false)}>Show concise overview</button>}
    {response.warnings.length > 0 && <div className="accessory-warnings"><h3>Planning limits</h3><ul>{response.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul></div>}
    <p className="accessory-financial-note">Accessory costs are outside the base solar estimate. Their benefit eligibility has not been evaluated. Ask an installer to check electrical compatibility, site conditions and final specifications.</p>
    {!demo && <small className="accessory-request-id">Request {response.requestId}</small>}
  </section>;
}

export function AccessoriesWorkspace() {
  const { status, profile } = useAuth();
  const owner = status === "signedIn" ? profile?.userId : undefined;
  const ownerRef = useRef(owner);
  const requestRef = useRef<AbortController | null>(null);
  const ownerEpoch = useRef(0);
  const propertyEpoch = useRef(0);
  const propertyPageRef = useRef<{ cursor: string; controller: AbortController; epoch: number } | null>(null);
  const analysisPageRef = useRef<{ cursor: string; controller: AbortController; epoch: number } | null>(null);
  const [properties, setProperties] = useState<PropertyChoice[]>([]);
  const [propertyCursor, setPropertyCursor] = useState<string>();
  const [propertyId, setPropertyId] = useState("");
  const [analyses, setAnalyses] = useState<AdvisorAnalysis[]>([]);
  const [analysisCursor, setAnalysisCursor] = useState<string>();
  const [analysisId, setAnalysisId] = useState("");
  const [fields, setFields] = useState<InputFields>(empty);
  const [response, setResponse] = useState<AccessoriesResponse>();
  const [busy, setBusy] = useState(false);
  const [loadingProperties, setLoadingProperties] = useState(false);
  const [loadingAnalyses, setLoadingAnalyses] = useState(false);
  const [loadingMoreProperties, setLoadingMoreProperties] = useState(false);
  const [loadingMoreAnalyses, setLoadingMoreAnalyses] = useState(false);
  const [error, setError] = useState<string>();
  const [contextError, setContextError] = useState<string>();

  function clearResult() { requestRef.current?.abort(); requestRef.current = null; setResponse(undefined); setBusy(false); setError(undefined); }
  function update<K extends keyof InputFields>(key: K, value: InputFields[K]) {
    clearResult(); setFields(previous => ({ ...previous, [key]: value }));
  }
  useEffect(() => {
    ownerRef.current = owner; ownerEpoch.current += 1;
    propertyPageRef.current?.controller.abort(); propertyPageRef.current = null; setLoadingMoreProperties(false);
    requestRef.current?.abort(); requestRef.current = null;
    setProperties([]); setPropertyCursor(undefined); setPropertyId(""); setAnalyses([]); setAnalysisId("");
    setResponse(undefined); setBusy(false); setError(undefined); setContextError(undefined);
    if (!owner) return;
    const controller = new AbortController(); setLoadingProperties(true);
    void applicationsApi.properties(undefined, controller.signal).then(page => {
      if (controller.signal.aborted) return;
      setProperties(page.properties); setPropertyCursor(page.nextCursor); setPropertyId(page.properties[0]?.propertyId ?? "");
    }).catch(failure => { if (!controller.signal.aborted) setError(errorText(failure)); })
      .finally(() => { if (!controller.signal.aborted) setLoadingProperties(false); });
    return () => { controller.abort(); propertyPageRef.current?.controller.abort(); propertyPageRef.current = null; };
  }, [owner]);
  useEffect(() => {
    propertyEpoch.current += 1; clearResult(); setAnalyses([]); setAnalysisId(""); setAnalysisCursor(undefined);
    analysisPageRef.current?.controller.abort(); analysisPageRef.current = null; setLoadingMoreAnalyses(false);
    setContextError(undefined);
    if (!owner || !propertyId) return;
    const controller = new AbortController(); setLoadingAnalyses(true);
    void advisorApi.analyses(propertyId, undefined, controller.signal).then(page => {
      if (controller.signal.aborted) return;
      setAnalyses(page.analyses); setAnalysisCursor(page.nextCursor); setAnalysisId(page.analyses[0]?.analysisId ?? "");
    }).catch(failure => { if (!controller.signal.aborted) setContextError(errorText(failure)); })
      .finally(() => { if (!controller.signal.aborted) setLoadingAnalyses(false); });
    return () => { controller.abort(); analysisPageRef.current?.controller.abort(); analysisPageRef.current = null; };
  }, [owner, propertyId]);
  useEffect(() => { clearResult(); }, [analysisId]);

  const visible = status === "signedIn" && !!owner && ownerRef.current === owner;
  const chosenAnalysis = analyses.find(item => item.analysisId === analysisId);
  async function moreProperties() {
    if (!propertyCursor || propertyPageRef.current) return;
    const epoch = ownerEpoch.current;
    const flight = { cursor: propertyCursor, controller: new AbortController(), epoch };
    propertyPageRef.current = flight; setLoadingMoreProperties(true);
    try { const page = await applicationsApi.properties(flight.cursor, flight.controller.signal);
      if (epoch !== ownerEpoch.current) return;
      setProperties(previous => [...previous, ...page.properties]); setPropertyCursor(page.nextCursor);
    } catch (failure) { if (!flight.controller.signal.aborted && epoch === ownerEpoch.current) setError(errorText(failure)); }
    finally { if (propertyPageRef.current === flight) { propertyPageRef.current = null; setLoadingMoreProperties(false); } }
  }
  async function moreAnalyses() {
    if (!analysisCursor || analysisPageRef.current) return;
    const epoch = propertyEpoch.current;
    const flight = { cursor: analysisCursor, controller: new AbortController(), epoch };
    analysisPageRef.current = flight; setLoadingMoreAnalyses(true);
    try { const page = await advisorApi.analyses(propertyId, flight.cursor, flight.controller.signal);
      if (epoch !== propertyEpoch.current) return;
      setAnalyses(previous => [...previous, ...page.analyses]); setAnalysisCursor(page.nextCursor);
    } catch (failure) { if (!flight.controller.signal.aborted && epoch === propertyEpoch.current) setContextError(errorText(failure)); }
    finally { if (analysisPageRef.current === flight) { analysisPageRef.current = null; setLoadingMoreAnalyses(false); } }
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!propertyId || !analysisId) { setError("Choose a saved property and confirmed roof first."); return; }
    const input = requestFrom(fields, propertyId, analysisId);
    if (!input) { setError("Enter a planning system size, annual yield and valid electricity use or bill details. Check optional sanctioned load too."); return; }
    clearResult();
    const controller = new AbortController(); requestRef.current = controller;
    setBusy(true);
    void accessoriesApi.recommend(input, controller.signal).then(result => {
      if (!controller.signal.aborted) setResponse(result);
    }).catch(failure => { if (!controller.signal.aborted) setError(errorText(failure)); })
      .finally(() => { if (requestRef.current === controller) { requestRef.current = null; setBusy(false); } });
  }

  if (!visible) return <section className="accessory-signin"><ShieldCheck size={29} aria-hidden="true" />
    <h1>{status === "unconfigured" ? "Accessory advice is not connected here yet" : "Sign in to review equipment for your roof"}</h1>
    <p>{status === "unconfigured" ? "Account sign-in and the accessory API are not configured in this deployment. You can inspect a clearly fictional layout preview." :
      "Recommendations use your saved, confirmed roof and your stated goals."}</p>
    {status === "signedOut" && <Button asChild><Link href="/auth/sign-in">Sign in</Link></Button>}
    {(status === "signedOut" || status === "unconfigured") && <Button asChild variant="outline"><Link href="/demo/accessories">View synthetic preview</Link></Button>}
    {status === "loading" && <p role="status">Checking your account…</p>}</section>;

  return <div className="accessory-page"><header className="accessory-hero"><div><span className="accessory-hero-kicker"><Leaf size={16} aria-hidden="true" /> Equipment review</span>
    <h1>Equipment that earns its place.</h1><p>Choose your confirmed roof and describe what matters to you. The plan separates useful equipment from optional extras and flags what an installer must review.</p>
    <small>Recommendations are planning guidance. No vendor pays to appear, and no price is shown without a source.</small></div>
    <div className="accessory-hero-object" aria-hidden="true"><span className="accessory-plane accessory-plane-one" /><span className="accessory-plane accessory-plane-two" /><span className="accessory-plane accessory-plane-three" /><Bolt size={30} /></div></header>
    <div className="accessory-layout"><aside className="accessory-context" aria-labelledby="accessory-context-title"><div className="accessory-context-title"><MapPin size={20} aria-hidden="true" /><h2 id="accessory-context-title">Your property context</h2></div>
      <p>The service checks roof ownership and recalculates a fitting system. These records are available only through your account.</p>
      {loadingProperties ? <p role="status">Loading properties…</p> : !properties.length ? <div className="accessory-empty"><CircleHelp size={22} aria-hidden="true" /><p>No saved property is available.</p><Link href="/app/analyze">Start with a roof <ArrowRight size={16} aria-hidden="true" /></Link></div> : <>
        <div className="accessory-field"><Label htmlFor="accessory-property">Property</Label><select id="accessory-property" value={propertyId} onChange={event => { clearResult(); setPropertyId(event.target.value); }}>
          {properties.map(item => <option key={item.propertyId} value={item.propertyId}>{item.label || item.address || item.propertyId}</option>)}</select></div>
        {propertyCursor && <button type="button" className="accessory-more" disabled={loadingMoreProperties}
          onClick={() => void moreProperties()}>{loadingMoreProperties ? "Loading more properties…" : "Load more properties"}</button>}
        <div className="accessory-field"><Label htmlFor="accessory-analysis">Confirmed roof assessment</Label><select id="accessory-analysis" value={analysisId}
          disabled={loadingAnalyses || !analyses.length} onChange={event => { clearResult(); setAnalysisId(event.target.value); }}>
          {!analyses.length && <option value="">{loadingAnalyses ? "Loading assessments…" : "No confirmed roof yet"}</option>}
          {analyses.map(item => <option key={item.analysisId} value={item.analysisId}>{date(item.measuredAt)} · {item.roofAreaSquareMeters.toLocaleString("en-IN", { maximumFractionDigits: 1 })} m² · {item.source === "GOOGLE_SOLAR" ? "Google" : "manual"}</option>)}</select></div>
        {analysisCursor && <button type="button" className="accessory-more" disabled={loadingMoreAnalyses}
          onClick={() => void moreAnalyses()}>{loadingMoreAnalyses ? "Loading more assessments…" : "Load more assessments"}</button>}
        {contextError && <p className="accessory-error" role="alert">{contextError}</p>}
        {chosenAnalysis && <div className="accessory-roof-summary"><Home size={20} aria-hidden="true" /><div><strong>{chosenAnalysis.roofAreaSquareMeters.toLocaleString("en-IN", { maximumFractionDigits: 1 })} m²</strong><span>Confirmed roof · {chosenAnalysis.segmentCount} segment{chosenAnalysis.segmentCount === 1 ? "" : "s"}</span>
          <small>{chosenAnalysis.source === "GOOGLE_SOLAR" ? "Approximate Google Solar measurement" : "Your entered measurement"}</small></div></div>}
        {!loadingAnalyses && !analyses.length && <p className="accessory-context-help">Confirm a roof in <Link href="/app/analyze">Analyze Roof</Link> before requesting equipment advice.</p>}
      </>}
      <div className="accessory-context-foot"><ShieldCheck size={17} aria-hidden="true" /><span>Electrical and structural approval require a qualified site review.</span></div></aside>
      <div className="accessory-main"><form className="accessory-form" onSubmit={submit} noValidate><div className="accessory-form-heading"><div><span><SlidersHorizontal size={16} aria-hidden="true" /> Your planning inputs</span><h2>Describe the installation</h2><p>Enter your own demand and goal details. Blank optional fields stay unknown.</p></div><Sparkles size={25} aria-hidden="true" /></div>
        <fieldset className="accessory-demand"><legend>How do you know your electricity use?</legend><label><input type="radio" name="accessory-demand" checked={fields.demandBasis === "CONSUMPTION"} onChange={() => update("demandBasis", "CONSUMPTION")} /> Monthly units</label><label><input type="radio" name="accessory-demand" checked={fields.demandBasis === "BILL"} onChange={() => update("demandBasis", "BILL")} /> Bill and tariff</label></fieldset>
        <div className="accessory-input-grid">{fields.demandBasis === "CONSUMPTION" ? <div><Label htmlFor="accessory-kwh">Monthly electricity use (kWh)</Label><Input id="accessory-kwh" type="number" inputMode="decimal" min="1" max="100000" step="any" value={fields.monthlyKwh} onChange={event => update("monthlyKwh", event.target.value)} /><small>Read this from a recent bill.</small></div> : <><div><Label htmlFor="accessory-bill">Monthly bill (₹)</Label><Input id="accessory-bill" type="number" inputMode="decimal" min="1" max="1000000" step="any" value={fields.monthlyBill} onChange={event => update("monthlyBill", event.target.value)} /></div><div><Label htmlFor="accessory-tariff">Effective tariff (₹/kWh)</Label><Input id="accessory-tariff" type="number" inputMode="decimal" min="0.1" max="100" step="any" value={fields.tariff} onChange={event => update("tariff", event.target.value)} /></div></>}
          <div><Label htmlFor="accessory-nominal">Planning system size</Label><select id="accessory-nominal" value={fields.nominalKw} onChange={event => update("nominalKw", event.target.value)}><option value="">Choose a candidate</option>{[1, 2, 3, 5, 7.5, 10].map(size => <option value={size} key={size}>{size} kW</option>)}</select><small>The service checks this against your roof and demand.</small></div>
          <div><Label htmlFor="accessory-yield">Annual generation assumption (kWh per kW)</Label><Input id="accessory-yield" type="number" inputMode="decimal" min="500" max="2500" step="any" value={fields.generationYield} onChange={event => update("generationYield", event.target.value)} /><small>A planning assumption, not a measured yield.</small></div>
          <div><Label htmlFor="accessory-load">Sanctioned load (kW, optional)</Label><Input id="accessory-load" type="number" inputMode="decimal" min="0.25" max="1000" step="any" value={fields.sanctionedLoad} onChange={event => update("sanctionedLoad", event.target.value)} /><small>Used for review context; it is not an approval.</small></div></div>
        <fieldset className="accessory-goals"><legend>What matters to you?</legend><div>{([
          ["backupPower", "Backup during outages", BatteryCharging], ["evCharging", "Charging an EV", PlugZap],
          ["monitoring", "Seeing production and use", Activity], ["easierMaintenance", "Easier maintenance", Wrench],
        ] as const).map(([key, label, Icon]) => <label key={key}><input type="checkbox" checked={fields[key]} onChange={event => update(key, event.target.checked)} /><Icon size={19} aria-hidden="true" />{label}</label>)}</div></fieldset>
        <details className="accessory-details"><summary>Installation and site details <ChevronDown size={17} aria-hidden="true" /></summary><p>Optional observations help flag compatibility questions. Choose unknown when a detail has not been checked.</p>
          <div className="accessory-input-grid"><div><Label htmlFor="accessory-inverter">Inverter type</Label><select id="accessory-inverter" value={fields.inverterType} onChange={event => update("inverterType", event.target.value as InputFields["inverterType"])}><option value="">Not provided</option><option value="UNKNOWN">Not sure</option><option value="GRID_TIED">Grid tied</option><option value="HYBRID">Hybrid</option></select></div>
            <div><Label htmlFor="accessory-ev">EV status</Label><select id="accessory-ev" value={fields.evStatus} onChange={event => update("evStatus", event.target.value as InputFields["evStatus"])}><option value="">Not provided</option><option value="NONE">No EV planned</option><option value="PLANNING">Planning an EV</option><option value="OWNS_EV">Own an EV</option></select></div>
            <div><Label htmlFor="accessory-lightning">Lightning exposure</Label><select id="accessory-lightning" value={fields.lightningExposure} onChange={event => update("lightningExposure", event.target.value as InputFields["lightningExposure"])}><option value="">Not provided</option><option value="UNKNOWN">Not sure</option><option value="REPORTED_HIGH">Reported high exposure</option><option value="REPORTED_NORMAL">Reported normal exposure</option></select></div>
            <div><Label htmlFor="accessory-birds">Bird activity on roof</Label><select id="accessory-birds" value={fields.birdActivity} onChange={event => update("birdActivity", event.target.value as InputFields["birdActivity"])}><option value="">Not provided</option><option value="YES">Observed</option><option value="NO">Not observed</option></select></div>
            <div><Label htmlFor="accessory-cleaning">Safe cleaning access</Label><select id="accessory-cleaning" value={fields.safeCleaningAccess} onChange={event => update("safeCleaningAccess", event.target.value as InputFields["safeCleaningAccess"])}><option value="">Not provided</option><option value="UNKNOWN">Not sure</option><option value="YES">Access reported</option><option value="NO">No safe access reported</option></select></div></div></details>
        <div className="accessory-submit"><Button type="submit" disabled={busy || !chosenAnalysis}>{busy ? "Checking fit…" : "Review accessories"} <ArrowRight size={17} aria-hidden="true" /></Button><small>No product sales or paid placement.</small></div>
        {busy && <p role="status" className="accessory-status">Rechecking your saved roof, planning system and goals…</p>}
        {error && <p className="accessory-error" role="alert">{error}</p>}</form>
        {response ? <AccessoriesResult key={response.requestId} response={response} /> : <div className="accessory-awaiting"><Bolt size={23} aria-hidden="true" /><h2>Start with your installation details</h2><p>Your recommendations will appear here with compatibility, safety limits and policy relevance.</p></div>}
      </div></div></div>;
}
