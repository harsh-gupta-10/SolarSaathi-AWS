"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { BarChart3, SlidersHorizontal } from "lucide-react";
import { Button, ChipGroup, CurrencyInput, Field, Input } from "@solarsaathi/ui";
import { SYSTEM_DESIGN_BASELINE_V1, type SystemDemand } from "@solarsaathi/calculations";
import { RoofRequestError } from "../lib/roof-api";
import { systemApi, type SystemRecommendationResponse } from "../lib/system-api";
import { SystemDesignResults } from "./system-design-results";
import { FinancialEstimator } from "./financial-estimator";

function bounded(raw: string, minimum: number, maximum: number): number | undefined {
  const value = Number(raw);
  return raw.trim() && Number.isFinite(value) && value >= minimum && value <= maximum ? value : undefined;
}

export function SystemDesigner({ propertyId, analysisId }: { propertyId: string; analysisId: string }) {
  const [basis, setBasis] = useState<"CONSUMPTION" | "BILL">("CONSUMPTION");
  const [consumption, setConsumption] = useState("");
  const [bill, setBill] = useState("");
  const [tariff, setTariff] = useState("");
  const [yieldFactor, setYieldFactor] = useState(String(SYSTEM_DESIGN_BASELINE_V1.generationKwhPerKwYear));
  const [sanctionedLoad, setSanctionedLoad] = useState("");
  const [submitted, setSubmitted] = useState<{ response: SystemRecommendationResponse; demand: SystemDemand; generationKwhPerKwYear: number }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);

  function change(update: () => void) {
    request.current?.abort(); request.current = null;
    setSubmitted(undefined); setBusy(false); setError(undefined); setFieldErrors({}); update();
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const generationKwhPerKwYear = bounded(yieldFactor, 500, 2_500);
    const load = sanctionedLoad.trim() ? bounded(sanctionedLoad, 0.25, 1_000) : undefined;
    if (generationKwhPerKwYear === undefined || (sanctionedLoad.trim() && load === undefined)) {
      setFieldErrors({ ...(generationKwhPerKwYear === undefined ? { "system-yield": "Enter 500 to 2,500 kWh per kW." } : {}),
        ...(sanctionedLoad.trim() && load === undefined ? { "system-sanctioned-load": "Enter 0.25 to 1,000 kW, or leave it blank." } : {}) });
      setError("Enter an annual yield of 500–2,500 kWh per kW and, if supplied, sanctioned load of 0.25–1,000 kW."); return;
    }
    let demand: SystemDemand;
    if (basis === "CONSUMPTION") {
      const monthlyConsumptionKwh = bounded(consumption, 1, 100_000);
      if (monthlyConsumptionKwh === undefined) {
        setFieldErrors({ "system-monthly-use": "Enter 1 to 1,00,000 units (kWh) per month." });
        setError("Enter monthly electricity use from 1 to 100,000 kWh."); return;
      }
      demand = { kind: "CONSUMPTION", monthlyConsumptionKwh, ...(load === undefined ? {} : { sanctionedLoadKw: load }) };
    } else {
      const monthlyBillRupees = bounded(bill, 1, 1_000_000);
      const tariffRupeesPerKwh = bounded(tariff, 0.1, 100);
      if (monthlyBillRupees === undefined || tariffRupeesPerKwh === undefined) {
        setFieldErrors({ ...(monthlyBillRupees === undefined ? { "system-monthly-bill": "Enter ₹1 to ₹10,00,000." } : {}),
          ...(tariffRupeesPerKwh === undefined ? { "system-tariff": "Enter ₹0.10 to ₹100 per unit." } : {}) });
        setError("Enter a monthly bill from ₹1 to ₹10,00,000 and an effective tariff from ₹0.10 to ₹100 per kWh."); return;
      }
      demand = { kind: "BILL", monthlyBillRupees, tariffRupeesPerKwh, ...(load === undefined ? {} : { sanctionedLoadKw: load }) };
    }
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    setBusy(true); setError(undefined); setSubmitted(undefined);
    void systemApi.recommend(propertyId, analysisId, demand, generationKwhPerKwYear, controller.signal)
      .then(response => { if (!controller.signal.aborted) setSubmitted({ response, demand, generationKwhPerKwYear }); })
      .catch(failure => { if (!controller.signal.aborted) setError(failure instanceof RoofRequestError ? failure.message : "The system design could not be created. Try again."); })
      .finally(() => { if (request.current === controller) { request.current = null; setBusy(false); } });
  }

  return <section className="system-designer" aria-labelledby="system-designer-title">
    <div className="system-designer-heading">
      <div>
        <span className="system-designer-kicker"><SlidersHorizontal size={16} aria-hidden="true" /> System designer</span>
        <h2 id="system-designer-title">Compare solar system sizes</h2>
        <p>Use your electricity demand to compare 1 to 10 kW planning candidates against the confirmed roof. The service calculates options from the saved analysis.</p>
      </div>
      <div className="flex flex-col items-end gap-2">
        <BarChart3 size={28} aria-hidden="true" />
      </div>
    </div>
    <form onSubmit={submit} noValidate className="system-designer-form">
      <div className="grid gap-2">
        <p className="text-sm font-medium">How do you know your electricity use?</p>
        <ChipGroup label="How do you know your electricity use?" value={basis}
          options={[{ label: "Monthly kWh", value: "CONSUMPTION" }, { label: "Bill and tariff", value: "BILL" }]}
          onChange={value => change(() => setBasis(value as "CONSUMPTION" | "BILL"))} />
      </div>
      <div className="mt-5 grid gap-5 md:grid-cols-2">
        {basis === "CONSUMPTION"
          ? <Field id="system-monthly-use" label="Monthly electricity use (kWh)" required error={fieldErrors["system-monthly-use"]} liveError={false}
            hint="Use the units shown on a recent electricity bill.">
            {control => <Input {...control} type="number" inputMode="decimal" min="1" max="100000" step="any" value={consumption} onChange={event => change(() => setConsumption(event.target.value))} />}
          </Field>
          : <>
            <Field id="system-monthly-bill" label="Monthly electricity bill (₹)" required error={fieldErrors["system-monthly-bill"]} liveError={false}>
              {control => <CurrencyInput {...control} value={bill} onValueChange={digits => change(() => setBill(digits))} />}
            </Field>
            <Field id="system-tariff" label="Effective electricity tariff (₹/kWh)" required error={fieldErrors["system-tariff"]} liveError={false}
              hint="Your bill divided by units used. Fixed charges and taxes make this approximate.">
              {control => <Input {...control} type="number" inputMode="decimal" min="0.1" max="100" step="any" value={tariff} onChange={event => change(() => setTariff(event.target.value))} />}
            </Field>
          </>}
      </div>
      <details className="mt-5 rounded-lg border p-4">
        <summary className="cursor-pointer text-sm font-semibold">Advanced (generation assumption and sanctioned load)</summary>
        <div className="mt-4 grid gap-5 md:grid-cols-2">
          <Field id="system-yield" label="Expected annual generation (kWh per kW)" required error={fieldErrors["system-yield"]} liveError={false}
            hint="An illustrative starting assumption of 1,500, not a forecast for your site. Google panel energy is used when available.">
            {control => <Input {...control} type="number" inputMode="decimal" min="500" max="2500" step="any" value={yieldFactor} onChange={event => change(() => setYieldFactor(event.target.value))} />}
          </Field>
          <Field id="system-sanctioned-load" label="Sanctioned load (kW, optional)" error={fieldErrors["system-sanctioned-load"]} liveError={false}
            hint="Context for rule review only. It is not a capacity limit or an approval.">
            {control => <Input {...control} type="number" inputMode="decimal" min="0.25" max="1000" step="any" value={sanctionedLoad} onChange={event => change(() => setSanctionedLoad(event.target.value))} />}
          </Field>
        </div>
      </details>
      <div className="system-form-footer"><Button type="submit" disabled={busy}>{busy ? "Comparing systems…" : "Compare system sizes"}</Button><p>Panel size, inverter ratio, modeled clearances and generation factors are shown with the result.</p></div>
      {busy && <p role="status" className="system-form-status">Checking the saved roof and planning candidates…</p>}
      {error && <p role="alert" className="form-error">{error}</p>}
    </form>
    {submitted && <SystemDesignResults design={submitted.response.design} analysisId={analysisId} />}
    {submitted?.response.design.recommendation && <FinancialEstimator propertyId={propertyId} analysisId={analysisId}
      demand={submitted.demand} generationKwhPerKwYear={submitted.generationKwhPerKwYear}
      candidates={submitted.response.design.candidates} recommendedNominalKw={submitted.response.design.recommendation.nominalKw} />}
  </section>;
}
