import { z } from "zod";
import { identifier } from "../../data/schemas";
import { buildReadinessPack } from "../checklist";
import { confirmRoofParams, createApplicationParams, createPropertyParams, updateStepParams } from "../proposal-schemas";
import { card, cleanLabel, DEFAULT_GENERATION_KWH_PER_KW_YEAR, kw, sqm } from "./support";
import { benefitInput, prepareBenefits } from "./policy-tools";
import { defineTool, type ToolContext, type ToolOutput } from "./types";

const PROPOSAL_NOTE = "A confirmation card was shown. Nothing is saved or changed until the user presses Confirm; say exactly that.";

async function propose(context: ToolContext, action: Parameters<ToolContext["services"]["proposals"]["create"]>[1]["action"],
  params: unknown, summary: string) {
  return context.services.proposals.create(context.identity.profile.userId, { action, params, summary, chatId: context.chatId });
}

export const startProperty = defineTool({
  name: "start_property",
  description: "Propose saving a new property from an address the user gave. Creates a confirmation proposal only; nothing is saved until the user confirms.",
  proposalOnly: true,
  schema: z.object({ label: z.string().trim().min(1).max(120), address: z.string().trim().min(8).max(300), customerId: identifier.optional() }).strict(),
  async run(input, context): Promise<ToolOutput> {
    const params = createPropertyParams.parse(input);
    const proposal = await propose(context, "CREATE_PROPERTY", params, `Save "${cleanLabel(params.label, 60)}" at ${cleanLabel(params.address, 150)} as a new property.`);
    return { modelSummary: `PROPOSAL_CREATED CREATE_PROPERTY. ${PROPOSAL_NOTE}`, cards: [], proposal };
  },
});

export const confirmRoof = defineTool({
  name: "confirm_roof",
  description: "Propose confirming a roof for a property: either a previewId from the roof picker, or the user's own measurements. Creates a confirmation proposal only.",
  proposalOnly: true,
  schema: z.object({
    propertyId: identifier, previewId: identifier.optional(), manualRoofAreaSquareMeters: z.number().finite().positive().max(100_000).optional(),
    manualPitchDegrees: z.number().finite().min(0).max(75).optional(), manualAzimuthDegrees: z.number().finite().min(0).max(360).optional(),
  }).strict().refine(value => (value.previewId === undefined) !== (value.manualRoofAreaSquareMeters === undefined)),
  async run(input, context): Promise<ToolOutput> {
    await context.services.core.getProperty(context.identity, input.propertyId);
    if (input.previewId) {
      const preview = await context.services.core.getRoofPreview(context.identity, input.propertyId, input.previewId);
      const params = confirmRoofParams.parse({ propertyId: input.propertyId, previewId: input.previewId });
      const proposal = await propose(context, "CONFIRM_ROOF", params, `Confirm the building and roof (${sqm(preview.roof.roofAreaSquareMeters)}, Google Solar model).`);
      return { modelSummary: `PROPOSAL_CREATED CONFIRM_ROOF for roof area ${preview.roof.roofAreaSquareMeters.toFixed(1)} m2. ${PROPOSAL_NOTE}`,
        cards: [card(context, "ROOF_SUMMARY", "Roof to confirm", { rows: [{ label: "Roof area", value: sqm(preview.roof.roofAreaSquareMeters) },
          { label: "Roof segments", value: String(preview.roof.segmentCount) }], disclaimer: "Modelled by Google Solar. Not a structural approval." },
        { provenance: { source: "GOOGLE_SOLAR", verificationStatus: "INDICATIVE", lastCheckedAt: preview.roof.measuredAt } })], proposal };
    }
    const params = confirmRoofParams.parse({ propertyId: input.propertyId, manual: { roofAreaSquareMeters: input.manualRoofAreaSquareMeters,
      ...(input.manualPitchDegrees === undefined ? {} : { pitchDegrees: input.manualPitchDegrees }),
      ...(input.manualAzimuthDegrees === undefined ? {} : { azimuthDegrees: input.manualAzimuthDegrees }) } });
    const proposal = await propose(context, "CONFIRM_ROOF", params, `Save your roof measurement of ${sqm(input.manualRoofAreaSquareMeters!)}.`);
    return { modelSummary: `PROPOSAL_CREATED CONFIRM_ROOF manual ${input.manualRoofAreaSquareMeters} m2. ${PROPOSAL_NOTE}`, cards: [], proposal };
  },
});

export const prepareApplication = defineTool({
  name: "prepare_application",
  description: "Build the PM Surya Ghar readiness pack (steps and documents to have ready) from the user's roof, system and benefit result, and propose creating a tracker. Never ask for Aadhaar, bank details, consumer number, passwords or OTPs.",
  proposalOnly: true,
  schema: benefitInput,
  async run(input, context): Promise<ToolOutput> {
    const result = await prepareBenefits(input, context);
    if ("output" in result) return result.output;
    const { evaluation, analysisId, demand } = result.prepared;
    let processSteps;
    let policyId: string | undefined;
    let policyVersion: number | undefined;
    let jurisdiction: string | undefined;
    let links: Array<{ label: string; url: string }> = [];
    let verifiedAt: string | undefined;
    if (evaluation.status === "AVAILABLE") {
      const decision = evaluation.result.decisions.find(item => item.status === "SELECTED" && (item.countedAmountPaise ?? 0) > 0 &&
        item.sourceChecks.every(check => check.fresh && check.status === "HEALTHY"));
      const active = decision ? await context.services.publication.getActive(decision.policyId) : undefined;
      if (decision && active?.rule.processSteps?.length && active.version.version === decision.policyVersion) {
        processSteps = active.rule.processSteps; policyId = decision.policyId; policyVersion = decision.policyVersion;
        jurisdiction = decision.jurisdiction; verifiedAt = decision.lastVerifiedAt;
        links = decision.citations.slice(0, 4).map(citation => ({ label: citation.publisherName, url: citation.sourceUrl }));
      }
    }
    const pack = buildReadinessPack({ ...(processSteps ? { processSteps } : {}), ownership: input.ownership, state: input.state,
      systemKw: input.nominalKw, roofConfirmed: true });
    const checklist = card(context, "CHECKLIST", "Your application readiness pack", {
      summary: pack.label,
      items: [...pack.steps.map(step => ({ label: `${step.order}. ${step.title}`, detail: step.description })),
        ...pack.documents.filter(item => item.needed).map(item => ({ label: `Have ready: ${item.label}`, detail: item.note }))],
      bullets: [`Do not share in chat: ${pack.doNotShare.join(", ")}.`, "SolarSaathi never logs in to or submits on government portals for you."],
      disclaimer: processSteps ? "Steps come from a verified policy record. Confirm current requirements on the official portal." : pack.label,
      action: { label: pack.portal.label, href: pack.portal.url } },
    { provenance: processSteps ? { source: `POLICY:${policyId}@v${policyVersion}`, verificationStatus: "VERIFIED", jurisdiction, policyVersion,
      lastCheckedAt: verifiedAt, links } : { source: "GENERAL_GUIDANCE", verificationStatus: "UNVERIFIED" } });
    if (!processSteps || !policyId) {
      return { modelSummary: "READINESS_PACK shown as GENERAL guidance, not an official policy record. A tracker cannot be created because no verified policy process is available for these facts. Tell the user this, and remind them to keep documents ready without pasting numbers.",
        cards: [checklist] };
    }
    const params = createApplicationParams.parse({ propertyId: input.propertyId, analysisId, policyId, demand,
      generationKwhPerKwYear: DEFAULT_GENERATION_KWH_PER_KW_YEAR, nominalKw: input.nominalKw,
      ...(result.eligibleQuotedCostPaise === undefined ? {} : { eligibleQuotedCostPaise: result.eligibleQuotedCostPaise }),
      applicantFacts: { country: "IN", ...Object.fromEntries(Object.entries({ state: input.state, district: input.district, discom: input.discom,
        customerType: input.customerType, propertyType: input.propertyType, ownership: input.ownership, gridConnected: input.gridConnected,
        priorSubsidyReceived: input.priorSubsidyReceived, ...(input.sanctionedLoadKw ? { sanctionedLoadWatts: Math.round(input.sanctionedLoadKw * 1_000) } : {}) })
          .filter(([, value]) => value !== undefined)) } });
    const proposal = await propose(context, "CREATE_APPLICATION", params,
      `Create an application tracker for your ${kw(input.nominalKw)} system with ${pack.steps.length} steps from the published policy. Progress is tracked as user-reported.`);
    return { modelSummary: `READINESS_PACK from policy ${policyId} v${policyVersion} with ${pack.steps.length} steps. PROPOSAL_CREATED CREATE_APPLICATION. ${PROPOSAL_NOTE} Remind the user not to paste Aadhaar, bank, consumer number, passwords or OTPs.`,
      cards: [checklist], proposal };
  },
});

export const updateApplicationStep = defineTool({
  name: "update_application_step",
  description: "Propose updating one step of the user's application tracker (the user's own report). Creates a confirmation proposal only.",
  proposalOnly: true,
  schema: z.object({ propertyId: identifier, applicationId: identifier, stepId: z.string().regex(/^[A-Z][A-Z0-9_]{1,63}$/),
    status: z.enum(["PENDING", "IN_PROGRESS", "COMPLETED", "BLOCKED", "NOT_APPLICABLE"]), note: z.string().trim().min(1).max(1_000).optional() }).strict(),
  async run(input, context): Promise<ToolOutput> {
    const application = await context.services.applications.get(context.identity, input.propertyId, input.applicationId);
    const step = application.steps.find(item => item.stepId === input.stepId);
    if (!step) return { modelSummary: "STEP_NOT_FOUND in this tracker.", cards: [] };
    if (step.status === input.status) return { modelSummary: `NO_CHANGE: the step is already ${step.status}.`, cards: [] };
    if (step.required && input.status === "NOT_APPLICABLE") return { modelSummary: "REQUIRED_STEP cannot be marked not applicable.", cards: [] };
    if (["COMPLETED", "NOT_APPLICABLE"].includes(step.status) && !input.note) return { modelSummary: "CORRECTION_NOTE_REQUIRED: ask the user why this completed step is changing.", cards: [] };
    const params = updateStepParams.parse({ ...input, expectedRevision: application.revision });
    const proposal = await propose(context, "UPDATE_APPLICATION_STEP", params,
      `Mark "${cleanLabel(step.title, 80)}" as ${input.status.replace(/_/g, " ").toLowerCase()} (your report, not an official confirmation).`);
    return { modelSummary: `PROPOSAL_CREATED UPDATE_APPLICATION_STEP. ${PROPOSAL_NOTE}`, cards: [], proposal };
  },
});
