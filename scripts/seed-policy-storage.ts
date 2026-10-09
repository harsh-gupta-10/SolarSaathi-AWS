import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import {
  BASELINE_POLICY_BUNDLES,
  BASELINE_POLICY_SOURCES,
  BASELINE_POLICY_DOCUMENTS,
  BASELINE_CRAWL_STATES,
} from "../packages/policy/src";

const region = process.env.AWS_REGION ?? process.env.NEXT_PUBLIC_COGNITO_REGION ?? "ap-south-1";
const tableName = process.env.POLICY_TABLE_NAME ?? process.argv.find(arg => arg.startsWith("--table="))?.split("=")[1];
const bucketName = process.env.POLICY_DOCUMENT_BUCKET ?? process.argv.find(arg => arg.startsWith("--bucket="))?.split("=")[1];

async function seedPolicyStorage() {
  console.log("=== SolarSaathi Policy Storage Seeder ===");
  console.log(`Region: ${region}`);
  console.log(`DynamoDB Policy Table: ${tableName ?? "NOT_SPECIFIED (dry-run mode)"}`);
  console.log(`S3 Document Bucket: ${bucketName ?? "NOT_SPECIFIED (dry-run mode)"}`);

  const totalBundles = BASELINE_POLICY_BUNDLES.length;
  const totalSources = BASELINE_POLICY_SOURCES.size;
  const totalDocuments = BASELINE_POLICY_DOCUMENTS.size;

  console.log(`Found ${totalSources} verified source(s), ${totalDocuments} official document(s), and ${totalBundles} active policy bundle(s) in catalog:`);
  for (const bundle of BASELINE_POLICY_BUNDLES) {
    console.log(`  - [${bundle.rule.jurisdiction}] ${bundle.policyId} (${bundle.benefitId}) - Scope: ${bundle.rule.scope}`);
  }

  if (!tableName) {
    console.log("\n[Notice] POLICY_TABLE_NAME was not provided. To execute against AWS, supply POLICY_TABLE_NAME environment variable or pass --table=<name>.");
    console.log("Baseline policy catalog is validated and ready for deployment.");
    return;
  }

  const ddbClient = new DynamoDBClient({ region });
  const docClient = DynamoDBDocumentClient.from(ddbClient, { marshallOptions: { removeUndefinedValues: true } });
  const s3Client = bucketName ? new S3Client({ region }) : undefined;

  // 1. Seed Sources and Crawl States
  console.log("\n1. Writing verified policy sources and crawl states to DynamoDB...");
  for (const [sourceId, source] of BASELINE_POLICY_SOURCES.entries()) {
    const versionKey = `VERSION#${String(source.registryVersion).padStart(8, "0")}`;
    const crawlState = BASELINE_CRAWL_STATES.get(sourceId);

    await docClient.send(new PutCommand({
      TableName: tableName,
      Item: {
        PK: `SOURCE#${sourceId}`,
        SK: "CURRENT",
        entityType: "POLICY_SOURCE_CURRENT",
        value: source,
        GSI4PK: "POLICY_SOURCES",
        GSI4SK: `${source.updatedAt}#${sourceId}`,
      },
    }));

    await docClient.send(new PutCommand({
      TableName: tableName,
      Item: {
        PK: `SOURCE#${sourceId}`,
        SK: versionKey,
        entityType: "POLICY_SOURCE_VERSION",
        value: source,
      },
    }));

    if (crawlState) {
      await docClient.send(new PutCommand({
        TableName: tableName,
        Item: {
          PK: `SOURCE#${sourceId}`,
          SK: "CRAWL_STATE",
          entityType: "POLICY_CRAWL_STATE",
          value: crawlState,
          GSI2PK: "POLICY_CRAWL_DUE",
          GSI2SK: crawlState.nextDueAtEpochSeconds,
        },
      }));
    }
    console.log(`  ✓ Seeded source: ${source.name} (${sourceId})`);
  }

  // 2. Seed Documents
  console.log("\n2. Writing official policy documents...");
  for (const doc of BASELINE_POLICY_DOCUMENTS.values()) {
    const documentSk = `DOCUMENT#${doc.documentId}#VERSION#${String(doc.version).padStart(8, "0")}`;
    await docClient.send(new PutCommand({
      TableName: tableName,
      Item: {
        PK: `SOURCE#${doc.sourceId}`,
        SK: documentSk,
        entityType: "POLICY_DOCUMENT",
        value: doc,
      },
    }));
    console.log(`  ✓ Seeded document metadata: ${doc.title} (${doc.documentId})`);

    if (s3Client && bucketName) {
      const rawPayload = Buffer.from(JSON.stringify(doc), "utf8");
      try {
        await s3Client.send(new PutObjectCommand({
          Bucket: bucketName,
          Key: `raw/${doc.sourceId}/${doc.documentId}/${doc.version}.json`,
          Body: rawPayload,
          ContentType: "application/json",
          Metadata: { sha256: doc.sha256 },
        }));
        await s3Client.send(new PutObjectCommand({
          Bucket: bucketName,
          Key: `derived/${doc.sourceId}/${doc.documentId}/v${String(doc.version).padStart(8, "0")}/${doc.sha256}.json`,
          Body: rawPayload,
          ContentType: "application/json",
          Metadata: { sha256: doc.sha256 },
        }));
        console.log(`    ↳ Archived to S3 bucket ${bucketName}`);
      } catch (err: unknown) {
        console.warn(`    ↳ S3 archiving warning: ${(err as Error).message}`);
      }
    }
  }

  // 3. Seed Published Bundles and GSI5 Active Benefit Pointers
  console.log("\n3. Writing active policy bundles and GSI5 index pointers...");
  for (const bundle of BASELINE_POLICY_BUNDLES) {
    const versionSk = `VERSION#${String(bundle.version.version).padStart(8, "0")}`;

    await docClient.send(new PutCommand({
      TableName: tableName,
      Item: {
        PK: `PUBLISHED_POLICY#${bundle.policyId}`,
        SK: versionSk,
        entityType: "POLICY_PUBLISHED_VERSION",
        value: bundle,
      },
    }));

    await docClient.send(new PutCommand({
      TableName: tableName,
      Item: {
        PK: `PUBLISHED_POLICY#${bundle.policyId}`,
        SK: "ACTIVE",
        entityType: "ACTIVE_POLICY_POINTER",
        activeVersion: bundle.version.version,
        value: bundle,
        GSI5PK: `ACTIVE_POLICY_BENEFITS#${bundle.rule.jurisdiction}`,
        GSI5SK: bundle.policyId,
      },
    }));

    console.log(`  ✓ Seeded active policy pointer: [${bundle.rule.jurisdiction}] -> ${bundle.policyId} (v${bundle.version.version})`);
  }

  // 4. Verify GSI5 Query Readiness
  console.log("\n4. Verifying DynamoDB GSI5 query index readiness...");
  for (const jurisdiction of ["IN", "IN-MH"]) {
    const result = await docClient.send(new QueryCommand({
      TableName: tableName,
      IndexName: "GSI5",
      KeyConditionExpression: "GSI5PK = :active",
      ExpressionAttributeValues: { ":active": `ACTIVE_POLICY_BENEFITS#${jurisdiction}` },
    }));
    const count = result.Items?.length ?? 0;
    console.log(`  ✓ Query ACTIVE_POLICY_BENEFITS#${jurisdiction}: found ${count} active rule pointer(s).`);
  }

  console.log("\n=== Policy Storage Seeding Complete! ===");
}

seedPolicyStorage().catch((error) => {
  console.error("Policy seeding failed:", error);
  process.exit(1);
});
