import { z } from "zod";
import { RequestError } from "../lib/http";
import { keys } from "./keys";
import { normalizedRoofSchema, roofPointSchema } from "../roof/schemas";

export const identifier = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/);
const cleanText = (min: number, max: number) => z.string().trim().min(min).max(max)
  .refine(value => !Array.from(value).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127));
const timestamp = z.iso.datetime();
const email = z.email().max(254);
const phone = z.string().regex(/^\+?[0-9][0-9 ()-]{6,24}$/);
const role = z.enum(["HOMEOWNER", "BROKER"]);
export const GOOGLE_ROOF_RETENTION_DAYS = 21;
const retention = { GSI3PK: z.literal("GOOGLE_ROOF_RETENTION").optional(), GSI3SK: z.number().int().positive().optional() };
const indexedRetention = (value: { source: "GOOGLE_SOLAR" | "MANUAL"; expiresAtEpochSeconds?: number; GSI3PK?: string; GSI3SK?: number }) =>
  value.source === "GOOGLE_SOLAR"
    ? value.expiresAtEpochSeconds !== undefined && value.GSI3PK === "GOOGLE_ROOF_RETENTION" && value.GSI3SK === value.expiresAtEpochSeconds
    : value.GSI3PK === undefined && value.GSI3SK === undefined;
const base = {
  PK: z.string().max(256), SK: z.string().max(256), schemaVersion: z.literal(1),
  createdAt: timestamp, updatedAt: timestamp, revision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
};
const acl = { ownerUserId: identifier, orgId: identifier };
const keyMatches = (value: { PK: string; SK: string }, expected: { PK: string; SK: string }) =>
  value.PK === expected.PK && value.SK === expected.SK;
const datesMatch = (value: { createdAt: string; updatedAt: string }) => value.updatedAt >= value.createdAt;

export const userSchema = z.object({
  ...base, entityType: z.literal("USER"), userId: identifier, orgId: identifier,
  email, name: cleanText(1, 256), role, selfCustomerId: identifier.optional(),
}).strict().refine(value => keyMatches(value, keys.user(value.userId)) &&
  (value.role === "HOMEOWNER" ? !!value.selfCustomerId : !value.selfCustomerId) && datesMatch(value));

export const organizationSchema = z.object({
  ...base, ...acl, entityType: z.literal("ORGANIZATION"), name: cleanText(1, 120),
  kind: z.enum(["PERSONAL", "BROKER"]), memberUserIds: z.array(identifier).max(100),
}).strict().refine(value => keyMatches(value, keys.organization(value.orgId)) && datesMatch(value) &&
  new Set(value.memberUserIds).size === value.memberUserIds.length &&
  value.memberUserIds.includes(value.ownerUserId) &&
  (value.kind !== "PERSONAL" || value.memberUserIds.every(id => id === value.ownerUserId)));

export const customerSchema = z.object({
  ...base, ...acl, entityType: z.literal("CUSTOMER"), customerId: identifier,
  kind: z.enum(["SELF", "CUSTOMER"]), status: z.literal("NEW"), name: cleanText(1, 120), email: email.optional(), phone: phone.optional(),
}).strict().refine(value => keyMatches(value, keys.customer(value.orgId, value.customerId)) && datesMatch(value));

export const propertySchema = z.object({
  ...base, ...acl, entityType: z.literal("PROPERTY"), propertyId: identifier, customerId: identifier,
  label: cleanText(1, 120), address: cleanText(8, 300),
  GSI1PK: z.string(), GSI1SK: z.string(), GSI2PK: z.string(), GSI2SK: z.string(),
}).strict().refine(value => keyMatches(value, keys.property(value.customerId, value.propertyId)) && datesMatch(value) &&
  Object.entries(keys.propertyIndexes(value.ownerUserId, value.orgId, value.propertyId))
    .every(([key, expected]) => value[key as "GSI1PK" | "GSI1SK" | "GSI2PK" | "GSI2SK"] === expected));

export const locatorSchema = z.object({
  ...base, ...acl, entityType: z.literal("PROPERTY_LOCATOR"), propertyId: identifier, customerId: identifier,
}).strict().refine(value => keyMatches(value, keys.locator(value.propertyId)) && datesMatch(value));

export const roofMetadataSchema = z.object({
  schemaVersion: z.literal(1), source: z.enum(["GOOGLE_SOLAR", "MANUAL"]), measuredAt: timestamp,
  roofAreaSquareMeters: z.number().finite().positive().max(1_000_000), segmentCount: z.number().int().min(1).max(1_000),
}).strict();

export const analysisSchema = z.object({
  ...base, ...acl, ...retention, entityType: z.literal("SOLAR_ANALYSIS"), propertyId: identifier, analysisId: identifier,
  roof: roofMetadataSchema, roofModel: normalizedRoofSchema.optional(),
  expiresAtEpochSeconds: z.number().int().positive().optional(),
}).strict().refine(value => keyMatches(value, keys.analysis(value.propertyId, value.analysisId)) && datesMatch(value) &&
  indexedRetention({ source: value.roof.source, expiresAtEpochSeconds: value.expiresAtEpochSeconds,
    GSI3PK: value.GSI3PK, GSI3SK: value.GSI3SK }) &&
  (!value.roofModel || value.roofModel.source === value.roof.source) &&
  (value.roof.source !== "GOOGLE_SOLAR" || (value.expiresAtEpochSeconds !== undefined &&
    value.expiresAtEpochSeconds > Math.floor(Date.parse(value.createdAt) / 1_000) &&
    value.expiresAtEpochSeconds <= Math.floor(Date.parse(value.createdAt) / 1_000) + GOOGLE_ROOF_RETENTION_DAYS * 86_400 &&
    value.expiresAtEpochSeconds <= Math.floor(Date.parse(value.roof.measuredAt) / 1_000) + GOOGLE_ROOF_RETENTION_DAYS * 86_400 &&
    (!value.roofModel || value.expiresAtEpochSeconds <= Math.floor(Date.parse(value.roofModel.measuredAt) / 1_000) + GOOGLE_ROOF_RETENTION_DAYS * 86_400))));

export const roofPreviewSchema = z.object({
  ...base, ...acl, entityType: z.literal("ROOF_PREVIEW"), propertyId: identifier, previewId: identifier,
  GSI3PK: z.literal("GOOGLE_ROOF_RETENTION"), GSI3SK: z.number().int().positive(),
  geocodePlaceId: z.string().min(1).max(256), selectedLocation: roofPointSchema,
  roof: normalizedRoofSchema, expiresAtEpochSeconds: z.number().int().positive(),
}).strict().refine(value => keyMatches(value, keys.roofPreview(value.propertyId, value.previewId)) && datesMatch(value) &&
  value.roof.source === "GOOGLE_SOLAR" && value.expiresAtEpochSeconds > Math.floor(Date.parse(value.createdAt) / 1_000) &&
  value.GSI3SK === value.expiresAtEpochSeconds &&
  value.expiresAtEpochSeconds <= Math.floor(Date.parse(value.roof.measuredAt) / 1_000) + GOOGLE_ROOF_RETENTION_DAYS * 86_400);

export const buildingConfirmationSchema = z.object({
  ...base, ...acl, entityType: z.literal("BUILDING_CONFIRMATION"), propertyId: identifier, previewId: identifier,
  expiresAtEpochSeconds: z.number().int().positive(),
}).strict().refine(value => keyMatches(value, keys.buildingConfirmation(value.propertyId, value.previewId)) && datesMatch(value) &&
  value.expiresAtEpochSeconds > Math.floor(Date.parse(value.createdAt) / 1_000));

export const leadSchema = z.object({
  ...base, ...acl, entityType: z.literal("LEAD"), leadId: identifier,
  status: z.enum(["NEW", "CONTACTED", "SITE_VISIT", "PROPOSAL", "INSTALLATION", "COMPLETED", "LOST"]),
  name: cleanText(1, 120), email: email.optional(), phone: phone.optional(),
}).strict().refine(value => keyMatches(value, keys.lead(value.orgId, value.leadId)) && datesMatch(value));

export const MAX_CACHE_PAYLOAD_BYTES = 16_384;
export const cachePayloadSchema = roofMetadataSchema.refine(value =>
  Buffer.byteLength(JSON.stringify(value), "utf8") <= MAX_CACHE_PAYLOAD_BYTES);
export const cacheSchema = z.object({
  ...base, ...acl, ...retention, entityType: z.literal("SOLAR_CACHE"), propertyId: identifier, cacheKey: identifier,
  version: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  expiresAtEpochSeconds: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), payload: cachePayloadSchema,
}).strict().refine(value => keyMatches(value, keys.cache(value.propertyId, value.cacheKey, value.version)) && datesMatch(value) &&
  indexedRetention({ source: value.payload.source, expiresAtEpochSeconds: value.expiresAtEpochSeconds,
    GSI3PK: value.GSI3PK, GSI3SK: value.GSI3SK }) &&
  value.expiresAtEpochSeconds > Math.floor(Date.parse(value.createdAt) / 1_000) &&
  (value.payload.source !== "GOOGLE_SOLAR" ||
    (value.expiresAtEpochSeconds <= Math.floor(Date.parse(value.createdAt) / 1_000) + GOOGLE_ROOF_RETENTION_DAYS * 86_400 &&
      value.expiresAtEpochSeconds <= Math.floor(Date.parse(value.payload.measuredAt) / 1_000) + GOOGLE_ROOF_RETENTION_DAYS * 86_400)));

export const entitySchema = z.union([
  userSchema, organizationSchema, customerSchema, propertySchema, locatorSchema, analysisSchema, leadSchema, cacheSchema,
  roofPreviewSchema, buildingConfirmationSchema,
]);
export type StoredEntity = z.infer<typeof entitySchema>;
export type StoredUser = z.infer<typeof userSchema>;
export type StoredOrganization = z.infer<typeof organizationSchema>;
export type StoredCustomer = z.infer<typeof customerSchema>;
export type StoredProperty = z.infer<typeof propertySchema>;
export type StoredLocator = z.infer<typeof locatorSchema>;
export type StoredAnalysis = z.infer<typeof analysisSchema>;
export type StoredRoofPreview = z.infer<typeof roofPreviewSchema>;
export type StoredBuildingConfirmation = z.infer<typeof buildingConfirmationSchema>;
export type StoredLead = z.infer<typeof leadSchema>;
export type StoredCache = z.infer<typeof cacheSchema>;

export const bootstrapInputSchema = z.object({ organizationName: cleanText(1, 120).optional() }).strict();
export const contactInputSchema = z.object({ name: cleanText(1, 120), email: email.optional(), phone: phone.optional() }).strict();
export const propertyInputSchema = z.object({
  label: cleanText(1, 120), address: cleanText(8, 300), customerId: identifier.optional(),
}).strict();
export const pageInputSchema = z.object({
  cursor: z.string().min(1).max(2_048).optional(), limit: z.number().int().min(1).max(50).default(20),
}).strict();

export function parseInput<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new RequestError(400, "INVALID_REQUEST", "The request does not match the supported schema.");
  return result.data;
}

export function parseStored<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new RequestError(503, "DATABASE_UNAVAILABLE", "Stored data could not be verified.");
  return result.data;
}
