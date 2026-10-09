"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ArrowRight, Box, Building2, ClipboardList, FileText, Layers3, Plus, Search, ShieldCheck, Sun, Users } from "lucide-react";
import { Button, Input, Label } from "@solarsaathi/ui";
import { useAuth } from "../auth/auth-provider";
import { advisorApi, type AdvisorAnalysis } from "../lib/advisor-api";
import { applicationsApi, type SolarApplication } from "../lib/applications-api";
import { brokerApi, type BrokerCustomer, type BrokerLead, type BrokerLeadStatus, type BrokerProperty } from "../lib/broker-api";
import { brokerProposalsApi, type BrokerDesign } from "../lib/broker-proposals-api";
import { RoofRequestError, roofApi } from "../lib/roof-api";
import { BrokerProposals } from "./broker-proposals";
import { useWorkspaceRole } from "./workspace-role";

export type BrokerSection = "overview" | "customers" | "properties" | "analyses" | "leads" | "proposals";
type Page<T> = { items: T[]; cursor?: string; loading: boolean; error?: string };
const emptyPage = <T,>(): Page<T> => ({ items: [], loading: true });
const readableDate = (value: string) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric",
  timeZone: "Asia/Kolkata" }).format(new Date(value));
const message = (error: unknown) => error instanceof RoofRequestError ? error.message :
  "The broker workspace could not reach the service. Check your connection and try again.";
const countText = <T,>(page: Page<T>) => page.cursor ? `${page.items.length}+` : String(page.items.length);

function Waiting({ children }: { children: ReactNode }) { return <p className="broker-wait" role="status">{children}</p>; }
function Empty({ title, children }: { title: string; children: ReactNode }) {
  return <div className="broker-empty"><Box size={25} aria-hidden="true" /><h3>{title}</h3><p>{children}</p></div>;
}
function More({ cursor, busy, onClick }: { cursor?: string; busy: boolean; onClick: () => void }) {
  return cursor ? <Button type="button" variant="outline" disabled={busy} onClick={onClick}>
    {busy ? "Loading…" : "Load more"}</Button> : null;
}

function BrokerConnected({ section }: { section: BrokerSection }) {
  const [customers, setCustomers] = useState<Page<BrokerCustomer>>(emptyPage);
  const [properties, setProperties] = useState<Page<BrokerProperty>>(emptyPage);
  const [leads, setLeads] = useState<Page<BrokerLead>>(emptyPage);
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [selectedPropertyId, setSelectedPropertyId] = useState("");
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState("");
  const [formError, setFormError] = useState("");
  const requests = useRef<Set<AbortController>>(new Set());
  const track = () => { const controller = new AbortController(); requests.current.add(controller); return controller; };
  const release = (controller: AbortController) => { requests.current.delete(controller); };

  useEffect(() => {
    const controller = track();
    void roofApi.bootstrap(controller.signal).then(() => {
      if (controller.signal.aborted) return;
      return Promise.allSettled([
        brokerApi.customers(undefined, controller.signal).then(page => { if (!controller.signal.aborted) setCustomers({ items: page.customers, cursor: page.nextCursor, loading: false }); }),
        brokerApi.properties(undefined, controller.signal).then(page => { if (!controller.signal.aborted) setProperties({ items: page.properties, cursor: page.nextCursor, loading: false }); }),
        brokerApi.leads(undefined, controller.signal).then(page => { if (!controller.signal.aborted) setLeads({ items: page.leads, cursor: page.nextCursor, loading: false }); }),
      ]).then(results => results.forEach((result, index) => {
        if (controller.signal.aborted || result.status !== "rejected") return;
        const error = message(result.reason);
        if (index === 0) setCustomers(previous => ({ ...previous, loading: false, error }));
        if (index === 1) setProperties(previous => ({ ...previous, loading: false, error }));
        if (index === 2) setLeads(previous => ({ ...previous, loading: false, error }));
      }));
    }).catch(error => {
      if (controller.signal.aborted) return;
      const detail = message(error);
      setCustomers({ items: [], loading: false, error: detail });
      setProperties({ items: [], loading: false, error: detail });
      setLeads({ items: [], loading: false, error: detail });
    }).finally(() => release(controller));
    const activeRequests = requests.current;
    return () => { activeRequests.forEach(active => active.abort()); activeRequests.clear(); };
  }, []);

  function loadMore(kind: "customers" | "properties" | "leads") {
    const current = kind === "customers" ? customers : kind === "properties" ? properties : leads;
    if (!current.cursor || current.loading) return;
    const controller = track();
    const cursor = current.cursor;
    const pending = kind === "customers" ? brokerApi.customers(cursor, controller.signal) :
      kind === "properties" ? brokerApi.properties(cursor, controller.signal) : brokerApi.leads(cursor, controller.signal);
    if (kind === "customers") setCustomers(previous => ({ ...previous, loading: true, error: undefined }));
    if (kind === "properties") setProperties(previous => ({ ...previous, loading: true, error: undefined }));
    if (kind === "leads") setLeads(previous => ({ ...previous, loading: true, error: undefined }));
    void pending.then(page => {
      if (controller.signal.aborted) return;
      if (kind === "customers" && "customers" in page) setCustomers(previous => ({ items: [...previous.items, ...page.customers], cursor: page.nextCursor, loading: false }));
      if (kind === "properties" && "properties" in page) setProperties(previous => ({ items: [...previous.items, ...page.properties], cursor: page.nextCursor, loading: false }));
      if (kind === "leads" && "leads" in page) setLeads(previous => ({ items: [...previous.items, ...page.leads], cursor: page.nextCursor, loading: false }));
    }).catch(error => {
      if (controller.signal.aborted) return;
      const detail = message(error);
      if (kind === "customers") setCustomers(previous => ({ ...previous, loading: false, error: detail }));
      if (kind === "properties") setProperties(previous => ({ ...previous, loading: false, error: detail }));
      if (kind === "leads") setLeads(previous => ({ ...previous, loading: false, error: detail }));
    }).finally(() => release(controller));
  }
  function submit<T>(task: (signal: AbortSignal) => Promise<T>, onSuccess: (value: T) => void, success: string) {
    if (creating) return;
    const controller = track(); setCreating(true); setFormError(""); setNotice("");
    void task(controller.signal).then(value => { if (!controller.signal.aborted) { onSuccess(value); setNotice(success); } })
      .catch(error => { if (!controller.signal.aborted) setFormError(message(error)); })
      .finally(() => { release(controller); if (!controller.signal.aborted) setCreating(false); });
  }
  const selectedCustomer = customers.items.find(item => item.customerId === selectedCustomerId);
  const selectedProperty = properties.items.find(item => item.propertyId === selectedPropertyId);
  const common = { customers, properties, leads, selectedCustomer, selectedProperty,
    selectedCustomerId, selectedPropertyId, setSelectedCustomerId, setSelectedPropertyId,
    creating, formError, notice, submit, loadMore };
  return <div className="broker-workspace">
    {section === "overview" && <BrokerOverview {...common} />}
    {section === "customers" && <BrokerCustomers {...common} />}
    {section === "properties" && <BrokerProperties {...common} focus="properties" />}
    {section === "analyses" && <BrokerProperties {...common} focus="analyses" />}
    {section === "leads" && <BrokerLeads {...common} />}
    {section === "proposals" && <><BrokerHero title="A proposal should show its working." subtitle="Choose a customer, a confirmed roof and a real quote. The backend recomputes the estimate from verified policy records." />
      <BrokerProposals customers={customers} properties={properties} onMoreCustomers={() => loadMore("customers")} onMoreProperties={() => loadMore("properties")} /></>}
  </div>;
}

type BrokerState = {
  customers: Page<BrokerCustomer>; properties: Page<BrokerProperty>; leads: Page<BrokerLead>;
  selectedCustomer?: BrokerCustomer; selectedProperty?: BrokerProperty;
  selectedCustomerId: string; selectedPropertyId: string;
  setSelectedCustomerId: (value: string) => void; setSelectedPropertyId: (value: string) => void;
  creating: boolean; formError: string; notice: string;
  submit: <T>(task: (signal: AbortSignal) => Promise<T>, onSuccess: (value: T) => void, success: string) => void;
  loadMore: (kind: "customers" | "properties" | "leads") => void;
};

function BrokerHero({ title, subtitle, children }: { title: string; subtitle: string; children?: ReactNode }) {
  return <header className="broker-hero"><div><div className="broker-hero-mark"><Sun size={20} aria-hidden="true" />SolarSaathi for consultants</div>
    <h1>{title}</h1><p>{subtitle}</p>{children}</div><div className="broker-hero-model" aria-hidden="true">
      <span className="broker-model-base" /><span className="broker-model-roof" /><span className="broker-model-solar" />
      <span className="broker-model-sun" /></div></header>;
}
function BrokerOverview({ customers, properties, leads }: BrokerState) {
  return <><BrokerHero title="One clear record for every rooftop." subtitle="Keep customer context, confirmed roof work and policy evidence together before you prepare a proposal.">
    <div className="broker-hero-actions"><Button asChild><Link href="/app/customers">Open customers <ArrowRight size={16} aria-hidden="true" /></Link></Button>
      <Button asChild variant="outline"><Link href="/demo/broker">See a fictional workspace</Link></Button></div></BrokerHero>
    <div className="broker-pulse" aria-label="Workspace records"><div><Users aria-hidden="true" /><span>Customers</span><strong>{customers.loading ? "…" : countText(customers)}</strong></div>
      <div><Building2 aria-hidden="true" /><span>Properties</span><strong>{properties.loading ? "…" : countText(properties)}</strong></div>
      <div><ClipboardList aria-hidden="true" /><span>Leads</span><strong>{leads.loading ? "…" : countText(leads)}</strong></div></div>
    <p className="broker-count-note">Counts cover loaded records; a plus sign means more pages are available. Leads are separate from customer records.</p>
    <div className="broker-next-grid"><Link href="/app/customers"><Users aria-hidden="true" /><h2>Add a customer</h2><p>Keep each property attached to the correct customer in your organization.</p><ArrowRight aria-hidden="true" /></Link>
      <Link href="/app/properties"><Building2 aria-hidden="true" /><h2>Review properties</h2><p>Open a property’s saved roof assessments and follow its planning work.</p><ArrowRight aria-hidden="true" /></Link>
      <Link href="/app/proposals"><FileText aria-hidden="true" /><h2>Prepare a proposal</h2><p>Use a real quote and a fresh deterministic policy evaluation for a customer.</p><ArrowRight aria-hidden="true" /></Link></div>
    {[customers.error, properties.error, leads.error].filter(Boolean).length > 0 && <p role="alert" className="broker-error">Some workspace lists could not load. Open a section to retry.</p>}
  </>;
}

function BrokerCustomers(state: BrokerState) {
  const { customers, properties, selectedCustomer, selectedCustomerId, setSelectedCustomerId, creating, formError, notice, submit, loadMore } = state;
  const [name, setName] = useState(""), [email, setEmail] = useState(""), [phone, setPhone] = useState("");
  const [localCustomers, setLocalCustomers] = useState<BrokerCustomer[]>([]);
  const allCustomers = [...localCustomers, ...customers.items.filter(item => !localCustomers.some(local => local.customerId === item.customerId))];
  const selected = selectedCustomer ?? localCustomers.find(item => item.customerId === selectedCustomerId);
  function create(event: FormEvent) {
    event.preventDefault();
    const cleaned = name.trim(); if (!cleaned) return;
    submit(signal => brokerApi.createCustomer({ name: cleaned, ...(email.trim() ? { email: email.trim() } : {}),
      ...(phone.trim() ? { phone: phone.trim() } : {}) }, signal), customer => {
      setLocalCustomers(previous => [customer, ...previous]); setSelectedCustomerId(customer.customerId);
      setName(""); setEmail(""); setPhone("");
    }, "Customer saved in your organization.");
  }
  return <><BrokerHero title="People first, roofs second." subtitle="Each assessment and proposal belongs to a customer. Add a record, then attach a property before analyzing a roof." />
    <div className="broker-columns"><section className="broker-panel" aria-labelledby="broker-customer-list-title"><div className="broker-panel-head"><div><h2 id="broker-customer-list-title">Customers</h2><p>{customers.loading && !allCustomers.length ? "Loading records…" : `${allCustomers.length}${customers.cursor ? "+" : ""} records loaded`}</p></div><Users aria-hidden="true" /></div>
      {customers.error && <p role="alert" className="broker-error">{customers.error}</p>}
      {customers.loading && !allCustomers.length && <Waiting>Loading customer records…</Waiting>}
      {!customers.loading && !allCustomers.length && !customers.cursor && !customers.error && <Empty title="No customers yet">Add a customer to begin a property assessment.</Empty>}
      {!allCustomers.length && customers.cursor && <p className="broker-help">No customer records on this page. More organization records are available.</p>}
      <div className="broker-list">{allCustomers.map(customer => <button key={customer.customerId} type="button" className="broker-list-item" aria-pressed={selectedCustomerId === customer.customerId} onClick={() => setSelectedCustomerId(customer.customerId)}><span className="broker-avatar">{customer.name.slice(0, 1).toUpperCase()}</span><span><strong>{customer.name}</strong><small>{customer.email || customer.phone || `Added ${readableDate(customer.createdAt)}`}</small></span><ArrowRight size={16} aria-hidden="true" /></button>)}</div>
      <More cursor={customers.cursor} busy={customers.loading} onClick={() => loadMore("customers")} /></section>
      <div className="broker-detail-stack"><section className="broker-panel" aria-labelledby="broker-add-customer-title"><div className="broker-panel-head"><div><h2 id="broker-add-customer-title">Add a customer</h2><p>Only contact details you enter are saved.</p></div><Plus aria-hidden="true" /></div>
        <form className="broker-form" onSubmit={create}><div><Label htmlFor="broker-customer-name">Customer name</Label><Input id="broker-customer-name" required maxLength={120} value={name} onChange={event => setName(event.target.value)} /></div>
          <div><Label htmlFor="broker-customer-email">Email (optional)</Label><Input id="broker-customer-email" type="email" value={email} onChange={event => setEmail(event.target.value)} /></div>
          <div><Label htmlFor="broker-customer-phone">Phone (optional)</Label><Input id="broker-customer-phone" type="tel" value={phone} onChange={event => setPhone(event.target.value)} /></div>
          <Button type="submit" disabled={creating}>{creating ? "Saving…" : "Save customer"}</Button></form>
        {formError && <p role="alert" className="broker-error">{formError}</p>}{notice && <p role="status" className="broker-notice">{notice}</p>}</section>
        {selected ? <CustomerProperties key={selected.customerId} customer={selected} orgProperties={properties} onMore={() => loadMore("properties")} /> : <section className="broker-panel"><Empty title="Select a customer">Their properties and proposal history will appear here.</Empty></section>}</div></div></>;
}

function CustomerProperties({ customer, orgProperties, onMore }: { customer: BrokerCustomer; orgProperties: Page<BrokerProperty>; onMore: () => void }) {
  const [newProperties, setNewProperties] = useState<BrokerProperty[]>([]);
  const pageItems = [...newProperties, ...orgProperties.items.filter(item => item.customerId === customer.customerId &&
    !newProperties.some(local => local.propertyId === item.propertyId))];
  const [label, setLabel] = useState(""), [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  function create(event: FormEvent) {
    event.preventDefault(); if (!label.trim() || !address.trim() || busy) return;
    const request = new AbortController(); controller.current = request;
    setBusy(true); setError(""); setNotice("");
    void brokerApi.createProperty({ customerId: customer.customerId, label: label.trim(), address: address.trim() }, request.signal)
      .then(property => { if (!request.signal.aborted) { setNewProperties(previous => [property, ...previous]);
        setLabel(""); setAddress(""); setNotice("Property saved. You can now assess its roof."); } })
      .catch(failure => { if (!request.signal.aborted) setError(message(failure)); })
      .finally(() => { if (!request.signal.aborted) setBusy(false); });
  }
  return <section className="broker-panel" aria-labelledby="broker-customer-properties-title"><div className="broker-panel-head"><div><h2 id="broker-customer-properties-title">{customer.name}’s properties</h2><p>Saved addresses and their planning work.</p></div><Building2 aria-hidden="true" /></div>
    {orgProperties.error && <p role="alert" className="broker-error">{orgProperties.error}</p>}
    {orgProperties.loading && !pageItems.length && <Waiting>Loading customer properties…</Waiting>}
    {!orgProperties.loading && !pageItems.length && !orgProperties.cursor && !orgProperties.error && <Empty title="No property yet">Add an address for this customer.</Empty>}
    {!pageItems.length && orgProperties.cursor && <p className="broker-help">No property for this customer in the loaded pages. More organization records are available.</p>}
    <ul className="broker-compact-list">{pageItems.map(property => <li key={property.propertyId}><strong>{property.label}</strong><span>{property.address}</span><Link href={`/app/analyze?propertyId=${encodeURIComponent(property.propertyId)}`}>Assess this roof <ArrowRight size={15} aria-hidden="true" /></Link></li>)}</ul>
    <More cursor={orgProperties.cursor} busy={orgProperties.loading} onClick={onMore} />
    <form className="broker-form broker-inline-form" onSubmit={create}><h3>Add a property</h3><div><Label htmlFor="broker-property-label">Property label</Label><Input id="broker-property-label" required maxLength={120} value={label} onChange={event => setLabel(event.target.value)} placeholder="Home rooftop" /></div>
      <div><Label htmlFor="broker-property-address">Full address</Label><Input id="broker-property-address" required minLength={8} maxLength={300} value={address} onChange={event => setAddress(event.target.value)} placeholder="Street, city, state and postcode" /></div>
      <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save property"}</Button></form>
    {error && <p role="alert" className="broker-error">{error}</p>}{notice && <p role="status" className="broker-notice">{notice}</p>}
  </section>;
}

function BrokerProperties({ properties, customers, selectedPropertyId, setSelectedPropertyId, loadMore, focus }: BrokerState & { focus: "properties" | "analyses" }) {
  const selected = properties.items.find(item => item.propertyId === selectedPropertyId) ?? properties.items[0];
  const customerName = (id: string) => customers.items.find(item => item.customerId === id)?.name ?? "Customer record";
  return <><BrokerHero title={focus === "analyses" ? "Know what the roof can support." : "Every site has a story."}
    subtitle={focus === "analyses" ? "Choose a saved property to inspect confirmed, unexpired roof measurements." : "Select a customer property, then inspect its assessments and next actions."} />
    <div className="broker-columns"><section className="broker-panel" aria-labelledby="broker-property-list-title"><div className="broker-panel-head"><div><h2 id="broker-property-list-title">Properties</h2><p>Organization records</p></div><Building2 aria-hidden="true" /></div>
      {properties.error && <p role="alert" className="broker-error">{properties.error}</p>}
      {properties.loading && !properties.items.length && <Waiting>Loading properties…</Waiting>}
      {!properties.loading && !properties.items.length && !properties.cursor && !properties.error && <Empty title="No properties yet">Add a customer, then attach an address.</Empty>}
      {!properties.items.length && properties.cursor && <p className="broker-help">No property records on this page. More organization records are available.</p>}
      <div className="broker-list">{properties.items.map(property => <button key={property.propertyId} type="button" className="broker-list-item" aria-pressed={selected?.propertyId === property.propertyId} onClick={() => setSelectedPropertyId(property.propertyId)}><span className="broker-avatar property"><Building2 size={19} aria-hidden="true" /></span><span><strong>{property.label}</strong><small>{customerName(property.customerId)} · {property.address}</small></span><ArrowRight size={16} aria-hidden="true" /></button>)}</div>
      <More cursor={properties.cursor} busy={properties.loading} onClick={() => loadMore("properties")} /><p className="broker-help">Need another site? Add it under the customer record.</p><Button asChild variant="outline"><Link href="/app/customers">Open customers</Link></Button></section>
      <div className="broker-detail-stack">{selected ? <BrokerPropertyDetail key={selected.propertyId} property={selected} customerName={customerName(selected.customerId)} focus={focus} /> :
        <section className="broker-panel"><Empty title="Select a property">Its saved analyses and application checklist will appear here.</Empty></section>}</div></div></>;
}

function BrokerPropertyDetail({ property, customerName, focus }: { property: BrokerProperty; customerName: string; focus: "properties" | "analyses" }) {
  const [analyses, setAnalyses] = useState<Page<AdvisorAnalysis>>(emptyPage);
  const [applications, setApplications] = useState<Page<SolarApplication>>(emptyPage);
  const [designs, setDesigns] = useState<Page<BrokerDesign>>(emptyPage);
  const [image, setImage] = useState<{ designId: string; url: string; expiresAt: string }>();
  const [designBusy, setDesignBusy] = useState("");
  const requests = useRef<Set<AbortController>>(new Set());
  const track = () => { const controller = new AbortController(); requests.current.add(controller); return controller; };
  const release = (controller: AbortController) => { requests.current.delete(controller); };
  useEffect(() => { const controller = new AbortController();
    requests.current.add(controller);
    void advisorApi.analyses(property.propertyId, undefined, controller.signal).then(page => {
      if (!controller.signal.aborted) setAnalyses({ items: page.analyses, cursor: page.nextCursor, loading: false });
    }).catch(error => { if (!controller.signal.aborted) setAnalyses({ items: [], loading: false, error: message(error) }); });
    void applicationsApi.list(property.propertyId, undefined, controller.signal).then(page => {
      if (!controller.signal.aborted) setApplications({ items: page.applications, cursor: page.nextCursor, loading: false });
    }).catch(error => { if (!controller.signal.aborted) setApplications({ items: [], loading: false, error: message(error) }); });
    void brokerProposalsApi.designs(property.propertyId, undefined, controller.signal).then(page => {
      if (!controller.signal.aborted) setDesigns({ items: page.designs, cursor: page.nextCursor, loading: false });
    }).catch(error => { if (!controller.signal.aborted) setDesigns({ items: [], loading: false, error: message(error) }); });
    const activeRequests = requests.current;
    return () => { activeRequests.forEach(request => request.abort()); activeRequests.clear(); };
  }, [property.propertyId]);
  function moreAnalyses() {
    if (!analyses.cursor || analyses.loading) return;
    const controller = track(); setAnalyses(previous => ({ ...previous, loading: true, error: undefined }));
    void advisorApi.analyses(property.propertyId, analyses.cursor, controller.signal).then(page => {
      if (!controller.signal.aborted) setAnalyses(previous => ({
        items: [...previous.items, ...page.analyses], cursor: page.nextCursor, loading: false,
      }));
    }).catch(error => { if (!controller.signal.aborted) setAnalyses(previous => ({ ...previous, loading: false, error: message(error) })); })
      .finally(() => release(controller));
  }
  function moreDesigns() {
    if (!designs.cursor || designs.loading) return;
    const controller = track(); setDesigns(previous => ({ ...previous, loading: true, error: undefined }));
    void brokerProposalsApi.designs(property.propertyId, designs.cursor, controller.signal).then(page => {
      if (!controller.signal.aborted) setDesigns(previous => ({ items: [...previous.items, ...page.designs], cursor: page.nextCursor, loading: false }));
    }).catch(error => { if (!controller.signal.aborted) setDesigns(previous => ({ ...previous, loading: false, error: message(error) })); })
      .finally(() => release(controller));
  }
  function openImage(design: BrokerDesign) {
    const controller = track();
    setImage(undefined); setDesignBusy(design.designId);
    void brokerProposalsApi.image(property.propertyId, design.designId, controller.signal).then(result => {
      if (!controller.signal.aborted) setImage({ designId: result.designId, url: result.url, expiresAt: result.expiresAt });
    }).catch(error => { if (!controller.signal.aborted) setDesigns(previous => ({ ...previous, error: message(error) })); })
      .finally(() => { release(controller); if (!controller.signal.aborted) setDesignBusy(""); });
  }
  return <><section className="broker-panel broker-property-detail" aria-labelledby="broker-property-title"><div className="broker-panel-head"><div><span className="broker-context">{customerName}</span><h2 id="broker-property-title">{property.label}</h2><p>{property.address}</p></div><Building2 aria-hidden="true" /></div>
      <div className="broker-property-actions"><Button asChild><Link href={`/app/analyze?propertyId=${encodeURIComponent(property.propertyId)}`}>Assess this roof <ArrowRight size={16} aria-hidden="true" /></Link></Button><Button asChild variant="outline"><Link href="/app/designs">Plan remaining space</Link></Button></div>
      <p className="broker-help">Rooftop concepts check modeled space only. A qualified site and structural review is needed before building.</p></section>
    <section className="broker-panel" aria-labelledby="broker-property-analyses-title"><div className="broker-panel-head"><div><h2 id="broker-property-analyses-title">Confirmed roof analyses</h2><p>Expired Google analyses are excluded by the service.</p></div><Layers3 aria-hidden="true" /></div>
      {analyses.error && <p role="alert" className="broker-error">{analyses.error}</p>}
      {analyses.loading && !analyses.items.length && <Waiting>Loading roof analyses…</Waiting>}
      {!analyses.loading && !analyses.items.length && !analyses.cursor && !analyses.error && <Empty title="No current roof analysis">Assess this property to create one.</Empty>}
      {!analyses.items.length && analyses.cursor && <p className="broker-help">This page has no current analyses. More records are available.</p>}
      <ul className="broker-compact-list">{analyses.items.map(item => <li key={item.analysisId}><strong>{item.roofAreaSquareMeters.toFixed(1)} m² · {item.segmentCount} segment{item.segmentCount === 1 ? "" : "s"}</strong><span>{item.source === "GOOGLE_SOLAR" ? "Includes solar data from Google" : "Customer provided measurements"} · measured {readableDate(item.measuredAt)}</span>{item.expiresAt && <small>Expires {readableDate(item.expiresAt)}</small>}<Link href="/app/proposals">Use in a proposal <ArrowRight size={15} aria-hidden="true" /></Link></li>)}</ul>
      <More cursor={analyses.cursor} busy={analyses.loading} onClick={moreAnalyses} /></section>
    <section className="broker-panel" aria-labelledby="broker-property-designs-title"><div className="broker-panel-head"><div><h2 id="broker-property-designs-title">Saved concept records</h2><p>Property-specific image attempts only; generic templates are available in Rooftop Ideas.</p></div><Box aria-hidden="true" /></div>
      {designs.error && <p role="alert" className="broker-error">{designs.error}</p>}
      {designs.loading && !designs.items.length && <Waiting>Loading saved concepts…</Waiting>}
      {!designs.loading && !designs.items.length && !designs.cursor && !designs.error && <Empty title="No saved image concept">Open Rooftop Ideas for a fresh deterministic 3D and plan view.</Empty>}
      {!designs.items.length && designs.cursor && <p className="broker-help">No current records on this page. More saved records are available.</p>}
      <ul className="broker-compact-list">{designs.items.map(design => <li key={design.designId}><strong>{design.candidateId.replaceAll("_", " ")} concept</strong><span>Created {readableDate(design.createdAt)} · {design.imageStatus === "READY" ? "private image available" : "image unavailable"}</span>
        <small>Fingerprint {design.fingerprint.slice(0, 12)}… · inspirational only. Recheck the roof before reusing a template.</small>
        {design.imageStatus === "READY" && <Button type="button" variant="outline" disabled={!!designBusy} onClick={() => openImage(design)}>{designBusy === design.designId ? "Opening…" : "Open private concept image"}</Button>}
        {image?.designId === design.designId && <figure className="broker-design-image"><Image src={image.url} alt={`Inspirational ${design.candidateId} concept, not a property-accurate rendering`} width={800} height={600} unoptimized referrerPolicy="no-referrer" />
          <figcaption>AI-generated inspiration only. This short-lived image link is not saved in the workspace.</figcaption></figure>}</li>)}</ul>
      <More cursor={designs.cursor} busy={designs.loading} onClick={moreDesigns} /></section>
    {focus === "properties" && <section className="broker-panel" aria-labelledby="broker-property-applications-title"><div className="broker-panel-head"><div><h2 id="broker-property-applications-title">Application checklists</h2><p>Progress is user reported; official portals are separate.</p></div><ClipboardList aria-hidden="true" /></div>
      {applications.error && <p role="alert" className="broker-error">{applications.error}</p>}
      {applications.loading && !applications.items.length && <Waiting>Loading application records…</Waiting>}
      {!applications.loading && !applications.items.length && !applications.cursor && !applications.error && <Empty title="No application tracker">A tracker needs a selected verified process rule.</Empty>}
      <ul className="broker-compact-list">{applications.items.map(item => <li key={item.applicationId}><strong>{item.status.replaceAll("_", " ").toLowerCase()} · policy v{item.policyVersion}</strong><span>Updated {readableDate(item.updatedAt)} · steps are user reported</span></li>)}</ul>
      {applications.cursor && <p className="broker-help">More tracker records are available in Applications.</p>}
      <Button asChild variant="outline"><Link href="/app/applications">Open application tracker</Link></Button></section>}</>;
}

function BrokerLeads({ leads, creating, formError, notice, submit, loadMore }: BrokerState) {
  const [name, setName] = useState(""), [email, setEmail] = useState(""), [phone, setPhone] = useState("");
  const [localLeads, setLocalLeads] = useState<BrokerLead[]>([]);
  const [pending, setPending] = useState<Record<string, BrokerLeadStatus>>({});
  const [busyId, setBusyId] = useState("");
  const [stageError, setStageError] = useState("");
  const [stageNotice, setStageNotice] = useState("");
  const stageRequest = useRef<AbortController | null>(null);
  useEffect(() => () => stageRequest.current?.abort(), []);
  const allLeads = [...localLeads, ...leads.items.filter(item => !localLeads.some(local => local.leadId === item.leadId))];
  const stages: BrokerLeadStatus[] = ["NEW", "CONTACTED", "SITE_VISIT", "PROPOSAL", "INSTALLATION", "COMPLETED"];
  const options = (status: BrokerLeadStatus) => status === "LOST" || status === "COMPLETED" ? [] :
    [...stages.slice(stages.indexOf(status) + 1), "LOST" as const];
  const label = (status: BrokerLeadStatus) => status.replaceAll("_", " ").toLowerCase().replace(/^./, first => first.toUpperCase());
  function update(record: BrokerLead) {
    const next = pending[record.leadId]; if (!next || busyId || !options(record.status).includes(next)) return;
    const controller = new AbortController(); stageRequest.current = controller;
    setBusyId(record.leadId); setStageError(""); setStageNotice("");
    void brokerApi.updateLead(record, next, controller.signal).then(updated => {
      if (controller.signal.aborted) return;
      setLocalLeads(previous => [updated, ...previous.filter(item => item.leadId !== updated.leadId)]);
      setPending(previous => { const copy = { ...previous }; delete copy[record.leadId]; return copy; });
      setStageNotice(`Lead stage saved as ${label(updated.status)}. No outbound contact was sent.`);
    }).catch(error => { if (!controller.signal.aborted) setStageError(message(error)); })
      .finally(() => { if (!controller.signal.aborted) setBusyId(""); });
  }
  function create(event: FormEvent) { event.preventDefault(); if (!name.trim()) return;
    submit(signal => brokerApi.createLead({ name: name.trim(), ...(email.trim() ? { email: email.trim() } : {}),
      ...(phone.trim() ? { phone: phone.trim() } : {}) }, signal), lead => {
      setLocalLeads(previous => [lead, ...previous]); setName(""); setEmail(""); setPhone("");
    }, "Lead added to the intake list.");
  }
  return <><BrokerHero title="Keep the next conversation visible." subtitle="Capture an inquiry and record its stage as your team works. A lead remains separate from customers, properties and confirmed projects." />
    <div className="broker-columns"><section className="broker-panel" aria-labelledby="broker-leads-title"><div className="broker-panel-head"><div><h2 id="broker-leads-title">Lead inbox</h2><p>Stages you record in your organization</p></div><Users aria-hidden="true" /></div>
      {leads.error && <p role="alert" className="broker-error">{leads.error}</p>}
      {leads.loading && !allLeads.length && <Waiting>Loading lead records…</Waiting>}
      {!leads.loading && !allLeads.length && !leads.cursor && !leads.error && <Empty title="No leads yet">Add a contact when someone asks about a rooftop assessment.</Empty>}
      {!allLeads.length && leads.cursor && <p className="broker-help">No lead records on this page. More organization records are available.</p>}
      <ul className="broker-compact-list">{allLeads.map(lead => <li key={lead.leadId}><strong>{lead.name}</strong><span>{lead.email || lead.phone || "No contact channel recorded"}</span><small>{label(lead.status)} · added {readableDate(lead.createdAt)}</small>
        {options(lead.status).length > 0 && <div className="broker-lead-transition"><label htmlFor={`broker-lead-stage-${lead.leadId}`}>Next stage</label><select id={`broker-lead-stage-${lead.leadId}`}
          value={pending[lead.leadId] ?? ""} onChange={event => setPending(previous => ({ ...previous, [lead.leadId]: event.target.value as BrokerLeadStatus }))}>
          <option value="">Choose a stage</option>{options(lead.status).map(stage => <option key={stage} value={stage}>{label(stage)}</option>)}</select>
          <Button type="button" variant="outline" disabled={!pending[lead.leadId] || !!busyId} onClick={() => update(lead)}>{busyId === lead.leadId ? "Saving…" : "Save stage"}</Button></div>}</li>)}</ul>
      {stageError && <p role="alert" className="broker-error">{stageError}</p>}{stageNotice && <p role="status" className="broker-notice">{stageNotice}</p>}
      <More cursor={leads.cursor} busy={leads.loading} onClick={() => loadMore("leads")} /></section>
      <section className="broker-panel" aria-labelledby="broker-add-lead-title"><div className="broker-panel-head"><div><h2 id="broker-add-lead-title">Add an inquiry</h2><p>Record a name and any details shared by the prospect.</p></div><Plus aria-hidden="true" /></div>
        <form className="broker-form" onSubmit={create}><div><Label htmlFor="broker-lead-name">Name</Label><Input id="broker-lead-name" required maxLength={120} value={name} onChange={event => setName(event.target.value)} /></div>
          <div><Label htmlFor="broker-lead-email">Email (optional)</Label><Input id="broker-lead-email" type="email" value={email} onChange={event => setEmail(event.target.value)} /></div>
          <div><Label htmlFor="broker-lead-phone">Phone (optional)</Label><Input id="broker-lead-phone" type="tel" value={phone} onChange={event => setPhone(event.target.value)} /></div>
          <Button type="submit" disabled={creating}>{creating ? "Saving…" : "Add lead"}</Button></form>
        {formError && <p role="alert" className="broker-error">{formError}</p>}{notice && <p role="status" className="broker-notice">{notice}</p>}
        <p className="broker-help">Stage changes are your organization’s records. No email, call, customer conversion or official application update happens here. Add a customer separately once you have a real project.</p></section></div></>;
}

export function BrokerWorkspace({ section }: { section: BrokerSection }) {
  const { status, profile } = useAuth();
  const { role } = useWorkspaceRole();
  if (status === "loading") return <Waiting>Checking your broker account…</Waiting>;
  if (status === "signedIn" && profile?.role === "BROKER") return <BrokerConnected key={`${profile.userId}:${profile.organizationId ?? ""}`} section={section} />;
  if (status === "signedIn" || status === "unconfigured" && role !== "BROKER") return <section className="broker-access" aria-labelledby="broker-access-title"><ShieldCheck aria-hidden="true" /><h1 id="broker-access-title">Broker account required</h1><p>Customer and organization records are available only to a verified broker account.</p><Button asChild variant="outline"><Link href="/app">Back to workspace</Link></Button></section>;
  return <section className="broker-access" aria-labelledby="broker-connect-title"><Search aria-hidden="true" /><h1 id="broker-connect-title">Explore the consultant workspace</h1>
    <p>{status === "unconfigured" ? "Account sign-in is not configured in this deployment. The preview below uses fictional records only." : "Sign in with a broker account to load organization records."}</p>
    <div><Button asChild><Link href={status === "unconfigured" ? "/demo/broker" : "/auth/sign-in"}>{status === "unconfigured" ? "Open fictional demo" : "Sign in"}</Link></Button>
      <Button asChild variant="outline"><Link href="/demo/broker">View fictional demo</Link></Button></div></section>;
}
