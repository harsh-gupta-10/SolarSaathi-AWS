"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Badge, Button, Callout, ChipGroup, CurrencyInput, EmptyState, Field, Input, Select, SourceCitation } from "@solarsaathi/ui";
import { useAuth } from "../auth/auth-provider";
import { priceAdminApi, type CreateCandidateInput, type PriceBenchmark, type PriceStatus, type StoredBenchmark } from "../lib/price-admin-api";
import { regions } from "../lib/regions";
import { SignInLink } from "./sign-in-link";

const rupees = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const day = (value: string) => value.slice(0, 10);
const scopeLabel = (item: PriceBenchmark) => item.scope.level === "NATIONAL" ? "National" : item.scope.level === "STATE"
  ? `State ${item.scope.state}` : `DISCOM ${item.scope.discom} (${item.scope.state})`;
const statuses: Array<{ label: string; value: PriceStatus }> = [{ label: "To review", value: "CANDIDATE" }, { label: "Approved", value: "APPROVED" },
  { label: "Replaced", value: "SUPERSEDED" }, { label: "Rejected", value: "REJECTED" }];
const toIso = (date: string) => `${date}T00:00:00+05:30`;
const lines = (value: string) => value.split(/\n|,/).map(item => item.trim()).filter(Boolean);
const message = (failure: unknown) => failure instanceof Error ? failure.message : "The pricing service is unavailable. Try again.";

function BenchmarkRow({ stored, onChanged, canReview }: { stored: StoredBenchmark; onChanged: () => void; canReview: boolean }) {
  const item = stored.benchmark;
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  async function act(kind: "approve" | "reject") {
    if (kind === "reject" && !reason.trim()) { setError("Enter a reason before rejecting."); return; }
    setBusy(true); setError(undefined);
    try { await (kind === "approve" ? priceAdminApi.approve(item.benchmarkId, reason.trim() ? { note: reason.trim() } : {}) : priceAdminApi.reject(item.benchmarkId, reason.trim())); onChanged(); }
    catch (failure) { setError(message(failure)); } finally { setBusy(false); }
  }
  return (
    <li className="grid gap-2 rounded-xl border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold">{scopeLabel(item)} · {item.sizeBand.minKw}–{item.sizeBand.maxKw} kW · {item.moduleClass === "DCR" ? "DCR" : "Non-DCR"} · {item.inverterType.toLowerCase()}</p>
        <Badge tone={item.status === "APPROVED" ? "verified" : item.status === "CANDIDATE" ? "unverified" : "neutral"}>{item.status.toLowerCase()}</Badge>
      </div>
      <p className="text-lg font-semibold">{rupees.format(item.rupeesPerKw.min)} to {rupees.format(item.rupeesPerKw.max)} per kW <span className="text-sm font-normal text-muted-foreground">(typical {rupees.format(item.rupeesPerKw.typical)})</span></p>
      <p className="text-sm text-muted-foreground">Includes: {item.inclusions.join(", ") || "not stated"}. Excludes: {item.exclusions.join(", ") || "not stated"}.</p>
      <SourceCitation source={`${item.source.publisher} (${item.source.authorityTier.toLowerCase().replace("_", " ")})`}
        effectiveDate={day(item.publishedOn)} lastCheckedAt={item.lastCheckedAt} links={[{ label: item.source.title ?? "Open source", url: item.source.url }]} />
      <p className="text-xs text-muted-foreground">Expires {day(item.expiresAt)} · added by {stored.audit.createdBy.startsWith("SYSTEM:") ? "automatic research" : "an administrator"}{stored.audit.approvedBy ? ` · approved ${day(stored.audit.approvedAt ?? "")}` : ""}{stored.audit.rejectionReason ? ` · rejected: ${stored.audit.rejectionReason}` : ""}</p>
      {canReview && item.status === "CANDIDATE" ? (
        <div className="grid gap-2 border-t pt-3">
          <Field id={`reason-${item.benchmarkId}`} label="Note or rejection reason" hint="A reason is required to reject. Approval needs a different reviewer than the person who added the candidate.">
            {control => <Input {...control} value={reason} maxLength={500} onChange={event => setReason(event.target.value)} />}
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button type="button" disabled={busy} onClick={() => void act("approve")}>Approve</Button>
            <Button type="button" variant="outline" disabled={busy} onClick={() => void act("reject")}>Reject</Button>
          </div>
          {error ? <Callout tone="danger">{error}</Callout> : null}
        </div>
      ) : null}
    </li>
  );
}

function CandidateForm({ onCreated }: { onCreated: () => void }) {
  const [level, setLevel] = useState<"NATIONAL" | "STATE" | "DISCOM">("STATE");
  const [state, setState] = useState(""); const [discom, setDiscom] = useState("");
  const [minKw, setMinKw] = useState("1"); const [maxKw, setMaxKw] = useState("3");
  const [moduleClass, setModuleClass] = useState<"DCR" | "NON_DCR">("DCR");
  const [inverter, setInverter] = useState<CreateCandidateInput["inverterType"]>("STRING");
  const [min, setMin] = useState(""); const [typical, setTypical] = useState(""); const [max, setMax] = useState("");
  const [url, setUrl] = useState(""); const [publisher, setPublisher] = useState("");
  const [tier, setTier] = useState<CreateCandidateInput["source"]["authorityTier"]>("OFFICIAL"); const [title, setTitle] = useState("");
  const [published, setPublished] = useState(""); const [expires, setExpires] = useState("");
  const [inclusions, setInclusions] = useState(""); const [exclusions, setExclusions] = useState("");
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string>(); const [done, setDone] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(undefined); setDone(false);
    const input: CreateCandidateInput = {
      scope: { level, ...(level !== "NATIONAL" ? { state } : {}), ...(level === "DISCOM" ? { discom: discom.trim() } : {}) },
      sizeBand: { minKw: Number(minKw), maxKw: Number(maxKw) }, moduleClass, inverterType: inverter,
      rupeesPerKw: { min: Number(min), typical: Number(typical), max: Number(max) },
      inclusions: lines(inclusions), exclusions: lines(exclusions),
      source: { url: url.trim(), publisher: publisher.trim(), authorityTier: tier, ...(title.trim() ? { title: title.trim() } : {}) },
      publishedOn: toIso(published), expiresAt: toIso(expires),
    };
    if (!published || !expires) { setError("Enter the date the source was published and when this price should expire."); return; }
    setBusy(true);
    try { await priceAdminApi.create(input); setDone(true); onCreated(); }
    catch (failure) { setError(message(failure)); } finally { setBusy(false); }
  }
  return (
    <details className="rounded-xl border p-4"><summary className="cursor-pointer font-semibold">Add a price candidate from a source you have read</summary>
      <form onSubmit={submit} noValidate className="mt-4 grid gap-4">
        <div className="grid gap-4 md:grid-cols-3">
          <Field id="pc-level" label="Scope" required>{control => <Select {...control} value={level} onChange={event => setLevel(event.target.value as typeof level)}>
            <option value="NATIONAL">National</option><option value="STATE">State</option><option value="DISCOM">DISCOM</option></Select>}</Field>
          {level !== "NATIONAL" ? <Field id="pc-state" label="State" required>{control => <Select {...control} value={state} onChange={event => setState(event.target.value)}>
            <option value="">Choose a state</option>{regions.map(([code, name]) => <option key={code} value={code}>{name}</option>)}</Select>}</Field> : null}
          {level === "DISCOM" ? <Field id="pc-discom" label="DISCOM" required>{control => <Input {...control} value={discom} maxLength={64} onChange={event => setDiscom(event.target.value)} />}</Field> : null}
        </div>
        <div className="grid gap-4 md:grid-cols-4">
          <Field id="pc-min-kw" label="Size from (kW)" required>{control => <Input {...control} type="number" min="0.1" step="any" value={minKw} onChange={event => setMinKw(event.target.value)} />}</Field>
          <Field id="pc-max-kw" label="Size to (kW)" required>{control => <Input {...control} type="number" min="0.1" step="any" value={maxKw} onChange={event => setMaxKw(event.target.value)} />}</Field>
          <Field id="pc-module" label="Modules" required>{control => <Select {...control} value={moduleClass} onChange={event => setModuleClass(event.target.value as typeof moduleClass)}><option value="DCR">DCR</option><option value="NON_DCR">Non-DCR</option></Select>}</Field>
          <Field id="pc-inverter" label="Inverter" required>{control => <Select {...control} value={inverter} onChange={event => setInverter(event.target.value as typeof inverter)}>
            <option value="STRING">String</option><option value="MICRO">Micro</option><option value="HYBRID">Hybrid</option><option value="UNSPECIFIED">Not specified</option></Select>}</Field>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <Field id="pc-p-min" label="Lowest price per kW (₹)" required>{control => <CurrencyInput {...control} value={min} onValueChange={setMin} />}</Field>
          <Field id="pc-p-typ" label="Typical price per kW (₹)" required>{control => <CurrencyInput {...control} value={typical} onValueChange={setTypical} />}</Field>
          <Field id="pc-p-max" label="Highest price per kW (₹)" required>{control => <CurrencyInput {...control} value={max} onValueChange={setMax} />}</Field>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <Field id="pc-url" label="Source address (https)" required>{control => <Input {...control} type="url" value={url} onChange={event => setUrl(event.target.value)} />}</Field>
          <Field id="pc-publisher" label="Publisher" required>{control => <Input {...control} value={publisher} maxLength={160} onChange={event => setPublisher(event.target.value)} />}</Field>
          <Field id="pc-title" label="Document title">{control => <Input {...control} value={title} maxLength={180} onChange={event => setTitle(event.target.value)} />}</Field>
          <Field id="pc-tier" label="Source type" required>{control => <Select {...control} value={tier} onChange={event => setTier(event.target.value as typeof tier)}>
            <option value="OFFICIAL">Official (MNRE, government)</option><option value="DISCOM">DISCOM</option><option value="TRADE_PRESS">Trade press</option>
            <option value="INSTALLER">Installer</option><option value="OTHER">Other</option></Select>}</Field>
          <Field id="pc-published" label="Source published on" required>{control => <Input {...control} type="date" value={published} onChange={event => setPublished(event.target.value)} />}</Field>
          <Field id="pc-expires" label="Price valid until" required hint="After this date the price stops being used in quotes.">{control => <Input {...control} type="date" value={expires} onChange={event => setExpires(event.target.value)} />}</Field>
          <Field id="pc-inc" label="What the price includes" hint="One per line or comma separated, e.g. structure, wiring, installation.">{control => <Input {...control} value={inclusions} onChange={event => setInclusions(event.target.value)} />}</Field>
          <Field id="pc-exc" label="What it leaves out" hint="e.g. GST, net-meter fee, battery.">{control => <Input {...control} value={exclusions} onChange={event => setExclusions(event.target.value)} />}</Field>
        </div>
        {error ? <Callout tone="danger">{error}</Callout> : null}
        {done ? <Callout tone="success">Candidate added. It is not used in quotes until a different reviewer approves it.</Callout> : null}
        <div><Button type="submit" disabled={busy}>{busy ? "Adding…" : "Add candidate"}</Button></div>
      </form>
    </details>
  );
}

export function PriceAdminPanel() {
  const { status, profile } = useAuth();
  const admin = status === "signedIn" && Boolean(profile?.policyAdmin);
  const [view, setView] = useState<PriceStatus>("CANDIDATE");
  const [items, setItems] = useState<StoredBenchmark[]>([]);
  const [cursor, setCursor] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  const load = useCallback(async (next?: string) => {
    setLoading(true); setError(undefined);
    try {
      const page = await priceAdminApi.list(view, next);
      setItems(previous => next ? [...previous, ...page.benchmarks] : page.benchmarks); setCursor(page.nextCursor);
    } catch (failure) { setError(message(failure)); } finally { setLoading(false); }
  }, [view]);
  useEffect(() => { if (admin) void load(); }, [admin, load]);

  if (status === "loading") return <p role="status">Checking your session…</p>;
  if (!admin) return <EmptyState title="Policy administrator access required" description="Sign in with a policy administrator account to review price benchmarks."
    action={status === "signedOut" ? <SignInLink /> : undefined} />;
  return (
    <div className="grid gap-5">
      <div><h1 className="text-2xl font-semibold">Price benchmarks</h1>
        <p className="mt-1 max-w-2xl text-muted-foreground">Only approved, unexpired benchmarks appear in quotes. Researched figures start as candidates and need a second reviewer. Prices are indicative ranges, never offers.</p></div>
      <ChipGroup label="Benchmark status" value={view} options={statuses} onChange={value => setView(value as PriceStatus)} />
      <CandidateForm onCreated={() => void load()} />
      {error ? <Callout tone="danger">{error}</Callout> : null}
      {loading && items.length === 0 ? <p role="status">Loading…</p> : null}
      {!loading && items.length === 0 && !error ? <EmptyState title="Nothing here yet" description="No benchmarks have this status." /> : null}
      <ul className="grid gap-3">{items.map(stored => <BenchmarkRow key={stored.benchmark.benchmarkId} stored={stored} canReview onChanged={() => void load()} />)}</ul>
      {cursor ? <div><Button type="button" variant="outline" disabled={loading} onClick={() => void load(cursor)}>Load more</Button></div> : null}
    </div>
  );
}
