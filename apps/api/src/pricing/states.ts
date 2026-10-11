/** Fixed state code to name map. Research queries are built only from these names, never from free user text. */
export const INDIAN_REGIONS = {
  AN: "Andaman and Nicobar Islands", AP: "Andhra Pradesh", AR: "Arunachal Pradesh", AS: "Assam", BR: "Bihar",
  CH: "Chandigarh", CT: "Chhattisgarh", DN: "Dadra and Nagar Haveli and Daman and Diu", DL: "Delhi", GA: "Goa",
  GJ: "Gujarat", HR: "Haryana", HP: "Himachal Pradesh", JK: "Jammu and Kashmir", JH: "Jharkhand", KA: "Karnataka",
  KL: "Kerala", LA: "Ladakh", LD: "Lakshadweep", MP: "Madhya Pradesh", MH: "Maharashtra", MN: "Manipur",
  ML: "Meghalaya", MZ: "Mizoram", NL: "Nagaland", OR: "Odisha", PY: "Puducherry", PB: "Punjab", RJ: "Rajasthan",
  SK: "Sikkim", TN: "Tamil Nadu", TG: "Telangana", TR: "Tripura", UP: "Uttar Pradesh", UT: "Uttarakhand",
  WB: "West Bengal",
} as const;
export type RegionCode = keyof typeof INDIAN_REGIONS;
export const regionCodes = Object.keys(INDIAN_REGIONS) as [RegionCode, ...RegionCode[]];
