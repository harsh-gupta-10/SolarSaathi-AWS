/**
 * Lists, and with --apply deletes, the fabricated policy seed records in a deployed policy table.
 *
 *   node --experimental-strip-types scripts/policy-seed-cleanup.ts --table <PolicyTable> [--region ap-south-1]          (dry run)
 *   node --experimental-strip-types scripts/policy-seed-cleanup.ts --table <PolicyTable> --apply --backup <file.json>
 *
 * It only ever deletes items that policy-seed-fingerprint.ts classifies as FABRICATED_SEED (>= 2 independent
 * placeholder fingerprints) within the PUBLISHED_POLICY# and SOURCE# partitions, plus the ACTIVE pointer rows of those
 * policies. A full backup is written before anything is deleted, and the run refuses to apply without one.
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { classifyPartition, classifyPolicyItem, fabricationReasons, unmarshal, type Plain } from "./policy-seed-fingerprint.ts";

const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const table = flag("table");
const region = flag("region") ?? "ap-south-1";
const apply = args.includes("--apply");
const backup = flag("backup");
if (!table) { console.error("Usage: --table <PolicyTable> [--region r] [--apply --backup file.json]"); process.exit(2); }
if (apply && !backup) { console.error("Refusing to delete without --backup <file.json>."); process.exit(2); }

const aws = (...parts: string[]) => execFileSync("aws", [...parts, "--region", region, "--output", "json"], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });

type RawItem = Record<string, unknown>;
const items: RawItem[] = [];
for (const prefix of ["PUBLISHED_POLICY#", "SOURCE#"]) {
  let startKey: string | undefined;
  do {
    const out = JSON.parse(aws("dynamodb", "scan", "--table-name", table, "--filter-expression", "begins_with(PK, :p)",
      "--expression-attribute-values", JSON.stringify({ ":p": { S: prefix } }), ...(startKey ? ["--starting-token", startKey] : []))) as
      { Items: RawItem[]; NextToken?: string };
    items.push(...out.Items); startKey = out.NextToken;
  } while (startKey);
}

const plain = items.map(raw => ({ raw, item: unmarshal({ M: raw }) as Record<string, Plain> }));
const partitions = new Map<string, typeof plain>();
for (const entry of plain) partitions.set(String(entry.item.PK), [...(partitions.get(String(entry.item.PK)) ?? []), entry]);
// Published policies are judged per record; a source is judged by all rows in its partition together.
const withSourceRows = plain.filter(({ item }) => String(item.PK).startsWith("SOURCE#")
  ? classifyPartition(partitions.get(String(item.PK))!.map(entry => entry.item)) === "FABRICATED_SEED"
  : classifyPolicyItem(item) === "FABRICATED_SEED");

console.log(`${items.length} policy/source records scanned; ${withSourceRows.length} fabricated seed records found:`);
for (const { item } of withSourceRows) console.log(`  ${String(item.PK)} | ${String(item.SK)} | ${fabricationReasons(item).join("; ") || "(partition of a fabricated source)"}`);
if (!withSourceRows.length) process.exit(0);

if (!apply) { console.log("\nDry run only. Re-run with --apply --backup <file.json> to delete these records."); process.exit(0); }
writeFileSync(backup!, JSON.stringify({ table, region, takenAt: new Date().toISOString(), items: withSourceRows.map(({ raw }) => raw) }, null, 1), { mode: 0o600 });
console.log(`\nBackup written to ${backup} (${withSourceRows.length} records).`);
for (let i = 0; i < withSourceRows.length; i += 25) {
  const batch = withSourceRows.slice(i, i + 25).map(({ raw }) => ({ DeleteRequest: { Key: { PK: raw.PK, SK: raw.SK } } }));
  aws("dynamodb", "batch-write-item", "--request-items", JSON.stringify({ [table]: batch }));
}
console.log("Deleted. Benefit checks now report NO_ACTIVE_VERIFIED_RULES until real rules are published.");
