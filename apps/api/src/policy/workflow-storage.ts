import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import type { PolicyDocumentV1, PolicySourceV1 } from "@solarsaathi/policy";
import { policyCrawlerRunSchema, type PolicyCrawlerRunV1, type PolicyChangeRecordV1, type PolicyCrawlStateV1,
  type PolicyReviewRecordV1, type PolicyWorkflowAuditV1 } from "./workflow-types";

const sourcePK = (sourceId: string) => `SOURCE#${sourceId}`;
const sourceKey = (sourceId: string, sort: string) => ({ PK: sourcePK(sourceId), SK: sort });
const candidatePK = (candidateId: string) => `CANDIDATE#${candidateId}`;
const candidateKey = (candidateId: string, sort = "CURRENT") => ({ PK: candidatePK(candidateId), SK: sort });
const changePK = (changeId: string) => `CHANGE#${changeId}`;
const changeKey = (changeId: string, sort = "CURRENT") => ({ PK: changePK(changeId), SK: sort });
const version = (value: number) => String(value).padStart(8, "0");
const auditSort = (audit: PolicyWorkflowAuditV1) => `AUDIT#${audit.occurredAt}#${audit.eventId}`;
const RUN_PARTITION = "POLICY_CRAWLER_RUNS";

export interface PolicyWorkflowRepository {
  listSources(limit: number, cursor?: Record<string, unknown>): Promise<{
    items: PolicySourceV1[]; cursor?: Record<string, unknown> }>;
  recordRun(run: PolicyCrawlerRunV1): Promise<void>;
  listRuns(limit: number, cursor?: Record<string, unknown>): Promise<{
    items: PolicyCrawlerRunV1[]; cursor?: Record<string, unknown> }>;
  getSourceVersion(sourceId: string, registryVersion: number): Promise<PolicySourceV1 | undefined>;
  getCrawlState(sourceId: string): Promise<PolicyCrawlStateV1 | undefined>;
  curateSource(previous: PolicySourceV1, next: PolicySourceV1, state: PolicyCrawlStateV1, audit: PolicyWorkflowAuditV1): Promise<void>;
  listDue(nowEpoch: number, limit: number): Promise<PolicyCrawlStateV1[]>;
  claimCrawl(state: PolicyCrawlStateV1, nowEpoch: number, leaseUntilEpoch: number,
    audit: PolicyWorkflowAuditV1): Promise<PolicyCrawlStateV1>;
  completeCrawl(previous: PolicyCrawlStateV1, next: PolicyCrawlStateV1, audit: PolicyWorkflowAuditV1): Promise<void>;
  requestCrawl(previous: PolicyCrawlStateV1, next: PolicyCrawlStateV1, audit: PolicyWorkflowAuditV1): Promise<void>;
  latestDocument(sourceId: string, documentId: string): Promise<PolicyDocumentV1 | undefined>;
  putChange(change: PolicyChangeRecordV1): Promise<void>;
  getChange(changeId: string): Promise<PolicyChangeRecordV1 | undefined>;
  listChangeAudit(changeId: string, limit: number): Promise<PolicyWorkflowAuditV1[]>;
  reviewChange(previous: PolicyChangeRecordV1, next: PolicyChangeRecordV1, audit: PolicyWorkflowAuditV1): Promise<void>;
  putCandidate(review: PolicyReviewRecordV1): Promise<void>;
  getCandidate(candidateId: string): Promise<PolicyReviewRecordV1 | undefined>;
  findApprovedClaim(claimKey: string, limit: number): Promise<{ items: PolicyReviewRecordV1[]; truncated: boolean }>;
  listQueue(limit: number, cursor?: Record<string, unknown>): Promise<{
    items: PolicyReviewRecordV1[]; changes: PolicyChangeRecordV1[]; cursor?: Record<string, unknown> }>;
  listCandidateAudit(candidateId: string, limit: number): Promise<PolicyWorkflowAuditV1[]>;
  reviewCandidate(previous: PolicyReviewRecordV1, next: PolicyReviewRecordV1, audit: PolicyWorkflowAuditV1): Promise<void>;
}

export class DynamoPolicyWorkflowRepository implements PolicyWorkflowRepository {
  private readonly client: DynamoDBDocumentClient;
  constructor(private readonly tableName: string, region: string, client?: DynamoDBDocumentClient) {
    this.client = client ?? DynamoDBDocumentClient.from(new DynamoDBClient({
      region, maxAttempts: 2, requestHandler: { connectionTimeout: 1_000, requestTimeout: 3_000 },
    }), { marshallOptions: { removeUndefinedValues: true } });
  }

  async listSources(limit: number, cursor?: Record<string, unknown>) {
    const response = await this.client.send(new QueryCommand({ TableName: this.tableName, IndexName: "GSI4",
      KeyConditionExpression: "GSI4PK = :registry", ExpressionAttributeValues: { ":registry": "POLICY_SOURCES" },
      ScanIndexForward: false, Limit: limit, ExclusiveStartKey: cursor,
    }), { abortSignal: AbortSignal.timeout(5_000) });
    return { items: (response.Items ?? []).filter(item => item.entityType === "POLICY_SOURCE_CURRENT")
      .map(item => item.value as PolicySourceV1),
    cursor: response.LastEvaluatedKey as Record<string, unknown> | undefined };
  }

  async recordRun(input: PolicyCrawlerRunV1): Promise<void> {
    const run = policyCrawlerRunSchema.parse(input);
    await this.client.send(new PutCommand({ TableName: this.tableName,
      Item: { PK: RUN_PARTITION, SK: `RUN#${run.startedAt}#${run.runId}`,
        entityType: "POLICY_CRAWLER_RUN", value: run },
      ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)",
    }), { abortSignal: AbortSignal.timeout(5_000) });
  }

  async listRuns(limit: number, cursor?: Record<string, unknown>) {
    const response = await this.client.send(new QueryCommand({ TableName: this.tableName,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
      ExpressionAttributeValues: { ":pk": RUN_PARTITION, ":prefix": "RUN#" },
      ScanIndexForward: false, ConsistentRead: true, Limit: limit, ExclusiveStartKey: cursor,
    }), { abortSignal: AbortSignal.timeout(5_000) });
    const items = (response.Items ?? []).map(item => {
      const run = policyCrawlerRunSchema.parse(item.value);
      if (item.PK !== RUN_PARTITION || item.SK !== `RUN#${run.startedAt}#${run.runId}` ||
        item.entityType !== "POLICY_CRAWLER_RUN") throw new Error("Invalid crawler run record.");
      return run;
    });
    return { items, cursor: response.LastEvaluatedKey as Record<string, unknown> | undefined };
  }

  async getSourceVersion(sourceId: string, registryVersion: number): Promise<PolicySourceV1 | undefined> {
    const response = await this.client.send(new GetCommand({ TableName: this.tableName,
      Key: sourceKey(sourceId, `VERSION#${version(registryVersion)}`), ConsistentRead: true,
    }), { abortSignal: AbortSignal.timeout(5_000) });
    return response.Item?.value as PolicySourceV1 | undefined;
  }

  async getCrawlState(sourceId: string): Promise<PolicyCrawlStateV1 | undefined> {
    const response = await this.client.send(new GetCommand({ TableName: this.tableName,
      Key: sourceKey(sourceId, "CRAWL_STATE"), ConsistentRead: true,
    }), { abortSignal: AbortSignal.timeout(5_000) });
    return response.Item?.value as PolicyCrawlStateV1 | undefined;
  }

  async curateSource(previous: PolicySourceV1, next: PolicySourceV1, state: PolicyCrawlStateV1,
    audit: PolicyWorkflowAuditV1): Promise<void> {
    await this.client.send(new TransactWriteCommand({ TransactItems: [
      { Put: { TableName: this.tableName,
        Item: { ...sourceKey(next.sourceId, "CURRENT"), entityType: "POLICY_SOURCE_CURRENT", value: next,
          GSI4PK: "POLICY_SOURCES", GSI4SK: `${next.updatedAt}#${next.sourceId}` },
        ConditionExpression: "#value.#registryVersion = :previousVersion AND #value.#registryStatus = :proposed",
        ExpressionAttributeNames: { "#value": "value", "#registryVersion": "registryVersion", "#registryStatus": "registryStatus" },
        ExpressionAttributeValues: { ":previousVersion": previous.registryVersion, ":proposed": "PROPOSED" } } },
      { Put: { TableName: this.tableName,
        Item: { ...sourceKey(next.sourceId, `VERSION#${version(next.registryVersion)}`),
          entityType: "POLICY_SOURCE_VERSION", value: next },
        ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)" } },
      { Put: { TableName: this.tableName,
        Item: { ...sourceKey(next.sourceId, "CRAWL_STATE"), entityType: "POLICY_CRAWL_STATE", value: state,
          GSI2PK: "POLICY_CRAWL_DUE", GSI2SK: state.nextDueAtEpochSeconds },
        ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)" } },
      { Put: { TableName: this.tableName,
        Item: { ...sourceKey(next.sourceId, auditSort(audit)), entityType: "POLICY_AUDIT", value: audit },
        ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)" } },
    ] }), { abortSignal: AbortSignal.timeout(6_000) });
  }

  async listDue(nowEpoch: number, limit: number): Promise<PolicyCrawlStateV1[]> {
    const response = await this.client.send(new QueryCommand({ TableName: this.tableName, IndexName: "GSI2",
      KeyConditionExpression: "GSI2PK = :due AND GSI2SK <= :now",
      ExpressionAttributeValues: { ":due": "POLICY_CRAWL_DUE", ":now": nowEpoch },
      ScanIndexForward: true, Limit: limit,
    }), { abortSignal: AbortSignal.timeout(5_000) });
    return (response.Items ?? []).map(item => item.value as PolicyCrawlStateV1);
  }

  async claimCrawl(state: PolicyCrawlStateV1, nowEpoch: number, leaseUntilEpoch: number,
    audit: PolicyWorkflowAuditV1): Promise<PolicyCrawlStateV1> {
    const next: PolicyCrawlStateV1 = { ...state, revision: state.revision + 1, status: "RUNNING",
      nextDueAtEpochSeconds: leaseUntilEpoch };
    await this.client.send(new TransactWriteCommand({ TransactItems: [
      { Update: { TableName: this.tableName, Key: sourceKey(state.sourceId, "CRAWL_STATE"),
        UpdateExpression: "SET #value = :next, GSI2SK = :lease",
        ConditionExpression: "#value.#revision = :revision AND GSI2SK <= :now",
        ExpressionAttributeNames: { "#value": "value", "#revision": "revision" },
        ExpressionAttributeValues: { ":next": next, ":lease": leaseUntilEpoch,
          ":revision": state.revision, ":now": nowEpoch } } },
      { Put: { TableName: this.tableName,
        Item: { ...sourceKey(state.sourceId, auditSort(audit)), entityType: "POLICY_AUDIT", value: audit },
        ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)" } },
    ] }), { abortSignal: AbortSignal.timeout(6_000) });
    return next;
  }

  private async finishState(previous: PolicyCrawlStateV1, next: PolicyCrawlStateV1,
    audit: PolicyWorkflowAuditV1): Promise<void> {
    await this.client.send(new TransactWriteCommand({ TransactItems: [
      { Update: { TableName: this.tableName, Key: sourceKey(previous.sourceId, "CRAWL_STATE"),
        UpdateExpression: "SET #value = :next, GSI2SK = :due",
        ConditionExpression: "#value.#revision = :revision",
        ExpressionAttributeNames: { "#value": "value", "#revision": "revision" },
        ExpressionAttributeValues: { ":next": next, ":due": next.nextDueAtEpochSeconds,
          ":revision": previous.revision } } },
      { Put: { TableName: this.tableName,
        Item: { ...sourceKey(previous.sourceId, auditSort(audit)), entityType: "POLICY_AUDIT", value: audit },
        ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)" } },
    ] }), { abortSignal: AbortSignal.timeout(6_000) });
  }

  completeCrawl(previous: PolicyCrawlStateV1, next: PolicyCrawlStateV1,
    audit: PolicyWorkflowAuditV1): Promise<void> { return this.finishState(previous, next, audit); }
  requestCrawl(previous: PolicyCrawlStateV1, next: PolicyCrawlStateV1,
    audit: PolicyWorkflowAuditV1): Promise<void> { return this.finishState(previous, next, audit); }

  async latestDocument(sourceId: string, documentId: string): Promise<PolicyDocumentV1 | undefined> {
    const response = await this.client.send(new QueryCommand({ TableName: this.tableName,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
      ExpressionAttributeValues: { ":pk": sourcePK(sourceId), ":prefix": `DOCUMENT#${documentId}#VERSION#` },
      ScanIndexForward: false, Limit: 1, ConsistentRead: true,
    }), { abortSignal: AbortSignal.timeout(5_000) });
    return response.Items?.[0]?.value as PolicyDocumentV1 | undefined;
  }

  async putChange(change: PolicyChangeRecordV1): Promise<void> {
    await this.client.send(new TransactWriteCommand({ TransactItems: [
      { Put: { TableName: this.tableName,
        Item: { ...changeKey(change.changeId), entityType: "POLICY_CHANGE_CURRENT", value: change,
          reviewRevision: change.revision, reviewStatus: change.reviewStatus,
          GSI1PK: "POLICY_REVIEW_PENDING", GSI1SK: `${change.detectedAt}#${change.changeId}` },
        ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)" } },
      { Put: { TableName: this.tableName,
        Item: { ...changeKey(change.changeId, "DETECTED#00000001"),
          entityType: "POLICY_CHANGE_DETECTED", value: change },
        ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)" } },
    ] }), { abortSignal: AbortSignal.timeout(6_000) });
  }

  async getChange(changeId: string): Promise<PolicyChangeRecordV1 | undefined> {
    const response = await this.client.send(new GetCommand({ TableName: this.tableName,
      Key: changeKey(changeId), ConsistentRead: true,
    }), { abortSignal: AbortSignal.timeout(5_000) });
    return response.Item?.value as PolicyChangeRecordV1 | undefined;
  }

  async listChangeAudit(changeId: string, limit: number): Promise<PolicyWorkflowAuditV1[]> {
    const response = await this.client.send(new QueryCommand({ TableName: this.tableName,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :audit)",
      ExpressionAttributeValues: { ":pk": changePK(changeId), ":audit": "AUDIT#" },
      ScanIndexForward: false, Limit: limit, ConsistentRead: true,
    }), { abortSignal: AbortSignal.timeout(5_000) });
    return (response.Items ?? []).map(item => item.value as PolicyWorkflowAuditV1);
  }

  async reviewChange(previous: PolicyChangeRecordV1, next: PolicyChangeRecordV1,
    audit: PolicyWorkflowAuditV1): Promise<void> {
    await this.client.send(new TransactWriteCommand({ TransactItems: [
      { Put: { TableName: this.tableName,
        Item: { ...changeKey(next.changeId), entityType: "POLICY_CHANGE_CURRENT", value: next,
          reviewRevision: next.revision, reviewStatus: next.reviewStatus },
        ConditionExpression: "reviewRevision = :revision AND reviewStatus = :pending",
        ExpressionAttributeValues: { ":revision": previous.revision, ":pending": "PENDING_APPROVAL" } } },
      { Put: { TableName: this.tableName,
        Item: { ...changeKey(next.changeId, `REVIEW#${version(next.revision)}`),
          entityType: "POLICY_CHANGE_REVIEW", value: next },
        ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)" } },
      { Put: { TableName: this.tableName,
        Item: { ...changeKey(next.changeId, auditSort(audit)), entityType: "POLICY_AUDIT", value: audit },
        ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)" } },
    ] }), { abortSignal: AbortSignal.timeout(6_000) });
  }

  async putCandidate(review: PolicyReviewRecordV1): Promise<void> {
    await this.client.send(new PutCommand({ TableName: this.tableName,
      Item: { ...candidateKey(review.candidate.candidateId), entityType: "POLICY_CANDIDATE", value: review,
        reviewRevision: review.revision, reviewStatus: review.reviewStatus,
        GSI1PK: "POLICY_REVIEW_PENDING", GSI1SK: `${review.detectedAt}#${review.candidate.candidateId}` },
      ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)",
    }), { abortSignal: AbortSignal.timeout(5_000) });
  }

  async getCandidate(candidateId: string): Promise<PolicyReviewRecordV1 | undefined> {
    const response = await this.client.send(new GetCommand({ TableName: this.tableName,
      Key: candidateKey(candidateId), ConsistentRead: true,
    }), { abortSignal: AbortSignal.timeout(5_000) });
    return response.Item?.value as PolicyReviewRecordV1 | undefined;
  }

  async findApprovedClaim(claimKey: string, limit: number): Promise<{ items: PolicyReviewRecordV1[]; truncated: boolean }> {
    const response = await this.client.send(new QueryCommand({ TableName: this.tableName, IndexName: "GSI3",
      KeyConditionExpression: "GSI3PK = :claim",
      ExpressionAttributeValues: { ":claim": `POLICY_APPROVED_CLAIM#${claimKey}` },
      ScanIndexForward: false, Limit: limit,
    }), { abortSignal: AbortSignal.timeout(5_000) });
    const indexed = (response.Items ?? []).filter(item => item.entityType === "POLICY_CANDIDATE")
      .map(item => item.value as PolicyReviewRecordV1);
    const current = await Promise.all(indexed.map(item => this.getCandidate(item.candidate.candidateId)));
    return { items: current.filter((item): item is PolicyReviewRecordV1 =>
      !!item && item.reviewStatus === "APPROVED" && item.candidate.claimKey === claimKey),
      truncated: !!response.LastEvaluatedKey };
  }

  async listQueue(limit: number, cursor?: Record<string, unknown>) {
    const response = await this.client.send(new QueryCommand({ TableName: this.tableName, IndexName: "GSI1",
      KeyConditionExpression: "GSI1PK = :pending", ExpressionAttributeValues: { ":pending": "POLICY_REVIEW_PENDING" },
      ScanIndexForward: false, Limit: limit, ExclusiveStartKey: cursor,
    }), { abortSignal: AbortSignal.timeout(5_000) });
    return { items: (response.Items ?? []).filter(item => item.entityType === "POLICY_CANDIDATE")
      .map(item => item.value as PolicyReviewRecordV1),
      changes: (response.Items ?? []).filter(item => item.entityType === "POLICY_CHANGE_CURRENT")
        .map(item => item.value as PolicyChangeRecordV1),
      cursor: response.LastEvaluatedKey as Record<string, unknown> | undefined };
  }

  async listCandidateAudit(candidateId: string, limit: number): Promise<PolicyWorkflowAuditV1[]> {
    const response = await this.client.send(new QueryCommand({ TableName: this.tableName,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :audit)",
      ExpressionAttributeValues: { ":pk": candidatePK(candidateId), ":audit": "AUDIT#" },
      ScanIndexForward: false, Limit: limit, ConsistentRead: true,
    }), { abortSignal: AbortSignal.timeout(5_000) });
    return (response.Items ?? []).map(item => item.value as PolicyWorkflowAuditV1);
  }

  async reviewCandidate(previous: PolicyReviewRecordV1, next: PolicyReviewRecordV1,
    audit: PolicyWorkflowAuditV1): Promise<void> {
    await this.client.send(new TransactWriteCommand({ TransactItems: [
      { Put: { TableName: this.tableName,
        Item: { ...candidateKey(next.candidate.candidateId), entityType: "POLICY_CANDIDATE", value: next,
          reviewRevision: next.revision, reviewStatus: next.reviewStatus,
          ...(next.reviewStatus === "APPROVED" ? {
            GSI3PK: `POLICY_APPROVED_CLAIM#${next.candidate.claimKey}`,
            GSI3SK: `${next.reviewedAt}#${next.candidate.candidateId}`,
          } : {}) },
        ConditionExpression: "reviewRevision = :revision AND reviewStatus = :pending",
        ExpressionAttributeValues: { ":revision": previous.revision, ":pending": "PENDING_APPROVAL" } } },
      { Put: { TableName: this.tableName,
        Item: { ...candidateKey(next.candidate.candidateId, `REVIEW#${version(next.revision)}`),
          entityType: "POLICY_CANDIDATE_REVIEW", value: next },
        ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)" } },
      { Put: { TableName: this.tableName,
        Item: { ...candidateKey(next.candidate.candidateId, auditSort(audit)),
          entityType: "POLICY_AUDIT", value: audit },
        ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)" } },
    ] }), { abortSignal: AbortSignal.timeout(6_000) });
  }
}
