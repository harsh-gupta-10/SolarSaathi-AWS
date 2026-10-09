import { describe, expect, it } from "vitest";
import { internationalResearchResponseSchema } from "../src/lib/international-api";

const valid = { schemaVersion: 1, source: "LIVE_AUTHORITY_RESEARCH_V1", requestId: "synthetic-request",
  status: "LIVE_RESEARCHED", jurisdiction: { countryCode: "US", region: null, utility: null, origin: "EXPLICIT" },
  researchedAt: "2026-10-09T08:00:00.000Z", expiresAt: null, cache: { status: "MISS", version: 1 },
  coverage: { complete: false, reasonCodes: [] }, sources: [{ title: "Example official source",
    url: "https://www.energy.gov/example", authorityHost: "www.energy.gov", sourceDate: null,
    checkedAt: "2026-10-09T08:00:00.000Z", contentSha256: "a".repeat(64), verificationStatus: "LIVE_RESEARCHED" }],
  notCurated: true, eligibilityEvaluated: false, benefitAmountAvailable: false };

describe("international research response boundary", () => {
  it("accepts a bounded source response but rejects an untrusted host or invalid page date", () => {
    expect(internationalResearchResponseSchema.safeParse(valid).success).toBe(true);
    expect(internationalResearchResponseSchema.safeParse({ ...valid,
      sources: [{ ...valid.sources[0], authorityHost: "unrelated.example" }] }).success).toBe(false);
    expect(internationalResearchResponseSchema.safeParse({ ...valid,
      sources: [{ ...valid.sources[0], sourceDate: "invalid" }] }).success).toBe(false);
  });

  it("requires research-only flags so a live lookup cannot be presented as a curated benefit decision", () => {
    expect(internationalResearchResponseSchema.safeParse({ ...valid, benefitAmountAvailable: true }).success).toBe(false);
    expect(internationalResearchResponseSchema.safeParse({ ...valid, coverage: { complete: true, reasonCodes: [] } }).success).toBe(false);
  });
});
