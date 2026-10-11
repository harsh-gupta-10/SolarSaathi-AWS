import type { PriceAuthorityTier } from "@solarsaathi/calculations";

/**
 * Authority-tiered research allowlist. Hosts are matched exactly or as a registrable-suffix (`.gov.in`).
 * Installer marketing sites are deliberately absent: they are not accepted as research sources. Adding a domain is a
 * code-reviewed change. A match is never an approval; every extraction becomes a CANDIDATE for admin review.
 */
const OFFICIAL_SUFFIXES = [".gov.in", ".nic.in"];
const OFFICIAL_HOSTS = ["mnre.gov.in", "pmsuryaghar.gov.in", "seci.co.in"];
const DISCOM_HOSTS = ["mahadiscom.in", "bsesdelhi.com", "tatapower-ddl.com", "adanielectricity.com", "torrentpower.com",
  "uppcl.org", "pspcl.in", "tpcodl.com", "tpwodl.com", "tpnodl.com", "tpsodl.com", "cesc.co.in", "wbsedcl.in",
  "kseb.in", "tangedco.org", "tnpdcl.org", "apspdcl.in", "apepdcl.in", "tgsouthernpower.org", "tgnpdcl.com",
  "dgvcl.com", "mgvcl.com", "pgvcl.com", "ugvcl.com", "jbvnl.co.in", "cspdcl.co.in"];
const TRADE_PRESS_HOSTS = ["mercomindia.com", "saurenergy.com", "pv-magazine-india.com", "solarquarter.com",
  "energy.economictimes.indiatimes.com", "economictimes.indiatimes.com", "thehindubusinessline.com", "livemint.com"];

const normalize = (host: string) => host.toLowerCase().replace(/^www\./, "");

export function authorityTierForHost(rawHost: string): PriceAuthorityTier | undefined {
  const host = normalize(rawHost);
  if (OFFICIAL_HOSTS.includes(host) || OFFICIAL_SUFFIXES.some(suffix => host.endsWith(suffix))) return "OFFICIAL";
  if (DISCOM_HOSTS.some(item => host === item || host.endsWith(`.${item}`))) return "DISCOM";
  if (TRADE_PRESS_HOSTS.includes(host)) return "TRADE_PRESS";
  return undefined;
}
export const isAllowedResearchHost = (host: string) => authorityTierForHost(host) !== undefined;
export const TIER_ORDER: Record<PriceAuthorityTier, number> = { OFFICIAL: 0, DISCOM: 1, TRADE_PRESS: 2, INSTALLER: 3, OTHER: 4 };
