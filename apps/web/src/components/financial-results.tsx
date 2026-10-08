import type { BaseFinancialResultV1, BaseFinancialSensitivityTripletV1 } from "@solarsaathi/calculations";
import type { FinancialEstimateResponse } from "../lib/financial-api";

const rupees = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const rate = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const number = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 1 });
const percent = (fraction: number) => `${number.format(fraction * 100)}%`;
const payback = (years: number | null) => years === null ? "Not within 25 years" : `${number.format(years)} years`;

const warningText: Record<BaseFinancialResultV1["warnings"][number], string> = {
  AVOIDABLE_IMPORT_TARIFF_ASSUMED: "The value of self-used energy comes from your entered avoidable import rate; fixed bill charges and taxes may remain.",
  EXPORT_SETTLEMENT_UNVERIFIED: "Export credit is your scenario input. Net-metering eligibility and the actual DISCOM settlement rate have not been verified.",
  ANNUAL_CONSUMPTION_HELD_FLAT: "Annual electricity use is held flat for 25 years in this model.",
  GENERATION_USES_ASSUMED_YIELD: "Generation uses an annual yield assumption, not site-specific measured production.",
  NO_PAYBACK_WITHIN_25_YEARS: "The modeled cash flow does not recover the quoted upfront cost within 25 years.",
};

function CashFlowChart({ financial }: { financial: BaseFinancialResultV1 }) {
  const values = [financial.initialCashFlowRupees, ...financial.annualRows.map(row => row.cumulativeCashFlowRupees)];
  const minimum = Math.min(0, ...values), maximum = Math.max(0, ...values);
  const span = Math.max(maximum - minimum, 1);
  const x = (index: number) => 34 + index / 25 * 532;
  const y = (value: number) => 164 - (value - minimum) / span * 128;
  const path = values.map((value, index) => `${index ? "L" : "M"}${x(index).toFixed(2)},${y(value).toFixed(2)}`).join(" ");
  return <figure className="financial-chart"><figcaption><strong>25-year cumulative cash flow</strong><span>Includes the upfront quote at year 0</span></figcaption><svg viewBox="0 0 600 200" role="img" aria-label="Cumulative modeled cash flow from upfront quote through year 25">
    <title>25-year cumulative cash flow</title><desc>Year 0 starts at {rupees.format(financial.initialCashFlowRupees)} and year 25 ends at {rupees.format(financial.totals.netSavingsOver25YearsRupees)}. The year-by-year values appear in the table below.</desc>
    <line x1="34" y1={y(0)} x2="566" y2={y(0)} stroke="#a8b9ad" strokeDasharray="4 4" />
    <path d={path} fill="none" stroke="#12633f" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx={x(0)} cy={y(values[0])} r="4" fill="#12633f" /><circle cx={x(25)} cy={y(values[25])} r="5" fill="#e8b44b" stroke="#12633f" strokeWidth="2" />
    <text x="34" y="190" fill="#52675b" fontSize="11">Year 0</text><text x="566" y="190" textAnchor="end" fill="#52675b" fontSize="11">Year 25</text><text x="566" y={Math.max(17, y(0) - 6)} textAnchor="end" fill="#52675b" fontSize="10">₹0</text>
  </svg></figure>;
}

function Sensitivity({ title, detail, cases }: { title: string; detail: string; cases: BaseFinancialSensitivityTripletV1 }) {
  return <section className="financial-sensitivity-card"><h4>{title}</h4><p>{detail}</p><div className="financial-sensitivity-rows">
    {(["low", "base", "high"] as const).map(level => <div key={level}><span>{level === "base" ? "Base" : `${level === "low" ? "Low" : "High"} input`} <small>×{number.format(cases[level].inputFactor)}</small></span><strong>{rupees.format(cases[level].totals.netSavingsOver25YearsRupees)}</strong><small>Payback: {payback(cases[level].totals.paybackYears)}</small></div>)}
  </div></section>;
}

export function FinancialResults({ response, demo = false }: { response: FinancialEstimateResponse; demo?: boolean }) {
  const { financial } = response;
  const { input, totals } = financial;
  return <section className="financial-results" aria-labelledby="financial-results-title">
    <p className="sr-only" role="status">Financial estimate ready. Modeled payback: {payback(totals.paybackYears)}.</p>
    <div className="financial-results-heading"><div><span>Deterministic base estimate · 25 years</span><h3 id="financial-results-title">What this amount could mean</h3><p>Based on your entered upfront amount and the selected {number.format(response.system.actualDcKw)} kW DC planning candidate. This is a scenario, not a vendor offer or guaranteed return.</p></div></div>
    <div className="financial-summary-grid">
      <div><span>Gross installed quote or estimate</span><strong>{rupees.format(input.quote.grossSystemCostRupees)}</strong><small>User-entered; no subsidy deducted</small></div>
      <div><span>Modeled payback</span><strong>{payback(totals.paybackYears)}</strong><small>From year-by-year cumulative cash flow</small></div>
      <div><span>Net cash flow after 25 years</span><strong>{rupees.format(totals.netSavingsOver25YearsRupees)}</strong><small>After upfront quote and modeled maintenance</small></div>
    </div>
    <p className="financial-boundary">This base cash flow excludes policy benefits and financing. Export credit is an assumed scenario, not a verified net-metering entitlement. Local tariff rules and site performance need review.</p>
    <CashFlowChart financial={financial} />
    <div className="financial-sensitivity"><div className="financial-subheading"><h4>What changes the estimate?</h4><p>Each range changes one input at a time; all other inputs stay at the base case.</p></div><div className="financial-sensitivity-grid">
      <Sensitivity title="Generation" detail={`Year-one generation ±${percent(input.sensitivity.generationVariationFraction)}`} cases={financial.sensitivity.generation} />
      <Sensitivity title="Avoidable import rate" detail={`Self-used energy value ±${percent(input.sensitivity.tariffVariationFraction)}; export credit stays fixed`} cases={financial.sensitivity.importTariff} />
      <Sensitivity title="Installed quote" detail={`Gross cost ±${percent(input.sensitivity.systemCostVariationFraction)}`} cases={financial.sensitivity.systemCost} />
    </div></div>
    <details className="financial-assumptions" open><summary>Inputs and model assumptions</summary><div className="financial-assumptions-grid">
      <div><span>Self-consumption share</span><strong>{percent(input.usage.selfConsumptionFraction)}</strong></div>
      <div><span>Avoidable import energy rate</span><strong>{rate.format(input.usage.importTariffRupeesPerKwh)}/kWh</strong></div>
      <div><span>Assumed export credit</span><strong>{rate.format(input.usage.exportRateRupeesPerKwh)}/kWh</strong></div>
      <div><span>Year-one maintenance</span><strong>{rupees.format(input.assumptions.annualMaintenanceRupees)}/year</strong></div>
      <div><span>Annual generation degradation</span><strong>{percent(input.assumptions.annualDegradationFraction)}</strong></div>
      <div><span>Annual import tariff escalation</span><strong>{percent(input.assumptions.annualImportTariffEscalationFraction)}</strong></div>
      <div><span>Annual export rate escalation</span><strong>{percent(input.assumptions.annualExportRateEscalationFraction)}</strong></div>
      <div><span>Annual maintenance escalation</span><strong>{percent(input.assumptions.annualMaintenanceEscalationFraction)}</strong></div>
    </div><p>All prices are user inputs or stated planning assumptions. No policy benefit, financing, equipment replacement, or structural approval is included.</p></details>
    <details className="financial-cash-flow"><summary>Year-by-year cash flow (25 years)</summary><div role="region" aria-label="25-year cash flow table" tabIndex={0} className="financial-table-wrap"><table><caption>Annual generation, value, maintenance and cumulative cash flow</caption><thead><tr><th scope="col">Year</th><th scope="col">Generation</th><th scope="col">Self-used / exported</th><th scope="col">Avoidable / export rate</th><th scope="col">Gross value</th><th scope="col">Maintenance</th><th scope="col">Net cash flow</th><th scope="col">Cumulative</th></tr></thead><tbody>{financial.annualRows.map(row => <tr key={row.year}><th scope="row">{row.year}</th><td>{number.format(row.generationKwh)} kWh</td><td>{number.format(row.selfConsumedKwh)} / {number.format(row.exportedKwh)} kWh</td><td>{rate.format(row.importTariffRupeesPerKwh)} / {rate.format(row.exportRateRupeesPerKwh)}</td><td>{rupees.format(row.grossSavingsRupees)}</td><td>{rupees.format(row.maintenanceCostRupees)}</td><td>{rupees.format(row.netCashFlowRupees)}</td><td>{rupees.format(row.cumulativeCashFlowRupees)}</td></tr>)}</tbody></table></div></details>
    <div className="financial-warnings"><h4>Estimate limits</h4><ul>{financial.warnings.map(warning => <li key={warning}>{warningText[warning]}</li>)}</ul>{response.roofSource === "GOOGLE_SOLAR" && <p>Source: Includes solar data from Google.</p>}<p>{demo ? "Synthetic fixture result; no API request was made." : `Analysis ${response.analysisId} · request ${response.requestId}.`}</p></div>
  </section>;
}
