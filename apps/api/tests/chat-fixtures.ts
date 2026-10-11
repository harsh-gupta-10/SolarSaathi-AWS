import type { ConverseStreamCommand } from "@aws-sdk/client-bedrock-runtime";
import type { BedrockStreamClient } from "../src/chat/agent";
import type { ChatServices } from "../src/chat/services";
import { ProposalStore } from "../src/chat/proposals";
import type { Item, ItemKey, ItemPage, ItemTable, QueryPrefixInput } from "../src/lib/item-table";
import { identity } from "./data-fixtures";

/** Exact in-memory model of the ItemTable contract used by chat, proposals, idempotency and price benchmarks. */
export class MemoryItemTable implements ItemTable {
  readonly items = new Map<string, Item>();
  private key = (key: ItemKey) => `${key.PK}\u0000${key.SK}`;
  async get(key: ItemKey) { const found = this.items.get(this.key(key)); return found ? structuredClone(found) : undefined; }
  async put(item: Item, options: { ifAbsent?: boolean } = {}) {
    if (options.ifAbsent && this.items.has(this.key(item))) return false;
    this.items.set(this.key(item), structuredClone(item)); return true;
  }
  async updateIf(key: ItemKey, set: Record<string, unknown>, ifEquals: Record<string, unknown>) {
    const found = this.items.get(this.key(key));
    if (!found || Object.entries(ifEquals).some(([field, value]) => JSON.stringify(found[field]) !== JSON.stringify(value))) return false;
    Object.assign(found, structuredClone(set)); return true;
  }
  async delete(key: ItemKey) { this.items.delete(this.key(key)); }
  async deleteMany(keys: readonly ItemKey[]) { for (const key of keys) this.items.delete(this.key(key)); }
  async queryPrefix(input: QueryPrefixInput): Promise<ItemPage> {
    let all = [...this.items.values()].filter(item => item.PK === input.pk && item.SK.startsWith(input.skPrefix))
      .sort((a, b) => a.SK < b.SK ? -1 : a.SK > b.SK ? 1 : 0);
    if (input.descending) all.reverse();
    if (input.startKey) {
      const index = all.findIndex(item => item.SK === input.startKey!.SK);
      all = all.slice(index + 1);
    }
    const page = all.slice(0, input.limit).map(item => structuredClone(item));
    return { items: page, ...(all.length > input.limit ? { lastKey: { PK: page.at(-1)!.PK, SK: page.at(-1)!.SK } } : {}) };
  }
  async increment(key: ItemKey, input: { field: string; by: number; max?: number; expiresAtEpochSeconds: number }) {
    const found = this.items.get(this.key(key)) ?? { ...key };
    const current = Number(found[input.field] ?? 0);
    if (input.max !== undefined && current + input.by > input.max) return { ok: false, value: current };
    found[input.field] = current + input.by; found.expiresAtEpochSeconds = input.expiresAtEpochSeconds;
    this.items.set(this.key(key), found); return { ok: true, value: current + input.by };
  }
}

export type StreamScript = Array<Record<string, unknown>>;
/** Recorded model turns. Each call to `send` replays the next script and records the request. */
export class ScriptedBedrock implements BedrockStreamClient {
  readonly requests: Array<ConverseStreamCommand["input"]> = [];
  constructor(private readonly scripts: StreamScript[], private readonly failWith?: Error[]) {}
  async send(command: ConverseStreamCommand) {
    this.requests.push(command.input);
    const failure = this.failWith?.shift();
    if (failure) throw failure;
    const script = this.scripts.shift();
    if (!script) throw new Error("No scripted model turn left");
    return { stream: (async function* () { for (const event of script) yield event; })() } as never;
  }
}

export const textTurn = (...chunks: string[]): StreamScript => [
  ...chunks.map(text => ({ contentBlockDelta: { contentBlockIndex: 0, delta: { text } } })),
  { messageStop: { stopReason: "end_turn" } }, { metadata: { usage: { inputTokens: 100, outputTokens: 20 } } }];
export const toolTurn = (name: string, input: unknown, toolUseId = "tool-1"): StreamScript => [
  { contentBlockStart: { contentBlockIndex: 0, start: { toolUse: { toolUseId, name } } } },
  { contentBlockDelta: { contentBlockIndex: 0, delta: { toolUse: { input: JSON.stringify(input) } } } },
  { messageStop: { stopReason: "tool_use" } }, { metadata: { usage: { inputTokens: 100, outputTokens: 20 } } }];

export const fixedClock = () => new Date("2026-10-11T08:00:00.000Z");
export function counterId(prefix = "id") { let n = 0; return () => `${prefix}${String(++n).padStart(4, "0")}`; }

/** Services whose methods are overridden per test. Anything not overridden throws, so unexpected calls are visible. */
export function fakeServices(overrides: Partial<Record<keyof ChatServices, unknown>> = {}, items = new MemoryItemTable()): ChatServices & { items: MemoryItemTable } {
  const refuse = (name: string) => new Proxy({}, { get: (_t, method) => () => { throw new Error(`Unexpected call ${name}.${String(method)}`); } });
  return { core: refuse("core"), systems: refuse("systems"), accessories: refuse("accessories"), financials: refuse("financials"),
    policyFinancials: refuse("policyFinancials"), benefits: refuse("benefits"), applications: refuse("applications"),
    publication: refuse("publication"), prices: refuse("prices"), proposals: new ProposalStore(items, fixedClock, (() => { let n = 0; return () => String(++n).padStart(32, "a"); })()) as never,
    items, ...overrides } as never;
}
export { identity };
export const homeowner = () => identity();
