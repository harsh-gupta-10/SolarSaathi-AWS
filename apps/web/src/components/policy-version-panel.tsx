"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { AlertTriangle, ArrowUpRight, GitCompareArrows, History, RefreshCw, RotateCcw } from "lucide-react";
import { Button } from "@solarsaathi/ui";
import { policyOperationsApi, type ActivePolicySummary, type PolicyRollback,
  type PolicyVersionDetail, type PolicyVersionSummary } from "../lib/policy-operations-api";

const stamp = (value?: string | null) => value ? new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short",
  year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }).format(new Date(value)) : "Not recorded";
const errorText = (value: unknown) => value instanceof Error ? value.message : "The policy service could not be reached.";
const pretty = (value: unknown) => JSON.stringify(value, null, 2);
const detailTerm = (detail: PolicyVersionDetail, key: "amount" | "capPaise" | "combinedCapPaise" |
  "minSystemWatts" | "maxSystemWatts" | "compatibility" | "eligibility") => pretty(detail.bundle.rule[key] ?? null);

function VersionCard({ detail, title, other }: { detail: PolicyVersionDetail; title: string;
  other?: PolicyVersionDetail }) {
  const version = detail.bundle.version;
  const rule = detail.bundle.rule;
  const terms = [
    ["Amount rule", "amount"], ["Individual cap (paise)", "capPaise"], ["Combined cap (paise)", "combinedCapPaise"],
    ["Minimum system (W)", "minSystemWatts"], ["Maximum system (W)", "maxSystemWatts"],
    ["Eligibility clauses", "eligibility"], ["Compatibility rules", "compatibility"],
  ] as const;
  const citations = [...new Map(detail.bundle.facts.map(fact => [fact.citation.sourceUrl, fact.citation])).values()];
  return <article className="policy-version-card"><div className="policy-version-card-head"><div><span>{title}</span><h4>Version {version.version}</h4></div>
    <strong>{detail.isCurrent ? "Current ACTIVE pointer" : "Published, not current"}</strong></div>
    {!detail.sourceFresh && <p className="policy-ops-warning"><AlertTriangle size={16} aria-hidden="true" />Source is stale or unchecked. Recheck before relying on this version.</p>}
    {!detail.targetDocumentCurrent && <p className="policy-ops-warning"><AlertTriangle size={16} aria-hidden="true" />Current crawl document differs from this historical version’s citation. Rollback approval is blocked.</p>}
    <dl className="policy-version-meta"><div><dt>Jurisdiction and scope</dt><dd>{rule.jurisdiction} · {rule.scope}</dd></div>
      <div><dt>Effective</dt><dd>{rule.effectiveFrom} to {rule.effectiveTo ?? "open ended"}</dd></div>
      <div><dt>Last source check</dt><dd>{stamp(detail.lastCheckedAt)}</dd></div>
      <div><dt>Verified content hash</dt><dd className="policy-review-hash">{version.contentHash}</dd></div></dl>
    <div className="policy-version-terms">{terms.map(([name, key]) => { const value = detailTerm(detail, key);
      const changed = !!other && value !== detailTerm(other, key);
      return <div key={key} data-changed={changed}><strong>{name}{changed ? " · changed" : ""}</strong><pre>{value}</pre></div>;
    })}</div>
    <details><summary>Document evidence ({version.documentRefs.length})</summary><ul>{version.documentRefs.map(ref => <li key={`${ref.documentId}:${ref.documentVersion}`}>
      <strong>{ref.documentId} v{ref.documentVersion}</strong><span>Source {ref.sourceId}</span><code>{ref.sha256}</code></li>)}</ul></details>
    <div className="policy-version-citations"><h5>Cited source pages</h5>{citations.map(citation => <a key={citation.sourceUrl}
      href={citation.sourceUrl} target="_blank" rel="noopener noreferrer">{citation.publisherName} · retrieved {stamp(citation.retrievedAt)} <ArrowUpRight size={14} aria-hidden="true" /></a>)}</div>
    <p className="policy-ops-help">These are stored verified rule terms, not a calculation of an applicant’s eligibility or amount.</p>
  </article>;
}

export function PolicyVersionPanel({ userId, demo }: { userId: string; demo: boolean }) {
  const [active, setActive] = useState<ActivePolicySummary[]>([]);
  const [jurisdictionInput, setJurisdictionInput] = useState("IN");
  const [jurisdiction, setJurisdiction] = useState("IN");
  const [activeCursor, setActiveCursor] = useState<string>();
  const [versions, setVersions] = useState<PolicyVersionSummary[]>([]);
  const [versionCursor, setVersionCursor] = useState<string>();
  const [currentVersion, setCurrentVersion] = useState<number | null>(null);
  const [policyId, setPolicyId] = useState("");
  const [targetVersion, setTargetVersion] = useState<number>();
  const [currentDetail, setCurrentDetail] = useState<PolicyVersionDetail>();
  const [targetDetail, setTargetDetail] = useState<PolicyVersionDetail>();
  const [queue, setQueue] = useState<PolicyRollback[]>([]);
  const [queueCursor, setQueueCursor] = useState<string>();
  const [selectedRollbackId, setSelectedRollbackId] = useState("");
  const [rollbackDetail, setRollbackDetail] = useState<Awaited<ReturnType<typeof policyOperationsApi.rollbackDetail>>>();
  const [requestReason, setRequestReason] = useState("");
  const [reviewReason, setReviewReason] = useState("");
  const [reviewAction, setReviewAction] = useState<"approve" | "reject">();
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [refresh, setRefresh] = useState(0);
  const pending = useRef<Set<AbortController>>(new Set());
  const pagePending = useRef<Set<AbortController>>(new Set());
  const listingGeneration = useRef(0);
  const listingScope = useRef({ userId, jurisdiction, refresh });
  const scope = useRef({ userId, policyId });
  const noticeUser = useRef(userId);
  const rollbackSelection = useRef(selectedRollbackId);
  const versionSelection = useRef({ currentVersion, targetVersion });
  scope.current = { userId, policyId };
  listingScope.current = { userId, jurisdiction, refresh };
  rollbackSelection.current = selectedRollbackId;
  versionSelection.current = { currentVersion, targetVersion };
  function controller() { const value = new AbortController(); pending.current.add(value); return value; }
  function release(value: AbortController) { pending.current.delete(value); }
  useEffect(() => () => { for (const value of pending.current) value.abort(); pending.current.clear(); }, [userId]);
  useEffect(() => () => { for (const value of pagePending.current) value.abort(); pagePending.current.clear(); }, [userId, jurisdiction, refresh]);
  useEffect(() => {
    listingGeneration.current++;
    setActive([]); setActiveCursor(undefined); setQueue([]); setQueueCursor(undefined);
    setPolicyId(""); setSelectedRollbackId(""); setError("");
    if (noticeUser.current !== userId) { noticeUser.current = userId; setNotice(""); }
    if (demo) { setLoading(false); return; }
    const current = controller(); setLoading(true);
    void Promise.all([policyOperationsApi.active(userId, jurisdiction, current.signal),
      policyOperationsApi.rollbackQueue(userId, current.signal)]).then(([catalog, rollbacks]) => {
      if (current.signal.aborted || scope.current.userId !== userId ||
        listingScope.current.jurisdiction !== jurisdiction || listingScope.current.refresh !== refresh) return;
      setActive(catalog.items); setActiveCursor(catalog.nextCursor);
      setQueue(rollbacks.items); setQueueCursor(rollbacks.nextCursor);
    }).catch(cause => { if (!current.signal.aborted) setError(errorText(cause)); })
      .finally(() => { release(current); if (!current.signal.aborted) setLoading(false); });
    return () => { current.abort(); release(current); };
  }, [userId, demo, refresh, jurisdiction]);
  useEffect(() => {
    setVersions([]); setVersionCursor(undefined); setCurrentVersion(null); setTargetVersion(undefined);
    setCurrentDetail(undefined); setTargetDetail(undefined); setRequestReason("");
    if (!policyId || demo) return;
    const current = controller();
    void policyOperationsApi.versions(userId, policyId, current.signal).then(page => {
      if (current.signal.aborted || scope.current.userId !== userId || scope.current.policyId !== policyId) return;
      setVersions(page.items); setVersionCursor(page.nextCursor); setCurrentVersion(page.currentVersion);
      setTargetVersion(page.items.find(item => !item.isCurrent)?.version ?? page.currentVersion ?? undefined);
    }).catch(cause => { if (!current.signal.aborted) setError(errorText(cause)); })
      .finally(() => release(current));
    return () => { current.abort(); release(current); };
  }, [userId, demo, policyId, refresh]);
  useEffect(() => {
    setCurrentDetail(undefined); setTargetDetail(undefined);
    if (!policyId || !currentVersion || !targetVersion || demo) return;
    const current = controller();
    void Promise.all([policyOperationsApi.version(userId, policyId, currentVersion, current.signal),
      targetVersion === currentVersion ? Promise.resolve(null) : policyOperationsApi.version(userId, policyId, targetVersion, current.signal)])
      .then(([now, target]) => {
        if (current.signal.aborted || scope.current.userId !== userId || scope.current.policyId !== policyId ||
          versionSelection.current.currentVersion !== currentVersion || versionSelection.current.targetVersion !== targetVersion) return;
        setCurrentDetail(now); setTargetDetail(target ?? now);
      }).catch(cause => { if (!current.signal.aborted) setError(errorText(cause)); })
      .finally(() => release(current));
    return () => { current.abort(); release(current); };
  }, [userId, demo, policyId, currentVersion, targetVersion, refresh]);
  useEffect(() => {
    setRollbackDetail(undefined); setReviewReason(""); setReviewAction(undefined);
    if (!selectedRollbackId || demo) return;
    const current = controller();
    void policyOperationsApi.rollbackDetail(userId, selectedRollbackId, current.signal).then(value => {
      if (!current.signal.aborted && scope.current.userId === userId && rollbackSelection.current === selectedRollbackId) setRollbackDetail(value);
    }).catch(cause => { if (!current.signal.aborted) setError(errorText(cause)); })
      .finally(() => release(current));
    return () => { current.abort(); release(current); };
  }, [userId, demo, selectedRollbackId, refresh]);
  async function more(kind: "active" | "versions" | "rollbacks") {
    const cursor = kind === "active" ? activeCursor : kind === "versions" ? versionCursor : queueCursor;
    if (!cursor || busy || demo || kind === "versions" && !policyId) return;
    const current = controller(), selected = policyId, generation = listingGeneration.current;
    const requestedJurisdiction = jurisdiction;
    pagePending.current.add(current); setBusy(true); setError("");
    try {
      if (kind === "active") {
        const page = await policyOperationsApi.active(userId, jurisdiction, current.signal, cursor);
        if (current.signal.aborted || scope.current.userId !== userId || generation !== listingGeneration.current ||
          listingScope.current.jurisdiction !== requestedJurisdiction || listingScope.current.refresh !== refresh) return;
        setActive(previous => [...previous, ...page.items.filter(item => !previous.some(old => old.policyId === item.policyId))]);
        setActiveCursor(page.nextCursor);
      } else if (kind === "versions") {
        const page = await policyOperationsApi.versions(userId, selected, current.signal, cursor);
        if (current.signal.aborted || scope.current.userId !== userId || scope.current.policyId !== selected ||
          generation !== listingGeneration.current || listingScope.current.refresh !== refresh) return;
        setVersions(previous => [...previous, ...page.items.filter(item => !previous.some(old => old.version === item.version))]);
        setVersionCursor(page.nextCursor);
      } else {
        const page = await policyOperationsApi.rollbackQueue(userId, current.signal, cursor);
        if (current.signal.aborted || scope.current.userId !== userId || generation !== listingGeneration.current ||
          listingScope.current.refresh !== refresh) return;
        setQueue(previous => [...previous, ...page.items.filter(item => !previous.some(old => old.rollbackId === item.rollbackId))]);
        setQueueCursor(page.nextCursor);
      }
    } catch (cause) { if (!current.signal.aborted) setError(errorText(cause)); }
    finally { pagePending.current.delete(current); release(current); if (scope.current.userId === userId) setBusy(false); }
  }
  async function requestRollback() {
    if (demo || busy || !policyId || !currentVersion || !targetVersion || targetVersion === currentVersion ||
      !matchedCurrentDetail || !matchedTargetDetail || !matchedTargetDetail.sourceFresh ||
      !matchedTargetDetail.targetDocumentCurrent || requestReason.trim().length < 10) return;
    const current = controller(), selected = policyId; setBusy(true); setError("");
    try {
      const result = await policyOperationsApi.requestRollback(userId, { policyId: selected,
        targetVersion, expectedActiveVersion: currentVersion, reason: requestReason.trim() }, current.signal);
      if (current.signal.aborted || scope.current.userId !== userId || scope.current.policyId !== selected) return;
      setNotice(`Rollback request ${result.rollback.rollbackId} is pending a separate administrator’s review. No active rule changed.`);
      setRequestReason(""); setRefresh(value => value + 1);
    } catch (cause) { if (!current.signal.aborted) setError(errorText(cause)); }
    finally { release(current); if (!current.signal.aborted) setBusy(false); }
  }
  async function reviewRollback() {
    const detail = matchedRollbackDetail, action = reviewAction;
    if (demo || busy || !detail || !action || reviewReason.trim().length < 10 ||
      detail.rollback.rollbackId !== selectedRollbackId ||
      detail.rollback.requestedBy === userId || detail.rollback.targetVersionAuthorId === userId ||
      detail.rollback.targetSourceCuratorId === userId || action === "approve" &&
      (!detail.sourceFresh || !detail.targetDocumentCurrent ||
        detail.currentVersion !== detail.rollback.expectedActiveVersion)) return;
    const current = controller(); setBusy(true); setError("");
    try {
      const result = await policyOperationsApi.reviewRollback(userId, detail.rollback.rollbackId, action,
        detail.rollback.revision, reviewReason.trim(), current.signal);
      if (current.signal.aborted || scope.current.userId !== userId) return;
      setNotice(action === "approve" ? `Rollback approved as new active version ${result.rollback.activatedVersion}. History is retained.` :
        "Rollback request rejected. Active policy is unchanged.");
      setReviewAction(undefined); setReviewReason(""); setRefresh(value => value + 1);
    } catch (cause) { if (!current.signal.aborted) setError(errorText(cause)); }
    finally { release(current); if (!current.signal.aborted) setBusy(false); }
  }
  const selected = active.find(item => item.policyId === policyId);
  const matchedCurrentDetail = currentDetail?.bundle.policyId === policyId &&
    currentDetail.bundle.version.version === currentVersion ? currentDetail : undefined;
  const matchedTargetDetail = targetDetail?.bundle.policyId === policyId &&
    targetDetail.bundle.version.version === targetVersion ? targetDetail : undefined;
  const matchedRollbackDetail = rollbackDetail?.rollback.rollbackId === selectedRollbackId ? rollbackDetail : undefined;
  const reviewed = matchedRollbackDetail?.rollback;
  const canReview = !!reviewed && reviewed.status === "PENDING_APPROVAL" && reviewed.requestedBy !== userId &&
    reviewed.targetVersionAuthorId !== userId && reviewed.targetSourceCuratorId !== userId;
  const canApprove = canReview && !!matchedRollbackDetail?.sourceFresh && !!matchedRollbackDetail.targetDocumentCurrent &&
    matchedRollbackDetail.currentVersion === reviewed.expectedActiveVersion;
  function chooseJurisdiction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = jurisdictionInput.trim().toUpperCase();
    if (!/^IN(?:-[A-Z0-9]{1,8}){0,3}$/.test(next)) {
      setError("Enter an India jurisdiction code such as IN or IN-MH."); return;
    }
    setError(""); setJurisdiction(next);
  }
  if (demo) return <section className="policy-ops" aria-labelledby="policy-version-demo-title"><div className="policy-ops-head"><div>
    <p>Fictional policy history</p><h2 id="policy-version-demo-title">Versions and rollback</h2>
    <span>This read-only illustration uses made-up versions and document identifiers. No live policy, source, amount, or rollback is involved.</span></div></div>
    <div className="policy-version-compare"><article className="policy-version-card"><div className="policy-version-card-head"><div><span>Fictional current pointer</span><h4>Example v3</h4></div><strong>Current ACTIVE pointer</strong></div>
      <dl className="policy-version-meta"><div><dt>Scope</dt><dd>Example state rule</dd></div><div><dt>Effective</dt><dd>Illustrative period only</dd></div>
        <div><dt>Document hash</dt><dd>Fictional hash A</dd></div><div><dt>Source check</dt><dd>No live check</dd></div></dl>
      <div className="policy-version-terms"><div data-changed="true"><strong>Rule form · changed</strong><pre>Example percentage rule</pre></div>
        <div><strong>Source evidence</strong><pre>Fictional circular A</pre></div></div></article>
      <article className="policy-version-card"><div className="policy-version-card-head"><div><span>Fictional historical row</span><h4>Example v2</h4></div><strong>Published, not current</strong></div>
        <dl className="policy-version-meta"><div><dt>Scope</dt><dd>Example state rule</dd></div><div><dt>Effective</dt><dd>Earlier illustrative period</dd></div>
          <div><dt>Document hash</dt><dd>Fictional hash B</dd></div><div><dt>Source check</dt><dd>No live check</dd></div></dl>
        <div className="policy-version-terms"><div data-changed="true"><strong>Rule form · changed</strong><pre>Example fixed rule</pre></div>
          <div><strong>Source evidence</strong><pre>Fictional circular B</pre></div></div></article></div>
    <div className="policy-rollback-request"><h4>Reasoned rollback workflow</h4><p>A real request names a verified historical target, current active version and review reason. A different administrator must review it. This demo does not submit anything.</p>
      <Button disabled>Request rollback (demo only)</Button></div></section>;
  return <section className="policy-ops" aria-labelledby="policy-version-title"><div className="policy-ops-head"><div><p>Published policy governance</p>
    <h2 id="policy-version-title">Versions and rollback</h2><span>Compare immutable verified versions. A rollback request needs a separate review and creates a new active version.</span></div>
    <Button variant="outline" disabled={demo || loading || busy} onClick={() => setRefresh(value => value + 1)}><RefreshCw size={16} aria-hidden="true" />Refresh</Button></div>
    {demo && <p className="policy-review-feedback" role="note">Synthetic preview only. No active policy history or rollback decision is connected here.</p>}
    {error && <p role="alert" className="policy-review-feedback error"><AlertTriangle size={17} aria-hidden="true" />{error}</p>}
    {notice && <p role="status" className="policy-review-feedback">{notice}</p>}
    {loading && <p role="status" className="policy-review-empty">Loading active policy catalog and pending rollback queue…</p>}
    <form className="policy-jurisdiction-form" onSubmit={chooseJurisdiction}><label htmlFor="policy-jurisdiction">Find active policies by jurisdiction</label>
      <div><input id="policy-jurisdiction" value={jurisdictionInput} maxLength={20} disabled={busy}
        onChange={event => setJurisdictionInput(event.target.value.toUpperCase())}
        placeholder="IN or IN-MH" /><Button type="submit" disabled={busy}>Show jurisdiction</Button></div>
      <small>Exact jurisdiction only. IN shows central records; use IN-MH or another India code for state, DISCOM or local records.</small></form>
    <div className="policy-version-layout"><div className="policy-ops-card"><div className="policy-ops-card-heading"><History aria-hidden="true" /><div><h3>Active benefit policies · {jurisdiction}</h3><p>Current pointers for this jurisdiction only. Historical published rows are stored separately.</p></div></div>
      {!loading && active.length === 0 && <p className="policy-review-empty">No active policy in this catalog page.</p>}
      <div className="policy-ops-select-list">{active.map(item => <button type="button" key={item.policyId} disabled={busy} aria-pressed={policyId === item.policyId}
        onClick={() => setPolicyId(item.policyId)}><strong>{item.benefitId}</strong><span>{item.jurisdiction} · {item.scope} · ACTIVE v{item.version}</span>
        <small>{item.sourceFresh ? "Source checked" : "Source stale or unchecked"} · last check {stamp(item.lastCheckedAt)}</small></button>)}</div>
      {activeCursor && <Button variant="outline" disabled={busy} onClick={() => void more("active")}>Load more active policies</Button>}</div>
      <div className="policy-ops-card"><div className="policy-ops-card-heading"><RotateCcw aria-hidden="true" /><div><h3>Rollback review queue</h3><p>A different administrator must decide each reasoned request.</p></div></div>
        {!loading && queue.length === 0 && <p className="policy-review-empty">No pending rollback request in this page.</p>}
        <div className="policy-ops-select-list">{queue.map(item => <button key={item.rollbackId} type="button" disabled={busy} aria-pressed={selectedRollbackId === item.rollbackId}
          onClick={() => setSelectedRollbackId(item.rollbackId)}><strong>{item.policyId}</strong><span>v{item.expectedActiveVersion} → historical v{item.targetVersion}</span>
          <small>Requested {stamp(item.requestedAt)} · {item.status.replaceAll("_", " ").toLowerCase()}</small></button>)}</div>
        {queueCursor && <Button variant="outline" disabled={busy} onClick={() => void more("rollbacks")}>Load more requests</Button>}</div></div>
    {policyId && <div className="policy-ops-card policy-version-section"><div className="policy-ops-card-heading"><GitCompareArrows aria-hidden="true" /><div><h3>Compare {selected?.benefitId ?? policyId}</h3>
      <p>Current ACTIVE pointer: {currentVersion ? `v${currentVersion}` : "loading"}. Choose a verified historical version.</p></div></div>
      <div className="policy-version-picker" role="group" aria-label="Published versions">{versions.map(item => <button key={item.version} type="button" disabled={busy}
        aria-pressed={targetVersion === item.version} onClick={() => { setTargetVersion(item.version); setRequestReason(""); }}>
        v{item.version} {item.isCurrent ? "· current pointer" : "· historical"}<small>Verified {stamp(item.verifiedAt)}</small></button>)}</div>
      {versionCursor && <Button variant="outline" disabled={busy} onClick={() => void more("versions")}>Load more versions</Button>}
      {currentVersion && targetVersion && (!matchedCurrentDetail || !matchedTargetDetail) && <p role="status" className="policy-review-empty">Loading verified version comparison…</p>}
      {matchedCurrentDetail && matchedTargetDetail && <><div className="policy-version-compare"><VersionCard detail={matchedCurrentDetail} title="Current active" other={matchedTargetDetail} />
        <VersionCard detail={matchedTargetDetail} title="Selected version" other={matchedCurrentDetail} /></div>
        <div className="policy-rollback-request"><h4>Request rollback to v{targetVersion}</h4>
          <p>Current v{currentVersion} stays active until a separate administrator approves. Approval will create a new version from the verified target.</p>
          {!matchedTargetDetail.sourceFresh && <p className="policy-ops-warning"><AlertTriangle size={16} aria-hidden="true" />Target source needs a fresh check before approval.</p>}
          {!matchedTargetDetail.targetDocumentCurrent && <p className="policy-ops-warning"><AlertTriangle size={16} aria-hidden="true" />Target’s cited document is no longer the current crawled document. Recheck the source before requesting rollback.</p>}
          <label htmlFor="policy-rollback-reason">Reason for rollback request</label><textarea id="policy-rollback-reason" maxLength={500}
            value={requestReason} onChange={event => setRequestReason(event.target.value)} placeholder="Describe the verified policy reason for restoring this version" />
          <Button disabled={demo || busy || targetVersion === currentVersion || requestReason.trim().length < 10 || !matchedTargetDetail.sourceFresh || !matchedTargetDetail.targetDocumentCurrent}
            onClick={() => void requestRollback()}>Request separate rollback review</Button></div></>}</div>}
    {selectedRollbackId && <div className="policy-ops-card policy-version-section"><h3>Rollback request detail</h3>
      {!matchedRollbackDetail && !demo && <p role="status">Loading request and current source state…</p>}
      {reviewed && <><dl className="policy-ops-facts"><div><dt>Policy</dt><dd>{reviewed.policyId}</dd></div>
        <div><dt>Requested transition</dt><dd>v{reviewed.expectedActiveVersion} → historical v{reviewed.targetVersion}</dd></div>
        <div><dt>Current active version</dt><dd>{matchedRollbackDetail?.currentVersion ?? "None"}</dd></div>
        <div><dt>Requested by</dt><dd>{reviewed.requestedBy}</dd></div>
        <div><dt>Source last checked</dt><dd>{stamp(matchedRollbackDetail?.lastCheckedAt)}</dd></div>
        <div><dt>Status</dt><dd>{reviewed.status.replaceAll("_", " ")}</dd></div></dl>
        <blockquote>{reviewed.requestReason}</blockquote>
        {!matchedRollbackDetail?.sourceFresh && <p className="policy-ops-warning"><AlertTriangle size={16} aria-hidden="true" />Target source is stale or unchecked; approval is blocked.</p>}
        {!matchedRollbackDetail?.targetDocumentCurrent && <p className="policy-ops-warning"><AlertTriangle size={16} aria-hidden="true" />Current crawled document differs from the rollback target’s citation; approval is blocked.</p>}
        {matchedRollbackDetail?.currentVersion !== reviewed.expectedActiveVersion && <p className="policy-ops-warning"><AlertTriangle size={16} aria-hidden="true" />Active pointer changed since request. Refresh and create a new request.</p>}
        {[reviewed.requestedBy, reviewed.targetVersionAuthorId, reviewed.targetSourceCuratorId].includes(userId) &&
          <p className="policy-ops-warning"><AlertTriangle size={16} aria-hidden="true" />A different administrator must review this request.</p>}
        {canReview && <><div className="policy-ops-actions"><Button disabled={!canApprove} onClick={() => { setReviewAction("approve"); setReviewReason(""); }}>Review approval</Button>
          <Button variant="outline" onClick={() => { setReviewAction("reject"); setReviewReason(""); }}>Review rejection</Button></div>
          {reviewAction && <div className="policy-rollback-review"><h4>{reviewAction === "approve" ? "Approve" : "Reject"} rollback request</h4>
            <p>Explain your independent review. This decision is audited; the server rechecks source and active version.</p>
            <label htmlFor="policy-rollback-review-reason">Review reason</label><textarea id="policy-rollback-review-reason" maxLength={500}
              value={reviewReason} onChange={event => setReviewReason(event.target.value)} placeholder="Record the source and version checks you performed" />
            <div className="policy-ops-actions"><Button disabled={busy || reviewReason.trim().length < 10} onClick={() => void reviewRollback()}>
              {busy ? "Recording…" : `Confirm ${reviewAction}`}</Button><Button variant="outline" disabled={busy} onClick={() => setReviewAction(undefined)}>Cancel</Button></div></div>}</>}</>}</div>}
  </section>;
}
