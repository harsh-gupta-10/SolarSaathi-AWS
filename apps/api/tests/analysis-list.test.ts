import { describe, expect, it } from "vitest";
import { keys } from "../src/data/keys";
import { normalizeManual } from "../src/roof/normalize";
import { fixedNow, identity, otherId, setupData } from "./data-fixtures";

describe("owner-scoped confirmed analysis listing", () => {
  it("returns only confirmed unexpired roof summaries with a property-bound cursor", async () => {
    const data = setupData();
    await data.service.bootstrap(identity(), {});
    await data.service.bootstrap(identity(otherId), {});
    const property = await data.service.createProperty(identity(), { label: "Home", address: "123 Example Road, Mumbai" });
    const roof = normalizeManual({ roofAreaSquareMeters: 100, lengthMeters: 10, widthMeters: 10 }, fixedNow.toISOString());
    const first = await data.service.saveManualRoof(identity(), property.propertyId, roof);
    const second = await data.service.saveManualRoof(identity(), property.propertyId, roof);
    const expired = await data.service.saveManualRoof(identity(), property.propertyId, roof);
    const record = data.memory.read(keys.analysis(property.propertyId, expired.analysisId))!;
    data.memory.seed({ PK: record.PK as string, SK: record.SK as string, ...record,
      expiresAtEpochSeconds: Math.floor(fixedNow.getTime() / 1_000) - 1 });
    const page1 = await data.service.listAnalyses(identity(), property.propertyId, { limit: 1 });
    expect(page1.analyses).toHaveLength(1);
    expect(page1.analyses[0]).toMatchObject({ propertyId: property.propertyId, source: "MANUAL",
      roofAreaSquareMeters: 100 });
    expect(page1.analyses[0]).not.toHaveProperty("roofModel");
    expect(page1.nextCursor).toBeDefined();
    const page2 = await data.service.listAnalyses(identity(), property.propertyId, { limit: 1, cursor: page1.nextCursor });
    expect(page2.analyses).toHaveLength(1);
    expect(new Set([page1.analyses[0]?.analysisId, page2.analyses[0]?.analysisId]))
      .toEqual(new Set([first.analysisId, second.analysisId]));
    const page3 = await data.service.listAnalyses(identity(), property.propertyId, { limit: 1, cursor: page2.nextCursor });
    expect(page3.analyses).toEqual([]);
    await expect(data.service.listAnalyses(identity(otherId), property.propertyId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(data.service.listAnalyses(identity(), property.propertyId, { cursor: "invalid" }))
      .rejects.toMatchObject({ code: "INVALID_CURSOR" });
  });
});
