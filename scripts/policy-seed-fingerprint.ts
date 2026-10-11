/**
 * Recognises the fabricated policy seed records that an early seeder wrote into a deployed policy table (the seeder
 * was removed from the repo in commit 2e21736 but its records stayed in DynamoDB). A record is only classified as
 * fabricated when it carries an unmistakable fingerprint; anything else is KEEP. Pure and dependency-free so it can be
 * tested and reused by the cleanup runner.
 */
export type Plain = string | number | boolean | null | Plain[] | { [key: string]: Plain };

/** SHA-256 of zero bytes: a document hash that only an empty file has. Real archived policy text never hashes to it. */
const EMPTY_FILE_SHA256 = /^e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b85[0-9a-f]$/;
const PLACEHOLDER_ACTORS = new Set(["solarsaathi-policy-team", "solarsaathi-reviewer", "solarsaathi-author", "solarsaathi-curator"]);
const ALL_SAME_HEX = /^([0-9a-f])\1{63}$/;

export type Classification = "FABRICATED_SEED" | "KEEP";

function* walk(value: Plain, key = ""): Generator<[string, Plain]> {
  yield [key, value];
  if (Array.isArray(value)) for (const entry of value) yield* walk(entry, key);
  else if (value && typeof value === "object") for (const [name, child] of Object.entries(value)) yield* walk(child, name);
}

/** Why an item looks fabricated; empty when it does not. Only strong, specific fingerprints count. */
export function fabricationReasons(item: Record<string, Plain>): string[] {
  const pk = typeof item.PK === "string" ? item.PK : "";
  if (!pk.startsWith("PUBLISHED_POLICY#") && !pk.startsWith("SOURCE#")) return [];
  const reasons = new Set<string>();
  for (const [key, value] of walk(item)) {
    if (typeof value !== "string") continue;
    if ((key === "sha256" || key === "documentSha256" || key === "lastObservedSha256") && EMPTY_FILE_SHA256.test(value)) {
      reasons.add("document hash is the SHA-256 of an empty file");
    }
    if (key === "contentHash" && ALL_SAME_HEX.test(value)) reasons.add("content hash is a repeated placeholder");
    if (["verifiedBy", "approvedBy", "createdBy", "curatorId"].includes(key) && PLACEHOLDER_ACTORS.has(value)) {
      reasons.add(`placeholder actor "${value}"`);
    }
  }
  return [...reasons];
}

/** Fabricated only when at least two independent fingerprints agree, so one odd field can never condemn real data. */
export function classifyPolicyItem(item: Record<string, Plain>): Classification {
  return fabricationReasons(item).length >= 2 ? "FABRICATED_SEED" : "KEEP";
}

/** Converts DynamoDB-JSON attribute values (as printed by the AWS CLI) to plain values. */
export function unmarshal(value: unknown): Plain {
  const v = value as Record<string, unknown>;
  if ("S" in v) return v.S as string;
  if ("N" in v) return Number(v.N);
  if ("BOOL" in v) return v.BOOL as boolean;
  if ("NULL" in v) return null;
  if ("L" in v) return (v.L as unknown[]).map(unmarshal);
  if ("M" in v) return Object.fromEntries(Object.entries(v.M as Record<string, unknown>).map(([k, x]) => [k, unmarshal(x)]));
  if ("SS" in v) return v.SS as string[];
  return String(JSON.stringify(v));
}

/**
 * Classifies every item sharing one partition key by the combined evidence of that partition. A seeded source spreads
 * its fingerprints over several rows (a placeholder curator on the source, an empty-file hash on its document and
 * crawl state), so the rows are judged together. Needs at least two independent fingerprints, as for single items.
 */
export function classifyPartition(items: Record<string, Plain>[]): Classification {
  const reasons = new Set(items.flatMap(item => fabricationReasons(item)));
  return reasons.size >= 2 ? "FABRICATED_SEED" : "KEEP";
}
