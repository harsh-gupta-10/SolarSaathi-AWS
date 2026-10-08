import type { APIGatewayProxyEvent } from "aws-lambda";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCognitoIdentityResolver } from "../src/auth/cognito";
import { createPolicyFinancialsHandler } from "../src/handlers/policy-financials";
import type { PolicyPublicationRepository } from "../src/policy/publication-storage";
import type { PolicyRepository } from "../src/policy/storage";
import type { PolicyWorkflowRepository } from "../src/policy/workflow-storage";
import { normalizeManual } from "../src/roof/normalize";
import { context, environment, request, sub, userOutput, verifierWithTestJwks } from "./auth-fixtures";
import { fixedNow, identity, setupData } from "./data-fixtures";

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.stubEnv("ENVIRONMENT", "test"); vi.stubEnv("LOG_LEVEL", "info");
  vi.stubEnv("CORE_TABLE_NAME", "test-core-table"); vi.stubEnv("POLICY_TABLE_NAME", "test-policy-table");
  vi.stubEnv("AWS_REGION", "ap-south-1");
  vi.stubEnv("COGNITO_USER_POOL_ID", environment.COGNITO_USER_POOL_ID);
  vi.stubEnv("COGNITO_CLIENT_ID", environment.COGNITO_CLIENT_ID);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

function event(body: unknown): APIGatewayProxyEvent {
  return { ...request(), resource: "/financials/policy-backed/estimate",
    path: "/v1/financials/policy-backed/estimate", httpMethod: "POST", body: JSON.stringify(body),
    headers: { ...request().headers, "content-type": "application/json" },
    requestContext: { ...request().requestContext, stage: "v1" } };
}

describe("policy-backed financial handler", () => {
  it("authenticates and returns base-only when the active verified policy catalog is empty", async () => {
    const { service, repository, memory } = setupData();
    await service.bootstrap(identity(sub), {});
    const property = await service.createProperty(identity(sub), { label: "Home", address: "123 Example Road, Mumbai" });
    const analysis = await service.saveManualRoof(identity(sub), property.propertyId,
      normalizeManual({ roofAreaSquareMeters: 100, lengthMeters: 10, widthMeters: 10 }, fixedNow.toISOString()));
    const resolver = createCognitoIdentityResolver({ createVerifier: () => verifierWithTestJwks(),
      createClient: () => ({ send: async () => userOutput() }) });
    const publication = { listActive: vi.fn(async () => []) } as unknown as PolicyPublicationRepository;
    const handler = createPolicyFinancialsHandler({ resolveIdentity: resolver,
      createCore: () => repository, createRecords: () => ({} as PolicyRepository),
      createWorkflow: () => ({} as PolicyWorkflowRepository), createPublication: () => publication,
      now: () => fixedNow });
    const before = memory.commands.length;
    const response = await handler(event({ propertyId: property.propertyId, analysisId: analysis.analysisId,
      demand: { kind: "CONSUMPTION", monthlyConsumptionKwh: 600 },
      generationKwhPerKwYear: 1_500, nominalKw: 3,
      financialInputs: { grossSystemCostRupees: 200_000, selfConsumptionFraction: 0.7,
        importTariffRupeesPerKwh: 10, exportRateRupeesPerKwh: 3, annualMaintenanceRupees: 5_000 },
      applicantFacts: { country: "IN", state: "MH", customerType: "RESIDENTIAL" } }), context);
    expect(response.statusCode).toBe(200);
    const result = JSON.parse(response.body);
    expect(result).toMatchObject({ source: "DETERMINISTIC_POLICY_FINANCIAL_V1", status: "UNAVAILABLE",
      reasonCodes: ["NO_ACTIVE_VERIFIED_RULES"], benefits: { status: "UNAVAILABLE" },
      base: { horizonYears: 25 } });
    expect(result).not.toHaveProperty("projection");
    expect(memory.commands.slice(before).every(command => command instanceof GetCommand)).toBe(true);
    expect(publication.listActive).toHaveBeenCalledWith(["IN", "IN-MH"], 17);
  });

  it("rejects wrong paths and methods before authentication", async () => {
    const handler = createPolicyFinancialsHandler({ resolveIdentity: async () => { throw new Error("auth should not run"); } });
    expect((await handler({ ...event({}), resource: "/financials/other", path: "/v1/financials/other" }, context)).statusCode)
      .toBe(404);
    expect((await handler({ ...event({}), httpMethod: "GET" }, context)).statusCode).toBe(405);
  });
});
