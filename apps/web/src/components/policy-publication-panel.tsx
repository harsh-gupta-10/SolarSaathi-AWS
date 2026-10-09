"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowUpRight, BadgeCheck, FilePlus2, RefreshCw, ShieldAlert } from "lucide-react";
import { Button, Input, Label } from "@solarsaathi/ui";
import { z } from "zod";
import { policyPublicationApi, type PolicyPublicationDetail, type PolicyPublicationDraft } from "../lib/policy-publication-api";
import type { PolicyReviewDetail } from "../lib/policy-review-api";

const time = (value?: string) => value ? new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric",
  hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }).format(new Date(value)) : "Not recorded";
const readable = (value: string) => value.toLowerCase().replaceAll("_", " ").replace(/^./, letter => letter.toUpperCase());
const clauseEvidenceSchema = z.array(z.object({ clauseKey: z.string().regex(/^[A-Z][A-Z0-9_]{1,80}$/),
  locator: z.object({ charStart: z.number().int().nonnegative(), charEnd: z.number().int().nonnegative(),
    pageNumber: z.number().int().positive().optional(), section: z.string().optional(), fragment: z.string().optional() }).strict(),
  quotedEvidence: z.string().min(10).max(1600),
}).strict()).max(50);

function requiredClauseKeys(rule: unknown): string[] | undefined {
  if (!rule || typeof rule !== "object" || Array.isArray(rule)) return;
  const value = rule as Record<string, unknown>;
  const eligibility = value.eligibility;
  if (!eligibility || typeof eligibility !== "object" || Array.isArray(eligibility)) return;
  const conditions = eligibility as Record<string, unknown>;
  if (!Array.isArray(conditions.allOf) || !Array.isArray(conditions.anyOf) ||
    !conditions.anyOf.every(group => Array.isArray(group)) || !Array.isArray(value.compatibility)) return;
  if (conditions.allOf.length + conditions.anyOf.length === 0) return;
  const keys = ["EFFECTIVE_PERIOD"];
  if (value.capPaise !== undefined) keys.push("CAP");
  if (value.combinedCapPaise !== undefined) keys.push("COMBINED_CAP");
  if (value.minSystemWatts !== undefined || value.maxSystemWatts !== undefined) keys.push("SYSTEM_SIZE");
  if (value.overlapGroupId !== undefined) keys.push("OVERLAP");
  conditions.allOf.forEach((_, index) => keys.push(`ELIGIBILITY_ALL_${index}`));
  conditions.anyOf.forEach((group, groupIndex) => (group as unknown[]).forEach((_, conditionIndex) =>
    keys.push(`ELIGIBILITY_ANY_${groupIndex}_${conditionIndex}`)));
  value.compatibility.forEach((edge, index) => {
    keys.push(`COMPATIBILITY_${index}`);
    if (edge && typeof edge === "object" && !Array.isArray(edge) && Array.isArray((edge as Record<string, unknown>).conditions)) {
      ((edge as Record<string, unknown>).conditions as unknown[]).forEach((_, conditionIndex) =>
        keys.push(`COMPATIBILITY_${index}_CONDITION_${conditionIndex}`));
    }
  });
  if (Array.isArray(value.processSteps)) value.processSteps.forEach((_, index) => keys.push(`PROCESS_STEP_${index}`));
  return keys;
}

export function PolicyPublicationPanel({ userId, demo, evidence }: { userId: string; demo: boolean;
  evidence?: PolicyReviewDetail | null }) {
  const [queue, setQueue] = useState<PolicyPublicationDraft[]>([]);
  const [nextCursor, setNextCursor] = useState<string>();
  const [loadingMore, setLoadingMore] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState<PolicyPublicationDetail>();
  const [created, setCreated] = useState<PolicyPublicationDraft>();
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [reviewAction, setReviewAction] = useState<"publish" | "reject">();
  const [reason, setReason] = useState("");
  const [openId, setOpenId] = useState("");
  const [benefitId, setBenefitId] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [documentId, setDocumentId] = useState("");
  const [documentVersion, setDocumentVersion] = useState("");
  const [charStart, setCharStart] = useState("");
  const [charEnd, setCharEnd] = useState("");
  const [pageNumber, setPageNumber] = useState("");
  const [section, setSection] = useState("");
  const [fragment, setFragment] = useState("");
  const [quote, setQuote] = useState("");
  const [ruleJson, setRuleJson] = useState("");
  const [clauseJson, setClauseJson] = useState("");
  const authorDetails = useRef<HTMLDetailsElement>(null);
  const current = useRef(userId);
  current.current = userId;
  const queueRevision = useRef(0);

  useEffect(() => {
    if (!evidence || evidence.candidate.reviewStatus !== "APPROVED") return;
    const citation = evidence.candidate.candidate.citation;
    setSourceId(citation.sourceId); setDocumentId(citation.documentId);
    setDocumentVersion(String(citation.documentVersion));
    setCharStart(citation.locator.charStart === undefined ? "" : String(citation.locator.charStart));
    setCharEnd(citation.locator.charEnd === undefined ? "" : String(citation.locator.charEnd));
    setPageNumber(citation.locator.pageNumber === undefined ? "" : String(citation.locator.pageNumber));
    setSection(citation.locator.section ?? ""); setFragment(citation.locator.fragment ?? "");
    setQuote(evidence.candidate.candidate.quotedText);
    if (authorDetails.current) authorDetails.current.open = true;
  }, [evidence]);

  useEffect(() => {
    if (demo) return;
    queueRevision.current++;
    const controller = new AbortController();
    void policyPublicationApi.queue(userId, controller.signal).then(result => {
      if (!controller.signal.aborted) { setQueue(result.items); setNextCursor(result.nextCursor); }
    }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not load rule drafts."); });
    return () => controller.abort();
  }, [userId, demo, refresh]);

  async function loadMore() {
    if (demo || !nextCursor || loadingMore) return;
    const revision = queueRevision.current;
    const cursor = nextCursor;
    setLoadingMore(true); setError(undefined);
    try {
      const result = await policyPublicationApi.queue(userId, undefined, cursor);
      if (current.current !== userId || queueRevision.current !== revision) return;
      setQueue(previous => [...previous, ...result.items.filter(item =>
        !previous.some(existing => existing.draftId === item.draftId))]);
      setNextCursor(result.nextCursor);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not load more drafts."); }
    finally { setLoadingMore(false); }
  }

  useEffect(() => {
    if (demo || !selectedId) { setDetail(undefined); return; }
    const controller = new AbortController();
    setDetail(undefined);
    void policyPublicationApi.detail(userId, selectedId, controller.signal).then(result => {
      if (!controller.signal.aborted && current.current === userId) setDetail(result);
    }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not load this draft."); });
    return () => controller.abort();
  }, [userId, selectedId, demo, refresh]);

  async function createDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || demo) return;
    const version = Number(documentVersion), start = Number(charStart), end = Number(charEnd);
    const page = pageNumber.trim() ? Number(pageNumber) : undefined;
    if (!/^BENEFIT#[A-Za-z0-9][A-Za-z0-9#_-]{0,127}$/.test(benefitId.trim()) ||
      !/^SRC#[a-f0-9]{32}$/.test(sourceId.trim()) || !/^DOC#[a-f0-9]{32}$/.test(documentId.trim()) ||
      !Number.isSafeInteger(version) || version < 1 || !Number.isSafeInteger(start) || start < 0 ||
      !Number.isSafeInteger(end) || end - start !== quote.length || quote !== quote.trim() || quote.length < 10 ||
      page !== undefined && (!Number.isSafeInteger(page) || page < 1)) {
      setError("Enter exact current source IDs, document version, archive offsets and matching evidence text."); return;
    }
    let rule: unknown;
    try { rule = JSON.parse(ruleJson); }
    catch { setError("The rule definition must be valid JSON."); return; }
    if (!rule || typeof rule !== "object" || Array.isArray(rule)) {
      setError("The rule definition must be a JSON object."); return;
    }
    const keys = requiredClauseKeys(rule);
    if (!keys || keys.length < 2) {
      setError("The rule must contain explicit eligibility conditions and a compatibility array."); return;
    }
    let clauseRaw: unknown;
    try { clauseRaw = JSON.parse(clauseJson); }
    catch { setError("Clause evidence must be valid JSON."); return; }
    const clauses = clauseEvidenceSchema.safeParse(clauseRaw);
    if (!clauses.success || clauses.data.length !== keys.length ||
      new Set(clauses.data.map(item => item.clauseKey)).size !== keys.length ||
      clauses.data.some(item => !keys.includes(item.clauseKey) || item.quotedEvidence !== item.quotedEvidence.trim() ||
        item.locator.charEnd - item.locator.charStart !== item.quotedEvidence.length)) {
      setError(`Supply one exact archived excerpt for each required clause: ${keys.join(", ")}.`); return;
    }
    setBusy(true); setError(undefined); setMessage(undefined);
    try {
      const result = await policyPublicationApi.create(userId, { benefitId: benefitId.trim(),
        sourceId: sourceId.trim(), documentId: documentId.trim(), documentVersion: version,
        locator: { charStart: start, charEnd: end, ...(page === undefined ? {} : { pageNumber: page }),
          ...(section.trim() ? { section: section.trim() } : {}), ...(fragment.trim() ? { fragment: fragment.trim() } : {}) },
        quotedEvidence: quote, rule, clauseEvidence: clauses.data });
      setCreated(result.draft); setSelectedId(result.draft.draftId); setOpenId(result.draft.draftId);
      setMessage("Rule draft created. Review its immutable evidence and submit it for a separate administrator’s approval.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not create the draft."); }
    finally { setBusy(false); }
  }

  async function transition(action: "submit" | "publish" | "reject", draft: PolicyPublicationDraft) {
    if (busy || demo || action !== "submit" && reason.trim().length < 10) return;
    setBusy(true); setError(undefined); setMessage(undefined);
    try {
      const result = await policyPublicationApi.transition(userId, draft.draftId, action, draft.revision,
        action === "submit" ? undefined : reason.trim());
      setCreated(previous => previous?.draftId === draft.draftId ? result.draft : previous);
      setSelectedId(draft.draftId); setReviewAction(undefined); setReason("");
      setMessage(action === "submit" ? "Draft submitted for independent review." : action === "publish" ?
        `Verified policy version ${result.publishedVersion?.version ?? result.draft.version} was published.` : "Draft rejected.");
      setRefresh(value => value + 1);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The draft could not be changed."); }
    finally { setBusy(false); }
  }

  const draft = detail?.draft ?? (created?.draftId === selectedId ? created : undefined);
  const canReview = draft?.status === "PENDING_APPROVAL" && draft.authoredBy !== userId && draft.sourceCuratorId !== userId;
  return <section className="publication-panel" aria-labelledby="publication-title">
    <div className="publication-heading"><div><span><BadgeCheck size={16} aria-hidden="true" /> Verified rule publication</span>
      <h2 id="publication-title">Publish benefit rules from official evidence</h2>
      <p>A draft binds one rule to an immutable archive quotation. Its author submits it; a different administrator verifies and publishes it. Published rules can enter homeowner evaluations only while their source checks remain current.</p></div>
      <Button variant="outline" onClick={() => setRefresh(value => value + 1)} disabled={busy || demo}><RefreshCw size={16} aria-hidden="true" />Refresh</Button></div>
    {demo && <p className="policy-review-feedback">Synthetic evidence preview. Rule creation and publication are disabled here.</p>}
    {error && <p className="policy-review-feedback error" role="alert"><ShieldAlert size={17} aria-hidden="true" />{error}</p>}
    {message && <p className="policy-review-feedback" role="status"><BadgeCheck size={17} aria-hidden="true" />{message}</p>}
    <div className="publication-grid"><div className="publication-queue"><h3>Waiting for independent review <span>{queue.length}</span></h3>
      {queue.length === 0 && <p className="publication-empty">No submitted rule drafts are awaiting review.</p>}
      {queue.map(item => <button type="button" key={item.draftId} aria-pressed={selectedId === item.draftId}
        onClick={() => { setSelectedId(item.draftId); setReviewAction(undefined); }}>
        <strong>{item.benefitId.replace(/^BENEFIT#/, "")}</strong><span>{readable(item.rule.scope)} · {item.rule.jurisdiction}</span>
        <small>Version {item.version} · submitted {time(item.submittedAt)}</small></button>)}
      {nextCursor && <Button type="button" className="publication-load-more" variant="outline" disabled={loadingMore || demo}
        onClick={() => void loadMore()}>{loadingMore ? "Loading more…" : "Load more drafts"}</Button>}
      <div className="publication-open"><Label htmlFor="publication-draft-id">Open a draft by ID</Label>
        <div><Input id="publication-draft-id" value={openId} onChange={event => setOpenId(event.target.value)}
          placeholder="DRAFT#…" /><Button type="button" variant="outline" disabled={demo || !/^DRAFT#[a-f0-9]{32}$/.test(openId)}
          onClick={() => setSelectedId(openId)}>Open</Button></div></div>
    </div><div className="publication-detail">
      {!selectedId && <p className="publication-empty">Select a submitted draft or open an ID to inspect the rule, evidence and review state.</p>}
      {selectedId && !draft && <p className="publication-empty" role="status">Loading rule draft…</p>}
      {draft && <><div className="publication-detail-head"><span>{readable(draft.status)}</span><h3>{draft.benefitId.replace(/^BENEFIT#/, "")}</h3>
        <p>{draft.rule.scope} · {draft.rule.jurisdiction} · policy version {draft.version}</p></div>
        <blockquote>{draft.quotedEvidence}</blockquote>
        <dl><div><dt>Official publisher</dt><dd>{draft.citation.publisherName}</dd></div>
          <div><dt>Document</dt><dd>{draft.citation.documentTitle} · v{draft.citation.documentVersion}</dd></div>
          <div><dt>Archive location</dt><dd>Characters {draft.citation.locator.charStart}–{draft.citation.locator.charEnd}
            {draft.citation.locator.pageNumber ? ` · page ${draft.citation.locator.pageNumber}` : ""}
            {draft.citation.locator.section ? ` · section ${draft.citation.locator.section}` : ""}</dd></div>
          <div><dt>Rule effective</dt><dd>{draft.rule.effectiveFrom}{draft.rule.effectiveTo ? ` to ${draft.rule.effectiveTo}` : " onward"}</dd></div>
          <div><dt>Author</dt><dd>{draft.authoredBy}</dd></div><div><dt>Source curator</dt><dd>{draft.sourceCuratorId}</dd></div>
          <div><dt>Last official check</dt><dd>{time(detail?.crawlState?.lastCheckedAt)}{detail && !detail.sourceFresh ? " · stale" : ""}</dd></div>
        </dl>
        <a className="publication-link" href={draft.citation.sourceUrl} target="_blank" rel="noopener noreferrer">Open official document<ArrowUpRight size={15} aria-hidden="true" /></a>
        <details className="publication-clauses"><summary>Inspect cited rule clauses ({draft.clauseEvidence.length})</summary>
          <ul>{draft.clauseEvidence.map(clause => <li key={clause.clauseKey}><strong>{readable(clause.clauseKey)}</strong>
            <blockquote>{clause.quotedEvidence}</blockquote><small>Archive characters {clause.citation.locator.charStart}–{clause.citation.locator.charEnd}
              {clause.citation.locator.pageNumber ? ` · page ${clause.citation.locator.pageNumber}` : ""}</small></li>)}</ul>
        </details>
        <details className="publication-rule"><summary>Inspect exact rule JSON</summary><pre>{JSON.stringify(draft.rule, null, 2)}</pre></details>
        {draft.status === "DRAFT" && draft.authoredBy === userId && <Button disabled={busy || demo} onClick={() => void transition("submit", draft)}>Submit for separate review</Button>}
        {draft.status === "PENDING_APPROVAL" && !canReview && <p className="publication-note">The author or source curator cannot review this rule. A different policy administrator must decide.</p>}
        {canReview && <div className="publication-actions"><Button disabled={busy || demo || !detail?.sourceFresh}
          onClick={() => { setReviewAction("publish"); setReason(""); }}>Review and publish</Button>
          <Button variant="outline" disabled={busy || demo} onClick={() => { setReviewAction("reject"); setReason(""); }}>Reject draft</Button></div>}
        {reviewAction && canReview && <div className="publication-confirm"><Label htmlFor="publication-reason">Review reason (at least 10 characters)</Label>
          <textarea id="publication-reason" value={reason} onChange={event => setReason(event.target.value)}
            placeholder="Describe the evidence, amount, eligibility and compatibility checks." />
          <p>{reviewAction === "publish" ? "Publishing makes this version eligible for live evaluation while source checks remain current." :
            "Rejection records the review and keeps this rule out of evaluation."}</p>
          <div><Button disabled={busy || reason.trim().length < 10} onClick={() => void transition(reviewAction, draft)}>
            {reviewAction === "publish" ? "Confirm publication" : "Confirm rejection"}</Button>
            <Button variant="outline" onClick={() => setReviewAction(undefined)}>Cancel</Button></div></div>}
      </>}
    </div></div>
    <details className="publication-author" ref={authorDetails}>
      <summary><FilePlus2 size={17} aria-hidden="true" /> Author a new evidence-bound rule</summary>
      <p>Use an approved evidence quotation from the review queue and its exact archived text offsets. The official archive must be the latest successful crawl of a curated source. Every numeric amount and cap in the rule must appear in the quotation. A review by another administrator is required.</p>
      {evidence?.candidate.reviewStatus === "APPROVED" && <p className="publication-prefilled" role="status">Approved evidence details were filled from the review queue. Confirm the exact quotation and locator before creating a rule.</p>}
      <form onSubmit={createDraft} noValidate><div className="publication-form-grid">
        <div><Label htmlFor="publication-benefit-id">Benefit ID</Label><Input id="publication-benefit-id" value={benefitId}
          onChange={event => setBenefitId(event.target.value)} placeholder="BENEFIT#SCHEME_CODE" /></div>
        <div><Label htmlFor="publication-source-id">Source ID</Label><Input id="publication-source-id" value={sourceId}
          onChange={event => setSourceId(event.target.value)} placeholder="SRC#…" /></div>
        <div><Label htmlFor="publication-document-id">Document ID</Label><Input id="publication-document-id" value={documentId}
          onChange={event => setDocumentId(event.target.value)} placeholder="DOC#…" /></div>
        <div><Label htmlFor="publication-version">Document version</Label><Input id="publication-version" type="number" min="1"
          value={documentVersion} onChange={event => setDocumentVersion(event.target.value)} /></div>
        <div><Label htmlFor="publication-start">Quote start character</Label><Input id="publication-start" type="number" min="0"
          value={charStart} onChange={event => setCharStart(event.target.value)} /></div>
        <div><Label htmlFor="publication-end">Quote end character</Label><Input id="publication-end" type="number" min="0"
          value={charEnd} onChange={event => setCharEnd(event.target.value)} /></div>
        <div><Label htmlFor="publication-page">Page (if in archive)</Label><Input id="publication-page" type="number" min="1"
          value={pageNumber} onChange={event => setPageNumber(event.target.value)} /></div>
        <div><Label htmlFor="publication-section">Section (if in archive)</Label><Input id="publication-section" value={section}
          onChange={event => setSection(event.target.value)} /></div>
        <div><Label htmlFor="publication-fragment">Fragment (if in archive)</Label><Input id="publication-fragment" value={fragment}
          onChange={event => setFragment(event.target.value)} /></div>
      </div><div className="publication-text-fields"><div><Label htmlFor="publication-quote">Exact official evidence quotation</Label>
        <textarea id="publication-quote" value={quote} onChange={event => setQuote(event.target.value)} maxLength={1600} /></div>
        <div><Label htmlFor="publication-rule-json">Deterministic rule definition (JSON)</Label>
          <textarea id="publication-rule-json" value={ruleJson} onChange={event => setRuleJson(event.target.value)}
            spellCheck={false} placeholder="Enter the complete typed rule from reviewed official evidence." />
          <p>Amounts use integer paise. Add conditions, caps, overlap groups and compatibility edges from the cited official rule. At least one eligibility condition is required. The server rejects unsupported or unmatched values.</p></div>
        <div><Label htmlFor="publication-clause-json">Clause evidence excerpts (JSON array)</Label>
          <textarea id="publication-clause-json" value={clauseJson} onChange={event => setClauseJson(event.target.value)}
            spellCheck={false} placeholder="Enter exact clause excerpts and locators as a JSON array." />
          <p>Each clause needs its own exact excerpt and archive locator. Required keys for this rule: {
            (() => { try { return requiredClauseKeys(JSON.parse(ruleJson))?.join(", ") ?? "enter a valid rule first"; }
            catch { return "enter a valid rule first"; } })()}.</p></div></div>
        <Button type="submit" disabled={busy || demo}>{busy ? "Saving draft…" : "Create immutable draft"}</Button></form>
    </details>
  </section>;
}
