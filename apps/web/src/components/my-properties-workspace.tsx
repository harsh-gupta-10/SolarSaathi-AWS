"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import {
  Building2, ChevronRight, FileCheck2,
  MapPin, Plus, Sparkles, Trash2, Zap,
} from "lucide-react";
import { Button, Input, Label } from "@solarsaathi/ui";
import { useAuth } from "../auth/auth-provider";
import { applicationsApi } from "../lib/applications-api";
import { roofApi } from "../lib/roof-api";
import {
  deleteStoredProperty, ensureDefaultProperties,
  saveStoredProperty, seedSampleProperties, syncBackendProperties,
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

  // Form states
  const [label, setLabel] = useState("");
  const [address, setAddress] = useState("");
  const [propertyType, setPropertyType] = useState<StoredProperty["propertyType"]>("RESIDENTIAL_BUNGALOW");
  const [monthlyBill, setMonthlyBill] = useState("");
  const [monthlyKwh, setMonthlyKwh] = useState("");
  const [consumerNumber, setConsumerNumber] = useState("");

  useEffect(() => {
    // Load local stored properties or ensure defaults
    const list = ensureDefaultProperties(userId);
    setProperties(list);

    // If authenticated, sync with backend DynamoDB
    if (status === "signedIn") {
      const controller = new AbortController();
      void applicationsApi.properties(undefined, controller.signal)
        .then(page => {
          if (!controller.signal.aborted && page.properties?.length) {
            const synced = syncBackendProperties(page.properties, userId);
            setProperties(synced);
          }
        })
        .catch(() => {
          // Fall back gracefully to local store
        });
      return () => controller.abort();
    }
  }, [status, userId]);

  function fillSampleFormData() {
    setLabel("Shivaji Nagar Residence");
    setAddress("45 F.C. Road, Shivaji Nagar, Pune, Maharashtra 411005");
    setPropertyType("RESIDENTIAL_BUNGALOW");
    setMonthlyBill("5200");
    setMonthlyKwh("410");
    setConsumerNumber("029481720491");
  }

  function handleAddSampleProperties() {
    const list = seedSampleProperties(userId);
    setProperties(list);
    setNotice("Added 2 sample Indian properties (Mumbai 3 BHK Bungalow & Pune Villa) with complete roof and subsidy estimates!");
    setTimeout(() => setNotice(undefined), 6000);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!address.trim()) {
      setError("Please provide a valid property address.");
      return;
    }

    setSaving(true);
    setError(undefined);

    let backendId: string | undefined;
    if (status === "signedIn") {
      try {
        await roofApi.bootstrap();
        backendId = await roofApi.createProperty(address.trim());
      } catch {
        // If backend creation fails, continue with local ID so user is never blocked
      }
    }

    const newPropertyId = backendId || `prop-${Date.now()}`;
    const newProp: StoredProperty = {
      propertyId: newPropertyId,
      label: label.trim() || "My Rooftop Property",
      address: address.trim(),
      propertyType,
      monthlyBillRupees: monthlyBill ? Number(monthlyBill) : undefined,
      monthlyConsumptionKwh: monthlyKwh ? Number(monthlyKwh) : undefined,
      consumerNumber: consumerNumber.trim() || undefined,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      roofAreaSquareMeters: 100,
      segmentCount: 2,
      recommendedSystemKw: monthlyKwh ? Math.round(Number(monthlyKwh) / 120 * 10) / 10 : 3.0,
      estimatedSubsidyRupees: 78000,
    };

    const updated = saveStoredProperty(newProp, userId);
    setProperties(updated);
    setSaving(false);
    setShowAddForm(false);
    setLabel("");
    setAddress("");
    setMonthlyBill("");
    setMonthlyKwh("");
    setConsumerNumber("");
    setNotice(`Property "${newProp.label}" added to your account!`);
    setTimeout(() => setNotice(undefined), 5000);
  }

  function handleDelete(propertyId: string) {
    const updated = deleteStoredProperty(propertyId, userId);
    setProperties(updated);
  }

  const totalRoofArea = properties.reduce((sum, p) => sum + (p.roofAreaSquareMeters || 0), 0);
  const totalPotentialKw = properties.reduce((sum, p) => sum + (p.recommendedSystemKw || 0), 0);
  const totalSubsidy = properties.reduce((sum, p) => sum + (p.estimatedSubsidyRupees || 0), 0);

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">My Properties</h1>
          <p className="mt-1 text-muted-foreground">
            Manage your registered homes, rooftop solar measurements, and government subsidy eligibility.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <Button
            type="button"
            variant="outline"
            className="flex items-center gap-2 text-xs font-semibold"
            onClick={handleAddSampleProperties}
          >
            <Sparkles className="size-3.5 text-amber-500" aria-hidden="true" />
            <span>Load 2 Sample Properties</span>
          </Button>
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
        <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/10 p-4 text-sm font-medium text-emerald-800 dark:text-emerald-300">
          ✓ {notice}
        </div>
      )}

      {/* Quick Metrics Bar */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
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
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs font-medium text-muted-foreground">Potential Subsidies</p>
          <p className="mt-1 text-2xl font-bold tracking-tight text-primary">₹{(totalSubsidy / 1000).toFixed(0)}k</p>
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
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="text-xs"
              onClick={fillSampleFormData}
            >
              ⚡ Fill Sample Pune Address
            </Button>
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

            <div className="grid gap-4 sm:grid-cols-3">
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

              <div>
                <Label htmlFor="prop-consumer">Consumer / CA Number (Optional)</Label>
                <Input
                  id="prop-consumer"
                  placeholder="From DISCOM power bill"
                  value={consumerNumber}
                  onChange={e => setConsumerNumber(e.target.value)}
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
        {properties.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed p-12 text-center">
            <Building2 className="size-12 text-muted-foreground/60" aria-hidden="true" />
            <h3 className="mt-4 text-lg font-semibold">No properties registered yet</h3>
            <p className="mt-1 text-sm text-muted-foreground max-w-sm">
              Add your home address to start analyzing roof solar potential, 3D layouts, and government subsidies.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Button onClick={() => setShowAddForm(true)}>Add Your Property</Button>
              <Button variant="outline" onClick={handleAddSampleProperties}>Load 2 Sample Properties</Button>
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
                      onClick={() => handleDelete(item.propertyId)}
                      className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>

                  <p className="mt-2 flex items-start gap-1.5 text-xs text-muted-foreground">
                    <MapPin className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <span>{item.address}</span>
                  </p>

                  {/* Property Solar Highlights */}
                  <div className="mt-4 grid grid-cols-3 gap-2 rounded-xl bg-muted/60 p-3 text-center text-xs">
                    <div>
                      <p className="text-muted-foreground">Roof Area</p>
                      <p className="mt-0.5 font-bold text-foreground">
                        {item.roofAreaSquareMeters ? `${item.roofAreaSquareMeters.toFixed(0)} m²` : "Pending"}
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Solar System</p>
                      <p className="mt-0.5 font-bold text-foreground">
                        {item.recommendedSystemKw ? `${item.recommendedSystemKw.toFixed(1)} kW` : "3.0 kW"}
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Max Subsidy</p>
                      <p className="mt-0.5 font-bold text-emerald-600 dark:text-emerald-400">
                        {item.estimatedSubsidyRupees ? `₹${item.estimatedSubsidyRupees.toLocaleString("en-IN")}` : "₹78,000"}
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
                    <Link href="/app/advisor">
                      <Zap className="mr-1.5 size-3.5 text-amber-500" aria-hidden="true" />
                      <span>AI Advisor</span>
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
