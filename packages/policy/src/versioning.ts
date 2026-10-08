import { policyVersionEventSchema, policyVersionSchema,
  type PolicyVersionEventV1, type PolicyVersionStatus, type PolicyVersionV1 } from "./schema";

const TRANSITIONS: Readonly<Record<PolicyVersionStatus, readonly PolicyVersionStatus[]>> = Object.freeze({
  DETECTED: ["EXTRACTED"],
  EXTRACTED: ["VALIDATED"],
  VALIDATED: ["PENDING_APPROVAL"],
  PENDING_APPROVAL: ["APPROVED", "REJECTED"],
  APPROVED: ["ACTIVE"],
  ACTIVE: ["SUPERSEDED"],
  REJECTED: [],
  SUPERSEDED: [],
});

/** Validate append-only version creation. Records with the same material hash are not new versions. */
export function validateNewPolicyVersion(nextInput: unknown, previousInput?: unknown): PolicyVersionV1 {
  const next = policyVersionSchema.parse(nextInput);
  if (previousInput === undefined) {
    if (next.version !== 1 || next.previousVersion !== undefined || next.status !== "DETECTED" ||
      next.verificationStatus !== "UNVERIFIED") {
      throw new RangeError("First policy version must begin DETECTED at version 1.");
    }
    return next;
  }
  const previous = policyVersionSchema.parse(previousInput);
  if (next.policyId !== previous.policyId || next.version !== previous.version + 1 ||
    next.previousVersion !== previous.version || next.category !== previous.category ||
    next.jurisdiction !== previous.jurisdiction || next.contentHash === previous.contentHash ||
    Date.parse(next.createdAt) <= Date.parse(previous.createdAt)) {
    throw new RangeError("New policy version must be consecutive, later, and materially different.");
  }
  if (next.status !== "DETECTED" || next.verificationStatus !== "UNVERIFIED") {
    throw new RangeError("New policy version must begin DETECTED and unverified.");
  }
  return next;
}

export function isPolicyVersionTransitionAllowed(from: PolicyVersionStatus, to: PolicyVersionStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Derive a new status snapshot from a separately persisted audit event; never mutate fact/version content. */
export function applyPolicyVersionEvent(versionInput: unknown, eventInput: unknown):
  { version: PolicyVersionV1; event: PolicyVersionEventV1 } {
  const version = policyVersionSchema.parse(versionInput);
  const event = policyVersionEventSchema.parse(eventInput);
  if (event.policyId !== version.policyId || event.policyVersion !== version.version ||
    event.fromStatus !== version.status || !isPolicyVersionTransitionAllowed(version.status, event.toStatus) ||
    Date.parse(event.occurredAt) < Date.parse(version.createdAt) ||
    (version.approvedAt && Date.parse(event.occurredAt) < Date.parse(version.approvedAt))) {
    throw new RangeError("Invalid policy version transition.");
  }
  if (event.toStatus === "APPROVED" && version.verificationStatus !== "VERIFIED") {
    throw new RangeError("Only a verified policy version may be approved.");
  }
  const next = policyVersionSchema.parse({
    ...version,
    status: event.toStatus,
    ...(event.toStatus === "APPROVED" ? { approvedAt: event.occurredAt, approvedBy: event.actorId } : {}),
    ...(event.toStatus === "ACTIVE" ? { activatedAt: event.occurredAt } : {}),
  });
  return { version: next, event };
}
