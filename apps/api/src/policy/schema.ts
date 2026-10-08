import { z } from "zod";
import { policyDocumentTypeSchema, policyJurisdictionSchema, policySourceTypeSchema } from "@solarsaathi/policy";
import { RequestError } from "../lib/http";

const date = z.iso.date();
const sourceId = z.string().regex(/^SRC#[a-f0-9]{32}$/);

export const registerSourceRequestSchema = z.object({
  name: z.string().trim().min(1).max(200),
  publisherName: z.string().trim().min(1).max(200),
  jurisdiction: policyJurisdictionSchema,
  sourceType: policySourceTypeSchema,
  canonicalUrl: z.url().max(2_048),
  crawlFrequency: z.enum(["DAILY", "WEEKLY", "MONTHLY", "ON_DEMAND"]),
  freshnessWindowHours: z.number().int().min(1).max(8_760),
}).strict();

export const ingestDocumentRequestSchema = z.object({
  sourceId,
  version: z.number().int().positive().max(1_000_000),
  title: z.string().trim().min(1).max(300),
  documentType: policyDocumentTypeSchema,
  mimeType: z.enum(["text/html", "application/pdf"]),
  documentUrl: z.url().max(2_048).optional(),
  contentBase64: z.string().min(4).max(2_800_000).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
  publishedAt: date.optional(),
  effectiveFrom: date.optional(),
  effectiveTo: date.optional(),
}).strict();

export type RegisterSourceRequest = z.infer<typeof registerSourceRequestSchema>;
export type IngestDocumentRequest = z.infer<typeof ingestDocumentRequestSchema>;

export function parsePolicyRequest<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new RequestError(400, "INVALID_REQUEST", "The policy request contains invalid fields.");
  return parsed.data;
}
