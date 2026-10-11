import { createHash, randomBytes } from "node:crypto";
import type { ChatCard, ChatConfirmResponse, ChatProposal } from "@solarsaathi/types";
import { RequestError } from "../lib/http";
import type { ItemTable } from "../lib/item-table";
import { CHAT_CONFIG } from "./config";
import { proposalKey } from "./keys";

export type ProposalAction = ChatProposal["action"];

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a < b ? -1 : 1).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
export const paramsHash = (action: string, params: unknown) =>
  createHash("sha256").update(`${action}\0${canonicalJson(params)}`).digest("hex");

export interface ProposalExecution { card?: ChatCard }
export type ProposalExecutor = (action: ProposalAction, params: unknown, proposalId: string) => Promise<ProposalExecution>;

/**
 * Server-side proposals. A mutating chat tool only creates one of these; nothing changes until `confirm` claims it
 * with a conditional update. The stored record is keyed by the owning user, so another user's id never resolves.
 */
export class ProposalStore {
  constructor(private readonly table: ItemTable, private readonly now: () => Date = () => new Date(),
    private readonly randomId: () => string = () => randomBytes(16).toString("hex")) {}

  async create(userId: string, input: { action: ProposalAction; params: unknown; summary: string; chatId?: string }):
  Promise<ChatProposal> {
    const proposalId = this.randomId();
    const nowEpoch = Math.floor(this.now().getTime() / 1_000);
    const expiresAt = new Date((nowEpoch + CHAT_CONFIG.proposalTtlSeconds) * 1_000).toISOString();
    await this.table.put({ ...proposalKey(userId, proposalId), entityType: "CHAT_PROPOSAL", proposalId, userId,
      action: input.action, params: input.params, paramsHash: paramsHash(input.action, input.params),
      summary: input.summary, ...(input.chatId ? { chatId: input.chatId } : {}), status: "PENDING", expiresAt,
      createdAt: this.now().toISOString(),
      // Executed records stay a day so a repeated confirm can answer ALREADY_EXECUTED instead of "not found".
      expiresAtEpochSeconds: nowEpoch + CHAT_CONFIG.proposalTtlSeconds + 86_400 }, { ifAbsent: true });
    return { proposalId, action: input.action, summary: input.summary, expiresAt };
  }

  async confirm(userId: string, proposalId: string, execute: ProposalExecutor): Promise<ChatConfirmResponse> {
    const key = proposalKey(userId, proposalId);
    const item = await this.table.get(key);
    if (!item || item.entityType !== "CHAT_PROPOSAL" || item.userId !== userId) {
      throw new RequestError(404, "PROPOSAL_NOT_FOUND", "That confirmation is not available.");
    }
    const action = item.action as ProposalAction;
    if (item.status === "EXECUTED") {
      const card = typeof item.resultCard === "string" ? JSON.parse(item.resultCard) as ChatCard : undefined;
      return { proposalId, status: "ALREADY_EXECUTED", ...(card ? { card } : {}) };
    }
    if (item.paramsHash !== paramsHash(action, item.params)) {
      throw new RequestError(409, "PROPOSAL_INTEGRITY", "That confirmation can no longer be used.");
    }
    if (Date.parse(String(item.expiresAt)) <= this.now().getTime() || item.status === "FAILED") {
      return { proposalId, status: "EXPIRED" };
    }
    const claimedAt = this.now().getTime();
    const staleClaim = item.status === "EXECUTING" && typeof item.claimedAt === "number" &&
      claimedAt - item.claimedAt > 60_000;
    if (item.status === "EXECUTING" && !staleClaim) {
      throw new RequestError(409, "PROPOSAL_IN_PROGRESS", "This confirmation is already being processed.");
    }
    const claimed = await this.table.updateIf(key, { status: "EXECUTING", claimedAt },
      staleClaim ? { status: "EXECUTING", claimedAt: item.claimedAt } : { status: "PENDING" });
    if (!claimed) {
      const latest = await this.table.get(key);
      if (latest?.status === "EXECUTED") return { proposalId, status: "ALREADY_EXECUTED" };
      throw new RequestError(409, "PROPOSAL_IN_PROGRESS", "This confirmation is already being processed.");
    }
    try {
      const result = await execute(action, item.params, proposalId);
      await this.table.updateIf(key, { status: "EXECUTED", executedAt: this.now().toISOString(),
        ...(result.card ? { resultCard: JSON.stringify(result.card) } : {}) }, { status: "EXECUTING", claimedAt });
      return { proposalId, status: "EXECUTED", ...(result.card ? { card: result.card } : {}) };
    } catch (error) {
      // Server faults can be retried with the same proposal; a rejected request cannot.
      const retryable = !(error instanceof RequestError) || error.statusCode >= 500;
      await this.table.updateIf(key, { status: retryable ? "PENDING" : "FAILED" }, { status: "EXECUTING", claimedAt })
        .catch(() => undefined);
      throw error;
    }
  }
}
