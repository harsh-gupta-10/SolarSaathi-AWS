import { z } from "zod";
import { RequestError } from "../lib/http";
import type { ItemTable } from "../lib/item-table";

/**
 * Per-analysis form drafts: the raw, user-reported answers typed into the sizing, cost and benefit steps.
 * A draft is never a result. Calculations and benefit decisions are always recomputed from it by the backend.
 * Stored under the property partition so property deletion purges it (see PROPERTY_CHILD_PREFIXES).
 */
export const DRAFT_TTL_DAYS = 90;
const SECTION_KEY = /^[A-Za-z][A-Za-z0-9]{0,39}$/;

const section = z.record(z.string().regex(SECTION_KEY), z.string().max(200))
  .refine(value => Object.keys(value).length <= 40, "Too many fields.");

export const draftInputSchema = z.strictObject({
  schemaVersion: z.literal(1),
  step: z.number().int().min(1).max(8).optional(),
  design: section.optional(),
  financial: section.optional(),
  benefit: section.optional(),
});
export type AnalysisDraft = z.infer<typeof draftInputSchema>;

export const draftKey = (propertyId: string, analysisId: string) => ({ PK: `PROPERTY#${propertyId}`, SK: `DRAFT#${analysisId}` });

export function parseDraft(body: unknown): AnalysisDraft {
  const parsed = draftInputSchema.safeParse(body);
  if (!parsed.success) throw new RequestError(400, "INVALID_REQUEST", "The saved form draft is invalid.");
  return parsed.data;
}

export async function readDraft(items: ItemTable, propertyId: string, analysisId: string, now: Date) {
  const item = await items.get(draftKey(propertyId, analysisId));
  if (!item) return undefined;
  if (typeof item.expiresAtEpochSeconds === "number" && item.expiresAtEpochSeconds <= Math.floor(now.getTime() / 1_000)) return undefined;
  const parsed = draftInputSchema.safeParse(item.draft);
  // A stored draft that no longer matches the schema is treated as absent rather than failing the whole step.
  if (!parsed.success || typeof item.updatedAt !== "string") return undefined;
  return { draft: parsed.data, updatedAt: item.updatedAt };
}

export async function writeDraft(items: ItemTable, input: {
  propertyId: string; analysisId: string; ownerUserId: string; draft: AnalysisDraft; now: Date; analysisExpiresAtEpochSeconds?: number;
}) {
  const nowEpoch = Math.floor(input.now.getTime() / 1_000);
  const ttl = nowEpoch + DRAFT_TTL_DAYS * 86_400;
  const expiresAtEpochSeconds = input.analysisExpiresAtEpochSeconds === undefined ? ttl : Math.min(ttl, input.analysisExpiresAtEpochSeconds);
  const updatedAt = input.now.toISOString();
  await items.put({ ...draftKey(input.propertyId, input.analysisId), entityType: "ANALYSIS_DRAFT", schemaVersion: 1,
    propertyId: input.propertyId, analysisId: input.analysisId, ownerUserId: input.ownerUserId,
    draft: input.draft, updatedAt, expiresAtEpochSeconds });
  return { draft: input.draft, updatedAt };
}
