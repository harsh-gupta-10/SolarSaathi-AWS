import Link from "next/link";
import { ArrowUpRight, Building2, Check, ShieldCheck, Sun } from "lucide-react";
import { Button } from "@solarsaathi/ui";
import { AddressForm } from "../components/address-form";
import { RoofIllustration } from "../components/roof-illustration";

export default function Home() {
  return (
    <>
      <header className="site-header container">
        <Link className="brand" href="/" aria-label="SolarSaathi home"><Sun aria-hidden="true" /><span>SolarSaathi</span></Link>
        <nav aria-label="Site navigation"><a href="#how-it-works">How it works</a><a href="#consultants">For consultants</a></nav>
        <Button asChild variant="outline"><Link href="/app">Open workspace<ArrowUpRight aria-hidden="true" /></Link></Button>
      </header>
      <main id="main-content">
        <section className="hero container" aria-labelledby="hero-title">
          <div className="hero-content">
            <p className="availability"><span aria-hidden="true" />Development preview — live services are not connected</p>
            <h1 id="hero-title">Your roof. A clearer path to solar.</h1>
            <p className="hero-description">From the space above your home to the steps ahead. Plan your rooftop, understand the costs, and follow benefits back to their source.</p>
            <AddressForm />
            <p className="hero-assurance"><ShieldCheck size={18} aria-hidden="true" />No made-up savings. No guaranteed subsidies.</p>
          </div>
          <RoofIllustration />
        </section>
        <section className="journey-section container" id="how-it-works" aria-labelledby="journey-title">
          <div className="section-heading"><h2 id="journey-title">One roof. One guided journey.</h2><p>Start with what you know. Confirm the details before you decide.</p></div>
          <ol className="journey-list">
            <li><span className="step-number">1</span><h3>Find your roof</h3><p>Enter an address, choose the building, and confirm Google Solar or manual roof measurements when services are connected.</p><span className="feature-status">Address draft available</span></li>
            <li><span className="step-number">2</span><h3>See the whole decision</h3><p>Roof constraints, system choices, costs and compatible incentives — kept separate and explainable.</p><span className="feature-status planned">In development</span></li>
            <li><span className="step-number">3</span><h3>Know the next step</h3><p>A source-backed application checklist, useful accessories and ideas for the space that remains.</p><span className="feature-status planned">In development</span></li>
          </ol>
        </section>
        <section className="trust-section container" aria-labelledby="trust-title">
          <div><ShieldCheck size={30} aria-hidden="true" /><h2 id="trust-title">A benefit is a rule, not a promise.</h2><p>SolarSaathi is being built to check eligibility and compatibility before adding benefits. Every policy result will show its source, version and verification status.</p><p className="muted">Policy lookup is not yet connected. No live government amounts are shown in this preview.</p></div>
          <ul className="trust-list"><li><Check aria-hidden="true" />Deterministic calculations</li><li><Check aria-hidden="true" />Official sources, with a trail</li><li><Check aria-hidden="true" />Central, state and local benefits checked separately</li><li><Check aria-hidden="true" />Concepts, never structural approvals</li></ul>
        </section>
        <section className="consultant-section container" id="consultants" aria-labelledby="consultant-title">
          <div className="consultant-icon"><Building2 aria-hidden="true" /></div><div><h2 id="consultant-title">More customers. The same clarity.</h2><p>A dedicated consultant workspace for customers, properties, analyses and applications. Explore the broker navigation preview today; customer management follows in later phases.</p></div><Button asChild variant="outline"><Link href="/app">Explore the workspace<ArrowUpRight aria-hidden="true" /></Link></Button>
        </section>
      </main>
      <footer className="site-footer container"><Link className="brand" href="/"><Sun aria-hidden="true" /><span>SolarSaathi</span></Link><p>India-first rooftop solar, built on facts.</p><Link href="/app/help">Help and development status</Link></footer>
    </>
  );
}
