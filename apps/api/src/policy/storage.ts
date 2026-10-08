import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { PolicyDocumentV1, PolicySourceV1 } from "@solarsaathi/policy";

export interface PolicyRepository {
  getSource(sourceId: string): Promise<PolicySourceV1 | undefined>;
  putSource(source: PolicySourceV1): Promise<void>;
  getDocument(sourceId: string, documentId: string, version: number): Promise<PolicyDocumentV1 | undefined>;
  putDocument(document: PolicyDocumentV1): Promise<void>;
}

export interface PolicyObjectStore {
  putImmutable(key: string, body: Uint8Array, contentType: string, sha256Hex: string): Promise<string>;
}

const sourceKey = (sourceId: string) => ({ PK: `SOURCE#${sourceId}`, SK: "CURRENT" });
const sourceVersionKey = (sourceId: string, version: number) => ({
  PK: `SOURCE#${sourceId}`, SK: `VERSION#${String(version).padStart(8, "0")}`,
});
const documentKey = (sourceId: string, documentId: string, version: number) => ({
  PK: `SOURCE#${sourceId}`, SK: `DOCUMENT#${documentId}#VERSION#${String(version).padStart(8, "0")}`,
});

export class DynamoPolicyRepository implements PolicyRepository {
  private readonly client: DynamoDBDocumentClient;

  constructor(private readonly tableName: string, region: string, client?: DynamoDBDocumentClient) {
    this.client = client ?? DynamoDBDocumentClient.from(new DynamoDBClient({
      region, maxAttempts: 2,
      requestHandler: { connectionTimeout: 1_000, requestTimeout: 3_000 },
    }), { marshallOptions: { removeUndefinedValues: true } });
  }

  async getSource(sourceId: string): Promise<PolicySourceV1 | undefined> {
    const response = await this.client.send(new GetCommand({
      TableName: this.tableName, Key: sourceKey(sourceId), ConsistentRead: true,
    }), { abortSignal: AbortSignal.timeout(5_000) });
    return response.Item?.value as PolicySourceV1 | undefined;
  }

  async putSource(source: PolicySourceV1): Promise<void> {
    await this.client.send(new TransactWriteCommand({
      TransactItems: [
        { Put: { TableName: this.tableName,
          Item: { ...sourceKey(source.sourceId), entityType: "POLICY_SOURCE_CURRENT", value: source },
          ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)" } },
        { Put: { TableName: this.tableName,
          Item: { ...sourceVersionKey(source.sourceId, source.registryVersion), entityType: "POLICY_SOURCE_VERSION", value: source },
          ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)" } },
      ],
    }), { abortSignal: AbortSignal.timeout(5_000) });
  }

  async getDocument(sourceId: string, documentId: string, version: number): Promise<PolicyDocumentV1 | undefined> {
    const response = await this.client.send(new GetCommand({
      TableName: this.tableName, Key: documentKey(sourceId, documentId, version), ConsistentRead: true,
    }), { abortSignal: AbortSignal.timeout(5_000) });
    return response.Item?.value as PolicyDocumentV1 | undefined;
  }

  async putDocument(document: PolicyDocumentV1): Promise<void> {
    await this.client.send(new PutCommand({
      TableName: this.tableName,
      Item: { ...documentKey(document.sourceId, document.documentId, document.version),
        entityType: "POLICY_DOCUMENT", value: document },
      ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)",
    }), { abortSignal: AbortSignal.timeout(5_000) });
  }
}

export class S3PolicyObjectStore implements PolicyObjectStore {
  private readonly client: S3Client;

  constructor(private readonly bucket: string, region: string) {
    this.client = new S3Client({
      region, maxAttempts: 2,
      requestHandler: { connectionTimeout: 1_000, requestTimeout: 7_000 },
    });
  }

  async putImmutable(key: string, body: Uint8Array, contentType: string, sha256Hex: string): Promise<string> {
    try {
      const response = await this.client.send(new PutObjectCommand({
        Bucket: this.bucket, Key: key, Body: body, ContentType: contentType,
        IfNoneMatch: "*", ServerSideEncryption: "AES256",
        ChecksumSHA256: Buffer.from(sha256Hex, "hex").toString("base64"),
        Metadata: { sha256: sha256Hex },
      }), { abortSignal: AbortSignal.timeout(9_000) });
      if (!response.VersionId) throw new Error("Policy bucket versioning is unavailable.");
      return response.VersionId;
    } catch (error) {
      if (!(error instanceof Error) || !["PreconditionFailed", "ConditionalRequestConflict"].includes(error.name)) throw error;
      const existing = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
        { abortSignal: AbortSignal.timeout(5_000) });
      if (existing.Metadata?.sha256 !== sha256Hex || existing.ContentLength !== body.byteLength ||
        existing.ServerSideEncryption !== "AES256" || !existing.VersionId) {
        throw new Error("Existing policy object does not match immutable content.");
      }
      return existing.VersionId;
    }
  }
}
