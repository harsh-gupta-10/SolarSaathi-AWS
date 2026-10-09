import { randomUUID } from "node:crypto";
import type { CurrentIdentityResponse } from "@solarsaathi/types";
import { RequestError } from "../lib/http";
import { databaseUnavailable } from "./client";
import { customerDto, leadDto, organizationDto, propertyDto, userDto } from "./dto";
import { keys } from "./keys";
import { CoreRepository } from "./repository";
import { normalizedRoofSchema } from "../roof/schemas";
import {
  bootstrapInputSchema, cachePayloadSchema, cacheSchema, contactInputSchema, GOOGLE_ROOF_RETENTION_DAYS,
  identifier, pageInputSchema, parseInput,
  propertyInputSchema, roofMetadataSchema,
  type StoredAnalysis, type StoredBuildingConfirmation, type StoredCache, type StoredCustomer, type StoredOrganization,
  type StoredProperty, type StoredRoofPreview, type StoredUser,
} from "./schemas";

const denied = () => new RequestError(403, "FORBIDDEN", "This operation is not permitted for this account.");
const missing = () => new RequestError(404, "NOT_FOUND", "The requested record was not found.");
interface Account { user: StoredUser; organization: StoredOrganization }
export interface ServiceDependencies { now?: () => Date; createId?: () => string }

export class CoreService {
  private readonly now: () => Date;
  private readonly createId: () => string;
  constructor(private readonly repository: CoreRepository, dependencies: ServiceDependencies = {}) {
    this.now = dependencies.now ?? (() => new Date());
    this.createId = dependencies.createId ?? randomUUID;
  }

  private metadata() {
    const at = this.now().toISOString();
    return { schemaVersion: 1 as const, revision: 1, createdAt: at, updatedAt: at };
  }

  private checkOrganization(identity: CurrentIdentityResponse, user: StoredUser, organization: StoredOrganization) {
    const actor = identity.profile;
    if (user.userId !== actor.userId || actor.cognitoSub !== actor.userId || actor.role !== user.role ||
      (actor.organizationId !== undefined && actor.organizationId !== user.orgId) || organization.orgId !== user.orgId ||
      (organization.ownerUserId !== user.userId && !organization.memberUserIds.includes(user.userId)) ||
      organization.kind !== (user.role === "BROKER" ? "BROKER" : "PERSONAL") ||
      (user.role === "HOMEOWNER" && organization.ownerUserId !== user.userId)) throw denied();
  }

  private async account(identity: CurrentIdentityResponse, brokerOnly = false): Promise<Account> {
    if (brokerOnly && identity.profile.role !== "BROKER") throw denied();
    const user = await this.repository.getUser(identity.profile.userId);
    if (!user) throw missing();
    const organization = await this.repository.getOrganization(user.orgId);
    if (!organization) throw denied();
    this.checkOrganization(identity, user, organization);
    if (brokerOnly && user.role !== "BROKER") throw denied();
    return { user, organization };
  }

  private async selfCustomer(account: Account): Promise<StoredCustomer> {
    const { user } = account;
    if (!user.selfCustomerId) throw databaseUnavailable();
    const customer = await this.repository.getCustomer(user.orgId, user.selfCustomerId);
    if (!customer || customer.kind !== "SELF" || customer.ownerUserId !== user.userId) throw databaseUnavailable();
    return customer;
  }

  async getUser(identity: CurrentIdentityResponse) { return userDto((await this.account(identity)).user); }
  async getOrganization(identity: CurrentIdentityResponse) { return organizationDto((await this.account(identity)).organization); }

  private async bootstrapResult(identity: CurrentIdentityResponse) {
    const account = await this.account(identity);
    return {
      user: userDto(account.user), organization: organizationDto(account.organization),
      ...(account.user.role === "HOMEOWNER" ? { customer: customerDto(await this.selfCustomer(account)) } : {}),
    };
  }

  async bootstrap(identity: CurrentIdentityResponse, body: unknown) {
    const input = parseInput(bootstrapInputSchema, body);
    if (!identity.emailVerified) throw denied();
    const actor = identity.profile;
    if (actor.role === "HOMEOWNER" && input.organizationName !== undefined) {
      throw new RequestError(400, "INVALID_REQUEST", "A personal account does not accept an organization name.");
    }
    if (await this.repository.getUser(actor.userId)) return this.bootstrapResult(identity);
    let organization: StoredOrganization;
    let createOrganization = false;
    if (actor.organizationId) {
      const stored = await this.repository.getOrganization(actor.organizationId);
      if (!stored || (stored.ownerUserId !== actor.userId && !stored.memberUserIds.includes(actor.userId)) ||
        stored.kind !== (actor.role === "BROKER" ? "BROKER" : "PERSONAL") ||
        (actor.role === "HOMEOWNER" && stored.ownerUserId !== actor.userId)) throw denied();
      organization = stored;
    } else {
      createOrganization = true;
      const orgId = this.createId();
      organization = {
        ...this.metadata(), ...keys.organization(orgId), entityType: "ORGANIZATION", orgId,
        ownerUserId: actor.userId, memberUserIds: [actor.userId], kind: actor.role === "BROKER" ? "BROKER" : "PERSONAL",
        name: actor.role === "BROKER" ? input.organizationName ?? "My solar organization" : "Personal workspace",
      };
    }
    const customerId = actor.role === "HOMEOWNER" ? this.createId() : undefined;
    const user: StoredUser = {
      ...this.metadata(), ...keys.user(actor.userId), entityType: "USER", userId: actor.userId,
      orgId: organization.orgId, email: actor.email, name: actor.name, role: actor.role,
      ...(customerId ? { selfCustomerId: customerId } : {}),
    };
    const customer: StoredCustomer | undefined = customerId ? {
      ...this.metadata(), ...keys.customer(organization.orgId, customerId), entityType: "CUSTOMER", customerId,
      orgId: organization.orgId, ownerUserId: actor.userId, kind: "SELF", status: "NEW", name: actor.name.slice(0, 120), email: actor.email,
    } : undefined;
    try {
      await this.repository.transactCreate([
        user, ...(createOrganization ? [organization] : []), ...(customer ? [customer] : []),
      ], createOrganization ? [] : [this.repository.organizationGuard(organization)]);
    } catch (error) {
      if (!(error instanceof RequestError) || error.code !== "DATABASE_CONFLICT") throw error;
      // Only a fully committed winner profile makes a racing bootstrap idempotent.
      if (!(await this.repository.getUser(actor.userId))) throw error;
    }
    return this.bootstrapResult(identity);
  }

  async createCustomer(identity: CurrentIdentityResponse, body: unknown) {
    const account = await this.account(identity, true);
    const input = parseInput(contactInputSchema, body);
    const customerId = this.createId();
    const record: StoredCustomer = {
      ...this.metadata(), ...keys.customer(account.user.orgId, customerId), ...input,
      entityType: "CUSTOMER", customerId, orgId: account.user.orgId, ownerUserId: account.user.userId, kind: "CUSTOMER", status: "NEW",
    };
    await this.repository.transactCreate([record], [this.repository.organizationGuard(account.organization)]);
    return customerDto(record);
  }

  async listCustomers(identity: CurrentIdentityResponse, options: unknown = {}) {
    const { user } = await this.account(identity, true);
    const page = parseInput(pageInputSchema, options);
    const result = await this.repository.listCustomers({ actorUserId: user.userId, orgId: user.orgId, kind: "customers" }, page.limit, page.cursor);
    return { customers: result.items.map(customerDto), ...(result.nextCursor ? { nextCursor: result.nextCursor } : {}) };
  }

  async createLead(identity: CurrentIdentityResponse, body: unknown) {
    const account = await this.account(identity, true);
    const input = parseInput(contactInputSchema, body);
    const leadId = this.createId();
    const record = {
      ...this.metadata(), ...keys.lead(account.user.orgId, leadId), ...input, entityType: "LEAD" as const,
      leadId, orgId: account.user.orgId, ownerUserId: account.user.userId, status: "NEW" as const,
    };
    await this.repository.transactCreate([record], [this.repository.organizationGuard(account.organization)]);
    return leadDto(record);
  }

  async listLeads(identity: CurrentIdentityResponse, options: unknown = {}) {
    const { user } = await this.account(identity, true);
    const page = parseInput(pageInputSchema, options);
    const result = await this.repository.listLeads({ actorUserId: user.userId, orgId: user.orgId, kind: "leads" }, page.limit, page.cursor);
    return { leads: result.items.map(leadDto), ...(result.nextCursor ? { nextCursor: result.nextCursor } : {}) };
  }

  private async ownedProperty(identity: CurrentIdentityResponse, propertyId: string): Promise<{ account: Account; property: StoredProperty }> {
    parseInput(identifier, propertyId);
    const account = await this.account(identity);
    const locator = await this.repository.getLocator(propertyId);
    if (!locator || locator.orgId !== account.user.orgId ||
      (account.user.role === "HOMEOWNER" && locator.ownerUserId !== account.user.userId)) throw missing();
    const property = await this.repository.getProperty(locator.customerId, propertyId);
    if (!property || property.orgId !== locator.orgId || property.ownerUserId !== locator.ownerUserId ||
      (account.user.role === "HOMEOWNER" && property.customerId !== account.user.selfCustomerId)) throw databaseUnavailable();
    return { account, property };
  }

  async getProperty(identity: CurrentIdentityResponse, propertyId: string) {
    return propertyDto((await this.ownedProperty(identity, propertyId)).property);
  }

  async createProperty(identity: CurrentIdentityResponse, body: unknown) {
    const account = await this.account(identity);
    const input = parseInput(propertyInputSchema, body);
    let customer: StoredCustomer;
    if (account.user.role === "HOMEOWNER") {
      if (input.customerId !== undefined) throw new RequestError(400, "INVALID_REQUEST", "A personal property uses the account's own customer.");
      customer = await this.selfCustomer(account);
    } else {
      if (!input.customerId) throw new RequestError(400, "INVALID_REQUEST", "A broker property requires a customer ID.");
      const stored = await this.repository.getCustomer(account.user.orgId, input.customerId);
      if (!stored || stored.kind !== "CUSTOMER") throw missing();
      customer = stored;
    }
    const propertyId = this.createId();
    const record: StoredProperty = {
      ...this.metadata(), ...keys.property(customer.customerId, propertyId),
      ...keys.propertyIndexes(account.user.userId, account.user.orgId, propertyId),
      entityType: "PROPERTY", propertyId, customerId: customer.customerId, ownerUserId: account.user.userId,
      orgId: account.user.orgId, address: input.address, label: input.label,
    };
    const locator = {
      ...this.metadata(), ...keys.locator(propertyId), entityType: "PROPERTY_LOCATOR" as const,
      propertyId, customerId: customer.customerId, ownerUserId: account.user.userId, orgId: account.user.orgId,
    };
    await this.repository.transactCreate([record, locator], [
      this.repository.organizationGuard(account.organization), { key: keys.customer(customer.orgId, customer.customerId), revision: customer.revision },
    ]);
    return propertyDto(record);
  }

  async listProperties(identity: CurrentIdentityResponse, options: unknown = {}) {
    const { user } = await this.account(identity);
    const page = parseInput(pageInputSchema, options);
    const result = await this.repository.listProperties({
      actorUserId: user.userId, orgId: user.orgId, kind: user.role === "BROKER" ? "org-properties" : "owner-properties",
    }, page.limit, page.cursor);
    if (user.role === "HOMEOWNER" && result.items.some(property => property.customerId !== user.selfCustomerId)) throw databaseUnavailable();
    return { properties: result.items.map(propertyDto), ...(result.nextCursor ? { nextCursor: result.nextCursor } : {}) };
  }

  // Internal persistence only: no HTTP endpoint accepts analysis/cache results.
  async saveAnalysis(identity: CurrentIdentityResponse, propertyId: string, roof: unknown): Promise<StoredAnalysis> {
    const { account, property } = await this.ownedProperty(identity, propertyId);
    const metadata = parseInput(roofMetadataSchema, roof);
    if (metadata.source === "GOOGLE_SOLAR") throw new RequestError(400, "INVALID_REQUEST", "Google roof analyses require a confirmed, expiring preview.");
    const analysisId = this.createId();
    const record: StoredAnalysis = {
      ...this.metadata(), ...keys.analysis(propertyId, analysisId), entityType: "SOLAR_ANALYSIS", analysisId, propertyId,
      ownerUserId: property.ownerUserId, orgId: property.orgId, roof: metadata,
    };
    await this.repository.transactCreate([record], [this.repository.organizationGuard(account.organization),
      { key: keys.property(property.customerId, property.propertyId), revision: property.revision }]);
    return record;
  }

  async getAnalysis(identity: CurrentIdentityResponse, propertyId: string, analysisId: string) {
    const { property } = await this.ownedProperty(identity, propertyId);
    parseInput(identifier, analysisId);
    const record = await this.repository.getAnalysis(propertyId, analysisId);
    if (!record) throw missing();
    if (record.orgId !== property.orgId || record.ownerUserId !== property.ownerUserId) throw databaseUnavailable();
    if (record.expiresAtEpochSeconds !== undefined && record.expiresAtEpochSeconds <= Math.floor(this.now().getTime() / 1_000)) throw missing();
    return record;
  }

  async listAnalyses(identity: CurrentIdentityResponse, propertyId: string, options: unknown = {}) {
    const { property } = await this.ownedProperty(identity, propertyId);
    const page = parseInput(pageInputSchema, options);
    const result = await this.repository.listAnalyses(propertyId, page.limit, page.cursor);
    if (result.items.some(record => record.orgId !== property.orgId || record.ownerUserId !== property.ownerUserId)) {
      throw databaseUnavailable();
    }
    const nowEpoch = Math.floor(this.now().getTime() / 1_000);
    const analyses = result.items.filter(record => !!record.roofModel &&
      (record.expiresAtEpochSeconds === undefined || record.expiresAtEpochSeconds > nowEpoch)).map(record => ({
      analysisId: record.analysisId, propertyId: record.propertyId, source: record.roof.source,
      measuredAt: record.roof.measuredAt, roofAreaSquareMeters: record.roof.roofAreaSquareMeters,
      segmentCount: record.roof.segmentCount,
      ...(record.expiresAtEpochSeconds === undefined ? {} : {
        expiresAt: new Date(record.expiresAtEpochSeconds * 1_000).toISOString(),
      }),
    }));
    return { analyses, ...(result.nextCursor ? { nextCursor: result.nextCursor } : {}) };
  }

  async saveRoofPreview(identity: CurrentIdentityResponse, propertyId: string, geocodePlaceId: string,
    selectedLocation: { latitude: number; longitude: number }, roof: unknown): Promise<StoredRoofPreview> {
    const { account, property } = await this.ownedProperty(identity, propertyId);
    const model = parseInput(normalizedRoofSchema, roof);
    if (model.source !== "GOOGLE_SOLAR" || !geocodePlaceId || geocodePlaceId.length > 256) {
      throw new RequestError(400, "INVALID_REQUEST", "The roof preview is invalid.");
    }
    const previewId = this.createId();
    const expiresAtEpochSeconds = Math.floor(this.now().getTime() / 1_000) + 15 * 60;
    const record: StoredRoofPreview = {
      ...this.metadata(), ...keys.roofPreview(propertyId, previewId), entityType: "ROOF_PREVIEW", propertyId, previewId,
      ownerUserId: property.ownerUserId, orgId: property.orgId, geocodePlaceId, selectedLocation, roof: model,
      expiresAtEpochSeconds, ...keys.googleRetention(expiresAtEpochSeconds),
    };
    await this.repository.transactCreate([record], [this.repository.organizationGuard(account.organization),
      { key: keys.property(property.customerId, property.propertyId), revision: property.revision }]);
    return record;
  }

  async getRoofPreview(identity: CurrentIdentityResponse, propertyId: string, previewId: string): Promise<StoredRoofPreview> {
    const { property } = await this.ownedProperty(identity, propertyId);
    parseInput(identifier, previewId);
    const record = await this.repository.getRoofPreview(propertyId, previewId);
    if (!record || record.expiresAtEpochSeconds <= Math.floor(this.now().getTime() / 1_000)) throw missing();
    if (record.orgId !== property.orgId || record.ownerUserId !== property.ownerUserId) throw databaseUnavailable();
    return record;
  }

  async confirmBuilding(identity: CurrentIdentityResponse, propertyId: string, previewId: string): Promise<StoredRoofPreview> {
    const { account, property } = await this.ownedProperty(identity, propertyId);
    const preview = await this.getRoofPreview(identity, propertyId, previewId);
    const confirmation: StoredBuildingConfirmation = {
      ...this.metadata(), ...keys.buildingConfirmation(propertyId, previewId), entityType: "BUILDING_CONFIRMATION",
      propertyId, previewId, ownerUserId: property.ownerUserId, orgId: property.orgId,
      expiresAtEpochSeconds: preview.expiresAtEpochSeconds,
    };
    try {
      await this.repository.transactCreate([confirmation], [this.repository.organizationGuard(account.organization),
        { key: keys.property(property.customerId, property.propertyId), revision: property.revision }]);
    } catch (error) {
      if (!(error instanceof RequestError) || error.code !== "DATABASE_CONFLICT") throw error;
      const existing = await this.repository.getBuildingConfirmation(propertyId, previewId);
      if (!existing || existing.ownerUserId !== property.ownerUserId || existing.orgId !== property.orgId ||
        existing.expiresAtEpochSeconds <= Math.floor(this.now().getTime() / 1_000)) throw error;
      await this.ownedProperty(identity, propertyId);
    }
    return preview;
  }

  private async saveRoofModel(identity: CurrentIdentityResponse, propertyId: string, analysisId: string,
    roof: unknown, googleExpiresAtEpochSeconds?: number): Promise<StoredAnalysis> {
    const { account, property } = await this.ownedProperty(identity, propertyId);
    const model = parseInput(normalizedRoofSchema, roof);
    const record: StoredAnalysis = {
      ...this.metadata(), ...keys.analysis(propertyId, analysisId), entityType: "SOLAR_ANALYSIS", analysisId, propertyId,
      ownerUserId: property.ownerUserId, orgId: property.orgId,
      roof: { schemaVersion: 1, source: model.source, measuredAt: model.measuredAt,
        roofAreaSquareMeters: model.roofAreaSquareMeters, segmentCount: model.segmentCount },
      roofModel: model,
      ...(model.source === "GOOGLE_SOLAR" && googleExpiresAtEpochSeconds !== undefined ? {
        expiresAtEpochSeconds: googleExpiresAtEpochSeconds, ...keys.googleRetention(googleExpiresAtEpochSeconds),
      } : {}),
    };
    await this.repository.transactCreate([record], [this.repository.organizationGuard(account.organization),
      { key: keys.property(property.customerId, property.propertyId), revision: property.revision }]);
    return record;
  }

  async saveConfirmedRoof(identity: CurrentIdentityResponse, propertyId: string, previewId: string): Promise<StoredAnalysis> {
    const preview = await this.getRoofPreview(identity, propertyId, previewId);
    const confirmation = await this.repository.getBuildingConfirmation(propertyId, previewId);
    if (!confirmation || confirmation.orgId !== preview.orgId || confirmation.ownerUserId !== preview.ownerUserId ||
      confirmation.expiresAtEpochSeconds <= Math.floor(this.now().getTime() / 1_000)) throw new RequestError(409, "BUILDING_NOT_CONFIRMED", "Confirm the building before confirming its roof.");
    const existing = await this.repository.getAnalysis(propertyId, previewId);
    if (existing) {
      if (existing.ownerUserId !== preview.ownerUserId || existing.orgId !== preview.orgId || !existing.roofModel) throw databaseUnavailable();
      return existing;
    }
    const measuredAtEpoch = Math.floor(Date.parse(preview.roof.measuredAt) / 1_000);
    const expiresAtEpoch = measuredAtEpoch + GOOGLE_ROOF_RETENTION_DAYS * 86_400;
    try { return await this.saveRoofModel(identity, propertyId, previewId, preview.roof, expiresAtEpoch); }
    catch (error) {
      if (!(error instanceof RequestError) || error.code !== "DATABASE_CONFLICT") throw error;
      return this.getAnalysis(identity, propertyId, previewId);
    }
  }

  saveManualRoof(identity: CurrentIdentityResponse, propertyId: string, roof: unknown): Promise<StoredAnalysis> {
    if (parseInput(normalizedRoofSchema, roof).source !== "MANUAL") throw new RequestError(400, "INVALID_REQUEST", "Manual roof input is required.");
    return this.saveRoofModel(identity, propertyId, this.createId(), roof);
  }

  async saveCache(identity: CurrentIdentityResponse, propertyId: string, cacheKey: string, version: number, expiresAtEpochSeconds: number, payload: unknown): Promise<StoredCache> {
    const { account, property } = await this.ownedProperty(identity, propertyId);
    parseInput(identifier, cacheKey);
    const cachePayload = parseInput(cachePayloadSchema, payload);
    const record = parseInput(cacheSchema, {
      ...this.metadata(), ...keys.cache(propertyId, cacheKey, version), entityType: "SOLAR_CACHE", cacheKey, version, propertyId,
      ownerUserId: property.ownerUserId, orgId: property.orgId, expiresAtEpochSeconds,
      ...(cachePayload.source === "GOOGLE_SOLAR" ? keys.googleRetention(expiresAtEpochSeconds) : {}),
      payload: cachePayload,
    });
    await this.repository.transactCreate([record], [this.repository.organizationGuard(account.organization),
      { key: keys.property(property.customerId, property.propertyId), revision: property.revision }]);
    return record;
  }

  async getCache(identity: CurrentIdentityResponse, propertyId: string, cacheKey: string, version: number) {
    const { property } = await this.ownedProperty(identity, propertyId);
    parseInput(identifier, cacheKey);
    if (!Number.isSafeInteger(version) || version < 1) throw new RequestError(400, "INVALID_REQUEST", "Provide a positive cache version.");
    const record = await this.repository.getCache(propertyId, cacheKey, version);
    if (!record || record.propertyId !== propertyId || record.orgId !== property.orgId || record.ownerUserId !== property.ownerUserId) return undefined;
    if (record.expiresAtEpochSeconds <= Math.floor(this.now().getTime() / 1_000)) return undefined;
    return record;
  }
}
