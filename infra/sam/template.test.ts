import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseDocument } from "yaml";

interface Resource { Type: string; Properties: Record<string, unknown>; DeletionPolicy?: string; UpdateReplacePolicy?: string; }
interface Template { Transform: string; Resources: Record<string, Resource>; Parameters: Record<string, unknown>; }
const text = readFileSync(new URL("./template.yaml", import.meta.url), "utf8");
const document = parseDocument(text);
const template = document.toJS() as Template;
function properties(name: string) { return template.Resources[name].Properties; }

describe("SAM foundation and Cognito invariants (not schema validation)", () => {
  it("parses valid YAML below the inline template size limit", () => {
    expect(document.errors).toHaveLength(0);
    expect(Buffer.byteLength(text)).toBeLessThan(51_200);
    expect(template.Transform).toBe("AWS::Serverless-2016-10-31");
  });
  it("uses compiled handlers with explicit log destinations", () => {
    for (const name of ["HealthFunction", "AnalyzeFunction", "ChatFunction", "ProfileFunction", "CoreFunction", "RoofFunction", "SystemsFunction", "FinancialsFunction", "PolicyFunction", "PolicyCrawlerFunction", "RoofRetentionFunction"]) {
      expect(properties(name).CodeUri).toBe("../../apps/api/dist");
      expect(properties(name).Handler).toMatch(/^handlers\/[a-z-]+\.handler$/);
      expect(properties(name).LoggingConfig).toBeDefined();
    }
  });
  it("preserves stateful resources on deletion and replacement", () => {
    for (const name of ["AnalysesTable", "PolicyTable", "PolicyDocumentBucket", "UserPool"]) {
      expect(template.Resources[name].DeletionPolicy).toBe("Retain");
      expect(template.Resources[name].UpdateReplacePolicy).toBe("Retain");
    }
  });
  it("uses a public code-flow client, never an implicit grant or secret", () => {
    expect(properties("UserPoolClient").GenerateSecret).toBe(false);
    expect(properties("UserPoolClient").AllowedOAuthFlows).toEqual(["code"]);
    expect(properties("UserPoolClient").EnableTokenRevocation).toBe(true);
  });
  it("rotates refresh tokens without enabling the incompatible refresh auth flow", () => {
    expect(properties("UserPoolClient").RefreshTokenRotation).toMatchObject({ Feature: "ENABLED" });
    expect(properties("UserPoolClient").ExplicitAuthFlows).not.toContain("ALLOW_REFRESH_TOKEN_AUTH");
    expect(properties("UserPoolClient").AccessTokenValidity).toBe(15);
    expect(properties("UserPoolClient").RefreshTokenValidity).toBe(1);
  });
  it("keeps organization membership read-only for public clients", () => {
    expect(properties("UserPoolClient").ReadAttributes).toContain("custom:organizationId");
    expect(properties("UserPoolClient").WriteAttributes).not.toContain("custom:organizationId");
    expect(properties("UserPoolClient").WriteAttributes).not.toContain("custom:role");
  });
  it("backs managed login v2 with a branding resource", () => {
    expect(properties("UserPoolDomain").ManagedLoginVersion).toBe(2);
    expect(properties("ManagedLoginBranding").UseCognitoProvidedValues).toBe(true);
    expect(properties("UserPool").UserPoolTier).toBe("ESSENTIALS");
  });
  it("keeps Google secrets server-side behind dynamic secret references", () => {
    expect(properties("GoogleIdentityProvider").ProviderDetails).toMatchObject({ client_secret: expect.stringContaining("{{resolve:secretsmanager:") });
    expect(template.Parameters.EnableGoogleFederation).toMatchObject({ Default: "false" });
    expect(text).not.toContain("IdentityPool");
  });
  it("returns configured CORS headers for authorizer and gateway errors without overriding HTTP status", () => {
    const responses = properties("Api").GatewayResponses as Record<string, {
      ResponseParameters: { Headers: Record<string, string> };
      ResponseTemplates: Record<string, string>;
      StatusCode?: number;
    }>;
    for (const name of ["DEFAULT_4XX", "DEFAULT_5XX"]) {
      expect(responses[name].ResponseParameters.Headers).toMatchObject({ "Access-Control-Allow-Origin": expect.stringContaining("ApplicationOrigin") });
      expect(responses[name].StatusCode).toBeUndefined();
      expect(responses[name].ResponseTemplates).toMatchObject({ "application/json": expect.stringContaining("$context.requestId") });
    }
  });
  it("keeps current identity protected and backed by compiled code without privileged Cognito policies", () => {
    const profile = properties("ProfileFunction");
    const events = profile.Events as Record<string, { Properties: Record<string, unknown> }>;
    expect(events.CurrentIdentity.Properties).toMatchObject({ Path: "/me", Method: "GET" });
    expect(events.CurrentIdentity.Properties.Auth).toBeUndefined();
    expect(profile.Policies).toBeUndefined();
    expect(profile.Handler).toBe("handlers/profile.handler");
  });
  it("gates API product routes while keeping health and preflight public", () => {
    expect(properties("Api").Auth).toMatchObject({ DefaultAuthorizer: "CognitoUserPool", AddDefaultAuthorizerToCorsPreflight: false });
    const events = properties("HealthFunction").Events as Record<string, { Properties: Record<string, unknown> }>;
    expect(events.Health.Properties.Auth).toEqual({ Authorizer: "NONE" });
  });

  it("routes authenticated core operations through the stage-relative API", () => {
    const core = properties("CoreFunction");
    expect(core.Handler).toBe("handlers/core.handler");
    expect(core.Environment).toEqual({ Variables: { CORE_TABLE_NAME: "AnalysesTable" } });
    const events = core.Events as Record<string, { Properties: Record<string, unknown> }>;
    expect(Object.values(events).map(event => `${event.Properties.Method} ${event.Properties.Path}`).sort()).toEqual([
      "GET /users/me", "POST /users/bootstrap", "GET /organizations/me",
      "GET /customers", "POST /customers", "GET /properties", "POST /properties",
      "GET /properties/{propertyId}", "GET /leads", "POST /leads",
    ].sort());
    expect(Object.values(events).every(event => event.Properties.Auth === undefined)).toBe(true);
  });

  it("limits the core function to required table and index operations", () => {
    const core = properties("CoreFunction");
    const policies = core.Policies as { Statement: { Sid: string; Effect: string; Action: string | string[]; Resource: unknown }[] }[];
    expect(policies).toHaveLength(1);
    expect(policies[0]?.Statement).toEqual([
      expect.objectContaining({ Sid: "CoreTableItems", Effect: "Allow", Action: [
        "dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:ConditionCheckItem", "dynamodb:Query",
      ], Resource: "AnalysesTable.Arn" }),
      expect.objectContaining({ Sid: "CorePropertyIndexes", Effect: "Allow", Action: "dynamodb:Query", Resource: [
        "${AnalysesTable.Arn}/index/GSI1", "${AnalysesTable.Arn}/index/GSI2",
      ] }),
    ]);
    for (const name of ["HealthFunction", "AnalyzeFunction", "ChatFunction", "ProfileFunction"]) {
      expect(properties(name).Policies).toBeUndefined();
      expect(properties(name).Environment).toBeUndefined();
    }
  });

  it("indexes owner, organization and expiring Google roof records", () => {
    const table = properties("AnalysesTable");
    expect(table.TimeToLiveSpecification).toEqual({ AttributeName: "expiresAtEpochSeconds", Enabled: true });
    expect(table.GlobalSecondaryIndexes).toEqual([
      { IndexName: "GSI1", KeySchema: [
        { AttributeName: "GSI1PK", KeyType: "HASH" }, { AttributeName: "GSI1SK", KeyType: "RANGE" },
      ], Projection: { ProjectionType: "ALL" } },
      { IndexName: "GSI2", KeySchema: [
        { AttributeName: "GSI2PK", KeyType: "HASH" }, { AttributeName: "GSI2SK", KeyType: "RANGE" },
      ], Projection: { ProjectionType: "ALL" } },
      { IndexName: "GSI3", KeySchema: [
        { AttributeName: "GSI3PK", KeyType: "HASH" }, { AttributeName: "GSI3SK", KeyType: "RANGE" },
      ], Projection: { ProjectionType: "KEYS_ONLY" } },
    ]);
    expect((table.AttributeDefinitions as { AttributeName: string }[]).map(attribute => attribute.AttributeName).sort())
      .toEqual(["PK", "SK", "GSI1PK", "GSI1SK", "GSI2PK", "GSI2SK", "GSI3PK", "GSI3SK"].sort());
  });

  it("schedules bounded hard deletion with index-scoped reads, table deletes and failure alarm", () => {
    const worker = properties("RoofRetentionFunction");
    expect(worker.Handler).toBe("handlers/retention.handler");
    expect(worker.Timeout).toBe(360);
    expect(worker.Environment).toEqual({ Variables: { CORE_TABLE_NAME: "AnalysesTable" } });
    const statements = (worker.Policies as { Statement: { Sid: string; Action: string; Resource: unknown }[] }[])[0].Statement;
    expect(statements).toEqual([
      expect.objectContaining({ Sid: "ReadExpiredGoogleRoofIndex", Action: "dynamodb:Query", Resource: "${AnalysesTable.Arn}/index/GSI3" }),
      expect.objectContaining({ Sid: "DeleteExpiredGoogleRoofItems", Action: "dynamodb:DeleteItem", Resource: "AnalysesTable.Arn" }),
    ]);
    expect((worker.Events as Record<string, { Type: string; Properties: { Schedule: string } }>).HourlyRetentionSweep)
      .toMatchObject({ Type: "Schedule", Properties: { Schedule: "rate(1 hour)" } });
    expect(properties("RoofRetentionFailureAlarm")).toMatchObject({ Namespace: "AWS/Lambda", MetricName: "Errors", Threshold: 1 });
  });

  it("protects roof routes and keeps Google keys outside client configuration", () => {
    const roof = properties("RoofFunction");
    expect(roof.Handler).toBe("handlers/roof.handler");
    expect(roof.Timeout).toBe(28);
    const events = roof.Events as Record<string, { Properties: Record<string, unknown> }>;
    expect(Object.values(events).map(event => `${event.Properties.Method} ${event.Properties.Path}`).sort()).toEqual([
      "POST /solar/geocode", "POST /solar/building-insights", "POST /solar/confirm-building", "POST /solar/confirm-roof",
    ].sort());
    expect(Object.values(events).every(event => event.Properties.Auth === undefined)).toBe(true);
    expect(roof.Environment).toEqual({ Variables: {
      CORE_TABLE_NAME: "AnalysesTable",
      GOOGLE_GEOCODING_API_KEY: ["GeocodingConfigured", "{{resolve:secretsmanager:${GoogleGeocodingKeySecretArn}:SecretString:apiKey}}", ""],
      GOOGLE_SOLAR_API_KEY: ["SolarConfigured", "{{resolve:secretsmanager:${GoogleSolarKeySecretArn}:SecretString:apiKey}}", ""],
    } });
    expect(JSON.stringify(roof.Policies)).toContain("AnalysesTable.Arn");
    expect(JSON.stringify(properties("UserPoolClient"))).not.toContain("GOOGLE_SOLAR_API_KEY");
  });

  it("serves deterministic system recommendations with analysis reads only", () => {
    const systems = properties("SystemsFunction");
    expect(systems.Handler).toBe("handlers/systems.handler");
    expect(systems.Environment).toEqual({ Variables: { CORE_TABLE_NAME: "AnalysesTable" } });
    expect(systems.Policies).toEqual([{ Statement: [expect.objectContaining({
      Sid: "ReadOwnedSystemAnalysis", Effect: "Allow", Action: "dynamodb:GetItem", Resource: "AnalysesTable.Arn",
    })] }]);
    expect(systems.Events).toEqual({ RecommendSystems: { Type: "Api", Properties: {
      RestApiId: "Api", Path: "/systems/recommend", Method: "POST",
    } } });
    expect(JSON.stringify(systems)).not.toMatch(/GOOGLE_.*API_KEY|secretsmanager|BEDROCK/);
  });

  it("estimates unsubsidized financial cash flow with owned analysis reads only", () => {
    const financials = properties("FinancialsFunction");
    expect(financials.Handler).toBe("handlers/financials.handler");
    expect(financials.Environment).toEqual({ Variables: { CORE_TABLE_NAME: "AnalysesTable" } });
    expect(financials.Policies).toEqual([{ Statement: [expect.objectContaining({
      Sid: "ReadOwnedFinancialAnalysis", Effect: "Allow", Action: "dynamodb:GetItem", Resource: "AnalysesTable.Arn",
    })] }]);
    expect(financials.Events).toEqual({ EstimateFinancials: { Type: "Api", Properties: {
      RestApiId: "Api", Path: "/financials/estimate", Method: "POST",
    } } });
    expect(JSON.stringify(financials)).not.toMatch(/GOOGLE_.*API_KEY|secretsmanager|BEDROCK/);
  });

  it("isolates the private policy archive and versioned encrypted object bucket", () => {
    const table = properties("PolicyTable");
    expect(table.BillingMode).toBe("PAY_PER_REQUEST");
    expect(table.SSESpecification).toEqual({ SSEEnabled: true });
    expect(table.PointInTimeRecoverySpecification).toEqual({ PointInTimeRecoveryEnabled: true });
    expect(table.KeySchema).toEqual([
      { AttributeName: "PK", KeyType: "HASH" }, { AttributeName: "SK", KeyType: "RANGE" },
    ]);
    const bucket = properties("PolicyDocumentBucket");
    expect(bucket.VersioningConfiguration).toEqual({ Status: "Enabled" });
    expect(bucket.BucketEncryption).toEqual({ ServerSideEncryptionConfiguration: [
      { ServerSideEncryptionByDefault: { SSEAlgorithm: "AES256" } },
    ] });
    expect(bucket.PublicAccessBlockConfiguration).toEqual({
      BlockPublicAcls: true, BlockPublicPolicy: true, IgnorePublicAcls: true, RestrictPublicBuckets: true,
    });
    expect(bucket.OwnershipControls).toEqual({ Rules: [{ ObjectOwnership: "BucketOwnerEnforced" }] });
    expect(JSON.stringify(properties("PolicyDocumentBucketPolicy"))).toContain("aws:SecureTransport");
    const bucketStatements = ((properties("PolicyDocumentBucketPolicy").PolicyDocument as {
      Statement: Array<{ Condition?: Record<string, Record<string, string>> }> }).Statement);
    expect(bucketStatements[1]?.Condition).toEqual({
      Null: { "s3:if-none-match": "true" }, Bool: { "s3:ObjectCreationOperation": "true" },
    });
  });

  it("limits policy writes to a dedicated admin function and exact private resources", () => {
    const policy = properties("PolicyFunction");
    expect(policy.Handler).toBe("handlers/policy.handler");
    expect(policy.Timeout).toBe(28);
    expect(policy.Environment).toEqual({ Variables: {
      POLICY_TABLE_NAME: "PolicyTable", POLICY_DOCUMENT_BUCKET: "PolicyDocumentBucket",
    } });
    const routes = Object.values(policy.Events as Record<string, { Properties: { Method: string; Path: string; Auth?: unknown } }>)
      .map(event => `${event.Properties.Method} ${event.Properties.Path}`).sort();
    expect(routes).toEqual([
      "POST /admin/policy/sources", "GET /admin/policy/sources", "POST /admin/policy/sources/curate",
      "POST /admin/policy/sources/crawl", "POST /admin/policy/documents", "GET /admin/policy/queue",
      "GET /admin/policy/candidates/{candidateId}", "POST /admin/policy/candidates/{candidateId}/approve",
      "POST /admin/policy/candidates/{candidateId}/reject",
      "GET /admin/policy/changes/{changeId}", "POST /admin/policy/changes/{changeId}/approve",
      "POST /admin/policy/changes/{changeId}/reject",
    ].sort());
    expect(Object.values(policy.Events as Record<string, { Properties: { Auth?: unknown } }>).every(event => !event.Properties.Auth)).toBe(true);
    const statements = (policy.Policies as { Statement: { Action: string[]; Resource: unknown }[] }[])[0].Statement;
    expect(statements).toEqual([
      expect.objectContaining({ Action: ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:Query", "dynamodb:UpdateItem"],
        Resource: "PolicyTable.Arn" }),
      expect.objectContaining({ Action: "dynamodb:Query",
        Resource: ["${PolicyTable.Arn}/index/GSI1", "${PolicyTable.Arn}/index/GSI4"] }),
      expect.objectContaining({ Action: ["s3:PutObject", "s3:GetObject"],
        Resource: ["${PolicyDocumentBucket.Arn}/raw/*", "${PolicyDocumentBucket.Arn}/derived/*"] }),
      expect.objectContaining({ Action: "s3:GetObjectVersion",
        Resource: "${PolicyDocumentBucket.Arn}/derived/*" }),
    ]);
    expect(JSON.stringify(policy)).not.toMatch(/AnalysesTable|CORE_TABLE_NAME|secretsmanager|bedrock|DeleteObject|ListBucket/);
    for (const name of ["CoreFunction", "RoofFunction", "SystemsFunction", "FinancialsFunction"]) {
      expect(JSON.stringify(properties(name))).not.toMatch(/PolicyTable|PolicyDocumentBucket/);
    }
    expect(properties("PolicyAdminGroup").GroupName).toBe("ADMIN_POLICY");
    expect(properties("AdminGroup").GroupName).toBe("ADMIN");
  });

  it("runs a bounded isolated crawler every 15 minutes with failure alarm", () => {
    const table = properties("PolicyTable");
    expect(table.GlobalSecondaryIndexes).toEqual([
      expect.objectContaining({ IndexName: "GSI1", Projection: { ProjectionType: "ALL" } }),
      expect.objectContaining({ IndexName: "GSI2", Projection: { ProjectionType: "ALL" } }),
      expect.objectContaining({ IndexName: "GSI3", Projection: { ProjectionType: "ALL" } }),
      expect.objectContaining({ IndexName: "GSI4", Projection: { ProjectionType: "ALL" } }),
    ]);
    const worker = properties("PolicyCrawlerFunction");
    expect(worker.Handler).toBe("handlers/policy-crawler.handler");
    expect(worker.Timeout).toBe(300);
    expect(worker.ReservedConcurrentExecutions).toBe(1);
    expect(worker.Environment).toEqual({ Variables: {
      POLICY_TABLE_NAME: "PolicyTable", POLICY_DOCUMENT_BUCKET: "PolicyDocumentBucket",
    } });
    expect(worker.Events).toEqual({ DuePolicySourceSweep: { Type: "Schedule", Properties: {
      Schedule: "rate(15 minutes)", Description: expect.any(String),
    } } });
    const statements = (worker.Policies as { Statement: { Action: string | string[]; Resource: unknown }[] }[])[0].Statement;
    expect(statements).toEqual([
      expect.objectContaining({ Action: ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:Query", "dynamodb:UpdateItem"],
        Resource: "PolicyTable.Arn" }),
      expect.objectContaining({ Action: "dynamodb:Query", Resource: "${PolicyTable.Arn}/index/GSI2" }),
      expect.objectContaining({ Action: "dynamodb:Query", Resource: "${PolicyTable.Arn}/index/GSI3" }),
      expect.objectContaining({ Action: ["s3:PutObject", "s3:GetObject"],
        Resource: ["${PolicyDocumentBucket.Arn}/raw/*", "${PolicyDocumentBucket.Arn}/derived/*"] }),
      expect.objectContaining({ Action: "s3:GetObjectVersion", Resource: "${PolicyDocumentBucket.Arn}/derived/*" }),
    ]);
    expect(JSON.stringify(worker)).not.toMatch(/AnalysesTable|CORE_TABLE_NAME|secretsmanager|bedrock|DeleteObject|ListBucket/);
    expect(properties("PolicyCrawlerFailureAlarm")).toMatchObject({ Namespace: "AWS/Lambda", MetricName: "Errors", Threshold: 1 });
  });
});
