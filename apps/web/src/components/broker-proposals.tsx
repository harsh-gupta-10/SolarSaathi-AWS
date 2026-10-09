"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { FileCheck2, FileClock, ShieldAlert } from "lucide-react";
import { Button, Input, Label } from "@solarsaathi/ui";
import { advisorApi, type AdvisorAnalysis } from "../lib/advisor-api";
import type { BenefitApplicantFacts } from "../lib/benefits-api";
import type { BrokerCustomer, BrokerProperty } from "../lib/broker-api";
import { brokerProposalsApi, type BrokerProposalInput, type BrokerProposalPreview,
  type BrokerProposalSnapshot, type BrokerProposalSummary } from "../lib/broker-proposals-api";
import { RoofRequestError } from "../lib/roof-api";
import { PolicyFinancialResults } from "./policy-financial-results";

type Page<T> = { items: T[]; cursor?: string; loading: boolean; error?: string };
const fmtDate = (value: string) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric",
  timeZone: "Asia/Kolkata" }).format(new Date(value));
const fmtMoney = (rupees: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR",
  maximumFractionDigits: 0 }).format(rupees);
const problem = (error: unknown) => error instanceof RoofRequestError ? error.message : "The proposal service could not be reached. Try again.";
const number = (raw: string, min: number, max: number) => {
  const value = Number(raw); return raw.trim() && Number.isFinite(value) && value >= min && value <= max ? value : undefined;
};
const maybe = (value: string) => value.trim() ? value.trim().toUpperCase().replaceAll(/\s+/g, "_") : undefined;
const yesNo = (value: string) => value === "YES" ? true : value === "NO" ? false : undefined;
interface FormFields {
  monthlyKwh: string; annualYield: string; nominalKw: string; quote: string; eligibleCost: string;
  selfUse: string; importRate: string; exportRate: string; maintenance: string;
  state: string; district: string; discom: string; customerType: string; propertyType: string;
  ownership: string; gridConnected: string; priorSubsidy: string; vendorApproved: string; equipmentApproved: string;
}
const empty: FormFields = { monthlyKwh: "", annualYield: "", nominalKw: "3", quote: "", eligibleCost: "",
  selfUse: "", importRate: "", exportRate: "", maintenance: "", state: "", district: "", discom: "",
  customerType: "", propertyType: "", ownership: "", gridConnected: "", priorSubsidy: "", vendorApproved: "", equipmentApproved: "" };

function toInput(fields: FormFields, customerId: string, propertyId: string, analysisId: string): BrokerProposalInput | undefined {
  const monthlyConsumptionKwh = number(fields.monthlyKwh, 1, 100_000);
  const generationKwhPerKwYear = number(fields.annualYield, 500, 2_500);
  const nominalKw = number(fields.nominalKw, 0.1, 100);
  const grossSystemCostRupees = number(fields.quote, 1_000, 50_000_000);
  const selfUse = number(fields.selfUse, 0, 100);
  const importTariffRupeesPerKwh = number(fields.importRate, 0.1, 100);
  const exportRateRupeesPerKwh = number(fields.exportRate, 0, 100);
  const annualMaintenanceRupees = number(fields.maintenance, 0, 5_000_000);
  const eligibleCostRupees = fields.eligibleCost.trim() ? number(fields.eligibleCost, 0.01, 10_000_000_000) : undefined;
  if (!customerId || !propertyId || !analysisId || monthlyConsumptionKwh === undefined || generationKwhPerKwYear === undefined ||
    nominalKw === undefined || grossSystemCostRupees === undefined || selfUse === undefined ||
    importTariffRupeesPerKwh === undefined || exportRateRupeesPerKwh === undefined || annualMaintenanceRupees === undefined ||
    fields.eligibleCost.trim() && (eligibleCostRupees === undefined || eligibleCostRupees > grossSystemCostRupees)) return undefined;
  if (fields.state && !/^[A-Z0-9]{1,8}$/.test(fields.state.trim().toUpperCase())) return undefined;
  if ([maybe(fields.district), maybe(fields.discom)].some(value => value && !/^[A-Z0-9][A-Z0-9_-]{0,63}$/.test(value))) return undefined;
  const applicantFacts: BenefitApplicantFacts = { country: "IN",
    ...(fields.state ? { state: fields.state.trim().toUpperCase() } : {}),
    ...(maybe(fields.district) ? { district: maybe(fields.district) } : {}),
    ...(maybe(fields.discom) ? { discom: maybe(fields.discom) } : {}),
    ...(fields.customerType ? { customerType: fields.customerType as BenefitApplicantFacts["customerType"] } : {}),
    ...(fields.propertyType ? { propertyType: fields.propertyType as BenefitApplicantFacts["propertyType"] } : {}),
    ...(fields.ownership ? { ownership: fields.ownership as BenefitApplicantFacts["ownership"] } : {}),
    ...(yesNo(fields.gridConnected) === undefined ? {} : { gridConnected: yesNo(fields.gridConnected) }),
    ...(yesNo(fields.priorSubsidy) === undefined ? {} : { priorSubsidyReceived: yesNo(fields.priorSubsidy) }),
    ...(yesNo(fields.vendorApproved) === undefined ? {} : { vendorApproved: yesNo(fields.vendorApproved) }),
    ...(yesNo(fields.equipmentApproved) === undefined ? {} : { equipmentApproved: yesNo(fields.equipmentApproved) }),
  };
  return { customerId, propertyId, analysisId, demand: { kind: "CONSUMPTION", monthlyConsumptionKwh },
    generationKwhPerKwYear, nominalKw,
    financialInputs: { grossSystemCostRupees, selfConsumptionFraction: selfUse / 100,
      importTariffRupeesPerKwh, exportRateRupeesPerKwh, annualMaintenanceRupees },
    applicantFacts, ...(eligibleCostRupees === undefined ? {} : { eligibleQuotedCostPaise: Math.round(eligibleCostRupees * 100) }) };
}

function Selector({ id, label, value, onChange, choices }: { id: string; label: string; value: string;
  onChange: (value: string) => void; choices: readonly (readonly [string, string])[] }) {
  return <div><Label htmlFor={id}>{label}</Label><select id={id} value={value} onChange={event => onChange(event.target.value)}>
    <option value="">Not provided</option>{choices.map(([code, name]) => <option key={code} value={code}>{name}</option>)}</select></div>;
}
const yesNoChoices = [["YES", "Yes"], ["NO", "No"]] as const;
const stateChoices = [
  ["AN", "Andaman and Nicobar Islands"], ["AP", "Andhra Pradesh"], ["AR", "Arunachal Pradesh"],
  ["AS", "Assam"], ["BR", "Bihar"], ["CH", "Chandigarh"], ["CT", "Chhattisgarh"],
  ["DN", "Dadra and Nagar Haveli and Daman and Diu"], ["DL", "Delhi"], ["GA", "Goa"],
  ["GJ", "Gujarat"], ["HR", "Haryana"], ["HP", "Himachal Pradesh"], ["JK", "Jammu and Kashmir"],
  ["JH", "Jharkhand"], ["KA", "Karnataka"], ["KL", "Kerala"], ["LA", "Ladakh"],
  ["LD", "Lakshadweep"], ["MP", "Madhya Pradesh"], ["MH", "Maharashtra"], ["MN", "Manipur"],
  ["ML", "Meghalaya"], ["MZ", "Mizoram"], ["NL", "Nagaland"], ["OR", "Odisha"],
  ["PY", "Puducherry"], ["PB", "Punjab"], ["RJ", "Rajasthan"], ["SK", "Sikkim"],
  ["TN", "Tamil Nadu"], ["TG", "Telangana"], ["TR", "Tripura"], ["UP", "Uttar Pradesh"],
  ["UT", "Uttarakhand"], ["WB", "West Bengal"],
] as const;

function ProposalDisplay({ proposal, saved }: { proposal: BrokerProposalPreview | BrokerProposalSnapshot; saved: boolean }) {
  const financials = proposal.financials;
  const snapshot = "proposalId" in proposal ? proposal : undefined;
  const base = financials.base;
  const statusText = proposal.status === "AVAILABLE" ? "Policy scenario available in the evaluated coverage" :
    proposal.status === "PARTIAL" ? "Partial policy scenario" : "Policy adjustment unavailable";
  return <section className="broker-proposal-result" aria-labelledby="broker-proposal-result-title"><div className="broker-proposal-result-head"><div><span>{saved ? "Saved immutable snapshot" : "Unsaved preview"}</span>
    <h3 id="broker-proposal-result-title">{statusText}</h3><p>Calculated {fmtDate(proposal.createdAt)} for property {proposal.propertyId} and analysis {proposal.analysisId}. This is a planning scenario, not approval or a vendor offer.</p></div><FileCheck2 aria-hidden="true" /></div>
    {snapshot && <div className="broker-proposal-provenance"><strong>Policy as recorded in this snapshot</strong><p>{snapshot.policyVersionIds.length ? snapshot.policyVersionIds.join(" · ") : "No verified policy version recorded"}</p>
      <p>{snapshot.sourceLastCheckedAt ? `Earliest included source check: ${fmtDate(snapshot.sourceLastCheckedAt)}.` : "No verified source check recorded."} {snapshot.freshnessStatus === "RECHECK_REQUIRED" ? "Recheck policy before sharing this scenario." : "Current only as of this saved snapshot."}</p><small>Snapshot expires {fmtDate(snapshot.expiresAt)}. Document status: not generated.</small></div>}
    <div className="broker-base"><div><span>Your gross quote</span><strong>{fmtMoney(base.input.quote.grossSystemCostRupees)}</strong></div>
      <div><span>Base payback, without benefits</span><strong>{base.totals.paybackYears === null ? "Not within 25 years" : `${base.totals.paybackYears.toFixed(1)} years`}</strong></div>
      <div><span>Base 25-year modeled cash flow</span><strong>{fmtMoney(base.totals.netSavingsOver25YearsRupees)}</strong></div></div>
    <p className="broker-base-note">Base cash flow uses entered energy and quote assumptions; it includes no subsidy or financing. Policy-adjusted amounts appear only when the verified rule evaluation supports them.</p>
    <PolicyFinancialResults response={financials} asOfSnapshot={saved} />
    {financials.benefits.result && <details className="broker-proposal-decisions"><summary>Inspect all rule decisions and coverage</summary><p>Evaluated {fmtDate(financials.benefits.result.evaluatedAt)}. {financials.benefits.result.coverageComplete ? "Coverage was marked complete in this snapshot." : "Verified coverage was incomplete."}</p>
      <ul>{financials.benefits.result.decisions.map(decision => <li key={decision.ruleId}><strong>{decision.scope} · {decision.status.toLowerCase()}</strong><span>{decision.policyId} v{decision.policyVersion} · {decision.jurisdiction} · effective {decision.effectiveFrom}{decision.effectiveTo ? `–${decision.effectiveTo}` : " onward"}</span>
        <small>Verified {fmtDate(decision.lastVerifiedAt)} · {decision.sourceChecks.map(check => check.lastCheckedAt ? `source checked ${fmtDate(check.lastCheckedAt)}` : "source check unavailable").join("; ")}</small>
        {decision.citations.map(citation => <a key={citation.documentId} href={citation.sourceUrl} target="_blank" rel="noopener noreferrer">{citation.publisherName}: {citation.documentTitle}</a>)}</li>)}</ul></details>}
    <p className="broker-base-note">No proposal PDF has been generated, and no customer or official portal received this record. Confirm the current scheme and installation details before sharing conclusions.</p>
  </section>;
}

function Archive({ customerId, onChoose, saved }: { customerId: string;
  onChoose: (snapshot: BrokerProposalSnapshot) => void; saved?: BrokerProposalSnapshot }) {
  const [page, setPage] = useState<Page<BrokerProposalSummary>>({ items: [], loading: true });
  const [busyId, setBusyId] = useState("");
  const requests = useRef<Set<AbortController>>(new Set());
  const track = () => { const request = new AbortController(); requests.current.add(request); return request; };
  const release = (request: AbortController) => { requests.current.delete(request); };
  useEffect(() => { const request = track();
    void brokerProposalsApi.list(customerId, undefined, request.signal).then(result => {
      if (!request.signal.aborted) setPage({ items: result.proposals, cursor: result.nextCursor, loading: false });
    }).catch(error => { if (!request.signal.aborted) setPage({ items: [], loading: false, error: problem(error) }); })
      .finally(() => release(request));
    const activeRequests = requests.current;
    return () => { activeRequests.forEach(active => active.abort()); activeRequests.clear(); };
  }, [customerId]);
  const items = saved ? [saved, ...page.items.filter(item => item.proposalId !== saved.proposalId)] : page.items;
  function more() {
    if (!page.cursor || page.loading) return;
    const request = track();
    setPage(previous => ({ ...previous, loading: true, error: undefined }));
    void brokerProposalsApi.list(customerId, page.cursor, request.signal).then(result => {
      if (!request.signal.aborted) setPage(previous => ({ items: [...previous.items, ...result.proposals], cursor: result.nextCursor, loading: false }));
    }).catch(error => { if (!request.signal.aborted) setPage(previous => ({ ...previous, loading: false, error: problem(error) })); })
      .finally(() => release(request));
  }
  function open(item: BrokerProposalSummary) {
    const request = track(); setBusyId(item.proposalId);
    void brokerProposalsApi.get(customerId, item.proposalId, request.signal).then(value => {
      if (!request.signal.aborted) onChoose(value);
    }).catch(error => { if (!request.signal.aborted) setPage(previous => ({ ...previous, error: problem(error) })); })
      .finally(() => { release(request); if (!request.signal.aborted) setBusyId(""); });
  }
  return <section className="broker-panel" aria-labelledby="broker-proposal-archive-title"><div className="broker-panel-head"><div><h2 id="broker-proposal-archive-title">Saved proposals</h2><p>Immutable calculation snapshots for this customer.</p></div><FileClock aria-hidden="true" /></div>
    {page.error && <p role="alert" className="broker-error">{page.error}</p>}
    {page.loading && !items.length && <p role="status" className="broker-wait">Loading saved proposals…</p>}
    {!page.loading && !items.length && !page.cursor && !page.error && <p className="broker-help">No saved proposal for this customer yet.</p>}
    {!items.length && page.cursor && <p className="broker-help">No current proposals on this page. More archived records are available.</p>}
    <ul className="broker-archive-list">{items.map(item => <li key={item.proposalId}><button type="button" disabled={!!busyId} onClick={() => open(item)}><strong>{item.status === "AVAILABLE" ? "Policy scenario" : item.status === "PARTIAL" ? "Partial policy scenario" : "Base estimate only"}</strong>
        <span>{fmtDate(item.createdAt)} · {item.policyVersionIds.length ? item.policyVersionIds.length + " policy version(s)" : "No verified policy version"}</span>
        <small>{item.freshnessStatus === "RECHECK_REQUIRED" ? "Recheck policy" : "As of snapshot"} · no document generated</small></button></li>)}</ul>
    {page.cursor && <Button type="button" variant="outline" disabled={page.loading} onClick={more}>{page.loading ? "Loading…" : "Load more proposals"}</Button>}
    {busyId && <p role="status" className="broker-wait">Opening saved proposal…</p>}</section>;
}

function Composer({ customerId, propertyId, onSaved, onPreview, onClear }: { customerId: string; propertyId: string;
  onSaved: (value: BrokerProposalSnapshot) => void; onPreview: (value: BrokerProposalPreview) => void; onClear: () => void }) {
  const [analyses, setAnalyses] = useState<Page<AdvisorAnalysis>>({ items: [], loading: true });
  const [analysisId, setAnalysisId] = useState("");
  const [fields, setFields] = useState<FormFields>(empty);
  const [preview, setPreview] = useState<BrokerProposalPreview>();
  const [busy, setBusy] = useState<"preview" | "save">();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const requests = useRef<Set<AbortController>>(new Set());
  const action = useRef<AbortController | null>(null);
  const track = () => { const controller = new AbortController(); requests.current.add(controller); return controller; };
  const release = (controller: AbortController) => { requests.current.delete(controller); };
  useEffect(() => { const controller = track();
    void advisorApi.analyses(propertyId, undefined, controller.signal).then(page => {
      if (!controller.signal.aborted) setAnalyses({ items: page.analyses, cursor: page.nextCursor, loading: false });
    }).catch(error => { if (!controller.signal.aborted) setAnalyses({ items: [], loading: false, error: problem(error) }); })
      .finally(() => release(controller));
    const activeRequests = requests.current;
    return () => { activeRequests.forEach(active => active.abort()); activeRequests.clear(); };
  }, [propertyId]);
  function change<K extends keyof FormFields>(key: K, value: FormFields[K]) {
    action.current?.abort(); action.current = null; setBusy(undefined); setPreview(undefined); setError(""); setNotice(""); onClear();
    setFields(previous => ({ ...previous, [key]: value }));
  }
  function moreAnalyses() {
    if (!analyses.cursor || analyses.loading) return;
    const controller = track();
    setAnalyses(previous => ({ ...previous, loading: true, error: undefined }));
    void advisorApi.analyses(propertyId, analyses.cursor, controller.signal).then(page => {
      if (!controller.signal.aborted) setAnalyses(previous => ({ items: [...previous.items, ...page.analyses],
        cursor: page.nextCursor, loading: false }));
    }).catch(error => { if (!controller.signal.aborted) setAnalyses(previous => ({ ...previous, loading: false, error: problem(error) })); })
      .finally(() => release(controller));
  }
  function run(event: FormEvent, kind: "preview" | "save") {
    event.preventDefault();
    const input = toInput(fields, customerId, propertyId, analysisId);
    if (!input) { setError("Choose a confirmed roof and enter values within each field’s range. The policy-eligible cost must not exceed the gross quote."); return; }
    if (kind === "save" && !preview) return;
    action.current?.abort(); const controller = track(); action.current = controller;
    setBusy(kind); setError(""); setNotice("");
    if (kind === "preview") {
      void brokerProposalsApi.preview(input, controller.signal).then(value => {
        if (!controller.signal.aborted) { setPreview(value); onPreview(value); }
      }).catch(error => { if (!controller.signal.aborted) setError(problem(error)); })
        .finally(() => { release(controller); if (action.current === controller) action.current = null;
          if (!controller.signal.aborted) setBusy(undefined); });
    } else {
      void brokerProposalsApi.save(input, controller.signal).then(value => {
        if (!controller.signal.aborted) { onSaved(value); setPreview(undefined); setNotice("Proposal snapshot saved. The service recomputed it at save time; inspect its current policy evidence below."); }
      }).catch(error => { if (!controller.signal.aborted) setError(problem(error)); })
        .finally(() => { release(controller); if (action.current === controller) action.current = null;
          if (!controller.signal.aborted) setBusy(undefined); });
    }
  }
  const numeric = (id: string, label: string, key: keyof FormFields, min: number, max: number, extra?: string) =>
    <div><Label htmlFor={id}>{label}</Label><Input id={id} type="number" inputMode="decimal" min={min} max={max} step="any" required={key !== "eligibleCost"}
      value={fields[key]} onChange={event => change(key, event.target.value)} />{extra && <small>{extra}</small>}</div>;
  return <section className="broker-panel" aria-labelledby="broker-composer-title"><div className="broker-panel-head"><div><h2 id="broker-composer-title">Prepare a fresh scenario</h2><p>All money and energy values below come from you. Policy values come only from the verified rule engine.</p></div><FileCheck2 aria-hidden="true" /></div>
    {analyses.error && <p role="alert" className="broker-error">{analyses.error}</p>}
    {analyses.loading && !analyses.items.length && <p role="status" className="broker-wait">Loading confirmed roof analyses…</p>}
    {!analyses.loading && !analyses.items.length && !analyses.cursor && !analyses.error && <p className="broker-help">This property needs a confirmed roof assessment before a proposal can be prepared.</p>}
    {!analyses.items.length && analyses.cursor && <p className="broker-help">No current analysis on this page. More analysis records are available.</p>}
    {analyses.cursor && <Button type="button" variant="outline" disabled={analyses.loading} onClick={moreAnalyses}>{analyses.loading ? "Loading…" : "Load more analyses"}</Button>}
    <form className="broker-proposal-form" onSubmit={event => run(event, "preview")}>
      <div className="broker-proposal-grid"><div><Label htmlFor="broker-proposal-analysis">Confirmed roof analysis</Label><select id="broker-proposal-analysis" required value={analysisId} onChange={event => { action.current?.abort(); action.current = null; setBusy(undefined); setAnalysisId(event.target.value); setPreview(undefined); setError(""); onClear(); }}><option value="">Choose a roof</option>{analyses.items.map(item => <option key={item.analysisId} value={item.analysisId}>{item.roofAreaSquareMeters.toFixed(1)} m² · {item.source === "GOOGLE_SOLAR" ? "Google solar data" : "user measurements"} · {fmtDate(item.measuredAt)}</option>)}</select></div>
        {numeric("broker-proposal-consumption", "Monthly electricity consumption (kWh)", "monthlyKwh", 1, 100_000)}
        {numeric("broker-proposal-yield", "Assumed annual yield (kWh per kW)", "annualYield", 500, 2_500, "Planning input; not measured production.")}
        <div><Label htmlFor="broker-proposal-system">Nominal system size</Label><select id="broker-proposal-system" value={fields.nominalKw} onChange={event => change("nominalKw", event.target.value)}>{[1, 2, 3, 5, 7.5, 10].map(value => <option key={value} value={value}>{value} kW</option>)}</select><small>The backend checks roof fit again.</small></div>
        {numeric("broker-proposal-quote", "Gross installed quote (₹)", "quote", 1_000, 50_000_000, "Use a real quote or identify the amount as your planning input.")}
        {numeric("broker-proposal-eligible", "Policy-eligible quoted cost (₹, optional)", "eligibleCost", 0.01, 10_000_000_000, "Only enter an amount when you know which quote items a rule covers.")}
        {numeric("broker-proposal-use", "Solar energy used on site (%)", "selfUse", 0, 100)}
        {numeric("broker-proposal-import", "Avoidable import energy rate (₹/kWh)", "importRate", 0.1, 100)}
        {numeric("broker-proposal-export", "Assumed export credit (₹/kWh)", "exportRate", 0, 100, "Enter 0 if no export credit is assumed; actual DISCOM settlement is unverified.")}
        {numeric("broker-proposal-maintenance", "Year-one maintenance (₹)", "maintenance", 0, 5_000_000)}</div>
      <details className="broker-facts"><summary>Customer and installation facts for eligibility</summary><p>Leave unknown facts blank. These are your declarations, not verified government records.</p><div className="broker-proposal-grid">
        <Selector id="broker-proposal-state" label="State or union territory" value={fields.state} onChange={value => change("state", value)} choices={stateChoices} />
        <div><Label htmlFor="broker-proposal-district">District code (optional)</Label><Input id="broker-proposal-district" maxLength={64} pattern="[A-Za-z0-9][A-Za-z0-9_-]*" value={fields.district} onChange={event => change("district", event.target.value)} /><small>Use the official district code or uppercase words joined with underscores.</small></div>
        <div><Label htmlFor="broker-proposal-discom">DISCOM code (optional)</Label><Input id="broker-proposal-discom" maxLength={64} pattern="[A-Za-z0-9][A-Za-z0-9_-]*" value={fields.discom} onChange={event => change("discom", event.target.value)} /><small>Use the identifier used by the verified policy record.</small></div>
        <Selector id="broker-proposal-customer-type" label="Customer type" value={fields.customerType} onChange={value => change("customerType", value)} choices={[["RESIDENTIAL", "Residential"], ["COMMERCIAL", "Commercial"], ["INDUSTRIAL", "Industrial"], ["AGRICULTURAL", "Agricultural"], ["OTHER", "Other"]]} />
        <Selector id="broker-proposal-property-type" label="Property type" value={fields.propertyType} onChange={value => change("propertyType", value)} choices={[["INDIVIDUAL_HOME", "Individual home"], ["APARTMENT", "Apartment"], ["HOUSING_SOCIETY", "Housing society"], ["BUSINESS", "Business"], ["OTHER", "Other"]]} />
        <Selector id="broker-proposal-ownership" label="Ownership" value={fields.ownership} onChange={value => change("ownership", value)} choices={[["OWNER", "Owner"], ["TENANT", "Tenant"], ["SOCIETY", "Society"], ["OTHER", "Other"]]} />
        <Selector id="broker-proposal-grid-connected" label="Grid connected" value={fields.gridConnected} onChange={value => change("gridConnected", value)} choices={yesNoChoices} />
        <Selector id="broker-proposal-prior" label="Prior subsidy received" value={fields.priorSubsidy} onChange={value => change("priorSubsidy", value)} choices={yesNoChoices} />
        <Selector id="broker-proposal-vendor" label="Vendor approval verified" value={fields.vendorApproved} onChange={value => change("vendorApproved", value)} choices={yesNoChoices} />
        <Selector id="broker-proposal-equipment" label="Equipment approval verified" value={fields.equipmentApproved} onChange={value => change("equipmentApproved", value)} choices={yesNoChoices} />
      </div></details>
      <div className="broker-proposal-actions"><Button type="submit" disabled={!!busy || !analyses.items.length}>{busy === "preview" ? "Calculating…" : "Preview proposal"}</Button>
        <Button type="button" variant="outline" disabled={!preview || !!busy} onClick={event => run(event, "save")}>{busy === "save" ? "Saving…" : "Save reviewed snapshot"}</Button></div>
      {busy && <p role="status" className="broker-wait">The backend is recomputing the roof, cash flow and current verified rule evaluation…</p>}
      {error && <p role="alert" className="broker-error">{error}</p>}{notice && <p role="status" className="broker-notice">{notice}</p>}
      <p className="broker-help">Saving recomputes the scenario and stores an immutable snapshot. It does not generate a document, send a proposal, update an application or guarantee a benefit.</p>
    </form></section>;
}

export function BrokerProposals({ customers, properties, onMoreCustomers, onMoreProperties }: {
  customers: Page<BrokerCustomer>; properties: Page<BrokerProperty>;
  onMoreCustomers: () => void; onMoreProperties: () => void;
}) {
  const [customerId, setCustomerId] = useState("");
  const [propertyId, setPropertyId] = useState("");
  const [display, setDisplay] = useState<BrokerProposalPreview | BrokerProposalSnapshot>();
  const [saved, setSaved] = useState<BrokerProposalSnapshot>();
  const selectedScope = useRef({ customerId, propertyId });
  selectedScope.current = { customerId, propertyId };
  const ownedProperties = properties.items.filter(item => item.customerId === customerId);
  function chooseCustomer(value: string) { selectedScope.current = { customerId: value, propertyId: "" }; setCustomerId(value); setPropertyId(""); setDisplay(undefined); setSaved(undefined); }
  function chooseProperty(value: string) { selectedScope.current = { customerId, propertyId: value }; setPropertyId(value); setDisplay(undefined); }
  return <div className="broker-proposal-layout"><section className="broker-panel broker-proposal-scope" aria-labelledby="broker-proposal-scope-title"><div className="broker-panel-head"><div><h2 id="broker-proposal-scope-title">Choose the account</h2><p>Customer, property and analysis must belong together.</p></div><ShieldAlert aria-hidden="true" /></div>
    <div className="broker-proposal-grid"><div><Label htmlFor="broker-proposal-customer">Customer</Label><select id="broker-proposal-customer" value={customerId} onChange={event => chooseCustomer(event.target.value)}><option value="">Choose a customer</option>{customers.items.map(item => <option key={item.customerId} value={item.customerId}>{item.name}</option>)}</select></div>
      <div><Label htmlFor="broker-proposal-property">Property</Label><select id="broker-proposal-property" value={propertyId} onChange={event => chooseProperty(event.target.value)} disabled={!customerId}><option value="">Choose a property</option>{ownedProperties.map(item => <option key={item.propertyId} value={item.propertyId}>{item.label} · {item.address}</option>)}</select></div></div>
    {customers.error && <p role="alert" className="broker-error">{customers.error}</p>}{properties.error && <p role="alert" className="broker-error">{properties.error}</p>}
    {customerId && !ownedProperties.length && !properties.loading && !properties.cursor && <p className="broker-help">This customer has no saved property. Add one in Customers.</p>}
    {customerId && !ownedProperties.length && properties.cursor && <p className="broker-help">The selected customer’s property may be in another page. Load more organization records.</p>}
    <div className="broker-proposal-page-actions">{customers.cursor && <Button type="button" variant="outline" disabled={customers.loading} onClick={onMoreCustomers}>Load more customers</Button>}
      {properties.cursor && <Button type="button" variant="outline" disabled={properties.loading} onClick={onMoreProperties}>Load more properties</Button>}</div>
    <p className="broker-help">A saved proposal is a private planning snapshot. It cannot be treated as a current government approval.</p></section>
    {customerId && <Archive key={customerId} customerId={customerId} saved={saved} onChoose={value => {
      if (value.customerId !== selectedScope.current.customerId) return;
      const loaded = properties.items.some(item => item.propertyId === value.propertyId && item.customerId === value.customerId);
      selectedScope.current = { customerId, propertyId: loaded ? value.propertyId : "" };
      setPropertyId(loaded ? value.propertyId : ""); setDisplay(value);
    }} />}
    {customerId && propertyId && <Composer key={`${customerId}:${propertyId}`} customerId={customerId} propertyId={propertyId}
      onClear={() => setDisplay(undefined)}
      onPreview={value => { if (value.customerId === selectedScope.current.customerId &&
        value.propertyId === selectedScope.current.propertyId) setDisplay(value); }}
      onSaved={value => { if (value.customerId === selectedScope.current.customerId &&
        value.propertyId === selectedScope.current.propertyId) { setSaved(value); setDisplay(value); } }} />}
    {display && <ProposalDisplay key={"proposalId" in display ? display.proposalId : `${display.propertyId}:${display.createdAt}`}
      proposal={display} saved={"proposalId" in display} />}</div>;
}
