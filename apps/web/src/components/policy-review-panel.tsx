"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowUpRight, Check, FileSearch, RefreshCw, ShieldCheck, X } from "lucide-react";
import { Button, Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@solarsaathi/ui";
import { useAuth } from "../auth/auth-provider";
import { policyReviewApi, type PolicyChangeDetail, type PolicyChangeRecord, type PolicyReviewDetail,
  type PolicyReviewRecord, type PolicyReviewSource, type PolicyReviewSourceState } from "../lib/policy-review-api";

type ReviewAction = { kind: "approve" | "reject"; item: PolicyReviewRecord } |
  { kind: "approve-change" | "reject-change"; change: PolicyChangeRecord } |
  { kind: "curate" | "clear-rate-limit"; source: PolicyReviewSource };
export interface PolicyReviewDemoFixture { items: PolicyReviewRecord[]; changes: PolicyChangeRecord[];
  sources: PolicyReviewSource[]; sourceStates: PolicyReviewSourceState[];
  detail: PolicyReviewDetail; changeDetail?: PolicyChangeDetail; }
const label = (value: string) => value.replaceAll("_", " ").toLowerCase().replace(/^./, letter => letter.toUpperCase());
const errorText = (error: unknown) => error instanceof Error ? error.message : "The policy service is unavailable. Try again.";
function time(value?: string) {
  if (!value) return "Not recorded";
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? new Intl.DateTimeFormat("en-IN", {
    day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata",
  }).format(parsed) : "Not recorded";
}

export function PolicyReviewPanel({ demo }: { demo?: PolicyReviewDemoFixture }) {
  const { status, profile } = useAuth();
  const userId = demo ? "SYNTHETIC_DEMO" : status === "signedIn" && profile?.policyAdmin ? profile.userId : null;
  const activeUserId = useRef(userId);
  activeUserId.current = userId;
  const queueGeneration = useRef(0);
  const [view, setView] = useState<"queue" | "sources">("queue");
  const [items, setItems] = useState<PolicyReviewRecord[]>([]);
  const [changes, setChanges] = useState<PolicyChangeRecord[]>([]);
  const [sources, setSources] = useState<PolicyReviewSource[]>([]);
  const [sourceStates, setSourceStates] = useState<PolicyReviewSourceState[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<PolicyReviewDetail | null>(null);
  const [changeDetail, setChangeDetail] = useState<PolicyChangeDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [action, setAction] = useState<ReviewAction | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const refreshQueue = () => { queueGeneration.current++; setRefresh(value => value + 1); };

  useEffect(() => {
    queueGeneration.current++;
    if (demo) {
      setItems(demo.items); setChanges(demo.changes); setSources(demo.sources); setSourceStates(demo.sourceStates);
      setNextCursor(null);
      setSelectedId(demo.items[0]?.candidate.candidateId ?? demo.changes[0]?.changeId ?? null);
      setLoading(false);
      return;
    }
    if (!userId) { setItems([]); setChanges([]); setSources([]); setSourceStates([]);
      setNextCursor(null); setSelectedId(null);
      setDetail(null); setChangeDetail(null);
      setAction(null); setReason(""); setMessage(null); setError(null); return; }
    const controller = new AbortController();
    setLoading(true); setError(null);
    void Promise.all([policyReviewApi.queue(userId, controller.signal), policyReviewApi.sources(userId, controller.signal)])
      .then(([queue, registry]) => {
        if (controller.signal.aborted) return;
        setItems(queue.items); setChanges(queue.changes); setSources(registry.sources);
        setSourceStates(registry.sourceStates);
        setNextCursor(queue.nextCursor ?? null);
        setSelectedId(previous => queue.items.some(item => item.candidate.candidateId === previous) ||
          queue.changes.some(change => change.changeId === previous) ? previous :
          queue.items[0]?.candidate.candidateId ?? queue.changes[0]?.changeId ?? null);
      }).catch(cause => { if (!controller.signal.aborted) setError(errorText(cause)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [demo, userId, refresh]);

  useEffect(() => {
    if (demo) { setDetail(demo.detail); setChangeDetail(demo.changeDetail ?? null); return; }
    if (!userId || !selectedId) { setDetail(null); setChangeDetail(null); return; }
    const controller = new AbortController();
    setDetail(null); setChangeDetail(null);
    const isChange = selectedId.startsWith("CHANGE#");
    void (isChange ? policyReviewApi.changeDetail(userId, selectedId, controller.signal) :
      policyReviewApi.detail(userId, selectedId, controller.signal))
      .then(result => { if (!controller.signal.aborted) {
        if (isChange) setChangeDetail(result as PolicyChangeDetail);
        else setDetail(result as PolicyReviewDetail);
      } })
      .catch(cause => { if (!controller.signal.aborted) setError(errorText(cause)); });
    return () => controller.abort();
  }, [demo, userId, selectedId, refresh]);

  async function confirm() {
    if (!userId || demo || !action || (action.kind !== "curate" && reason.trim().length < 10) || busy) return;
    setBusy(true); setError(null);
    try {
      if (action.kind === "curate") {
        await policyReviewApi.curate(userId, action.source.sourceId, action.source.registryVersion);
        setMessage(`${action.source.name} was curated. Its official source can now be monitored.`);
      } else if ("source" in action) {
        await policyReviewApi.crawl(userId, action.source.sourceId, reason.trim());
        setMessage(`${action.source.name} was queued after the rate-limit review. Monitor the next check.`);
      } else if ("change" in action) {
        await policyReviewApi.changeReview(userId, action.change.changeId,
          action.kind === "approve-change" ? "approve" : "reject", action.change.revision, reason.trim());
        setMessage(`Document change ${action.kind === "approve-change" ? "reviewed" : "rejected"}. No policy fact was published.`);
      } else {
        await policyReviewApi.review(userId, action.item.candidate.candidateId, action.kind,
          action.item.revision, reason.trim());
        setMessage(`Evidence ${action.kind === "approve" ? "approved for policy drafting" : "rejected"}. No benefit rule was published.`);
      }
      setAction(null); setReason(""); refreshQueue();
    } catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  }

  async function crawl(source: PolicyReviewSource) {
    if (!userId || demo || !source.enabled || busy) return;
    setBusy(true); setError(null);
    try {
      const result = await policyReviewApi.crawl(userId, source.sourceId);
      setMessage(result.queued ? `${source.name} was queued for a check. Refresh to see the result.` :
        `${source.name} is already due for its next scheduled check.`);
    } catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  }

  async function loadMore() {
    if (!userId || demo || !nextCursor || loadingMore) return;
    const generation = queueGeneration.current;
    setLoadingMore(true); setError(null);
    try {
      const page = await policyReviewApi.queue(userId, undefined, nextCursor);
      if (activeUserId.current !== userId || queueGeneration.current !== generation) return;
      setItems(previous => [...previous, ...page.items.filter(item =>
        !previous.some(existing => existing.candidate.candidateId === item.candidate.candidateId))]);
      setChanges(previous => [...previous, ...page.changes.filter(change =>
        !previous.some(existing => existing.changeId === change.changeId))]);
      setNextCursor(page.nextCursor ?? null);
    } catch (cause) { setError(errorText(cause)); }
    finally { setLoadingMore(false); }
  }

  if (!demo && status === "loading") return <p role="status">Checking your policy review access…</p>;
  if (!userId) return <section className="feature-empty"><ShieldCheck aria-hidden="true" />
    <h1>Policy review access required</h1><p>Sign in with a policy administrator account to review source evidence.</p></section>;

  const selected = items.find(item => item.candidate.candidateId === selectedId);
  const selectedChange = changes.find(change => change.changeId === selectedId);
  const currentDetail = detail?.candidate.candidate.candidateId === selectedId ? detail : null;
  const currentChangeDetail = changeDetail?.change.changeId === selectedId ? changeDetail : null;
  return <section className="policy-review" aria-labelledby="policy-review-title">
    {demo && <p className="policy-review-feedback" role="note">Synthetic interface preview. The source, quote, and review record below are fictional; no API request or review action is made.</p>}
    <div className="policy-review-heading"><div><p><FileSearch size={17} aria-hidden="true" />Policy operations</p>
      <h1 id="policy-review-title">Review policy evidence</h1>
      <p>Official source changes wait for human review. These quotations are not approved benefit rules.</p></div>
      <Button variant="outline" disabled={!!demo || loading || busy} onClick={refreshQueue}><RefreshCw size={16} aria-hidden="true" />Refresh</Button></div>
    {error && <p className="policy-review-feedback error" role="alert"><AlertTriangle size={18} aria-hidden="true" />{error}</p>}
    {message && <p className="policy-review-feedback" role="status"><Check size={18} aria-hidden="true" />{message}</p>}
    <div className="policy-review-tabs" role="group" aria-label="Policy review sections">
      <button type="button" aria-pressed={view === "queue"} onClick={() => setView("queue")}>Review queue <span>{items.length + changes.length}</span></button>
      <button type="button" aria-pressed={view === "sources"} onClick={() => setView("sources")}>Official sources <span>{sources.length}</span></button>
    </div>
    {view === "queue" ? <div className="policy-review-grid">
      <div className="policy-review-list" role="group" aria-label="Pending evidence">
        {loading && <p className="policy-review-empty" role="status">Loading the review queue…</p>}
        {!loading && items.length === 0 && changes.length === 0 && <p className="policy-review-empty">{sources.some(source => source.enabled && source.registryStatus === "CURATED") ?
          "Active sources have no pending evidence or document changes. Check their monitoring status under Official sources." :
          "No curated source is enabled. Open Official sources to curate and enable an official source."}</p>}
        {items.map(item => <button key={item.candidate.candidateId} type="button" aria-pressed={selectedId === item.candidate.candidateId}
          className="policy-review-list-item" onClick={() => setSelectedId(item.candidate.candidateId)}>
          <span className="policy-review-list-top"><strong>{label(item.candidate.categoryHint)}</strong><span>Unverified</span></span>
          <span className="policy-review-list-quote">{item.candidate.quotedText}</span>
          <span className="policy-review-list-meta">{item.candidate.citation.publisherName} · {time(item.detectedAt)}</span>
          {item.conflictFlags.some(flag => flag.includes("CONFLICT")) && <span className="policy-review-conflict"><AlertTriangle size={14} aria-hidden="true" />Potential conflict</span>}
          {item.conflictFlags.includes("APPROVED_EVIDENCE_LOOKUP_TRUNCATED") && <span className="policy-review-conflict"><AlertTriangle size={14} aria-hidden="true" />Comparison incomplete</span>}
        </button>)}
        {changes.map(change => <button key={change.changeId} type="button" aria-pressed={selectedId === change.changeId}
          className="policy-review-list-item" onClick={() => setSelectedId(change.changeId)}>
          <span className="policy-review-list-top"><strong>Document change</strong><span>Review needed</span></span>
          <span className="policy-review-list-quote">{label(change.assessment.status)} · {change.assessment.candidateCount} extracted quotation{change.assessment.candidateCount === 1 ? "" : "s"}</span>
          <span className="policy-review-list-meta">{sources.find(source => source.sourceId === change.sourceId)?.publisherName ?? change.sourceId} · {time(change.detectedAt)}</span>
          {change.assessment.materialChanges.length > 0 && <span className="policy-review-conflict"><AlertTriangle size={14} aria-hidden="true" />{change.assessment.materialChanges.length} material change{change.assessment.materialChanges.length === 1 ? "" : "s"}</span>}
        </button>)}
        {nextCursor && <Button className="policy-review-load-more" variant="outline" disabled={loadingMore}
          onClick={() => void loadMore()}>{loadingMore ? "Loading more…" : "Load more evidence"}</Button>}
      </div>
      <div className="policy-review-detail">
        {!selected && !selectedChange && <p className="policy-review-empty">Select an item to inspect its source and review history.</p>}
        {selected && !currentDetail && <p className="policy-review-empty" role="status">Loading source details…</p>}
        {selectedChange && !currentChangeDetail && <p className="policy-review-empty" role="status">Loading document change details…</p>}
        {selected && currentDetail && <>
          <div className="policy-review-detail-head"><div><span>Unverified quotation</span><h2>{label(selected.candidate.categoryHint)}</h2></div><b>{selected.candidate.jurisdiction}</b></div>
          <blockquote>{selected.candidate.quotedText}</blockquote>
          <p className="policy-review-caution"><AlertTriangle size={17} aria-hidden="true" />Mentions are copied from the source. No subsidy amount or eligibility has been calculated.</p>
          {!currentDetail.sourceFresh && <p className="policy-review-caution"><AlertTriangle size={17} aria-hidden="true" />This source is outside its freshness window. Verify the latest official document before using this evidence.</p>}
          <dl className="policy-review-facts">
            <div><dt>Publisher</dt><dd>{currentDetail.source.publisherName}</dd></div>
            <div><dt>Document</dt><dd>{currentDetail.document.title} · version {currentDetail.document.version}</dd></div>
            <div><dt>Location</dt><dd>{selected.candidate.citation.locator.pageNumber ? `Page ${selected.candidate.citation.locator.pageNumber}` :
              selected.candidate.citation.locator.section || "Text position"}</dd></div>
            <div><dt>Retrieved</dt><dd>{time(selected.candidate.citation.retrievedAt)}</dd></div>
            {selected.candidate.citation.effectiveFrom && <div><dt>Effective from</dt><dd>{selected.candidate.citation.effectiveFrom}</dd></div>}
            <div><dt>Last source check</dt><dd>{time(currentDetail.crawlState?.lastCheckedAt)}</dd></div>
            <div><dt>Change</dt><dd>{label(selected.changeStatus)}</dd></div>
            <div><dt>Document hash</dt><dd className="policy-review-hash">{selected.candidate.citation.documentSha256}</dd></div>
          </dl>
          <a className="policy-review-source-link" href={selected.candidate.citation.sourceUrl} target="_blank" rel="noopener noreferrer">Open official source<ArrowUpRight size={16} aria-hidden="true" /></a>
          {selected.conflictFlags.length > 0 && <div className="policy-review-warning"><h3>Comparison status</h3><ul>{selected.conflictFlags.map(flag => <li key={flag}>{label(flag)}</li>)}</ul></div>}
          {selected.sourceCuratorId === userId && <p className="policy-review-caution"><AlertTriangle size={17} aria-hidden="true" />A different policy administrator must review this source’s evidence.</p>}
          <div className="policy-review-actions"><Button disabled={busy || !!demo || selected.sourceCuratorId === userId} onClick={() => { setAction({ kind: "approve", item: selected }); setReason(""); }}><Check size={16} aria-hidden="true" />Approve evidence</Button>
            <Button variant="outline" disabled={busy || !!demo || selected.sourceCuratorId === userId} onClick={() => { setAction({ kind: "reject", item: selected }); setReason(""); }}><X size={16} aria-hidden="true" />Reject</Button></div>
          {currentDetail.audit.length > 0 && <div className="policy-review-audit"><h3>Activity</h3><ol>{currentDetail.audit.map(event =>
            <li key={event.eventId}>{label(event.action)}<small>{time(event.occurredAt)}</small></li>)}</ol></div>}
        </>}
        {selectedChange && currentChangeDetail && <>
          <div className="policy-review-detail-head"><div><span>Document-level review</span>
            <h2>{label(selectedChange.assessment.status)}</h2></div>
            <b>{currentChangeDetail.source.jurisdiction}</b></div>
          <p className="policy-review-change-summary">The official document changed and needs review even when no policy quotation was extracted.</p>
          <div className="policy-review-preview-grid">
            {selectedChange.assessment.previousRawSha256 && <div className="policy-review-text-preview"><h3>Previous archived text</h3>
              {currentChangeDetail.previousTextPreview ? <><blockquote>{currentChangeDetail.previousTextPreview}</blockquote>
                {currentChangeDetail.previousTextTruncated && <small>Preview ends before the document ends.</small>}</>
                : <p>Previous archived text is unavailable in this view. Check the source history before deciding.</p>}</div>}
            <div className="policy-review-text-preview"><h3>{selectedChange.assessment.previousRawSha256 ? "Current archived text" : "Extracted document text"}</h3>
              {currentChangeDetail.textPreview ? <><blockquote>{currentChangeDetail.textPreview}</blockquote>
                {currentChangeDetail.textTruncated && <small>Preview ends before the document ends.</small>}</>
                : <p>Archived text is unavailable here. Open the official document to review the change.</p>}</div>
          </div>
          <p className="policy-review-change-context">These are bounded excerpts. Check the official document for full context before recording a decision.</p>
          {!currentChangeDetail.sourceFresh && <p className="policy-review-caution"><AlertTriangle size={17} aria-hidden="true" />This source is outside its freshness window. Verify the latest official document before approving this change.</p>}
          <dl className="policy-review-facts">
            <div><dt>Publisher</dt><dd>{currentChangeDetail.source.publisherName}</dd></div>
            <div><dt>Document</dt><dd>{currentChangeDetail.document.title} · version {currentChangeDetail.document.version}</dd></div>
            <div><dt>Detected</dt><dd>{time(selectedChange.detectedAt)}</dd></div>
            <div><dt>Extracted quotations</dt><dd>{selectedChange.assessment.candidateCount}</dd></div>
            <div><dt>Current document hash</dt><dd className="policy-review-hash">{selectedChange.assessment.currentRawSha256}</dd></div>
            <div><dt>Previous document hash</dt><dd className="policy-review-hash">{selectedChange.assessment.previousRawSha256 ?? "First observed version"}</dd></div>
          </dl>
          <a className="policy-review-source-link" href={currentChangeDetail.document.canonicalUrl} target="_blank" rel="noopener noreferrer">Open official document<ArrowUpRight size={16} aria-hidden="true" /></a>
          {selectedChange.assessment.materialChanges.length > 0 && <div className="policy-review-warning"><h3>Detected text changes</h3>
            <ul>{selectedChange.assessment.materialChanges.map((change, index) =>
              <li key={`${change.claimKey}-${change.kind}-${index}`}>{label(change.kind)} · {change.claimKey}</li>)}</ul></div>}
          <p className="policy-review-caution"><AlertTriangle size={17} aria-hidden="true" />A review records document evidence only. It does not publish a policy fact or confirm an incentive.</p>
          {selectedChange.sourceCuratorId === userId && <p className="policy-review-caution"><AlertTriangle size={17} aria-hidden="true" />A different policy administrator must review this source’s document changes.</p>}
          <div className="policy-review-actions"><Button disabled={busy || !!demo || selectedChange.sourceCuratorId === userId} onClick={() => { setAction({ kind: "approve-change", change: selectedChange }); setReason(""); }}><Check size={16} aria-hidden="true" />Mark reviewed</Button>
            <Button variant="outline" disabled={busy || !!demo || selectedChange.sourceCuratorId === userId} onClick={() => { setAction({ kind: "reject-change", change: selectedChange }); setReason(""); }}><X size={16} aria-hidden="true" />Reject</Button></div>
          {currentChangeDetail.audit.length > 0 && <div className="policy-review-audit"><h3>Activity</h3><ol>{currentChangeDetail.audit.map(event =>
            <li key={event.eventId}>{label(event.action)}<small>{time(event.occurredAt)}</small></li>)}</ol></div>}
        </>}
      </div>
    </div> : <div className="policy-review-sources">
      {loading && <p className="policy-review-empty" role="status">Loading official sources…</p>}
      {!loading && sources.length === 0 && <p className="policy-review-empty">No sources are registered. Register an official source before it can be curated and monitored.</p>}
      {sources.map(source => { const state = sourceStates.find(item => item.sourceId === source.sourceId);
        return <article key={source.sourceId} className="policy-review-source-card"><div>
        <span>{label(source.sourceType)} · {source.jurisdiction}</span><h2>{source.name}</h2><p>{source.publisherName}</p>
        <a href={source.canonicalUrl} target="_blank" rel="noopener noreferrer">View official source<ArrowUpRight size={14} aria-hidden="true" /></a></div>
        <div className="policy-review-source-side"><strong>{source.registryStatus === "CURATED" ?
          state?.crawlState?.status === "ERROR" ? "Check failed" : state?.crawlState?.status === "RUNNING" ? "Checking" :
            state?.sourceFresh ? "Recently checked" : "Check due or stale" : label(source.registryStatus)}</strong>
          <small>Last checked: {time(state?.crawlState?.lastCheckedAt)}</small>
          {state?.crawlState?.lastErrorCode && <small role="status">Failure: {label(state.crawlState.lastErrorCode)}</small>}
          {source.registryStatus === "PROPOSED" ? <Button variant="outline" disabled={busy || !!demo} onClick={() => { setAction({ kind: "curate", source }); setReason(""); }}>Curate source</Button>
            : source.enabled && state?.crawlState?.lastErrorCode === "RATE_LIMITED_MANUAL_REVIEW" ?
              <Button variant="outline" disabled={busy || !!demo} onClick={() => { setAction({ kind: "clear-rate-limit", source }); setReason(""); }}>Review rate limit</Button>
            : source.enabled ? <Button variant="outline" disabled={busy || !!demo} onClick={() => void crawl(source)}>Queue check</Button> : null}</div>
      </article>; })}
    </div>}
    <Sheet open={action !== null} onOpenChange={open => { if (!open && !busy) { setAction(null); setReason(""); } }}>
      <SheetContent side="right"><SheetHeader><SheetTitle>{action?.kind === "curate" ? "Curate official source" : action?.kind === "clear-rate-limit" ? "Review official rate limit" : action?.kind === "approve" ? "Approve evidence" : action?.kind === "approve-change" ? "Mark document reviewed" : "Reject evidence"}</SheetTitle>
        <SheetDescription>{action?.kind === "curate" ? "This enables scheduled checks for the registered source." : action?.kind === "clear-rate-limit" ?
          "The source requested a long pause. Confirm that an earlier check is appropriate and record why." :
          "This records your review of document evidence. It does not publish a benefit or confirm eligibility."}</SheetDescription></SheetHeader>
        <div className="policy-review-confirm">{action?.kind !== "curate" && <><label htmlFor="policy-review-reason">Review reason</label>
          <textarea id="policy-review-reason" value={reason} onChange={event => setReason(event.target.value)} maxLength={500}
            placeholder={action?.kind === "clear-rate-limit" ? "Explain why an earlier check is appropriate" : "Explain what you verified in the source"}
            aria-describedby="policy-review-reason-help" />
          <p id="policy-review-reason-help">Enter at least 10 characters for the audit trail.</p></>}
          <Button disabled={busy || (action?.kind !== "curate" && reason.trim().length < 10)} onClick={() => void confirm()}>
            {busy ? "Recording review…" : action?.kind === "curate" ? "Curate source" : action?.kind === "clear-rate-limit" ? "Queue reviewed check" : action?.kind === "approve" ? "Approve evidence" : action?.kind === "approve-change" ? "Mark reviewed" : "Reject evidence"}</Button></div>
      </SheetContent>
    </Sheet>
  </section>;
}
