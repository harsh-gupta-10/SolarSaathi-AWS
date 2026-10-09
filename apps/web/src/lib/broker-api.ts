import { z } from "zod";
import { getAuthenticated, patchAuthenticated, postAuthenticated, RoofRequestError } from "./roof-api";

const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/);
const stamp = z.iso.datetime({ offset: true });
const entity = { schemaVersion: z.literal(1), createdAt: stamp, updatedAt: stamp };
const customer = z.object({ ...entity, customerId: id, kind: z.enum(["CUSTOMER", "SELF"]),
  status: z.literal("NEW"), name: z.string().min(1), email: z.email().optional(), phone: z.string().optional() });
const property = z.object({ ...entity, propertyId: id, customerId: id,
  label: z.string().min(1), address: z.string().min(1) });
const leadStatus = z.enum(["NEW", "CONTACTED", "SITE_VISIT", "PROPOSAL", "INSTALLATION", "COMPLETED", "LOST"]);
const lead = z.object({ ...entity, leadId: id, name: z.string().min(1), status: leadStatus,
  revision: z.number().int().positive(),
  email: z.email().optional(), phone: z.string().optional() });
const envelope = { schemaVersion: z.literal(1), source: z.literal("DYNAMODB"), requestId: z.string().min(1) };
const customerPage = z.object({ ...envelope, customers: z.array(customer).max(50), nextCursor: z.string().optional() });
const propertyPage = z.object({ ...envelope, properties: z.array(property).max(50), nextCursor: z.string().optional() });
const leadPage = z.object({ ...envelope, leads: z.array(lead).max(50), nextCursor: z.string().optional() });
const oneCustomer = z.object({ ...envelope, customer });
const oneProperty = z.object({ ...envelope, property });
const oneLead = z.object({ ...envelope, lead });

export type BrokerCustomer = z.infer<typeof customer>;
export type BrokerProperty = z.infer<typeof property>;
export type BrokerLead = z.infer<typeof lead>;
export type BrokerLeadStatus = z.infer<typeof leadStatus>;
export type BrokerCustomerPage = z.infer<typeof customerPage>;
export type BrokerPropertyPage = z.infer<typeof propertyPage>;
export type BrokerLeadPage = z.infer<typeof leadPage>;

const pagePath = (path: string, cursor?: string) => `${path}?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
const ensureCustomerProperty = (record: BrokerProperty, customerId: string) => {
  if (record.customerId !== customerId) throw new RoofRequestError("INVALID_RESPONSE", "The property belongs to a different customer.");
  return record;
};

export const brokerApi = {
  customers: (cursor?: string, signal?: AbortSignal): Promise<BrokerCustomerPage> =>
    getAuthenticated(pagePath("/customers", cursor), customerPage, signal),
  properties: (cursor?: string, signal?: AbortSignal): Promise<BrokerPropertyPage> =>
    getAuthenticated(pagePath("/properties", cursor), propertyPage, signal),
  property: async (propertyId: string, signal?: AbortSignal): Promise<BrokerProperty> => {
    const result = (await getAuthenticated(`/properties/${encodeURIComponent(propertyId)}`, oneProperty, signal)).property;
    if (result.propertyId !== propertyId) throw new RoofRequestError("INVALID_RESPONSE", "The property service returned a different record.");
    return result;
  },
  leads: (cursor?: string, signal?: AbortSignal): Promise<BrokerLeadPage> =>
    getAuthenticated(pagePath("/leads", cursor), leadPage, signal),
  createCustomer: async (values: { name: string; email?: string; phone?: string }, signal?: AbortSignal) =>
    (await postAuthenticated("/customers", values, oneCustomer, signal)).customer,
  createProperty: async (values: { customerId: string; label: string; address: string }, signal?: AbortSignal) =>
    ensureCustomerProperty((await postAuthenticated("/properties", values, oneProperty, signal)).property, values.customerId),
  createLead: async (values: { name: string; email?: string; phone?: string }, signal?: AbortSignal) =>
    (await postAuthenticated("/leads", values, oneLead, signal)).lead,
  updateLead: async (record: BrokerLead, status: BrokerLeadStatus, signal?: AbortSignal): Promise<BrokerLead> => {
    const result = (await patchAuthenticated(`/broker/leads/${encodeURIComponent(record.leadId)}`,
      { expectedRevision: record.revision, status }, oneLead, signal)).lead;
    if (result.leadId !== record.leadId || result.revision <= record.revision) {
      throw new RoofRequestError("INVALID_RESPONSE", "The lead update did not match this record.");
    }
    return result;
  },
};
