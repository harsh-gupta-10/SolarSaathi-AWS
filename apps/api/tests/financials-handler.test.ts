import type { APIGatewayProxyEvent } from "aws-lambda";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCognitoIdentityResolver } from "../src/auth/cognito";
import { createFinancialsHandler } from "../src/handlers/financials";
import { normalizeManual } from "../src/roof/normalize";
import { context, environment, request, sub, userOutput, verifierWithTestJwks } from "./auth-fixtures";
import { fixedNow, identity, setupData } from "./data-fixtures";

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.stubEnv("ENVIRONMENT", "test"); vi.stubEnv("LOG_LEVEL", "info");
  vi.stubEnv("CORE_TABLE_NAME", "test-core-table"); vi.stubEnv("AWS_REGION", "ap-south-1");
  vi.stubEnv("COGNITO_USER_POOL_ID", environment.COGNITO_USER_POOL_ID);
  vi.stubEnv("COGNITO_CLIENT_ID", environment.COGNITO_CLIENT_ID);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

function event(body: unknown): APIGatewayProxyEvent {
  return { ...request(), resource: "/financials/estimate", path: "/v1/financials/estimate", httpMethod: "POST",
    body: JSON.stringify(body), headers: { ...request().headers, "content-type": "application/json" },
    requestContext: { ...request().requestContext, stage: "v1" } };
}

describe("financial estimate handler", () => {
  it("authenticates, reads only an owned analysis and returns a 25-year base estimate", async () => {
    const { service, repository, memory } = setupData();
    await service.bootstrap(identity(sub), {});
    const property = await service.createProperty(identity(sub), { label: "Home", address: "123 Example Road, Mumbai" });
    const analysis = await service.saveManualRoof(identity(sub), property.propertyId,
      normalizeManual({ roofAreaSquareMeters: 100, lengthMeters: 10, widthMeters: 10 }, fixedNow.toISOString()));
    const resolve = createCognitoIdentityResolver({ createVerifier: () => verifierWithTestJwks(),
      createClient: () => ({ send: async () => userOutput() }) });
    const handler = createFinancialsHandler({ resolveIdentity: resolve, createRepository: () => repository, now: () => fixedNow });
    const recordsBefore = memory.records.size;
    const commandsBefore = memory.commands.length;
    const response = await handler(event({ propertyId: property.propertyId, analysisId: analysis.analysisId,
      demand: { kind: "CONSUMPTION", monthlyConsumptionKwh: 600 }, generationKwhPerKwYear: 1_500, nominalKw: 3,
      financialInputs: { grossSystemCostRupees: 200_000, selfConsumptionFraction: 0.7,
        importTariffRupeesPerKwh: 10, exportRateRupeesPerKwh: 3, annualMaintenanceRupees: 5_000 } }), context);
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({ source: "DETERMINISTIC_BASE_FINANCIAL_V1",
      policyBenefitsEvaluated: false, financingModeled: false, analysisId: analysis.analysisId,
      financial: { horizonYears: 25, input: { system: { nominalKw: 3 } } } });
    expect(memory.records.size).toBe(recordsBefore);
    expect(memory.commands.slice(commandsBefore).every(command => command instanceof GetCommand)).toBe(true);
  });

  it("rejects unsupported routes and methods before identity lookup", async () => {
    const handler = createFinancialsHandler({ resolveIdentity: async () => { throw new Error("auth should not run"); } });
    const missing = await handler({ ...event({}), resource: "/financials/unknown", path: "/v1/financials/unknown" }, context);
    expect(missing.statusCode).toBe(404);
    const wrongMethod = await handler({ ...event({}), httpMethod: "GET" }, context);
    expect(wrongMethod.statusCode).toBe(405);
    expect(JSON.stringify([missing.body, wrongMethod.body])).not.toContain("auth should not run");
  });
});
