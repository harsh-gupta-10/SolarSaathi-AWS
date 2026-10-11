import Link from "next/link";
import { ArrowRight, Building2, ClipboardCheck, FileSearch, Scale, ShieldCheck, Sun, Wallet } from "lucide-react";
import { HeroAsk } from "../components/hero-ask";
import { MarketingConsultantAction, MarketingFooterDashboardLink, MarketingHeaderActions } from "../components/marketing-auth-actions";
import { RoofIllustration } from "../components/roof-illustration";
import { getPublicEnvironment } from "../lib/env";

const STEPS = [
  { icon: Sun, title: "Find your roof", text: "Share your address or location. We show your building from satellite imagery and you confirm it is the right one." },
  { icon: Wallet, title: "See system, cost and savings", text: "Compare system sizes for your roof, a cost range with its sources, and what you could save each year." },
  { icon: ClipboardCheck, title: "Get ready to apply", text: "Check which benefits you may qualify for and get a checklist of documents and steps for your application." },
];

const FACTS = [
  { icon: Scale, title: "Benefits are rules, not promises", text: "Central, state and DISCOM benefits are checked for eligibility and for overlaps before any amount is shown." },
  { icon: FileSearch, title: "Every figure shows its source", text: "Amounts come with the source, version and the date it was last checked. Prices are indicative ranges, not offers." },
  { icon: ShieldCheck, title: "Space-feasible, not structure-approved", text: "We measure the space on your roof. Structural safety needs an on-site engineer." },
];

export default function Home() {
  const environment = getPublicEnvironment();
  const liveServicesConfigured = Boolean(
    environment.NEXT_PUBLIC_API_BASE_URL && environment.NEXT_PUBLIC_GOOGLE_MAPS_KEY &&
    environment.NEXT_PUBLIC_COGNITO_USER_POOL_ID && environment.NEXT_PUBLIC_COGNITO_CLIENT_ID,
  );

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-5 py-4">
        <Link href="/" aria-label="SolarSaathi home" className="flex items-center gap-2 text-lg font-semibold">
          <span aria-hidden="true" className="inline-flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground"><Sun className="size-5" /></span>
          SolarSaathi
        </Link>
        <nav aria-label="Site navigation" className="order-3 flex w-full items-center gap-5 overflow-x-auto text-sm font-medium text-muted-foreground sm:order-none sm:w-auto">
          <a href="#how-it-works" className="min-h-11 whitespace-nowrap py-3 hover:text-foreground">How it works</a>
          <a href="#trust" className="min-h-11 whitespace-nowrap py-3 hover:text-foreground">Why trust it</a>
          <a href="#installers" className="min-h-11 whitespace-nowrap py-3 hover:text-foreground">For installers</a>
          <Link href="/demo" className="min-h-11 whitespace-nowrap py-3 hover:text-foreground">Guided demo</Link>
        </nav>
        <MarketingHeaderActions />
      </header>

      <main id="main-content">
        <section className="mx-auto grid w-full max-w-6xl items-center gap-10 px-5 pb-16 pt-8 lg:grid-cols-[1.15fr_1fr]" aria-labelledby="hero-title">
          <div>
            <p className="mb-3 text-sm font-semibold text-primary">Rooftop solar for Indian homes</p>
            <h1 id="hero-title" className="text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
              Ask SolarSaathi about solar for your home.
            </h1>
            <p className="mb-8 mt-4 max-w-xl text-lg text-muted-foreground">
              Find out what fits on your roof, what it could cost, which subsidies you may qualify for, and what to do next, step by step.
            </p>
            <HeroAsk />
            <p className="mt-6 text-sm">
              <Link href="/demo" className="inline-flex min-h-11 items-center gap-1 font-medium text-primary underline-offset-4 hover:underline">
                See a sample analysis <ArrowRight aria-hidden="true" className="size-4" />
              </Link>
            </p>
          </div>
          <div>
            <RoofIllustration />
          </div>
        </section>

        <section id="how-it-works" className="border-y bg-muted/60" aria-labelledby="how-title">
          <div className="mx-auto w-full max-w-6xl px-5 py-16">
            <h2 id="how-title" className="text-3xl font-semibold tracking-tight">From your address to your application in three steps</h2>
            <ol className="mt-8 grid gap-5 md:grid-cols-3">
              {STEPS.map(({ icon: Icon, title, text }, index) => (
                <li key={title} className="rounded-2xl border bg-background p-6 shadow-xs">
                  <span aria-hidden="true" className="mb-4 inline-flex size-10 items-center justify-center rounded-full bg-secondary text-primary"><Icon className="size-5" /></span>
                  <h3 className="text-lg font-semibold"><span className="mr-2 text-muted-foreground">{index + 1}.</span>{title}</h3>
                  <p className="mt-2 text-muted-foreground">{text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="trust" className="mx-auto w-full max-w-6xl px-5 py-16" aria-labelledby="trust-title">
          <h2 id="trust-title" className="text-3xl font-semibold tracking-tight">Plain answers you can check</h2>
          <p className="mt-3 max-w-2xl text-muted-foreground">
            Calculations are done by fixed, tested rules. The assistant explains them in plain language and never makes up numbers.
            Benefit amounts appear only once a rule has been verified against an official source.
          </p>
          <ul className="mt-8 grid gap-5 md:grid-cols-3">
            {FACTS.map(({ icon: Icon, title, text }) => (
              <li key={title} className="rounded-2xl border p-6">
                <Icon aria-hidden="true" className="mb-3 size-6 text-primary" />
                <h3 className="text-lg font-semibold">{title}</h3>
                <p className="mt-2 text-muted-foreground">{text}</p>
              </li>
            ))}
          </ul>
          <p className="mt-6 text-sm text-muted-foreground">
            Official sources we follow:{" "}
            <a className="underline underline-offset-2" href="https://mnre.gov.in" rel="noopener noreferrer" target="_blank">MNRE</a>,{" "}
            <a className="underline underline-offset-2" href="https://pmsuryaghar.gov.in" rel="noopener noreferrer" target="_blank">PM Surya Ghar portal</a>
            {" "}and your state electricity company.
          </p>
        </section>

        <section id="installers" className="mx-auto w-full max-w-6xl px-5 pb-16" aria-labelledby="installers-title">
          <div className="flex flex-col items-start justify-between gap-6 rounded-2xl bg-secondary p-8 md:flex-row md:items-center">
            <div className="flex gap-4">
              <Building2 aria-hidden="true" className="mt-1 size-7 shrink-0 text-primary" />
              <div>
                <h2 id="installers-title" className="text-2xl font-semibold">For installers and consultants</h2>
                <p className="mt-1 max-w-xl text-muted-foreground">Manage customers, roofs, benefit checks and proposals in one workspace, with the same sourced numbers your customers see.</p>
              </div>
            </div>
            <MarketingConsultantAction />
          </div>
        </section>
      </main>

      <footer className="border-t">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-8 text-sm text-muted-foreground">
          <p className="m-0">SolarSaathi: rooftop solar for India, built on checked facts.</p>
          <nav aria-label="Footer" className="flex items-center gap-5">
            <Link href="/demo" className="hover:text-foreground">Guided demo</Link>
            <MarketingFooterDashboardLink />
            <Link href="/app/help" className="hover:text-foreground">Help</Link>
          </nav>
          {liveServicesConfigured && <p className="m-0 w-full text-xs">Development preview</p>}
        </div>
      </footer>
    </div>
  );
}
