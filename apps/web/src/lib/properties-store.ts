export interface StoredProperty {
  propertyId: string;
  label: string;
  address: string;
  propertyType?: "RESIDENTIAL_BUNGALOW" | "ROW_HOUSE" | "APARTMENT_PENTHOUSE" | "COMMERCIAL";
  city?: string;
  state?: string;
  pincode?: string;
  monthlyBillRupees?: number;
  monthlyConsumptionKwh?: number;
  sanctionedLoadKw?: number;
  createdAt: string;
  updatedAt: string;
  // Associated roof analysis
  analysisId?: string;
  roofAreaSquareMeters?: number;
  segmentCount?: number;
  recommendedSystemKw?: number;
  source?: "GOOGLE_SOLAR" | "MANUAL";
}

const STORAGE_PREFIX = "solarsaathi.properties.v1";

// Property records hold addresses, so they are only kept for a signed-in user and are cleared on sign-out.
function storageKey(userId: string): string {
  return `${STORAGE_PREFIX}.${userId}`;
}

export function clearStoredProperties(): void {
  if (typeof window === "undefined") return;
  try {
    // Analysis form drafts (lib/analysis-draft.tsx) hold personal answers too and go with the property cache.
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith(`${STORAGE_PREFIX}.`) || key.startsWith("solarsaathi.draft.v1.")) localStorage.removeItem(key);
    }
  } catch { /* storage unavailable */ }
}

export function getStoredProperties(userId?: string): StoredProperty[] {
  if (typeof window === "undefined" || !userId) return [];
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveStoredProperty(property: StoredProperty, userId?: string): StoredProperty[] {
  if (typeof window === "undefined" || !userId) return [property];
  try {
    const current = getStoredProperties(userId);
    const existingIndex = current.findIndex(item => item.propertyId === property.propertyId);
    let updated: StoredProperty[];
    if (existingIndex >= 0) {
      updated = [...current];
      updated[existingIndex] = { ...updated[existingIndex], ...property, updatedAt: new Date().toISOString() };
    } else {
      updated = [{ ...property, updatedAt: new Date().toISOString() }, ...current];
    }
    localStorage.setItem(storageKey(userId), JSON.stringify(updated));
    return updated;
  } catch {
    return [property];
  }
}

export function deleteStoredProperty(propertyId: string, userId?: string): StoredProperty[] {
  if (typeof window === "undefined" || !userId) return [];
  try {
    const filtered = getStoredProperties(userId).filter(item => item.propertyId !== propertyId);
    localStorage.setItem(storageKey(userId), JSON.stringify(filtered));
    return filtered;
  } catch {
    return [];
  }
}

export function getStoredProperty(propertyId: string, userId?: string): StoredProperty | undefined {
  return getStoredProperties(userId).find(item => item.propertyId === propertyId);
}

/**
 * Merges the backend's complete property list into the cached one. The backend is the source of truth: cached
 * properties it no longer returns (for example deleted elsewhere) are dropped.
 */
export function syncBackendProperties(
  backendList: Array<{ propertyId: string; label?: string; address: string }>,
  userId?: string
): StoredProperty[] {
  if (typeof window === "undefined" || !userId) return [];
  const cached = new Map(getStoredProperties(userId).map(item => [item.propertyId, item]));
  const now = new Date().toISOString();
  const merged = backendList.map(item => {
    const previous = cached.get(item.propertyId);
    return { ...previous, propertyId: item.propertyId, label: item.label || previous?.label || "Rooftop solar property",
      address: item.address, createdAt: previous?.createdAt ?? now, updatedAt: previous?.updatedAt ?? now };
  });
  try { localStorage.setItem(storageKey(userId), JSON.stringify(merged)); } catch { /* storage unavailable */ }
  return merged;
}
