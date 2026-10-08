import { z } from "zod";
import { RequestError } from "../lib/http";
import { identifier } from "./schemas";
import { keys, type EntityKey } from "./keys";

export interface ListScope {
  actorUserId: string;
  orgId: string;
  kind: "customers" | "leads" | "owner-properties" | "org-properties";
}
export type PageKey = EntityKey & Partial<{ GSI1PK: string; GSI1SK: string; GSI2PK: string; GSI2SK: string }>;
const envelope = z.object({
  v: z.literal(1), actorUserId: identifier, orgId: identifier,
  kind: z.enum(["customers", "leads", "owner-properties", "org-properties"]),
  key: z.record(z.string(), z.string().min(1).max(256)),
}).strict();

function invalidCursor(): never { throw new RequestError(400, "INVALID_CURSOR", "Use a pagination cursor from this account and listing."); }

function checkedKey(input: unknown, scope: ListScope): PageKey {
  const result = z.record(z.string(), z.string()).safeParse(input);
  if (!result.success) return invalidCursor();
  const key = result.data;
  const propertyListing = scope.kind.endsWith("properties");
  const index = scope.kind === "owner-properties" ? "GSI1" : "GSI2";
  const allowed = propertyListing ? ["PK", "SK", `${index}PK`, `${index}SK`] : ["PK", "SK"];
  if (Object.keys(key).length !== allowed.length || allowed.some(name => typeof key[name] !== "string")) return invalidCursor();
  if (!propertyListing) {
    const prefix = scope.kind === "customers" ? "CUSTOMER#" : "LEAD#";
    if (key.PK !== `ORG#${scope.orgId}` || !key.SK.startsWith(prefix) || !identifier.safeParse(key.SK.slice(prefix.length)).success) return invalidCursor();
  } else {
    if (!key.PK.startsWith("CUSTOMER#") || !identifier.safeParse(key.PK.slice(9)).success ||
      !key.SK.startsWith("PROPERTY#") || !identifier.safeParse(key.SK.slice(9)).success) return invalidCursor();
    const expected = keys.propertyIndexes(scope.actorUserId, scope.orgId, key.SK.slice(9));
    if (key[`${index}PK`] !== expected[`${index}PK`] || key[`${index}SK`] !== expected[`${index}SK`]) return invalidCursor();
  }
  return { PK: key.PK, SK: key.SK, ...(propertyListing ? { [`${index}PK`]: key[`${index}PK`], [`${index}SK`]: key[`${index}SK`] } : {}) };
}

export function decodeCursor(cursor: string | undefined, scope: ListScope): PageKey | undefined {
  if (cursor === undefined) return undefined;
  if (cursor.length > 2_048 || !/^[A-Za-z0-9_-]+$/.test(cursor)) return invalidCursor();
  let parsed: unknown;
  try {
    const decoded = Buffer.from(cursor, "base64url");
    if (decoded.toString("base64url") !== cursor) return invalidCursor();
    parsed = JSON.parse(decoded.toString("utf8"));
  } catch { return invalidCursor(); }
  const result = envelope.safeParse(parsed);
  if (!result.success || result.data.actorUserId !== scope.actorUserId || result.data.orgId !== scope.orgId || result.data.kind !== scope.kind) return invalidCursor();
  return checkedKey(result.data.key, scope);
}

export function encodeCursor(key: unknown, scope: ListScope): string | undefined {
  if (key === undefined) return undefined;
  return Buffer.from(JSON.stringify({ v: 1, ...scope, key: checkedKey(key, scope) })).toString("base64url");
}
