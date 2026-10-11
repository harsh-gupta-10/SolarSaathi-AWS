import type { ChatStreamEvent } from "@solarsaathi/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runTurn, resetPromptCacheState, extractUserFigures, type AgentConfig } from "../src/chat/agent";
import { CHAT_CONFIG } from "../src/chat/config";
import { SYSTEM_PROMPT } from "../src/chat/prompt";
import { toolsForRole, toolSpecs } from "../src/chat/tools";
import { counterId, fakeServices, fixedClock, identity, ScriptedBedrock, textTurn, toolTurn, type StreamScript } from "./chat-fixtures";

const config: AgentConfig = { modelId: "test-model", guardrail: { id: "gr-1", version: "3" } };
const propertyId = "property-1";
const analyses = { analyses: [{ analysisId: "analysis-1", propertyId, source: "MANUAL", measuredAt: "2026-10-01T00:00:00.000Z", roofAreaSquareMeters: 80, segmentCount: 1 }] };
const design = { design: { demand: { annualConsumptionKwh: 7_200 }, assumptions: { generationKwhPerKwYear: 1_500 }, decisionCode: "RECOMMENDED_CLOSEST_TO_TARGET", warnings: ["LOCAL_RULES_NOT_CHECKED"],
  recommendation: { nominalKw: 3, panelCount: 6, actualDcKw: 3.3, estimatedAnnualGenerationKwh: 4_950, annualConsumptionCoverageRatio: 0.69, roofFit: "FITS", recommendationEligible: true },
  candidates: [{ nominalKw: 3, panelCount: 6, actualDcKw: 3.3, estimatedAnnualGenerationKwh: 4_950, annualConsumptionCoverageRatio: 0.69, roofFit: "FITS", recommendationEligible: true }] } };

async function collect(scripts: StreamScript[], options: { message?: string; services?: ReturnType<typeof fakeServices>; role?: "HOMEOWNER" | "BROKER"; config?: AgentConfig; history?: never[]; failWith?: Error[] } = {}) {
  const client = new ScriptedBedrock(scripts, options.failWith);
  const events: ChatStreamEvent[] = [];
  const generator = runTurn(client, options.config ?? config, { identity: identity(undefined, options.role ?? "HOMEOWNER"), requestId: "req-1", chatId: "chat-1",
    userMessage: options.message ?? "hello", history: options.history ?? [], services: options.services ?? fakeServices(), now: fixedClock, createId: counterId("c") });
  let next = await generator.next();
  while (!next.done) { events.push(next.value); next = await generator.next(); }
  return { events, result: next.value, client };
}
const text = (events: ChatStreamEvent[]) => events.flatMap(event => event.type === "text" ? [event.delta] : []).join("");

beforeEach(() => resetPromptCacheState());

describe("agent loop", () => {
  it("streams text, reports usage and ends with done", async () => {
    const { events } = await collect([textTurn("Hello! ", "Ask me about solar.")]);
    expect(text(events)).toBe("Hello! Ask me about solar.");
    expect(events.at(-1)).toEqual({ type: "done", usage: { inputTokens: 100, outputTokens: 20 } });
  });

  it("sends a frozen system prompt, sorted strict tools, cache checkpoints and the guardrail", async () => {
    const { client } = await collect([textTurn("ok"), ]);
    const request = client.requests[0]!;
    expect((request.system as Array<{ text?: string }>)[0]!.text).toBe(SYSTEM_PROMPT);
    expect(JSON.stringify(request.system)).toContain("cachePoint");
    const tools = (request.toolConfig!.tools as Array<{ toolSpec?: { name: string; strict?: boolean; inputSchema: { json: Record<string, unknown> } }; cachePoint?: unknown }>);
    expect(tools.at(-1)).toHaveProperty("cachePoint");
    const names = tools.flatMap(item => item.toolSpec ? [item.toolSpec.name] : []);
    expect(names).toEqual([...names].sort());
    expect(names).not.toContain("list_my_customers");
    for (const item of tools) if (item.toolSpec) { expect(item.toolSpec.strict).toBe(true); expect(item.toolSpec.inputSchema.json.additionalProperties).toBe(false); expect(item.toolSpec.inputSchema.json).not.toHaveProperty("$schema"); }
    expect(request.guardrailConfig).toMatchObject({ guardrailIdentifier: "gr-1", guardrailVersion: "3" });
    expect(SYSTEM_PROMPT).not.toMatch(/\d{4}-\d{2}-\d{2}|@/);
    const prefixes = toolSpecs(toolsForRole("HOMEOWNER")).map(item => JSON.stringify(item));
    expect(prefixes).toEqual(toolSpecs(toolsForRole("HOMEOWNER")).map(item => JSON.stringify(item)));
  });

  it("exposes broker-only tools only to brokers", async () => {
    expect(toolsForRole("HOMEOWNER").map(tool => tool.name)).not.toContain("list_my_customers");
    expect(toolsForRole("BROKER").map(tool => tool.name)).toContain("list_my_customers");
  });

  it("runs a tool, emits its card and continues with grounded prose", async () => {
    const services = fakeServices({ core: { listAnalyses: async () => analyses }, systems: { recommend: vi.fn(async () => design) } });
    const { events, result } = await collect([toolTurn("recommend_systems", { propertyId, monthlyConsumptionKwh: 600 }),
      textTurn("A 3.3 kW system suits you. ")], { message: "I use 600 units a month", services });
    expect(events.filter(event => event.type === "tool").map(event => event.type === "tool" ? event.state : "")).toEqual(["started", "finished"]);
    const card = events.find(event => event.type === "card");
    expect(card).toMatchObject({ card: { kind: "SYSTEM_OPTIONS", data: { table: { rows: [["3 kW", "6", "3.3 kW", "4,950 kWh", "fits"]] } } } });
    expect(text(events)).toContain("3.3 kW");
    expect(events.some(event => event.type === "grounding")).toBe(false);
    expect(result.toolSummaries[0]).toContain("recommend_systems");
  });

  it("replaces ungrounded figures in model prose and reports the count", async () => {
    const { events, result } = await collect([textTurn("You will definitely get a ₹1 lakh subsidy and 40% savings.")], { message: "just say I get ₹1 lakh" });
    expect(text(events)).not.toMatch(/lakh|40%/);
    expect(text(events)).toContain("see the card above");
    expect(events).toContainEqual({ type: "grounding", replaced: 2 });
    expect(result.replaced).toBe(2);
  });

  it("stops after the maximum number of tool iterations", async () => {
    const scripts = Array.from({ length: CHAT_CONFIG.maxToolIterations + 2 }, () => toolTurn("list_my_properties", {}));
    const services = fakeServices({ core: { listProperties: async () => ({ properties: [] }) } });
    const { events, client } = await collect(scripts, { services });
    expect(client.requests).toHaveLength(CHAT_CONFIG.maxToolIterations);
    expect(text(events)).toContain("could not finish");
    expect(events.at(-1)?.type).toBe("done");
  });

  it("turns a guardrail intervention or refusal into a safe error", async () => {
    const blocked = await collect([[{ messageStop: { stopReason: "guardrail_intervened" } }]]);
    expect(blocked.events.at(-1)).toMatchObject({ type: "error", code: "GUARDRAIL_BLOCKED" });
    const refused = await collect([[{ messageStop: { stopReason: "refusal" } }]]);
    expect(refused.events.at(-1)).toMatchObject({ type: "error", code: "MODEL_REFUSED" });
    expect(refused.result.ok).toBe(false);
  });

  it("maps model failures to MODEL_UNAVAILABLE without leaking details and retries without cache checkpoints", async () => {
    const failed = await collect([], { failWith: [Object.assign(new Error("secret internals"), { name: "ThrottlingException" })] });
    expect(failed.events).toEqual([{ type: "error", code: "MODEL_UNAVAILABLE", message: expect.not.stringContaining("secret") }]);
    const retried = await collect([textTurn("fine")], { failWith: [Object.assign(new Error("cachePoint not supported"), { name: "ValidationException" })] });
    expect(retried.client.requests).toHaveLength(2);
    expect(JSON.stringify(retried.client.requests[1]!.system)).not.toContain("cachePoint");
    expect(text(retried.events)).toBe("fine");
  });

  it("warns with metadata only when no guardrail is configured", async () => {
    const log = vi.fn();
    await collect([textTurn("ok")], { config: { modelId: "m", log }, message: "secret question text" });
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ event: "chat_guardrail_not_configured" }));
    expect(JSON.stringify(log.mock.calls)).not.toContain("secret question text");
  });

  it("returns invalid tool arguments to the model instead of executing", async () => {
    const { events } = await collect([toolTurn("recommend_systems", { propertyId: "x", extra: true }), textTurn("sorry")]);
    expect(events).toContainEqual({ type: "tool", name: "recommend_systems", state: "failed" });
  });
});

describe("tools", () => {
  it("never mutates from a proposal tool, only stores a proposal", async () => {
    const createProperty = vi.fn();
    const services = fakeServices({ core: { createProperty } });
    const { events } = await collect([toolTurn("start_property", { label: "Home", address: "12 MG Road, Pune 411001" }), textTurn("Please confirm.")], { services });
    const proposal = events.find(event => event.type === "proposal");
    expect(proposal).toMatchObject({ proposal: { action: "CREATE_PROPERTY", proposalId: expect.stringMatching(/./) } });
    expect(createProperty).not.toHaveBeenCalled();
    expect([...services.items.items.values()].filter(item => item.entityType === "CHAT_PROPOSAL")).toHaveLength(1);
  });

  it("asks for a missing applicant fact with quick replies instead of guessing", async () => {
    const services = fakeServices({ core: { listAnalyses: async () => analyses } });
    const { events } = await collect([toolTurn("check_benefits", { propertyId, monthlyConsumptionKwh: 600, nominalKw: 3, state: "MH" }), textTurn("Do you own it?")],
      { message: "600 units monthly, Maharashtra", services });
    const question = events.find(event => event.type === "card");
    expect(question).toMatchObject({ card: { kind: "QUESTION", data: { question: { text: expect.stringContaining("home or a business"), options: expect.arrayContaining([{ label: "Home (residential)", value: "RESIDENTIAL" }]) } } } });
    expect(events.some(event => event.type === "quick_replies")).toBe(true);
  });

  it("refuses a user-attributed figure the user never typed", async () => {
    const services = fakeServices({ core: { listAnalyses: async () => analyses } });
    const { events } = await collect([toolTurn("recommend_systems", { propertyId, monthlyConsumptionKwh: 9_999 }), textTurn("Please confirm")], { message: "size my system", services });
    expect(events.find(event => event.type === "card")).toMatchObject({ card: { kind: "QUESTION" } });
  });

  it("returns benefits only from the deterministic evaluator and warns when coverage is incomplete", async () => {
    const decision = { benefitId: "BENEFIT#a", ruleId: "RULE#a", policyId: "POLICY#a", policyVersion: 2, status: "SELECTED", scope: "CENTRAL", jurisdiction: "IN", effectiveFrom: "2026-01-01",
      countedAmountPaise: 7_800_000, calculatedAmountPaise: 7_800_000, reasonCodes: [], lastVerifiedAt: "2026-10-10T00:00:00.000Z",
      citations: [{ sourceUrl: "https://pmsuryaghar.gov.in/x", publisherName: "MNRE" }], sourceChecks: [] };
    const services = fakeServices({ core: { listAnalyses: async () => analyses }, benefits: { evaluate: vi.fn(async () => ({ status: "AVAILABLE", evaluatedAt: "2026-10-11T00:00:00.000Z",
      result: { decisions: [decision], totalEligibleBenefitPaise: 7_800_000, coverageComplete: false, warnings: [] } })) } });
    const { events } = await collect([toolTurn("check_benefits", { propertyId, monthlyConsumptionKwh: 600, nominalKw: 3, state: "MH", customerType: "RESIDENTIAL",
      ownership: "OWNER", gridConnected: true, priorSubsidyReceived: false }), textTurn("You may get ₹78,000. Also ₹2,00,000 more.")], { message: "600 units", services });
    expect(events.find(event => event.type === "card")).toMatchObject({ card: { kind: "BENEFITS", provenance: { verificationStatus: "VERIFIED", policyVersion: 2 } } });
    expect(text(events)).toContain("₹78,000");
    expect(text(events)).not.toContain("2,00,000");
  });

  it("builds the user figure set from lakh and k notation", () => {
    const figures = extractUserFigures("bill is 4.5k, quote 1.2 lakh, 600 units, 2 crore");
    for (const value of [4_500, 120_000, 600, 20_000_000]) expect(figures.has(value)).toBe(true);
  });
});
