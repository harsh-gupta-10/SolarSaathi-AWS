import type { ChatErrorCode } from "@solarsaathi/types";
import type { ItemTable } from "../lib/item-table";
import { CHAT_CONFIG } from "./config";
import { dailyKey, hourlyKey, tokenKey } from "./keys";

export interface LimitDecision { allowed: boolean; code?: Extract<ChatErrorCode, "RATE_LIMITED" | "BUDGET_EXCEEDED">; message?: string }

const pad = (value: number) => String(value).padStart(2, "0");
export const hourBucket = (now: Date) => `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}${pad(now.getUTCHours())}`;
export const dayBucket = (now: Date) => `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}`;

/** Per-user fixed-window turn limits and a hard daily token budget, all conditional DynamoDB counters. */
export class ChatLimits {
  constructor(private readonly table: ItemTable, private readonly now: () => Date = () => new Date()) {}

  private ttl(seconds: number) { return Math.floor(this.now().getTime() / 1_000) + seconds; }

  /** Reserve one turn. Fails closed when either window is exhausted or the token budget is spent. */
  async startTurn(userId: string): Promise<LimitDecision> {
    const now = this.now();
    const budget = await this.table.get(tokenKey(userId, dayBucket(now)));
    if (Number(budget?.tokens ?? 0) >= CHAT_CONFIG.dailyTokenBudget) {
      return { allowed: false, code: "BUDGET_EXCEEDED", message: "You have reached today's assistant usage budget. Try again tomorrow." };
    }
    const hour = await this.table.increment(hourlyKey(userId, hourBucket(now)),
      { field: "turns", by: 1, max: CHAT_CONFIG.turnsPerHour, expiresAtEpochSeconds: this.ttl(2 * 3_600) });
    if (!hour.ok) return { allowed: false, code: "RATE_LIMITED", message: "You are sending messages too quickly. Please wait a little and try again." };
    const day = await this.table.increment(dailyKey(userId, dayBucket(now)),
      { field: "turns", by: 1, max: CHAT_CONFIG.turnsPerDay, expiresAtEpochSeconds: this.ttl(2 * 86_400) });
    if (!day.ok) return { allowed: false, code: "RATE_LIMITED", message: "You have reached today's message limit. Try again tomorrow." };
    return { allowed: true };
  }

  /** Record model tokens actually used (best effort; never throws into the response path). */
  async recordTokens(userId: string, tokens: number): Promise<void> {
    if (!Number.isFinite(tokens) || tokens <= 0) return;
    await this.table.increment(tokenKey(userId, dayBucket(this.now())),
      { field: "tokens", by: Math.ceil(tokens), expiresAtEpochSeconds: this.ttl(2 * 86_400) });
  }
}
