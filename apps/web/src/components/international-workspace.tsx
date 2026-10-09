"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowUpRight, Compass, Globe2, LocateFixed, Search, ShieldAlert, ShieldCheck } from "lucide-react";
import { Button, Input, Label } from "@solarsaathi/ui";
import { useAuth } from "../auth/auth-provider";
import { internationalApi, type InternationalResearchInput, type InternationalResearchResponse } from "../lib/international-api";
import { RoofRequestError } from "../lib/roof-api";

const stamp = (value: string) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric",
  hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(value));
const countryName = (code: string) => {
  if (code === "GB") return "GB (United Kingdom code)";
  try { return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code; } catch { return code; }
};
const reason = (code: string) => code.toLowerCase().replaceAll("_", " ").replace(/^./, first => first.toUpperCase());
const commonCountries = [["US", "United States"], ["GB", "United Kingdom"], ["AU", "Australia"],
  ["CA", "Canada"], ["DE", "Germany"], ["FR", "France"], ["JP", "Japan"], ["ZA", "South Africa"],
  ["SG", "Singapore"], ["NZ", "New Zealand"]] as const;

function ResearchResult({ result }: { result: InternationalResearchResponse }) {
  const label = result.status === "LIVE_RESEARCHED" ? "Live researched" :
    result.status === "INCOMPLETE" ? "Research incomplete" : "Research unavailable";
  return <section className="international-result" aria-labelledby="international-result-title">
    <div className="international-result-head"><div><span className="international-result-status" data-status={result.status}>{label}</span>
      <h2 id="international-result-title">{countryName(result.jurisdiction.countryCode)} source check</h2>
      <p>{result.jurisdiction.origin === "AMAZON_LOCATION" ? "Region from location" : "Region entered"}: {result.jurisdiction.region || "none"} · Utility entered: {result.jurisdiction.utility || "none"}</p></div>{result.status === "LIVE_RESEARCHED" ? <Globe2 aria-hidden="true" /> : <ShieldAlert aria-hidden="true" />}</div>
    <div className="international-evidence-strip"><div><span>Checked</span><strong>{stamp(result.researchedAt)}</strong></div>
      <div><span>Country selected from</span><strong>{result.jurisdiction.origin === "AMAZON_LOCATION" ? "Approximate one-time location" : "Your country entry"}</strong></div>
      <div><span>Research copy</span><strong>{result.cache.status === "HIT" ? "Temporary cached result" : result.cache.status === "MISS" ? "Checked for this request" : "Not stored"}</strong></div></div>
    <div className="international-boundary" role="note"><ShieldAlert size={19} aria-hidden="true" /><p>This is an on-demand source lookup, not a curated policy record. The listed pages may cover only part of this country, and the entered region or utility has not been verified as applicable. Eligibility, benefit amounts, deadlines and payment timing have not been evaluated.</p></div>
    {result.expiresAt && <p className="international-expiry">Temporary research copy expires {stamp(result.expiresAt)}. Recheck sources before making a decision.</p>}
    {result.coverage.reasonCodes.length > 0 && <div className="international-reasons"><h3>Why the result is limited</h3><ul>{result.coverage.reasonCodes.map(code => <li key={code}>{reason(code)}</li>)}</ul></div>}
    <div className="international-source-head"><div><h3>Official source pages found</h3><p>Open each source and check its current terms with the relevant authority or utility.</p></div><strong>{result.sources.length}</strong></div>
    {result.sources.length ? <ul className="international-sources">{result.sources.map(source => <li key={`${source.url}:${source.contentSha256}`}><div><span>Live researched · not curated</span><h4>{source.title}</h4><p>Authority website: {source.authorityHost}</p></div>
      <dl><div><dt>Page last modified</dt><dd>{source.sourceDate ? stamp(source.sourceDate) : "Not provided"}</dd></div><div><dt>Retrieved</dt><dd>{stamp(source.checkedAt)}</dd></div></dl>
      <a href={source.url} target="_blank" rel="noopener noreferrer">Open official source <ArrowUpRight size={16} aria-hidden="true" /></a></li>)}</ul> :
      <p className="international-no-sources">No authoritative source page was verified for this request. Check the relevant authority or utility directly.</p>}
    <p className="international-request">Research request {result.requestId}. No policy amount or eligibility decision was returned.</p>
  </section>;
}

function ConnectedResearch() {
  const [countryCode, setCountryCode] = useState("");
  const [region, setRegion] = useState("");
  const [utility, setUtility] = useState("");
  const [location, setLocation] = useState<InternationalResearchInput["location"]>();
  const [accuracy, setAccuracy] = useState<number>();
  const [locating, setLocating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [indiaRoute, setIndiaRoute] = useState(false);
  const [result, setResult] = useState<InternationalResearchResponse>();
  const request = useRef<AbortController | null>(null);
  const locationAttempt = useRef(0);
  useEffect(() => () => { request.current?.abort(); locationAttempt.current += 1; }, []);
  function clearResult() { request.current?.abort(); request.current = null; setBusy(false); setError(""); setIndiaRoute(false); setResult(undefined); }
  function manualCountry(value: string) {
    locationAttempt.current += 1; setLocating(false); setLocation(undefined); setAccuracy(undefined);
    setCountryCode(value.toUpperCase()); clearResult();
  }
  function locate() {
    clearResult();
    const attempt = ++locationAttempt.current;
    setLocating(true); setLocation(undefined); setAccuracy(undefined);
    if (!navigator.geolocation) { setLocating(false); setError("This browser cannot share its location. Enter a country code instead."); return; }
    try { navigator.geolocation.getCurrentPosition(position => {
      if (attempt !== locationAttempt.current) return;
      const { latitude, longitude, accuracy: meters } = position.coords;
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180 ||
        !Number.isFinite(meters) || meters < 0) {
        setLocating(false); setError("The device returned an invalid location. Enter a country code instead."); return;
      }
      if (meters > 1_000) {
        setLocating(false); setError("The device location is too approximate for a country lookup (over 1 km). Enter a country code instead."); return;
      }
      setCountryCode(""); setRegion(""); setLocation({ latitude, longitude }); setAccuracy(Math.round(meters)); setLocating(false);
    }, failure => {
      if (attempt !== locationAttempt.current) return;
      setLocating(false); setError(failure.code === 1 ? "Location permission was denied. Enter a country code or change your browser permission." :
        failure.code === 3 ? "Location lookup timed out. Try again or enter a country code." :
          "Device location is unavailable. Enter a country code instead.");
    }, { enableHighAccuracy: false, maximumAge: 0, timeout: 10_000 }); }
    catch { if (attempt === locationAttempt.current) { setLocating(false); setError("Location could not be requested. Enter a country code instead."); } }
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = countryCode.trim().toUpperCase();
    if (!location && !/^[A-Z]{2}$/.test(code)) { setError("Enter a two-letter country code or choose Use my location first."); return; }
    if (code === "IN" && !location) { setIndiaRoute(true); setError("India uses the curated benefit workflow. Open Government Benefits for an owned roof assessment."); return; }
    if (region.trim().length > 80 || utility.trim().length > 120) {
      setError("Region must be under 80 characters and utility under 120 characters."); return;
    }
    const input: InternationalResearchInput = { ...(code ? { countryCode: code } : {}),
      ...(region.trim() ? { region: region.trim() } : {}), ...(utility.trim() ? { utility: utility.trim() } : {}),
      ...(location ? { location } : {}) };
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    setBusy(true); setError(""); setIndiaRoute(false); setResult(undefined);
    void internationalApi.research(input, controller.signal).then(response => {
      if (!controller.signal.aborted) setResult(response);
    }).catch(failure => {
      if (controller.signal.aborted) return;
      if (failure instanceof RoofRequestError && failure.code === "INDIA_USE_CURATED_POLICY") {
        setIndiaRoute(true);
        setError("This location is in India. Use Government Benefits for the curated India workflow.");
      } else setError(failure instanceof RoofRequestError ? failure.message : "Research could not be completed. Check the jurisdiction and try again.");
    }).finally(() => { if (request.current === controller) { request.current = null; setBusy(false); } });
  }
  return <div className="international-workspace"><header className="international-hero"><div><span><Globe2 size={18} aria-hidden="true" /> International source research</span>
    <h1>Know what is sourced before you decide.</h1><p>Outside India, SolarSaathi checks selected official authority pages on demand. Results stay labelled as live research until a policy is curated and verified.</p></div>
    <div className="international-globe" aria-hidden="true"><span className="international-globe-sphere" /><span className="international-globe-ring one" /><span className="international-globe-ring two" /><span className="international-globe-pin" /></div></header>
    <div className="international-layout"><section className="international-form-card" aria-labelledby="international-form-title"><div className="international-section-head"><Compass aria-hidden="true" /><div><h2 id="international-form-title">Where should we check?</h2><p>Choose a country. Region and utility are recorded as context; source applicability still needs review.</p></div></div>
      <form onSubmit={submit} className="international-form"><div><Label htmlFor="international-country">Country code</Label><Input id="international-country" list="international-country-suggestions" value={countryCode} maxLength={2} autoComplete="off" onChange={event => manualCountry(event.target.value)} placeholder="US, GB, AU…" aria-describedby="international-country-help" />
          <datalist id="international-country-suggestions">{commonCountries.map(([code, name]) => <option key={code} value={code}>{name}</option>)}</datalist>
          <small id="international-country-help">Two-letter ISO country code. India (IN) uses the verified India workflow.</small></div>
        <div className="international-location"><Button type="button" variant="outline" onClick={locate} disabled={locating || busy}><LocateFixed size={17} aria-hidden="true" /> {locating ? "Finding location…" : "Use my location once"}</Button>
          {location && <div role="status"><strong>Location ready</strong><p>Country will be estimated by the backend when you run research; check it before relying on sources near a border. Approximate device accuracy: {accuracy?.toLocaleString("en-IN")} m. Coordinates are not saved in this browser.</p>
            <button type="button" onClick={() => { locationAttempt.current += 1; setLocation(undefined); setAccuracy(undefined); clearResult(); }}>Remove location</button></div>}
          <small>Permission is requested only when you click. Coordinates go to our AWS backend for one-time country detection with the research request; they are not sent to external source search.</small></div>
        <div><Label htmlFor="international-region">State, province or region (optional)</Label><Input id="international-region" maxLength={80} value={region} disabled={Boolean(location)} onChange={event => { setRegion(event.target.value); clearResult(); }} placeholder="For example, California" /><small>{location ? "The backend will identify a region from your one-time location. Remove location to enter a region yourself." : "Your entry is context only; source applicability is not verified."}</small></div>
        <div><Label htmlFor="international-utility">Electric utility (optional)</Label><Input id="international-utility" maxLength={120} value={utility} onChange={event => { setUtility(event.target.value); clearResult(); }} placeholder="Name used on your bill" /></div>
        <p className="international-discovery-note">If configured, source discovery sends a generic solar search with your country code and reviewed official website to an external search provider. Region, utility and device coordinates are not sent to that provider.</p>
        <Button type="submit" disabled={busy || locating}>{busy ? "Checking sources…" : "Check official sources"}<Search size={16} aria-hidden="true" /></Button>
        {error && <div className="international-error" role="alert"><ShieldAlert size={18} aria-hidden="true" /><div><p>{error}</p>{indiaRoute && <Link href="/app/benefits">Open Government Benefits</Link>}</div></div>}
        {busy && <p className="international-progress" role="status">Checking current solar sources for your location. This may take a moment; no benefit amount is being inferred.</p>}
      </form></section>
      <aside className="international-method" aria-labelledby="international-method-title"><h2 id="international-method-title">How to read this result</h2><ol><li><strong>Source first</strong><span>Open each listed authority page; an entered utility is context only.</span></li><li><strong>Time matters</strong><span>Check when the source was retrieved and whether the temporary copy expired.</span></li><li><strong>Facts need review</strong><span>Live research is incomplete and not part of the curated India rule engine.</span></li></ol>
        <div><ShieldCheck size={20} aria-hidden="true" /><p>We do not assert worldwide policy coverage, a subsidy amount, eligibility, or government approval from this lookup.</p></div>
        <Link href="/demo/international">Explore the fictional example <ArrowUpRight size={15} aria-hidden="true" /></Link></aside></div>
    {result && <ResearchResult result={result} />}
  </div>;
}

export function InternationalWorkspace() {
  const { status, profile } = useAuth();
  if (status === "loading") return <p role="status">Checking your account…</p>;
  if (status === "signedIn" && profile) return <ConnectedResearch key={profile.userId} />;
  return <section className="international-gate" aria-labelledby="international-gate-title"><Globe2 size={29} aria-hidden="true" /><h1 id="international-gate-title">Research official sources outside India</h1>
    <p>{status === "unconfigured" ? "Sign-in and the policy research API are not configured in this deployment. The example is fictional." : "Sign in to run an on-demand authoritative source check."}</p>
    <div>{status !== "unconfigured" && <Button asChild><Link href="/auth/sign-in">Sign in</Link></Button>}
      <Button asChild variant="outline"><Link href="/demo/international">View fictional demo</Link></Button></div></section>;
}
