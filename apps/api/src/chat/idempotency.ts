import { RequestError } from "../lib/http";
import type { ItemTable } from "../lib/item-table";
import { CHAT_CONFIG } from "./config";
import { idempotencyKey } from "./keys";

export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

export function parseIdempotencyKey(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (!IDEMPOTENCY_KEY_PATTERN.test(value)) {
    throw new RequestError(400, "INVALID_IDEMPOTENCY_KEY", "Idempotency-Key must be 8 to 128 letters, digits, dashes or underscores.");
  }
  return value;
}

/**
 * Runs a create operation at most once per (user, scope, key). A concurrent or repeated call with the same key either
 * replays the stored result or is rejected while the first call is still running. A failed first call releases the
 * claim so a retry can run. Results must be JSON serializable.
 */
export async function runIdempotent<T>(table: ItemTable, userId: string, scope: string, key: string | undefined,
  run: () => Promise<T>, now: () => Date = () => new Date()): Promise<{ value: T; replayed: boolean }> {
  if (key === undefined) return { value: await run(), replayed: false };
  parseIdempotencyKey(key);
  const itemKey = idempotencyKey(userId, scope, key);
  const at = () => Math.floor(now().getTime() / 1_000);
  const claim = { ...itemKey, entityType: "IDEMPOTENCY", status: "PENDING", claimedAtEpochSeconds: at(),
    expiresAtEpochSeconds: at() + CHAT_CONFIG.idempotencyTtlSeconds };
  if (!(await table.put(claim, { ifAbsent: true }))) {
    const existing = await table.get(itemKey);
    if (existing?.status === "COMPLETED" && typeof existing.result === "string") {
      return { value: JSON.parse(existing.result) as T, replayed: true };
    }
    const stale = existing?.status === "PENDING" && typeof existing.claimedAtEpochSeconds === "number" &&
      at() - existing.claimedAtEpochSeconds > CHAT_CONFIG.idempotencyPendingSeconds;
    if (!stale || !(await table.updateIf(itemKey, { claimedAtEpochSeconds: at() },
      { status: "PENDING", claimedAtEpochSeconds: existing!.claimedAtEpochSeconds }))) {
      throw new RequestError(409, "IDEMPOTENCY_IN_PROGRESS", "A request with this Idempotency-Key is already being processed.");
    }
  }
  let value: T;
  try { value = await run(); }
  catch (error) { await table.delete(itemKey).catch(() => undefined); throw error; }
  await table.updateIf(itemKey, { status: "COMPLETED", result: JSON.stringify(value) }, { status: "PENDING" })
    .catch(() => undefined);
  return { value, replayed: false };
}

/** Reads the Idempotency-Key header (case-insensitive) from an API Gateway event. */
export function idempotencyHeader(headers: Record<string, string | undefined> | null | undefined): string | undefined {
  const entry = Object.entries(headers ?? {}).find(([name]) => name.toLowerCase() === "idempotency-key");
  return parseIdempotencyKey(entry?.[1]);
}
