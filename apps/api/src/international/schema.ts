import { z } from "zod";

const cleanText = (max: number) => z.string().trim().min(1).max(max)
  .regex(/^[\p{L}\p{N}][\p{L}\p{N} .,'()&/-]*$/u);

export const researchInputSchema = z.strictObject({
  countryCode: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/).optional(),
  region: cleanText(80).optional(),
  utility: cleanText(120).optional(),
  location: z.strictObject({
    latitude: z.number().finite().min(-90).max(90),
    longitude: z.number().finite().min(-180).max(180),
  }).optional(),
}).refine(value => value.countryCode || value.location, "Select a country or share your location.");

export type ResearchInput = z.infer<typeof researchInputSchema>;
export type ResearchStatus = "LIVE_RESEARCHED" | "INCOMPLETE" | "UNAVAILABLE";
export interface ResearchSource {
  title: string;
  url: string;
  authorityHost: string;
  sourceDate: string | null;
  checkedAt: string;
  contentSha256: string;
  verificationStatus: "LIVE_RESEARCHED";
}
export interface ResearchResponse {
  schemaVersion: 1;
  source: "LIVE_AUTHORITY_RESEARCH_V1";
  requestId: string;
  status: ResearchStatus;
  jurisdiction: { countryCode: string; region: string | null; utility: string | null; origin: "EXPLICIT" | "AMAZON_LOCATION" };
  researchedAt: string;
  expiresAt: string | null;
  cache: { status: "HIT" | "MISS" | "NOT_STORED"; version: 1 };
  coverage: { complete: false; reasonCodes: string[] };
  sources: ResearchSource[];
  notCurated: true;
  eligibilityEvaluated: false;
  benefitAmountAvailable: false;
}
