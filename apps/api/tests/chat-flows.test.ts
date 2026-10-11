import type { APIGatewayProxyEvent, Context, LambdaFunctionURLEvent } from "aws-lambda";
import type { ChatStreamEvent } from "@solarsaathi/types";
import { describe, expect, it, vi } from "vitest";
import { buildReadinessPack, GENERAL_GUIDANCE_LABEL } from "../src/chat/checklist";
import { confirmProposal } from "../src/chat/confirm";
import { ChatLimits } from "../src/chat/limits";
import type { ChatRuntime } from "../src/chat/services";
import { ChatStore } from "../src/chat/store";
import { handleChatTurn } from "../src/chat/stream-service";
import { createChatsHandler } from "../src/handlers/chats";
import { serveChatStream, type SseSink } from "../src/handlers/chat-stream";
import { RequestError } from "../src/lib/http";
import { runTurn } from "../src/chat/agent";
import { PriceBenchmarkStore } from "../src/pricing/store";
import { actorId, otherId } from "./data-fixtures";
import { counterId, fakeServices, fixedClock, identity, MemoryItemTable, ScriptedBedrock, textTurn, toolTurn, type StreamScript } from "./chat-fixtures";

const propertyId = "property-1";
const analyses = { analyses: [{ analysisId: "analysis-1", propertyId, source: "MANUAL", measuredAt: "2026-10-01T00:00:00.000Z", roofAreaSquareMeters: 80, segmentCount: 1 }] };
const decision = { benefitId: "BENEFIT#a", ruleId: "RULE#a", policyId: "POLICY#a", policyVersion: 2, status: "SELECTED", scope: "CENTRAL", jurisdiction: "IN", effectiveFrom: "2026-01-01",
  countedAmountPaise: 7_800_000, calculatedAmountPaise: 7_800_000, reasonCodes: [], lastVerifiedAt: "2026-10-10T00:00:00.000Z",
  citations: [{ sourceUrl: "https://pmsuryaghar.gov.in/x", publisherName: "MNRE" }], sourceChecks: [{ sourceId: "SRC#a", lastCheckedAt: "2026-10-10T00:00:00.000Z", fresh: true, status: "HEALTHY" }] };
const facts = { state: "MH", customerType: "RESIDENTIAL", ownership: "OWNER", gridConnected: true, priorSubsidyReceived: false };

async function drain(generator: AsyncGenerator<ChatStreamEvent>) { const events: ChatStreamEvent[] = []; for await (const event of generator) events.push(event); return events; }
function collectTurn(services: ReturnType<typeof fakeServices>, scripts: StreamScript[], message: string) {
  const generator = runTurn(new ScriptedBedrock(scripts), { modelId: "m" }, { identity: identity(), requestId: "r", chatId: "c", userMessage: message, history: [], services, now: fixedClock, createId: counterId("c") });
  return (async () => { const events: ChatStreamEvent[] = []; let next = await generator.next(); while (!next.done) { events.push(next.value); next = await generator.next(); } return events; })();
}

describe("readiness pack", () => {
  it("uses published steps when given and labels guidance otherwise", () => {
    const published = buildReadinessPack({ roofConfirmed: true, ownership: "TENANT", processSteps: [
      { stepId: "REGISTER", order: 1, title: "Register on portal", description: "Register using your state and DISCOM.", required: true }] });
    expect(published.source).toBe("PUBLISHED_POLICY");
    expect(published.steps.map(step => step.stepId)).toEqual(["REGISTER"]);
    expect(published.documents.find(item => item.id === "LANDLORD_NOC")!.needed).toBe(true);
    const general = buildReadinessPack({ roofConfirmed: true, ownership: "OWNER" });
    expect(general).toMatchObject({ source: "GENERAL_GUIDANCE", label: GENERAL_GUIDANCE_LABEL });
    expect(general.steps).toHaveLength(7);
    expect(general.documents.find(item => item.id === "LANDLORD_NOC")!.needed).toBe(false);
    expect(general.doNotShare.join(" ")).toMatch(/Aadhaar/);
    expect(JSON.stringify(general)).not.toMatch(/consumerNumber|password":|otp":/i);
  });
});

describe("prepare_application", () => {
  const evaluate = vi.fn(async () => ({ status: "AVAILABLE", evaluatedAt: "2026-10-11T00:00:00.000Z",
    result: { decisions: [decision], totalEligibleBenefitPaise: 7_800_000, coverageComplete: true, warnings: [] } }));
  const args = { propertyId, monthlyConsumptionKwh: 600, nominalKw: 3, ...facts };

  it("produces a checklist from the published policy and a tracker proposal without creating anything", async () => {
    const create = vi.fn();
    const services = fakeServices({ core: { listAnalyses: async () => analyses }, benefits: { evaluate }, applications: { create },
      publication: { getActive: async () => ({ version: { version: 2 }, rule: { processSteps: [
        { stepId: "REGISTER", order: 1, title: "Register on portal", description: "Register using your details.", required: true },
        { stepId: "APPLY", order: 2, title: "Submit application", description: "Submit with roof details.", required: true }] } }) } });
    const events = await collectTurn(services, [toolTurn("prepare_application", args), textTurn("Review and confirm.")], "I use 600 units");
    expect(events.find(event => event.type === "card")).toMatchObject({ card: { kind: "CHECKLIST", provenance: { verificationStatus: "VERIFIED", source: "POLICY:POLICY#a@v2" } } });
    expect(events.find(event => event.type === "proposal")).toMatchObject({ proposal: { action: "CREATE_APPLICATION" } });
    expect(create).not.toHaveBeenCalled();
    const stored = [...services.items.items.values()].find(item => item.entityType === "CHAT_PROPOSAL")!;
    expect(JSON.stringify(stored.params)).not.toMatch(/aadhaar|consumer|password|otp|bank/i);
  });

  it("labels general guidance and creates no tracker proposal when no verified process exists", async () => {
    const services = fakeServices({ core: { listAnalyses: async () => analyses }, benefits: { evaluate }, publication: { getActive: async () => ({ version: { version: 2 }, rule: {} }) } });
    const events = await collectTurn(services, [toolTurn("prepare_application", args), textTurn("Here is a general checklist.")], "I use 600 units");
    expect(events.find(event => event.type === "card")).toMatchObject({ card: { kind: "CHECKLIST", provenance: { source: "GENERAL_GUIDANCE" }, data: { disclaimer: GENERAL_GUIDANCE_LABEL } } });
    expect(events.some(event => event.type === "proposal")).toBe(false);
  });
});

describe("quote and research tools", () => {
  const benchmark = { schemaVersion: 1, benchmarkId: "PB-test0001", scope: { level: "STATE", state: "MH" }, sizeBand: { minKw: 1, maxKw: 5 }, moduleClass: "DCR", inverterType: "UNSPECIFIED",
    rupeesPerKw: { min: 50_000, typical: 55_000, max: 60_000 }, inclusions: ["Structure"], exclusions: ["Net-meter fee"],
    source: { url: "https://example.gov.in/rates", publisher: "example.gov.in", authorityTier: "OFFICIAL" }, publishedOn: "2026-09-01T00:00:00.000Z",
    lastCheckedAt: "2026-10-01T00:00:00.000Z", expiresAt: "2027-03-01T00:00:00.000Z", status: "APPROVED" };
  const design = { design: { demand: { annualConsumptionKwh: 7_200 }, assumptions: { generationKwhPerKwYear: 1_500 }, decisionCode: "RECOMMENDED_CLOSEST_TO_TARGET", warnings: [],
    recommendation: { nominalKw: 3, panelCount: 6, actualDcKw: 3.3, estimatedAnnualGenerationKwh: 4_950, annualConsumptionCoverageRatio: 0.69, roofFit: "FITS", recommendationEligible: true },
    candidates: [{ nominalKw: 3, panelCount: 6, actualDcKw: 3.3, estimatedAnnualGenerationKwh: 4_950, annualConsumptionCoverageRatio: 0.69, roofFit: "FITS", recommendationEligible: true }] } };

  it("quotes only approved benchmarks for a grounded size, and says unavailable otherwise", async () => {
    for (const [benchmarks, kind] of [[[benchmark], "available"], [[], "unavailable"]] as const) {
      const services = fakeServices({ core: { listAnalyses: async () => analyses }, systems: { recommend: async () => design }, prices: { listUsable: async () => benchmarks } });
      const events = await collectTurn(services, [toolTurn("recommend_systems", { propertyId, monthlyConsumptionKwh: 600 }),
        toolTurn("get_indicative_quote", { actualDcKw: 3.3, state: "MH", moduleClass: "DCR" }, "tool-2"), textTurn("done")], "600 units");
      const quote = events.filter(event => event.type === "card").map(event => event.type === "card" ? event.card : undefined).find(card => card?.kind === "QUOTE")!;
      if (kind === "available") {
        expect(quote.data.rows![0]).toMatchObject({ label: "Indicative range", value: "₹1,65,000 to ₹1,98,000" });
        expect(quote.data.disclaimer).toMatch(/not an offer/i);
        expect(quote.provenance).toMatchObject({ verificationStatus: "INDICATIVE", effectiveDate: "2026-09-01" });
      } else {
        expect(quote.title).toBe("No approved price range yet");
        expect(JSON.stringify(quote.data)).not.toMatch(/₹\d/);
      }
    }
  });

  it("rejects an invented system size", async () => {
    const services = fakeServices({ prices: { listUsable: async () => [benchmark] } });
    const events = await collectTurn(services, [toolTurn("get_indicative_quote", { actualDcKw: 7.7, state: "MH", moduleClass: "DCR" }), textTurn("Which size?")], "quote me");
    expect(events.some(event => event.type === "card")).toBe(false);
  });

  it("returns research as an unverified card, never as a quote", async () => {
    const research = vi.fn(async () => ({ status: "OK", query: "q", pagesRead: 1, pagesFailed: 0, candidates: [{ benchmarkId: "PB-1", created: true, publisher: "mnre.gov.in", authorityTier: "OFFICIAL",
      sourceUrl: "https://mnre.gov.in/x", title: "t", rupeesPerKw: { min: 45_000, typical: 47_000, max: 49_000 }, sizeBand: { minKw: 1, maxKw: 3 }, moduleClass: "DCR", scope: { level: "NATIONAL" },
      publishedOn: "2026-09-01T00:00:00.000Z", notes: ["Extracted automatically."] }] }));
    const services = fakeServices({ core: { listAnalyses: async () => analyses }, systems: { recommend: async () => design }, research: { research } });
    const events = await collectTurn(services, [toolTurn("recommend_systems", { propertyId, monthlyConsumptionKwh: 600 }),
      toolTurn("research_prices", { state: "MH", sizeKw: 3.3, moduleClass: "DCR" }, "tool-2"), textTurn("done")], "600 units");
    const card = events.flatMap(event => event.type === "card" ? [event.card] : []).find(item => item.kind === "PRICE_RESEARCH")!;
    expect(card.provenance).toMatchObject({ verificationStatus: "UNVERIFIED" });
    expect(card.title).toContain("unverified");
    expect(events.flatMap(event => event.type === "card" ? [event.card.kind] : [])).not.toContain("QUOTE");
  });
});

describe("confirmation executes through existing services", () => {
  it("creates the property once, even if the confirm is retried or double-submitted", async () => {
    const createProperty = vi.fn(async () => ({ propertyId: "p-new", label: "Home", address: "12 MG Road Pune" }));
    const services = fakeServices({ core: { createProperty } });
    const proposal = await services.proposals.create(actorId, { action: "CREATE_PROPERTY", params: { label: "Home", address: "12 MG Road Pune" }, summary: "s" });
    expect(createProperty).not.toHaveBeenCalled();
    const first = await confirmProposal(services, identity(), "r", proposal.proposalId, fixedClock);
    const second = await confirmProposal(services, identity(), "r", proposal.proposalId, fixedClock);
    expect(first.status).toBe("EXECUTED");
    expect(first.card).toMatchObject({ kind: "BUILDING_PICK", data: { action: { href: "/app/analyze?propertyId=p-new" } } });
    expect(second).toMatchObject({ status: "ALREADY_EXECUTED", card: { kind: "BUILDING_PICK" } });
    expect(createProperty).toHaveBeenCalledTimes(1);
  });

  it("another user cannot confirm, and the stored action revalidates parameters", async () => {
    const createProperty = vi.fn();
    const services = fakeServices({ core: { createProperty } });
    const proposal = await services.proposals.create(actorId, { action: "CREATE_PROPERTY", params: { label: "Home", address: "12 MG Road Pune" }, summary: "s" });
    await expect(confirmProposal(services, identity(otherId), "r", proposal.proposalId, fixedClock)).rejects.toMatchObject({ code: "PROPOSAL_NOT_FOUND" });
    const bad = await services.proposals.create(actorId, { action: "CREATE_PROPERTY", params: { label: "", address: "x" }, summary: "s" });
    await expect(confirmProposal(services, identity(), "r", bad.proposalId, fixedClock)).rejects.toMatchObject({ statusCode: 400 });
    expect(createProperty).not.toHaveBeenCalled();
  });

  it("confirms an application step through the tracker transition with its revision", async () => {
    const transition = vi.fn(async () => ({ steps: [{ title: "Register", status: "COMPLETED" }] }));
    const services = fakeServices({ applications: { transition } });
    const proposal = await services.proposals.create(actorId, { action: "UPDATE_APPLICATION_STEP", summary: "s",
      params: { propertyId, applicationId: "app-1", stepId: "REGISTER", expectedRevision: 3, status: "COMPLETED" } });
    expect((await confirmProposal(services, identity(), "r", proposal.proposalId, fixedClock)).status).toBe("EXECUTED");
    expect(transition).toHaveBeenCalledWith(expect.anything(), "app-1", "REGISTER", { propertyId, expectedRevision: 3, status: "COMPLETED" });
  });
});

function runtimeFor(table = new MemoryItemTable(), overrides: Record<string, unknown> = {}): ChatRuntime {
  const services = fakeServices({ core: { getProperty: async () => ({}) }, ...overrides }, table);
  return { services, store: new ChatStore(table, fixedClock, counterId("m")), limits: new ChatLimits(table, fixedClock), items: table, priceStore: new PriceBenchmarkStore(table, fixedClock) };
}

describe("chat turn service", () => {
  it("persists masked user text and the assistant reply, and warns about sensitive input", async () => {
    const runtime = runtimeFor();
    const events = await drain(handleChatTurn(runtime, new ScriptedBedrock([textTurn("Please never share that here.")]), { modelId: "m" },
      { identity: identity(), requestId: "r", body: { message: "my OTP is 482913 and aadhaar 2345 6789 0123" } }, fixedClock, counterId("x")));
    expect(events[0]).toMatchObject({ type: "meta" });
    expect(events.some(event => event.type === "card" && event.card.kind === "NOTICE")).toBe(true);
    expect(events.at(-1)?.type).toBe("done");
    const chatId = (events[0] as { chatId: string }).chatId;
    const { messages } = await runtime.store.listMessages(actorId, chatId);
    expect(messages.map(item => item.role)).toEqual(["user", "assistant"]);
    expect(JSON.stringify([...(runtime.items as MemoryItemTable).items.values()])).not.toMatch(/482913|2345 6789 0123/);
  });

  it("returns typed errors for invalid input, rate limits and budget", async () => {
    const runtime = runtimeFor();
    const run = (body: unknown) => drain(handleChatTurn(runtime, new ScriptedBedrock([textTurn("ok")]), { modelId: "m" }, { identity: identity(), requestId: "r", body }, fixedClock));
    expect((await run({ message: "" }))[0]).toMatchObject({ type: "error", code: "INVALID_REQUEST" });
    await runtime.limits.recordTokens(actorId, 10_000_000);
    expect((await run({ message: "hi" }))[0]).toMatchObject({ type: "error", code: "BUDGET_EXCEEDED" });
    const other = runtimeFor();
    for (let index = 0; index < 30; index++) await other.limits.startTurn(actorId);
    expect((await drain(handleChatTurn(other, new ScriptedBedrock([textTurn("ok")]), { modelId: "m" }, { identity: identity(), requestId: "r", body: { message: "hi" } }, fixedClock)))[0])
      .toMatchObject({ type: "error", code: "RATE_LIMITED" });
  });

  it("cannot continue another user's chat", async () => {
    const runtime = runtimeFor();
    const chat = await runtime.store.createChat(otherId, { title: "theirs" });
    const events = await drain(handleChatTurn(runtime, new ScriptedBedrock([textTurn("ok")]), { modelId: "m" },
      { identity: identity(), requestId: "r", body: { message: "hi", chatId: chat.chatId } }, fixedClock));
    expect(events.at(-1)).toMatchObject({ type: "error", code: "INVALID_REQUEST" });
    expect((await runtime.store.listMessages(otherId, chat.chatId)).messages).toEqual([]);
  });

  it("rejects an unowned propertyId before any model call", async () => {
    const client = new ScriptedBedrock([textTurn("ok")]);
    const runtime = runtimeFor(new MemoryItemTable(), { core: { getProperty: async () => { throw new RequestError(404, "NOT_FOUND", "x"); } } });
    const events = await drain(handleChatTurn(runtime, client, { modelId: "m" }, { identity: identity(), requestId: "r", body: { message: "hi", propertyId } }, fixedClock));
    expect(events.at(-1)).toMatchObject({ type: "error" });
    expect(client.requests).toHaveLength(0);
  });
});

describe("function url stream", () => {
  const request = (overrides: Partial<LambdaFunctionURLEvent> = {}, body: unknown = { message: "hello" }): LambdaFunctionURLEvent => ({
    headers: { "content-type": "application/json", authorization: "Bearer a.b.c", origin: "https://app.example.com" }, isBase64Encoded: false, body: JSON.stringify(body),
    requestContext: { http: { method: "POST" } } as never, ...overrides } as never);
  const sink = () => { const out = { status: 0, headers: {} as Record<string, string>, body: "", ended: false };
    const target: SseSink = { begin: (status, headers) => { out.status = status; out.headers = headers; }, write: chunk => { out.body += chunk; }, end: () => { out.ended = true; } };
    return { out, target }; };
  const signedIn = async () => ({ sub: actorId, groups: [], attributes: [{ Name: "sub", Value: actorId }, { Name: "email", Value: "u@example.com" }, { Name: "email_verified", Value: "true" }] }) as never;
  const context = { awsRequestId: "req" } as Context;
  const withEnv = () => { Object.assign(process.env, { API_ALLOWED_ORIGIN: "https://app.example.com", BEDROCK_MODEL_ID: "model-x" }); };

  it("rejects missing auth, wrong method and foreign origins with JSON, and streams SSE when signed in", async () => {
    withEnv();
    const unauth = sink();
    await serveChatStream(request(), unauth.target, context, { runtime: runtimeFor(), client: new ScriptedBedrock([]) }, async () => { throw new RequestError(401, "UNAUTHORIZED", "Sign in"); });
    expect(unauth.out.status).toBe(401); expect(unauth.out.headers["content-type"]).toContain("application/json"); expect(unauth.out.ended).toBe(true);
    const method = sink();
    await serveChatStream(request({ requestContext: { http: { method: "GET" } } as never }), method.target, context, {}, signedIn);
    expect(method.out.status).toBe(405);
    const origin = sink();
    await serveChatStream(request({ headers: { "content-type": "application/json", authorization: "Bearer a.b.c", origin: "https://evil.example" } }), origin.target, context, {}, signedIn);
    expect(origin.out.status).toBe(403);
    const ok = sink();
    await serveChatStream(request(), ok.target, context, { runtime: runtimeFor(), client: new ScriptedBedrock([textTurn("Hi there")]) }, signedIn);
    expect(ok.out.status).toBe(200); expect(ok.out.headers["content-type"]).toContain("text/event-stream");
    const events = ok.out.body.split("\n\n").filter(line => line.startsWith("data: ")).map(line => JSON.parse(line.slice(6)) as ChatStreamEvent);
    expect(events.map(event => event.type)).toEqual(["meta", "text", "done"]);
    expect(ok.out.ended).toBe(true);
  });
});

describe("conversation REST handler", () => {
  const event = (method: string, path: string, body?: unknown): APIGatewayProxyEvent => ({ httpMethod: method, path, resource: path, body: body ? JSON.stringify(body) : null,
    headers: { "content-type": "application/json", authorization: "Bearer x.y.z" }, multiValueHeaders: {}, isBase64Encoded: false, pathParameters: null,
    queryStringParameters: null, multiValueQueryStringParameters: null, stageVariables: null, requestContext: {} as never });
  const as = (sub: string) => async () => ({ sub, groups: [], attributes: [{ Name: "sub", Value: sub }, { Name: "email", Value: "u@example.com" }, { Name: "email_verified", Value: "true" }] }) as never;

  it("lists, reads and deletes only the caller's chats and confirms proposals", async () => {
    process.env.CORE_TABLE_NAME = "core-table";
    const runtime = runtimeFor();
    const mine = await runtime.store.createChat(actorId, { title: "mine" });
    await runtime.store.appendMessage(actorId, mine.chatId, { role: "user", text: "hello" });
    const theirs = await runtime.store.createChat(otherId, { title: "theirs" });
    const handler = createChatsHandler({ runtime, resolveIdentity: as(actorId) });
    const call = (req: APIGatewayProxyEvent) => handler(req, { awsRequestId: "r" } as Context);
    expect(JSON.parse((await call(event("GET", "/v1/chats"))).body).chats.map((item: { chatId: string }) => item.chatId)).toEqual([mine.chatId]);
    expect(JSON.parse((await call(event("GET", `/v1/chats/${mine.chatId}`))).body).messages).toHaveLength(1);
    expect((await call(event("GET", `/v1/chats/${theirs.chatId}`))).statusCode).toBe(404);
    expect((await call(event("DELETE", `/v1/chats/${theirs.chatId}`))).statusCode).toBe(404);
    expect((await call(event("DELETE", `/v1/chats/${mine.chatId}`))).statusCode).toBe(200);
    expect(await runtime.store.getChat(otherId, theirs.chatId)).toBeDefined();
    const proposal = await runtime.services.proposals.create(otherId, { action: "CREATE_PROPERTY", params: {}, summary: "s" });
    expect((await call(event("POST", "/v1/chat/confirm", { proposalId: proposal.proposalId }))).statusCode).toBe(404);
    expect(JSON.parse((await call(event("DELETE", "/v1/chats"))).body)).toEqual({ deletedChats: 0 });
  });
});
