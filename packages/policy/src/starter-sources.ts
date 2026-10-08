import type { PolicySourceType } from "./schema";
import { validateOfficialSourceUrl } from "./sources";

export interface StarterPolicySourceIntentV1 {
  name: string;
  publisherName: string;
  jurisdiction: string;
  sourceType: PolicySourceType;
  canonicalUrl: string;
  crawlFrequency: "DAILY" | "WEEKLY" | "MONTHLY" | "ON_DEMAND";
  freshnessWindowHours: number;
  registryStatus: "PROPOSED";
  enabled: false;
  /** Host verification is not document or policy-fact verification. */
  hostVerifiedAt: "2026-10-08";
}

/** Discovery-only official starting points; no amounts, eligibility or active policy facts. */
export const STARTER_POLICY_SOURCE_INTENTS_V1: readonly StarterPolicySourceIntentV1[] = Object.freeze([
  { name: "MNRE Grid Connected Rooftop Solar Programme", publisherName: "Ministry of New and Renewable Energy",
    jurisdiction: "IN", sourceType: "MNRE", canonicalUrl: "https://mnre.gov.in/en/grid-connected-solar-rooftop-programme/",
    crawlFrequency: "DAILY", freshnessWindowHours: 48, registryStatus: "PROPOSED", enabled: false,
    hostVerifiedAt: "2026-10-08" },
  { name: "National Rooftop Solar Portal", publisherName: "PM Surya Ghar / MNRE",
    jurisdiction: "IN", sourceType: "SCHEME_PORTAL", canonicalUrl: "https://solarrooftop.pmsuryaghar.gov.in/",
    crawlFrequency: "DAILY", freshnessWindowHours: 48, registryStatus: "PROPOSED", enabled: false,
    hostVerifiedAt: "2026-10-08" },
  { name: "Maharashtra Energy Department PM Surya Ghar page", publisherName: "Maharashtra Energy Department",
    jurisdiction: "IN-MH", sourceType: "STATE_ENERGY_DEPARTMENT",
    canonicalUrl: "https://energy.maharashtra.gov.in/en/scheme/pm-surya-ghar-yojana/",
    crawlFrequency: "DAILY", freshnessWindowHours: 48, registryStatus: "PROPOSED", enabled: false,
    hostVerifiedAt: "2026-10-08" },
  { name: "MSEDCL I-SMART rooftop solar portal", publisherName: "Maharashtra State Electricity Distribution Co. Ltd.",
    jurisdiction: "IN-MH", sourceType: "DISCOM", canonicalUrl: "https://portal.mahadiscom.in/ismart/",
    crawlFrequency: "DAILY", freshnessWindowHours: 48, registryStatus: "PROPOSED", enabled: false,
    hostVerifiedAt: "2026-10-08" },
  { name: "MERC current renewable-energy regulations", publisherName: "Maharashtra Electricity Regulatory Commission",
    jurisdiction: "IN-MH", sourceType: "REGULATOR",
    canonicalUrl: "https://new.merc.gov.in/regulation_type/current-regulations-renewable-energy/",
    crawlFrequency: "DAILY", freshnessWindowHours: 48, registryStatus: "PROPOSED", enabled: false,
    hostVerifiedAt: "2026-10-08" },
  { name: "MEDA solar state policy documents", publisherName: "Maharashtra Energy Development Agency",
    jurisdiction: "IN-MH", sourceType: "RENEWABLE_AGENCY",
    canonicalUrl: "https://www.mahaurja.maharashtra.gov.in/Site/1578/Solar%20State%20Policy",
    crawlFrequency: "DAILY", freshnessWindowHours: 48, registryStatus: "PROPOSED", enabled: false,
    hostVerifiedAt: "2026-10-08" },
]);

/** Revalidate the fixed host binding before an operator seeds any source record. */
export function verifiedStarterSourceIntentsV1(): StarterPolicySourceIntentV1[] {
  return STARTER_POLICY_SOURCE_INTENTS_V1.map(intent => {
    const verified = validateOfficialSourceUrl(intent.canonicalUrl, intent.sourceType, intent.jurisdiction);
    return { ...intent, canonicalUrl: verified.canonicalUrl };
  });
}
