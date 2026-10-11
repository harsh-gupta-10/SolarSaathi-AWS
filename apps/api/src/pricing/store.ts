import { benchmarkUsable, type PriceBenchmarkStatus, type PriceBenchmarkV1 } from "@solarsaathi/calculations";
import { RequestError } from "../lib/http";
import type { Item, ItemKey, ItemTable } from "../lib/item-table";
import { priceBenchmarkSchema } from "./schema";

/**
 * Price benchmark records.
 *   main record  PK `PRICE_BENCHMARK#{id}`, SK `RECORD`              the audit-bearing source of truth
 *   status index PK `PRICE_STATUS#{status}`, SK `{publishedOn}#{id}` a copy used only for listing by status
 * A benchmark's numbers are never edited; a new price is a new benchmark. Only status and review fields change.
 * The quote path reads the APPROVED index and re-validates every record, so a stale index entry fails closed.
 */
export interface BenchmarkAudit {
  createdBy: string; createdAt: string; researchNotes?: string[];
  approvedBy?: string; approvedAt?: string; approvalNote?: string;
  rejectedBy?: string; rejectedAt?: string; rejectionReason?: string;
  supersededByBenchmarkId?: string; supersededAt?: string;
}
export interface StoredBenchmark { benchmark: PriceBenchmarkV1; audit: BenchmarkAudit }
export const SYSTEM_RESEARCH_ACTOR = "SYSTEM:RESEARCH";

const mainKey = (id: string): ItemKey => ({ PK: `PRICE_BENCHMARK#${id}`, SK: "RECORD" });
const statusKey = (status: PriceBenchmarkStatus, benchmark: PriceBenchmarkV1): ItemKey =>
  ({ PK: `PRICE_STATUS#${status}`, SK: `${benchmark.publishedOn}#${benchmark.benchmarkId}` });
const MAX_APPROVED = 200;

function parse(item: Item | undefined): StoredBenchmark | undefined {
  if (!item) return undefined;
  const result = priceBenchmarkSchema.safeParse(item.benchmark);
  if (!result.success) throw new RequestError(503, "DATABASE_UNAVAILABLE", "Stored price data could not be verified.");
  return { benchmark: result.data, audit: item.audit as BenchmarkAudit };
}
const record = (key: ItemKey, stored: StoredBenchmark): Item => ({ ...key, entityType: "PRICE_BENCHMARK",
  status: stored.benchmark.status, benchmark: stored.benchmark, audit: stored.audit });

export class PriceBenchmarkStore {
  constructor(private readonly table: ItemTable, private readonly now: () => Date = () => new Date()) {}

  async get(id: string) { return parse(await this.table.get(mainKey(id))); }

  /** Idempotent: an existing benchmark with the same id (same source and figures) is left untouched. */
  async createCandidate(benchmark: PriceBenchmarkV1, audit: Omit<BenchmarkAudit, "createdAt">):
  Promise<{ stored: StoredBenchmark; created: boolean }> {
    if (benchmark.status !== "CANDIDATE") throw new RequestError(400, "INVALID_REQUEST", "Only candidates can be created.");
    const checked = priceBenchmarkSchema.parse(benchmark);
    const stored: StoredBenchmark = { benchmark: checked, audit: { ...audit, createdAt: this.now().toISOString() } };
    const created = await this.table.put(record(mainKey(checked.benchmarkId), stored), { ifAbsent: true });
    if (!created) return { stored: (await this.get(checked.benchmarkId))!, created: false };
    await this.table.put(record(statusKey("CANDIDATE", checked), stored));
    return { stored, created: true };
  }

  async list(status: PriceBenchmarkStatus, limit: number, startKey?: ItemKey) {
    const page = await this.table.queryPrefix({ pk: `PRICE_STATUS#${status}`, skPrefix: "", limit, descending: true, startKey });
    return { items: page.items.map(parse).filter((item): item is StoredBenchmark => !!item && item.benchmark.status === status),
      lastKey: page.lastKey };
  }

  /** Approved, unexpired benchmarks for the quote engine. Re-validated and re-checked against the main record. */
  async listUsable(): Promise<PriceBenchmarkV1[]> {
    const page = await this.list("APPROVED", MAX_APPROVED);
    const at = this.now();
    const usable: PriceBenchmarkV1[] = [];
    for (const item of page.items) {
      if (!benchmarkUsable(item.benchmark, at)) continue;
      const main = await this.get(item.benchmark.benchmarkId);
      if (main?.benchmark.status === "APPROVED") usable.push(main.benchmark);
    }
    return usable;
  }

  private async move(id: string, from: PriceBenchmarkStatus, to: PriceBenchmarkStatus, patch: Partial<BenchmarkAudit>,
    edit: Partial<Pick<PriceBenchmarkV1, "expiresAt">> = {}): Promise<StoredBenchmark> {
    const current = await this.get(id);
    if (!current) throw new RequestError(404, "BENCHMARK_NOT_FOUND", "The price benchmark was not found.");
    if (current.benchmark.status !== from) {
      throw new RequestError(409, "INVALID_STATE", `Only ${from.toLowerCase()} benchmarks can move to ${to.toLowerCase()}.`);
    }
    const next: StoredBenchmark = { benchmark: { ...current.benchmark, ...edit, status: to }, audit: { ...current.audit, ...patch } };
    const won = await this.table.updateIf(mainKey(id), { status: to, benchmark: next.benchmark, audit: next.audit }, { status: from });
    if (!won) throw new RequestError(409, "INVALID_STATE", "The benchmark changed. Refresh and try again.");
    // Index maintenance follows the guarded main write; a failure here leaves the benchmark unlisted, never mis-listed.
    await this.table.delete(statusKey(from, current.benchmark));
    await this.table.put(record(statusKey(to, next.benchmark), next));
    return next;
  }

  /** Two-person rule: the approver must differ from the creator. Same-scope approved benchmarks become SUPERSEDED. */
  async approve(id: string, actorId: string, input: { note?: string; expiresAt?: string } = {}): Promise<StoredBenchmark> {
    const current = await this.get(id);
    if (!current) throw new RequestError(404, "BENCHMARK_NOT_FOUND", "The price benchmark was not found.");
    if (current.audit.createdBy === actorId) {
      throw new RequestError(403, "SEPARATE_REVIEWER_REQUIRED", "A different administrator must approve this benchmark.");
    }
    if (current.benchmark.status !== "CANDIDATE") throw new RequestError(409, "INVALID_STATE", "Only candidate benchmarks can be approved.");
    const at = this.now();
    if (Date.parse(current.benchmark.expiresAt) <= at.getTime()) {
      throw new RequestError(409, "BENCHMARK_EXPIRED", "This benchmark has already expired and cannot be approved.");
    }
    const expiresAt = input.expiresAt ?? current.benchmark.expiresAt;
    if (Date.parse(expiresAt) <= at.getTime() || Date.parse(expiresAt) > Date.parse(current.benchmark.expiresAt)) {
      throw new RequestError(400, "INVALID_REQUEST", "Approval cannot extend a benchmark's expiry.");
    }
    const approved = await this.move(id, "CANDIDATE", "APPROVED", { approvedBy: actorId, approvedAt: at.toISOString(),
      ...(input.note ? { approvalNote: input.note } : {}) }, { expiresAt });
    const key = (b: PriceBenchmarkV1) => JSON.stringify([b.scope, b.sizeBand, b.moduleClass, b.inverterType]);
    const peers = await this.list("APPROVED", MAX_APPROVED);
    for (const peer of peers.items) {
      if (peer.benchmark.benchmarkId === id || key(peer.benchmark) !== key(approved.benchmark)) continue;
      await this.move(peer.benchmark.benchmarkId, "APPROVED", "SUPERSEDED",
        { supersededByBenchmarkId: id, supersededAt: at.toISOString() }).catch(() => undefined);
    }
    return approved;
  }

  async reject(id: string, actorId: string, reason: string): Promise<StoredBenchmark> {
    return this.move(id, "CANDIDATE", "REJECTED", { rejectedBy: actorId, rejectedAt: this.now().toISOString(), rejectionReason: reason });
  }
}
