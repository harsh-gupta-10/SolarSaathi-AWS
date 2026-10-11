import type { PriceBenchmarkV1 } from "@solarsaathi/calculations";
import { z } from "zod";
import { regionCodes } from "./states";

const text = (max: number) => z.string().trim().min(1).max(max)
  .refine(value => !Array.from(value).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127));
const httpsUrl = z.string().max(1_500).refine(value => {
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password; }
  catch { return false; }
});
const money = z.number().finite().min(10_000).max(500_000);

export const PRICE_RECORD_LIMITS = { minRupeesPerKw: 10_000, maxRupeesPerKw: 500_000 } as const;

export const priceBenchmarkSchema: z.ZodType<PriceBenchmarkV1> = z.object({
  schemaVersion: z.literal(1),
  benchmarkId: z.string().regex(/^PB-[A-Za-z0-9-]{4,64}$/),
  scope: z.object({ level: z.enum(["NATIONAL", "STATE", "DISCOM"]), state: z.enum(regionCodes).optional(),
    discom: text(64).optional() }).strict().refine(value =>
    value.level === "NATIONAL" ? !value.state && !value.discom :
      value.level === "STATE" ? !!value.state && !value.discom : !!value.state && !!value.discom),
  sizeBand: z.object({ minKw: z.number().finite().positive().max(1_000), maxKw: z.number().finite().positive().max(1_000) })
    .strict().refine(value => value.minKw <= value.maxKw),
  moduleClass: z.enum(["DCR", "NON_DCR"]),
  inverterType: z.enum(["STRING", "MICRO", "HYBRID", "UNSPECIFIED"]),
  rupeesPerKw: z.object({ min: money, typical: money, max: money }).strict()
    .refine(value => value.min <= value.typical && value.typical <= value.max),
  inclusions: z.array(text(120)).max(12),
  exclusions: z.array(text(120)).max(12),
  source: z.object({ url: httpsUrl, publisher: text(160),
    authorityTier: z.enum(["OFFICIAL", "DISCOM", "TRADE_PRESS", "INSTALLER", "OTHER"]), title: text(180).optional() }).strict(),
  publishedOn: z.iso.datetime({ offset: true }),
  lastCheckedAt: z.iso.datetime({ offset: true }),
  expiresAt: z.iso.datetime({ offset: true }),
  status: z.enum(["CANDIDATE", "APPROVED", "SUPERSEDED", "REJECTED"]),
}).strict() as z.ZodType<PriceBenchmarkV1>;

/** Admin-authored candidate. The server assigns id, status, lastCheckedAt and creator. */
export const createCandidateSchema = z.object({
  scope: z.object({ level: z.enum(["NATIONAL", "STATE", "DISCOM"]), state: z.enum(regionCodes).optional(),
    discom: text(64).optional() }).strict(),
  sizeBand: z.object({ minKw: z.number().finite().positive().max(1_000), maxKw: z.number().finite().positive().max(1_000) }).strict(),
  moduleClass: z.enum(["DCR", "NON_DCR"]),
  inverterType: z.enum(["STRING", "MICRO", "HYBRID", "UNSPECIFIED"]),
  rupeesPerKw: z.object({ min: money, typical: money, max: money }).strict(),
  inclusions: z.array(text(120)).max(12).default([]),
  exclusions: z.array(text(120)).max(12).default([]),
  source: z.object({ url: httpsUrl, publisher: text(160),
    authorityTier: z.enum(["OFFICIAL", "DISCOM", "TRADE_PRESS", "INSTALLER", "OTHER"]), title: text(180).optional() }).strict(),
  publishedOn: z.iso.datetime({ offset: true }),
  expiresAt: z.iso.datetime({ offset: true }),
}).strict();

export const approveSchema = z.object({ note: text(500).optional(), expiresAt: z.iso.datetime({ offset: true }).optional() }).strict();
export const rejectSchema = z.object({ reason: text(500) }).strict();
export const listBenchmarksQuerySchema = z.object({
  status: z.enum(["CANDIDATE", "APPROVED", "SUPERSEDED", "REJECTED"]).default("CANDIDATE"),
  cursor: z.string().min(1).max(2_048).optional(),
}).strict();
