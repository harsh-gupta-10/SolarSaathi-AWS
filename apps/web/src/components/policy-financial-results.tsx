import { ArrowUpRight, CircleHelp, ShieldAlert } from "lucide-react";
import type { PolicyFinancialEstimateResponse } from "../lib/policy-financial-api";

const money = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const years = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 1 });
const date = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
const formatMoney = (paise: number) => money.format(paise / 100);
const formatPayback = (value: number | null) => value === null ? "Not within 25 years" : `${years.format(value)} years`;
const names = { CENTRAL: "Central", STATE: "State", DISCOM: "DISCOM", LOCAL: "Local body", OTHER: "Other" } as const;
const scopes = ["CENTRAL", "STATE", "DISCOM", "LOCAL", "OTHER"] as const;

function PolicySources({ response, asOfSnapshot = false }: { response: PolicyFinancialEstimateResponse; asOfSnapshot?: boolean }) {
  const selected = response.benefits.result?.decisions.filter(decision => decision.status === "SELECTED") ?? [];
  if (!selected.length) return null;
  return <div className="policy-financial-sources"><h5>Rules included in this scenario</h5><ul>{selected.map(decision =>
    <li key={decision.ruleId}><strong>{names[decision.scope]} · {decision.benefitId.replace(/^BENEFIT#/, "").replaceAll("_", " ")}</strong>
      <span>Policy {decision.policyId.replace(/^POLICY#/, "")} v{decision.policyVersion} · {decision.jurisdiction} · effective {decision.effectiveFrom}{decision.effectiveTo ? ` to ${decision.effectiveTo}` : " onward"} · verified {date.format(new Date(decision.lastVerifiedAt))}</span>
      {decision.citations.map((citation, index) => <a key={`${citation.documentId}-${index}`} href={citation.sourceUrl} target="_blank" rel="noopener noreferrer">
        {citation.publisherName} · {citation.documentTitle} · document v{citation.documentVersion}<ArrowUpRight size={14} aria-hidden="true" /></a>)}
      {decision.sourceChecks.map(check => <small key={check.sourceId}>{check.lastCheckedAt ? `Source last checked ${date.format(new Date(check.lastCheckedAt))}` : "Source check unavailable"} · {check.fresh ? asOfSnapshot ? "fresh when evaluated" : "current at evaluation" : "needs review"} · {check.status.toLowerCase()}</small>)}
    </li>)}</ul></div>;
}

export function PolicyFinancialResults({ response, asOfSnapshot = false }: { response: PolicyFinancialEstimateResponse; asOfSnapshot?: boolean }) {
  const projection = response.projection;
  if (!projection) return <section className="policy-financial-unavailable" role="status" aria-labelledby="policy-financial-unavailable-title">
    <ShieldAlert size={25} aria-hidden="true" /><div><h4 id="policy-financial-unavailable-title">Policy-adjusted estimate unavailable</h4>
      <p>The base cash flow remains available above. {asOfSnapshot ? "No benefit in this saved evaluation could be modeled as an upfront deduction from the quote." : "No current, confirmed benefit can be modeled as an upfront deduction from this quote."} Adjusted net cost and payback are not shown.</p>
      {response.reasonCodes?.includes("NO_UPFRONT_MODELABLE_BENEFITS") && <p>Other selected benefits may exist, but their form or timing cannot be represented as an upfront cost reduction. See the rule decisions below.</p>}
      {response.benefits.result && <p>Reviewed rule decisions are available below. Coverage may still be incomplete.</p>}
    </div></section>;

  const missingCoverage = !projection.coverageComplete;
  const missingFacts = projection.warnings.includes("BENEFIT_AMOUNT_UNKNOWN");
  const partial = projection.status === "PARTIAL";
  return <section className="policy-financial-results" aria-labelledby="policy-financial-title">
    <p className="sr-only" role="status">Policy-adjusted scenario ready. {missingCoverage ? "Policy coverage is incomplete." : missingFacts ? "Some eligibility facts are unknown." : asOfSnapshot ? "Verified rule coverage was complete when saved." : "Current verified rule coverage is complete."} Net upfront scenario: {formatMoney(projection.netUpfrontCostPaise)}.</p>
    <div className="policy-financial-heading"><div><span>Policy-backed financial scenario</span><h4 id="policy-financial-title">From your quote to a modeled net cost</h4></div>
      <span className="policy-financial-coverage">{missingCoverage ? "Partial verified coverage" : partial ? "Eligibility details incomplete" : asOfSnapshot ? "Verified when saved" : "Current verified coverage"}</span></div>
    <div className="policy-financial-ledger">
      <div className="policy-financial-gross"><span>Gross installed quote</span><strong>{formatMoney(projection.grossCostPaise)}</strong><small>Your quote, before any benefit</small></div>
      <div className="policy-financial-breakdown" role="group" aria-label="Selected benefits by scope">
        {scopes.map(scope => {
          const amount = projection.selectedByScopePaise[scope];
          const covered = response.benefits.coverage[scope.toLowerCase() as Lowercase<typeof scope>];
          const knownZero = covered && !response.benefits.result?.decisions.some(decision => decision.scope === scope && decision.status === "UNKNOWN");
          return <div key={scope}><span>{names[scope]}</span><strong>{amount > 0 || knownZero ? formatMoney(amount) : "Undetermined"}</strong>
            {!covered && <small>{amount > 0 ? "Other rules may apply" : "Coverage unverified"}</small>}</div>;
        })}
        <div className="policy-financial-total"><span>Total selected benefits</span><strong>{formatMoney(projection.totalEligibleBenefitPaise)}</strong></div>
        <div className="policy-financial-upfront"><span>Modeled upfront reduction</span><strong>{formatMoney(projection.modeledUpfrontBenefitPaise)}</strong></div>
      </div>
      <div className="policy-financial-net"><span>Modeled net upfront cost</span><strong>{formatMoney(projection.netUpfrontCostPaise)}</strong><small>Assumes eligible upfront incentives are paid at installation</small></div>
    </div>
    <div className="policy-financial-outcomes"><div><span>Adjusted payback scenario</span><strong>{formatPayback(projection.totals.paybackYears)}</strong><small>Base estimate: {formatPayback(response.base.totals.paybackYears)}. Benefit modeled upfront; actual payment timing is unverified.</small></div>
      <div><span>Modeled cash flow after 25 years</span><strong>{money.format(projection.totals.netSavingsOver25YearsRupees)}</strong><small>After the modeled upfront benefit, quote, and operating cash flow.</small></div></div>
    <div className="policy-financial-caveat"><CircleHelp size={18} aria-hidden="true" /><div><p>{missingCoverage ? asOfSnapshot ? "This saved estimate was partial within the verified rules available at that time. Unchecked central, state, DISCOM, local or other programs could change the outcome; recheck policy before sharing it." : "This is a partial estimate from the verified rules available for this assessment. Unchecked central, state, DISCOM, local or other programs could change the outcome." : missingFacts ? "Some applicant details remain unknown. Their eligibility decisions are excluded from this estimate until those details are provided." : asOfSnapshot ? "This saved scenario used the verified rule set available when it was calculated. Recheck policy before sharing it." : "This scenario uses the current verified rule set for the details provided."}</p>
      <p>The model assumes only eligible upfront incentives reduce the quote immediately. Scheme payment timing, application approval and receipt are not verified. The base estimate above remains the unsubsidized comparison.</p>
      {projection.nonUpfrontBenefitPaise > 0 && <p>{formatMoney(projection.nonUpfrontBenefitPaise)} in selected other benefits is listed above but excluded from the upfront reduction and adjusted payback. Its cash timing or form requires separate review.</p>}
      {projection.excessBenefitPaise > 0 && <p>Included benefits above the gross quote are disclosed in the total, but the model caps the upfront reduction at the quote. The net cost never becomes negative.</p>}</div></div>
    <details className="policy-financial-decisions"><summary>Compare 25-year base and adjusted cash flow</summary><div className="policy-financial-table-wrap" role="region" aria-label="Base and adjusted annual cash flow" tabIndex={0}>
      <table><caption>Annual modeled cash flow, with benefits assumed upfront in the adjusted scenario</caption><thead><tr><th scope="col">Year</th><th scope="col">Annual cash flow</th><th scope="col">Base cumulative</th><th scope="col">Adjusted cumulative</th></tr></thead>
        <tbody><tr><th scope="row">0</th><td>Upfront cost</td><td>{money.format(response.base.initialCashFlowRupees)}</td><td>{money.format(projection.initialCashFlowRupees)}</td></tr>
        {projection.annualRows.map(row => <tr key={row.year}><th scope="row">{row.year}</th><td>{money.format(row.netCashFlowRupees)}</td><td>{money.format(row.baseCumulativeCashFlowRupees)}</td><td>{money.format(row.cumulativeCashFlowRupees)}</td></tr>)}</tbody></table>
    </div></details>
    <PolicySources response={response} asOfSnapshot={asOfSnapshot} />
  </section>;
}
