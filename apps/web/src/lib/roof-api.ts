import { fetchAuthSession } from "aws-amplify/auth";
import { z } from "zod";
import type {
  GeocodeCandidate, ManualRoofMeasurements, RoofConfirmationResponse,
  RoofGeocodeResponse, RoofPoint, RoofPreviewResponse,
} from "@solarsaathi/types";
import { getPublicEnvironment } from "./env";

const point = z.object({ latitude: z.number().finite().min(-90).max(90), longitude: z.number().finite().min(-180).max(180) });
const bounds = z.object({ southwest: point, northeast: point });
const candidate = z.object({ placeId: z.string().min(1), address: z.string().min(1), location: point,
  locationType: z.string(), partialMatch: z.boolean() });
const roof = z.object({ schemaVersion: z.literal(1), source: z.enum(["GOOGLE_SOLAR", "MANUAL"]), measuredAt: z.string().min(1),
  roofAreaSquareMeters: z.number().finite().positive(), groundAreaSquareMeters: z.number().finite().positive().optional(),
  segmentCount: z.number().int().positive(), segments: z.array(z.object({
    segmentId: z.string().min(1), areaSquareMeters: z.number().finite().positive(),
    groundAreaSquareMeters: z.number().finite().positive().optional(),
    pitchDegrees: z.number().finite().min(0).max(90).optional(), azimuthDegrees: z.number().finite().min(0).max(360).optional(),
    planeHeightAtCenterMeters: z.number().finite().optional(), center: point.optional(), bounds: bounds.optional(),
    sunshineQuantiles: z.array(z.number().finite()).optional(),
  }).passthrough()).min(1), center: point.optional(), bounds: bounds.optional(),
  imageryDate: z.iso.date().optional(), imageryQuality: z.enum(["HIGH", "MEDIUM", "BASE"]).optional(),
  panelWidthMeters: z.number().finite().positive().optional(), panelHeightMeters: z.number().finite().positive().optional(),
  panelCapacityWatts: z.number().finite().positive().optional(),
  panelSuggestions: z.array(z.object({ center: point, orientation: z.enum(["LANDSCAPE", "PORTRAIT"]),
    segmentIndex: z.number().int().nonnegative(), yearlyEnergyDcKwh: z.number().finite().nonnegative().optional(),
  })).optional(),
  manualDimensions: z.object({ lengthMeters: z.number().finite().positive().optional(), widthMeters: z.number().finite().positive().optional() }).optional(),
}).passthrough().refine(value => value.segmentCount === value.segments.length);
const envelope = { schemaVersion: z.literal(1), requestId: z.string().min(1) };
const geocodeResponse = z.object({ ...envelope, source: z.literal("GOOGLE_GEOCODING"), candidates: z.array(candidate) });
const previewResponse = z.object({ ...envelope, source: z.literal("GOOGLE_SOLAR"), previewId: z.string().min(1), roof });
const confirmationResponse = z.object({ ...envelope, source: z.enum(["GOOGLE_SOLAR", "MANUAL"]), analysisId: z.string().min(1), roof });
const propertyResponse = z.object({ ...envelope, source: z.literal("DYNAMODB"), property: z.object({ propertyId: z.string().min(1) }).passthrough() });
const customerResponse = z.object({ ...envelope, source: z.literal("DYNAMODB"), customer: z.object({ customerId: z.string().min(1) }).passthrough() });

export class RoofRequestError extends Error {
  constructor(public readonly code: string, message: string) { super(message); }
}

function endpoint(path: string): string {
  const base = getPublicEnvironment().NEXT_PUBLIC_API_BASE_URL;
  if (!base) throw new RoofRequestError("API_NOT_CONFIGURED", "Roof analysis is not connected in this deployment.");
  const url = new URL(base);
  if (url.search || url.hash || url.username || url.password) throw new RoofRequestError("API_NOT_CONFIGURED", "The analysis API address is invalid.");
  url.pathname = `${url.pathname.replace(/\/+$/, "")}${path}`;
  return url.toString();
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const cancel = () => reject(new RoofRequestError("CANCELLED", "The request was cancelled."));
    if (signal.aborted) { cancel(); return; }
    signal.addEventListener("abort", cancel, { once: true });
    promise.then(value => { signal.removeEventListener("abort", cancel); if (signal.aborted) cancel(); else resolve(value); },
      error => { signal.removeEventListener("abort", cancel); reject(error); });
  });
}

export async function postAuthenticated<T>(path: string, body: unknown, schema: z.ZodType<T>, signal?: AbortSignal,
  timeoutMs = 12_000): Promise<T> {
  const url = endpoint(path);
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal?.addEventListener("abort", cancel, { once: true });
  if (signal?.aborted) controller.abort();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  try {
    if (controller.signal.aborted) throw new RoofRequestError("CANCELLED", "The request was cancelled.");
    let session: Awaited<ReturnType<typeof fetchAuthSession>>;
    try { session = await abortable(fetchAuthSession(), controller.signal); }
    catch (error) {
      if (controller.signal.aborted) throw error;
      throw new RoofRequestError("SESSION_UNAVAILABLE", "Your sign-in session is unavailable. Sign in again.");
    }
    if (controller.signal.aborted) throw new RoofRequestError("CANCELLED", "The request was cancelled.");
    const token = session.tokens?.accessToken?.toString();
    if (!token) throw new RoofRequestError("SESSION_UNAVAILABLE", "Sign in to analyze this property.");
    const response = await fetch(url, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body), credentials: "omit", cache: "no-store", redirect: "error", signal: controller.signal });
    let payload: unknown;
    try { payload = await abortable(response.json(), controller.signal); } catch { throw new RoofRequestError("INVALID_RESPONSE", "The analysis service returned an unreadable response. Try again."); }
    if (!response.ok) {
      const error = z.object({ error: z.object({ code: z.string(), message: z.string() }) }).safeParse(payload);
      if (response.status === 401 || response.status === 403) throw new RoofRequestError("UNAUTHORIZED", "Your session cannot access this property. Sign in again.");
      throw new RoofRequestError(error.success ? error.data.error.code : "SERVICE_UNAVAILABLE",
        error.success ? error.data.error.message : "The analysis service is unavailable. Try again.");
    }
    const parsed = schema.safeParse(payload);
    if (!parsed.success) throw new RoofRequestError("INVALID_RESPONSE", "The analysis service returned unexpected data. Try again.");
    return parsed.data;
  } catch (error) {
    if (timedOut) throw new RoofRequestError("TIMEOUT", "The analysis request took too long. Try again.");
    if (controller.signal.aborted) throw new RoofRequestError("CANCELLED", "The request was cancelled.");
    if (error instanceof RoofRequestError) throw error;
    throw new RoofRequestError("SERVICE_UNAVAILABLE", "The analysis service could not be reached. Check your connection and try again.");
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", cancel);
  }
}

export const roofApi = {
  bootstrap: (signal?: AbortSignal) => postAuthenticated("/users/bootstrap", {}, z.object({ ...envelope, source: z.literal("DYNAMODB") }).passthrough(), signal),
  createCustomer: async (name: string, signal?: AbortSignal): Promise<string> =>
    (await postAuthenticated("/customers", { name }, customerResponse, signal)).customer.customerId,
  createProperty: async (address: string, customerId?: string, signal?: AbortSignal): Promise<string> =>
    (await postAuthenticated("/properties", { label: "Rooftop solar property", address, ...(customerId ? { customerId } : {}) }, propertyResponse, signal)).property.propertyId,
  geocode: (propertyId: string, signal?: AbortSignal): Promise<RoofGeocodeResponse> =>
    postAuthenticated("/solar/geocode", { propertyId }, geocodeResponse, signal) as Promise<RoofGeocodeResponse>,
  insights: (propertyId: string, selected: GeocodeCandidate, location: RoofPoint, signal?: AbortSignal): Promise<RoofPreviewResponse> =>
    postAuthenticated("/solar/building-insights", { propertyId, placeId: selected.placeId, location }, previewResponse, signal) as Promise<RoofPreviewResponse>,
  confirmBuilding: (propertyId: string, previewId: string, signal?: AbortSignal): Promise<RoofPreviewResponse> =>
    postAuthenticated("/solar/confirm-building", { propertyId, previewId, confirmed: true }, previewResponse, signal) as Promise<RoofPreviewResponse>,
  confirmRoof: (propertyId: string, previewId: string, signal?: AbortSignal): Promise<RoofConfirmationResponse> =>
    postAuthenticated("/solar/confirm-roof", { propertyId, previewId, confirmed: true }, confirmationResponse, signal) as Promise<RoofConfirmationResponse>,
  confirmManualRoof: (propertyId: string, manual: ManualRoofMeasurements, signal?: AbortSignal): Promise<RoofConfirmationResponse> =>
    postAuthenticated("/solar/confirm-roof", { propertyId, manual, confirmed: true }, confirmationResponse, signal) as Promise<RoofConfirmationResponse>,
};
