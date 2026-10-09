"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowLeft, ArrowRight, ArrowUpRight, BadgeIndianRupee, Bot, Check,
  ClipboardList, Compass, FileSearch, House, Layers3, MapPin, PackageCheck,
  PanelsTopLeft, Sun, Wallet,
} from "lucide-react";
import styles from "./guided-demo.module.css";

type FinancialSummary = {
  gross: string;
  central: string;
  selectedTotal: string;
  net: string;
  coverageComplete: boolean;
};

const steps = [
  { id: "address", title: "Start with an address", short: "Address", Icon: MapPin,
    description: "A home address begins the assessment. In this presentation, the pin is a fictional Mumbai-area example and is never geocoded.",
    detail: "The real flow saves an address only in a signed-in account, then asks you to confirm the building.",
    href: "/app/analyze", action: "Open real address flow" },
  { id: "building", title: "Choose the house", short: "Building", Icon: House,
    description: "Select the sample house on the illustration. An approximate boundary appears so you can check the target before continuing.",
    detail: "In the real flow, a one-time device location can center the map after you press its button. You still choose and confirm the house.",
    href: "/app/analyze", action: "Try real map selection" },
  { id: "roof", title: "Inspect the roof", short: "Roof", Icon: Layers3,
    description: "Roof area, geometry, access and service paths become a planning model. Measurements need a separate confirmation.",
    detail: "Explore the interactive 3D view. Its synthetic roof is 10 × 10 m; its fit is a modeled illustration, not a survey.",
    href: "/demo/roof-3d", action: "Explore synthetic 3D roof" },
  { id: "solar", title: "Fit a solar system", short: "Solar", Icon: PanelsTopLeft,
    description: "Deterministic layout rules compare panel fit, system sizes, electricity use and generation assumptions.",
    detail: "The synthetic designer shows whole-panel choices and constraints. A site survey and installer remain necessary.",
    href: "/demo/system-designer", action: "Compare synthetic systems" },
  { id: "benefits", title: "Check benefit compatibility", short: "Benefits", Icon: BadgeIndianRupee,
    description: "Central, state, DISCOM, local and other rules are evaluated separately; caps and exclusions decide what can be counted together.",
    detail: "This fictional fixture contains one selected central rule. Coverage for other scopes is incomplete, so the total is only a partial scenario.",
    href: "/demo/policy-financial", action: "Inspect fictional rule scenario" },
  { id: "net-cost", title: "See the modeled net cost", short: "Net cost", Icon: Wallet,
    description: "A quoted gross cost and selected modelable benefits feed a deterministic cash-flow projection.",
    detail: "The sample net cost assumes the fictional benefit reduces the quote upfront. Real payment timing and approval are unverified.",
    href: "/demo/policy-financial", action: "Review synthetic financials" },
  { id: "application", title: "Follow the application", short: "Checklist", Icon: ClipboardList,
    description: "A source-backed checklist separates required steps from progress you report yourself.",
    detail: "The sample tracker is read-only. Its steps and completion state do not reflect any government portal.",
    href: "/demo/application-tracker", action: "View fictional checklist" },
  { id: "advisor", title: "Ask for an explanation", short: "AI advisor", Icon: Bot,
    description: "The advisor explains property and verified-rule facts with citations; it does not decide eligibility or invent an amount.",
    detail: "The offline example uses a deterministic fallback. No AI model or government source is contacted.",
    href: "/demo/advisor", action: "Read fictional advisor answer" },
  { id: "remaining", title: "Plan the remaining roof", short: "Remaining roof", Icon: Compass,
    description: "After solar and service paths are reserved, a geometric fit check can suggest light-use concepts.",
    detail: "A free-zone concept is only space-feasible. Structure, loading, access and waterproofing need review.",
    href: "/demo/rooftop-ideas", action: "Explore fictional roof concepts" },
  { id: "accessories", title: "Consider useful equipment", short: "Accessories", Icon: PackageCheck,
    description: "Recommendations follow the roof, system and stated goals, with compatibility and safety notes.",
    detail: "The sample ranks equipment without prices or unsupported claims of regulatory requirements.",
    href: "/demo/accessories", action: "Review fictional equipment" },
  { id: "sources", title: "Trace every claim", short: "Source trail", Icon: FileSearch,
    description: "A decision should lead back to the evidence, policy version, effective period and last source check.",
    detail: "The source trail example shows provenance structure using fictional records. It is not a live policy check.",
    href: "/demo/source-trail", action: "Inspect fictional source trail" },
] as const;

function RoofScene({ phase, houseSelected, onSelectHouse }: { phase: string; houseSelected: boolean; onSelectHouse: () => void }) {
  const buildingStage = phase === "building";
  const showPanels = !["address", "building", "roof"].includes(phase);
  const showFreeZone = phase === "remaining";
  return <figure className={styles.scene}>
    <div className={styles.sceneTopline}><span><Sun size={16} aria-hidden="true" /> Illustrative property view</span>
      <span>Fictional Mumbai-area home</span></div>
    <div className={styles.sceneCanvas}>
      <svg viewBox="0 0 720 480" role="img" aria-label={buildingStage && houseSelected
        ? "Illustrative isometric house with an approximate selected-building bounds overlay"
        : showPanels ? "Illustrative isometric house with solar panels on its roof"
          : "Illustrative isometric house on a schematic map"}>
        <defs>
          <pattern id="demo-grid" width="30" height="30" patternUnits="userSpaceOnUse" patternTransform="skewY(-17)">
            <path d="M 30 0 L 0 0 0 30" fill="none" stroke="#416663" strokeWidth="1" opacity=".42" />
          </pattern>
          <linearGradient id="demo-roof" x1="0" x2="1" y1="0" y2="1"><stop stopColor="#afd3a9" /><stop offset="1" stopColor="#7db098" /></linearGradient>
          <linearGradient id="demo-panel" x1="0" x2="1" y1="0" y2="1"><stop stopColor="#327184" /><stop offset="1" stopColor="#133e50" /></linearGradient>
          <filter id="demo-building-shadow"><feGaussianBlur stdDeviation="12" /></filter>
        </defs>
        <path d="M0 255 360 75 720 255v225H0Z" fill="url(#demo-grid)" />
        <path d="m70 316 260-133 298 146-265 132Z" fill="#223f3d" opacity=".75" />
        <path d="m204 375 142-68 158 78-142 69Z" fill="#061b1c" opacity=".5" filter="url(#demo-building-shadow)" />
        <path d="m210 252 167 83v75l-167-82Z" fill="#5b8578" stroke="#9ec1ac" strokeWidth="2" />
        <path d="m377 335 151-73v74l-151 74Z" fill="#3f7167" stroke="#9ec1ac" strokeWidth="2" />
        <path d="m210 252 150-75 168 85-151 73Z" fill="url(#demo-roof)" stroke="#d4e7cb" strokeWidth="3" />
        <path d="m340 198 70 35" stroke="#def2d1" strokeWidth="9" opacity=".6" />
        <path d="m340 198 70 35" stroke="#376d61" strokeWidth="1" strokeDasharray="5 5" opacity=".7" />
        {showPanels && <g fill="url(#demo-panel)" stroke="#c9d8c0" strokeWidth="2">
          <path d="m256 255 38-19 32 16-38 19Z" /><path d="m298 234 38-19 32 16-38 19Z" />
          <path d="m293 275 38-19 32 16-38 19Z" /><path d="m335 254 38-19 32 16-38 19Z" />
          <path d="m330 295 38-19 32 16-38 19Z" /><path d="m372 274 38-19 32 16-38 19Z" />
        </g>}
        {showFreeZone && <path d="m420 258 63-30 28 14-63 31Z" fill="#85c778" stroke="#dff5a6" strokeWidth="3" strokeDasharray="7 5" />}
        {buildingStage && houseSelected && <g fill="none" stroke="#f8d37a" strokeWidth="3" strokeDasharray="9 7">
          <path d="m194 249 166-83 185 94-168 84Z" />
          <path d="m194 249v88l183 90 168-84v-83" />
        </g>}
        {phase === "address" && <g><path d="M360 102c-24 0-43 19-43 43 0 33 43 75 43 75s43-42 43-75c0-24-19-43-43-43Z" fill="#f4c974" stroke="#173c38" strokeWidth="3" /><circle cx="360" cy="145" r="12" fill="#184942" /></g>}
        {showFreeZone && <g fill="#e2f5d2"><circle cx="455" cy="247" r="5" /><circle cx="468" cy="238" r="6" /><circle cx="479" cy="243" r="5" /></g>}
      </svg>
      {buildingStage && <button type="button" onClick={onSelectHouse} className={styles.houseSelect}
        aria-pressed={houseSelected} aria-label="Select the sample house on the illustrative map">
        <House size={17} aria-hidden="true" /> {houseSelected ? "House selected" : "Select this house"}
      </button>}
      {buildingStage && houseSelected && <span className={styles.overlayLabel} role="status"><Check size={15} aria-hidden="true" /> Approximate bounds overlay</span>}
    </div>
    <figcaption>Illustration only. It is not satellite imagery, a measured roof or a structural assessment.</figcaption>
  </figure>;
}

export function GuidedDemo({ financial }: { financial: FinancialSummary | null }) {
  const [current, setCurrent] = useState(0);
  const [houseSelected, setHouseSelected] = useState(false);
  const step = steps[current];
  const financialStage = step.id === "benefits" || step.id === "net-cost";

  return <main id="main-content" className={styles.page}>
    <header className={styles.header}>
      <Link href="/" className={styles.brand}><Sun size={26} aria-hidden="true" />SolarSaathi</Link>
      <nav aria-label="Demo navigation"><Link href="/app/analyze">Try your own roof<ArrowUpRight size={16} aria-hidden="true" /></Link></nav>
    </header>
    <div className={styles.shell}>
      <div className={styles.intro}>
        <p className={styles.edition}>An interactive walkthrough</p>
        <h1>From a rooftop pin to a decision you can trace.</h1>
        <p>Follow one imaginary home through the solar decision. Open each full feature preview when you want to inspect the details.</p>
      </div>
      <div className={styles.fixtureNotice} role="note"><strong>Synthetic demo fixture.</strong> The house, roof, financial result, benefit, checklist and sources here are fictional. No live account, map, government policy, Google Solar service or AI model is queried on this page. No subsidy is guaranteed.</div>
      <div className={styles.studio}>
        <aside className={styles.rail} aria-label="Guided demo progress">
          <div className={styles.railHeading}><span>Decision path</span><strong>{String(current + 1).padStart(2, "0")} / {steps.length}</strong></div>
          <label className={styles.mobileStepLabel} htmlFor="demo-step-select">Jump to a stage</label>
          <select id="demo-step-select" className={styles.mobileStepSelect} value={current} onChange={event => setCurrent(Number(event.target.value))}>
            {steps.map((item, index) => <option key={item.id} value={index}>{index + 1}. {item.short}</option>)}
          </select>
          <nav className={styles.stepNav} aria-label="Demo stages"><ol>{steps.map((item, index) => <li key={item.id}>
            <button type="button" onClick={() => setCurrent(index)} aria-current={index === current ? "step" : undefined}>
              <span className={styles.stepIndex}>{String(index + 1).padStart(2, "0")}</span><span>{item.short}</span>
              {index < current && <Check size={13} aria-hidden="true" />}
            </button>
          </li>)}</ol></nav>
          <p className={styles.railFoot}>Choose any stage. This walkthrough does not save an assessment.</p>
        </aside>
        <section className={styles.stage} aria-labelledby="demo-stage-title">
          <div className={styles.stageTop}><span className={styles.stageTag}><step.Icon size={17} aria-hidden="true" /> Stage {current + 1} of {steps.length}</span><span className={styles.stageStatus}>Fictional scenario</span></div>
          <div className={styles.stageBody}>
            <div className={styles.stageCopy} aria-live="polite"><h2 id="demo-stage-title">{step.title}</h2><p className={styles.stageDescription}>{step.description}</p>
              <p className={styles.stageDetail}>{step.detail}</p>
              {step.id === "building" && houseSelected && <p className={styles.selectionState}><Check size={17} aria-hidden="true" /> Sample house selected. Its approximate bounds are highlighted; no property was saved.</p>}
              {financialStage && financial && <div className={styles.financial} aria-label="Fictional financial fixture">
                <div className={styles.financialTitle}><strong>Fictional partial scenario</strong><span>Demo values only</span></div>
                <dl>{step.id === "benefits" ? <><div><dt>Selected central rule</dt><dd>{financial.central}</dd></div><div><dt>State, DISCOM and local</dt><dd>Undetermined</dd></div><div><dt>Selected within fixture</dt><dd>{financial.selectedTotal}</dd></div></>
                  : <><div><dt>Sample gross quote</dt><dd>{financial.gross}</dd></div><div><dt>Selected modeled benefit</dt><dd>{financial.selectedTotal}</dd></div><div><dt>Modeled net upfront</dt><dd>{financial.net}</dd></div></>}</dl>
                <p>{financial.coverageComplete ? "This fixture marks rule coverage complete." : "Policy coverage is incomplete. Other eligible rules or exclusions could change the result."}</p>
              </div>}
              <div className={styles.stageActions}><Link className={styles.deepLink} href={step.href}>{step.action}<ArrowUpRight size={17} aria-hidden="true" /></Link>
                {step.id === "building" && <Link className={styles.locationLink} href="/app/analyze">Use my current location once in the real map</Link>}</div>
            </div>
            <RoofScene phase={step.id} houseSelected={houseSelected} onSelectHouse={() => setHouseSelected(true)} />
          </div>
          <div className={styles.stageFooter}><button type="button" onClick={() => setCurrent(previous => Math.max(0, previous - 1))} disabled={current === 0}><ArrowLeft size={17} aria-hidden="true" /> Previous</button>
            <div className={styles.progress} role="img" aria-label={`Stage ${current + 1} of ${steps.length}`}><span style={{ width: `${((current + 1) / steps.length) * 100}%` }} /></div>
            <button type="button" onClick={() => setCurrent(previous => Math.min(steps.length - 1, previous + 1))} disabled={current === steps.length - 1}>Next <ArrowRight size={17} aria-hidden="true" /></button></div>
        </section>
      </div>
      <footer className={styles.footer}><p>SolarSaathi connects roof geometry, deterministic calculations, policy evidence and the steps that follow.</p><Link href="/app/analyze">Begin an assessment<ArrowUpRight size={16} aria-hidden="true" /></Link></footer>
    </div>
  </main>;
}
