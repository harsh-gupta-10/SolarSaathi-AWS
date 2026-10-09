"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowRight, ArrowUpRight, BookOpen, CircleHelp, FileCheck2, Home, Leaf,
  MessageSquareText, ShieldCheck, Sparkles } from "lucide-react";
import { Button, Input, Label } from "@solarsaathi/ui";
import { useAuth } from "../auth/auth-provider";
import { advisorApi, type AdvisorAnalysis, type AdvisorResponse, type AdvisorScenario } from "../lib/advisor-api";
import { applicationsApi, type PropertyChoice, type SolarApplication } from "../lib/applications-api";
import { RoofRequestError } from "../lib/roof-api";

const date = (value: string) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric",
  timeZone: "Asia/Kolkata" }).format(new Date(value));
const dateTime = (value: string) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric",
  hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }).format(new Date(value));
const displayCode = (value: string) => value.replace(/^(?:BENEFIT|POLICY)#/, "").toLowerCase()
  .replaceAll("_", " ").replace(/^./, first => first.toUpperCase());
const errorText = (error: unknown) => error instanceof RoofRequestError ? error.message :
  "The advisor could not complete that request. Try again.";
const provenance: Record<AdvisorResponse["cards"][number]["provenance"], string> = {
  GOOGLE_SOLAR: "Google Solar modeled roof", USER_MEASURED: "Your roof measurements",
  DETERMINISTIC_CALCULATION: "Calculated planning result", VERIFIED_POLICY: "Verified policy record",
  USER_REPORTED: "Your application record",
};
const cardName = { ROOF: "Roof", SYSTEM: "System", FINANCIAL: "Financial", BENEFIT: "Benefit",
  APPLICATION: "Application" };
const suggestedQuestions = [
  "What does my roof assessment tell me?",
  "What should I check before applying for a benefit?",
  "What should I do next with my application?",
];

interface ScenarioFields {
  monthlyKwh: string; yieldPerKw: string; nominalKw: string; grossCost: string;
  selfUsePercent: string; importTariff: string; exportRate: string; annualMaintenance: string;
  eligibleCost: string; state: string; customerType: string;
}
const emptyScenario: ScenarioFields = { monthlyKwh: "", yieldPerKw: "", nominalKw: "", grossCost: "",
  selfUsePercent: "", importTariff: "", exportRate: "", annualMaintenance: "", eligibleCost: "",
  state: "", customerType: "" };
const number = (value: string, min: number, max: number): number | undefined => {
  const parsed = Number(value);
  return value.trim() && Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : undefined;
};
function scenarioFrom(fields: ScenarioFields): AdvisorScenario | undefined {
  const monthlyConsumptionKwh = number(fields.monthlyKwh, 0.01, 100_000);
  const generationKwhPerKwYear = number(fields.yieldPerKw, 500, 2_500);
  const nominalKw = number(fields.nominalKw, 0.1, 100);
  const grossSystemCostRupees = number(fields.grossCost, 0.01, 100_000_000);
  const selfUsePercent = number(fields.selfUsePercent, 0, 100);
  const importTariffRupeesPerKwh = number(fields.importTariff, 0.01, 1_000);
  const exportRateRupeesPerKwh = number(fields.exportRate, 0, 1_000);
  const annualMaintenanceRupees = number(fields.annualMaintenance, 0, 10_000_000);
  const eligibleCost = fields.eligibleCost.trim() ? number(fields.eligibleCost, 0.01, grossSystemCostRupees ?? 0) : undefined;
  const eligibleQuotedCostPaise = eligibleCost === undefined ? undefined : Math.round(eligibleCost * 100);
  const state = fields.state.trim().toUpperCase();
  if (monthlyConsumptionKwh === undefined || generationKwhPerKwYear === undefined || nominalKw === undefined ||
    grossSystemCostRupees === undefined || selfUsePercent === undefined || importTariffRupeesPerKwh === undefined ||
    exportRateRupeesPerKwh === undefined || annualMaintenanceRupees === undefined ||
    fields.eligibleCost.trim() && (eligibleCost === undefined || !Number.isSafeInteger(eligibleQuotedCostPaise)) ||
    state && !/^[A-Z]{2}$/.test(state)) return undefined;
  return { demand: { kind: "CONSUMPTION", monthlyConsumptionKwh }, generationKwhPerKwYear, nominalKw,
    financialInputs: { grossSystemCostRupees, selfConsumptionFraction: selfUsePercent / 100,
      importTariffRupeesPerKwh, exportRateRupeesPerKwh, annualMaintenanceRupees },
    applicantFacts: { country: "IN", ...(state ? { state } : {}),
      ...(fields.customerType ? { customerType: fields.customerType as AdvisorScenario["applicantFacts"]["customerType"] } : {}) },
    ...(eligibleQuotedCostPaise === undefined ? {} : { eligibleQuotedCostPaise }) };
}

function ScenarioForm({ fields, onChange }: { fields: ScenarioFields; onChange: (key: keyof ScenarioFields, value: string) => void }) {
  const numeric: Array<{ key: keyof ScenarioFields; label: string; hint?: string; min: string; max: string }> = [
    { key: "monthlyKwh", label: "Monthly electricity use (kWh)", min: "0.01", max: "100000" },
    { key: "yieldPerKw", label: "Assumed annual generation (kWh per kW)", min: "500", max: "2500",
      hint: "A planning assumption, not a measured yield." },
    { key: "nominalKw", label: "Planning system size (kW)", min: "0.1", max: "100" },
    { key: "grossCost", label: "Your gross system quote (₹)", min: "0.01", max: "100000000" },
    { key: "selfUsePercent", label: "Energy used at home (%)", min: "0", max: "100" },
    { key: "importTariff", label: "Avoidable import tariff (₹/kWh)", min: "0.01", max: "1000" },
    { key: "exportRate", label: "Assumed export value (₹/kWh)", min: "0", max: "1000" },
    { key: "annualMaintenance", label: "Annual maintenance (₹)", min: "0", max: "10000000" },
    { key: "eligibleCost", label: "Policy-eligible quote amount (₹, optional)", min: "0.01", max: "100000000",
      hint: "Use only an itemized amount the official scheme treats as eligible." },
  ];
  return <div className="advisor-scenario-fields"><p>Enter your own planning inputs. The backend recalculates the saved roof and current rules; the advisor only explains that result.</p>
    <div className="advisor-scenario-grid">{numeric.map(field => <div key={field.key}><Label htmlFor={`advisor-${field.key}`}>{field.label}</Label>
      <Input id={`advisor-${field.key}`} type="number" inputMode="decimal" min={field.min} max={field.max} step="any"
        value={fields[field.key]} onChange={event => onChange(field.key, event.target.value)} />
      {field.hint && <small>{field.hint}</small>}</div>)}
      <div><Label htmlFor="advisor-state">State or UT code (optional)</Label><Input id="advisor-state" maxLength={2}
        value={fields.state} onChange={event => onChange("state", event.target.value)} placeholder="For example, MH" />
        <small>Leave unknown details blank. This may limit policy guidance.</small></div>
      <div><Label htmlFor="advisor-customer">Electricity customer type (optional)</Label><select id="advisor-customer"
        value={fields.customerType} onChange={event => onChange("customerType", event.target.value)}>
        <option value="">Not provided</option><option value="RESIDENTIAL">Residential</option>
        <option value="COMMERCIAL">Commercial</option><option value="INDUSTRIAL">Industrial</option>
        <option value="AGRICULTURAL">Agricultural</option><option value="OTHER">Other</option></select></div>
    </div></div>;
}

export function AdvisorAnswer({ response, demo = false }: { response: AdvisorResponse; demo?: boolean }) {
  const chosen = new Set(response.selectedCardIds);
  const cards = response.cards.filter(card => chosen.has(card.id));
  return <section className="advisor-result" aria-labelledby="advisor-answer-title">
    <div className="advisor-answer"><div className="advisor-answer-top"><span><MessageSquareText size={17} aria-hidden="true" /> {demo ? "Synthetic answer preview" :
      response.status === "ANSWERED" ? "Grounded answer" : "More context needed"}</span>
      <small>{response.mode === "BEDROCK_FACT_SELECTION" ? "AI organized sourced facts" : "Deterministic summary"}</small></div>
      <h2 id="advisor-answer-title">{response.status === "ANSWERED" ? "Here is what the record supports" :
        "The available record cannot answer fully"}</h2>
      <p className="advisor-answer-text">{response.answer}</p>
      <p className="advisor-answer-limit">The advisor explains stored measurements, calculations and records. It cannot decide eligibility, change a calculation, submit an application or approve an installation.</p>
    </div>
    {!!response.missingContext.length && <div className="advisor-context-gap"><h3>To answer more precisely</h3><ul>{response.missingContext.map(item =>
      <li key={item}>{item}</li>)}</ul></div>}
    <div className="advisor-evidence"><div className="advisor-evidence-heading"><div><span><BookOpen size={16} aria-hidden="true" /> Source trail</span>
      <h3>Facts used in this answer</h3></div><small>{cards.length} selected card{cards.length === 1 ? "" : "s"}</small></div>
      {cards.length ? <ol>{cards.map((card, index) => <li key={card.id} className="advisor-source-card">
        <span className="advisor-source-index" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
        <div><div className="advisor-source-top"><b>{cardName[card.kind]}</b><span>{demo ? "Synthetic fixture" : provenance[card.provenance]}</span></div>
          <p>{card.statement}</p>
          {card.provenance === "VERIFIED_POLICY" && (demo ? <div className="advisor-policy-details">
            <p>Fictional policy and citation for layout preview. No source was checked.</p>
          </div> : <div className="advisor-policy-details">
            <p>Policy {card.policyId} · version {card.policyVersion} · {card.jurisdiction} · verified {date(card.lastVerifiedAt!)}</p>
            <p>Effective {card.effectiveFrom}{card.effectiveTo ? ` through ${card.effectiveTo}` : " onward"} · verification: verified</p>
            {card.sourceChecks?.map(check => <p key={check.sourceId}>Source {check.sourceId} · {check.lastCheckedAt ?
              `last checked ${dateTime(check.lastCheckedAt)}` : "last check unavailable"} · {check.fresh ? "current" : "needs review"} · {displayCode(check.status)}</p>)}
            {card.citations?.map((citation, citationIndex) => <a key={`${citation.documentId}-${citationIndex}`}
              href={citation.sourceUrl} target="_blank" rel="noopener noreferrer">{citation.publisherName} · {citation.documentTitle}
              <span>Document v{citation.documentVersion}{citation.locator.pageNumber ? ` · page ${citation.locator.pageNumber}` :
                citation.locator.section ? ` · ${citation.locator.section}` : ""}</span><ArrowUpRight size={15} aria-hidden="true" /></a>)}
          </div>)}</div></li>)}</ol> : <p className="advisor-no-sources">No answer cards were selected. Ask about a saved roof or add the missing context above.</p>}
    </div>
    {!!response.caveats.length && <div className="advisor-caveats"><h3>Limits to keep in mind</h3><ul>{response.caveats.map(item =>
      <li key={item}>{item}</li>)}</ul></div>}
    {!demo && <p className="advisor-request">Request {response.requestId}. Each answer is generated for the current selection and is not saved as an official decision.</p>}
  </section>;
}

export function AdvisorWorkspace() {
  const { status, profile } = useAuth();
  const owner = status === "signedIn" ? profile?.userId : undefined;
  const ownerRef = useRef(owner);
  const queryRef = useRef<AbortController | null>(null);
  const [properties, setProperties] = useState<PropertyChoice[]>([]);
  const [propertyCursor, setPropertyCursor] = useState<string>();
  const [propertyId, setPropertyId] = useState("");
  const [analyses, setAnalyses] = useState<AdvisorAnalysis[]>([]);
  const [analysisCursor, setAnalysisCursor] = useState<string>();
  const [analysisId, setAnalysisId] = useState("");
  const [applications, setApplications] = useState<SolarApplication[]>([]);
  const [applicationId, setApplicationId] = useState("");
  const [question, setQuestion] = useState("");
  const [includeScenario, setIncludeScenario] = useState(false);
  const [scenarioFields, setScenarioFields] = useState(emptyScenario);
  const [response, setResponse] = useState<AdvisorResponse>();
  const [loadingProperties, setLoadingProperties] = useState(true);
  const [loadingContext, setLoadingContext] = useState(false);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string>();
  const [contextError, setContextError] = useState<string>();
  const ownerEpoch = useRef(0);
  const propertyEpoch = useRef(0);

  useEffect(() => {
    ownerRef.current = owner; ownerEpoch.current += 1;
    queryRef.current?.abort(); queryRef.current = null;
    setProperties([]); setPropertyCursor(undefined); setPropertyId(""); setAnalyses([]); setAnalysisId("");
    setAnalysisCursor(undefined); setApplications([]); setApplicationId(""); setResponse(undefined);
    setError(undefined); setContextError(undefined); setAsking(false);
    if (!owner) return;
    const controller = new AbortController();
    setLoadingProperties(true);
    void applicationsApi.properties(undefined, controller.signal).then(page => {
      if (controller.signal.aborted) return;
      setProperties(page.properties); setPropertyCursor(page.nextCursor);
      setPropertyId(page.properties[0]?.propertyId ?? "");
    }).catch(failure => { if (!controller.signal.aborted) setError(errorText(failure)); })
      .finally(() => { if (!controller.signal.aborted) setLoadingProperties(false); });
    return () => controller.abort();
  }, [owner]);
  useEffect(() => {
    propertyEpoch.current += 1;
    queryRef.current?.abort(); queryRef.current = null;
    setAnalyses([]); setAnalysisCursor(undefined); setAnalysisId(""); setApplications([]);
    setApplicationId(""); setResponse(undefined); setContextError(undefined); setAsking(false);
    if (!owner || !propertyId) return;
    const controller = new AbortController();
    setLoadingContext(true);
    void advisorApi.analyses(propertyId, undefined, controller.signal).then(page => {
      if (controller.signal.aborted) return;
      setAnalyses(page.analyses); setAnalysisCursor(page.nextCursor);
      setAnalysisId(page.analyses[0]?.analysisId ?? "");
    }).catch(failure => { if (!controller.signal.aborted) setContextError(errorText(failure)); })
      .finally(() => { if (!controller.signal.aborted) setLoadingContext(false); });
    void applicationsApi.list(propertyId, undefined, controller.signal).then(page => {
      if (!controller.signal.aborted) setApplications(page.applications);
    }).catch(() => { /* Application context is optional; roof questions remain available. */ });
    return () => controller.abort();
  }, [owner, propertyId]);
  useEffect(() => {
    queryRef.current?.abort(); queryRef.current = null;
    setResponse(undefined); setError(undefined); setAsking(false); setApplicationId("");
  }, [analysisId]);

  const visible = status === "signedIn" && !!owner && ownerRef.current === owner;
  const chosenAnalysis = analyses.find(item => item.analysisId === analysisId);
  const matchingApplications = applications.filter(item => item.analysisId === analysisId);
  function clearAnswer() { queryRef.current?.abort(); queryRef.current = null; setAsking(false); setResponse(undefined); setError(undefined); }
  async function moreProperties() {
    if (!propertyCursor) return;
    const epoch = ownerEpoch.current;
    try { const page = await applicationsApi.properties(propertyCursor);
      if (epoch !== ownerEpoch.current) return;
      setProperties(previous => [...previous, ...page.properties]); setPropertyCursor(page.nextCursor);
    } catch (failure) { if (epoch === ownerEpoch.current) setError(errorText(failure)); }
  }
  async function moreAnalyses() {
    if (!analysisCursor || !propertyId) return;
    const epoch = propertyEpoch.current;
    try { const page = await advisorApi.analyses(propertyId, analysisCursor);
      if (epoch !== propertyEpoch.current) return;
      setAnalyses(previous => [...previous, ...page.analyses]); setAnalysisCursor(page.nextCursor);
    } catch (failure) { if (epoch === propertyEpoch.current) setContextError(errorText(failure)); }
  }
  function ask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!propertyId || !analysisId || !question.trim()) { setError("Choose a confirmed roof and enter a question first."); return; }
    if (question.trim().length < 3 || question.trim().length > 500) { setError("Use a question from 3 to 500 characters."); return; }
    const scenario = includeScenario ? scenarioFrom(scenarioFields) : undefined;
    if (includeScenario && !scenario) { setError("Check the planning inputs. All required numbers must be valid, and eligible cost cannot exceed the gross quote."); return; }
    queryRef.current?.abort();
    const controller = new AbortController(); queryRef.current = controller;
    setAsking(true); setError(undefined); setResponse(undefined);
    void advisorApi.ask({ propertyId, analysisId, question: question.trim(),
      ...(applicationId ? { applicationId } : {}), ...(scenario ? { scenario } : {}) }, controller.signal)
      .then(result => { if (!controller.signal.aborted) setResponse(result); })
      .catch(failure => { if (!controller.signal.aborted) setError(errorText(failure)); })
      .finally(() => { if (queryRef.current === controller) { queryRef.current = null; setAsking(false); } });
  }

  if (!visible) return <section className="advisor-signin"><ShieldCheck size={27} aria-hidden="true" />
    <h1>{status === "unconfigured" ? "Advisor is not connected here yet" : "Sign in to ask about your solar plan"}</h1>
    <p>{status === "unconfigured" ? "Account sign-in and the advisor API are not configured in this deployment. A separate synthetic preview shows the answer layout." :
      "The advisor uses your saved property and confirmed roof. It does not answer from a sample property."}</p>
    {status === "signedOut" && <Button asChild><Link href="/auth/sign-in">Sign in</Link></Button>}
    {(status === "signedOut" || status === "unconfigured") && <Button asChild variant="outline"><Link href="/demo/advisor">View synthetic preview</Link></Button>}
    {status === "loading" && <p role="status">Checking your account…</p>}</section>;
  return <div className="advisor-page"><div className="advisor-hero"><div><span className="advisor-kicker"><Leaf size={16} aria-hidden="true" /> Your solar evidence desk</span>
    <h1>Ask what your plan supports.</h1><p>Get a plain-language explanation from your confirmed roof, calculated scenarios, verified policy records and your reported application progress.</p>
    <small>AI may organize facts. It cannot invent benefits, change eligibility or confirm engineering safety.</small></div>
    <div className="advisor-hero-mark" aria-hidden="true"><Home size={54} /><span /><FileCheck2 size={35} /></div></div>
    {error && <p className="advisor-error" role="alert">{error}</p>}
    <div className="advisor-layout"><aside className="advisor-context" aria-labelledby="advisor-context-title"><div className="advisor-context-heading"><span>01 / Context</span><h2 id="advisor-context-title">Choose your records</h2><p>Only records you can access through your account appear here.</p></div>
      {loadingProperties ? <p role="status">Loading your properties…</p> : !properties.length ? <div className="advisor-empty"><CircleHelp size={22} aria-hidden="true" /><p>No saved property is available yet.</p>
        <Button asChild variant="outline"><Link href="/app/analyze">Analyze a roof <ArrowRight size={15} aria-hidden="true" /></Link></Button></div> : <>
        <div className="advisor-field"><Label htmlFor="advisor-property">Property</Label><select id="advisor-property" value={propertyId}
          onChange={event => setPropertyId(event.target.value)}>{properties.map(property => <option key={property.propertyId}
            value={property.propertyId}>{property.label} · {property.address}</option>)}</select></div>
        {propertyCursor && <Button variant="ghost" size="sm" onClick={() => void moreProperties()}>Load more properties</Button>}
        {loadingContext ? <p role="status">Loading confirmed roofs…</p> : contextError ? <p role="alert" className="advisor-error">{contextError}</p> :
          !analyses.length ? <div className="advisor-empty"><p>No current confirmed roof assessment is available for this property.</p>
            <Link href="/app/analyze">Confirm a roof assessment <ArrowRight size={14} aria-hidden="true" /></Link></div> : <>
          <div className="advisor-field"><Label htmlFor="advisor-analysis">Confirmed roof assessment</Label><select id="advisor-analysis"
            value={analysisId} onChange={event => setAnalysisId(event.target.value)}>{analyses.map(item => <option key={item.analysisId}
              value={item.analysisId}>{date(item.measuredAt)} · {item.roofAreaSquareMeters.toFixed(1)} m² · {item.source === "MANUAL" ? "your measurements" : "Google Solar model"}</option>)}</select></div>
          {analysisCursor && <Button variant="ghost" size="sm" onClick={() => void moreAnalyses()}>Load more assessments</Button>}
          {chosenAnalysis && <div className="advisor-selected-roof"><b>{chosenAnalysis.roofAreaSquareMeters.toFixed(1)} m²</b>
            <span>{chosenAnalysis.segmentCount} modeled segment{chosenAnalysis.segmentCount === 1 ? "" : "s"} · {chosenAnalysis.source === "MANUAL" ? "user measured" : "Google Solar"}</span>
            <small>Planning geometry only. Structural safety is not assessed.</small></div>}
          {!!matchingApplications.length && <div className="advisor-field"><Label htmlFor="advisor-application">Application record (optional)</Label>
            <select id="advisor-application" value={applicationId} onChange={event => { clearAnswer(); setApplicationId(event.target.value); }}>
              <option value="">No application selected</option>{matchingApplications.map(item => <option key={item.applicationId}
                value={item.applicationId}>{displayCode(item.benefitId)} · policy v{item.policyVersion}</option>)}</select>
            <small>Progress is self-reported, not a live portal status.</small></div>}</>}
      </>}
      <div className="advisor-context-foot"><ShieldCheck size={17} aria-hidden="true" /><span>Your question is checked against this selection. No official application is submitted.</span></div>
    </aside>
    <div className="advisor-main"><form onSubmit={ask} className="advisor-compose" noValidate><span className="advisor-section-index">02 / Question</span>
      <h2>What would you like to understand?</h2><p>Choose a starting question or write your own. Answers stay tied to the saved records you select.</p>
      <div className="advisor-suggestions">{suggestedQuestions.map(item => <button key={item} type="button" onClick={() => { clearAnswer(); setQuestion(item); }}>
        {item}<ArrowRight size={14} aria-hidden="true" /></button>)}</div>
      <Label htmlFor="advisor-question">Your question</Label><textarea id="advisor-question" value={question} maxLength={500} rows={4}
        onChange={event => { clearAnswer(); setQuestion(event.target.value); }} placeholder="For example, what should I verify before I apply?" />
      <p className="advisor-character-count">{question.length} / 500 characters</p>
      <label className="advisor-scenario-toggle"><input type="checkbox" checked={includeScenario}
        onChange={event => { clearAnswer(); setIncludeScenario(event.target.checked); }} /> Include a cost and benefit scenario</label>
      {includeScenario && <ScenarioForm fields={scenarioFields} onChange={(key, value) => { clearAnswer();
        setScenarioFields(previous => ({ ...previous, [key]: value })); }} />}
      <div className="advisor-compose-footer"><Button type="submit" disabled={asking || loadingContext || !analysisId || !question.trim()}>
        <Sparkles size={17} aria-hidden="true" />{asking ? "Checking records…" : "Explain from my records"}</Button>
        <small>No answer is a government approval or a structural assessment.</small></div>
      {asking && <p role="status" className="advisor-busy">Checking the saved roof, current sources and selected application record…</p>}
    </form>
      {response ? <AdvisorAnswer response={response} /> : <div className="advisor-awaiting"><BookOpen size={25} aria-hidden="true" />
        <h2>Your answer and source trail will appear here.</h2><p>Choose a confirmed roof and ask a question to see what the available records support.</p></div>}
    </div></div></div>;
}
