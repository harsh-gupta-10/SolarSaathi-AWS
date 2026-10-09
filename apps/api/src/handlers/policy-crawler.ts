import { parseServerEnv } from "@solarsaathi/config/server";
import { PolicyCrawler } from "../policy/crawler";
import { DynamoPolicyRepository, S3PolicyObjectStore } from "../policy/storage";
import { DynamoPolicyWorkflowRepository } from "../policy/workflow-storage";

export interface PolicyCrawlerHandlerDependencies {
  createCrawler?: (tableName: string, bucket: string, region: string) => PolicyCrawler;
}

export function createPolicyCrawlerHandler(dependencies: PolicyCrawlerHandlerDependencies = {}) {
  const createCrawler = dependencies.createCrawler ?? ((tableName: string, bucket: string, region: string) =>
    new PolicyCrawler(new DynamoPolicyRepository(tableName, region),
      new DynamoPolicyWorkflowRepository(tableName, region), new S3PolicyObjectStore(bucket, region)));
  return async () => {
    const environment = parseServerEnv(process.env);
    const tableName = process.env.POLICY_TABLE_NAME;
    const bucket = process.env.POLICY_DOCUMENT_BUCKET;
    if (!tableName || !/^[A-Za-z0-9_.-]{3,255}$/.test(tableName) ||
      !bucket || !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) {
      throw new Error("Policy crawler storage is not configured.");
    }
    const result = await createCrawler(tableName, bucket, environment.AWS_REGION).runDue();
    console.log(JSON.stringify({ event: "policy_crawl_completed", ...result }));
    if (result.status !== "COMPLETED") throw new Error("Policy crawler failed or exceeded its bounded source batch.");
    return result;
  };
}

export const handler = createPolicyCrawlerHandler();
