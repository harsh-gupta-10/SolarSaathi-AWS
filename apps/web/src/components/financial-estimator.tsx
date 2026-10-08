"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { IndianRupee } from "lucide-react";
import { Button, Input, Label } from "@solarsaathi/ui";
import type { SystemCandidate, SystemDemand } from "@solarsaathi/calculations";
import { financialApi, type FinancialEstimateResponse, type FinancialInputs } from "../lib/financial-api";
import { RoofRequestError } from "../lib/roof-api";
import { FinancialResults } from "./financial-results";
import { BenefitEvaluator } from "./benefit-evaluator";

function bounded(raw: string, minimum: number, maximum: number): number | undefined {
  const value = Number(raw);
  return raw.trim() && Number.isFinite(value) && value >= minimum && value <= maximum ? value : undefined;
}

export function FinancialEstimator({ propertyId, analysisId, demand, generationKwhPerKwYear, candidates, recommendedNominalKw }: {
  propertyId: string; analysisId: string; demand: SystemDemand; generationKwhPerKwYear: number;
  candidates: SystemCandidate[]; recommendedNominalKw: number;
}) {
  const [nominal, setNominal] = useState(String(recommendedNominalKw));
  const [quote, setQuote] = useState("");
  const [selfConsumptionPercent, setSelfConsumptionPercent] = useState("");
  const [importRate, setImportRate] = useState("");
  const [exportRate, setExportRate] = useState("");
  const [maintenance, setMaintenance] = useState("");
  const [result, setResult] = useState<FinancialEstimateResponse>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  const selectable = candidates.filter(candidate => candidate.recommendationEligible && candidate.roofFit !== "UNDETERMINED" && candidate.estimatedAnnualGenerationKwh > 0);

  function change(update: () => void) {
    request.current?.abort(); request.current = null;
    setBusy(false); setResult(undefined); setError(undefined); update();
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nominalKw = bounded(nominal, 0.1, 100);
    const grossSystemCostRupees = bounded(quote, 1_000, 50_000_000);
    const share = bounded(selfConsumptionPercent, 0, 100);
    const importTariffRupeesPerKwh = bounded(importRate, 0.1, 100);
    const exportRateRupeesPerKwh = bounded(exportRate, 0, 100);
    const annualMaintenanceRupees = bounded(maintenance, 0, 5_000_000);
    if (nominalKw === undefined || !selectable.some(candidate => candidate.nominalKw === nominalKw)) {
      setError("Choose a roof-fitting system candidate before estimating cash flow."); return;
    }
    if (grossSystemCostRupees === undefined || share === undefined || importTariffRupeesPerKwh === undefined ||
      exportRateRupeesPerKwh === undefined || annualMaintenanceRupees === undefined) {
      setError("Enter a gross quote (₹1,000–₹5,00,00,000), self-use share (0–100%), avoidable energy rate (₹0.10–₹100/kWh), assumed export credit (₹0–₹100/kWh), and yearly maintenance (₹0–₹50,00,000)."); return;
    }
    const financialInputs: FinancialInputs = { grossSystemCostRupees, selfConsumptionFraction: share / 100,
      importTariffRupeesPerKwh, exportRateRupeesPerKwh, annualMaintenanceRupees };
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    setBusy(true); setError(undefined); setResult(undefined);
    void financialApi.estimate(propertyId, analysisId, demand, generationKwhPerKwYear, nominalKw, financialInputs, controller.signal)
      .then(response => { if (!controller.signal.aborted) setResult(response); })
      .catch(failure => { if (!controller.signal.aborted) setError(failure instanceof RoofRequestError ? failure.message : "The financial estimate could not be created. Try again."); })
      .finally(() => { if (request.current === controller) { request.current = null; setBusy(false); } });
  }

  return <section className="financial-estimator" aria-labelledby="financial-estimator-title">
    <div className="financial-estimator-heading"><span><IndianRupee size={17} aria-hidden="true" /> Base financial estimate</span><h3 id="financial-estimator-title">See a quote as a 25-year scenario</h3><p>Enter your own installed quote and energy values. No government benefit, financing, or local export entitlement is assumed.</p></div>
    <form onSubmit={submit} noValidate className="financial-estimator-form">
      <div className="financial-input-grid">
        <div><Label htmlFor="financial-system">System candidate</Label><select id="financial-system" value={nominal} onChange={event => change(() => { setNominal(event.target.value); setQuote(""); })} aria-describedby="financial-system-help">{selectable.map(candidate => <option key={candidate.nominalKw} value={candidate.nominalKw}>{candidate.nominalKw} kW nominal · {candidate.panelCount} panels{candidate.nominalKw === recommendedNominalKw ? " · recommended" : ""}</option>)}</select><p id="financial-system-help">A new size needs its own installed quote. The backend checks roof fit again.</p></div>
        <div><Label htmlFor="financial-quote">Gross installed quote or planning estimate for this size (₹)</Label><Input id="financial-quote" type="number" inputMode="decimal" min="1000" max="50000000" step="any" required value={quote} onChange={event => change(() => setQuote(event.target.value))} aria-describedby="financial-quote-help" /><p id="financial-quote-help">Enter your own amount before any potential subsidy. A sourced installer quote is more reliable than a planning estimate. No price is prefilled.</p></div>
        <div><Label htmlFor="financial-self-use">Solar energy used on site (%)</Label><Input id="financial-self-use" type="number" inputMode="decimal" min="0" max="100" step="any" required value={selfConsumptionPercent} onChange={event => change(() => setSelfConsumptionPercent(event.target.value))} aria-describedby="financial-self-use-help" /><p id="financial-self-use-help">Your assumed share of solar generation used in the property; the model caps it by annual demand.</p></div>
        <div><Label htmlFor="financial-import-rate">Avoidable import energy rate (₹/kWh)</Label><Input id="financial-import-rate" type="number" inputMode="decimal" min="0.1" max="100" step="any" required value={importRate} onChange={event => change(() => setImportRate(event.target.value))} aria-describedby="financial-import-help" /><p id="financial-import-help">Value of each self-used solar kWh that replaces variable energy charges. Fixed charges and taxes may remain.</p></div>
        <div><Label htmlFor="financial-export-rate">Assumed export credit (₹/kWh)</Label><Input id="financial-export-rate" type="number" inputMode="decimal" min="0" max="100" step="any" required value={exportRate} onChange={event => change(() => setExportRate(event.target.value))} aria-describedby="financial-export-help" /><p id="financial-export-help">Enter 0 for no credit. This scenario does not verify net-metering eligibility or an actual DISCOM rate.</p></div>
        <div><Label htmlFor="financial-maintenance">Year-one maintenance (₹/year)</Label><Input id="financial-maintenance" type="number" inputMode="decimal" min="0" max="5000000" step="any" required value={maintenance} onChange={event => change(() => setMaintenance(event.target.value))} aria-describedby="financial-maintenance-help" /><p id="financial-maintenance-help">Enter an expected yearly amount, including 0 only if you intend that assumption.</p></div>
      </div>
      <div className="financial-form-footer"><Button type="submit" disabled={busy || selectable.length === 0}>{busy ? "Calculating scenario…" : "Estimate 25-year cash flow"}</Button><p>The result shows degradation, escalation and sensitivity assumptions used by the backend.</p></div>
      {busy && <p className="system-form-status" role="status">Calculating the selected system from the saved roof and your inputs…</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
    </form>
    {result && <><FinancialResults response={result} />
      <BenefitEvaluator key={result.requestId} propertyId={propertyId} analysisId={analysisId} demand={demand}
        generationKwhPerKwYear={generationKwhPerKwYear} nominalKw={result.system.nominalKw}
        grossSystemCostRupees={result.financial.input.quote.grossSystemCostRupees}
        financialInputs={{ grossSystemCostRupees: result.financial.input.quote.grossSystemCostRupees,
          selfConsumptionFraction: result.financial.input.usage.selfConsumptionFraction,
          importTariffRupeesPerKwh: result.financial.input.usage.importTariffRupeesPerKwh,
          exportRateRupeesPerKwh: result.financial.input.usage.exportRateRupeesPerKwh,
          annualMaintenanceRupees: result.financial.input.assumptions.annualMaintenanceRupees }} />
    </>}
  </section>;
}
