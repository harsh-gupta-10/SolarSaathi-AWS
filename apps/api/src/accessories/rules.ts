import { ACCESSORY_CATALOG_V1, type CatalogEntry } from "./catalog";
import type { AccessoryCompatibility, AccessoryClassification, AccessoryRecommendationRequest,
  AccessoryRecommendationV1 } from "./schema";

interface Decision {
  classification: AccessoryClassification;
  compatibility: AccessoryCompatibility;
  score: number;
  reason: string;
}

const policyRelevance = {
  status: "NOT_EVALUATED" as const,
  note: "No verified accessory-specific policy requirement was evaluated. Check current local electrical and utility rules with a qualified installer.",
};
const costRange = {
  status: "UNAVAILABLE" as const, currency: "INR" as const,
  note: "No sourced, current price range is available for this equipment or installation.",
};

function decide(item: CatalogEntry, input: AccessoryRecommendationRequest): Decision {
  const backup = input.goals?.backupPower === true;
  const monitoring = input.goals?.monitoring === true;
  const ev = input.goals?.evCharging === true || input.evStatus === "PLANNING" || input.evStatus === "OWNS_EV";
  const maintenance = input.goals?.easierMaintenance === true;
  switch (item.id) {
    case "earthing-review":
      return { classification: "STRONGLY_RECOMMENDED", compatibility: "REQUIRES_REVIEW", score: 88,
        reason: "Ask the installer to verify the earthing and bonding design for the selected solar system." };
    case "isolation-review":
      return { classification: "STRONGLY_RECOMMENDED", compatibility: "REQUIRES_REVIEW", score: 86,
        reason: "Ask the installer to verify appropriate DC and AC isolation and protective-device design." };
    case "surge-protection":
      return { classification: "RECOMMENDED", compatibility: "REQUIRES_REVIEW", score: input.site?.lightningExposure === "REPORTED_HIGH" ? 84 : 73,
        reason: "Review surge protection with the installer; equipment choice depends on the site's electrical design and exposure." };
    case "cable-management":
      return { classification: "RECOMMENDED", compatibility: "REQUIRES_REVIEW", score: 72,
        reason: "Plan protected cable routing around the confirmed roof layout and service paths." };
    case "lightning-review":
      return input.site?.lightningExposure === "REPORTED_HIGH"
        ? { classification: "RECOMMENDED", compatibility: "REQUIRES_REVIEW", score: 78,
          reason: "You reported higher lightning exposure; request a site-specific risk assessment before selecting protection." }
        : { classification: "OPTIONAL", compatibility: "REQUIRES_REVIEW", score: 34,
          reason: "Site exposure has not been established as high; an installer can advise whether a lightning assessment is useful." };
    case "inverter-monitoring":
      return { classification: monitoring ? "RECOMMENDED" : "OPTIONAL", compatibility: "REQUIRES_REVIEW", score: monitoring ? 82 : 44,
        reason: monitoring ? "Production monitoring matches your stated monitoring goal; check inverter support and data access."
          : "Production monitoring may help diagnose faults if the chosen inverter supports it." };
    case "consumption-monitoring":
      return { classification: monitoring ? "RECOMMENDED" : "OPTIONAL", compatibility: "REQUIRES_REVIEW", score: monitoring ? 75 : 40,
        reason: monitoring ? "Consumption monitoring can help compare solar generation with household use."
          : "Consumption monitoring is optional for insight into household load." };
    case "battery-storage":
      if (!backup) return { classification: "NOT_RECOMMENDED", compatibility: "NOT_RECOMMENDED", score: 0,
        reason: "You have not requested backup power; a battery is not needed solely to generate rooftop solar electricity." };
      return { classification: input.inverterType === "HYBRID" ? "RECOMMENDED" : "OPTIONAL",
        compatibility: "REQUIRES_REVIEW", score: input.inverterType === "HYBRID" ? 84 : 66,
        reason: input.inverterType === "GRID_TIED"
          ? "You reported a grid-tied inverter and a backup goal. A grid-tied inverter alone cannot provide battery backup; an installer must assess a compatible architecture."
          : input.inverterType === "HYBRID"
            ? "You reported a hybrid inverter and a backup goal; an installer must verify battery, inverter and essential-load compatibility before equipment selection."
            : "Backup is your goal, but the inverter architecture is unknown; an installer must establish compatibility before considering a battery." };
    case "essential-loads":
      return backup
        ? { classification: "RECOMMENDED", compatibility: "REQUIRES_REVIEW", score: 76,
          reason: "Backup is your goal; identify essential circuits for a professionally designed backup arrangement." }
        : { classification: "NOT_RECOMMENDED", compatibility: "NOT_RECOMMENDED", score: 0,
          reason: "An essential-loads backup circuit is unnecessary for the stated goals without a backup system." };
    case "ev-charger":
      return ev
        ? { classification: "RECOMMENDED", compatibility: "REQUIRES_REVIEW", score: input.evStatus === "OWNS_EV" ? 82 : 74,
          reason: "EV charging matches your stated plans; an electrician must verify sanctioned load and site wiring." }
        : { classification: "NOT_RECOMMENDED", compatibility: "NOT_RECOMMENDED", score: 0,
          reason: "No EV charging need was reported, so a charger is not relevant now." };
    case "ev-load-management":
      return ev
        ? { classification: "OPTIONAL", compatibility: "REQUIRES_REVIEW", score: 61,
          reason: "Load management may be useful with EV charging; actual need depends on charger size, sanctioned load and other loads." }
        : { classification: "NOT_RECOMMENDED", compatibility: "NOT_RECOMMENDED", score: 0,
          reason: "No EV charging need was reported, so charger load management is not relevant now." };
    case "cleaning-access":
      return { classification: input.site?.safeCleaningAccess === "NO" ? "STRONGLY_RECOMMENDED" :
        maintenance ? "RECOMMENDED" : "OPTIONAL", compatibility: "REQUIRES_REVIEW",
      score: input.site?.safeCleaningAccess === "NO" ? 90 : maintenance ? 68 : 49,
      reason: input.site?.safeCleaningAccess === "NO"
        ? "You reported no safe cleaning access; plan professional maintenance access before installation."
        : "Agree on a safe inspection and cleaning approach with the installer; no universal cleaning frequency is assumed." };
    case "bird-mitigation":
      return input.site?.birdActivity === true
        ? { classification: "OPTIONAL", compatibility: "REQUIRES_REVIEW", score: 54,
          reason: "You reported bird activity; ask whether a compatible mitigation approach is warranted for the panel layout." }
        : { classification: "NOT_RECOMMENDED", compatibility: "NOT_RECOMMENDED", score: 0,
          reason: "No bird or pest issue was reported, so mitigation is not justified from the available information." };
    default:
      throw new RangeError(`Unrecognized accessory catalog entry: ${item.id}`);
  }
}

export function recommendAccessoriesV1(input: AccessoryRecommendationRequest): AccessoryRecommendationV1[] {
  return ACCESSORY_CATALOG_V1.map(item => {
    const decision = decide(item, input);
    return { ...item, safetyNotes: [...item.safetyNotes], ...decision, policyRelevance, costRange };
  }).sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));
}
