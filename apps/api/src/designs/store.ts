import { GetCommand, PutCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { z } from "zod";
import { databaseError, databaseUnavailable, type CoreExecutor } from "../data/client";
import { RequestError } from "../lib/http";
import { identifier } from "../data/schemas";
import { fingerprintSchema, designCandidateIdSchema, designCategorySchema } from "./schema";

const iso = z.iso.datetime();
const templateSchema = z.object({
  PK: z.string(), SK: z.literal("VERSION#1"), entityType: z.literal("DESIGN_TEMPLATE"),
  schemaVersion: z.literal(1), fingerprint: fingerprintSchema, category: designCategorySchema,
  candidateId: designCandidateIdSchema, roofSource: z.enum(["GOOGLE_SOLAR", "MANUAL"]),
  roofAreaBucket: z.number().int().nonnegative(), solarKw: z.number().finite().positive(),
  freeAreaBucket: z.number().int().nonnegative(),
  designSpec: z.object({ layoutVersion: z.literal(1),
    footprintWidthMeters: z.number().finite().positive().max(10),
    footprintDepthMeters: z.number().finite().positive().max(10),
    placementStrategy: z.literal("CENTER_LARGEST_FITTING_ZONE_ALLOW_ROTATION"),
    requiredAreaSquareMeters: z.number().finite().positive(),
    safetyNotes: z.array(z.string().min(1).max(300)).min(1).max(5) }).strict(),
  createdAt: iso,
}).strict();
const userDesignSchema = z.object({
  PK: z.string(), SK: z.string(), entityType: z.literal("USER_DESIGN"), schemaVersion: z.literal(1),
  designId: identifier, propertyId: identifier, analysisId: identifier, ownerUserId: identifier,
  orgId: identifier, candidateId: designCandidateIdSchema, fingerprint: fingerprintSchema,
  imageS3Key: z.string().regex(/^generated\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\.png$/).optional(),
  GSI3PK: z.literal("GOOGLE_ROOF_RETENTION").optional(), GSI3SK: z.number().int().positive().optional(),
  createdAt: iso, expiresAtEpochSeconds: z.number().int().positive(),
}).strict().refine(value => (value.GSI3PK === undefined && value.GSI3SK === undefined) ||
  (value.GSI3PK === "GOOGLE_ROOF_RETENTION" && value.GSI3SK === value.expiresAtEpochSeconds));

export type StoredDesignTemplate = z.infer<typeof templateSchema>;
export type StoredUserDesign = z.infer<typeof userDesignSchema>;

function valid<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw databaseUnavailable();
  return parsed.data;
}

export class DesignStore {
  constructor(private readonly tableName: string, private readonly execute: CoreExecutor) {}
  private async send(command: GetCommand | PutCommand | TransactWriteCommand) {
    try { return await this.execute(command); } catch (error) { throw databaseError(error); }
  }
  async getTemplate(fingerprint: string): Promise<StoredDesignTemplate | undefined> {
    valid(fingerprintSchema, fingerprint);
    const { Item } = await this.send(new GetCommand({ TableName: this.tableName,
      Key: { PK: `DESIGN#${fingerprint}`, SK: "VERSION#1" }, ConsistentRead: true }));
    if (Item === undefined) return undefined;
    const record = valid(templateSchema, Item);
    if (record.PK !== `DESIGN#${fingerprint}` || record.fingerprint !== fingerprint) throw databaseUnavailable();
    return record;
  }
  async createTemplate(record: StoredDesignTemplate): Promise<StoredDesignTemplate> {
    valid(templateSchema, record);
    try {
      await this.send(new PutCommand({ TableName: this.tableName, Item: record,
        ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)" }));
      return record;
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== "DATABASE_CONFLICT") throw error;
      const existing = await this.getTemplate(record.fingerprint);
      if (!existing || existing.category !== record.category || existing.candidateId !== record.candidateId ||
        existing.roofSource !== record.roofSource || existing.solarKw !== record.solarKw ||
        existing.roofAreaBucket !== record.roofAreaBucket || existing.freeAreaBucket !== record.freeAreaBucket ||
        JSON.stringify(existing.designSpec) !== JSON.stringify(record.designSpec)) throw databaseUnavailable();
      return existing;
    }
  }
  async createUserDesign(record: StoredUserDesign): Promise<void> {
    valid(userDesignSchema, record);
    await this.send(new PutCommand({ TableName: this.tableName, Item: record,
      ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)" }));
  }
  async claimImageGeneration(propertyId: string, designId: string, ownerUserId: string, actorUserId: string,
    analysisId: string, fingerprint: string, now: Date, expiresAtEpochSeconds?: number): Promise<boolean> {
    valid(identifier, propertyId); valid(identifier, designId); valid(identifier, ownerUserId); valid(identifier, actorUserId);
    valid(identifier, analysisId); valid(fingerprintSchema, fingerprint);
    const item = { PK: `PROPERTY#${propertyId}`, SK: `DESIGN_CLAIM#${designId}`,
      entityType: "DESIGN_GENERATION_CLAIM", schemaVersion: 1, propertyId, designId,
      ownerUserId, actorUserId, analysisId, fingerprint,
      ...(expiresAtEpochSeconds === undefined ? {} : { expiresAtEpochSeconds,
        GSI3PK: "GOOGLE_ROOF_RETENTION", GSI3SK: expiresAtEpochSeconds }) };
    const day = now.toISOString().slice(0, 10);
    const budgetExpiry = Math.floor(Date.parse(`${day}T00:00:00.000Z`) / 1_000) + 3 * 86_400;
    const counter = (key: string, maximum: number) => ({ Update: {
      TableName: this.tableName, Key: { PK: `DESIGN_BUDGET#${day}`, SK: key },
      UpdateExpression: "SET #count = if_not_exists(#count, :zero) + :one, expiresAtEpochSeconds = :expire",
      ConditionExpression: "attribute_not_exists(#count) OR #count < :max",
      ExpressionAttributeNames: { "#count": "attempts" },
      ExpressionAttributeValues: { ":zero": 0, ":one": 1, ":max": maximum, ":expire": budgetExpiry },
    } });
    try {
      await this.send(new TransactWriteCommand({ TransactItems: [
        { Put: { TableName: this.tableName, Item: item,
          ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)" } },
        counter("GLOBAL", 20), counter(`USER#${actorUserId}`, 2),
      ] }));
      return true;
    } catch (error) {
      if (error instanceof RequestError && error.code === "DATABASE_CONFLICT") return false;
      throw error;
    }
  }
  async getUserDesign(propertyId: string, designId: string): Promise<StoredUserDesign | undefined> {
    valid(identifier, propertyId); valid(identifier, designId);
    const { Item } = await this.send(new GetCommand({ TableName: this.tableName,
      Key: { PK: `PROPERTY#${propertyId}`, SK: `DESIGN#${designId}` }, ConsistentRead: true }));
    if (Item === undefined) return undefined;
    const record = valid(userDesignSchema, Item);
    if (record.PK !== `PROPERTY#${propertyId}` || record.SK !== `DESIGN#${designId}` ||
      record.propertyId !== propertyId || record.designId !== designId) throw databaseUnavailable();
    return record;
  }
}
