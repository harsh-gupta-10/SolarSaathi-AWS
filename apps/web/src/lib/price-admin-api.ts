import { z } from "zod";
import { getAuthenticated, postAuthenticated } from "./roof-api";

const timestamp = z.iso.datetime({ offset: true });
export const benefitStatus = z.enum(["CANDIDATE", "APPROVED", "SUPERSEDED", "REJECTED"]);
export type PriceStatus = z.infer<typeof benefitStatus>;
const money = z.number().finite();

export const priceBenchmark = z.object({
  schemaVersion: z.literal(1), benchmarkId: z.string(),
  scope: z.object({ level: z.enum(["NATIONAL", "STATE", "DISCOM"]), state: z.string().optional(), discom: z.string().optional() }),
  sizeBand: z.object({ minKw: z.number(), maxKw: z.number() }),
  moduleClass: z.enum(["DCR", "NON_DCR"]), inverterType: z.enum(["STRING", "MICRO", "HYBRID", "UNSPECIFIED"]),
  rupeesPerKw: z.object({ min: money, typical: money, max: money }),
  inclusions: z.array(z.string()), exclusions: z.array(z.string()),
  source: z.object({ url: z.string(), publisher: z.string(), authorityTier: z.enum(["OFFICIAL", "DISCOM", "TRADE_PRESS", "INSTALLER", "OTHER"]), title: z.string().optional() }),
  publishedOn: timestamp, lastCheckedAt: timestamp, expiresAt: timestamp, status: benefitStatus,
}).passthrough();
export type PriceBenchmark = z.infer<typeof priceBenchmark>;

const audit = z.object({ createdBy: z.string(), createdAt: timestamp, researchNotes: z.string().optional(), approvedBy: z.string().optional(),
  approvedAt: timestamp.optional(), approvalNote: z.string().optional(), rejectedBy: z.string().optional(), rejectedAt: timestamp.optional(),
  rejectionReason: z.string().optional(), supersededByBenchmarkId: z.string().optional() }).passthrough();
/** The API wraps each benchmark with its audit trail. */
export const storedBenchmark = z.object({ benchmark: priceBenchmark, audit }).passthrough();
export type StoredBenchmark = z.infer<typeof storedBenchmark>;
const listResponse = z.object({ status: benefitStatus, benchmarks: z.array(storedBenchmark), nextCursor: z.string().optional() }).passthrough();

export interface CreateCandidateInput {
  scope: { level: "NATIONAL" | "STATE" | "DISCOM"; state?: string; discom?: string };
  sizeBand: { minKw: number; maxKw: number };
  moduleClass: "DCR" | "NON_DCR"; inverterType: "STRING" | "MICRO" | "HYBRID" | "UNSPECIFIED";
  rupeesPerKw: { min: number; typical: number; max: number };
  inclusions: string[]; exclusions: string[];
  source: { url: string; publisher: string; authorityTier: PriceBenchmark["source"]["authorityTier"]; title?: string };
  publishedOn: string; expiresAt: string;
}

export const priceAdminApi = {
  list: (status: PriceStatus, cursor?: string, signal?: AbortSignal) => getAuthenticated(
    `/admin/pricing/benchmarks?status=${status}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, listResponse, signal),
  create: (input: CreateCandidateInput, signal?: AbortSignal) => postAuthenticated("/admin/pricing/benchmarks", input, storedBenchmark, signal),
  approve: (id: string, body: { note?: string; expiresAt?: string }, signal?: AbortSignal) =>
    postAuthenticated(`/admin/pricing/benchmarks/${encodeURIComponent(id)}/approve`, body, storedBenchmark, signal),
  reject: (id: string, reason: string, signal?: AbortSignal) =>
    postAuthenticated(`/admin/pricing/benchmarks/${encodeURIComponent(id)}/reject`, { reason }, storedBenchmark, signal),
};
