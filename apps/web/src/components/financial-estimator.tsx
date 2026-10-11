"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { IndianRupee } from "lucide-react";
import { Button, ChipGroup, CurrencyInput, Field, Input, Select } from "@solarsaathi/ui";
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
  // Advanced assumptions start at an explicit, conservative "none assumed" so the user sees and can change them.
  const [exportRate, setExportRate] = useState("0");
  const [maintenance, setMaintenance] = useState("0");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
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
    setBusy(false); setResult(undefined); setError(undefined); setFieldErrors({}); update();
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nominalKw = bounded(nominal, 0.1, 100);
    const grossSystemCostRupees = bounded(quote, 1_000, 50_000_000);
    const share = bounded(selfConsumptionPercent, 0, 100);
    const importTariffRupeesPerKwh = bounded(importRate, 0.1, 100);
    const exportRateRupeesPerKwh = bounded(exportRate, 0, 100);
    const annualMaintenanceRupees = bounded(maintenance, 0, 5_000_000);
    const problems: Record<string, string> = {};
    if (nominalKw === undefined || !selectable.some(candidate => candidate.nominalKw === nominalKw)) problems["financial-system"] = "Choose a system that fits your roof.";
    if (grossSystemCostRupees === undefined) problems["financial-quote"] = "Enter the installed cost between ₹1,000 and ₹5,00,00,000.";
    if (share === undefined) problems["financial-self-use"] = "Enter a share between 0 and 100.";
    if (importTariffRupeesPerKwh === undefined) problems["financial-import-rate"] = "Enter a rate between ₹0.10 and ₹100 per unit.";
    if (exportRateRupeesPerKwh === undefined) problems["financial-export-rate"] = "Enter 0 to 100 (0 means no export credit).";
    if (annualMaintenanceRupees === undefined) problems["financial-maintenance"] = "Enter 0 to ₹50,00,000 per year.";
    if (Object.keys(problems).length > 0) {
      setFieldErrors(problems);
      setError(`Check ${Object.keys(problems).length === 1 ? "one field" : `${Object.keys(problems).length} fields`} before estimating: ${Object.values(problems).join(" ")}`);
      return;
    }
    if (nominalKw === undefined || grossSystemCostRupees === undefined || share === undefined ||
      importTariffRupeesPerKwh === undefined || exportRateRupeesPerKwh === undefined || annualMaintenanceRupees === undefined) return;
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
    <div className="financial-estimator-heading"><span><IndianRupee size={17} aria-hidden="true" /> Base financial estimate</span><h3 id="financial-estimator-title">See a quote as a 25-year scenario</h3><p>Enter your installer&apos;s quote, or start from an illustrative range. No government benefit, financing, or local export entitlement is assumed.</p></div>
    <form onSubmit={submit} noValidate className="financial-estimator-form">
      <div className="grid gap-5 md:grid-cols-2">
        <Field id="financial-system" label="System size" error={fieldErrors["financial-system"]} liveError={false}
          hint="Changing the size updates the cost ranges below. The backend checks roof fit again.">
          {control => <Select {...control} value={nominal} onChange={event => change(() => { setNominal(event.target.value); setQuote(""); setBudgetTier(""); })}>
            {selectable.map(candidate => <option key={candidate.nominalKw} value={candidate.nominalKw}>{candidate.nominalKw} kW · {candidate.panelCount} panels{candidate.nominalKw === recommendedNominalKw ? " · recommended" : ""}</option>)}
          </Select>}
        </Field>
        <div className="grid gap-2">
          <Field id="financial-quote" label="Installed cost quote (₹)" required error={fieldErrors["financial-quote"]} liveError={false}
            hint={activeTier
              ? `Illustrative range for this size: ₹${activeTier.minTotalRupees.toLocaleString("en-IN")} to ₹${activeTier.maxTotalRupees.toLocaleString("en-IN")} (${activeTier.perKwRangeLabel}). Not a sourced price; replace it with your installer's quote.`
              : "Use your installer's quote. You can start from an illustrative range below."}>
            {control => <CurrencyInput {...control} value={quote} placeholder={activeTier ? `e.g. ${activeTier.typicalTotalRupees.toLocaleString("en-IN")}` : "e.g. 1,80,000"}
              onValueChange={digits => change(() => {
                setQuote(digits);
                const matched = budgetRanges.find(r => String(r.typicalTotalRupees) === digits);
                setBudgetTier(matched ? matched.tier : (digits ? "CUSTOM" : ""));
              })} />}
          </Field>
          <ChipGroup label={`Illustrative cost ranges for ${currentNominalKw} kW`} value={budgetTier}
            options={budgetRanges.map(range => ({ label: range.label.replace(" tier", "").replace("Standard / Mid", "Standard"), value: range.tier }))}
            onChange={tier => change(() => { setBudgetTier(tier); const matched = budgetRanges.find(r => r.tier === tier); if (matched) setQuote(String(matched.typicalTotalRupees)); })} />
        </div>
        <div className="grid gap-2">
          <Field id="financial-self-use" label="How much solar you use at home (%)" required error={fieldErrors["financial-self-use"]} liveError={false}
            hint="The rest is exported. It is capped by your yearly demand.">
            {control => <Input {...control} type="number" inputMode="decimal" min="0" max="100" step="any" value={selfConsumptionPercent} placeholder="e.g. 80"
              onChange={event => change(() => setSelfConsumptionPercent(event.target.value))} />}
          </Field>
          <ChipGroup label="Typical self-use shares" value={selfConsumptionPercent}
            options={FINANCIAL_INPUT_PRESETS_V1.selfConsumption.map(p => ({ label: `${p.value}%`, value: String(p.value) })).sort((a, b) => Number(a.value) - Number(b.value))}
            onChange={value => change(() => setSelfConsumptionPercent(value))} />
        </div>
        <div className="grid gap-2">
          <Field id="financial-import-rate" label="What you pay per unit of electricity (₹/kWh)" required error={fieldErrors["financial-import-rate"]} liveError={false}
            hint="Use the energy rate on your bill. Fixed charges and taxes may remain.">
            {control => <Input {...control} type="number" inputMode="decimal" min="0.1" max="100" step="any" value={importRate} placeholder="e.g. 7.50"
              onChange={event => change(() => setImportRate(event.target.value))} />}
          </Field>
          <ChipGroup label="Illustrative rates" value={importRate}
            options={FINANCIAL_INPUT_PRESETS_V1.importTariff.map(p => ({ label: `₹${p.value}`, value: String(p.value) })).sort((a, b) => Number(a.value) - Number(b.value))}
            onChange={value => change(() => setImportRate(value))} />
        </div>
      </div>
      <details className="mt-5 rounded-lg border p-4">
        <summary className="cursor-pointer text-sm font-semibold">Advanced assumptions (export credit and maintenance)</summary>
        <div className="mt-4 grid gap-5 md:grid-cols-2">
          <Field id="financial-export-rate" label="Export credit (₹/kWh)" required error={fieldErrors["financial-export-rate"]} liveError={false}
            hint="0 means no credit for exported power. Net-metering eligibility and your DISCOM rate are not verified here.">
            {control => <Input {...control} type="number" inputMode="decimal" min="0" max="100" step="any" value={exportRate}
              onChange={event => change(() => setExportRate(event.target.value))} />}
          </Field>
          <Field id="financial-maintenance" label="Yearly maintenance (₹/year)" required error={fieldErrors["financial-maintenance"]} liveError={false}
            hint="0 means none assumed. Add your installer's maintenance contract cost if there is one.">
            {control => <CurrencyInput {...control} value={maintenance} onValueChange={digits => change(() => setMaintenance(digits))} />}
          </Field>
        </div>
      </details>
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
