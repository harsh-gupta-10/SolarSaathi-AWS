export const REGISTRY_VERSION = 1;

/** These are official starter pages, not a catalog of active benefits or coverage. */
export const authorityRegistry = {
  US: { host: "www.energy.gov", seed: "https://www.energy.gov/cmei/systems/solar-energy-resources-consumers", label: "United States Department of Energy" },
  GB: { host: "www.ofgem.gov.uk", seed: "https://www.ofgem.gov.uk/environmental-and-social-schemes/smart-export-guarantee-seg/smart-export-guarantee-seg-generators", label: "Ofgem (Great Britain only)" },
  AU: { host: "cer.gov.au", seed: "https://cer.gov.au/schemes/renewable-energy-target/small-scale-renewable-energy-scheme", label: "Clean Energy Regulator" },
} as const;

export type SupportedCountry = keyof typeof authorityRegistry;
export function supportedCountry(value: string): value is SupportedCountry {
  return Object.hasOwn(authorityRegistry, value);
}

export function officialUrl(raw: string, country: SupportedCountry): string | undefined {
  try {
    if (raw.length > 1_500 || Array.from(raw).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) return undefined;
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.hostname !== authorityRegistry[country].host || url.port ||
      url.username || url.password || url.hash || url.search.length > 250) return undefined;
    return url.toString();
  } catch { return undefined; }
}
