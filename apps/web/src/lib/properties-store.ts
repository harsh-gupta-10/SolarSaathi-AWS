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
  consumerNumber?: string;
  createdAt: string;
  updatedAt: string;
  // Associated roof analysis
  analysisId?: string;
  roofAreaSquareMeters?: number;
  segmentCount?: number;
  recommendedSystemKw?: number;
  source?: "GOOGLE_SOLAR" | "MANUAL" | "SAMPLE";
  estimatedSubsidyRupees?: number;
  estimatedNetCostRupees?: number;
  paybackYears?: number;
}

const STORAGE_PREFIX = "solarsaathi.properties.v1";

export const SAMPLE_PROPERTIES: StoredProperty[] = [
  {
    propertyId: "prop-sample-mumbai-01",
    label: "Bandra West Bungalow (Primary Residence)",
    address: "Plot 14, Linking Road, Bandra West, Mumbai, Maharashtra 400050",
    city: "Mumbai",
    state: "MH",
    pincode: "400050",
    propertyType: "RESIDENTIAL_BUNGALOW",
    monthlyBillRupees: 4500,
    monthlyConsumptionKwh: 350,
    sanctionedLoadKw: 5,
    consumerNumber: "028659102431",
    createdAt: "2026-10-08T09:00:00.000Z",
    updatedAt: "2026-10-09T14:30:00.000Z",
    analysisId: "analysis-sample-mumbai",
    roofAreaSquareMeters: 120.0,
    segmentCount: 4,
    recommendedSystemKw: 3.0,
    source: "SAMPLE",
    estimatedSubsidyRupees: 78000,
    estimatedNetCostRupees: 102000,
    paybackYears: 3.8,
  },
  {
    propertyId: "prop-sample-pune-02",
    label: "Kothrud Villa (Ancestral Home)",
    address: "12/A Mayur Colony, Kothrud, Pune, Maharashtra 411038",
    city: "Pune",
    state: "MH",
    pincode: "411038",
    propertyType: "ROW_HOUSE",
    monthlyBillRupees: 7200,
    monthlyConsumptionKwh: 580,
    sanctionedLoadKw: 7,
    consumerNumber: "015482937105",
    createdAt: "2026-10-08T11:00:00.000Z",
    updatedAt: "2026-10-09T16:00:00.000Z",
    analysisId: "analysis-sample-pune",
    roofAreaSquareMeters: 165.0,
    segmentCount: 2,
    recommendedSystemKw: 5.0,
    source: "SAMPLE",
    estimatedSubsidyRupees: 78000,
    estimatedNetCostRupees: 172000,
    paybackYears: 4.2,
  },
];

function storageKey(userId?: string): string {
  return `${STORAGE_PREFIX}.${userId || "default"}`;
}

export function getStoredProperties(userId?: string): StoredProperty[] {
  if (typeof window === "undefined") return [];
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
  if (typeof window === "undefined") return [property];
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
  if (typeof window === "undefined") return [];
  try {
    const current = getStoredProperties(userId);
    const filtered = current.filter(item => item.propertyId !== propertyId);
    localStorage.setItem(storageKey(userId), JSON.stringify(filtered));
    return filtered;
  } catch {
    return [];
  }
}

export function getStoredProperty(propertyId: string, userId?: string): StoredProperty | undefined {
  const list = getStoredProperties(userId);
  return list.find(item => item.propertyId === propertyId);
}

export function seedSampleProperties(userId?: string): StoredProperty[] {
  if (typeof window === "undefined") return SAMPLE_PROPERTIES;
  try {
    const current = getStoredProperties(userId);
    const map = new Map<string, StoredProperty>();
    for (const sample of SAMPLE_PROPERTIES) map.set(sample.propertyId, sample);
    for (const existing of current) map.set(existing.propertyId, existing);
    const combined = Array.from(map.values());
    localStorage.setItem(storageKey(userId), JSON.stringify(combined));
    return combined;
  } catch {
    return SAMPLE_PROPERTIES;
  }
}

export function ensureDefaultProperties(userId?: string): StoredProperty[] {
  const existing = getStoredProperties(userId);
  if (existing.length > 0) return existing;
  return seedSampleProperties(userId);
}

export function syncBackendProperties(
  backendList: Array<{ propertyId: string; label?: string; address: string }>,
  userId?: string
): StoredProperty[] {
  if (typeof window === "undefined") return [];
  const current = getStoredProperties(userId);
  const currentMap = new Map(current.map(item => [item.propertyId, item]));
  let changed = false;

  for (const b of backendList) {
    if (!currentMap.has(b.propertyId)) {
      currentMap.set(b.propertyId, {
        propertyId: b.propertyId,
        label: b.label || "Rooftop solar property",
        address: b.address,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      changed = true;
    }
  }

  const updatedList = Array.from(currentMap.values());
  if (changed && typeof window !== "undefined") {
    try {
      localStorage.setItem(storageKey(userId), JSON.stringify(updatedList));
    } catch {
      // ignore storage errors
    }
  }
  return updatedList;
}
