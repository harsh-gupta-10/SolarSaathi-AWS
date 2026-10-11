"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { IndianRupee, Sparkles } from "lucide-react";
import { Button, Input, Label } from "@solarsaathi/ui";
import {
  FINANCIAL_INPUT_PRESETS_V1,
  getIndicativeBudgetRangesV1,
  type SystemCandidate,
  type SystemDemand,
} from "@solarsaathi/calculations";
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
  const [budgetTier, setBudgetTier] = useState<string>("");
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

  const currentNominalKw = bounded(nominal, 0.1, 100) ?? recommendedNominalKw;
  const budgetRanges = getIndicativeBudgetRangesV1(currentNominalKw);
  const activeTier = budgetRanges.find(r => r.tier === budgetTier);

  function change(update: () => void) {
    request.current?.abort(); request.current = null;
    setBusy(false); setResult(undefined); setError(undefined); update();
  }

  function applyStandardDefaults() {
    change(() => {
      const standard = budgetRanges.find(r => r.tier === "STANDARD") ?? budgetRanges[0];
      setBudgetTier(standard.tier);
      setQuote(String(standard.typicalTotalRupees));
      setSelfConsumptionPercent("90");
      setImportRate("7.5");
      setExportRate("0");
      setMaintenance("0");
    });
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
    <div className="financial-estimator-heading"><span><IndianRupee size={17} aria-hidden="true" /> Base financial estimate</span><h3 id="financial-estimator-title">See a quote as a 25-year scenario</h3><p>Enter your own installed quote or pick a typical Indian benchmark range. No government benefit, financing, or local export entitlement is assumed.</p></div>
    <form onSubmit={submit} noValidate className="financial-estimator-form">
      <div className="financial-presets-bar">
        <span className="financial-presets-label"><Sparkles size={14} aria-hidden="true" /> Quick setup:</span>
        <button
          type="button"
          className="financial-preset-chip"
          onClick={applyStandardDefaults}
        >
          Fill with illustrative planning values, not sourced figures (₹{budgetRanges.find(r => r.tier === "STANDARD")?.typicalTotalRupees.toLocaleString("en-IN") ?? "typical"} · 90% self-use · ₹7.50 tariff · ₹0 export · ₹0 AMC)
        </button>
      </div>
      <div className="financial-input-grid">
        <div>
          <Label htmlFor="financial-system">System candidate</Label>
          <select id="financial-system" value={nominal} onChange={event => change(() => { setNominal(event.target.value); setQuote(""); setBudgetTier(""); })} aria-describedby="financial-system-help">{selectable.map(candidate => <option key={candidate.nominalKw} value={candidate.nominalKw}>{candidate.nominalKw} kW nominal · {candidate.panelCount} panels{candidate.nominalKw === recommendedNominalKw ? " · recommended" : ""}</option>)}</select>
          <p id="financial-system-help">A new size recalculates the illustrative budget ranges. The ranges and presets are unsourced planning aids; replace them with your installer quote and electricity bill. The backend checks roof fit again.</p>
        </div>
        <div>
          <Label htmlFor="financial-quote">Gross installed quote or planning estimate for this size (₹)</Label>
          <select
            id="financial-budget-tier"
            aria-label={`Indicative budget range for ${currentNominalKw} kW`}
            value={budgetTier}
            onChange={event => change(() => {
              const val = event.target.value;
              setBudgetTier(val);
              const matched = budgetRanges.find(r => r.tier === val);
              if (matched) setQuote(String(matched.typicalTotalRupees));
              else if (!val) setQuote("");
            })}
          >
            <option value="">Select indicative budget range...</option>
            {budgetRanges.map(range => (
              <option key={range.tier} value={range.tier}>
                {range.label} ({range.perKwRangeLabel}) · ₹{range.minTotalRupees.toLocaleString("en-IN")}–₹{range.maxTotalRupees.toLocaleString("en-IN")} (Typical: ₹{range.typicalTotalRupees.toLocaleString("en-IN")})
              </option>
            ))}
            <option value="CUSTOM">Custom quote / Exact installer quote</option>
          </select>
          <Input
            id="financial-quote"
            type="number"
            inputMode="decimal"
            min="1000"
            max="50000000"
            step="any"
            required
            value={quote}
            onChange={event => change(() => {
              setQuote(event.target.value);
              const matched = budgetRanges.find(r => String(r.typicalTotalRupees) === event.target.value.trim());
              setBudgetTier(matched ? matched.tier : (event.target.value.trim() ? "CUSTOM" : ""));
            })}
            aria-describedby="financial-quote-help"
            placeholder={activeTier ? `Typical: ₹${activeTier.typicalTotalRupees.toLocaleString("en-IN")}` : "Enter exact ₹ quote"}
          />
          <p id="financial-quote-help">
            {activeTier
              ? `Benchmark range: ₹${activeTier.minTotalRupees.toLocaleString("en-IN")}–₹${activeTier.maxTotalRupees.toLocaleString("en-IN")} (${activeTier.description}). Adjust the number above to match your installer's quote.`
              : "Select a typical budget range above or enter an exact installer quote. No price is prefilled."}
          </p>
        </div>
        <div>
          <Label htmlFor="financial-self-use">Solar energy used on site (%)</Label>
          <select
            id="financial-self-use-preset"
            aria-label="Solar self-consumption presets"
            value={FINANCIAL_INPUT_PRESETS_V1.selfConsumption.some(p => String(p.value) === selfConsumptionPercent) ? selfConsumptionPercent : (selfConsumptionPercent ? "CUSTOM" : "")}
            onChange={event => change(() => {
              const val = event.target.value;
              if (val !== "CUSTOM" && val !== "") setSelfConsumptionPercent(val);
            })}
          >
            <option value="">Choose typical range...</option>
            {FINANCIAL_INPUT_PRESETS_V1.selfConsumption.map(preset => (
              <option key={preset.value} value={preset.value}>{preset.label}</option>
            ))}
            <option value="CUSTOM">Custom percentage</option>
          </select>
          <Input id="financial-self-use" type="number" inputMode="decimal" min="0" max="100" step="any" required value={selfConsumptionPercent} onChange={event => change(() => setSelfConsumptionPercent(event.target.value))} aria-describedby="financial-self-use-help" placeholder="e.g. 90" />
          <p id="financial-self-use-help">Your assumed share of solar generation used in the property; the model caps it by annual demand.</p>
        </div>
        <div>
          <Label htmlFor="financial-import-rate">Avoidable import energy rate (₹/kWh)</Label>
          <select
            id="financial-import-rate-preset"
            aria-label="Import tariff presets"
            value={FINANCIAL_INPUT_PRESETS_V1.importTariff.some(p => String(p.value) === importRate) ? importRate : (importRate ? "CUSTOM" : "")}
            onChange={event => change(() => {
              const val = event.target.value;
              if (val !== "CUSTOM" && val !== "") setImportRate(val);
            })}
          >
            <option value="">Choose indicative tariff range...</option>
            {FINANCIAL_INPUT_PRESETS_V1.importTariff.map(preset => (
              <option key={preset.value} value={preset.value}>{preset.label}</option>
            ))}
            <option value="CUSTOM">Custom tariff</option>
          </select>
          <Input id="financial-import-rate" type="number" inputMode="decimal" min="0.1" max="100" step="any" required value={importRate} onChange={event => change(() => setImportRate(event.target.value))} aria-describedby="financial-import-help" placeholder="e.g. 7.50" />
          <p id="financial-import-help">Value of each self-used solar kWh that replaces variable energy charges. Fixed charges and taxes may remain.</p>
        </div>
        <div>
          <Label htmlFor="financial-export-rate">Assumed export credit (₹/kWh)</Label>
          <select
            id="financial-export-rate-preset"
            aria-label="Export credit presets"
            value={FINANCIAL_INPUT_PRESETS_V1.exportRate.some(p => String(p.value) === exportRate) ? exportRate : (exportRate ? "CUSTOM" : "")}
            onChange={event => change(() => {
              const val = event.target.value;
              if (val !== "CUSTOM" && val !== "") setExportRate(val);
            })}
          >
            <option value="">Choose export credit assumption...</option>
            {FINANCIAL_INPUT_PRESETS_V1.exportRate.map(preset => (
              <option key={preset.value} value={preset.value}>{preset.label}</option>
            ))}
            <option value="CUSTOM">Custom credit</option>
          </select>
          <Input id="financial-export-rate" type="number" inputMode="decimal" min="0" max="100" step="any" required value={exportRate} onChange={event => change(() => setExportRate(event.target.value))} aria-describedby="financial-export-help" placeholder="e.g. 0 or 2.50" />
          <p id="financial-export-help">Enter 0 for no credit. This scenario does not verify net-metering eligibility or an actual DISCOM rate.</p>
        </div>
        <div>
          <Label htmlFor="financial-maintenance">Year-one maintenance (₹/year)</Label>
          <select
            id="financial-maintenance-preset"
            aria-label="Maintenance cost presets"
            value={FINANCIAL_INPUT_PRESETS_V1.maintenance.some(p => String(p.value) === maintenance) ? maintenance : (maintenance ? "CUSTOM" : "")}
            onChange={event => change(() => {
              const val = event.target.value;
              if (val !== "CUSTOM" && val !== "") setMaintenance(val);
            })}
          >
            <option value="">Choose maintenance assumption...</option>
            {FINANCIAL_INPUT_PRESETS_V1.maintenance.map(preset => (
              <option key={preset.value} value={preset.value}>{preset.label}</option>
            ))}
            <option value="CUSTOM">Custom amount</option>
          </select>
          <Input id="financial-maintenance" type="number" inputMode="decimal" min="0" max="5000000" step="any" required value={maintenance} onChange={event => change(() => setMaintenance(event.target.value))} aria-describedby="financial-maintenance-help" placeholder="e.g. 0 or 1500" />
          <p id="financial-maintenance-help">Enter an expected yearly amount, including 0 only if you intend that assumption.</p>
        </div>
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
