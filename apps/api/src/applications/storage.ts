import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, QueryCommand, TransactWriteCommand,
  type TransactWriteCommandInput } from "@aws-sdk/lib-dynamodb";
import { databaseError } from "../data/client";
import type { PropertyWriteScope } from "../data/service";
import { storedApplicationSchema, type ApplicationEventV1, type SolarApplicationV1 } from "./schema";

const applicationKey = (propertyId: string, applicationId: string) => ({ PK: `PROPERTY#${propertyId}`, SK: `APPLICATION#${applicationId}` });
const eventKey = (event: ApplicationEventV1) => ({ PK: `APPLICATION#${event.applicationId}`, SK: `EVENT#${event.occurredAt}#${event.eventId}` });
const parseRecord = (item: Record<string, unknown>) => storedApplicationSchema.parse(item.value);

export interface ApplicationRepository {
  get(propertyId: string, applicationId: string): Promise<SolarApplicationV1 | undefined>;
  list(propertyId: string, limit: number, cursor?: Record<string, string>): Promise<{ items: SolarApplicationV1[]; cursor?: Record<string, string> }>;
  create(record: SolarApplicationV1, event: ApplicationEventV1, expectedPolicyVersion: number, scope: PropertyWriteScope): Promise<void>;
  replace(previous: SolarApplicationV1, next: SolarApplicationV1, event: ApplicationEventV1, scope: PropertyWriteScope): Promise<void>;
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

  private writeGuards(scope: PropertyWriteScope): NonNullable<TransactWriteCommandInput["TransactItems"]> {
    return [
      { ConditionCheck: { TableName: this.coreTableName, Key: { PK: `ORG#${scope.orgId}`, SK: "PROFILE" },
        ConditionExpression: "#revision = :revision AND #kind = :kind AND (#owner = :actor OR contains(#members, :actor))",
        ExpressionAttributeNames: { "#revision": "revision", "#kind": "kind", "#owner": "ownerUserId", "#members": "memberUserIds" },
        ExpressionAttributeValues: { ":revision": scope.organizationRevision, ":kind": scope.organizationKind,
          ":actor": scope.actorUserId } } },
      { ConditionCheck: { TableName: this.coreTableName, Key: { PK: `USER#${scope.actorUserId}`, SK: "PROFILE" },
        ConditionExpression: "#revision = :revision AND #org = :org AND #role = :role",
        ExpressionAttributeNames: { "#revision": "revision", "#org": "orgId", "#role": "role" },
        ExpressionAttributeValues: { ":revision": scope.userRevision, ":org": scope.orgId, ":role": scope.actorRole } } },
      { ConditionCheck: { TableName: this.coreTableName,
        Key: { PK: `CUSTOMER#${scope.customerId}`, SK: `PROPERTY#${scope.propertyId}` },
        ConditionExpression: "#revision = :revision AND #org = :org AND #owner = :owner AND #customer = :customer",
        ExpressionAttributeNames: { "#revision": "revision", "#org": "orgId", "#owner": "ownerUserId", "#customer": "customerId" },
        ExpressionAttributeValues: { ":revision": scope.propertyRevision, ":org": scope.orgId,
          ":owner": scope.propertyOwnerUserId, ":customer": scope.customerId } } },
      { ConditionCheck: { TableName: this.coreTableName,
        Key: { PK: `PROPERTY#${scope.propertyId}`, SK: "LOCATOR" },
        ConditionExpression: "#revision = :revision AND #org = :org AND #owner = :owner AND #customer = :customer",
        ExpressionAttributeNames: { "#revision": "revision", "#org": "orgId", "#owner": "ownerUserId", "#customer": "customerId" },
        ExpressionAttributeValues: { ":revision": scope.locatorRevision, ":org": scope.orgId,
          ":owner": scope.propertyOwnerUserId, ":customer": scope.customerId } } },
    ];
  }

  async create(record: SolarApplicationV1, event: ApplicationEventV1, expectedPolicyVersion: number,
    scope: PropertyWriteScope): Promise<void> {
    try {
      await this.client.send(new TransactWriteCommand({ TransactItems: [
        ...this.writeGuards(scope),
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

  async replace(previous: SolarApplicationV1, next: SolarApplicationV1, event: ApplicationEventV1,
    scope: PropertyWriteScope): Promise<void> {
    try {
      await this.client.send(new TransactWriteCommand({ TransactItems: [
        ...this.writeGuards(scope),
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
