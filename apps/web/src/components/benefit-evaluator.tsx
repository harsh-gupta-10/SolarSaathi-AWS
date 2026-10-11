"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowUpRight, BadgeCheck, CircleHelp, Landmark, ShieldAlert } from "lucide-react";
import { Button, Input, Label } from "@solarsaathi/ui";
import type { SystemDemand } from "@solarsaathi/calculations";
import { benefitsApi, type BenefitApplicantFacts, type BenefitEvaluationResponse } from "../lib/benefits-api";
import { policyFinancialApi, type PolicyFinancialEstimateResponse } from "../lib/policy-financial-api";
import type { FinancialInputs } from "../lib/financial-api";
import { RoofRequestError } from "../lib/roof-api";
import { PolicyFinancialResults } from "./policy-financial-results";
import { ApplicationStart } from "./application-start";
import type { CreateApplicationInput } from "../lib/applications-api";

const rupees = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 0, maximumFractionDigits: 2 });
const dateTime = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
const regions = [
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
const scopeName = { CENTRAL: "Central", STATE: "State", DISCOM: "DISCOM", LOCAL: "Local", OTHER: "Other" };
const statusName = { SELECTED: "Included", INELIGIBLE: "Ineligible", UNKNOWN: "More information needed", EXCLUDED: "Not in compatible stack" };
const displayCode = (code: string) => code.toLowerCase().replaceAll("_", " ").replace(/^./, letter => letter.toUpperCase());
const formatDate = (value: string) => dateTime.format(new Date(value));
const optionalCode = (value: string) => value.trim() ? value.trim().toUpperCase().replaceAll(/\s+/g, "_") : undefined;
const yesNo = (value: string) => value === "YES" ? true : value === "NO" ? false : undefined;

interface Fields {
  state: string; customerType: string; propertyType: string; ownership: string;
  gridConnected: string; priorSubsidyReceived: string; vendorApproved: string; equipmentApproved: string;
  district: string; localBody: string; discom: string; sanctionedLoadKw: string;
  installationDate: string; applicationDate: string; participatingSchemeIds: string; eligibleCostRupees: string;
}
const initialFields: Fields = { state: "", customerType: "", propertyType: "", ownership: "",
  gridConnected: "", priorSubsidyReceived: "", vendorApproved: "", equipmentApproved: "",
  district: "", localBody: "", discom: "", sanctionedLoadKw: "", installationDate: "",
  applicationDate: "", participatingSchemeIds: "", eligibleCostRupees: "" };

function Choice({ id, label, value, options, onChange, help }: { id: string; label: string; value: string;
  options: readonly (readonly [string, string])[]; onChange: (value: string) => void; help?: string }) {
  return <div><Label htmlFor={id}>{label}</Label><select id={id} value={value} onChange={event => onChange(event.target.value)}
    aria-describedby={help ? `${id}-help` : undefined}>
    <option value="">Not provided</option>{options.map(([key, name]) => <option key={key} value={key}>{name}</option>)}
  </select>{help && <p id={`${id}-help`}>{help}</p>}</div>;
}
const yesNoOptions = [["YES", "Yes"], ["NO", "No"]] as const;

function BenefitResults({ response }: { response: BenefitEvaluationResponse }) {
  const result = response.result;
  if (!result) return <div className="benefit-unavailable" role="status">
    <ShieldAlert size={24} aria-hidden="true" /><div><h4>Verified benefit calculation unavailable</h4>
      <p>No active, current, approved rule set can be evaluated for this assessment. No amount is inferred.</p>
      {!!response.reasonCodes?.length && <p>Service status: {response.reasonCodes.map(displayCode).join(" · ")}</p>}
    </div></div>;
  const sourceCurrent = (decision: typeof result.decisions[number]) => decision.sourceChecks.every(check =>
    check.fresh && check.status === "HEALTHY");
  const selected = result.decisions.filter(decision => decision.status === "SELECTED");
  const amountDetermined = selected.every(sourceCurrent) && (selected.length > 0 ||
    result.coverageComplete && result.decisions.length > 0 && result.decisions.every(decision =>
      decision.status !== "UNKNOWN" && sourceCurrent(decision)));
  return <section className="benefit-results" aria-labelledby="benefit-results-title">
    <p className="sr-only" role="status">Benefit evaluation ready. {amountDetermined ?
      `Verified rules currently include ${rupees.format(result.totalEligibleBenefitPaise / 100)}.` :
      "An amount could not be determined."} {result.coverageComplete ? "Policy coverage is complete." : "Policy coverage is incomplete."}</p>
    <div className="benefit-total"><div><span><BadgeCheck size={17} aria-hidden="true" /> Verified rule evaluation</span>
      <h4 id="benefit-results-title">{result.coverageComplete ? "Estimated eligible benefits" : "Benefits found in the verified rules"}</h4>
      <p>{!amountDetermined ? "Current source or eligibility checks are incomplete; an amount cannot be determined." :
        result.coverageComplete ? "Compatibility, exclusions and caps were applied." :
          "Policy coverage is incomplete. This amount is not a complete or maximum subsidy claim."}</p></div>
      <strong>{amountDetermined ? rupees.format(result.totalEligibleBenefitPaise / 100) : "Undetermined"}</strong></div>
    <div className="benefit-coverage" aria-label="Verified policy coverage">
      {(["central", "state", "discom", "local", "other"] as const).map(scope =>
        <span key={scope} className={response.coverage[scope] ? "covered" : "uncovered"}>{scopeName[scope.toUpperCase() as keyof typeof scopeName]}:
          {response.coverage[scope] ? " verified coverage" : " unverified coverage"}</span>)}
    </div>
    <p className="benefit-results-context">Based on your self-reported applicant details. Evaluated {formatDate(result.evaluatedAt)} · {result.optimalWithinVerifiedRules ?
      "Best compatible set within the verified rules" : "Compatibility or coverage requires review"}.
      Government approval, available funding and actual payment remain subject to each scheme.</p>
    <div className="benefit-decision-grid">
      {result.decisions.map(decision => <article key={decision.ruleId} className={`benefit-decision ${decision.status.toLowerCase()}`}>
        <div className="benefit-decision-top"><span>{scopeName[decision.scope]}</span><b>{statusName[decision.status]}</b></div>
        <h5>{decision.benefitId.replace(/^BENEFIT#/, "").replaceAll("_", " ")}</h5>
        {decision.status === "SELECTED" && decision.countedAmountPaise !== undefined &&
          <strong>{rupees.format(decision.countedAmountPaise / 100)}</strong>}
        {decision.reasonCodes.length > 0 && <p>{decision.reasonCodes.map(displayCode).join(" · ")}</p>}
        <div className="benefit-evidence"><span>{sourceCurrent(decision) ? "Verified policy" : "Previously verified rule"} {decision.policyId.replace(/^POLICY#/, "")} · version {decision.policyVersion} · {decision.jurisdiction}</span>
          <small>Rule effective {decision.effectiveFrom}{decision.effectiveTo ? ` through ${decision.effectiveTo}` : " onward"} · verified {formatDate(decision.lastVerifiedAt)}</small>
          {!sourceCurrent(decision) && <small>A current source check is missing, failed or stale. This stored rule does not establish current eligibility.</small>}
          {decision.citations.map((source, index) => <div key={`${source.documentId}-${source.documentVersion}-${index}`}>
            <a href={source.sourceUrl} target="_blank" rel="noopener noreferrer">{source.publisherName} · {source.documentTitle}<ArrowUpRight size={14} aria-hidden="true" /></a>
            <small>Document v{source.documentVersion} · {source.locator.pageNumber ? `page ${source.locator.pageNumber}` :
              source.locator.section ? `section ${source.locator.section}` : "text location"} · effective {source.effectiveFrom ?? "date not recorded"} · retrieved {formatDate(source.retrievedAt)}</small>
          </div>)}
          {decision.sourceChecks.map(check => <small key={check.sourceId}>Source {check.sourceId.replace(/^SRC#/, "")} ·
            {check.lastCheckedAt ? ` last checked ${formatDate(check.lastCheckedAt)}` : " never checked"} ·
            {check.fresh ? " current" : " needs a current check"} · {displayCode(check.status)}</small>)}
        </div>
      </article>)}
    </div>
    {!!result.warnings.length && <div className="benefit-result-warnings"><h5>Calculation limits</h5><ul>{result.warnings.map(warning =>
      <li key={warning}>{displayCode(warning)}</li>)}</ul></div>}
    <p className="benefit-request-id">Assessment {response.analysisId} · request {response.requestId}</p>
  </section>;
}

export function BenefitEvaluator({ propertyId, analysisId, demand, generationKwhPerKwYear, nominalKw,
  grossSystemCostRupees, financialInputs }: { propertyId: string; analysisId: string; demand: SystemDemand;
  generationKwhPerKwYear: number; nominalKw: number; grossSystemCostRupees: number; financialInputs?: FinancialInputs }) {
  const [fields, setFields] = useState<Fields>({ ...initialFields,
    sanctionedLoadKw: demand.sanctionedLoadKw === undefined ? "" : String(demand.sanctionedLoadKw) });
  const [response, setResponse] = useState<BenefitEvaluationResponse>();
  const [policyResponse, setPolicyResponse] = useState<PolicyFinancialEstimateResponse>();
  const [evaluatedInput, setEvaluatedInput] = useState<Omit<CreateApplicationInput, "policyId">>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  function update(key: keyof Fields, value: string) {
    request.current?.abort(); request.current = null; setBusy(false); setResponse(undefined); setPolicyResponse(undefined);
    setEvaluatedInput(undefined); setError(undefined);
    setFields(previous => ({ ...previous, [key]: value }));
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const district = optionalCode(fields.district), localBody = optionalCode(fields.localBody), discom = optionalCode(fields.discom);
    const schemes = fields.participatingSchemeIds.split(",").map(optionalCode).filter((item): item is string => !!item);
    const codePattern = /^[A-Z0-9][A-Z0-9_-]{0,63}$/;
    if ([district, localBody, discom, ...schemes].some(value => value && !codePattern.test(value)) || schemes.length > 50) {
      setError("Use letters, numbers, underscores or dashes for the optional jurisdiction and scheme codes."); return;
    }
    const load = fields.sanctionedLoadKw.trim() ? Number(fields.sanctionedLoadKw) : undefined;
    if (load !== undefined && (!Number.isFinite(load) || load < 0 || load > 100_000)) {
      setError("Enter a valid sanctioned load in kW or leave it blank."); return;
    }
    const eligibleCostRupees = fields.eligibleCostRupees.trim() ? Number(fields.eligibleCostRupees) : undefined;
    const eligibleQuotedCostPaise = eligibleCostRupees === undefined ? undefined : Math.round(eligibleCostRupees * 100);
    if (eligibleCostRupees !== undefined && (!Number.isFinite(eligibleCostRupees) || eligibleCostRupees <= 0 ||
      eligibleCostRupees > grossSystemCostRupees || !Number.isSafeInteger(eligibleQuotedCostPaise))) {
      setError("Enter a policy-eligible cost no greater than the gross quote, or leave it blank."); return;
    }
    const applicantFacts: BenefitApplicantFacts = { country: "IN",
      ...(fields.state ? { state: fields.state } : {}), ...(district ? { district } : {}),
      ...(localBody ? { localBody } : {}), ...(discom ? { discom } : {}),
      ...(fields.customerType ? { customerType: fields.customerType as BenefitApplicantFacts["customerType"] } : {}),
      ...(fields.propertyType ? { propertyType: fields.propertyType as BenefitApplicantFacts["propertyType"] } : {}),
      ...(fields.ownership ? { ownership: fields.ownership as BenefitApplicantFacts["ownership"] } : {}),
      ...(fields.gridConnected ? { gridConnected: yesNo(fields.gridConnected) } : {}),
      ...(fields.priorSubsidyReceived ? { priorSubsidyReceived: yesNo(fields.priorSubsidyReceived) } : {}),
      ...(fields.vendorApproved ? { vendorApproved: yesNo(fields.vendorApproved) } : {}),
      ...(fields.equipmentApproved ? { equipmentApproved: yesNo(fields.equipmentApproved) } : {}),
      ...(load !== undefined ? { sanctionedLoadWatts: Math.round(load * 1_000) } : {}),
      ...(fields.installationDate ? { installationDate: fields.installationDate } : {}),
      ...(fields.applicationDate ? { applicationDate: fields.applicationDate } : {}),
      ...(schemes.length ? { participatingSchemeIds: schemes } : {}),
    };
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    setBusy(true); setError(undefined); setResponse(undefined); setPolicyResponse(undefined);
    const operation = financialInputs
      ? policyFinancialApi.estimate(propertyId, analysisId, demand, generationKwhPerKwYear, nominalKw,
        financialInputs, eligibleQuotedCostPaise, applicantFacts, controller.signal)
      : benefitsApi.evaluate(propertyId, analysisId, demand, generationKwhPerKwYear, nominalKw,
        eligibleQuotedCostPaise, applicantFacts, controller.signal);
    void operation
      .then(result => { if (!controller.signal.aborted) {
        setEvaluatedInput({ propertyId, analysisId, demand, generationKwhPerKwYear, nominalKw,
          ...(eligibleQuotedCostPaise === undefined ? {} : { eligibleQuotedCostPaise }), applicantFacts });
        if ("benefits" in result) setPolicyResponse(result);
        else setResponse(result);
      } })
      .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof RoofRequestError ? cause.message :
        "The benefit service could not complete this evaluation. Try again."); })
      .finally(() => { if (request.current === controller) { request.current = null; setBusy(false); } });
  }

  return <section className="benefit-evaluator" aria-labelledby="benefit-evaluator-title">
    <div className="benefit-heading">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <span><Landmark size={17} aria-hidden="true" /> Policy checked benefits</span>
          <h3 id="benefit-evaluator-title">Check eligibility and compatible incentives</h3>
        </div>
      </div>
      <p>Use the {nominalKw} kW planning system and your {rupees.format(grossSystemCostRupees)} gross quote. The service checks active, verified rules against the saved roof and your self-reported details. Missing answers remain unknown.</p>
    </div>
    <form onSubmit={submit} noValidate className="benefit-form">
      <div className="benefit-form-grid">
        <Choice id="benefit-state" label="State or union territory" value={fields.state} options={regions}
          onChange={value => update("state", value)} help="Needed for state and many DISCOM incentives." />
        <Choice id="benefit-customer" label="Electricity customer type" value={fields.customerType}
          options={[["RESIDENTIAL", "Residential"], ["COMMERCIAL", "Commercial"], ["INDUSTRIAL", "Industrial"],
            ["AGRICULTURAL", "Agricultural"], ["OTHER", "Other"]]} onChange={value => update("customerType", value)} />
        <Choice id="benefit-property" label="Property type" value={fields.propertyType}
          options={[["INDIVIDUAL_HOME", "Individual home"], ["APARTMENT", "Apartment"],
            ["HOUSING_SOCIETY", "Housing society"], ["BUSINESS", "Business"], ["OTHER", "Other"]]}
          onChange={value => update("propertyType", value)} />
        <Choice id="benefit-ownership" label="Your relationship to the property" value={fields.ownership}
          options={[["OWNER", "Owner"], ["TENANT", "Tenant"], ["SOCIETY", "Housing society"], ["OTHER", "Other"]]}
          onChange={value => update("ownership", value)} />
        <Choice id="benefit-grid" label="Connected to the electricity grid?" value={fields.gridConnected}
          options={yesNoOptions} onChange={value => update("gridConnected", value)} />
        <Choice id="benefit-prior" label="Received a rooftop solar subsidy before?" value={fields.priorSubsidyReceived}
          options={yesNoOptions} onChange={value => update("priorSubsidyReceived", value)} />
      </div>
      <details className="benefit-more"><summary>More eligibility details, if known</summary><div className="benefit-form-grid">
        <Choice id="benefit-vendor" label="Installer approved under the relevant scheme?" value={fields.vendorApproved}
          options={yesNoOptions} onChange={value => update("vendorApproved", value)} />
        <Choice id="benefit-equipment" label="Equipment approved under the relevant scheme?" value={fields.equipmentApproved}
          options={yesNoOptions} onChange={value => update("equipmentApproved", value)} />
        <div><Label htmlFor="benefit-district">District code</Label><Input id="benefit-district" value={fields.district}
          onChange={event => update("district", event.target.value)} maxLength={64} /><p>Optional; use the official district identifier if a scheme requires one.</p></div>
        <div><Label htmlFor="benefit-local">Local body code</Label><Input id="benefit-local" value={fields.localBody}
          onChange={event => update("localBody", event.target.value)} maxLength={64} /></div>
        <div><Label htmlFor="benefit-discom">DISCOM code</Label><Input id="benefit-discom" value={fields.discom}
          onChange={event => update("discom", event.target.value)} maxLength={64} /></div>
        <div><Label htmlFor="benefit-load">Sanctioned load (kW)</Label><Input id="benefit-load" type="number" inputMode="decimal"
          min="0" max="100000" step="any" value={fields.sanctionedLoadKw} onChange={event => update("sanctionedLoadKw", event.target.value)} /></div>
        <div><Label htmlFor="benefit-eligible-cost">Policy-eligible cost (₹)</Label><Input id="benefit-eligible-cost" type="number"
          inputMode="decimal" min="0" max={grossSystemCostRupees} step="any" value={fields.eligibleCostRupees}
          onChange={event => update("eligibleCostRupees", event.target.value)} aria-describedby="benefit-eligible-cost-help" />
          <p id="benefit-eligible-cost-help">Only enter the amount your official scheme and itemized quote treat as eligible. The full gross quote is not assumed eligible.</p></div>
        <div><Label htmlFor="benefit-installed">Installation date</Label><Input id="benefit-installed" type="date"
          value={fields.installationDate} onChange={event => update("installationDate", event.target.value)} /></div>
        <div><Label htmlFor="benefit-applied">Application date</Label><Input id="benefit-applied" type="date"
          value={fields.applicationDate} onChange={event => update("applicationDate", event.target.value)} /></div>
        <div className="benefit-scheme-input"><Label htmlFor="benefit-schemes">Scheme IDs already joined</Label><Input id="benefit-schemes"
          value={fields.participatingSchemeIds} onChange={event => update("participatingSchemeIds", event.target.value)}
          placeholder="Comma-separated IDs, if known" maxLength={500} /></div>
      </div></details>
      <div className="benefit-form-footer"><Button type="submit" disabled={busy}>{busy ? "Checking verified rules…" : financialInputs ? "Estimate with verified benefits" : "Evaluate benefits"}</Button>
        <p><CircleHelp size={15} aria-hidden="true" /> This is an eligibility estimate, not a government approval or application.</p></div>
      {busy && <p role="status" className="system-form-status">Checking the saved system, current sources and rule compatibility…</p>}
      {error && <p role="alert" className="form-error">{error}</p>}
    </form>
    {response && <BenefitResults response={response} />}
    {response && evaluatedInput && <ApplicationStart key={response.requestId} response={response} input={evaluatedInput} />}
    {policyResponse && <><PolicyFinancialResults response={policyResponse} />
      {policyResponse.benefits.result && <details className="policy-financial-decisions"><summary>View rule decisions and source details</summary>
        <BenefitResults response={policyResponse.benefits} /></details>}
      {evaluatedInput && <ApplicationStart key={policyResponse.requestId} response={policyResponse.benefits} input={evaluatedInput} />}</>}
  </section>;
}
