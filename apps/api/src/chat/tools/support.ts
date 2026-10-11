import { SYSTEM_DESIGN_BASELINE_V1 } from "@solarsaathi/calculations";
import type { ChatCard, ChatCardData, ChatCardKind, ChatProvenance, ChatQuickReply } from "@solarsaathi/types";
import { z } from "zod";
import { identifier } from "../../data/schemas";
import { RequestError } from "../../lib/http";
import type { ToolContext, ToolOutput } from "./types";

export const DEFAULT_GENERATION_KWH_PER_KW_YEAR = SYSTEM_DESIGN_BASELINE_V1.generationKwhPerKwYear;

const money = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });
export const inr = (rupees: number) => `₹${money.format(rupees)}`;
export const inrFromPaise = (paise: number) => inr(paise / 100);
const decimals = (value: number, places: number) => new Intl.NumberFormat("en-IN", { maximumFractionDigits: places }).format(value);
export const kw = (value: number) => `${decimals(value, 2)} kW`;
export const kwh = (value: number) => `${decimals(Math.round(value), 0)} kWh`;
export const pct = (fraction: number) => `${decimals(Math.round(fraction * 1000) / 10, 1)}%`;
export const years = (value: number | null) => value === null ? "Not within 25 years" : `${decimals(value, 1)} years`;
export const sqm = (value: number) => `${decimals(value, 1)} m²`;

/** Strips control characters and angle brackets so stored labels cannot forge delimiters, then truncates. */
export function cleanLabel(value: string, max = 80): string {
  return Array.from(value).filter(char => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127 && char !== "<" && char !== ">")
    .join("").replace(/\s+/g, " ").trim().slice(0, max);
}
/** Wraps user-, vendor- or web-derived text so the model treats it as data, never as instructions. */
export const untrusted = (kind: string, value: string, max = 80) =>
  `<untrusted_data kind="${kind}">${cleanLabel(value, max)}</untrusted_data>`;

export function card(context: ToolContext, kind: ChatCardKind, title: string, data: ChatCardData,
  extras: { provenance?: ChatProvenance; href?: string } = {}): ChatCard {
  return { cardId: `card-${context.createId().replace(/[^A-Za-z0-9]/g, "").slice(0, 16)}`, kind, title, data,
    ...(extras.provenance ? { provenance: extras.provenance } : {}),
    ...(extras.href ? { href: extras.href } : {}) };
}

export function question(context: ToolContext, factKey: string, text: string, replies: ChatQuickReply[],
  options: { freeText?: boolean } = {}): ToolOutput {
  const questionCard = card(context, "QUESTION", "One quick question", { question: { text, options: replies },
    ...(options.freeText ? { summary: "Type your answer in the message box." } : {}) },
    { provenance: { source: "SOLARSAATHI_FACT_COLLECTION", verificationStatus: "INDICATIVE" } });
  return { modelSummary: `NEEDS_USER_INPUT fact=${factKey}. A question card was shown to the user. Ask for this one fact in plain words and stop; do not guess an answer.`,
    cards: [questionCard], quickReplies: replies };
}

export const demandFields = {
  monthlyConsumptionKwh: z.number().finite().min(1).max(100_000).optional(),
  monthlyBillRupees: z.number().finite().min(1).max(1_000_000).optional(),
  tariffRupeesPerKwh: z.number().finite().min(0.1).max(100).optional(),
  sanctionedLoadKw: z.number().finite().min(0.25).max(1_000).optional(),
};
export interface DemandInput {
  monthlyConsumptionKwh?: number; monthlyBillRupees?: number; tariffRupeesPerKwh?: number; sanctionedLoadKw?: number;
}
export const propertyFields = { propertyId: identifier, analysisId: identifier.optional() };

/** A user-supplied figure passed as a tool argument must appear in the user's own messages. */
export function claimedByUser(context: ToolContext, value: number | undefined): boolean {
  if (value === undefined) return true;
  for (const figure of context.userFigures) if (Math.abs(figure - value) <= Math.max(0.5, Math.abs(value) * 0.005)) return true;
  return false;
}

export function unconfirmedFigure(context: ToolContext, label: string, value: number): ToolOutput {
  return question(context, `confirm_${label}`, `Please confirm ${label.replace(/_/g, " ")}`,
    [{ label: `Yes, ${money.format(value)}`, value: money.format(value) }, { label: "Let me type it", value: "" }], { freeText: true });
}

/** Returns a QUESTION output when the demand cannot be built from figures the user actually provided. */
export function demandOrQuestion(context: ToolContext, input: DemandInput):
{ demand: { kind: "CONSUMPTION"; monthlyConsumptionKwh: number; sanctionedLoadKw?: number } |
  { kind: "BILL"; monthlyBillRupees: number; tariffRupeesPerKwh: number; sanctionedLoadKw?: number } } | { question: ToolOutput } {
  const sanctioned = input.sanctionedLoadKw === undefined ? {} : { sanctionedLoadKw: input.sanctionedLoadKw };
  if (input.monthlyConsumptionKwh !== undefined) {
    if (!claimedByUser(context, input.monthlyConsumptionKwh)) return { question: unconfirmedFigure(context, "monthly_units_kwh", input.monthlyConsumptionKwh) };
    return { demand: { kind: "CONSUMPTION", monthlyConsumptionKwh: input.monthlyConsumptionKwh, ...sanctioned } };
  }
  if (input.monthlyBillRupees === undefined) {
    return { question: question(context, "monthly_bill_or_units", "What is your average monthly electricity bill (in rupees) or monthly units (kWh)?", [], { freeText: true }) };
  }
  if (!claimedByUser(context, input.monthlyBillRupees)) return { question: unconfirmedFigure(context, "monthly_bill_rupees", input.monthlyBillRupees) };
  if (input.tariffRupeesPerKwh === undefined) {
    return { question: question(context, "tariff_rupees_per_kwh", "What do you pay per unit (rupees per kWh)? It is printed on your bill.", [], { freeText: true }) };
  }
  if (!claimedByUser(context, input.tariffRupeesPerKwh)) return { question: unconfirmedFigure(context, "tariff_rupees_per_kwh", input.tariffRupeesPerKwh) };
  return { demand: { kind: "BILL", monthlyBillRupees: input.monthlyBillRupees, tariffRupeesPerKwh: input.tariffRupeesPerKwh, ...sanctioned } };
}

/** Picks the stored analysis to use: the supplied id, else the most recently measured current one. */
export async function resolveAnalysis(context: ToolContext, propertyId: string, analysisId?: string):
Promise<{ analysisId: string; source: string; roofAreaSquareMeters: number; measuredAt: string } | undefined> {
  const page = await context.services.core.listAnalyses(context.identity, propertyId, { limit: 20 });
  const analyses = analysisId ? page.analyses.filter(item => item.analysisId === analysisId) : page.analyses;
  return [...analyses].sort((a, b) => b.measuredAt.localeCompare(a.measuredAt))[0];
}

export function noRoofOutput(context: ToolContext, propertyId: string): ToolOutput {
  return { modelSummary: `NO_CONFIRMED_ROOF for property ${propertyId}. The user must confirm a building and roof first (use the roof confirmation flow); do not estimate.`,
    cards: [card(context, "NOTICE", "Confirm your roof first", { summary: "I need a confirmed building and roof before I can size a system.",
      action: { label: "Find and confirm your roof", href: `/app/analyze?propertyId=${encodeURIComponent(propertyId)}` } },
    { provenance: { source: "SOLARSAATHI_ROOF_STATE" } })] };
}

/** Maps a service error to a tool result the model can relay without leaking internals. */
export function toolFailure(error: unknown): { code: string; message: string } {
  if (error instanceof RequestError) return { code: error.code, message: error.message };
  return { code: "TOOL_FAILED", message: "The tool could not complete this request." };
}

export const applicantFactFields = {
  state: z.string().regex(/^[A-Z0-9]{1,8}$/).optional(),
  district: z.string().regex(/^[A-Z0-9_]{1,64}$/).optional(),
  discom: z.string().regex(/^[A-Z0-9_]{1,64}$/).optional(),
  customerType: z.enum(["RESIDENTIAL", "COMMERCIAL", "INDUSTRIAL", "AGRICULTURAL", "OTHER"]).optional(),
  propertyType: z.enum(["INDIVIDUAL_HOME", "APARTMENT", "HOUSING_SOCIETY", "BUSINESS", "OTHER"]).optional(),
  ownership: z.enum(["OWNER", "TENANT", "SOCIETY", "OTHER"]).optional(),
  gridConnected: z.boolean().optional(),
  priorSubsidyReceived: z.boolean().optional(),
};
export type ApplicantFactInput = { [K in keyof typeof applicantFactFields]?: z.infer<typeof applicantFactFields[K]> };

const FACT_QUESTIONS: Array<{ key: keyof ApplicantFactInput; text: string; replies: ChatQuickReply[] }> = [
  { key: "state", text: "Which state is the property in?", replies: [] },
  { key: "customerType", text: "Is this a home or a business connection?", replies: [
    { label: "Home (residential)", value: "RESIDENTIAL" }, { label: "Shop or office", value: "COMMERCIAL" },
    { label: "Factory", value: "INDUSTRIAL" }, { label: "Farm", value: "AGRICULTURAL" }] },
  { key: "ownership", text: "Do you own the property?", replies: [
    { label: "I own it", value: "OWNER" }, { label: "I rent it", value: "TENANT" }, { label: "Housing society", value: "SOCIETY" }] },
  { key: "gridConnected", text: "Is the property connected to the electricity grid?", replies: [
    { label: "Yes", value: "true" }, { label: "No", value: "false" }] },
  { key: "priorSubsidyReceived", text: "Have you already received a government solar subsidy for this property?", replies: [
    { label: "No", value: "false" }, { label: "Yes", value: "true" }] },
];
/** First applicant fact still missing, as a QUESTION output (one question at a time). */
export function missingFactQuestion(context: ToolContext, facts: ApplicantFactInput): ToolOutput | undefined {
  const missing = FACT_QUESTIONS.find(item => facts[item.key] === undefined);
  return missing ? question(context, missing.key, missing.text, missing.replies, { freeText: missing.replies.length === 0 }) : undefined;
}
