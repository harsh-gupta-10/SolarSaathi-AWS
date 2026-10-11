import type { ChatCard, ChatConfirmResponse, CurrentIdentityResponse } from "@solarsaathi/types";
import { RequestError } from "../lib/http";
import { parseInput } from "../data/schemas";
import { runIdempotent } from "./idempotency";
import { confirmRoofParams, createApplicationParams, createPropertyParams, updateStepParams } from "./proposal-schemas";
import type { ProposalAction } from "./proposals";
import type { ChatServices } from "./services";
import { normalizeManual } from "../roof/normalize";

const card = (kind: ChatCard["kind"], title: string, data: ChatCard["data"], proposalId: string): ChatCard =>
  ({ cardId: `done-${proposalId.slice(0, 16)}`, kind, title, data, provenance: { source: "SOLARSAATHI_RECORDS", verificationStatus: "VERIFIED" } });

/** Executes one stored proposal through the same services as the REST API. Only reachable from POST /v1/chat/confirm. */
export async function executeProposal(services: ChatServices, identity: CurrentIdentityResponse, requestId: string,
  action: ProposalAction, rawParams: unknown, proposalId: string, now: () => Date = () => new Date()): Promise<{ card?: ChatCard }> {
  const userId = identity.profile.userId;
  const key = `proposal-${proposalId}`;
  switch (action) {
  case "CREATE_PROPERTY": {
    const params = parseInput(createPropertyParams, rawParams);
    const { value } = await runIdempotent(services.items, userId, "CREATE_PROPERTY", key, () => services.core.createProperty(identity, params), now);
    const href = `/app/analyze?propertyId=${encodeURIComponent(value.propertyId)}`;
    return { card: card("BUILDING_PICK", "Property saved", { summary: "Now find your building on the map and confirm the roof.",
      rows: [{ label: "Property", value: value.label }], action: { label: "Find and confirm your roof", href } }, proposalId) };
  }
  case "CONFIRM_ROOF": {
    const params = parseInput(confirmRoofParams, rawParams);
    if ("previewId" in params) {
      await services.core.confirmBuilding(identity, params.propertyId, params.previewId);
      const analysis = await services.core.saveConfirmedRoof(identity, params.propertyId, params.previewId);
      return { card: card("ROOF_SUMMARY", "Roof confirmed", { rows: [{ label: "Roof area", value: `${analysis.roof.roofAreaSquareMeters.toFixed(1)} m²` },
        { label: "Source", value: "Google Solar model" }], disclaimer: "Not a structural approval.",
        action: { label: "Open roof analysis", href: `/app/analyze?propertyId=${encodeURIComponent(params.propertyId)}` } }, proposalId) };
    }
    const roof = normalizeManual(params.manual, now().toISOString());
    const analysis = await services.core.saveManualRoof(identity, params.propertyId, roof);
    return { card: card("ROOF_SUMMARY", "Roof saved", { rows: [{ label: "Roof area", value: `${analysis.roof.roofAreaSquareMeters.toFixed(1)} m²` },
      { label: "Source", value: "Your measurements" }], disclaimer: "Not a structural approval. A site survey is required.",
      action: { label: "Open roof analysis", href: `/app/analyze?propertyId=${encodeURIComponent(params.propertyId)}` } }, proposalId) };
  }
  case "CREATE_APPLICATION": {
    const params = parseInput(createApplicationParams, rawParams);
    const { value } = await runIdempotent(services.items, userId, "CREATE_APPLICATION", key, () => services.applications.create(identity, params), now);
    return { card: card("CHECKLIST", "Application tracker created", { summary: "Your progress is tracked as user-reported.",
      items: value.steps.map(step => ({ label: step.title, detail: step.description, done: step.status === "COMPLETED" })),
      action: { label: "Open application tracker", href: `/app/applications?propertyId=${encodeURIComponent(value.propertyId)}&applicationId=${encodeURIComponent(value.applicationId)}` } }, proposalId) };
  }
  case "UPDATE_APPLICATION_STEP": {
    const params = parseInput(updateStepParams, rawParams);
    const next = await services.applications.transition(identity, params.applicationId, params.stepId,
      { propertyId: params.propertyId, expectedRevision: params.expectedRevision, status: params.status, ...(params.note ? { note: params.note } : {}) });
    return { card: card("CHECKLIST", "Step updated", { items: next.steps.map(step => ({ label: step.title, done: step.status === "COMPLETED" })),
      disclaimer: "User-reported progress, not confirmation from the government or utility." }, proposalId) };
  }
  default:
    throw new RequestError(400, "UNSUPPORTED_ACTION", "That action cannot be confirmed here.");
  }
}

export async function confirmProposal(services: ChatServices, identity: CurrentIdentityResponse, requestId: string,
  proposalId: string, now?: () => Date): Promise<ChatConfirmResponse> {
  return services.proposals.confirm(identity.profile.userId, proposalId, (action, params, id) =>
    executeProposal(services, identity, requestId, action, params, id, now));
}
