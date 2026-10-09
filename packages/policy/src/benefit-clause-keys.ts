import { createHash } from "node:crypto";
import { benefitCompatibilityEdgeSchema, benefitConditionSchema, policyProcessStepSchema,
  type PolicyBenefitRuleV1 } from "./benefit-rules";

export type BenefitClauseKindV1 = "ELIGIBILITY" | "COMPATIBILITY" | "SIZE" | "OVERLAP" | "PROCESS_STEP";

/** A stable key binds a verified TEXT fact to one concrete rule clause, not just to the policy version. */
export function benefitClauseClaimKeyV1(kind: BenefitClauseKindV1, clause: unknown): string {
  let payload: object;
  if (kind === "ELIGIBILITY") {
    const { evidenceFactIds: _factIds, ...predicate } = benefitConditionSchema.parse(clause);
    void _factIds;
    payload = predicate;
  } else if (kind === "COMPATIBILITY") {
    const edge = benefitCompatibilityEdgeSchema.parse(clause);
    payload = { withBenefitId: edge.withBenefitId, mode: edge.mode };
  } else if (kind === "SIZE") {
    const rule = clause as Pick<PolicyBenefitRuleV1, "minSystemWatts" | "maxSystemWatts">;
    if (!rule || rule.minSystemWatts === undefined && rule.maxSystemWatts === undefined) {
      throw new RangeError("A size clause needs a lower or upper system limit.");
    }
    payload = { minSystemWatts: rule.minSystemWatts ?? null, maxSystemWatts: rule.maxSystemWatts ?? null };
  } else if (kind === "OVERLAP") {
    const rule = clause as Pick<PolicyBenefitRuleV1, "overlapGroupId">;
    if (!rule?.overlapGroupId) throw new RangeError("An overlap clause needs a group ID.");
    payload = { overlapGroupId: rule.overlapGroupId };
  } else if (kind === "PROCESS_STEP") {
    const { evidenceFactIds: _factIds, ...step } = policyProcessStepSchema.parse(clause);
    void _factIds;
    payload = step;
  } else {
    throw new RangeError("Unsupported policy clause kind.");
  }
  const hash = createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 32);
  return `clause.${kind.toLowerCase()}.${hash}`;
}
