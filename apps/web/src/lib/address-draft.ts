export const ADDRESS_DRAFT_KEY = "solarsaathi.address-draft.v1";
export function validateAddress(value: string): string | undefined {
  const address = value.trim();
  if (address.length < 8) return "Enter a fuller address, including your city or PIN code.";
  if (address.length > 300) return "Keep the address to 300 characters or fewer.";
  if (Array.from(address).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) return "Remove unsupported control characters from the address.";
}
export function saveAddressDraft(storage: Pick<Storage, "setItem">, value: string): void {
  if (validateAddress(value)) throw new Error("Invalid address draft");
  storage.setItem(ADDRESS_DRAFT_KEY, JSON.stringify({ version: 1, address: value.trim() }));
}
export function readAddressDraft(storage: Pick<Storage, "getItem">): string {
  try {
    const text = storage.getItem(ADDRESS_DRAFT_KEY);
    if (!text || text.length > 2_000) return "";
    const draft: unknown = JSON.parse(text);
    if (typeof draft !== "object" || draft === null || !("version" in draft) || draft.version !== 1 || !("address" in draft) || typeof draft.address !== "string") return "";
    return validateAddress(draft.address) ? "" : draft.address;
  } catch { return ""; }
}
