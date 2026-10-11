/**
 * Plain-language explanations for the backend's policy reason codes. Text only: nothing here creates, infers or
 * hides an amount. Unknown codes fall back to a neutral message and are still listed by code.
 */
const REASONS: Record<string, { title: string; text: string; action?: string }> = {
  NO_ACTIVE_VERIFIED_RULES: {
    title: "No verified subsidy rule is published for your area yet",
    text: "We only show a subsidy once its rule has been checked against the official source and approved by two reviewers. None is published yet for this location, so your estimate above excludes subsidies.",
  },
  NO_CURRENT_VERIFIED_RULES: {
    title: "The official sources could not be re-checked recently",
    text: "A published rule exists, but its official source has not been confirmed as unchanged recently, so we will not show an amount from it.",
    action: "Try again later.",
  },
  SOURCE_CHECK_DEGRADED: {
    title: "Official source checks are delayed",
    text: "We could not confirm the official source is current, so no amount is shown.",
    action: "Try again later.",
  },
  BENEFIT_EVALUATION_UNAVAILABLE: {
    title: "The benefit check is temporarily unavailable",
    text: "This is a service problem, not a finding about your eligibility.",
    action: "Try again in a few minutes.",
  },
  RULE_CATALOG_LIMIT: {
    title: "Too many rules apply to evaluate at once",
    text: "This needs a review on our side. No amount is inferred.",
  },
  NO_CONFIRMED_ELIGIBLE_BENEFITS: {
    title: "No benefit could be confirmed from your answers",
    text: "Some questions may be unanswered, or the rules found do not apply to this system. See each rule's reasons below.",
    action: "Answer any questions you skipped, including those under “More eligibility details”, and check again.",
  },
  NO_UPFRONT_MODELABLE_BENEFITS: {
    title: "The benefits found do not reduce the upfront cost",
    text: "The selected benefits are of a kind, or are paid in a way, that cannot be shown as a reduction of your installation cost.",
  },
};

export interface ReasonExplanation { code: string; title: string; text: string; action?: string }

export function explainPolicyReasons(codes: readonly string[] | undefined): ReasonExplanation[] {
  const seen = new Set<string>();
  const result: ReasonExplanation[] = [];
  for (const code of codes ?? []) {
    if (seen.has(code)) continue;
    seen.add(code);
    const known = REASONS[code];
    if (known) result.push({ code, ...known });
  }
  return result;
}

/** Per-rule reason codes that mean "an answer is missing", mapped to the question that resolves them. */
export const MISSING_ANSWER_HINTS: Record<string, string> = {
  APPLICANT_FACTS_UNKNOWN: "One or more eligibility questions are unanswered.",
  JURISDICTION_UNKNOWN: "Choose your state or union territory.",
  ELIGIBLE_COST_UNKNOWN: "Enter the policy-eligible cost under “More eligibility details”.",
};
