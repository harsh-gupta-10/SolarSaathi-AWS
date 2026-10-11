export interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
    requestId: string;
  };
}

export interface HealthResponse {
  status: "ok";
  service: "solarsaathi-api";
  environment: "dev" | "test" | "prod";
  version: string;
  requestId: string;
}

export type UserRole = "HOMEOWNER" | "BROKER";

export type LeadStatus =
  | "NEW"
  | "CONTACTED"
  | "SITE_VISIT"
  | "PROPOSAL"
  | "INSTALLATION"
  | "COMPLETED"
  | "LOST";

export type AnalysisSource = "GOOGLE_SOLAR" | "MANUAL";

export interface UserProfile {
  userId: string;
  cognitoSub: string;
  email: string;
  name: string;
  role: UserRole;
  organizationId?: string;
}

export interface CurrentIdentityResponse {
  profile: UserProfile;
  emailVerified: boolean;
  source: "COGNITO";
  requestId: string;
}

export interface SolarAnalysis {
  analysisId: string;
  propertyId: string;
  systemKw: number;
  panelCount: number;
  usableRoofAreaSqFt: number;
  annualGenerationKwh: number;
  sunshineHours?: number;
  grossCost: number;
  subsidy: number;
  netCost: number;
  annualSavings: number;
  paybackYears: number;
  twentyFiveYearSavings: number;
  source: AnalysisSource;
  createdAt: string;
}

export type {
  CoreBootstrapRequest,
  CoreBootstrapResponse,
  CoreContactRequest,
  CoreCustomerDto,
  CoreCustomerResponse,
  CoreCustomersResponse,
  CoreEntityDto,
  CoreLeadDto,
  CoreLeadResponse,
  CoreLeadsResponse,
  CoreOrganizationDto,
  CoreOrganizationKind,
  CoreOrganizationResponse,
  CorePageRequest,
  CorePropertiesResponse,
  CorePropertyDto,
  CorePropertyRequest,
  CorePropertyResponse,
  CoreResponse,
  CoreRoofAnalysisInput,
  CoreSolarCachePayload,
  CoreUserDto,
  CoreUserResponse,
} from "./core";

export type {
  GeocodeCandidate,
  ManualRoofMeasurements,
  NormalizedRoofV1,
  RoofApiResponse,
  RoofBounds,
  RoofConfirmationResponse,
  RoofGeocodeResponse,
  RoofPoint,
  RoofPreviewResponse,
  RoofSegmentV1,
  SolarPanelSuggestionV1,
} from "./roof";
export * from "./chat";
