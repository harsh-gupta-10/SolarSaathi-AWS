"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowUpRight, Check, RefreshCw, ShieldAlert } from "lucide-react";
import { Button, Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@solarsaathi/ui";
import { policyOperationsApi, type PolicyConflict, type PolicyCrawlerRun } from "../lib/policy-operations-api";
import { policyReviewApi, type PolicyReviewDetail } from "../lib/policy-review-api";

const stamp = (value: string) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric",
  hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }).format(new Date(value));
const label = (value: string) => value.toLowerCase().replaceAll("_", " ").replace(/^./, first => first.toUpperCase());
const message = (error: unknown) => error instanceof Error ? error.message : "The policy service could not be reached.";
const demoRun: PolicyCrawlerRun = { schemaVersion: 1, runId: "synthetic-run", startedAt: "2026-10-08T09:00:00.000Z",
  finishedAt: "2026-10-08T09:02:00.000Z", status: "PARTIAL", checked: 1, changed: 0, failed: 1,
  skipped: 0, backlog: false, sourceOutcomes: [{ sourceId: "SRC#synthetic", outcome: "FAILED" }] };
const demoConflict: PolicyConflict = { candidateId: `CAND#${"0".repeat(32)}`, sourceId: "SRC#synthetic",
  jurisdiction: "IN-XX", categoryHint: "DOCUMENT_REQUIREMENT", claimKey: "claim.synthetic",
  detectedAt: "2026-10-08T09:00:00.000Z", reviewStatus: "PENDING_APPROVAL", resolutionStatus: "UNRESOLVED",
  flags: ["POTENTIAL_CROSS_SOURCE_CONFLICT"] };

export function PolicyMonitoringPanel({ userId, demo, mode }: { userId: string; demo: boolean;
  mode: "runs" | "conflicts" }) {
  const [runs, setRuns] = useState<PolicyCrawlerRun[]>([]);
  const [conflicts, setConflicts] = useState<PolicyConflict[]>([]);
  const [cursor, setCursor] = useState<string>();
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState<PolicyReviewDetail>();
  const [reason, setReason] = useState("");
  const [reviewAction, setReviewAction] = useState<"approve" | "reject">();
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [refresh, setRefresh] = useState(0);
  const pending = useRef<Set<AbortController>>(new Set());
  const generation = useRef(0);
  const scoped = useRef(userId);
  const noticeScope = useRef(`${userId}:${mode}:${demo}`);
  scoped.current = userId;
  useEffect(() => () => { for (const controller of pending.current) controller.abort(); pending.current.clear(); }, []);
  function controller() { const value = new AbortController(); pending.current.add(value); return value; }
  function release(value: AbortController) { pending.current.delete(value); }
  useEffect(() => {
    generation.current++;
    for (const value of pending.current) value.abort(); pending.current.clear();
    setRuns(demo && mode === "runs" ? [demoRun] : []);
    setConflicts(demo && mode === "conflicts" ? [demoConflict] : []);
    setCursor(undefined); setSelectedId(""); setDetail(undefined); setReason(""); setReviewAction(undefined); setError("");
    const nextScope = `${userId}:${mode}:${demo}`;
    if (noticeScope.current !== nextScope) { noticeScope.current = nextScope; setNotice(""); }
    if (demo) { setLoading(false); return; }
    const current = controller(); setLoading(true);
    const load = mode === "runs" ? policyOperationsApi.runs(userId, current.signal) :
      policyOperationsApi.conflicts(userId, current.signal);
    void load.then(value => {
      if (current.signal.aborted || scoped.current !== userId) return;
      if (mode === "runs" && "runs" in value) setRuns(value.runs);
      if (mode === "conflicts" && "conflicts" in value) setConflicts(value.conflicts);
      setCursor(value.nextCursor);
    }).catch(cause => { if (!current.signal.aborted) setError(message(cause)); })
      .finally(() => { release(current); if (!current.signal.aborted) setLoading(false); });
    return () => { current.abort(); release(current); };
  }, [userId, demo, mode, refresh]);
  useEffect(() => {
    if (demo || mode !== "conflicts" || !selectedId) { setDetail(undefined); return; }
    const current = controller(); setDetail(undefined);
    void policyReviewApi.detail(userId, selectedId, current.signal).then(value => {
      if (!current.signal.aborted && scoped.current === userId) setDetail(value);
    }).catch(cause => { if (!current.signal.aborted) setError(message(cause)); })
      .finally(() => release(current));
    return () => { current.abort(); release(current); };
  }, [userId, demo, mode, selectedId]);
  async function more() {
    if (!cursor || loadingMore || demo) return;
    const current = controller(), revision = generation.current, next = cursor;
    setLoadingMore(true); setError("");
    try {
      if (mode === "runs") {
        const page = await policyOperationsApi.runs(userId, current.signal, next);
        if (current.signal.aborted || scoped.current !== userId || revision !== generation.current) return;
        setRuns(previous => [...previous, ...page.runs.filter(item => !previous.some(old => old.runId === item.runId))]);
        setCursor(page.nextCursor);
      } else {
        const page = await policyOperationsApi.conflicts(userId, current.signal, next);
        if (current.signal.aborted || scoped.current !== userId || revision !== generation.current) return;
        setConflicts(previous => [...previous, ...page.conflicts.filter(item => !previous.some(old => old.candidateId === item.candidateId))]);
        setCursor(page.nextCursor);
      }
    } catch (cause) { if (!current.signal.aborted) setError(message(cause)); }
    finally { release(current); if (!current.signal.aborted) setLoadingMore(false); }
  }
  async function review(action: "approve" | "reject") {
    if (!detail || busy || demo || reason.trim().length < 10 || detail.candidate.sourceCuratorId === userId) return;
    const current = controller(); setBusy(true); setError("");
    try {
      await policyReviewApi.review(userId, detail.candidate.candidate.candidateId, action,
        detail.candidate.revision, reason.trim(), current.signal);
      if (current.signal.aborted || scoped.current !== userId) return;
      setNotice(`Evidence ${action === "approve" ? "approved for drafting" : "rejected"}. No benefit was published.`);
      setReviewAction(undefined);
      setRefresh(value => value + 1);
    } catch (cause) { if (!current.signal.aborted) setError(message(cause)); }
    finally { release(current); if (!current.signal.aborted) setBusy(false); }
  }
  return <section className="policy-ops" aria-labelledby="policy-monitoring-title"><div className="policy-ops-head"><div>
    <p>{mode === "runs" ? "Monitoring history" : "Evidence triage"}</p><h2 id="policy-monitoring-title">{mode === "runs" ? "Crawler run timeline" : "Unresolved evidence conflicts"}</h2>
    <span>{mode === "runs" ? "Observed checks and failures; a successful crawl does not verify benefit rules." :
      "Conflicts are pending quotations. Reviewing evidence never activates a benefit rule."}</span></div>
    <Button variant="outline" disabled={demo || loading || busy} onClick={() => setRefresh(value => value + 1)}><RefreshCw size={16} aria-hidden="true" />Refresh</Button></div>
    {error && <p role="alert" className="policy-review-feedback error"><AlertTriangle size={17} aria-hidden="true" />{error}</p>}
    {notice && <p role="status" className="policy-review-feedback"><Check size={17} aria-hidden="true" />{notice}</p>}
    {loading && <p role="status" className="policy-review-empty">Loading {mode === "runs" ? "crawler runs" : "conflicts"}…</p>}
    {mode === "runs" ? <><ol className="policy-run-list">{runs.map(item => <li key={item.runId}>
      <div className="policy-run-marker" data-status={item.status} aria-hidden="true" /><div className="policy-run-card"><div className="policy-run-title"><strong>{label(item.status)} run</strong><time dateTime={item.finishedAt}>{stamp(item.finishedAt)}</time></div>
      <p>Started {stamp(item.startedAt)} · Run {item.runId}</p><dl><div><dt>Checked</dt><dd>{item.checked}</dd></div><div><dt>Changed</dt><dd>{item.changed}</dd></div><div><dt>Failed</dt><dd>{item.failed}</dd></div><div><dt>Skipped</dt><dd>{item.skipped}</dd></div></dl>
      {item.backlog && <p className="policy-ops-warning"><AlertTriangle size={16} aria-hidden="true" />Backlog remains; this run did not cover every due source.</p>}
      <details><summary>Source outcomes ({item.sourceOutcomes.length})</summary><ul>{item.sourceOutcomes.map((outcome, index) =>
        <li key={`${outcome.sourceId}-${index}`}>{outcome.sourceId} · {label(outcome.outcome)}</li>)}</ul></details></div></li>)}</ol>
      {!loading && runs.length === 0 && <p className="policy-review-empty">No crawler run has been recorded in this page of history.</p>}</> :
      <div className="policy-conflict-layout"><div className="policy-conflict-list" role="group" aria-label="Unresolved conflicts">
        {conflicts.map(item => <button key={item.candidateId} type="button" aria-pressed={selectedId === item.candidateId}
          onClick={() => { setSelectedId(item.candidateId); setReason(""); setReviewAction(undefined); }}><strong>{label(item.categoryHint)}</strong><span>{item.jurisdiction} · {stamp(item.detectedAt)}</span>
          <small>{item.flags.map(label).join(" · ")}</small></button>)}
        {!loading && conflicts.length === 0 && <p className="policy-review-empty">No unresolved evidence conflicts in this page of the queue.</p>}</div>
        <div className="policy-conflict-detail">{selectedId && !detail && !demo && <p role="status">Loading cited evidence…</p>}
          {!selectedId && <p>Select a conflict to inspect its quotation and citation.</p>}
          {demo && selectedId && <p>Fictional conflict preview. No live evidence is loaded or review action is available.</p>}
          {detail && detail.candidate.candidate.candidateId === selectedId && <><div className="policy-ops-head"><div><p>Unverified quotation</p><h3>{label(detail.candidate.candidate.categoryHint)}</h3></div><ShieldAlert aria-hidden="true" /></div>
            <blockquote>{detail.candidate.candidate.quotedText}</blockquote>
            <p className="policy-ops-warning"><AlertTriangle size={16} aria-hidden="true" />{detail.candidate.conflictFlags.map(label).join(" · ")}. This is not an approved benefit.</p>
            {!detail.sourceFresh && <p className="policy-ops-warning"><AlertTriangle size={16} aria-hidden="true" />The source is stale. Recheck it before making an evidence decision.</p>}
            {detail.sourceWarnings.map(code => <p className="policy-ops-warning" key={code}><AlertTriangle size={16} aria-hidden="true" />Source {label(detail.sourceHealthStatus)}: {label(code)}</p>)}
            <dl className="policy-ops-facts"><div><dt>Publisher</dt><dd>{detail.source.publisherName}</dd></div><div><dt>Document version</dt><dd>{detail.document.version}</dd></div><div><dt>Retrieved</dt><dd>{stamp(detail.document.retrievedAt)}</dd></div><div><dt>Claim key</dt><dd>{detail.candidate.candidate.claimKey}</dd></div></dl>
            <a href={detail.candidate.candidate.citation.sourceUrl} target="_blank" rel="noopener noreferrer">Open official source <ArrowUpRight size={15} aria-hidden="true" /></a>
            <label htmlFor="policy-conflict-reason">Evidence review reason</label><textarea id="policy-conflict-reason" value={reason} onChange={event => setReason(event.target.value)} maxLength={500} placeholder="Explain the cited source and conflict" />
            <p className="policy-ops-help">At least 10 characters. A separate benefit publication review is required.</p>
            {detail.candidate.sourceCuratorId === userId && <p className="policy-ops-warning">A different administrator must review this source’s evidence.</p>}
            <div className="policy-ops-actions"><Button disabled={busy || reason.trim().length < 10 || detail.candidate.sourceCuratorId === userId} onClick={() => setReviewAction("approve")}>Review approval</Button>
              <Button variant="outline" disabled={busy || reason.trim().length < 10 || detail.candidate.sourceCuratorId === userId} onClick={() => setReviewAction("reject")}>Review rejection</Button></div></>}
        </div></div>}
    {cursor && <Button variant="outline" disabled={loadingMore} onClick={() => void more()}>{loadingMore ? "Loading more…" : `Load more ${mode === "runs" ? "runs" : "conflicts"}`}</Button>}
    <Sheet open={!!reviewAction} onOpenChange={open => { if (!open && !busy) setReviewAction(undefined); }}><SheetContent side="right">
      <SheetHeader><SheetTitle>{reviewAction === "approve" ? "Confirm evidence approval" : "Confirm evidence rejection"}</SheetTitle>
        <SheetDescription>This decision records a review of candidate {selectedId}. It does not publish or activate a benefit rule.</SheetDescription></SheetHeader>
      <div className="policy-review-confirm"><p>Reason for the audit trail</p><blockquote>{reason}</blockquote><Button disabled={busy || !reviewAction || reason.trim().length < 10}
        onClick={() => { if (reviewAction) void review(reviewAction); }}>{busy ? "Recording…" : `Confirm ${reviewAction}`}</Button>
        <Button variant="outline" disabled={busy} onClick={() => setReviewAction(undefined)}>Cancel</Button></div>
    </SheetContent></Sheet>
  </section>;
}
