import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";

/**
 * Reads the OpenAI API key from AWS Secrets Manager at request time (cached briefly), so the key never appears in
 * Lambda configuration, CloudFormation, the repository or logs. The secret is JSON `{"apiKey":"sk-..."}` like the
 * other API-key secrets in this stack; a bare key string is also accepted. Errors never include the secret value.
 */
export interface SecretFetcher { getSecretString(secretId: string): Promise<string | undefined> }

const KEY_SHAPE = /^sk-[A-Za-z0-9_-]{20,}$/;
const CACHE_MS = 5 * 60_000;

export function parseOpenAiKey(secretString: string | undefined): string {
  const raw = secretString?.trim() ?? "";
  let candidate = raw;
  if (raw.startsWith("{")) {
    try { candidate = String((JSON.parse(raw) as { apiKey?: unknown }).apiKey ?? "").trim(); } catch { candidate = ""; }
  }
  if (!KEY_SHAPE.test(candidate)) throw new Error("OPENAI_KEY_INVALID");
  return candidate;
}

export function createOpenAiKeyReader(secretArn: string, region: string, fetcher?: SecretFetcher, now: () => number = Date.now): () => Promise<string> {
  const source: SecretFetcher = fetcher ?? (() => {
    const client = new SecretsManagerClient({ region, maxAttempts: 2, requestHandler: { connectionTimeout: 2_000, requestTimeout: 5_000 } });
    return { getSecretString: async (secretId: string) => (await client.send(new GetSecretValueCommand({ SecretId: secretId }))).SecretString };
  })();
  let cached: { key: string; at: number } | undefined;
  return async () => {
    if (cached && now() - cached.at < CACHE_MS) return cached.key;
    const key = parseOpenAiKey(await source.getSecretString(secretArn));
    cached = { key, at: now() };
    return key;
  };
}
