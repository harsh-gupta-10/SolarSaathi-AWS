import { z } from "zod";
import { postAuthenticated, RoofRequestError } from "./roof-api";

const iso = z.iso.datetime({ offset: true });
const source = z.object({ title: z.string().min(1).max(500),
  url: z.url().refine(value => { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password && !url.port && !url.hash; }),
  authorityHost: z.string().min(1).max(255), sourceDate: iso.nullable(),
  checkedAt: iso, contentSha256: z.string().regex(/^[a-f0-9]{64}$/),
  verificationStatus: z.literal("LIVE_RESEARCHED"),
}).refine(value => new URL(value.url).hostname === value.authorityHost, { message: "Source URL host does not match its reviewed authority host." });
export const internationalResearchResponseSchema = z.object({ schemaVersion: z.literal(1),
  source: z.literal("LIVE_AUTHORITY_RESEARCH_V1"), requestId: z.string().min(1),
  status: z.enum(["LIVE_RESEARCHED", "INCOMPLETE", "UNAVAILABLE"]),
  jurisdiction: z.object({ countryCode: z.string().regex(/^[A-Z]{2}$/), region: z.string().nullable(),
    utility: z.string().nullable(), origin: z.enum(["EXPLICIT", "AMAZON_LOCATION"]) }),
  researchedAt: iso, expiresAt: iso.nullable(),
  cache: z.object({ status: z.enum(["HIT", "MISS", "NOT_STORED"]), version: z.literal(1) }),
  coverage: z.object({ complete: z.literal(false), reasonCodes: z.array(z.string().min(1).max(100)).max(50) }),
  sources: z.array(source).max(50), notCurated: z.literal(true), eligibilityEvaluated: z.literal(false),
  benefitAmountAvailable: z.literal(false),
});

export type InternationalResearchResponse = z.infer<typeof internationalResearchResponseSchema>;
export interface InternationalResearchInput {
  countryCode?: string; region?: string; utility?: string;
  location?: { latitude: number; longitude: number };
}
export const internationalApi = {
  research: async (input: InternationalResearchInput, signal?: AbortSignal): Promise<InternationalResearchResponse> => {
    const result = await postAuthenticated("/policies/research", input, internationalResearchResponseSchema, signal, 45_000);
    if (input.countryCode && result.jurisdiction.countryCode !== input.countryCode.toUpperCase()) {
      throw new RoofRequestError("INVALID_RESPONSE", "The research service returned a different country. Try again.");
    }
    if (input.location && result.jurisdiction.origin !== "AMAZON_LOCATION") {
      throw new RoofRequestError("INVALID_RESPONSE", "The research service did not verify the selected location.");
    }
    return result;
  },
};
