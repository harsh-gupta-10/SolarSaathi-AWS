import Link from "next/link";
import { ArrowRight, ArrowUpRight, Building2, Check, Compass, FileText, Layers, ShieldCheck, Sun } from "lucide-react";
import { AddressForm } from "../components/address-form";
import { MarketingConsultantAction, MarketingFooterDashboardLink, MarketingHeaderActions } from "../components/marketing-auth-actions";
import { RoofIllustration } from "../components/roof-illustration";
import { getPublicEnvironment } from "../lib/env";

export default function Home() {
  const environment = getPublicEnvironment();
  const liveServicesConfigured = Boolean(
    environment.NEXT_PUBLIC_API_BASE_URL &&
    environment.NEXT_PUBLIC_GOOGLE_MAPS_KEY &&
    environment.NEXT_PUBLIC_COGNITO_USER_POOL_ID &&
    environment.NEXT_PUBLIC_COGNITO_CLIENT_ID,
  );

  return (
    <div className="marketing-page">
      {/* Samara Dark Announcement / Top Hero Banner */}
      <aside className="samara-announcement-bar" aria-label="System environment status">
        <div className="container samara-announcement-content">
          <p className="availability">
            <span className="availability-dot" aria-hidden="true" />
            {liveServicesConfigured
              ? "Development environment — live map and account services configured"
              : "Local preview — live integrations need cloud configuration"}
          </p>
          <div className="announcement-actions">
            <span className="announcement-spec" aria-hidden="true">MODEL: SAMARA ARCHITECTURAL 2026</span>
            <Link href="/demo" className="samara-urgent-cta">
              Explore guided demo <ArrowUpRight size={13} aria-hidden="true" />
            </Link>
          </div>
        </div>
      </aside>

      {/* Main Site Header */}
      <header className="site-header container">
        <Link className="brand" href="/" aria-label="SolarSaathi home">
          <span className="brand-icon-wrapper" aria-hidden="true">
            <Sun className="brand-sun" />
          </span>
          <span className="brand-text">
            SolarSaathi
            <span className="brand-tagline">Architectural Solar Blueprint</span>
          </span>
        </Link>
        <nav aria-label="Site navigation" className="site-nav">
          <a href="#how-it-works">How it works</a>
          <a href="#blueprint">Architectural model</a>
          <a href="#trust">Policy intelligence</a>
          <a href="#consultants">For consultants</a>
          <Link href="/demo">Guided demo</Link>
        </nav>
        <div className="header-actions">
          <MarketingHeaderActions />
        </div>
      </header>

      <main id="main-content">
        {/* Hero Section */}
        <section className="hero container" aria-labelledby="hero-title">
          <div className="hero-content">
            <div className="samara-kicker">
              <span className="kicker-glyph" aria-hidden="true" />
              <span>DETERMINISTIC ROOFTOP SOLAR PROTOCOL</span>
            </div>

            <h1 id="hero-title" className="samara-display-heading">
              Your roof.{" "}
              <span className="inline-render-chip" aria-hidden="true">
                <span className="chip-indicator" />
                <span>3D BLUEPRINT</span>
              </span>{" "}
              A clearer path to solar.
            </h1>

            <p className="hero-description">
              From the space above your home to the steps ahead. Plan your rooftop, understand the costs, and follow benefits back to their source.
            </p>

            <div className="hero-form-wrapper">
              <AddressForm />
            </div>

            <div className="hero-foot-actions">
              <p className="hero-demo-link">
                <Link href="/demo" className="samara-link-cta">
                  Explore the guided synthetic demo <ArrowUpRight size={17} aria-hidden="true" />
                </Link>
              </p>
              <p className="hero-assurance">
                <ShieldCheck size={18} aria-hidden="true" className="assurance-icon" />
                <span>Planning assumptions stay visible. No guaranteed subsidies.</span>
              </p>
            </div>
          </div>

          <div className="hero-visual">
            <RoofIllustration />
          </div>
        </section>

        {/* Architectural Blueprint Specifications Strip */}
        <section className="blueprint-specs-section container" id="blueprint" aria-labelledby="specs-title">
          <div className="specs-header">
            <p className="specs-subheading">ARCHITECTURAL RESTRAINT & DETERMINISTIC PRECISION</p>
            <h2 id="specs-title" className="specs-title">A blueprint rendered on warm paper. Built on facts.</h2>
          </div>
          <div className="specs-grid">
            <div className="spec-card">
              <div className="spec-card-top">
                <span className="spec-index">[ 01 ]</span>
                <Layers size={18} className="spec-icon" aria-hidden="true" />
              </div>
              <h3 className="spec-card-title">Deterministic Geometry</h3>
              <p className="spec-card-text">Google Solar 3D lidar mesh and rooftop tilt calculations. Area-feasible metrics remain separate from structural approvals.</p>
            </div>
            <div className="spec-card">
              <div className="spec-card-top">
                <span className="spec-index">[ 02 ]</span>
                <Compass size={18} className="spec-icon" aria-hidden="true" />
              </div>
              <h3 className="spec-card-title">Living Space Preservation</h3>
              <p className="spec-card-text">Every layout reserves clear 1.0m service walkways and preserves usable open terrace zones for gardens, leisure, and daily life.</p>
            </div>
            <div className="spec-card">
              <div className="spec-card-top">
                <span className="spec-index">[ 03 ]</span>
                <FileText size={18} className="spec-icon" aria-hidden="true" />
              </div>
              <h3 className="spec-card-title">Unstacked Policy Rules</h3>
              <p className="spec-card-text">Central PM Surya Ghar, State incentives and DISCOM net metering evaluated without double-counting or fabricated promises.</p>
            </div>
            <div className="spec-card">
              <div className="spec-card-top">
                <span className="spec-index">[ 04 ]</span>
                <ShieldCheck size={18} className="spec-icon" aria-hidden="true" />
              </div>
              <h3 className="spec-card-title">Verifiable Citation Trail</h3>
              <p className="spec-card-text">Every published regulation references exact official gazettes, DISCOM circulars, version timestamps, and reviewer audit trails.</p>
            </div>
          </div>
        </section>

        {/* Journey Section (How It Works) */}
        <section className="journey-section container" id="how-it-works" aria-labelledby="journey-title">
          <div className="section-heading">
            <div>
              <p className="section-kicker">STEPWISE DECISION PROTOCOL</p>
              <h2 id="journey-title" className="section-title">One roof. One guided journey.</h2>
            </div>
            <p className="section-lead">Start with what you know. Confirm the details before you decide.</p>
          </div>

          <ol className="journey-list">
            <li className="samara-standard-card">
              <div className="card-topline">
                <span className="step-number">01</span>
                <span className="blueprint-marker">DIMENSIONAL SCAN</span>
              </div>
              <h3>Find your roof</h3>
              <p>Enter an address, use your location once, choose the house and confirm Google Solar or manual roof measurements.</p>
              <div className="card-footer">
                <span className="feature-status">Workspace flow built</span>
                <span className="feature-sub">Lidar + Area validation</span>
              </div>
            </li>

            <li className="samara-warm-sand-card">
              <div className="card-topline">
                <span className="step-number featured">02</span>
                <span className="blueprint-marker featured">POLICY & SYSTEM ENGINE</span>
              </div>
              <h3>See the whole decision</h3>
              <p>Roof constraints, system choices, costs and compatible incentives — kept separate and explainable.</p>
              <div className="card-footer">
                <span className="feature-status">Synthetic demo available</span>
                <span className="feature-sub">Full financial transparency</span>
              </div>
            </li>

            <li className="samara-standard-card">
              <div className="card-topline">
                <span className="step-number">03</span>
                <span className="blueprint-marker">EXECUTION & ACCREDITATION</span>
              </div>
              <h3>Know the next step</h3>
              <p>Explore a cited application checklist, useful accessories and ideas for the space that remains.</p>
              <div className="card-footer">
                <span className="feature-status">Synthetic demo available</span>
                <span className="feature-sub">Cited regulatory milestones</span>
              </div>
            </li>
          </ol>
        </section>

        {/* Trust Section */}
        <section className="trust-section container" id="trust" aria-labelledby="trust-title">
          <div className="trust-card samara-warm-sand-card">
            <div className="trust-narrative">
              <div className="trust-badge">
                <ShieldCheck size={28} className="trust-shield-icon" aria-hidden="true" />
                <span className="trust-badge-label">POLICY ENGINE INTEGRITY</span>
              </div>
              <h2 id="trust-title" className="trust-heading">A benefit is a rule, not a promise.</h2>
              <p className="trust-lead">
                SolarSaathi checks eligibility and compatibility before adding benefits. Policy results carry their source, version and verification status.
              </p>
              <p className="muted trust-disclaimer">
                There is no verified live policy corpus yet. Demo amounts are visibly fictional.
              </p>
              <div className="trust-action-row">
                <Link href="/demo" className="samara-btn-secondary">
                  <span>Explore verifiable demo trail</span>
                  <ArrowRight size={15} aria-hidden="true" />
                </Link>
              </div>
            </div>

            <div className="trust-checklist-wrapper">
              <div className="checklist-heading">ARCHITECTURAL VERIFICATION CRITERIA</div>
              <ul className="trust-list">
                <li>
                  <div className="check-icon-wrap" aria-hidden="true">
                    <Check size={16} />
                  </div>
                  <div>
                    <strong>Deterministic calculations</strong>
                    <span className="trust-item-desc">Fixed mathematical equations — LLMs explain findings, never fabricate numbers.</span>
                  </div>
                </li>
                <li>
                  <div className="check-icon-wrap" aria-hidden="true">
                    <Check size={16} />
                  </div>
                  <div>
                    <strong>Official sources, with a trail</strong>
                    <span className="trust-item-desc">Central gazettes, state policy circulars, and DISCOM tariff orders linked directly.</span>
                  </div>
                </li>
                <li>
                  <div className="check-icon-wrap" aria-hidden="true">
                    <Check size={16} />
                  </div>
                  <div>
                    <strong>Central, state and local benefits checked separately</strong>
                    <span className="trust-item-desc">Programs stack strictly subject to mutual compatibility and ceiling caps.</span>
                  </div>
                </li>
                <li>
                  <div className="check-icon-wrap" aria-hidden="true">
                    <Check size={16} />
                  </div>
                  <div>
                    <strong>Concepts, never structural approvals</strong>
                    <span className="trust-item-desc">Space-feasible metrics ensure service paths and structural reservations are preserved.</span>
                  </div>
                </li>
              </ul>
            </div>
          </div>
        </section>

        {/* Consultant Workspace Section */}
        <section className="consultant-section container" id="consultants" aria-labelledby="consultant-title">
          <div className="consultant-card samara-standard-card">
            <div className="consultant-icon-box" aria-hidden="true">
              <Building2 size={32} />
            </div>
            <div className="consultant-content">
              <span className="consultant-kicker">FOR CONSULTANTS & INSTALLERS</span>
              <h2 id="consultant-title" className="consultant-heading">More customers. The same clarity.</h2>
              <p className="consultant-text">
                A dedicated consultant workspace connects customers, properties, analyses, applications and proposals. Live customer operations require a configured account and backend.
              </p>
            </div>
            <div className="consultant-action">
              <MarketingConsultantAction />
            </div>
          </div>
        </section>
      </main>

      {/* Site Footer */}
      <footer className="site-footer container">
        <div className="footer-left">
          <Link className="brand" href="/" aria-label="SolarSaathi home">
            <span className="brand-icon-wrapper small" aria-hidden="true">
              <Sun className="brand-sun" />
            </span>
            <span className="brand-text">SolarSaathi</span>
          </Link>
          <p className="footer-motto">India-first rooftop solar, built on facts.</p>
        </div>
        <div className="footer-stamp" aria-hidden="true">
          <span>SAMARA ARCHITECTURAL SYSTEM • SUNLIT MODEL LIGHT THEME</span>
        </div>
        <div className="footer-links">
          <Link href="/demo">Guided demo</Link>
          <MarketingFooterDashboardLink />
          <Link href="/app/help">Help and development status</Link>
        </div>
      </footer>
    </div>
  );
}
