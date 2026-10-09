import type { AccessoryCategory } from "./schema";

export interface CatalogEntry {
  id: string;
  title: string;
  category: AccessoryCategory;
  safetyNotes: readonly string[];
}

// This catalog is a taxonomy of equipment and professional checks, not a product or price catalog.
export const ACCESSORY_CATALOG_V1: readonly CatalogEntry[] = [
  { id: "earthing-review", title: "Earthing and bonding review", category: "ELECTRICAL_SAFETY",
    safetyNotes: ["A qualified electrical professional must assess the site and applicable standards."] },
  { id: "isolation-review", title: "DC and AC isolation review", category: "ELECTRICAL_SAFETY",
    safetyNotes: ["Device ratings and placement require an installer design; do not perform DIY electrical work."] },
  { id: "surge-protection", title: "Surge protection review", category: "ELECTRICAL_SAFETY",
    safetyNotes: ["Protection type and ratings depend on the inverter, wiring and site exposure."] },
  { id: "cable-management", title: "Cable routing and protection", category: "ELECTRICAL_SAFETY",
    safetyNotes: ["Preserve roof drainage, fire access and maintenance paths in the installer layout."] },
  { id: "lightning-review", title: "Lightning risk review", category: "ELECTRICAL_SAFETY",
    safetyNotes: ["A reported exposure is not a lightning assessment or equipment specification."] },
  { id: "inverter-monitoring", title: "Inverter production monitoring", category: "MONITORING",
    safetyNotes: ["Confirm compatibility and data access with the selected inverter."] },
  { id: "consumption-monitoring", title: "Consumption monitoring", category: "MONITORING",
    safetyNotes: ["Any meter or current sensor must be selected and installed by a qualified professional."] },
  { id: "battery-storage", title: "Battery backup system", category: "BACKUP",
    safetyNotes: ["Battery chemistry, ventilation, placement and inverter compatibility need a professional design."] },
  { id: "essential-loads", title: "Essential-loads backup circuit", category: "BACKUP",
    safetyNotes: ["A qualified electrician must design circuit separation and protection."] },
  { id: "ev-charger", title: "EV charging equipment", category: "EV",
    safetyNotes: ["Check sanctioned load, connection, wiring and local electrical requirements before selecting a charger."] },
  { id: "ev-load-management", title: "EV charging load management", category: "EV",
    safetyNotes: ["An installer must validate available capacity and compatible control equipment."] },
  { id: "cleaning-access", title: "Safe cleaning access plan", category: "MAINTENANCE",
    safetyNotes: ["Avoid unsafe roof access and live electrical equipment; use trained maintenance support when needed."] },
  { id: "bird-mitigation", title: "Bird and pest mitigation", category: "MAINTENANCE",
    safetyNotes: ["Any mitigation must preserve panel ventilation, drainage and service access."] },
];
