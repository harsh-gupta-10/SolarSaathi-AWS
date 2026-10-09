"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, CalendarDays, Check, CircleAlert, ClipboardList, FileText,
  MapPin, RefreshCw, ShieldCheck } from "lucide-react";
import { Button, Input, Label } from "@solarsaathi/ui";
import { applicationsApi, type ApplicationStepStatus, type PropertyChoice, type SolarApplication } from "../lib/applications-api";
import { RoofRequestError } from "../lib/roof-api";
import { useAuth } from "../auth/auth-provider";

const when = (value: string) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric",
  hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }).format(new Date(value));
const readable = (value: string) => value.toLowerCase().replaceAll("_", " ").replace(/^./, letter => letter.toUpperCase());
const statusLabel: Record<ApplicationStepStatus, string> = { PENDING: "To do", IN_PROGRESS: "In progress",
  COMPLETED: "Done", BLOCKED: "Blocked", NOT_APPLICABLE: "Not applicable" };
const messageFor = (error: unknown) => error instanceof RoofRequestError ? error.message :
  "The application service could not complete that request. Try again.";

function StepCard({ application, step, busy, demo, onChange }: { application: SolarApplication;
  step: SolarApplication["steps"][number]; busy: boolean; demo: boolean;
  onChange: (stepId: string, status: ApplicationStepStatus, note?: string) => void }) {
  const [next, setNext] = useState<ApplicationStepStatus>(step.status);
  const [note, setNote] = useState("");
  const [message, setMessage] = useState("");
  const [suggestion, setSuggestion] = useState<string>();
  const [interpreting, setInterpreting] = useState(false);
  const [chatError, setChatError] = useState<string>();
  const changed = next !== step.status;
  async function interpret() {
    if (!message.trim() || demo) return;
    setInterpreting(true); setChatError(undefined); setSuggestion(undefined);
    try {
      const result = await applicationsApi.chatSuggestion(application, step.stepId, message.trim());
      if (result.proposedStatus) {
        setNext(result.proposedStatus); setNote(result.suggestedNote);
        setSuggestion(`Suggested: ${statusLabel[result.proposedStatus]}. Review and save below to record your update.`);
      } else setSuggestion("The message is ambiguous. Choose a status yourself; nothing has been saved.");
    } catch (failure) { setChatError(messageFor(failure)); }
    finally { setInterpreting(false); }
  }
  return <li className={`tracker-step tracker-step--${step.status.toLowerCase()}`}>
    <div className="tracker-step-marker" aria-hidden="true">{step.status === "COMPLETED" ? <Check size={18} /> : step.order}</div>
    <div className="tracker-step-body">
      <div className="tracker-step-heading"><div><span>Step {step.order} · {step.required ? "Required" : "Optional"}</span>
        <h3>{step.title}</h3></div><b>{statusLabel[step.status]}</b></div>
      <p>{step.description}</p>
      <div className="tracker-step-evidence"><ShieldCheck size={15} aria-hidden="true" />
        <span>{demo ? "Synthetic process fixture" : `Process from verified policy v${application.policyVersion}`}</span>
        {step.citations.map((citation, index) => demo ? <span key={`${citation.documentId}-${index}`}>Fictional citation</span> :
          <a key={`${citation.documentId}-${index}`} href={citation.sourceUrl}
            target="_blank" rel="noopener noreferrer">{citation.publisherName}<ArrowUpRight size={13} aria-hidden="true" /></a>)}</div>
      <small className="tracker-step-updated">{demo ? "Example status" : "Your status"} · updated {when(step.updatedAt)}{step.completedAt ? ` · completed ${when(step.completedAt)}` : ""}</small>
      {step.note && <blockquote>{step.note}</blockquote>}
      {!demo && <div className="tracker-chat"><Label htmlFor={`step-message-${step.stepId}`}>Describe an update</Label>
        <div><Input id={`step-message-${step.stepId}`} value={message} maxLength={500} disabled={busy || interpreting}
          onChange={event => setMessage(event.target.value)} placeholder="For example, I completed this step today" />
          <Button type="button" variant="outline" disabled={busy || interpreting || !message.trim()}
            onClick={() => void interpret()}>{interpreting ? "Checking wording…" : "Suggest status"}</Button></div>
        <small>Your message is not stored. The suggestion never changes your tracker until you confirm below.</small>
        {suggestion && <p role="status">{suggestion}</p>}{chatError && <p role="alert" className="form-error">{chatError}</p>}</div>}
      <div className="tracker-step-edit"><div><Label htmlFor={`step-status-${step.stepId}`}>Update your progress</Label>
        <select id={`step-status-${step.stepId}`} value={next} onChange={event => setNext(event.target.value as ApplicationStepStatus)}
          disabled={busy || demo}><option value="PENDING">To do</option><option value="IN_PROGRESS">In progress</option>
          <option value="COMPLETED">Done</option><option value="BLOCKED">Blocked</option>
          {!step.required && <option value="NOT_APPLICABLE">Not applicable</option>}</select></div>
        <div><Label htmlFor={`step-note-${step.stepId}`}>Note {step.status === "COMPLETED" || step.status === "NOT_APPLICABLE" ? "(required for a correction)" : "(optional)"}</Label>
          <Input id={`step-note-${step.stepId}`} value={note} maxLength={1_000} disabled={busy || demo}
            onChange={event => setNote(event.target.value)} placeholder="What changed?" /></div>
        <Button type="button" size="sm" disabled={busy || demo || !changed || ((step.status === "COMPLETED" ||
          step.status === "NOT_APPLICABLE") && !note.trim())} onClick={() => {
          onChange(step.stepId, next, note.trim() || undefined); setNote("");
        }}>Save status</Button></div>
    </div>
  </li>;
}

export function ApplicationDetails({ initial, demo = false }: { initial: SolarApplication; demo?: boolean }) {
  const [application, setApplication] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [reference, setReference] = useState(initial.referenceNumber ?? "");
  const [vendor, setVendor] = useState(initial.vendorName ?? "");
  const [documentType, setDocumentType] = useState("");
  const [documentLabel, setDocumentLabel] = useState("");
  const [obtainedOn, setObtainedOn] = useState("");
  const nextStep = application.steps.find(step => step.stepId === application.expectedNextStepId);
  const completed = application.steps.filter(step => step.status === "COMPLETED").length;

  async function mutate(action: (current: SolarApplication) => Promise<SolarApplication>, success: string): Promise<boolean> {
    if (demo) return false;
    setBusy(true); setError(undefined); setNotice(undefined);
    try { const updated = await action(application); setApplication(updated); setNotice(success); return true; }
    catch (failure) {
      if (failure instanceof RoofRequestError && failure.code === "APPLICATION_CONFLICT") {
        try { const fresh = await applicationsApi.get(application.propertyId, application.applicationId);
          setApplication(fresh); setReference(fresh.referenceNumber ?? ""); setVendor(fresh.vendorName ?? ""); }
        catch { /* The original conflict is still actionable. */ }
      }
      setError(messageFor(failure));
      return false;
    } finally { setBusy(false); }
  }
  function saveDetails(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextReference = reference.trim(), nextVendor = vendor.trim();
    if (nextReference === (application.referenceNumber ?? "") && nextVendor === (application.vendorName ?? "")) {
      setError("Change the reference or vendor before saving."); return;
    }
    void mutate(current => applicationsApi.details(current, { referenceNumber: nextReference || null,
      vendorName: nextVendor || null }), "Application details saved as your own record.");
  }
  function addDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const type = documentType.trim().toUpperCase().replaceAll(/\s+/g, "_");
    if (!/^[A-Z][A-Z0-9_]{1,63}$/.test(type) || !documentLabel.trim()) {
      setError("Enter a document type using letters, numbers or underscores and a short label."); return;
    }
    void mutate(current => applicationsApi.document(current, { documentType: type, label: documentLabel.trim(),
      ...(obtainedOn ? { obtainedOn } : {}) }), "Document note added. No file was uploaded.")
      .then(saved => { if (saved) { setDocumentType(""); setDocumentLabel(""); setObtainedOn(""); } });
  }

  return <section className="tracker-detail" aria-labelledby="tracker-detail-title">
    <div className="tracker-hero"><div><span className="tracker-eyebrow"><ClipboardList size={16} aria-hidden="true" /> {demo ? "Synthetic checklist preview" : "Policy checklist · user reported progress"}</span>
      <h2 id="tracker-detail-title">{demo ? "Example application journey" : "Your solar application journey"}</h2>
      <p>{demo ? "This fictional checklist shows the tracker layout. It contains no verified official policy or actual application status." :
        "Each process step came from a verified official policy. Statuses, notes and documents are your own records; official portal or DISCOM approval must be checked separately."}</p>
      <div className="tracker-hero-meta"><span>Policy v{application.policyVersion}</span><span>{readable(application.jurisdiction)}</span>
        <span>{application.system.nominalKw} kW system</span><span>Updated {when(application.updatedAt)}</span></div></div>
      <div className="tracker-progress"><strong>{completed}<small> / {application.steps.length}</small></strong><span>steps marked done</span>
        <div role="progressbar" aria-label="Steps marked done" aria-valuemin={0} aria-valuemax={application.steps.length}
          aria-valuenow={completed}><span style={{ width: `${completed / application.steps.length * 100}%` }} /></div></div></div>
    <div className="tracker-next"><span>{application.status === "COMPLETED" ? "Your checklist is marked complete" :
      application.status === "BLOCKED" ? "A step needs attention" : "Suggested next step"}</span>
      <strong>{nextStep?.title ?? (application.status === "COMPLETED" ? "Review official confirmation" : "Review your checklist")}</strong>
      <small>{demo ? "Derived from a fictional sequence and example statuses." :
        "This is derived from the policy sequence and the statuses you entered."}</small></div>
    <div className="tracker-source"><ShieldCheck size={19} aria-hidden="true" /><div><strong>{demo ? "Synthetic process preview" : "Verified process snapshot"}</strong>
      <p>{demo ? "Fictional policy, citations and verification times for layout testing." :
        `Policy ${application.policyId} · version ${application.policyVersion} · effective source verified ${when(application.lastVerifiedAt)}.`}</p>
      {application.policyCitations.map((citation, index) => demo ? <small key={`${citation.documentId}-${index}`}>Fictional citation · no official link</small> :
        <a key={`${citation.documentId}-${index}`} href={citation.sourceUrl}
          target="_blank" rel="noopener noreferrer">{citation.publisherName} · {citation.documentTitle} <ArrowUpRight size={13} aria-hidden="true" /></a>)}
      {!demo && application.sourceChecks.map(check => <small key={check.sourceId}>Source {check.sourceId} · {check.lastCheckedAt ?
        `last checked ${when(check.lastCheckedAt)}` : "not checked"} · {check.fresh ? "current at creation" : "check again"}</small>)}
    </div></div>
    {error && <p className="form-error" role="alert">{error}</p>}
    {notice && <p className="tracker-notice" role="status">{notice}</p>}
    <div className="tracker-grid"><div><h2 className="tracker-section-title">{demo ? "Example process and progress" : "Official process, your progress"}</h2>
      <ol className="tracker-steps">{application.steps.map(step => <StepCard key={`${step.stepId}:${step.status}`}
        application={application} step={step} busy={busy} demo={demo} onChange={(stepId, status, note) =>
          void mutate(current => applicationsApi.transition(current, stepId, status, note), "Progress saved as your own report.")} />)}</ol></div>
      <aside className="tracker-sidebar"><section><h2>{demo ? "Example application details" : "Application details"}</h2>
        <p>{demo ? "Fictional reference and installer values." : "Store the reference and installer name exactly as you received them."}</p>
        <form onSubmit={saveDetails}><Label htmlFor="tracker-reference">Application reference</Label>
          <Input id="tracker-reference" maxLength={120} value={reference} disabled={demo} onChange={event => setReference(event.target.value)} />
          <Label htmlFor="tracker-vendor">Vendor or installer</Label><Input id="tracker-vendor" maxLength={160} value={vendor}
            disabled={demo} onChange={event => setVendor(event.target.value)} /><Button type="submit" disabled={busy || demo}>Save details</Button></form></section>
        <section><h2>Document notes</h2><p>Record what you have. No file contents are uploaded from this tracker.</p>
          {application.documents.length ? <ul className="tracker-documents">{application.documents.map(document =>
            <li key={document.documentId}><FileText size={17} aria-hidden="true" /><div><strong>{document.label}</strong>
              <span>{readable(document.documentType)} · recorded {when(document.recordedAt)}</span></div></li>)}</ul> :
            <p className="tracker-empty-small">No document notes yet.</p>}
          <form onSubmit={addDocument}><Label htmlFor="tracker-document-type">Document type</Label>
            <Input id="tracker-document-type" value={documentType} maxLength={64} disabled={demo} onChange={event => setDocumentType(event.target.value)}
              placeholder="For example, ACKNOWLEDGEMENT" required />
            <Label htmlFor="tracker-document-label">Short label</Label><Input id="tracker-document-label" value={documentLabel} disabled={demo}
              maxLength={120} onChange={event => setDocumentLabel(event.target.value)} required />
            <Label htmlFor="tracker-obtained">Date received (optional)</Label><Input id="tracker-obtained" type="date" value={obtainedOn}
              disabled={demo} onChange={event => setObtainedOn(event.target.value)} /><Button type="submit" variant="outline" disabled={busy || demo}>Add document note</Button></form></section>
        <section className="tracker-reminder"><CalendarDays size={19} aria-hidden="true" />
          <h2>{demo ? "Fictional reference preview" : "Keep your official reference handy"}</h2>
          <p>{demo ? "This example has no linked government portal or real application status." :
            "This checklist does not receive portal updates automatically. Check the linked official source for current instructions and processing status."}</p></section>
      </aside></div>
  </section>;
}

function SignedInApplicationsPanel() {
  const [properties, setProperties] = useState<PropertyChoice[]>([]);
  const [propertyCursor, setPropertyCursor] = useState<string>();
  const [selectedProperty, setSelectedProperty] = useState("");
  const [applications, setApplications] = useState<SolarApplication[]>([]);
  const [applicationCursor, setApplicationCursor] = useState<string>();
  const [selected, setSelected] = useState<SolarApplication>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const propertyRef = useRef(selectedProperty);
  const selectionAttempt = useRef(0);
  propertyRef.current = selectedProperty;

  useEffect(() => {
    const controller = new AbortController();
    void applicationsApi.properties(undefined, controller.signal).then(page => {
      if (controller.signal.aborted) return;
      setProperties(page.properties); setPropertyCursor(page.nextCursor);
      if (page.properties[0]) setSelectedProperty(page.properties[0].propertyId);
    }).catch(failure => { if (!controller.signal.aborted) setError(messageFor(failure)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (!selectedProperty) return;
    const controller = new AbortController();
    selectionAttempt.current += 1;
    setLoading(true); setError(undefined); setApplications([]); setApplicationCursor(undefined); setSelected(undefined);
    void applicationsApi.list(selectedProperty, undefined, controller.signal).then(page => {
      if (!controller.signal.aborted) { setApplications(page.applications); setApplicationCursor(page.nextCursor); }
    }).catch(failure => { if (!controller.signal.aborted) setError(messageFor(failure)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [selectedProperty]);
  async function moreProperties() {
    if (!propertyCursor) return;
    setBusy(true); setError(undefined);
    try { const page = await applicationsApi.properties(propertyCursor);
      setProperties(previous => [...previous, ...page.properties]); setPropertyCursor(page.nextCursor); }
    catch (failure) { setError(messageFor(failure)); } finally { setBusy(false); }
  }
  async function moreApplications() {
    if (!applicationCursor) return;
    const propertyId = selectedProperty;
    setBusy(true); setError(undefined);
    try { const page = await applicationsApi.list(propertyId, applicationCursor);
      if (propertyRef.current !== propertyId) return;
      setApplications(previous => [...previous, ...page.applications]); setApplicationCursor(page.nextCursor); }
    catch (failure) { if (propertyRef.current === propertyId) setError(messageFor(failure)); }
    finally { setBusy(false); }
  }
  async function selectApplication(item: SolarApplication) {
    const attempt = ++selectionAttempt.current;
    setBusy(true); setError(undefined);
    try { const application = await applicationsApi.get(item.propertyId, item.applicationId);
      if (attempt === selectionAttempt.current && propertyRef.current === item.propertyId) setSelected(application); }
    catch (failure) { if (attempt === selectionAttempt.current && propertyRef.current === item.propertyId) setError(messageFor(failure)); }
    finally { setBusy(false); }
  }

  return <div className="applications-page"><div className="page-heading"><span className="tracker-page-kicker"><MapPin size={15} aria-hidden="true" /> Your solar journey</span>
    <h1>Application tracker</h1><p>Follow policy specific steps and keep your own progress in one place.</p></div>
    <div className="tracker-picker"><div><Label htmlFor="tracker-property">Property</Label><select id="tracker-property" value={selectedProperty}
      onChange={event => setSelectedProperty(event.target.value)} disabled={!properties.length}>{properties.map(property =>
        <option key={property.propertyId} value={property.propertyId}>{property.label} · {property.address}</option>)}</select></div>
      {propertyCursor && <Button type="button" variant="outline" onClick={() => void moreProperties()} disabled={busy}>More properties</Button>}
      {selectedProperty && <Button type="button" variant="outline" onClick={() => void selectApplication(selected ?? applications[0]!)}
        disabled={busy || !applications.length}><RefreshCw size={15} aria-hidden="true" /> {selected ? "Refresh selected" : "Open latest"}</Button>}</div>
    {error && <p role="alert" className="form-error">{error}</p>}
    {loading ? <p role="status" className="tracker-loading">Loading your properties and applications…</p> :
      !properties.length ? <section className="tracker-empty"><CircleAlert size={26} aria-hidden="true" /><h2>No property assessment yet</h2>
        <p>Start by confirming a roof and evaluating an official benefit.</p><Button asChild><Link href="/app/analyze">Analyze a roof <ArrowRight size={15} aria-hidden="true" /></Link></Button></section> :
      <><section className="tracker-list" aria-labelledby="tracker-list-title"><div><h2 id="tracker-list-title">Applications for this property</h2>
        <p>{applications.length ? "Select an application to view its verified process and your recorded progress." :
          "No application tracker has been created for this property."}</p></div>
        {applications.length ? <div className="tracker-list-items">{applications.map(item => <button type="button"
          key={item.applicationId} className={selected?.applicationId === item.applicationId ? "selected" : ""}
          onClick={() => void selectApplication(item)} disabled={busy}><span><strong>{readable(item.benefitId.replace(/^BENEFIT#/, ""))}</strong>
            <small>Policy v{item.policyVersion} · {item.system.nominalKw} kW · updated {when(item.updatedAt)}</small></span>
            <b>{readable(item.status)}</b><ArrowRight size={17} aria-hidden="true" /></button>)}</div> :
          <p className="tracker-list-guidance">Evaluate a benefit from a saved roof and choose “Start application tracker” when a verified process is available.</p>}
        {applicationCursor && <Button type="button" variant="outline" onClick={() => void moreApplications()} disabled={busy}>Load more applications</Button>}
      </section>{selected && <ApplicationDetails key={`${selected.applicationId}:${selected.revision}`} initial={selected} />}</>}
  </div>;
}

export function ApplicationsPanel() {
  const { status, profile } = useAuth();
  if (status === "loading") return <p className="tracker-loading" role="status">Checking your session…</p>;
  if (status !== "signedIn" || !profile) return <section className="tracker-empty"><CircleAlert size={26} aria-hidden="true" />
    <h1>Sign in to view applications</h1><p>Application records are available only in your authenticated workspace.</p>
    <Button asChild><Link href="/auth/sign-in">Sign in <ArrowRight size={15} aria-hidden="true" /></Link></Button></section>;
  return <SignedInApplicationsPanel key={profile.userId} />;
}
