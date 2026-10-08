import type { BenefitStackResultV1 } from "@solarsaathi/policy";
import type { BaseFinancialResultV1, BaseFinancialWarningV1, BaseFinancialYearV1 } from "./base-financials";

export type PolicyFinancialStatusV1 = "PARTIAL" | "COMPLETE";
export type PolicyFinancialWarningV1 =
  | "BENEFIT_PAYMENT_TIMING_UNVERIFIED"
  | "POLICY_COVERAGE_INCOMPLETE"
  | "BENEFIT_AMOUNT_UNKNOWN"
  | "BENEFITS_EXCEED_GROSS_QUOTE"
  | "OTHER_BENEFITS_NOT_MODELED_UPFRONT"
  | "NO_PAYBACK_WITHIN_25_YEARS";

export interface PolicyFinancialInputV1 {
  /** Both results must be recomputed by the backend for the same owned analysis and quote. */
  base: BaseFinancialResultV1;
  benefits: BenefitStackResultV1;
}

export interface PolicyFinancialYearV1 extends BaseFinancialYearV1 {
  /** The Phase 7 cumulative value, before any modeled benefit. */
  baseCumulativeCashFlowRupees: number;
}

export interface PolicyFinancialResultV1 {
  schemaVersion: 1;
  source: "DETERMINISTIC_POLICY_FINANCIAL_V1";
  /** COMPLETE refers to verified scope coverage, not a guaranteed payment. */
  status: PolicyFinancialStatusV1;
  timingAssumption: "BENEFITS_MODELED_UPFRONT";
  policyBenefitsEvaluated: true;
  financingModeled: false;
  horizonYears: 25;
  grossCostPaise: number;
  selectedByScopePaise: Record<"CENTRAL" | "STATE" | "DISCOM" | "LOCAL" | "OTHER", number>;
  totalEligibleBenefitPaise: number;
  /** Other benefits can include tax, financing or regulatory value, so they remain outside upfront cash flow. */
  nonUpfrontBenefitPaise: number;
  /** Only this amount reduces the modeled initial investment. */
  modeledUpfrontBenefitPaise: number;
  /** Modeled upfront benefit above the quote is disclosed but never creates negative upfront cost. */
  excessBenefitPaise: number;
  netUpfrontCostPaise: number;
  initialCashFlowRupees: number;
  annualRows: PolicyFinancialYearV1[];
  totals: {
    paybackYears: number | null;
    netSavingsOver25YearsRupees: number;
    yearOneNetCashFlowRupees: number;
  };
  coverageComplete: boolean;
  provenance: {
    benefitEvaluatedAt: string;
    optimalWithinVerifiedRules: true;
    selectedPolicies: Array<{
      benefitId: string;
      ruleId: string;
      policyId: string;
      policyVersion: number;
      sourceIds: string[];
      lastVerifiedAt: string;
    }>;
  };
  /** The Phase 7 sensitivity is intentionally not adjusted by an unverified future payment. */
  baseWarnings: BaseFinancialWarningV1[];
  warnings: PolicyFinancialWarningV1[];
}

/** Decimal-string conversion gives deterministic half-up rounding to one paise. */
function rupeesToPaise(value: number): bigint {
  if (!Number.isFinite(value)) throw new RangeError("Invalid financial money amount.");
  const match = /^(?<sign>-?)(?<whole>\d+)(?:\.(?<fraction>\d+))?(?:e(?<exponent>[+-]?\d+))?$/i.exec(value.toString());
  if (!match?.groups) throw new RangeError("Invalid financial money amount.");
  const digits = BigInt(match.groups.whole + (match.groups.fraction ?? ""));
  const exponent = Number(match.groups.exponent ?? 0);
  const scale = (match.groups.fraction?.length ?? 0) - exponent - 2;
  if (!Number.isSafeInteger(scale) || Math.abs(scale) > 350) throw new RangeError("Financial precision out of range.");
  const rounded = scale <= 0 ? digits * 10n ** BigInt(-scale) :
    (digits + 5n * 10n ** BigInt(scale - 1)) / 10n ** BigInt(scale);
  const signed = match.groups.sign === "-" ? -rounded : rounded;
  if (signed > BigInt(Number.MAX_SAFE_INTEGER) || signed < -BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError("Financial amount exceeds safe paise precision.");
  }
  return signed;
}

function paiseToRupees(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < -BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError("Financial amount exceeds safe paise precision.");
  }
  return Number(value) / 100;
}

function validBase(base: BaseFinancialResultV1): void {
  if (base.schemaVersion !== 1 || base.source !== "DETERMINISTIC_BASE_FINANCIAL_V1" ||
    base.policyBenefitsEvaluated !== false || base.financingModeled !== false || base.horizonYears !== 25 ||
    base.annualRows.length !== 25 || base.input.schemaVersion !== 1 ||
    base.initialCashFlowRupees !== -base.input.quote.grossSystemCostRupees ||
    base.annualRows.some((row, index) => row.year !== index + 1 || !Number.isFinite(row.netCashFlowRupees) ||
      !Number.isFinite(row.cumulativeCashFlowRupees))) {
    throw new RangeError("Policy projection requires a valid Phase 7 base result.");
  }
  if (rupeesToPaise(base.input.quote.grossSystemCostRupees) <= 0n) {
    throw new RangeError("Gross quote must be positive after paise rounding.");
  }
}

/** A pure scenario: benefits are modeled at year zero because disbursement timing is not verified. */
export function calculatePolicyFinancialsV1({ base, benefits }: PolicyFinancialInputV1): PolicyFinancialResultV1 {
  validBase(base);
  const stack = benefits;
  // The server produces the validated stack; keep these arithmetic invariants pure and browser-safe.
  if (stack.schemaVersion !== 1 || stack.source !== "DETERMINISTIC_BENEFIT_STACK_V1" ||
    !stack.optimalWithinVerifiedRules || !Array.isArray(stack.decisions) || stack.decisions.length > 16 ||
    !Number.isSafeInteger(stack.totalEligibleBenefitPaise) || stack.totalEligibleBenefitPaise < 0) {
    throw new RangeError("Benefit stack has not been validated and optimized.");
  }
  const evaluationTime = Date.parse(stack.evaluatedAt);
  if (!Number.isFinite(evaluationTime)) throw new RangeError("Invalid benefit evaluation timestamp.");
  const selected = stack.decisions.filter(decision => decision.status === "SELECTED");
  if (stack.decisions.some(decision => decision.status !== "SELECTED" && decision.countedAmountPaise !== undefined)) {
    throw new RangeError("Only selected policy rules may count toward the quote.");
  }
  const selectedByScope = { CENTRAL: 0n, STATE: 0n, DISCOM: 0n, LOCAL: 0n, OTHER: 0n };
  for (const decision of selected) {
    if (!(decision.scope in selectedByScope) || !Array.isArray(decision.citations) ||
      !Array.isArray(decision.sourceChecks) || !Number.isFinite(Date.parse(decision.lastVerifiedAt))) {
      throw new RangeError("Selected benefit has invalid provenance.");
    }
    if (decision.countedAmountPaise === undefined || decision.calculatedAmountPaise === undefined ||
      !Number.isSafeInteger(decision.countedAmountPaise) || decision.countedAmountPaise < 0 ||
      !Number.isSafeInteger(decision.calculatedAmountPaise) || decision.calculatedAmountPaise < 0 ||
      decision.countedAmountPaise > decision.calculatedAmountPaise ||
      Date.parse(decision.lastVerifiedAt) > evaluationTime ||
      decision.citations.some(citation => !decision.sourceChecks.some(check => check.sourceId === citation.sourceId)) ||
      decision.sourceChecks.some(check => !check.fresh || check.lastCheckedAt === null ||
        Date.parse(check.lastCheckedAt) > evaluationTime ||
        !["HEALTHY", "DEGRADED"].includes(check.status))) {
      throw new RangeError("Selected policy benefit lacks a current, consistent evidence binding.");
    }
    selectedByScope[decision.scope] += BigInt(decision.countedAmountPaise);
  }
  const selectedTotal = Object.values(selectedByScope).reduce((sum, value) => sum + value, 0n);
  if (selectedTotal !== BigInt(stack.totalEligibleBenefitPaise)) {
    throw new RangeError("Selected policy amounts do not match the benefit stack total.");
  }
  const gross = rupeesToPaise(base.input.quote.grossSystemCostRupees);
  const nonUpfrontBenefit = selectedByScope.OTHER;
  const upfrontEligible = selectedTotal - nonUpfrontBenefit;
  const modeledBenefit = upfrontEligible > gross ? gross : upfrontEligible;
  const excessBenefit = upfrontEligible - modeledBenefit;
  const net = gross - modeledBenefit;
  const rows: PolicyFinancialYearV1[] = [];
  let cumulative = -net;
  let paybackYears: number | null = net === 0n ? 0 : null;
  for (const row of base.annualRows) {
    const netCashFlow = rupeesToPaise(row.netCashFlowRupees);
    const beforeYear = cumulative;
    cumulative += netCashFlow;
    if (paybackYears === null && beforeYear < 0n && cumulative >= 0n && netCashFlow > 0n) {
      paybackYears = row.year - 1 + Number(-beforeYear) / Number(netCashFlow);
    }
    rows.push({ ...row, netCashFlowRupees: paiseToRupees(netCashFlow),
      baseCumulativeCashFlowRupees: row.cumulativeCashFlowRupees,
      cumulativeCashFlowRupees: paiseToRupees(cumulative) });
  }
  const unknown = stack.decisions.some(decision => decision.status === "UNKNOWN");
  const status: PolicyFinancialStatusV1 = stack.coverageComplete && !unknown ? "COMPLETE" : "PARTIAL";
  const warnings: PolicyFinancialWarningV1[] = ["BENEFIT_PAYMENT_TIMING_UNVERIFIED"];
  if (!stack.coverageComplete) warnings.push("POLICY_COVERAGE_INCOMPLETE");
  if (unknown) warnings.push("BENEFIT_AMOUNT_UNKNOWN");
  if (excessBenefit > 0n) warnings.push("BENEFITS_EXCEED_GROSS_QUOTE");
  if (nonUpfrontBenefit > 0n) warnings.push("OTHER_BENEFITS_NOT_MODELED_UPFRONT");
  if (paybackYears === null) warnings.push("NO_PAYBACK_WITHIN_25_YEARS");
  return {
    schemaVersion: 1, source: "DETERMINISTIC_POLICY_FINANCIAL_V1", status,
    timingAssumption: "BENEFITS_MODELED_UPFRONT", policyBenefitsEvaluated: true,
    financingModeled: false, horizonYears: 25,
    grossCostPaise: Number(gross),
    selectedByScopePaise: {
      CENTRAL: Number(selectedByScope.CENTRAL), STATE: Number(selectedByScope.STATE),
      DISCOM: Number(selectedByScope.DISCOM), LOCAL: Number(selectedByScope.LOCAL),
      OTHER: Number(selectedByScope.OTHER),
    },
    totalEligibleBenefitPaise: Number(selectedTotal),
    nonUpfrontBenefitPaise: Number(nonUpfrontBenefit),
    modeledUpfrontBenefitPaise: Number(modeledBenefit),
    excessBenefitPaise: Number(excessBenefit), netUpfrontCostPaise: Number(net),
    initialCashFlowRupees: paiseToRupees(-net), annualRows: rows,
    totals: { paybackYears, netSavingsOver25YearsRupees: paiseToRupees(cumulative),
      yearOneNetCashFlowRupees: rows[0]!.netCashFlowRupees },
    coverageComplete: stack.coverageComplete,
    provenance: {
      benefitEvaluatedAt: stack.evaluatedAt, optimalWithinVerifiedRules: true,
      selectedPolicies: selected.map(decision => ({
        benefitId: decision.benefitId, ruleId: decision.ruleId, policyId: decision.policyId,
        policyVersion: decision.policyVersion,
        sourceIds: decision.sourceChecks.map(check => check.sourceId),
        lastVerifiedAt: decision.lastVerifiedAt,
      })),
    },
    baseWarnings: [...base.warnings], warnings,
  };
}
