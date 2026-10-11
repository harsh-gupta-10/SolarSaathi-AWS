import { z } from "zod";
import { getAuthenticated, putAuthenticated } from "./roof-api";

/** Raw answers typed into the sizing, cost and benefit steps. Never a result: everything is recomputed by the backend. */
const section = z.record(z.string(), z.string());
const draftSchema = z.object({ schemaVersion: z.literal(1), step: z.number().int().optional(),
  design: section.optional(), financial: section.optional(), benefit: section.optional(), outline: section.optional() });
export type AnalysisDraft = z.infer<typeof draftSchema>;
export type DraftSection = "design" | "financial" | "benefit" | "outline";

const envelope = { schemaVersion: z.literal(1), requestId: z.string().min(1), analysisId: z.string().min(1) };
const readResponse = z.object({ ...envelope, draft: draftSchema.nullable(), updatedAt: z.string().optional() });
const writeResponse = z.object({ ...envelope, draft: draftSchema, updatedAt: z.string() });

const path = (propertyId: string, analysisId: string) =>
  `/properties/${encodeURIComponent(propertyId)}/analyses/${encodeURIComponent(analysisId)}/draft`;

export const draftsApi = {
  get: async (propertyId: string, analysisId: string, signal?: AbortSignal) => {
    const response = await getAuthenticated(path(propertyId, analysisId), readResponse, signal);
    return response.draft ? { draft: response.draft, updatedAt: response.updatedAt } : undefined;
  },
  save: async (propertyId: string, analysisId: string, draft: AnalysisDraft, signal?: AbortSignal) =>
    putAuthenticated(path(propertyId, analysisId), draft, writeResponse, signal),
};
