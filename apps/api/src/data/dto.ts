import type {
  CoreCustomerDto, CoreLeadDto, CoreOrganizationDto, CorePropertyDto, CoreUserDto,
} from "@solarsaathi/types";
import type { StoredCustomer, StoredLead, StoredOrganization, StoredProperty, StoredUser } from "./schemas";

const metadata = (record: { createdAt: string; updatedAt: string }) => ({
  schemaVersion: 1 as const, createdAt: record.createdAt, updatedAt: record.updatedAt,
});
export const userDto = (record: StoredUser): CoreUserDto => ({
  ...metadata(record), userId: record.userId, email: record.email, name: record.name,
  role: record.role, organizationId: record.orgId,
});
export const organizationDto = (record: StoredOrganization): CoreOrganizationDto => ({
  ...metadata(record), organizationId: record.orgId, kind: record.kind, name: record.name,
});
export const customerDto = (record: StoredCustomer): CoreCustomerDto => ({
  ...metadata(record), customerId: record.customerId, kind: record.kind, status: record.status, name: record.name,
  ...(record.email ? { email: record.email } : {}), ...(record.phone ? { phone: record.phone } : {}),
});
export const propertyDto = (record: StoredProperty): CorePropertyDto => ({
  ...metadata(record), propertyId: record.propertyId, customerId: record.customerId, label: record.label, address: record.address,
});
export const leadDto = (record: StoredLead): CoreLeadDto => ({
  ...metadata(record), leadId: record.leadId, name: record.name, status: record.status,
  ...(record.email ? { email: record.email } : {}), ...(record.phone ? { phone: record.phone } : {}),
});
