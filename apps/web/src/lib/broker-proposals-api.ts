import { z } from "zod";
import type { SystemDemand } from "@solarsaathi/calculations";
import type { BenefitApplicantFacts } from "./benefits-api";
import type { FinancialInputs } from "./financial-api";
import { policyFinancialEstimateResponseSchema } from "./policy-financial-api";
import { getAuthenticated, postAuthenticated, RoofRequestError } from "./roof-api";

const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/);
const stamp = z.iso.datetime({ offset: true });
const summary = z.object({ proposalId: id, customerId: id, propertyId: id, analysisId: id, createdAt: stamp,
  status: z.enum(["AVAILABLE", "PARTIAL", "UNAVAILABLE"]), policyStatus: z.enum(["AVAILABLE", "UNAVAILABLE"]),
  documentStatus: z.literal("NOT_GENERATED"), policyVersionIds: z.array(z.string().min(1)).max(16),
  sourceLastCheckedAt: stamp.nullable(), freshnessStatus: z.enum(["AS_OF_SNAPSHOT", "RECHECK_REQUIRED"]),
  expiresAt: stamp });
const snapshot = summary.extend({ financials: policyFinancialEstimateResponseSchema });
const preview = z.object({ customerId: id, propertyId: id, analysisId: id, createdAt: stamp,
  status: z.enum(["AVAILABLE", "PARTIAL", "UNAVAILABLE"]), documentStatus: z.literal("NOT_GENERATED"),
  financials: policyFinancialEstimateResponseSchema });
const list = z.object({ schemaVersion: z.literal(1), source: z.literal("BROKER_PROPOSAL_SNAPSHOT_V1"),
  requestId: z.string().min(1), customerId: id, proposals: z.array(summary).max(50), nextCursor: z.string().optional() });
const one = z.object({ schemaVersion: z.literal(1), source: z.literal("BROKER_PROPOSAL_SNAPSHOT_V1"),
  requestId: z.string().min(1), proposal: snapshot });
const onePreview = z.object({ schemaVersion: z.literal(1), source: z.literal("BROKER_PROPOSAL_PREVIEW_V1"),
  requestId: z.string().min(1), proposal: preview });
const design = z.object({ designId: id, analysisId: id, candidateId: id,
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/), createdAt: stamp,
  imageStatus: z.enum(["READY", "UNAVAILABLE"]), visualAccuracy: z.literal("INSPIRATIONAL_ONLY") });
const designList = z.object({ schemaVersion: z.literal(1), source: z.literal("PROPERTY_DESIGN_RECORDS_V1"),
  requestId: z.string().min(1), propertyId: id, designs: z.array(design).max(50), nextCursor: z.string().optional() });
const signedImage = z.object({ schemaVersion: z.literal(1), source: z.literal("PROPERTY_SCOPED_IMAGE"),
  requestId: z.string().min(1), designId: id, status: z.literal("READY"),
  url: z.url().refine(value => value.startsWith("https://")), expiresAt: stamp,
  visualAccuracy: z.literal("INSPIRATIONAL_ONLY") });

export type BrokerProposalSummary = z.infer<typeof summary>;
export type BrokerProposalSnapshot = z.infer<typeof snapshot>;
export type BrokerProposalPreview = z.infer<typeof preview>;
export type BrokerDesign = z.infer<typeof design>;
export interface BrokerProposalInput {
  customerId: string; propertyId: string; analysisId: string; demand: SystemDemand;
  generationKwhPerKwYear: number; nominalKw: number; financialInputs: FinancialInputs;
  applicantFacts: BenefitApplicantFacts; eligibleQuotedCostPaise?: number;
}
const customerPath = (customerId: string) => `/broker/customers/${encodeURIComponent(customerId)}/proposals`;
const page = (cursor?: string) => `?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
function scope<T extends { customerId: string; propertyId: string; analysisId: string; financials: {
  propertyId: string; analysisId: string } }>(value: T, input: Pick<BrokerProposalInput, "customerId" | "propertyId" | "analysisId">): T {
  if (value.customerId !== input.customerId || value.propertyId !== input.propertyId ||
    value.analysisId !== input.analysisId || value.financials.propertyId !== input.propertyId ||
    value.financials.analysisId !== input.analysisId) {
    throw new RoofRequestError("INVALID_RESPONSE", "The proposal response does not match the selected customer, property and roof.");
  }
  return value;
}

export const brokerProposalsApi = {
  list: async (customerId: string, cursor?: string, signal?: AbortSignal) => {
    const result = await getAuthenticated(`${customerPath(customerId)}${page(cursor)}`, list, signal);
    if (result.customerId !== customerId || result.proposals.some(item => item.customerId !== customerId)) {
      throw new RoofRequestError("INVALID_RESPONSE", "The proposal list belongs to a different customer.");
    }
    return result;
  },
  get: async (customerId: string, proposalId: string, signal?: AbortSignal): Promise<BrokerProposalSnapshot> => {
    const result = await getAuthenticated(`${customerPath(customerId)}/${encodeURIComponent(proposalId)}`, one, signal);
    if (result.proposal.customerId !== customerId || result.proposal.proposalId !== proposalId ||
      result.proposal.propertyId !== result.proposal.financials.propertyId ||
      result.proposal.analysisId !== result.proposal.financials.analysisId) {
      throw new RoofRequestError("INVALID_RESPONSE", "The saved proposal does not match this customer and roof.");
    }
    return result.proposal;
  },
  preview: async (input: BrokerProposalInput, signal?: AbortSignal): Promise<BrokerProposalPreview> =>
    scope((await postAuthenticated("/broker/proposals/preview", input, onePreview, signal, 30_000)).proposal, input),
  save: async (input: BrokerProposalInput, signal?: AbortSignal): Promise<BrokerProposalSnapshot> => {
    const { customerId, ...body } = input;
    return scope((await postAuthenticated(customerPath(customerId), body, one, signal, 30_000)).proposal, input);
  },
  designs: async (propertyId: string, cursor?: string, signal?: AbortSignal) => {
    const result = await getAuthenticated(`/broker/properties/${encodeURIComponent(propertyId)}/designs${page(cursor)}`,
      designList, signal);
    if (result.propertyId !== propertyId) throw new RoofRequestError("INVALID_RESPONSE", "The design list belongs to a different property.");
    return result;
  },
  image: async (propertyId: string, designId: string, signal?: AbortSignal) => {
    const result = await getAuthenticated(`/designs/${encodeURIComponent(designId)}/image?propertyId=${encodeURIComponent(propertyId)}`,
      signedImage, signal);
    if (result.designId !== designId) throw new RoofRequestError("INVALID_RESPONSE", "The image belongs to a different design.");
    return result;
  },
};
