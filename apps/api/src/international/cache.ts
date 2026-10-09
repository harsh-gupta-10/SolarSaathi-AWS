import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { z } from "zod";
import { databaseError, type CoreExecutor } from "../data/client";
import type { ResearchResponse } from "./schema";
import { officialUrl, supportedCountry } from "./registry";

const responseSchema = z.strictObject({
  schemaVersion: z.literal(1), source: z.literal("LIVE_AUTHORITY_RESEARCH_V1"),
  requestId: z.string().min(1).max(128), status: z.enum(["LIVE_RESEARCHED", "INCOMPLETE", "UNAVAILABLE"]),
  jurisdiction: z.strictObject({ countryCode: z.string().regex(/^[A-Z]{2}$/),
    region: z.string().max(80).nullable(), utility: z.string().max(120).nullable(), origin: z.literal("EXPLICIT") }),
  researchedAt: z.iso.datetime(), expiresAt: z.iso.datetime().nullable(),
  cache: z.strictObject({ status: z.enum(["MISS", "NOT_STORED"]), version: z.literal(1) }),
  coverage: z.strictObject({ complete: z.literal(false), reasonCodes: z.array(z.string().regex(/^[A-Z_]+$/)).max(12) }),
  sources: z.array(z.strictObject({ title: z.string().min(1).max(180), url: z.url().max(1_500),
    authorityHost: z.string().min(1).max(100), sourceDate: z.iso.datetime().nullable(),
    checkedAt: z.iso.datetime(), contentSha256: z.string().regex(/^[a-f0-9]{64}$/),
    verificationStatus: z.literal("LIVE_RESEARCHED") })).max(3),
  notCurated: z.literal(true), eligibilityEvaluated: z.literal(false), benefitAmountAvailable: z.literal(false),
});

const cachedSchema = z.strictObject({
  PK: z.string().regex(/^INTL_RESEARCH#[a-f0-9]{64}$/), SK: z.literal("VERSION#1"),
  entityType: z.literal("INTERNATIONAL_RESEARCH_CACHE"), schemaVersion: z.literal(1),
  researchedAt: z.iso.datetime(), expiresAtEpochSeconds: z.number().int().positive(),
  responseJson: z.string().max(30_000),
});

export class ResearchCache {
  constructor(private readonly tableName: string, private readonly execute: CoreExecutor) {}

  async get(hash: string, nowSeconds: number): Promise<ResearchResponse | undefined> {
    try {
      const result = await this.execute(new GetCommand({ TableName: this.tableName,
        Key: { PK: `INTL_RESEARCH#${hash}`, SK: "VERSION#1" }, ConsistentRead: true }));
      if (!result.Item) return undefined;
      const record = cachedSchema.parse(result.Item);
      if (record.PK !== `INTL_RESEARCH#${hash}` || record.SK !== "VERSION#1") return undefined;
      if (record.expiresAtEpochSeconds <= nowSeconds) return undefined;
      let data: unknown;
      try { data = JSON.parse(record.responseJson); }
      catch { return undefined; }
      const parsed = responseSchema.safeParse(data);
      if (!parsed.success) return undefined;
      const response = parsed.data;
      const country = response.jurisdiction.countryCode;
      if (!supportedCountry(country) || !response.expiresAt ||
        Math.floor(Date.parse(response.expiresAt) / 1_000) !== record.expiresAtEpochSeconds ||
        response.researchedAt !== record.researchedAt ||
        response.sources.some(source => officialUrl(source.url, country) !== source.url ||
          source.authorityHost !== new URL(source.url).hostname)) return undefined;
      return response;
    } catch (error) { throw databaseError(error); }
  }

  async put(hash: string, response: ResearchResponse, nowSeconds: number): Promise<boolean> {
    const expiry = response.expiresAt && Math.floor(Date.parse(response.expiresAt) / 1_000);
    if (!expiry || expiry <= nowSeconds) return false;
    try {
      await this.execute(new PutCommand({ TableName: this.tableName,
        Item: { PK: `INTL_RESEARCH#${hash}`, SK: "VERSION#1", entityType: "INTERNATIONAL_RESEARCH_CACHE",
          schemaVersion: 1, researchedAt: response.researchedAt, expiresAtEpochSeconds: expiry,
          responseJson: JSON.stringify(response) },
        ConditionExpression: "attribute_not_exists(PK) OR expiresAtEpochSeconds <= :now",
        ExpressionAttributeValues: { ":now": nowSeconds },
      }));
      return true;
    } catch (error) {
      if (error instanceof Error && error.name === "ConditionalCheckFailedException") return false;
      throw databaseError(error);
    }
  }
}
