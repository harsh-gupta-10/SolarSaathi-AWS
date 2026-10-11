"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import {
  Building2, ChevronRight, FileCheck2,
  MapPin, Plus, Trash2, Zap,
} from "lucide-react";
import { Button, Input, Label } from "@solarsaathi/ui";
import { signInHref } from "../lib/return-to";
import { useAuth } from "../auth/auth-provider";
import { applicationsApi } from "../lib/applications-api";
import { roofApi, RoofRequestError } from "../lib/roof-api";
import {
  deleteStoredProperty, getStoredProperties,
  saveStoredProperty, syncBackendProperties,
  type StoredProperty,
} from "../lib/properties-store";

export function MyPropertiesWorkspace() {
  const { status, profile } = useAuth();
  const userId = status === "signedIn" ? profile?.userId : undefined;

  const [properties, setProperties] = useState<StoredProperty[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();
  const [deleteError, setDeleteError] = useState<string>();
  const [deletingId, setDeletingId] = useState<string>();
  const [syncError, setSyncError] = useState<string>();
  const [loadingList, setLoadingList] = useState(false);
  const noticeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(noticeTimer.current), []);
  function showNotice(message: string) {
    clearTimeout(noticeTimer.current);
    setNotice(message);
    noticeTimer.current = setTimeout(() => setNotice(undefined), 6000);
  }

  // Form states
  const [label, setLabel] = useState("");
  const [address, setAddress] = useState("");
  const [propertyType, setPropertyType] = useState<StoredProperty["propertyType"]>("RESIDENTIAL_BUNGALOW");
  const [monthlyBill, setMonthlyBill] = useState("");
  const [monthlyKwh, setMonthlyKwh] = useState("");

  useEffect(() => {
    // The backend is the source of truth. Cached analysis details are shown only until it answers.
    setSyncError(undefined);
    if (status !== "signedIn" || !userId) { setProperties([]); return; }
    setProperties(getStoredProperties(userId));
    const controller = new AbortController();
    setLoadingList(true);
    void (async () => {
      const all: Array<{ propertyId: string; label?: string; address: string }> = [];
      let cursor: string | undefined;
      for (let pages = 0; pages < 20; pages++) {
        const page = await applicationsApi.properties(cursor, controller.signal);
        all.push(...page.properties);
        cursor = page.nextCursor;
        if (!cursor) break;
      }
      // Never prune the cache from a truncated list.
      if (!controller.signal.aborted && !cursor) setProperties(syncBackendProperties(all, userId));
    })().catch(() => {
      if (!controller.signal.aborted) setSyncError("Your saved properties could not be refreshed. Showing the last known list.");
    }).finally(() => { if (!controller.signal.aborted) setLoadingList(false); });
    return () => controller.abort();
  }, [status, userId]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!address.trim()) {
      setError("Please provide a valid property address.");
      return;
    }

    setSaving(true);
    setError(undefined);

    let newPropertyId: string;
    try {
      await roofApi.bootstrap();
      newPropertyId = await roofApi.createProperty(address.trim());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The property could not be saved to your account. Try again.");
      setSaving(false);
      return;
    }
    const newProp: StoredProperty = {
      propertyId: newPropertyId,
      label: label.trim() || "My Rooftop Property",
      address: address.trim(),
      propertyType,
      monthlyBillRupees: monthlyBill ? Number(monthlyBill) : undefined,
      monthlyConsumptionKwh: monthlyKwh ? Number(monthlyKwh) : undefined,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const updated = saveStoredProperty(newProp, userId);
    setProperties(updated);
    setSaving(false);
    setShowAddForm(false);
    setLabel("");
    setAddress("");
    setMonthlyBill("");
    setMonthlyKwh("");
    showNotice(`Property "${newProp.label}" saved to your account.`);
  }

  async function handleDelete(item: StoredProperty) {
    if (!window.confirm(`Delete "${item.label}" and its saved roof analyses? This cannot be undone.`)) return;
    setDeleteError(undefined);
    setDeletingId(item.propertyId);
    try {
      await roofApi.deleteProperty(item.propertyId);
    } catch (cause) {
      // Already gone on the server: still remove the stale local copy.
      if (!(cause instanceof RoofRequestError && cause.code === "NOT_FOUND")) {
        setDeleteError(cause instanceof Error ? cause.message : "The property could not be deleted. Try again.");
        setDeletingId(undefined);
        return;
      }
    }
    setDeletingId(undefined);
    setProperties(deleteStoredProperty(item.propertyId, userId));
  }

  const totalRoofArea = properties.reduce((sum, p) => sum + (p.roofAreaSquareMeters || 0), 0);
  const totalPotentialKw = properties.reduce((sum, p) => sum + (p.recommendedSystemKw || 0), 0);

  if (status === "loading") {
    return <p role="status" aria-live="polite">Checking your session…</p>;
  }
  if (status !== "signedIn") {
    return (
      <div className="flex flex-col items-center rounded-2xl border border-dashed p-12 text-center">
        <Building2 className="size-12 text-muted-foreground/60" aria-hidden="true" />
        <h1 className="mt-4 text-2xl font-bold">Sign in to manage your properties</h1>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
          Properties are saved to your account, not to this browser. Sign in to add a home and analyze its roof.
        </p>
        <Button asChild className="mt-6"><Link href={signInHref("/app/properties")}>Sign in</Link></Button>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">My Properties</h1>
          <p className="mt-1 text-muted-foreground">
            Manage your registered homes and their rooftop solar analysis. Subsidy eligibility is checked per property from verified policy rules.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <Button
            type="button"
            className="flex items-center gap-2 font-semibold shadow-sm"
            onClick={() => setShowAddForm(prev => !prev)}
          >
            <Plus className="size-4" aria-hidden="true" />
            <span>{showAddForm ? "Close Form" : "Add Property"}</span>
          </Button>
        </div>
      </div>

      {notice && (
        <div role="status" className="rounded-xl border border-emerald-500/25 bg-emerald-500/10 p-4 text-sm font-medium text-emerald-800 dark:text-emerald-300">
          {notice}
        </div>
      )}

      {syncError && <p role="status" className="text-sm text-muted-foreground">{syncError}</p>}
      {loadingList && properties.length === 0 && <p role="status" aria-live="polite">Loading your properties…</p>}

      {deleteError && (
        <div role="alert" className="rounded-xl border border-destructive/25 bg-destructive/10 p-4 text-sm font-medium text-destructive">
          {deleteError}
        </div>
      )}

      {/* Quick Metrics Bar */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs font-medium text-muted-foreground">Properties Saved</p>
          <p className="mt-1 text-2xl font-bold tracking-tight text-foreground">{properties.length}</p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs font-medium text-muted-foreground">Confirmed Roof Area</p>
          <p className="mt-1 text-2xl font-bold tracking-tight text-foreground">{totalRoofArea.toFixed(0)} m²</p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs font-medium text-muted-foreground">Solar Capacity Fit</p>
          <p className="mt-1 text-2xl font-bold tracking-tight text-foreground">{totalPotentialKw.toFixed(1)} kW</p>
        </div>
      </div>

      {/* Add Property Form / Drawer */}
      {showAddForm && (
        <section className="rounded-2xl border-2 border-primary/20 bg-card p-6 shadow-md" aria-labelledby="add-property-title">
          <div className="flex items-center justify-between border-b pb-4">
            <div>
              <h2 id="add-property-title" className="text-xl font-bold">Add a New Property</h2>
              <p className="text-xs text-muted-foreground">Enter property address and consumer details to plan your rooftop solar.</p>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="mt-5 space-y-4">
            {error && <p className="text-sm font-medium text-destructive">{error}</p>}

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="prop-label">Property Name / Label</Label>
                <Input
                  id="prop-label"
                  placeholder="e.g. Bandra Bungalow or Ancestral Home"
                  value={label}
                  onChange={e => setLabel(e.target.value)}
                />
              </div>

              <div>
                <Label htmlFor="prop-type">Property Type</Label>
                <select
                  id="prop-type"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={propertyType}
                  onChange={e => setPropertyType(e.target.value as StoredProperty["propertyType"])}
                >
                  <option value="RESIDENTIAL_BUNGALOW">Residential Individual House / Bungalow</option>
                  <option value="ROW_HOUSE">Row House / Villa</option>
                  <option value="APARTMENT_PENTHOUSE">Apartment Rooftop / Penthouse</option>
                  <option value="COMMERCIAL">Commercial / Institutional Building</option>
                </select>
              </div>
            </div>

            <div>
              <Label htmlFor="prop-address">Property Address</Label>
              <Input
                id="prop-address"
                required
                placeholder="Full address (e.g. Plot 14, Linking Road, Bandra West, Mumbai 400050)"
                value={address}
                onChange={e => setAddress(e.target.value)}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="prop-bill">Avg. Monthly Electricity Bill (₹)</Label>
                <Input
                  id="prop-bill"
                  type="number"
                  placeholder="e.g. 4500"
                  value={monthlyBill}
                  onChange={e => setMonthlyBill(e.target.value)}
                />
              </div>

              <div>
                <Label htmlFor="prop-kwh">Avg. Monthly Units (kWh)</Label>
                <Input
                  id="prop-kwh"
                  type="number"
                  placeholder="e.g. 350"
                  value={monthlyKwh}
                  onChange={e => setMonthlyKwh(e.target.value)}
                />
              </div>

            </div>

            <div className="flex items-center justify-end gap-3 pt-3">
              <Button type="button" variant="ghost" onClick={() => setShowAddForm(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? "Saving Property…" : "Save Property to Account"}
              </Button>
            </div>
          </form>
        </section>
      )}

      {/* Properties List */}
      <div className="space-y-4">
        {properties.length === 0 && !loadingList ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed p-12 text-center">
            <Building2 className="size-12 text-muted-foreground/60" aria-hidden="true" />
            <h3 className="mt-4 text-lg font-semibold">No properties registered yet</h3>
            <p className="mt-1 text-sm text-muted-foreground max-w-sm">
              Add your home address to start analyzing roof solar potential, 3D layouts, and government subsidies.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Button onClick={() => setShowAddForm(true)}>Add Your Property</Button>
            </div>
          </div>
        ) : (
          <div className="grid gap-5 md:grid-cols-2">
            {properties.map(item => (
              <div
                key={item.propertyId}
                className="group relative flex flex-col justify-between rounded-2xl border bg-card p-6 shadow-sm transition hover:shadow-md hover:border-primary/40"
              >
                <div>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <span className="inline-flex items-center rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">
                        {item.propertyType ? item.propertyType.replace(/_/g, " ") : "Residential"}
                      </span>
                      <h3 className="mt-2 text-xl font-bold tracking-tight text-foreground">{item.label}</h3>
                    </div>
                    <button
                      type="button"
                      aria-label={`Delete ${item.label}`}
                      disabled={deletingId === item.propertyId}
                      onClick={() => void handleDelete(item)}
                      className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition disabled:opacity-50"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>

                  <p className="mt-2 flex items-start gap-1.5 text-xs text-muted-foreground">
                    <MapPin className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <span>{item.address}</span>
                  </p>

                  {/* Property Solar Highlights */}
                  <div className="mt-4 grid grid-cols-2 gap-2 rounded-xl bg-muted/60 p-3 text-center text-xs">
                    <div>
                      <p className="text-muted-foreground">Roof Area</p>
                      <p className="mt-0.5 font-bold text-foreground">
                        {item.roofAreaSquareMeters ? `${item.roofAreaSquareMeters.toFixed(0)} m²` : "Not measured yet"}
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Solar System</p>
                      <p className="mt-0.5 font-bold text-foreground">
                        {item.recommendedSystemKw ? `${item.recommendedSystemKw.toFixed(1)} kW` : "Not designed yet"}
                      </p>
                    </div>
                  </div>

                  {item.monthlyBillRupees && (
                    <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                      <span>Monthly Bill: <strong>₹{item.monthlyBillRupees.toLocaleString("en-IN")}</strong></span>
                      {item.monthlyConsumptionKwh && <span>Usage: <strong>{item.monthlyConsumptionKwh} kWh/mo</strong></span>}
                    </div>
                  )}
                </div>

                {/* Property Action Footer */}
                <div className="mt-6 flex flex-wrap items-center gap-2 border-t pt-4">
                  <Button asChild size="sm" className="gap-1 font-semibold">
                    <Link href={`/app/analyze?propertyId=${encodeURIComponent(item.propertyId)}`}>
                      <span>Analyze Roof</span>
                      <ChevronRight className="size-3.5" aria-hidden="true" />
                    </Link>
                  </Button>
                  <Button asChild variant="outline" size="sm">
                    <Link href="/app/benefits">
                      <FileCheck2 className="mr-1.5 size-3.5" aria-hidden="true" />
                      <span>Subsidies</span>
                    </Link>
                  </Button>
                  <Button asChild variant="ghost" size="sm">
                    <Link href={`/app?propertyId=${encodeURIComponent(item.propertyId)}`}>
                      <Zap className="mr-1.5 size-3.5 text-amber-500" aria-hidden="true" />
                      <span>Ask SolarSaathi</span>
                    </Link>
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
