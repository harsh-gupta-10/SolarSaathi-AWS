import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, QueryCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { databaseError } from "../data/client";
import { storedApplicationSchema, type ApplicationEventV1, type SolarApplicationV1 } from "./schema";

const applicationKey = (propertyId: string, applicationId: string) => ({ PK: `PROPERTY#${propertyId}`, SK: `APPLICATION#${applicationId}` });
const eventKey = (event: ApplicationEventV1) => ({ PK: `APPLICATION#${event.applicationId}`, SK: `EVENT#${event.occurredAt}#${event.eventId}` });
const parseRecord = (item: Record<string, unknown>) => storedApplicationSchema.parse(item.value);

export interface ApplicationRepository {
  get(propertyId: string, applicationId: string): Promise<SolarApplicationV1 | undefined>;
  list(propertyId: string, limit: number, cursor?: Record<string, string>): Promise<{ items: SolarApplicationV1[]; cursor?: Record<string, string> }>;
  create(record: SolarApplicationV1, event: ApplicationEventV1, expectedPolicyVersion: number): Promise<void>;
  replace(previous: SolarApplicationV1, next: SolarApplicationV1, event: ApplicationEventV1): Promise<void>;
  listEvents(applicationId: string, limit: number, cursor?: Record<string, string>): Promise<{ items: ApplicationEventV1[]; cursor?: Record<string, string> }>;
}

export class DynamoApplicationRepository implements ApplicationRepository {
  private readonly client: DynamoDBDocumentClient;
  constructor(private readonly coreTableName: string, private readonly policyTableName: string, region: string,
    client?: DynamoDBDocumentClient) {
    this.client = client ?? DynamoDBDocumentClient.from(new DynamoDBClient({ region, maxAttempts: 2,
      requestHandler: { connectionTimeout: 1_000, requestTimeout: 3_000 } }),
    { marshallOptions: { removeUndefinedValues: true } });
  }

  async get(propertyId: string, applicationId: string): Promise<SolarApplicationV1 | undefined> {
    try {
      const response = await this.client.send(new GetCommand({ TableName: this.coreTableName,
        Key: applicationKey(propertyId, applicationId), ConsistentRead: true }), { abortSignal: AbortSignal.timeout(5_000) });
      return response.Item ? parseRecord(response.Item) : undefined;
    } catch (error) { throw databaseError(error); }
  }

  async list(propertyId: string, limit: number, cursor?: Record<string, string>) {
    try {
      const response = await this.client.send(new QueryCommand({ TableName: this.coreTableName,
        KeyConditionExpression: "PK = :property AND begins_with(SK, :application)",
        ExpressionAttributeValues: { ":property": `PROPERTY#${propertyId}`, ":application": "APPLICATION#" },
        Limit: limit, ConsistentRead: true, ExclusiveStartKey: cursor }), { abortSignal: AbortSignal.timeout(5_000) });
      return { items: (response.Items ?? []).filter(item => item.entityType === "SOLAR_APPLICATION").map(parseRecord),
        cursor: response.LastEvaluatedKey as Record<string, string> | undefined };
    } catch (error) { throw databaseError(error); }
  }

  async create(record: SolarApplicationV1, event: ApplicationEventV1, expectedPolicyVersion: number): Promise<void> {
    try {
      await this.client.send(new TransactWriteCommand({ TransactItems: [
        { ConditionCheck: { TableName: this.policyTableName,
          Key: { PK: `PUBLISHED_POLICY#${record.policyId}`, SK: "ACTIVE" },
          ConditionExpression: "activeVersion = :version AND #value.#rule.#ruleId = :ruleId",
          ExpressionAttributeNames: { "#value": "value", "#rule": "rule", "#ruleId": "ruleId" },
          ExpressionAttributeValues: { ":version": expectedPolicyVersion, ":ruleId": record.ruleId } } },
        { Put: { TableName: this.coreTableName, Item: { ...applicationKey(record.propertyId, record.applicationId),
          entityType: "SOLAR_APPLICATION", revision: record.revision, value: record },
          ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)" } },
        { Put: { TableName: this.coreTableName, Item: { ...eventKey(event), entityType: "APPLICATION_EVENT", value: event },
          ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)" } },
      ] }), { abortSignal: AbortSignal.timeout(7_000) });
    } catch (error) { throw databaseError(error); }
  }

  async replace(previous: SolarApplicationV1, next: SolarApplicationV1, event: ApplicationEventV1): Promise<void> {
    try {
      await this.client.send(new TransactWriteCommand({ TransactItems: [
        { Put: { TableName: this.coreTableName, Item: { ...applicationKey(next.propertyId, next.applicationId),
          entityType: "SOLAR_APPLICATION", revision: next.revision, value: next },
          ConditionExpression: "revision = :revision AND entityType = :type",
          ExpressionAttributeValues: { ":revision": previous.revision, ":type": "SOLAR_APPLICATION" } } },
        { Put: { TableName: this.coreTableName, Item: { ...eventKey(event), entityType: "APPLICATION_EVENT", value: event },
          ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)" } },
      ] }), { abortSignal: AbortSignal.timeout(7_000) });
    } catch (error) { throw databaseError(error); }
  }

  async listEvents(applicationId: string, limit: number, cursor?: Record<string, string>) {
    try {
      const response = await this.client.send(new QueryCommand({ TableName: this.coreTableName,
        KeyConditionExpression: "PK = :application AND begins_with(SK, :event)",
        ExpressionAttributeValues: { ":application": `APPLICATION#${applicationId}`, ":event": "EVENT#" },
        Limit: limit, ScanIndexForward: false, ConsistentRead: true, ExclusiveStartKey: cursor,
      }), { abortSignal: AbortSignal.timeout(5_000) });
      return { items: (response.Items ?? []).filter(item => item.entityType === "APPLICATION_EVENT")
        .map(item => item.value as ApplicationEventV1),
      cursor: response.LastEvaluatedKey as Record<string, string> | undefined };
    } catch (error) { throw databaseError(error); }
  }
}
