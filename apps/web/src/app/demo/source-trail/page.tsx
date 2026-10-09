import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ArrowUpRight, CheckCircle2, CircleHelp, FileText, ShieldAlert } from "lucide-react";
import { demoRoof } from "../fixtures";
import { demoFinancialResponse } from "../system-financial-fixture";
import { demoPolicyFinancialResponse } from "../policy-financial-fixture";

export const metadata: Metadata = {
  title: "Source trail demo | SolarSaathi",
  robots: { index: false, follow: false },
};

const money = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const date = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
const exampleDecision = demoPolicyFinancialResponse.benefits.result!.decisions[0]!;
const exampleCitation = exampleDecision.citations[0]!;
const exampleCheck = exampleDecision.sourceChecks[0]!;
const exampleProjection = demoPolicyFinancialResponse.projection!;

const chronology = [
  { at: exampleDecision.effectiveFrom, title: "Illustrative effective date", detail: "This date belongs to the fictional rule fixture. It is not a government notification." },
  { at: exampleCitation.retrievedAt, title: "Illustrative archive", detail: "A mock document title, locator and hash show what a real archived citation would carry." },
  { at: exampleCheck.lastCheckedAt!, title: "Illustrative source check", detail: "The fixture says healthy. No official host was fetched or checked for this demo." },
  { at: demoPolicyFinancialResponse.benefits.evaluatedAt, title: "Deterministic example result", detail: "The calculator applies the fixture amount to a hypothetical quote. This is not an eligibility decision." },
];

export default function SourceTrailDemoPage() {
  return <main id="main-content" className="container max-w-6xl py-8 md:py-14">
    <nav aria-label="Demo navigation" className="mb-8 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
      <Link href="/demo" className="inline-flex items-center gap-2 font-medium text-primary underline underline-offset-4"><ArrowLeft size={16} aria-hidden="true" /> Guided demo</Link>
      <Link href="/demo/policy-financial" className="inline-flex items-center gap-1 text-primary underline underline-offset-4">Financial detail <ArrowUpRight size={14} aria-hidden="true" /></Link>
    </nav>

    <div className="grid gap-8 border-b border-emerald-900/15 pb-10 md:grid-cols-[minmax(0,1fr)_17rem] md:gap-14">
      <div>
        <p className="mb-3 inline-flex rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-950">Fictional fixture · no live source check</p>
        <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-slate-950 md:text-6xl">Where does this number come from?</h1>
        <p className="mt-5 max-w-2xl text-base leading-7 text-slate-700 md:text-lg">Follow the roof input, planning model, cited rule and calculation behind this offline example. Every policy record, timestamp and status below is invented for the demo.</p>
      </div>
      <aside className="self-start border-l-4 border-amber-500 bg-amber-50 p-5 text-sm leading-6 text-amber-950" role="note" aria-label="Demo data boundary">
        <ShieldAlert className="mb-3" size={22} aria-hidden="true" />
        <strong className="block text-base">No government claim</strong>
        <p className="mt-2">The source URL uses the reserved <code>example.invalid</code> domain and is deliberately not linked. The “verified” and “healthy” fields are fixture values only. No government policy was checked today.</p>
      </aside>
    </div>

    <section aria-labelledby="source-chain-title" className="py-10 md:py-14">
      <div className="mb-7 flex flex-wrap items-end justify-between gap-3"><div><h2 id="source-chain-title" className="text-2xl font-semibold tracking-tight text-slate-950 md:text-3xl">The example calculation chain</h2><p className="mt-2 text-sm text-slate-600">Each figure has a different origin. The browser does not decide subsidy eligibility.</p></div><span className="text-sm font-medium text-amber-900">Partial policy coverage</span></div>
      <ol className="grid gap-0 overflow-hidden rounded-2xl border border-slate-200 bg-white md:grid-cols-4">
        <li className="border-b border-slate-200 p-5 md:border-b-0 md:border-r"><span className="text-xs font-medium text-slate-500">1 · User input</span><strong className="mt-3 block text-2xl text-slate-950">{demoRoof.roofAreaSquareMeters} m²</strong><p className="mt-2 text-sm leading-6 text-slate-600">Synthetic manual roof area; no Google Solar measurement or site survey.</p></li>
        <li className="border-b border-slate-200 p-5 md:border-b-0 md:border-r"><span className="text-xs font-medium text-slate-500">2 · Planning code</span><strong className="mt-3 block text-2xl text-slate-950">{demoFinancialResponse.system.nominalKw} kW</strong><p className="mt-2 text-sm leading-6 text-slate-600">{demoFinancialResponse.system.panelCount} modeled panels, {demoFinancialResponse.system.actualDcKw} kW DC. Fit and yield are assumptions.</p></li>
        <li className="border-b border-slate-200 p-5 md:border-b-0 md:border-r"><span className="text-xs font-medium text-slate-500">3 · Fictional policy</span><strong className="mt-3 block text-2xl text-slate-950">{money.format(exampleDecision.countedAmountPaise! / 100)}</strong><p className="mt-2 text-sm leading-6 text-slate-600">One made-up central benefit. No state, DISCOM, local or other scope has verified coverage here.</p></li>
        <li className="p-5"><span className="text-xs font-medium text-slate-500">4 · Financial code</span><strong className="mt-3 block text-2xl text-slate-950">{money.format(exampleProjection.netUpfrontCostPaise / 100)}</strong><p className="mt-2 text-sm leading-6 text-slate-600">Modeled net from a hypothetical {money.format(exampleProjection.grossCostPaise / 100)} quote, assuming upfront benefit receipt.</p></li>
      </ol>
    </section>

    <div className="grid gap-10 border-t border-slate-200 py-10 md:grid-cols-[minmax(0,1.35fr)_minmax(16rem,0.75fr)] md:gap-14 md:py-14">
      <section aria-labelledby="fixture-record-title">
        <div className="flex items-start gap-3"><FileText className="mt-1 shrink-0 text-emerald-800" size={22} aria-hidden="true" /><div><h2 id="fixture-record-title" className="text-2xl font-semibold tracking-tight text-slate-950">What a source record should reveal</h2><p className="mt-2 text-sm leading-6 text-slate-600">This panel demonstrates the fields a real policy result must expose. Every value shown is synthetic.</p></div></div>
        <dl className="mt-6 divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white px-5">
          <div className="grid gap-1 py-4 sm:grid-cols-[9rem_1fr]"><dt className="text-sm text-slate-500">Publisher and document</dt><dd className="text-sm font-medium text-slate-900">{exampleCitation.publisherName} · {exampleCitation.documentTitle}</dd></div>
          <div className="grid gap-1 py-4 sm:grid-cols-[9rem_1fr]"><dt className="text-sm text-slate-500">Jurisdiction and rule</dt><dd className="break-words text-sm font-medium text-slate-900">{exampleDecision.jurisdiction} · {exampleDecision.policyId} v{exampleDecision.policyVersion}</dd></div>
          <div className="grid gap-1 py-4 sm:grid-cols-[9rem_1fr]"><dt className="text-sm text-slate-500">Archive locator</dt><dd className="text-sm font-medium text-slate-900">Document v{exampleCitation.documentVersion} · {exampleCitation.locator.section} · synthetic hash {exampleCitation.documentSha256.slice(0, 10)}…</dd></div>
          <div className="grid gap-1 py-4 sm:grid-cols-[9rem_1fr]"><dt className="text-sm text-slate-500">Source address</dt><dd className="break-all text-sm font-medium text-slate-900">{exampleCitation.sourceUrl} (reserved invalid domain)</dd></div>
          <div className="grid gap-1 py-4 sm:grid-cols-[9rem_1fr]"><dt className="text-sm text-slate-500">Fixture health</dt><dd className="flex items-center gap-2 text-sm font-medium text-slate-900"><CheckCircle2 className="text-emerald-800" size={16} aria-hidden="true" /> {exampleCheck.status}, fresh in fixture only</dd></div>
        </dl>
        <p className="mt-4 flex gap-2 text-sm leading-6 text-slate-600"><CircleHelp className="mt-0.5 shrink-0" size={17} aria-hidden="true" /> A real result needs a current official archive, an independently approved rule, and compatible benefits across applicable jurisdictions.</p>
      </section>
      <section aria-labelledby="chronology-title">
        <h2 id="chronology-title" className="text-2xl font-semibold tracking-tight text-slate-950">Example chronology</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">Illustrative fixture dates, not actual crawl or approval events.</p>
        <ol className="mt-6 border-l-2 border-emerald-800/30 pl-6">{chronology.map((item, index) => <li key={item.title} className={`relative ${index < chronology.length - 1 ? "pb-8" : ""}`}>
          <span className="absolute -left-[31px] top-1 h-3 w-3 rounded-full border-2 border-emerald-800 bg-white" aria-hidden="true" />
          <span className="text-xs font-medium text-emerald-900">{date.format(new Date(item.at))}</span><h3 className="mt-1 font-semibold text-slate-950">{item.title}</h3><p className="mt-1 text-sm leading-6 text-slate-600">{item.detail}</p></li>)}</ol>
      </section>
    </div>

    <div className="rounded-2xl bg-emerald-950 p-6 text-white md:flex md:items-center md:justify-between md:gap-8 md:p-8"><div><h2 className="text-xl font-semibold">Policy coverage is still incomplete.</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-emerald-50">The fictional central rule is the only counted example. SolarSaathi would need verified, compatible records for state, DISCOM, local and other scopes before claiming a complete benefit picture.</p></div><Link href="/demo" className="mt-5 inline-flex shrink-0 items-center gap-2 rounded-lg bg-white px-4 py-3 text-sm font-semibold text-emerald-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400 md:mt-0">Return to guided demo <ArrowUpRight size={16} aria-hidden="true" /></Link></div>
  </main>;
}
