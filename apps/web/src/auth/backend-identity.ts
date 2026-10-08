import { fetchAuthSession } from "aws-amplify/auth";
import { z } from "zod";
import type { CurrentIdentityResponse } from "@solarsaathi/types";
import { getPublicEnvironment } from "../lib/env";

const identitySchema = z.object({
  profile: z.object({
    userId: z.string().min(1).max(128), cognitoSub: z.string().min(1).max(128),
    email: z.string().email(), name: z.string().max(2048), role: z.enum(["HOMEOWNER", "BROKER"]),
    organizationId: z.string().min(1).max(128).optional(),
  }).strict(),
  emailVerified: z.boolean(), source: z.literal("COGNITO"), requestId: z.string().min(1).max(256),
}).strict();

export class BackendIdentityError extends Error {
  constructor(public readonly code: "API_NOT_CONFIGURED" | "SESSION_UNAVAILABLE" | "UNAUTHORIZED" | "AUTH_NOT_CONFIGURED" | "SERVICE_UNAVAILABLE" | "INVALID_IDENTITY" | "TIMEOUT" | "CANCELLED", message: string) { super(message); }
}
export function identityEndpoint(): string | undefined {
  const base = getPublicEnvironment().NEXT_PUBLIC_API_BASE_URL;
  if (!base) return undefined;
  const url = new URL(base);
  if (url.search || url.hash) return undefined;
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/me`;
  return url.toString();
}
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const aborted = () => reject(new BackendIdentityError("CANCELLED", "The identity check was cancelled."));
    if (signal.aborted) { aborted(); return; }
    signal.addEventListener("abort", aborted, { once: true });
    promise.then(value => {
      signal.removeEventListener("abort", aborted);
      if (signal.aborted) aborted(); else resolve(value);
    }, error => { signal.removeEventListener("abort", aborted); reject(error); });
  });
}
export async function verifyBackendIdentity(expectedUserId: string, signal?: AbortSignal): Promise<CurrentIdentityResponse> {
  const endpoint = identityEndpoint();
  if (!endpoint) throw new BackendIdentityError("API_NOT_CONFIGURED", "The backend API is not configured yet.");
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal?.addEventListener("abort", cancel, { once: true });
  if (signal?.aborted) controller.abort();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 8_000);
  try {
    if (controller.signal.aborted) throw new BackendIdentityError("CANCELLED", "The identity check was cancelled.");
    let session: Awaited<ReturnType<typeof fetchAuthSession>>;
    try { session = await abortable(fetchAuthSession(), controller.signal); }
    catch (error) {
      if (controller.signal.aborted) throw error;
      throw new BackendIdentityError("SESSION_UNAVAILABLE", "Your sign-in session is unavailable. Sign in again.");
    }
    const token = session.tokens?.accessToken?.toString();
    if (!token) throw new BackendIdentityError("SESSION_UNAVAILABLE", "Your sign-in session is unavailable. Sign in again.");
    const response = await abortable(fetch(endpoint, {
      method: "GET", headers: { authorization: `Bearer ${token}`, accept: "application/json" },
      credentials: "omit", cache: "no-store", redirect: "error", signal: controller.signal,
    }), controller.signal);
    if (response.status === 401 || response.status === 403) throw new BackendIdentityError("UNAUTHORIZED", "The API rejected this session. Sign in again or check the app configuration.");
    if (!response.ok) {
      let body: unknown;
      try { body = await abortable(response.json(), controller.signal); } catch { body = null; }
      if (typeof body === "object" && body !== null && "error" in body && typeof body.error === "object" && body.error !== null && "code" in body.error && body.error.code === "AUTH_NOT_CONFIGURED") {
        throw new BackendIdentityError("AUTH_NOT_CONFIGURED", "Backend authentication has not been configured yet.");
      }
      throw new BackendIdentityError("SERVICE_UNAVAILABLE", "The identity service is unavailable. Try again later.");
    }
    const parsed = identitySchema.safeParse(await abortable(response.json(), controller.signal));
    if (!parsed.success || parsed.data.profile.userId !== expectedUserId || parsed.data.profile.cognitoSub !== expectedUserId) {
      throw new BackendIdentityError("INVALID_IDENTITY", "The API returned an unexpected identity. Check the app configuration.");
    }
    return parsed.data;
  } catch (error) {
    if (timedOut) throw new BackendIdentityError("TIMEOUT", "The identity check took too long. Try again.");
    if (controller.signal.aborted) throw new BackendIdentityError("CANCELLED", "The identity check was cancelled.");
    if (error instanceof BackendIdentityError) throw error;
    throw new BackendIdentityError("SERVICE_UNAVAILABLE", "The identity service is unavailable. Try again later.");
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", cancel);
  }
}
