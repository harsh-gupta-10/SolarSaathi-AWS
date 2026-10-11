import type { CurrentIdentityResponse } from "@solarsaathi/types";
import { AccessoriesService } from "../accessories/service";
import { ApplicationService } from "../applications/service";
import { DynamoApplicationRepository, type ApplicationRepository } from "../applications/storage";
import { BenefitsService } from "../benefits/service";
import { documentExecutor } from "../data/client";
import { CoreRepository } from "../data/repository";
import { CoreService } from "../data/service";
import { PolicyFinancialsService } from "../financials/policy-service";
import { FinancialsService } from "../financials/service";
import { fetchAllowlistedPageText } from "../international/fetch";
import { RequestError } from "../lib/http";
import { DynamoItemTable, type ItemTable } from "../lib/item-table";
import { DynamoPolicyPublicationRepository, type PolicyPublicationRepository } from "../policy/publication-storage";
import { DynamoPolicyRepository, type PolicyRepository } from "../policy/storage";
import { DynamoPolicyWorkflowRepository, type PolicyWorkflowRepository } from "../policy/workflow-storage";
import { BraveWebSearch } from "../pricing/brave";
import { isAllowedResearchHost } from "../pricing/domains";
import { PriceResearchService } from "../pricing/research";
import { PriceBenchmarkStore } from "../pricing/store";
import { SystemsService } from "../systems/service";
import { ChatLimits } from "./limits";
import { ProposalStore } from "./proposals";
import { ChatStore } from "./store";

/** Everything chat tools and confirmation may call. Narrow pick-types keep tests honest and prevent accidental reach. */
export interface ChatServices {
  core: Pick<CoreService, "listProperties" | "getProperty" | "listAnalyses" | "createProperty" | "confirmBuilding" |
  "saveConfirmedRoof" | "saveManualRoof" | "getRoofPreview" | "listCustomers">;
  systems: Pick<SystemsService, "recommend">;
  accessories: Pick<AccessoriesService, "recommend">;
  financials: Pick<FinancialsService, "estimate">;
  policyFinancials: Pick<PolicyFinancialsService, "estimate">;
  benefits: Pick<BenefitsService, "evaluate">;
  applications: Pick<ApplicationService, "list" | "get" | "create" | "transition">;
  publication: Pick<PolicyPublicationRepository, "listActive" | "getActive">;
  prices: Pick<PriceBenchmarkStore, "listUsable">;
  research?: Pick<PriceResearchService, "research">;
  proposals: Pick<ProposalStore, "create" | "confirm">;
  items: ItemTable;
}

export interface ChatRuntime {
  services: ChatServices;
  store: ChatStore;
  limits: ChatLimits;
  items: ItemTable;
  priceStore: PriceBenchmarkStore;
}

export interface ChatServiceEnvironment { AWS_REGION: string; CORE_TABLE_NAME?: string }
export interface ChatServiceDependencies {
  now?: () => Date;
  createItems?: (table: string, region: string) => ItemTable;
  createCore?: (table: string, region: string) => CoreRepository;
  createRecords?: (table: string, region: string) => PolicyRepository;
  createWorkflow?: (table: string, region: string) => PolicyWorkflowRepository;
  createPublication?: (table: string, region: string) => PolicyPublicationRepository;
  createApplications?: (core: string, policy: string, region: string) => ApplicationRepository;
  research?: ChatServices["research"];
}

/** Builds the in-process service graph shared by the streaming agent, REST confirmation and tests. */
export function createChatRuntime(environment: ChatServiceEnvironment, dependencies: ChatServiceDependencies = {}): ChatRuntime {
  const coreTable = environment.CORE_TABLE_NAME;
  const policyTable = process.env.POLICY_TABLE_NAME;
  if (!coreTable || !policyTable) throw new RequestError(503, "CHAT_STORAGE_NOT_CONFIGURED", "The assistant storage is not configured.");
  const region = environment.AWS_REGION;
  const now = dependencies.now ?? (() => new Date());
  const items = (dependencies.createItems ?? ((table, awsRegion) => new DynamoItemTable(table, awsRegion)))(coreTable, region);
  const core = new CoreService((dependencies.createCore ?? ((table, awsRegion) =>
    new CoreRepository(table, documentExecutor(awsRegion))))(coreTable, region), { now });
  const records = (dependencies.createRecords ?? ((table, awsRegion) => new DynamoPolicyRepository(table, awsRegion)))(policyTable, region);
  const workflow = (dependencies.createWorkflow ?? ((table, awsRegion) => new DynamoPolicyWorkflowRepository(table, awsRegion)))(policyTable, region);
  const publication = (dependencies.createPublication ?? ((table, awsRegion) => new DynamoPolicyPublicationRepository(table, awsRegion)))(policyTable, region);
  const applicationRepository = (dependencies.createApplications ?? ((core2, policy, awsRegion) =>
    new DynamoApplicationRepository(core2, policy, awsRegion)))(coreTable, policyTable, region);
  const benefits = new BenefitsService(core, records, workflow, publication, now);
  const financials = new FinancialsService(core);
  const systems = new SystemsService(core);
  const priceStore = new PriceBenchmarkStore(items, now);
  const research = dependencies.research ?? (process.env.BRAVE_SEARCH_API_KEY ?
    new PriceResearchService(priceStore, new BraveWebSearch(process.env.BRAVE_SEARCH_API_KEY),
      (url, checkedAt) => fetchAllowlistedPageText(url, isAllowedResearchHost, checkedAt), now) : undefined);
  const services: ChatServices = { core, systems, accessories: new AccessoriesService(systems), financials,
    policyFinancials: new PolicyFinancialsService(financials, benefits), benefits,
    applications: new ApplicationService(core, benefits, publication, applicationRepository, now),
    publication, prices: priceStore, ...(research ? { research } : {}), proposals: new ProposalStore(items, now), items };
  return { services, store: new ChatStore(items, now), limits: new ChatLimits(items, now), items, priceStore };
}

export type { CurrentIdentityResponse };
