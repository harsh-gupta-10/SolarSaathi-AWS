import Link from "next/link";
import { ArrowRight, Sun } from "lucide-react";
import { HeroAsk } from "../components/hero-ask";
import { HeroHouse, PanelModel } from "../components/marketing-3d";
import { MarketingConsultantAction, MarketingFooterDashboardLink, MarketingHeaderActions } from "../components/marketing-auth-actions";
import { getPublicEnvironment } from "../lib/env";

const STEPS = [
  { title: "Find your roof", text: "Share your address or location. We show your building from satellite imagery and you confirm it is the right one." },
  { title: "See system, cost and savings", text: "Compare system sizes for your roof, a cost range with its sources, and what you could save each year." },
  { title: "Get ready to apply", text: "Check which benefits you may qualify for and get a checklist of documents and steps for your application." },
];

const FACTS = [
  { title: "Benefits are rules, not promises", text: "Central, state and DISCOM benefits are checked for eligibility and for overlaps before any amount is shown." },
  { title: "Every figure shows its source", text: "Amounts come with the source, version and the date it was last checked. Prices are indicative ranges, not offers." },
  { title: "Space-feasible, not structure-approved", text: "We measure the space on your roof. Structural safety needs an on-site engineer." },
];

const DISPLAY = "font-[family-name:var(--font-display)] font-normal uppercase leading-[0.9] tracking-[-0.03em]";
const MONO = "font-[family-name:var(--font-mono)] text-xs tracking-[-0.03em]";
const LINK = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black";

export default function Home() {
  const environment = getPublicEnvironment();
  const liveServicesConfigured = Boolean(
    environment.NEXT_PUBLIC_API_BASE_URL && environment.NEXT_PUBLIC_GOOGLE_MAPS_KEY &&
    environment.NEXT_PUBLIC_COGNITO_USER_POOL_ID && environment.NEXT_PUBLIC_COGNITO_CLIENT_ID,
  );

  return (
    <div className="min-h-screen bg-[#e5e5e5] text-black">
      <header className="mx-auto flex w-full max-w-[1200px] flex-wrap items-center justify-between gap-x-6 gap-y-2 px-5 py-4 md:min-h-32 md:flex-nowrap">
        <Link href="/" aria-label="SolarSaathi home" className={`flex items-center gap-2 text-lg font-medium ${LINK}`}>
          <span aria-hidden="true" className="inline-flex size-9 items-center justify-center rounded-lg bg-black text-[#fff100]"><Sun className="size-5" /></span>
          SolarSaathi
        </Link>
        <nav aria-label="Site navigation" className="order-3 flex w-full items-center gap-6 overflow-x-auto rounded-[48px] bg-white px-6 text-base font-medium text-[#444] md:order-none md:w-auto">
          <a href="#how-it-works" className={`min-h-12 whitespace-nowrap py-3.5 hover:text-black ${LINK}`}>How it works</a>
          <a href="#trust" className={`min-h-12 whitespace-nowrap py-3.5 hover:text-black ${LINK}`}>Why trust it</a>
          <a href="#installers" className={`min-h-12 whitespace-nowrap py-3.5 hover:text-black ${LINK}`}>For installers</a>
          <Link href="/demo" className={`min-h-12 whitespace-nowrap py-3.5 hover:text-black ${LINK}`}>Guided demo</Link>
        </nav>
        <MarketingHeaderActions />
      </header>

      <main id="main-content">
        <section className="mx-auto grid w-full max-w-[1200px] items-start gap-8 px-5 pb-10 pt-4 lg:grid-cols-[1.1fr_1fr] lg:items-center" aria-labelledby="hero-title">
          <div>
            <p className={`${MONO} mb-6 inline-block rounded-[64px] bg-[#d1ffca] px-4 py-2`}>Rooftop solar for Indian homes</p>
            <h1 id="hero-title" className={`${DISPLAY} text-[clamp(3.25rem,8vw,7.5rem)]`}>
              Ask SolarSaathi about solar for your home.
            </h1>
            <p className="mt-6 max-w-xl text-lg font-medium text-[#444]">
              Find out what fits on your roof, what it could cost, which subsidies you may qualify for, and what to do next, step by step.
            </p>
          </div>
          <div className="lg:-mt-6">
            <HeroHouse />
          </div>
        </section>

        <section id="ask" className="mx-auto w-full max-w-[1200px] px-5 pb-20" aria-label="Ask SolarSaathi">
          <div className="rounded-[40px] bg-white p-6 shadow-xs ring-1 ring-black/5 md:p-10">
            <HeroAsk />
            <p className="mt-5 text-sm">
              <Link href="/demo" className={`inline-flex min-h-11 items-center gap-1.5 font-semibold text-black underline-offset-4 hover:underline ${LINK}`}>
                See a sample analysis <ArrowRight aria-hidden="true" className="size-4" />
              </Link>
            </p>
          </div>
        </section>

        <section id="how-it-works" className="mx-auto w-full max-w-[1200px] px-5 pb-20" aria-labelledby="how-title">
          <h2 id="how-title" className={`${DISPLAY} max-w-4xl text-[clamp(2.5rem,6vw,5rem)]`}>From your address to your application in three steps</h2>
          <ol className="mt-12 grid gap-4 md:grid-cols-3">
            {STEPS.map(({ title, text }, index) => (
              <li key={title} className="flex flex-col rounded-[32px] bg-white p-6">
                <span aria-hidden="true" className={`${MONO} mb-16 inline-block self-start rounded-[64px] bg-[#d1ffca] px-3 py-1`}>0{index + 1}</span>
                <h3 className="text-[1.75rem] font-medium uppercase leading-[1.1] tracking-[-0.02em]">{title}</h3>
                <p className="mt-4 text-base font-medium text-[#444]">{text}</p>
              </li>
            ))}
          </ol>
        </section>

        <section id="trust" className="rounded-t-[64px] bg-black text-white" aria-labelledby="trust-title">
          <div className="mx-auto grid w-full max-w-[1200px] items-center gap-12 px-5 py-20 lg:grid-cols-2">
            <div>
              <h2 id="trust-title" className={`${DISPLAY} text-[clamp(2.5rem,6vw,5rem)]`}>Plain answers you can check</h2>
              <p className="mt-6 max-w-xl text-base font-medium text-[#979797]">
                Calculations are done by fixed, tested rules. The assistant explains them in plain language and never makes up numbers.
                Benefit amounts appear only once a rule has been verified against an official source.
              </p>
              <ul className="mt-10 grid gap-4">
                {FACTS.map(({ title, text }) => (
                  <li key={title} className="rounded-[24px] bg-[#2f2f2f] p-6">
                    <h3 className="text-xl font-medium">{title}</h3>
                    <p className="mt-2 text-base text-[#c6c6c6]">{text}</p>
                  </li>
                ))}
              </ul>
              <p className="mt-8 text-sm text-[#979797]">
                Official sources we follow:{" "}
                <a className="text-[#d1ffca] underline underline-offset-2" href="https://mnre.gov.in" rel="noopener noreferrer" target="_blank">MNRE</a>,{" "}
                <a className="text-[#d1ffca] underline underline-offset-2" href="https://pmsuryaghar.gov.in" rel="noopener noreferrer" target="_blank">PM Surya Ghar portal</a>
                {" "}and your state electricity company.
              </p>
            </div>
            <PanelModel />
          </div>
        </section>

        <section id="installers" className="bg-black px-5 pb-20" aria-labelledby="installers-title">
          <div className="mx-auto flex w-full max-w-[1200px] flex-col items-start justify-between gap-8 rounded-[48px] border border-white/15 bg-gradient-to-br from-[#d1ffca] via-[#e3ffde] to-[#f6ff9e] p-8 text-black shadow-[0_24px_60px_rgba(209,255,202,0.12)] md:flex-row md:items-center md:p-12">
            <div className="max-w-2xl">
              <p className={`${MONO} mb-4 inline-block rounded-[64px] bg-black px-4 py-2 text-[#d1ffca]`}>For installers and consultants</p>
              <h2 id="installers-title" className={`${DISPLAY} text-[clamp(2.5rem,5vw,4rem)] text-black`}>One workspace for every customer roof</h2>
              <p className="mt-4 max-w-xl text-base font-medium text-[#1f2e1d]">
                Manage customers, roofs, benefit checks and proposals in one workspace, with the same sourced numbers your customers see.
              </p>
            </div>
            <MarketingConsultantAction />
          </div>
        </section>
      </main>

      <footer className="bg-black text-[#979797]">
        <div className="mx-auto flex w-full max-w-[1200px] flex-wrap items-center justify-between gap-4 border-t border-[#2f2f2f] px-5 py-8 text-sm">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <p className="m-0">SolarSaathi: rooftop solar for India, built on checked facts.</p>
            <span aria-hidden="true" className="text-[#444]">•</span>
            <p className="m-0">
              Made by{" "}
              <a
                href="https://github.com/harsh-gupta-10"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-[#d1ffca] underline underline-offset-4 transition hover:text-[#fff100]"
              >
                Harsh Gupta
              </a>
            </p>
          </div>
          <nav aria-label="Footer" className="flex items-center gap-5 text-white">
            <Link href="/demo" className="hover:underline">Guided demo</Link>
            <MarketingFooterDashboardLink />
            <Link href="/app/help" className="hover:underline">Help</Link>
          </nav>
          {liveServicesConfigured && <p className={`${MONO} m-0 w-full`}>Development preview</p>}
        </div>
      </footer>
    </div>
  );
}
