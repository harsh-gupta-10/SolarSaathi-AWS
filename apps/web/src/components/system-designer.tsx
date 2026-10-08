"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { BarChart3, SlidersHorizontal } from "lucide-react";
import { Button, Input, Label } from "@solarsaathi/ui";
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
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);

  function change(update: () => void) {
    request.current?.abort(); request.current = null;
    setSubmitted(undefined); setBusy(false); setError(undefined); update();
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const generationKwhPerKwYear = bounded(yieldFactor, 500, 2_500);
    const load = sanctionedLoad.trim() ? bounded(sanctionedLoad, 0.25, 1_000) : undefined;
    if (generationKwhPerKwYear === undefined || (sanctionedLoad.trim() && load === undefined)) {
      setError("Enter an annual yield of 500–2,500 kWh per kW and, if supplied, sanctioned load of 0.25–1,000 kW."); return;
    }
    let demand: SystemDemand;
    if (basis === "CONSUMPTION") {
      const monthlyConsumptionKwh = bounded(consumption, 1, 100_000);
      if (monthlyConsumptionKwh === undefined) { setError("Enter monthly electricity use from 1 to 100,000 kWh."); return; }
      demand = { kind: "CONSUMPTION", monthlyConsumptionKwh, ...(load === undefined ? {} : { sanctionedLoadKw: load }) };
    } else {
      const monthlyBillRupees = bounded(bill, 1, 1_000_000);
      const tariffRupeesPerKwh = bounded(tariff, 0.1, 100);
      if (monthlyBillRupees === undefined || tariffRupeesPerKwh === undefined) {
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
    <div className="system-designer-heading"><div><span className="system-designer-kicker"><SlidersHorizontal size={16} aria-hidden="true" /> System designer</span><h2 id="system-designer-title">Compare solar system sizes</h2><p>Use your electricity demand to compare 1 to 10 kW planning candidates against the confirmed roof. The service calculates options from the saved analysis.</p></div><BarChart3 size={28} aria-hidden="true" /></div>
    <form onSubmit={submit} noValidate className="system-designer-form">
      <fieldset className="system-demand-choice"><legend>How do you know your electricity use?</legend><label><input type="radio" name="demand-basis" checked={basis === "CONSUMPTION"} onChange={() => change(() => setBasis("CONSUMPTION"))} /> Monthly kWh</label><label><input type="radio" name="demand-basis" checked={basis === "BILL"} onChange={() => change(() => setBasis("BILL"))} /> Bill and tariff</label></fieldset>
      <div className="system-input-grid">
        {basis === "CONSUMPTION" ? <div><Label htmlFor="system-monthly-use">Monthly electricity use (kWh)</Label><Input id="system-monthly-use" type="number" inputMode="decimal" min="1" max="100000" step="any" required value={consumption} onChange={event => change(() => setConsumption(event.target.value))} aria-describedby="system-monthly-use-help" /><p id="system-monthly-use-help">Use the units shown on a recent electricity bill.</p></div>
          : <><div><Label htmlFor="system-monthly-bill">Monthly electricity bill (₹)</Label><Input id="system-monthly-bill" type="number" inputMode="decimal" min="1" max="1000000" step="any" required value={bill} onChange={event => change(() => setBill(event.target.value))} /></div><div><Label htmlFor="system-tariff">Effective electricity tariff (₹/kWh)</Label><Input id="system-tariff" type="number" inputMode="decimal" min="0.1" max="100" step="any" required value={tariff} onChange={event => change(() => setTariff(event.target.value))} aria-describedby="system-tariff-help" /><p id="system-tariff-help">Enter an effective rate from your bill. Fixed charges and taxes make this method approximate.</p></div></>}
        <div><Label htmlFor="system-yield">Expected annual generation (kWh per kW)</Label><Input id="system-yield" type="number" inputMode="decimal" min="500" max="2500" step="any" required value={yieldFactor} onChange={event => change(() => setYieldFactor(event.target.value))} aria-describedby="system-yield-help" /><p id="system-yield-help">Editable planning yield; 1,500 is an illustrative starting assumption, not a site forecast. Google panel energy is used when available.</p></div>
        <div><Label htmlFor="system-sanctioned-load">Sanctioned load (kW, optional)</Label><Input id="system-sanctioned-load" type="number" inputMode="decimal" min="0.25" max="1000" step="any" value={sanctionedLoad} onChange={event => change(() => setSanctionedLoad(event.target.value))} aria-describedby="system-sanctioned-help" /><p id="system-sanctioned-help">For local rule review context only. It is not an automatic solar capacity limit or approval.</p></div>
      </div>
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
