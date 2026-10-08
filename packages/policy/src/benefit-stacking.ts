import { benefitCoverageSchema, benefitEvaluationContextSchema, benefitStackResultSchema,
  policyBenefitRuleSchema, policySourceHealthSchema,
  type BenefitConditionV1, type BenefitCoverageV1, type BenefitEvaluationContextV1,
  type BenefitStackResultV1, type PolicyBenefitRuleV1, type PolicySourceHealthV1 } from "./benefit-rules";
import { comparePolicyEvidence, isPolicyEvidencePublishable, type PolicyEvidenceV1 } from "./precedence";
import { policyDocumentSchema, policyFactSchema, policySourceSchema, policyVersionSchema,
  type PolicyCitationV1 } from "./schema";
import { validateOfficialSourceRecord } from "./sources";
import { policyCalendarDateV1 } from "./calendar";
import { benefitClauseClaimKeyV1 } from "./benefit-clause-keys";

export interface BenefitStackInputV1 {
  at: Date;
  context: BenefitEvaluationContextV1;
  rules: readonly PolicyBenefitRuleV1[];
  evidence: readonly PolicyEvidenceV1[];
  /** Trusted current crawl state; source registry versions remain immutable. */
  sourceHealth: readonly PolicySourceHealthV1[];
  /** Only independently established coverage may be asserted true. */
  coverage: BenefitCoverageV1;
}

type Tri = "YES" | "NO" | "UNKNOWN";
type SourceCheck = { sourceId: string; lastCheckedAt: string | null; fresh: boolean;
  status: "HEALTHY" | "DEGRADED" | "STALE" | "FAILED" | "UNKNOWN" };
type Screen = { status: Tri; reasons: string[]; amount?: bigint;
  citations: PolicyCitationV1[]; sourceChecks: SourceCheck[]; lastVerifiedAt: string };
const MAX_PAISE = 1_000_000_000_000n;

function roundDiv(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator / 2n) / denominator;
}

function condition(value: BenefitConditionV1, context: BenefitEvaluationContextV1): Tri {
  const match = <T>(actual: T | undefined, values: readonly T[]): Tri =>
    actual === undefined ? "UNKNOWN" : values.includes(actual) ? "YES" : "NO";
  const bool = (actual: boolean | undefined, required: boolean): Tri =>
    actual === undefined ? "UNKNOWN" : actual === required ? "YES" : "NO";
  const range = (actual: number | string | undefined, from?: number | string, through?: number | string): Tri =>
    actual === undefined ? "UNKNOWN" :
      (from !== undefined && actual < from) || (through !== undefined && actual > through) ? "NO" : "YES";
  switch (value.kind) {
    case "CUSTOMER_TYPE": return match(context.customerType, value.oneOf);
    case "PROPERTY_TYPE": return match(context.propertyType, value.oneOf);
    case "OWNERSHIP": return match(context.ownership, value.oneOf);
    case "GRID_CONNECTED": return bool(context.gridConnected, value.required);
    case "PRIOR_SUBSIDY": return bool(context.priorSubsidyReceived, value.received);
    case "VENDOR_APPROVED": return bool(context.vendorApproved, value.required);
    case "EQUIPMENT_APPROVED": return bool(context.equipmentApproved, value.required);
    case "DISCOM": return match(context.discom, value.oneOf);
    case "DISTRICT": return match(context.district, value.oneOf);
    case "LOCAL_BODY": return match(context.localBody, value.oneOf);
    case "SANCTIONED_LOAD_RANGE": return range(context.sanctionedLoadWatts, value.minWatts, value.maxWatts);
    case "INSTALLATION_DATE_RANGE": return range(context.installationDate, value.from, value.through);
    case "APPLICATION_DATE_RANGE": return range(context.applicationDate, value.from, value.through);
    case "SCHEME_PARTICIPATION": return context.participatingSchemeIds === undefined ? "UNKNOWN" :
      bool(context.participatingSchemeIds.includes(value.schemeId), value.required);
  }
}

function all(conditions: readonly BenefitConditionV1[], context: BenefitEvaluationContextV1): Tri {
  const values = conditions.map(value => condition(value, context));
  return values.includes("NO") ? "NO" : values.includes("UNKNOWN") ? "UNKNOWN" : "YES";
}

function jurisdiction(rule: PolicyBenefitRuleV1, context: BenefitEvaluationContextV1): Tri {
  const parts = rule.jurisdiction.split("-");
  if (parts[0] !== context.country) return "NO";
  if (parts[1] && !context.state) return "UNKNOWN";
  if (parts[1] && parts[1] !== context.state) return "NO";
  if (parts[2] && !context.district) return "UNKNOWN";
  if (parts[2] && parts[2] !== context.district) return "NO";
  if (parts[3] && !context.localBody) return "UNKNOWN";
  if (parts[3] && parts[3] !== context.localBody) return "NO";
  return "YES";
}

function calculate(rule: PolicyBenefitRuleV1, context: BenefitEvaluationContextV1): bigint | undefined {
  const watts = BigInt(context.systemWatts);
  let result: bigint;
  switch (rule.amount.kind) {
    case "FIXED": result = BigInt(rule.amount.amountPaise); break;
    case "PER_KW": result = roundDiv(watts * BigInt(rule.amount.ratePaisePerKw), 1_000n); break;
    case "PERCENT_ELIGIBLE_COST":
      if (context.eligibleQuotedCostPaise === undefined) return undefined;
      result = roundDiv(BigInt(context.eligibleQuotedCostPaise) * BigInt(rule.amount.basisPoints), 10_000n);
      break;
    case "TIERED_KW": {
      let numerator = 0n;
      let previous = 0n;
      for (const tier of rule.amount.tiers) {
        const ceiling = BigInt(tier.upToWatts);
        const used = watts < ceiling ? watts : ceiling;
        if (used > previous) numerator += (used - previous) * BigInt(tier.ratePaisePerKw);
        previous = ceiling;
        if (watts <= ceiling) break;
      }
      result = roundDiv(numerator, 1_000n);
      break;
    }
  }
  if (rule.capPaise !== undefined && result > BigInt(rule.capPaise)) result = BigInt(rule.capPaise);
  if (result > MAX_PAISE) throw new RangeError("Calculated policy benefit exceeds the bounded integer-paise model.");
  return result;
}

function numericFactMatches(value: PolicyEvidenceV1["fact"]["value"], unit: string, expected: number,
  scale: number): boolean {
  return !!value && value.kind === "NUMBER" && value.unit === unit &&
    Number.isSafeInteger(expected) && Math.abs(value.amount * scale - expected) < 1e-7;
}

function requireNumericRuleBacking(rule: PolicyBenefitRuleV1, items: PolicyEvidenceV1[]): void {
  const values = items.map(item => item.fact.value);
  const match = (unit: string, expected: number, scale: number) =>
    values.some(value => numericFactMatches(value, unit, expected, scale));
  const amount = rule.amount;
  const backed = amount.kind === "FIXED" ? match("INR", amount.amountPaise, 100) :
    amount.kind === "PER_KW" ? match("INR_PER_KW", amount.ratePaisePerKw, 100) :
      amount.kind === "PERCENT_ELIGIBLE_COST" ? match("PERCENT", amount.basisPoints, 100) :
        amount.tiers.every(tier => match("INR_PER_KW", tier.ratePaisePerKw, 100) &&
          match("KW", tier.upToWatts, 1_000));
  if (!backed || rule.capPaise !== undefined && !match("INR", rule.capPaise, 100) ||
    rule.combinedCapPaise !== undefined && !match("INR", rule.combinedCapPaise, 100)) {
    throw new RangeError("Benefit amount, tier or cap has no matching verified numeric fact.");
  }
}

function requireClauseBacking(rule: PolicyBenefitRuleV1, items: PolicyEvidenceV1[]): void {
  const facts = new Map(items.map(item => [item.fact.factId, item.fact]));
  const conditions = [...rule.eligibility.allOf, ...rule.eligibility.anyOf.flat(),
    ...rule.compatibility.flatMap(edge => edge.conditions ?? [])];
  const references: Array<{ factId: string; claimKey: string }> = [
    ...(rule.sizeEvidenceFactIds ?? []).map(factId => ({ factId,
      claimKey: benefitClauseClaimKeyV1("SIZE", rule) })),
    ...(rule.overlapEvidenceFactIds ?? []).map(factId => ({ factId,
      claimKey: benefitClauseClaimKeyV1("OVERLAP", rule) })),
    ...conditions.flatMap(value => value.evidenceFactIds.map(factId => ({ factId,
      claimKey: benefitClauseClaimKeyV1("ELIGIBILITY", value) }))),
    ...rule.compatibility.flatMap(edge => edge.evidenceFactIds.map(factId => ({ factId,
      claimKey: benefitClauseClaimKeyV1("COMPATIBILITY", edge) }))),
  ];
  for (const { factId, claimKey } of references) {
    const fact = facts.get(factId);
    if (!fact || fact.value?.kind !== "TEXT" || fact.value.text !== fact.statement ||
      fact.statement.length < 10 || fact.claimKey !== claimKey) {
      throw new RangeError("Eligibility, size, overlap or compatibility clause lacks verified quoted text evidence.");
    }
  }
}

const SCOPE_CATEGORIES: Readonly<Record<PolicyBenefitRuleV1["scope"], readonly string[]>> = {
  CENTRAL: ["CENTRAL_SUBSIDY"], STATE: ["STATE_SUBSIDY"],
  DISCOM: ["DISCOM_INCENTIVE"], LOCAL: ["LOCAL_BODY_INCENTIVE"],
  OTHER: ["REGULATORY_BENEFIT", "TAX_OR_FINANCIAL_BENEFIT", "OTHER"],
};

function citationsFor(rule: PolicyBenefitRuleV1, evidence: readonly PolicyEvidenceV1[],
  health: ReadonlyMap<string, PolicySourceHealthV1>, at: Date):
  { citations: PolicyCitationV1[]; sourceChecks: SourceCheck[]; fresh: boolean; degraded: boolean;
    lastVerifiedAt: string } {
  const citations: PolicyCitationV1[] = [];
  const sourceChecks: SourceCheck[] = [];
  let fresh = true, degraded = false;
  let lastVerifiedAt = at.toISOString();
  const matchingFacts: PolicyEvidenceV1[] = [];
  for (const factId of rule.factIds) {
    const matches = evidence.filter(item => item.fact.factId === factId && item.fact.policyId === rule.policyId &&
      item.fact.policyVersion === rule.policyVersion);
    if (matches.length !== 1) throw new RangeError("Each benefit rule fact needs exactly one immutable evidence binding.");
    const item = matches[0]!;
    matchingFacts.push(item);
    const source = policySourceSchema.parse(item.source);
    validateOfficialSourceRecord(source);
    const document = policyDocumentSchema.parse(item.document);
    const version = policyVersionSchema.parse(item.version);
    const fact = policyFactSchema.parse(item.fact);
    if (Date.parse(fact.lastVerifiedAt!) > at.getTime() || Date.parse(version.lastVerifiedAt!) > at.getTime()) {
      throw new RangeError("Policy evidence cannot be verified in the future.");
    }
    if (Date.parse(fact.lastVerifiedAt!) < Date.parse(lastVerifiedAt)) lastVerifiedAt = fact.lastVerifiedAt!;
    if (Date.parse(version.lastVerifiedAt!) < Date.parse(lastVerifiedAt)) lastVerifiedAt = version.lastVerifiedAt!;
    comparePolicyEvidence(item, item, at); // validates every immutable source/document/version/fact/citation binding
    if (version.status !== "ACTIVE" || version.verificationStatus !== "VERIFIED" ||
      fact.verificationStatus !== "VERIFIED" || fact.policyId !== rule.policyId ||
      fact.policyVersion !== rule.policyVersion || fact.jurisdiction !== rule.jurisdiction ||
      version.jurisdiction !== rule.jurisdiction || !SCOPE_CATEGORIES[rule.scope].includes(fact.category) ||
      rule.effectiveFrom < version.effectiveFrom || rule.effectiveFrom < fact.effectiveFrom ||
      (version.effectiveTo && (!rule.effectiveTo || rule.effectiveTo > version.effectiveTo)) ||
      (fact.effectiveTo && (!rule.effectiveTo || rule.effectiveTo > fact.effectiveTo)) ||
      document.sourceId !== source.sourceId) {
      throw new RangeError("Benefit rule is not contained in its active verified policy evidence.");
    }
    const current = health.get(source.sourceId);
    const checked = current?.lastCheckedAt ? Date.parse(current.lastCheckedAt) : Number.NaN;
    const sourceFresh = !!current && Number.isFinite(checked) && checked <= at.getTime() &&
      at.getTime() - checked <= source.freshnessWindowHours * 3_600_000 && current.status !== "STALE";
    if (!current || !Number.isFinite(checked) || checked > at.getTime() ||
      at.getTime() - checked > source.freshnessWindowHours * 3_600_000 ||
      current.status === "STALE") fresh = false;
    if (current?.status === "DEGRADED" || current?.status === "FAILED") degraded = true;
    // The current successful crawl check is authoritative for freshness; do not rewrite source snapshots.
    const liveSource = { ...source, healthStatus: "HEALTHY" as const, lastCheckedAt: current?.lastCheckedAt };
    const today = policyCalendarDateV1(at, rule.jurisdiction);
    if (sourceFresh && today >= rule.effectiveFrom && (!rule.effectiveTo || today <= rule.effectiveTo) &&
      !isPolicyEvidencePublishable({ source: liveSource, document, version, fact }, at)) {
      throw new RangeError("Benefit rule evidence failed official provenance and activation checks.");
    }
    citations.push(fact.citation);
    if (!sourceChecks.some(value => value.sourceId === source.sourceId)) sourceChecks.push({
      sourceId: source.sourceId, lastCheckedAt: current?.lastCheckedAt ?? null,
      fresh: sourceFresh, status: current?.status ?? "UNKNOWN",
    });
  }
  requireNumericRuleBacking(rule, matchingFacts);
  requireClauseBacking(rule, matchingFacts);
  return { citations, sourceChecks, fresh, degraded, lastVerifiedAt };
}

function pairAllowed(left: PolicyBenefitRuleV1, right: PolicyBenefitRuleV1,
  context: BenefitEvaluationContextV1): boolean {
  if (left.overlapGroupId && left.overlapGroupId === right.overlapGroupId) return false;
  const a = left.compatibility.find(edge => edge.withBenefitId === right.benefitId);
  const b = right.compatibility.find(edge => edge.withBenefitId === left.benefitId);
  if (!a || !b || a.mode !== b.mode) return false;
  if (a.mode === "ADDITIVE") return true;
  if (a.mode === "CAPPED_COMBINED") return !!left.combinedCapGroupId &&
    left.combinedCapGroupId === right.combinedCapGroupId && left.combinedCapPaise === right.combinedCapPaise;
  if (a.mode === "CONDITIONAL") return all(a.conditions ?? [], context) === "YES" &&
    all(b.conditions ?? [], context) === "YES";
  // Sequencing needs payment/order evidence, which V1 deliberately does not infer.
  return false;
}

function selectedAmounts(indices: number[], rules: PolicyBenefitRuleV1[], screens: Screen[]):
  { total: bigint; counted: Map<number, bigint> } {
  const counted = new Map<number, bigint>();
  const groupRemaining = new Map<string, bigint>();
  let total = 0n;
  for (const index of indices) {
    const rule = rules[index]!;
    let amount = screens[index]!.amount ?? 0n;
    if (rule.combinedCapGroupId) {
      const remaining = groupRemaining.get(rule.combinedCapGroupId) ?? BigInt(rule.combinedCapPaise!);
      if (amount > remaining) amount = remaining;
      groupRemaining.set(rule.combinedCapGroupId, remaining - amount);
    }
    counted.set(index, amount);
    total += amount;
  }
  if (total > MAX_PAISE) throw new RangeError("Total policy benefit exceeds the bounded integer-paise model.");
  return { total, counted };
}

/** Exact, bounded search. Missing applicant facts or compatibility never enter the counted stack. */
export function evaluateBenefitStackV1(input: BenefitStackInputV1): BenefitStackResultV1 {
  if (!Number.isFinite(input.at.getTime())) throw new RangeError("Invalid benefit evaluation time.");
  if (input.rules.length > 16 || input.evidence.length > 800 || input.sourceHealth.length > 800) {
    throw new RangeError("Policy rule/evidence search bound exceeded; evaluation must fail closed.");
  }
  const context = benefitEvaluationContextSchema.parse(input.context);
  const coverage = benefitCoverageSchema.parse(input.coverage);
  const rules = input.rules.map(value => policyBenefitRuleSchema.parse(value)).sort((a, b) => a.benefitId.localeCompare(b.benefitId));
  if (new Set(rules.map(value => value.benefitId)).size !== rules.length ||
    new Set(rules.map(value => value.ruleId)).size !== rules.length) throw new RangeError("Duplicate benefit or rule ID.");
  const healthRecords = input.sourceHealth.map(value => policySourceHealthSchema.parse(value));
  const health = new Map(healthRecords.map(value => [value.sourceId, value]));
  if (health.size !== healthRecords.length) throw new RangeError("Duplicate current source-health record.");
  const today = policyCalendarDateV1(input.at, context.country);
  const warnings = new Set<string>();
  if (!rules.length) warnings.add("NO_VERIFIED_RULES");
  const declaredCoverageComplete = Object.entries(coverage).filter(([key]) => key !== "verifiedAt")
    .every(([, value]) => value === true) && !!coverage.verifiedAt && Date.parse(coverage.verifiedAt) <= input.at.getTime();
  const screens: Screen[] = rules.map(rule => {
    const proven = citationsFor(rule, input.evidence, health, input.at);
    const reasons: string[] = [];
    if (!proven.fresh) reasons.push("SOURCE_STALE_OR_UNCHECKED");
    if (proven.degraded) warnings.add("SOURCE_CHECK_DEGRADED");
    if (today < rule.effectiveFrom || (rule.effectiveTo && today > rule.effectiveTo)) reasons.push("OUTSIDE_EFFECTIVE_PERIOD");
    const place = jurisdiction(rule, context);
    if (place === "NO") reasons.push("JURISDICTION_MISMATCH");
    if (place === "UNKNOWN") reasons.push("JURISDICTION_UNKNOWN");
    if (rule.minSystemWatts !== undefined && context.systemWatts < rule.minSystemWatts ||
      rule.maxSystemWatts !== undefined && context.systemWatts > rule.maxSystemWatts) reasons.push("SYSTEM_SIZE_INELIGIBLE");
    const allStatus = all(rule.eligibility.allOf, context);
    const anyStatuses = rule.eligibility.anyOf.map(group => all(group, context));
    const anyStatus: Tri = anyStatuses.length === 0 || anyStatuses.includes("YES") ? "YES" :
      anyStatuses.includes("UNKNOWN") ? "UNKNOWN" : "NO";
    if (allStatus === "NO" || anyStatus === "NO") reasons.push("APPLICANT_INELIGIBLE");
    else if (allStatus === "UNKNOWN" || anyStatus === "UNKNOWN") reasons.push("APPLICANT_FACTS_UNKNOWN");
    const amount = calculate(rule, context);
    if (amount === undefined) reasons.push("ELIGIBLE_COST_UNKNOWN");
    const no = reasons.some(reason => ["OUTSIDE_EFFECTIVE_PERIOD", "JURISDICTION_MISMATCH",
      "SYSTEM_SIZE_INELIGIBLE", "APPLICANT_INELIGIBLE"].includes(reason));
    return { status: no ? "NO" : reasons.length ? "UNKNOWN" : "YES", reasons, amount,
      citations: proven.citations, sourceChecks: proven.sourceChecks, lastVerifiedAt: proven.lastVerifiedAt };
  });
  const coverageComplete = declaredCoverageComplete && screens.every(screen =>
    !screen.reasons.includes("SOURCE_STALE_OR_UNCHECKED"));
  if (!coverageComplete) warnings.add("POLICY_COVERAGE_UNVERIFIED");
  for (const rule of rules) {
    if (rule.combinedCapGroupId && rules.some(other => other !== rule &&
      other.combinedCapGroupId === rule.combinedCapGroupId && other.combinedCapPaise !== rule.combinedCapPaise)) {
      throw new RangeError("Combined cap group has inconsistent verified amounts.");
    }
  }
  let best: number[] = [], bestTotal = 0n, bestCounted = new Map<number, bigint>();
  for (let mask = 1; mask < 1 << rules.length; mask++) {
    const indices = rules.flatMap((_, index) => mask & (1 << index) ? [index] : []);
    if (indices.some(index => screens[index]!.status !== "YES")) continue;
    let valid = true;
    for (let a = 0; a < indices.length && valid; a++) {
      for (let b = a + 1; b < indices.length; b++) {
        if (!pairAllowed(rules[indices[a]!]!, rules[indices[b]!]!, context)) { valid = false; break; }
      }
    }
    if (!valid) continue;
    const evaluated = selectedAmounts(indices, rules, screens);
    if (evaluated.total > bestTotal || evaluated.total === bestTotal && indices.length < best.length) {
      best = indices; bestTotal = evaluated.total; bestCounted = evaluated.counted;
    }
  }
  const chosen = new Set(best);
  const decisions = rules.map((rule, index) => {
    const screen = screens[index]!;
    const selected = chosen.has(index);
    const reasons = [...screen.reasons];
    if (selected) reasons.push("IN_OPTIMAL_VERIFIED_STACK");
    else if (screen.status === "YES") reasons.push(screen.amount === 0n ? "ZERO_VALUE_NO_PAYOUT" :
      best.some(other => !pairAllowed(rule, rules[other]!, context)) ?
        "COMPATIBILITY_OR_OVERLAP_EXCLUDED" : "NOT_IN_OPTIMAL_STACK");
    return {
      benefitId: rule.benefitId, ruleId: rule.ruleId, scope: rule.scope,
      jurisdiction: rule.jurisdiction, effectiveFrom: rule.effectiveFrom,
      ...(rule.effectiveTo ? { effectiveTo: rule.effectiveTo } : {}),
      status: selected ? "SELECTED" as const : screen.status === "NO" ? "INELIGIBLE" as const :
        screen.status === "UNKNOWN" ? "UNKNOWN" as const : "EXCLUDED" as const,
      reasonCodes: reasons,
      ...(screen.amount !== undefined ? { calculatedAmountPaise: Number(screen.amount) } : {}),
      ...(selected ? { countedAmountPaise: Number(bestCounted.get(index) ?? 0n) } : {}),
      policyId: rule.policyId, policyVersion: rule.policyVersion, factIds: rule.factIds,
      citations: screen.citations, sourceChecks: screen.sourceChecks,
      verificationStatus: "VERIFIED" as const, lastVerifiedAt: screen.lastVerifiedAt,
    };
  });
  if (rules.some((rule, index) => screens[index]!.status === "YES" && !chosen.has(index))) {
    warnings.add("SOME_VERIFIED_BENEFITS_NOT_STACKED");
  }
  return benefitStackResultSchema.parse({ schemaVersion: 1, source: "DETERMINISTIC_BENEFIT_STACK_V1",
    evaluatedAt: input.at.toISOString(), totalEligibleBenefitPaise: Number(bestTotal), coverageComplete,
    optimalWithinVerifiedRules: true, decisions, warnings: [...warnings].sort() });
}
