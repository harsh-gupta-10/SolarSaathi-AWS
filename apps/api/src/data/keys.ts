export interface EntityKey { PK: string; SK: string }

export const keys = {
  user: (userId: string): EntityKey => ({ PK: `USER#${userId}`, SK: "PROFILE" }),
  organization: (orgId: string): EntityKey => ({ PK: `ORG#${orgId}`, SK: "PROFILE" }),
  customer: (orgId: string, customerId: string): EntityKey => ({ PK: `ORG#${orgId}`, SK: `CUSTOMER#${customerId}` }),
  property: (customerId: string, propertyId: string): EntityKey => ({ PK: `CUSTOMER#${customerId}`, SK: `PROPERTY#${propertyId}` }),
  locator: (propertyId: string): EntityKey => ({ PK: `PROPERTY#${propertyId}`, SK: "LOCATOR" }),
  analysis: (propertyId: string, analysisId: string): EntityKey => ({ PK: `PROPERTY#${propertyId}`, SK: `ANALYSIS#${analysisId}` }),
  roofPreview: (propertyId: string, previewId: string): EntityKey => ({ PK: `PROPERTY#${propertyId}`, SK: `ROOF_PREVIEW#${previewId}` }),
  buildingConfirmation: (propertyId: string, previewId: string): EntityKey => ({ PK: `PROPERTY#${propertyId}`, SK: `BUILDING_CONFIRMATION#${previewId}` }),
  lead: (orgId: string, leadId: string): EntityKey => ({ PK: `ORG#${orgId}`, SK: `LEAD#${leadId}` }),
  cache: (propertyId: string, cacheKey: string, version: number): EntityKey => ({
    PK: `CACHE#${propertyId}#${cacheKey}`, SK: `VERSION#${version}`,
  }),
  googleRetention: (expiresAtEpochSeconds: number) => ({
    GSI3PK: "GOOGLE_ROOF_RETENTION" as const, GSI3SK: expiresAtEpochSeconds,
  }),
  propertyIndexes: (userId: string, orgId: string, propertyId: string) => ({
    GSI1PK: `USER#${userId}`, GSI1SK: `PROPERTY#${propertyId}`,
    GSI2PK: `ORG#${orgId}`, GSI2SK: `PROPERTY#${propertyId}`,
  }),
};
