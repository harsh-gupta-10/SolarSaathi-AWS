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
  it("parses valid YAML within the packaged TemplateURL size limit", () => {
    expect(document.errors).toHaveLength(0);
    // This template is deployed by SAM through a packaged S3 TemplateURL, not inline TemplateBody.
    expect(Buffer.byteLength(text)).toBeLessThan(1_048_576);
    expect(template.Transform).toBe("AWS::Serverless-2016-10-31");
  });
  it("uses compiled handlers with explicit log destinations", () => {
    for (const name of ["HealthFunction", "AnalyzeFunction", "ChatFunction", "ProfileFunction", "CoreFunction", "RoofFunction", "SystemsFunction", "DesignsFunction", "FinancialsFunction", "PolicyFinancialsFunction", "InternationalResearchFunction", "BrokerFunction", "BenefitsFunction", "ApplicationsFunction", "PolicyFunction", "PolicyPublicationFunction", "PolicyCrawlerFunction", "RoofRetentionFunction"]) {
      expect(properties(name).CodeUri).toBe("../../apps/api/dist");
      expect(properties(name).Handler).toMatch(/^handlers\/[a-z-]+\.handler$/);
      expect(properties(name).LoggingConfig).toBeDefined();
    }
  });
  it("preserves stateful resources on deletion and replacement", () => {
    for (const name of ["AnalysesTable", "PolicyTable", "PolicyDocumentBucket", "DesignAssetBucket", "UserPool"]) {
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

  it("never overrides Cognito authorization on product API events", () => {
    let protectedRoutes = 0;
    for (const [name, resource] of Object.entries(template.Resources)) {
      if (resource.Type !== "AWS::Serverless::Function") continue;
      const events = (resource.Properties.Events ?? {}) as Record<string, {
        Type: string; Properties: { RestApiId?: unknown; Auth?: unknown };
      }>;
      for (const [eventName, event] of Object.entries(events)) {
        if (event.Type !== "Api") continue;
        expect(event.Properties.RestApiId, `${name}.${eventName} uses the protected API`).toBe("Api");
        if (name === "HealthFunction" && eventName === "Health") continue;
        expect(event.Properties.Auth, `${name}.${eventName} must inherit Cognito auth`).toBeUndefined();
        protectedRoutes++;
      }
    }
    expect(protectedRoutes).toBeGreaterThan(30);
  });

  it("keeps international research authenticated, temporary and limited to geocode plus cache keys", () => {
    const research = properties("InternationalResearchFunction");
    expect(research.Handler).toBe("handlers/international-research.handler");
    expect(research.Timeout).toBe(28);
    expect(research.Events).toEqual({ ResearchInternationalPolicies: { Type: "Api", Properties: {
      RestApiId: "Api", Path: "/policies/research", Method: "POST",
    } } });
    expect(research.Environment).toMatchObject({ Variables: { CORE_TABLE_NAME: "AnalysesTable",
      BRAVE_SEARCH_API_KEY: ["BraveSearchConfigured", expect.stringContaining("resolve:secretsmanager"), ""] } });
    const statements = (research.Policies as { Statement: { Sid: string; Action: string; Resource: unknown; Condition?: unknown }[] }[])[0]!.Statement;
    expect(statements.map(statement => statement.Sid)).toEqual([
      "ReverseGeocodeSingleUse", "ReadResearchCache", "WriteResearchCache",
    ]);
    expect(statements[0]!.Action).toBe("geo-places:ReverseGeocode");
    expect(statements[0]!.Resource).toBe("arn:${AWS::Partition}:geo-places:${AWS::Region}::provider/default");
    expect(statements[1]!.Condition).toMatchObject({ "Null": { "dynamodb:LeadingKeys": "false" } });
    expect(statements[2]!.Condition).toMatchObject({ "Null": { "dynamodb:LeadingKeys": "false" } });
  });

  it("routes authenticated core operations through the stage-relative API", () => {
    const core = properties("CoreFunction");
    expect(core.Handler).toBe("handlers/core.handler");
    expect(core.Environment).toEqual({ Variables: { CORE_TABLE_NAME: "AnalysesTable" } });
    const events = core.Events as Record<string, { Properties: Record<string, unknown> }>;
    expect(Object.values(events).map(event => `${event.Properties.Method} ${event.Properties.Path}`).sort()).toEqual([
      "GET /users/me", "POST /users/bootstrap", "GET /organizations/me",
      "GET /customers", "POST /customers", "GET /properties", "POST /properties",
      "GET /properties/{propertyId}", "DELETE /properties/{propertyId}", "GET /leads", "POST /leads",
      "GET /properties/{propertyId}/analyses",
    ].sort());
    expect(Object.values(events).every(event => event.Properties.Auth === undefined)).toBe(true);
  });

  it("limits the core function to required table and index operations", () => {
    const core = properties("CoreFunction");
    const policies = core.Policies as { Statement: { Sid: string; Effect: string; Action: string | string[]; Resource: unknown }[] }[];
    expect(policies).toHaveLength(1);
    expect(policies[0]?.Statement).toEqual([
      expect.objectContaining({ Sid: "CoreTableItems", Effect: "Allow", Action: [
        "dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:DeleteItem", "dynamodb:ConditionCheckItem", "dynamodb:Query",
      ], Resource: "AnalysesTable.Arn" }),
      expect.objectContaining({ Sid: "CoreIdempotencyUpdates", Action: "dynamodb:UpdateItem" }),
      expect.objectContaining({ Sid: "CorePropertyIndexes", Effect: "Allow", Action: "dynamodb:Query", Resource: [
        "${AnalysesTable.Arn}/index/GSI1", "${AnalysesTable.Arn}/index/GSI2",
      ] }),
    ]);
    for (const name of ["HealthFunction", "AnalyzeFunction", "ProfileFunction"]) {
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
    expect(systems.Events).toEqual({
      RecommendSystems: { Type: "Api", Properties: {
        RestApiId: "Api", Path: "/systems/recommend", Method: "POST",
      } },
      RecommendAccessories: { Type: "Api", Properties: {
        RestApiId: "Api", Path: "/accessories/recommend", Method: "POST",
      } },
    });
    expect(JSON.stringify(systems)).not.toMatch(/GOOGLE_.*API_KEY|secretsmanager|BEDROCK/);
  });

  it("serves bounded property-scoped rooftop designs with one-day private image retention", () => {
    const designs = properties("DesignsFunction");
    expect(designs.Handler).toBe("handlers/designs.handler");
    expect(designs.Timeout).toBe(29);
    expect(designs.Environment).toEqual({ Variables: {
      CORE_TABLE_NAME: "AnalysesTable", DESIGN_ASSET_BUCKET: "DesignAssetBucket",
      DESIGN_IMAGE_MODEL_ID: "DesignImageModelId", DESIGN_IMAGE_REGION: "DesignImageRegion",
    } });
    expect(designs.Events).toEqual({
      RecommendDesigns: { Type: "Api", Properties: { RestApiId: "Api", Path: "/designs/recommend", Method: "POST" } },
      GenerateDesign: { Type: "Api", Properties: { RestApiId: "Api", Path: "/designs/generate", Method: "POST" } },
      GetDesignTemplates: { Type: "Api", Properties: { RestApiId: "Api", Path: "/designs/templates", Method: "GET" } },
      GetDesignImage: { Type: "Api", Properties: { RestApiId: "Api", Path: "/designs/{designId}/image", Method: "GET" } },
    });
    const policy = JSON.stringify(designs.Policies);
    expect(policy).toContain("dynamodb:GetItem");
    expect(policy).toContain("dynamodb:PutItem");
    expect(policy).toContain("dynamodb:UpdateItem");
    expect(policy).toContain("DesignAssetBucket.Arn}/generated/*");
    expect(policy).toContain("DesignImageConfigured");
    expect(policy).toContain("bedrock:InvokeModel");
    expect(policy).not.toContain("PolicyTable");
    const bucket = properties("DesignAssetBucket");
    expect(bucket.PublicAccessBlockConfiguration).toMatchObject({ BlockPublicAcls: true, BlockPublicPolicy: true,
      IgnorePublicAcls: true, RestrictPublicBuckets: true });
    expect(bucket.LifecycleConfiguration).toEqual({ Rules: [{ Id: "ExpireInspirationalImages", Status: "Enabled",
      Prefix: "generated/", ExpirationInDays: 1 }] });
    expect(bucket.CorsConfiguration).toMatchObject({ CorsRules: [{ AllowedMethods: ["GET"],
      AllowedOrigins: ["ApplicationOrigin"] }] });
    expect(template.Parameters.DesignImageModelId).toMatchObject({ Default: "" });
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

  it("routes policy-backed finances through owned and verified-policy read permissions only", () => {
    const financials = properties("PolicyFinancialsFunction");
    expect(financials.Handler).toBe("handlers/policy-financials.handler");
    expect(financials.Environment).toEqual({ Variables: {
      CORE_TABLE_NAME: "AnalysesTable", POLICY_TABLE_NAME: "PolicyTable",
    } });
    expect(financials.Timeout).toBe(28);
    expect(financials.Events).toEqual({ EstimatePolicyFinancials: { Type: "Api", Properties: {
      RestApiId: "Api", Path: "/financials/policy-backed/estimate", Method: "POST",
    } } });
    const policy = JSON.stringify(financials.Policies);
    expect(policy).toContain("AnalysesTable.Arn");
    expect(policy).toContain("PUBLISHED_POLICY#*");
    expect(policy).toContain("SOURCE#*");
    expect(policy).toContain("index/GSI5");
    expect(policy).not.toMatch(/PutItem|UpdateItem|DeleteItem|s3:|secretsmanager|bedrock/);
  });

  it("routes broker proposal, saved-design and lead-stage operations with scoped table permissions", () => {
    const broker = properties("BrokerFunction");
    expect(broker.Handler).toBe("handlers/broker.handler");
    expect(broker.Environment).toEqual({ Variables: {
      CORE_TABLE_NAME: "AnalysesTable", POLICY_TABLE_NAME: "PolicyTable",
    } });
    expect(Object.values(broker.Events as Record<string, { Properties: { Path: string; Method: string } }>)
      .map(event => `${event.Properties.Method} ${event.Properties.Path}`).sort()).toEqual([
      "POST /broker/proposals/preview", "POST /broker/customers/{customerId}/proposals",
      "GET /broker/customers/{customerId}/proposals", "GET /broker/customers/{customerId}/proposals/{proposalId}",
      "GET /broker/properties/{propertyId}/designs", "PATCH /broker/leads/{leadId}",
    ].sort());
    const access = JSON.stringify(broker.Policies);
    expect(access).toContain("GuardBrokerProposalScope");
    expect(access).toContain("SaveImmutableBrokerProposal");
    expect(access).toContain("UpdateBrokerLeadAndAudit");
    expect(access).toContain("PUBLISHED_POLICY#*");
    expect(access).toContain("index/GSI5");
    expect(access).not.toMatch(/s3:|bedrock|secretsmanager|DeleteItem|UpdateItem/);
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
      "GET /admin/policy/crawler-runs", "GET /admin/policy/conflicts",
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
      expect.objectContaining({ IndexName: "GSI5", Projection: { ProjectionType: "ALL" } }),
      expect.objectContaining({ IndexName: "GSI6", Projection: { ProjectionType: "ALL" } }),
    ]);
    const worker = properties("PolicyCrawlerFunction");
    expect(worker.Handler).toBe("handlers/policy-crawler.handler");
    expect(worker.Timeout).toBe(300);
    expect(template.Parameters.EnableCrawlerReservedConcurrency).toMatchObject({ Default: "false" });
    expect(worker.ReservedConcurrentExecutions).toEqual(["CrawlerConcurrencyReserved", 1, "AWS::NoValue"]);
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

  it("isolates maker-checker publication from read-only homeowner benefit evaluation", () => {
    const table = properties("PolicyTable");
    expect(table.GlobalSecondaryIndexes).toEqual(expect.arrayContaining([
      expect.objectContaining({ IndexName: "GSI5", Projection: { ProjectionType: "ALL" } }),
      expect.objectContaining({ IndexName: "GSI6", Projection: { ProjectionType: "ALL" } }),
    ]));
    const publication = properties("PolicyPublicationFunction");
    expect(publication.Handler).toBe("handlers/policy-publication.handler");
    expect(publication.Events).toMatchObject({ CreateBenefitDraft: { Properties: { Method: "POST" } },
      PublishBenefitDraft: { Properties: { Method: "POST" } },
      RejectBenefitDraft: { Properties: { Method: "POST" } },
      ListActiveBenefitPolicies: { Properties: { Method: "GET", Path: "/admin/policy/benefits/active" } },
      ListBenefitVersions: { Properties: { Method: "GET", Path: "/admin/policy/benefits/versions/{policyId}" } },
      BenefitVersionDetail: { Properties: { Method: "GET", Path: "/admin/policy/benefits/versions/{policyId}/{version}" } },
      ProposeBenefitRollback: { Properties: { Method: "POST", Path: "/admin/policy/benefits/rollbacks" } },
      ListBenefitRollbackQueue: { Properties: { Method: "GET", Path: "/admin/policy/benefits/rollbacks/queue" } },
      BenefitRollbackDetail: { Properties: { Method: "GET", Path: "/admin/policy/benefits/rollbacks/{rollbackId}" } },
      ApproveBenefitRollback: { Properties: { Method: "POST", Path: "/admin/policy/benefits/rollbacks/{rollbackId}/approve" } },
      RejectBenefitRollback: { Properties: { Method: "POST", Path: "/admin/policy/benefits/rollbacks/{rollbackId}/reject" } } });
    const publishPolicy = JSON.stringify(publication.Policies);
    expect(publishPolicy).toContain("dynamodb:ConditionCheckItem");
    expect(publishPolicy).toContain("index/GSI6");
    expect(publishPolicy).toContain("index/GSI5");
    expect(publishPolicy).toContain("s3:GetObjectVersion");
    expect(publishPolicy).not.toMatch(/AnalysesTable|DeleteObject|secretsmanager|bedrock/);
    const benefits = properties("BenefitsFunction");
    expect(benefits.Handler).toBe("handlers/benefits.handler");
    expect(benefits.Events).toMatchObject({ EvaluateBenefits: { Properties: {
      Path: "/benefits/evaluate", Method: "POST" } } });
    expect(benefits.Timeout).toBe(28);
    const readPolicy = JSON.stringify(benefits.Policies);
    expect(readPolicy).toContain("index/GSI5");
    expect(readPolicy).toContain("AnalysesTable.Arn");
    expect(readPolicy).not.toMatch(/PutItem|UpdateItem|DeleteItem|s3:|secretsmanager|bedrock/);
  });

  it("routes policy-bound application tracking with scoped core writes and a current policy guard", () => {
    const tracker = properties("ApplicationsFunction");
    expect(tracker.Handler).toBe("handlers/applications.handler");
    expect(tracker.Environment).toEqual({ Variables: {
      CORE_TABLE_NAME: "AnalysesTable", POLICY_TABLE_NAME: "PolicyTable",
    } });
    expect(Object.values(tracker.Events as Record<string, { Properties: { Path: string; Method: string } }>)
      .map(event => `${event.Properties.Method} ${event.Properties.Path}`).sort()).toEqual([
      "GET /applications", "POST /applications", "GET /applications/{applicationId}",
      "GET /applications/{applicationId}/events", "POST /applications/{applicationId}/steps/{stepId}",
      "POST /applications/{applicationId}/details", "POST /applications/{applicationId}/documents",
      "POST /applications/{applicationId}/chat-update",
    ].sort());
    const access = JSON.stringify(tracker.Policies);
    expect(access).toContain("WriteApplicationAndAudit");
    expect(access).toContain("GuardActiveApplicationPolicy");
    expect(access).toContain("PUBLISHED_POLICY#*");
    expect(access).toContain("index/GSI5");
    // Idempotency claims are the only update/delete permission, scoped to their own key prefix.
    const withoutIdempotency = JSON.stringify((tracker.Policies as { Statement: { Sid: string }[] }[])
      .map(policy => ({ ...policy, Statement: policy.Statement.filter(item => item.Sid !== "ApplicationIdempotencyKeys") })));
    expect(access).toContain("IDEMPOTENCY#*");
    expect(withoutIdempotency).not.toMatch(/s3:|secretsmanager|bedrock|DeleteItem|UpdateItem/);
  });

  it("keeps the advisor read-only with optional exact-model Bedrock invocation", () => {
    const advisor = properties("ChatFunction");
    expect(advisor.Handler).toBe("handlers/chat.handler");
    expect(advisor.Environment).toEqual({ Variables: {
      CORE_TABLE_NAME: "AnalysesTable", POLICY_TABLE_NAME: "PolicyTable",
      BEDROCK_MODEL_ID: "AdvisorBedrockModelId", BEDROCK_REGION: "AdvisorBedrockRegion",
    } });
    expect(advisor.Events).toMatchObject({ Chat: { Properties: { Path: "/advisor/solar", Method: "POST" } },
      LegacyChat: { Properties: { Path: "/chat", Method: "POST" } } });
    const policies = JSON.stringify(advisor.Policies);
    expect(policies).toContain("ReadOwnedAdvisorContext");
    expect(policies).toContain("ReadCurrentAdvisorPolicy");
    expect(policies).toContain("index/GSI5");
    expect(policies).toContain("AdvisorBedrockConfigured");
    expect(policies).toContain("bedrock:InvokeModel");
    expect(policies).toContain("AdvisorBedrockModelArn");
    expect(policies).not.toMatch(/PutItem|UpdateItem|DeleteItem|s3:|secretsmanager/);
    expect(template.Parameters.AdvisorBedrockModelId).toMatchObject({ Default: "" });
    expect(template.Parameters.AdvisorBedrockModelArn).toMatchObject({ Default: "" });
    expect(template.Parameters.AdvisorBedrockFoundationModelArn).toMatchObject({ Default: "" });
    expect(policies).toContain("AdvisorFoundationModelConfigured");
    expect(policies).toContain("AdvisorBedrockFoundationModelArn");
  });

  it("streams the assistant through a verified-in-code Function URL with scoped Bedrock and guardrail access", () => {
    const agent = properties("ChatAgentFunction");
    expect(agent.Handler).toBe("handlers/chat-stream.handler");
    expect(agent.Timeout).toBe(120);
    expect(agent.MemorySize).toBe(512);
    expect(agent.FunctionUrlConfig).toMatchObject({ AuthType: "NONE", InvokeMode: "RESPONSE_STREAM",
      Cors: { AllowOrigins: ["ApplicationOrigin"], AllowMethods: ["POST"] } });
    expect(agent.Events).toBeUndefined();
    expect(properties("ChatAgentFunctionUrlInvoke")).toMatchObject({ Action: "lambda:InvokeFunction", InvokedViaFunctionUrl: true });
    const env = (agent.Environment as { Variables: Record<string, unknown> }).Variables;
    expect(Object.keys(env)).toEqual(expect.arrayContaining(["GUARDRAIL_ID", "GUARDRAIL_VERSION", "BEDROCK_MODEL_ID", "CORE_TABLE_NAME"]));
    const policies = JSON.stringify(agent.Policies);
    expect(policies).toContain("bedrock:InvokeModelWithResponseStream");
    expect(policies).toContain("bedrock:ApplyGuardrail");
    expect(policies).toContain("AdvisorBedrockModelArn");
    expect(policies).not.toMatch(/DeleteItem|s3:|secretsmanager|"Action":"bedrock:\*"/);
    // The agent may write chat state and price candidates only, never account, property or policy records.
    const write = (agent.Policies as { Statement: { Sid: string; Condition: unknown }[] }[])[0]!.Statement
      .find(item => item.Sid === "WriteChatStateAndPriceCandidates")!;
    expect(JSON.stringify(write.Condition)).toContain("CHAT#*");
    expect(JSON.stringify(write.Condition)).not.toMatch(/USER#|PROPERTY#|CUSTOMER#|APPLICATION#|ORG#/);
    expect(template.Parameters.GuardrailId).toMatchObject({ Default: "" });
    expect(template.Parameters.GuardrailVersion).toMatchObject({ Default: "" });
    expect(template.Resources.ChatGuardrail.Type).toBe("AWS::Bedrock::Guardrail");
    const guardrail = JSON.stringify(properties("ChatGuardrail"));
    expect(guardrail).toContain('"Type":"PROMPT_ATTACK","InputStrength":"HIGH"');
    expect(guardrail).toContain("PROFANITY");
    expect(guardrail).toContain("AadhaarNumber");
    expect(text).toMatch(/ChatStreamUrl:/);
  });

  it("routes conversation management and confirmation behind Cognito with chat-partition deletes only", () => {
    const chats = properties("ChatsFunction");
    expect(Object.values(chats.Events as Record<string, { Properties: { Path: string; Method: string } }>)
      .map(event => `${event.Properties.Method} ${event.Properties.Path}`).sort()).toEqual([
      "DELETE /chats", "DELETE /chats/{chatId}", "GET /chats", "GET /chats/{chatId}", "POST /chat/confirm"]);
    const statements = (chats.Policies as { Statement: { Sid: string; Condition: unknown }[] }[])[0]!.Statement;
    const remove = statements.find(item => item.Sid === "DeleteChatPartition")!;
    expect(JSON.stringify(remove.Condition)).toContain("CHAT#*");
    expect(JSON.stringify(remove.Condition)).not.toMatch(/USER#|PROPERTY#|CUSTOMER#|APPLICATION#/);
    expect(JSON.stringify(chats.Policies)).not.toMatch(/bedrock|s3:|secretsmanager/);
    const cors = properties("Api").Cors as { AllowMethods: string; AllowHeaders: string };
    expect(cors.AllowMethods).toMatch(/DELETE/);
    expect(cors.AllowMethods).toMatch(/PATCH/);
    expect(cors.AllowHeaders).toContain("Idempotency-Key");
  });

  it("limits price benchmark administration to its own key prefixes", () => {
    const admin = properties("PriceAdminFunction");
    expect(admin.Handler).toBe("handlers/price-admin.handler");
    const access = JSON.stringify(admin.Policies);
    expect(access).toContain("PRICE_BENCHMARK#*");
    expect(access).toContain("PRICE_STATUS#*");
    expect(access).not.toMatch(/USER#|PROPERTY#|CHAT#|bedrock|s3:|secretsmanager/);
  });
});
