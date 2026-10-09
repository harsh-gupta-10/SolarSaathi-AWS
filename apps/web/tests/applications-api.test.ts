import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applicationsApi } from "../src/lib/applications-api";

const mocks = vi.hoisted(() => ({ session: vi.fn() }));
vi.mock("../src/lib/env", () => ({ getPublicEnvironment: () => ({ NEXT_PUBLIC_API_BASE_URL: "https://api.example.com/v1" }) }));
vi.mock("aws-amplify/auth", () => ({ fetchAuthSession: mocks.session }));

beforeEach(() => { mocks.session.mockResolvedValue({ tokens: { accessToken: { toString: () => "access-token" } } }); });
afterEach(() => { mocks.session.mockReset(); vi.unstubAllGlobals(); });

describe("application API client", () => {
  it("scopes GET lists to an encoded property with a bearer token and no cookies", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, status: 200,
      json: async () => ({ schemaVersion: 1, source: "DYNAMODB_APPLICATION_TRACKER_V1", requestId: "request-1",
        applications: [], nextCursor: "opaque" }) });
    vi.stubGlobal("fetch", fetcher);
    await expect(applicationsApi.list("property-one", "cursor-value")).resolves.toMatchObject({ applications: [], nextCursor: "opaque" });
    expect(fetcher).toHaveBeenCalledWith("https://api.example.com/v1/applications?propertyId=property-one&cursor=cursor-value",
      expect.objectContaining({ method: "GET", credentials: "omit", redirect: "error", cache: "no-store",
        headers: expect.objectContaining({ authorization: "Bearer access-token" }) }));
    expect(fetcher.mock.calls[0]?.[1]).not.toHaveProperty("body");
  });
});
