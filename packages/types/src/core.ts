import type { AnalysisSource, LeadStatus, UserRole } from "./index";

export type CoreOrganizationKind = "PERSONAL" | "BROKER";
export type CoreCustomerKind = "SELF" | "CUSTOMER";

export interface CoreEntityDto {
  schemaVersion: 1;
  createdAt: string;
  updatedAt: string;
}

export interface CoreUserDto extends CoreEntityDto {
  userId: string;
  email: string;
  name: string;
  role: UserRole;
  organizationId: string;
}

export interface CoreOrganizationDto extends CoreEntityDto {
  organizationId: string;
  name: string;
  kind: CoreOrganizationKind;
}

export interface CoreCustomerDto extends CoreEntityDto {
  customerId: string;
  kind: CoreCustomerKind;
  status: "NEW";
  name: string;
  email?: string;
  phone?: string;
}

export interface CorePropertyDto extends CoreEntityDto {
  propertyId: string;
  customerId: string;
  label: string;
  address: string;
}

export interface CoreLeadDto extends CoreEntityDto {
  leadId: string;
  name: string;
  email?: string;
  phone?: string;
  status: LeadStatus;
  revision: number;
}

export interface CoreBootstrapRequest { organizationName?: string }
export interface CoreContactRequest { name: string; email?: string; phone?: string }
export interface CorePropertyRequest { label: string; address: string; customerId?: string }
export interface CorePageRequest { cursor?: string; limit?: number }

export interface CoreResponse {
  schemaVersion: 1;
  source: "DYNAMODB";
  requestId: string;
}
export interface CoreUserResponse extends CoreResponse { user: CoreUserDto }
export interface CoreOrganizationResponse extends CoreResponse { organization: CoreOrganizationDto }
export interface CoreBootstrapResponse extends CoreUserResponse {
  organization: CoreOrganizationDto;
  customer?: CoreCustomerDto;
}
export interface CoreCustomerResponse extends CoreResponse { customer: CoreCustomerDto }
export interface CorePropertyResponse extends CoreResponse { property: CorePropertyDto }
export interface CoreLeadResponse extends CoreResponse { lead: CoreLeadDto }
export interface CoreCustomersResponse extends CoreResponse { customers: CoreCustomerDto[]; nextCursor?: string }
export interface CorePropertiesResponse extends CoreResponse { properties: CorePropertyDto[]; nextCursor?: string }
export interface CoreLeadsResponse extends CoreResponse { leads: CoreLeadDto[]; nextCursor?: string }

// Roof metadata only; financial and policy calculations belong to later phases.
export interface CoreRoofAnalysisInput {
  schemaVersion: 1;
  source: AnalysisSource;
  measuredAt: string;
  roofAreaSquareMeters: number;
  segmentCount: number;
}
export interface CoreSolarCachePayload {
  schemaVersion: 1;
  source: AnalysisSource;
  measuredAt: string;
  roofAreaSquareMeters: number;
  segmentCount: number;
}
