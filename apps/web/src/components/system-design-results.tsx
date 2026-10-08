import type { SystemCandidate, SystemDesignResult } from "@solarsaathi/calculations";
import { roofLayoutWarningText } from "../lib/roof-layout-copy";

const number = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 1 });
const decimal = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 1, maximumFractionDigits: 2 });

const decisionText: Record<SystemDesignResult["decisionCode"], string> = {
  RECOMMENDED_CLOSEST_TO_TARGET: "Closest to the modeled annual consumption target among candidates that fit the available roof model.",
  ROOF_FIT_UNDETERMINED: "A roof footprint is needed before a system size can be recommended. Add verified dimensions or Google Solar geometry.",
  NO_CANDIDATE_WITHIN_ROOF: "None of the modeled sizes fits the available roof geometry under these planning clearances.",
  NO_CANDIDATE_WITH_MODELED_GENERATION: "Roof-fitting candidates have no modeled annual generation. Check the source roof and generation inputs before choosing a size.",
  NO_CANDIDATE_WITHIN_DEMAND_LIMIT: "Every roof-fitting size would exceed the configured generation-to-use planning limit.",
};
const noRecommendationHeading: Record<Exclude<SystemDesignResult["decisionCode"], "RECOMMENDED_CLOSEST_TO_TARGET">, string> = {
  ROOF_FIT_UNDETERMINED: "Roof fit is undetermined",
  NO_CANDIDATE_WITHIN_ROOF: "No modeled size fits this roof",
  NO_CANDIDATE_WITH_MODELED_GENERATION: "No usable generation estimate",
  NO_CANDIDATE_WITHIN_DEMAND_LIMIT: "No size meets the demand limit",
};

const warningText: Record<SystemDesignResult["warnings"][number], string> = {
  LOCAL_RULES_NOT_CHECKED: "Local DISCOM, interconnection and building rules have not been checked.",
  SANCTIONED_LOAD_NOT_PROVIDED: "Sanctioned load was not supplied; compare it with your bill and ask the DISCOM or installer about local rules.",
  SANCTIONED_LOAD_REVIEW_NEEDED: "Some candidate DC sizes exceed the load you entered. Local rule review is needed; this is not an automatic legal limit.",
  BILL_TO_KWH_IS_APPROXIMATE: "Consumption inferred from a bill and flat tariff is approximate; fixed charges, taxes and time-of-use rates can change it.",
  GOOGLE_ROOF_FIT_APPROXIMATE: "Google roof bounds are approximate and need an on-site layout check.",
  MANUAL_FIT_NEEDS_SITE_SURVEY: "Manual dimensions support only a space-feasible estimate; a site survey is needed.",
  ASSUMED_YIELD_USED: "At least one generation estimate uses the entered annual yield assumption instead of site-specific panel energy.",
  GOOGLE_DC_TO_AC_FACTOR_ASSUMED: "Google panel DC energy was converted with the displayed planning factor; actual AC output can differ.",
};

const reasonText: Record<SystemCandidate["reasonCodes"][number], string> = {
  ROOF_FIT_UNDETERMINED: "Roof fit unknown",
  EXCEEDS_MODELED_ROOF: "Exceeds modeled roof fit",
  SANCTIONED_LOAD_REVIEW_NEEDED: "Local rule review needed",
  EXCEEDS_DEMAND_LIMIT: "Above generation-to-use limit",
  ZERO_MODELED_GENERATION: "No modeled generation",
};

const fitText: Record<SystemCandidate["roofFit"], string> = {
  MODELED_APPROXIMATE: "Approximate Google fit",
  SPACE_FEASIBLE: "Space-feasible",
  UNDETERMINED: "Undetermined",
  EXCEEDS_MODELED_ROOF: "Exceeds modeled fit",
};

export function SystemDesignResults({ design, analysisId, demo = false }: { design: SystemDesignResult; analysisId: string; demo?: boolean }) {
  const recommended = design.recommendation;
  const heading = recommended ? `${decimal.format(recommended.actualDcKw)} kW DC · ${recommended.panelCount} panels`
    : design.decisionCode === "RECOMMENDED_CLOSEST_TO_TARGET" ? "No candidate recommended" : noRecommendationHeading[design.decisionCode];
  return <div className="system-results">
    <p className="sr-only" role="status">System comparison ready. {heading}</p>
    <div className="system-decision">
      <div>
        <span className="system-decision-label">{recommended ? "Planning recommendation" : "Recommendation unavailable"}</span>
        <h3>{heading}</h3>
        <p>{decisionText[design.decisionCode]}</p>
      </div>
      {recommended && <div className="system-decision-metrics"><span>Minimum modeled inverter</span><strong>{decimal.format(recommended.minimumInverterAcKw)} kW AC</strong><span>Estimated annual generation</span><strong>{number.format(recommended.estimatedAnnualGenerationKwh)} kWh</strong></div>}
    </div>
    <p className="system-results-context">{design.demand.source === "BILL_ESTIMATE" ? "Bill-derived" : "Entered"} use: {number.format(design.demand.monthlyConsumptionKwh)} kWh/month. Roof fit: {design.roof.maxPanelCount === null ? "undetermined" : `${design.roof.maxPanelCount} modeled panels`}. {demo ? "Synthetic fixture result." : `Analysis ${analysisId}.`}</p>
    <div className="system-comparison-wrap" role="region" aria-label="System candidate comparison" tabIndex={0}>
      <table className="system-comparison">
        <caption>Modeled system candidates under the displayed assumptions</caption>
        <thead><tr><th scope="col">Nominal size</th><th scope="col">Panels / actual DC</th><th scope="col">Min. inverter AC</th><th scope="col">Annual generation</th><th scope="col">Use coverage</th><th scope="col">Roof and review</th></tr></thead>
        <tbody>{design.candidates.map(candidate => <tr key={candidate.nominalKw} className={recommended?.nominalKw === candidate.nominalKw ? "system-recommended-row" : undefined}>
          <th scope="row"><strong>{decimal.format(candidate.nominalKw)} kW</strong>{recommended?.nominalKw === candidate.nominalKw && <span className="system-row-badge">Recommended</span>}</th>
          <td>{candidate.panelCount} / {decimal.format(candidate.actualDcKw)} kW</td>
          <td>{decimal.format(candidate.minimumInverterAcKw)} kW</td>
          <td>{number.format(candidate.estimatedAnnualGenerationKwh)} kWh <small>{candidate.generationBasis === "GOOGLE_DC_DERATED" ? "Google panel energy, adjusted" : "Assumed annual yield"}</small></td>
          <td>{number.format(candidate.annualConsumptionCoverageRatio * 100)}%</td>
          <td><span>{fitText[candidate.roofFit]}</span>{candidate.reasonCodes.length > 0 && <ul>{candidate.reasonCodes.map(reason => <li key={reason}>{reasonText[reason]}</li>)}</ul>}</td>
        </tr>)}</tbody>
      </table>
    </div>
    <details className="system-assumptions" open><summary>Calculation assumptions and limits</summary><div className="system-assumptions-grid">
      <div><span>Annual yield when Google panel energy is unavailable</span><strong>{number.format(design.assumptions.generationKwhPerKwYear)} kWh/kW-year</strong></div>
      <div><span>Modeled panel</span><strong>{design.assumptions.roofLayout.panelWidthMeters} × {design.assumptions.roofLayout.panelHeightMeters} m · {design.assumptions.roofLayout.panelCapacityWatts} W</strong></div>
      <div><span>Roof layout distances</span><strong>{design.assumptions.roofLayout.edgeSetbackMeters} m edge setback · {design.assumptions.roofLayout.panelGapMeters} m panel gap · {design.assumptions.roofLayout.servicePathWidthMeters} m service path</strong></div>
      <div><span>Minimum inverter sizing</span><strong>DC size ÷ {design.assumptions.inverterDcAcRatio} DC/AC ratio</strong></div>
      <div><span>Target annual consumption coverage</span><strong>{number.format(design.assumptions.targetCoverageFraction * 100)}%</strong></div>
      <div><span>Maximum generation-to-use ratio</span><strong>{number.format(design.assumptions.maximumGenerationToDemandRatio * 100)}%</strong></div>
      <div><span>Google DC-to-AC energy factor, when used</span><strong>{number.format(design.assumptions.googleDcToAcEnergyFactor * 100)}%</strong></div>
    </div><p>Inverter figures are minimum modeled AC nameplate estimates, not equipment selections. Generation is an estimate, not a savings forecast. Roof clearances and local approval require site review.</p></details>
    <div className="system-warnings"><h3>What to check next</h3><ul>{design.warnings.map(warning => <li key={warning}>{warningText[warning]}</li>)}{design.roof.layoutWarnings.map(warning => <li key={`roof-${warning}`}>{roofLayoutWarningText[warning]}</li>)}</ul>{design.roof.source === "GOOGLE_SOLAR" && <p>Source: Includes solar data from Google.</p>}</div>
  </div>;
}
