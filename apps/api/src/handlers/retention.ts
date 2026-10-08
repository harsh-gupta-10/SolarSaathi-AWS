import { parseServerEnv } from "@solarsaathi/config/server";
import { createRetentionExecutor, purgeExpiredGoogleRoofs, type RetentionExecutor } from "../retention/google-roof";

const executors = new Map<string, RetentionExecutor>();

function executorFor(region: string): RetentionExecutor {
  const existing = executors.get(region);
  if (existing) return existing;
  const executor = createRetentionExecutor(region);
  if (executors.size >= 2) executors.delete(executors.keys().next().value!);
  executors.set(region, executor);
  return executor;
}

export interface RetentionHandlerDependencies {
  now?: () => Date;
  createExecutor?: (region: string) => RetentionExecutor;
}

export function createRetentionHandler(dependencies: RetentionHandlerDependencies = {}) {
  return async () => {
    try {
      const environment = parseServerEnv(process.env);
      if (!environment.CORE_TABLE_NAME) throw new Error("Retention table is not configured");
      const now = dependencies.now?.() ?? new Date();
      const execute = dependencies.createExecutor?.(environment.AWS_REGION) ?? executorFor(environment.AWS_REGION);
      const result = await purgeExpiredGoogleRoofs(environment.CORE_TABLE_NAME, execute, Math.floor(now.getTime() / 1_000));
      console.log(JSON.stringify({ event: "google_roof_retention_sweep", ...result }));
      if (result.backlog) throw new Error("Retention backlog remains after the bounded sweep");
      return result;
    } catch {
      // Lambda Errors and the retention alarm surface failure; never log SDK responses or private roof data.
      throw new Error("Google roof retention cleanup failed");
    }
  };
}

export const handler = createRetentionHandler();
