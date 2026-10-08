import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, QueryCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import type { ActivePolicyBundleV1, PolicyPublicationDraftV1, PublicationAuditV1 } from "./publication-types";

const draftKey = (draftId: string) => ({ PK: `PUB_DRAFT#${draftId}`, SK: "CURRENT" });
const policyKey = (policyId: string, sort: string) => ({ PK: `PUBLISHED_POLICY#${policyId}`, SK: sort });
const versionKey = (version: number) => `VERSION#${String(version).padStart(8, "0")}`;
const auditKey = (draftId: string, event: PublicationAuditV1) => ({ PK: `PUB_DRAFT#${draftId}`,
  SK: `AUDIT#${event.occurredAt}#${event.eventId}` });

export interface PolicyPublicationRepository {
  getDraft(draftId: string): Promise<PolicyPublicationDraftV1 | undefined>;
  createDraft(draft: PolicyPublicationDraftV1, audit: PublicationAuditV1): Promise<void>;
  transitionDraft(previous: PolicyPublicationDraftV1, next: PolicyPublicationDraftV1,
    audit: PublicationAuditV1): Promise<void>;
  listPending(limit: number, cursor?: Record<string, string>): Promise<{
    items: PolicyPublicationDraftV1[]; cursor?: Record<string, string> }>;
  getActive(policyId: string): Promise<ActivePolicyBundleV1 | undefined>;
  getPublished(policyId: string, version: number): Promise<ActivePolicyBundleV1 | undefined>;
  listActive(jurisdictions: readonly string[], limit: number): Promise<ActivePolicyBundleV1[]>;
  publish(previous: PolicyPublicationDraftV1, next: PolicyPublicationDraftV1,
    bundle: ActivePolicyBundleV1, audit: PublicationAuditV1,
    sourceRegistryVersion: number, crawlRevision: number, expectedActiveVersion?: number,
    priorSource?: { sourceId: string; registryVersion: number; crawlRevision: number }): Promise<void>;
}

export class DynamoPolicyPublicationRepository implements PolicyPublicationRepository {
  private readonly client: DynamoDBDocumentClient;
  constructor(private readonly tableName: string, region: string, client?: DynamoDBDocumentClient) {
    this.client = client ?? DynamoDBDocumentClient.from(new DynamoDBClient({ region, maxAttempts: 2,
      requestHandler: { connectionTimeout: 1_000, requestTimeout: 3_000 } }),
    { marshallOptions: { removeUndefinedValues: true } });
  }

  async getDraft(draftId: string): Promise<PolicyPublicationDraftV1 | undefined> {
    const response = await this.client.send(new GetCommand({ TableName: this.tableName,
      Key: draftKey(draftId), ConsistentRead: true }), { abortSignal: AbortSignal.timeout(5_000) });
    return response.Item?.value as PolicyPublicationDraftV1 | undefined;
  }

  async createDraft(draft: PolicyPublicationDraftV1, event: PublicationAuditV1): Promise<void> {
    await this.client.send(new TransactWriteCommand({ TransactItems: [
      { Put: { TableName: this.tableName, Item: { ...draftKey(draft.draftId),
        entityType: "POLICY_PUBLICATION_DRAFT", revision: draft.revision, status: draft.status, value: draft },
      ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)" } },
      { Put: { TableName: this.tableName, Item: { ...auditKey(draft.draftId, event),
        entityType: "POLICY_PUBLICATION_AUDIT", value: event },
      ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)" } },
    ] }), { abortSignal: AbortSignal.timeout(6_000) });
  }

  async transitionDraft(previous: PolicyPublicationDraftV1, next: PolicyPublicationDraftV1,
    event: PublicationAuditV1): Promise<void> {
    await this.client.send(new TransactWriteCommand({ TransactItems: [
      { Put: { TableName: this.tableName, Item: { ...draftKey(next.draftId),
        entityType: "POLICY_PUBLICATION_DRAFT", revision: next.revision, status: next.status, value: next,
        ...(next.status === "PENDING_APPROVAL" ? {
          GSI6PK: "POLICY_PUBLICATION_PENDING", GSI6SK: `${next.submittedAt}#${next.draftId}` } : {}) },
      ConditionExpression: "revision = :revision AND #status = :status",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: { ":revision": previous.revision, ":status": previous.status } } },
      { Put: { TableName: this.tableName, Item: { ...auditKey(next.draftId, event),
        entityType: "POLICY_PUBLICATION_AUDIT", value: event },
      ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)" } },
    ] }), { abortSignal: AbortSignal.timeout(6_000) });
  }

  async listPending(limit: number, cursor?: Record<string, string>) {
    const response = await this.client.send(new QueryCommand({ TableName: this.tableName,
      IndexName: "GSI6", KeyConditionExpression: "GSI6PK = :pending",
      ExpressionAttributeValues: { ":pending": "POLICY_PUBLICATION_PENDING" },
      Limit: limit, ScanIndexForward: false, ExclusiveStartKey: cursor }), { abortSignal: AbortSignal.timeout(5_000) });
    return { items: (response.Items ?? []).filter(item => item.entityType === "POLICY_PUBLICATION_DRAFT")
      .map(item => item.value as PolicyPublicationDraftV1),
    cursor: response.LastEvaluatedKey as Record<string, string> | undefined };
  }

  async getActive(policyId: string): Promise<ActivePolicyBundleV1 | undefined> {
    const response = await this.client.send(new GetCommand({ TableName: this.tableName,
      Key: policyKey(policyId, "ACTIVE"), ConsistentRead: true }), { abortSignal: AbortSignal.timeout(5_000) });
    return response.Item?.value as ActivePolicyBundleV1 | undefined;
  }

  async getPublished(policyId: string, version: number): Promise<ActivePolicyBundleV1 | undefined> {
    const response = await this.client.send(new GetCommand({ TableName: this.tableName,
      Key: policyKey(policyId, versionKey(version)), ConsistentRead: true }), { abortSignal: AbortSignal.timeout(5_000) });
    return response.Item?.value as ActivePolicyBundleV1 | undefined;
  }

  async listActive(jurisdictions: readonly string[], limit: number): Promise<ActivePolicyBundleV1[]> {
    if (jurisdictions.length < 1 || jurisdictions.length > 4 || limit < 1 || limit > 17) {
      throw new RangeError("Invalid active policy jurisdiction bound.");
    }
    const pages = await Promise.all(jurisdictions.map(jurisdiction => this.client.send(new QueryCommand({
      TableName: this.tableName, IndexName: "GSI5", KeyConditionExpression: "GSI5PK = :active",
      ExpressionAttributeValues: { ":active": `ACTIVE_POLICY_BENEFITS#${jurisdiction}` }, Limit: limit,
    }), { abortSignal: AbortSignal.timeout(5_000) })));
    if (pages.some(page => !!page.LastEvaluatedKey)) {
      throw new RangeError("Relevant active policy catalog could be truncated by DynamoDB pagination.");
    }
    const ids = pages.flatMap(page => page.Items ?? []).filter(item => item.entityType === "ACTIVE_POLICY_POINTER")
      .map(item => item.value?.policyId as string | undefined).filter((value): value is string => !!value);
    if (ids.length > limit) throw new RangeError("Relevant active policy catalog exceeds evaluation bound.");
    const current = await Promise.all(ids.map(id => this.getActive(id)));
    const bundles = current.filter((item): item is ActivePolicyBundleV1 => !!item);
    const immutable = await Promise.all(bundles.map(item => this.getPublished(item.policyId, item.version.version)));
    if (bundles.some((item, index) => !immutable[index] || JSON.stringify(immutable[index]) !== JSON.stringify(item))) {
      throw new Error("Active policy pointer differs from its immutable version.");
    }
    return bundles;
  }

  async publish(previous: PolicyPublicationDraftV1, next: PolicyPublicationDraftV1,
    bundle: ActivePolicyBundleV1, event: PublicationAuditV1,
    sourceRegistryVersion: number, crawlRevision: number, expectedActiveVersion?: number,
    priorSource?: { sourceId: string; registryVersion: number; crawlRevision: number }): Promise<void> {
    const active = policyKey(bundle.policyId, "ACTIVE");
    await this.client.send(new TransactWriteCommand({ TransactItems: [
      { ConditionCheck: { TableName: this.tableName,
        Key: { PK: `SOURCE#${next.citation.sourceId}`, SK: "CURRENT" },
        ConditionExpression: "#value.#registryVersion = :version AND #value.#registryStatus = :curated AND #value.#enabled = :enabled",
        ExpressionAttributeNames: { "#value": "value", "#registryVersion": "registryVersion",
          "#registryStatus": "registryStatus", "#enabled": "enabled" },
        ExpressionAttributeValues: { ":version": sourceRegistryVersion, ":curated": "CURATED", ":enabled": true } } },
      { ConditionCheck: { TableName: this.tableName,
        Key: { PK: `SOURCE#${next.citation.sourceId}`, SK: "CRAWL_STATE" },
        ConditionExpression: "#value.#revision = :revision",
        ExpressionAttributeNames: { "#value": "value", "#revision": "revision" },
        ExpressionAttributeValues: { ":revision": crawlRevision } } },
      ...(priorSource ? [
        { ConditionCheck: { TableName: this.tableName,
          Key: { PK: `SOURCE#${priorSource.sourceId}`, SK: "CURRENT" },
          ConditionExpression: "#value.#registryVersion = :version AND #value.#registryStatus = :curated AND #value.#enabled = :enabled",
          ExpressionAttributeNames: { "#value": "value", "#registryVersion": "registryVersion",
            "#registryStatus": "registryStatus", "#enabled": "enabled" },
          ExpressionAttributeValues: { ":version": priorSource.registryVersion, ":curated": "CURATED", ":enabled": true } } },
        { ConditionCheck: { TableName: this.tableName,
          Key: { PK: `SOURCE#${priorSource.sourceId}`, SK: "CRAWL_STATE" },
          ConditionExpression: "#value.#revision = :revision",
          ExpressionAttributeNames: { "#value": "value", "#revision": "revision" },
          ExpressionAttributeValues: { ":revision": priorSource.crawlRevision } } },
      ] : []),
      { Put: { TableName: this.tableName, Item: { ...draftKey(next.draftId),
        entityType: "POLICY_PUBLICATION_DRAFT", revision: next.revision, status: next.status, value: next },
        ConditionExpression: "revision = :revision AND #status = :pending",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: { ":revision": previous.revision, ":pending": "PENDING_APPROVAL" } } },
      { Put: { TableName: this.tableName, Item: { ...policyKey(bundle.policyId, versionKey(bundle.version.version)),
        entityType: "POLICY_PUBLISHED_VERSION", value: bundle },
        ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)" } },
      { Put: { TableName: this.tableName, Item: { ...policyKey(bundle.policyId,
        `ACTIVATION#${versionKey(bundle.version.version)}`), entityType: "POLICY_ACTIVATION_EVENT",
        value: { schemaVersion: 1, policyId: bundle.policyId, version: bundle.version.version,
          previousVersion: expectedActiveVersion ?? null, activatedAt: bundle.activatedAt,
          actorId: next.reviewedBy, draftId: next.draftId, reviewReason: next.reviewReason,
          precedenceDecision: event.precedenceDecision,
          precedenceReasonCode: event.precedenceReasonCode,
          supersededSourceId: event.supersededSourceId,
          supersededSourceAuthorityTier: event.supersededSourceAuthorityTier,
          replacementSourceAuthorityTier: event.replacementSourceAuthorityTier } },
        ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)" } },
      { Put: { TableName: this.tableName, Item: { ...active, entityType: "ACTIVE_POLICY_POINTER",
        activeVersion: bundle.version.version, value: bundle,
        GSI5PK: `ACTIVE_POLICY_BENEFITS#${bundle.rule.jurisdiction}`, GSI5SK: bundle.policyId },
        ConditionExpression: expectedActiveVersion === undefined ? "attribute_not_exists(PK) AND attribute_not_exists(SK)" :
          "activeVersion = :prior",
        ...(expectedActiveVersion === undefined ? {} : { ExpressionAttributeValues: { ":prior": expectedActiveVersion } }) } },
      { Put: { TableName: this.tableName, Item: { ...auditKey(next.draftId, event),
        entityType: "POLICY_PUBLICATION_AUDIT", value: event },
        ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)" } },
    ] }), { abortSignal: AbortSignal.timeout(8_000) });
  }
}
