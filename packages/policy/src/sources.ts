import { policyDocumentSchema, policySourceSchema, type PolicyDocumentV1,
  type PolicySourceType, type PolicySourceV1 } from "./schema";

export interface OfficialPolicyHostV1 {
  host: string;
  sourceType: PolicySourceType;
  jurisdiction: string;
  verifiedAt: "2026-10-08" | "2026-10-11";
}

/** Official starter domains verified from their owning sites on 2026-10-08.
 * A listed host proves neither a policy fact nor a current benefit value. */
export const OFFICIAL_POLICY_HOSTS_V1: readonly OfficialPolicyHostV1[] = Object.freeze([
  { host: "mnre.gov.in", sourceType: "MNRE", jurisdiction: "IN", verifiedAt: "2026-10-08" },
  { host: "solarrooftop.pmsuryaghar.gov.in", sourceType: "SCHEME_PORTAL", jurisdiction: "IN", verifiedAt: "2026-10-08" },
  { host: "energy.maharashtra.gov.in", sourceType: "STATE_ENERGY_DEPARTMENT", jurisdiction: "IN-MH", verifiedAt: "2026-10-08" },
  { host: "portal.mahadiscom.in", sourceType: "DISCOM", jurisdiction: "IN-MH", verifiedAt: "2026-10-08" },
  { host: "new.merc.gov.in", sourceType: "REGULATOR", jurisdiction: "IN-MH", verifiedAt: "2026-10-08" },
  { host: "www.mahaurja.maharashtra.gov.in", sourceType: "RENEWABLE_AGENCY", jurisdiction: "IN-MH", verifiedAt: "2026-10-08" },
  // Added 2026-10-11 for the central and state policy drafts in docs/policy-drafts. Each host was fetched and the
  // document it serves checked against its owner's own pages; none proves a fact or a benefit amount by itself.
  // National NIC "S3WaaS" document CDN that mnre.gov.in links to for its notices (the CFA operational guidelines PDF).
  { host: "cdnbbsr.s3waas.gov.in", sourceType: "MNRE", jurisdiction: "IN", verifiedAt: "2026-10-11" },
  // Delhi Department of Power's solar portal (state capital subsidy page).
  { host: "solar.delhi.gov.in", sourceType: "STATE_ENERGY_DEPARTMENT", jurisdiction: "IN-DL", verifiedAt: "2026-10-11" },
  // UPNEDA, the Uttar Pradesh nodal renewable-energy agency (Solar Energy Policy 2022).
  { host: "solarcitiesportal.upneda.org.in", sourceType: "RENEWABLE_AGENCY", jurisdiction: "IN-UP", verifiedAt: "2026-10-11" },
  // APDCL hosts the Assam Power Department's notification of the Integrated Clean Energy Policy 2025. The original
  // publisher is the Power Department, so this is a copy; replace it with the department's own file when one is found.
  { host: "www.apdcl.org", sourceType: "OFFICIAL_NOTIFICATION", jurisdiction: "IN-AS", verifiedAt: "2026-10-11" },
]);

/** Canonicalization is intentionally narrow; fetchers must also recheck every redirect target. */
export function canonicalizePolicyUrl(rawUrl: string): string {
  let url: URL;
  try { url = new URL(rawUrl); } catch { throw new RangeError("Invalid policy URL."); }
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.hostname === "localhost" ||
    !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/.test(url.hostname)) {
    throw new RangeError("Policy URL must use a public HTTPS DNS host.");
  }
  url.hash = "";
  return url.toString();
}

/** Exact-host, source-type and jurisdiction binding; caller-provided allowedHosts grant no authority. */
export function validateOfficialSourceUrl(rawUrl: string, sourceType: PolicySourceType,
  jurisdiction: string): { canonicalUrl: string; host: string; hostRegistryVersion: 1 } {
  const canonicalUrl = canonicalizePolicyUrl(rawUrl);
  const host = new URL(canonicalUrl).hostname;
  if (!OFFICIAL_POLICY_HOSTS_V1.some(entry => entry.host === host && entry.sourceType === sourceType &&
    entry.jurisdiction === jurisdiction)) {
    throw new RangeError("Source URL is not in the verified official-host registry for this owner and jurisdiction.");
  }
  return { canonicalUrl, host, hostRegistryVersion: 1 };
}

export function validateOfficialSourceRecord(input: unknown): PolicySourceV1 {
  const source = policySourceSchema.parse(input);
  const verified = validateOfficialSourceUrl(source.canonicalUrl, source.sourceType, source.jurisdiction);
  if (source.canonicalUrl !== verified.canonicalUrl || source.allowedHosts.length !== 1 ||
    source.allowedHosts[0] !== verified.host) {
    throw new RangeError("Source host binding or canonical URL differs from the verified registry.");
  }
  return source;
}

export function validateSourceDocumentBinding(sourceInput: unknown, documentInput: unknown):
  { source: PolicySourceV1; document: PolicyDocumentV1 } {
  const source = validateOfficialSourceRecord(sourceInput);
  const document = policyDocumentSchema.parse(documentInput);
  if (document.sourceId !== source.sourceId || document.sourceRegistryVersion !== source.registryVersion ||
    new URL(document.canonicalUrl).hostname !== new URL(source.canonicalUrl).hostname) {
    throw new RangeError("Policy document is not bound to the registered source version and host.");
  }
  return { source, document };
}

/** A missing check is stale; elapsed time is evaluated against an explicit caller clock. */
export function sourceIsStale(sourceInput: PolicySourceV1, at: Date): boolean {
  const source = policySourceSchema.parse(sourceInput);
  if (!Number.isFinite(at.getTime())) throw new RangeError("Invalid source evaluation time.");
  if (!source.lastCheckedAt) return true;
  const age = at.getTime() - Date.parse(source.lastCheckedAt);
  return age < 0 || age > source.freshnessWindowHours * 3_600_000;
}
