import { z } from "zod";
import { policyCitationSchema, policyJurisdictionSchema } from "./schema";

const identifier = (prefix: string) => z.string().regex(new RegExp(`^${prefix}#[A-Za-z0-9][A-Za-z0-9#_-]{0,127}$`));
const code = z.string().regex(/^[A-Z0-9][A-Z0-9_-]{0,63}$/);
const paise = z.number().int().safe().nonnegative().max(1_000_000_000_000);
const watts = z.number().int().safe().nonnegative().max(100_000_000);
const date = z.iso.date();
const evidenceFactIds = z.array(identifier("FACT")).min(1).max(10);

export const benefitScopeSchema = z.enum(["CENTRAL", "STATE", "DISCOM", "LOCAL", "OTHER"]);
export const customerTypeSchema = z.enum(["RESIDENTIAL", "COMMERCIAL", "INDUSTRIAL", "AGRICULTURAL", "OTHER"]);
export const propertyTypeSchema = z.enum(["INDIVIDUAL_HOME", "APARTMENT", "HOUSING_SOCIETY", "BUSINESS", "OTHER"]);
export const ownershipSchema = z.enum(["OWNER", "TENANT", "SOCIETY", "OTHER"]);
export const benefitConditionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("CUSTOMER_TYPE"), oneOf: z.array(customerTypeSchema).min(1).max(5), evidenceFactIds }).strict(),
  z.object({ kind: z.literal("PROPERTY_TYPE"), oneOf: z.array(propertyTypeSchema).min(1).max(5), evidenceFactIds }).strict(),
  z.object({ kind: z.literal("OWNERSHIP"), oneOf: z.array(ownershipSchema).min(1).max(4), evidenceFactIds }).strict(),
  z.object({ kind: z.literal("GRID_CONNECTED"), required: z.boolean(), evidenceFactIds }).strict(),
  z.object({ kind: z.literal("PRIOR_SUBSIDY"), received: z.boolean(), evidenceFactIds }).strict(),
  z.object({ kind: z.literal("VENDOR_APPROVED"), required: z.boolean(), evidenceFactIds }).strict(),
  z.object({ kind: z.literal("EQUIPMENT_APPROVED"), required: z.boolean(), evidenceFactIds }).strict(),
  z.object({ kind: z.literal("DISCOM"), oneOf: z.array(code).min(1).max(20), evidenceFactIds }).strict(),
  z.object({ kind: z.literal("DISTRICT"), oneOf: z.array(code).min(1).max(100), evidenceFactIds }).strict(),
  z.object({ kind: z.literal("LOCAL_BODY"), oneOf: z.array(code).min(1).max(100), evidenceFactIds }).strict(),
  z.object({ kind: z.literal("SANCTIONED_LOAD_RANGE"), minWatts: watts.optional(), maxWatts: watts.optional(), evidenceFactIds }).strict()
    .refine(value => (value.minWatts !== undefined || value.maxWatts !== undefined) &&
      (value.minWatts === undefined || value.maxWatts === undefined || value.minWatts <= value.maxWatts)),
  z.object({ kind: z.literal("INSTALLATION_DATE_RANGE"), from: date.optional(), through: date.optional(), evidenceFactIds }).strict()
    .refine(value => (value.from !== undefined || value.through !== undefined) &&
      (value.from === undefined || value.through === undefined || value.from <= value.through)),
  z.object({ kind: z.literal("APPLICATION_DATE_RANGE"), from: date.optional(), through: date.optional(), evidenceFactIds }).strict()
    .refine(value => (value.from !== undefined || value.through !== undefined) &&
      (value.from === undefined || value.through === undefined || value.from <= value.through)),
  z.object({ kind: z.literal("SCHEME_PARTICIPATION"), schemeId: code, required: z.boolean(), evidenceFactIds }).strict(),
]);

export const benefitAmountSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("FIXED"), amountPaise: paise }).strict(),
  z.object({ kind: z.literal("PER_KW"), ratePaisePerKw: paise }).strict(),
  z.object({ kind: z.literal("TIERED_KW"), tiers: z.array(z.object({ upToWatts: watts.positive(),
    ratePaisePerKw: paise }).strict()).min(1).max(20) }).strict().refine(value =>
    value.tiers.every((tier, index) => index === 0 || tier.upToWatts > value.tiers[index - 1]!.upToWatts),
  "Tier bounds must increase."),
  z.object({ kind: z.literal("PERCENT_ELIGIBLE_COST"), basisPoints: z.number().int().min(0).max(10_000) }).strict(),
]);
export const benefitCompatibilityModeSchema = z.enum([
  "ADDITIVE", "CAPPED_COMBINED", "MUTUALLY_EXCLUSIVE", "CONDITIONAL", "ALTERNATIVE", "SEQUENTIAL",
  "NOT_STACKABLE", "UNKNOWN",
]);
export const benefitCompatibilityEdgeSchema = z.object({
  withBenefitId: identifier("BENEFIT"), mode: benefitCompatibilityModeSchema, evidenceFactIds,
  conditions: z.array(benefitConditionSchema).min(1).max(20).optional(),
}).strict().superRefine((edge, context) => {
  if ((edge.mode === "CONDITIONAL") !== !!edge.conditions) context.addIssue({ code: "custom",
    path: ["conditions"], message: "Only conditional compatibility requires conditions." });
});

export const policyBenefitRuleSchema = z.object({
  schemaVersion: z.literal(1), ruleId: identifier("RULE"), benefitId: identifier("BENEFIT"),
  policyId: identifier("POLICY"), policyVersion: z.number().int().positive(),
  factIds: z.array(identifier("FACT")).min(1).max(50), scope: benefitScopeSchema,
  jurisdiction: policyJurisdictionSchema, effectiveFrom: date, effectiveTo: date.optional(),
  amount: benefitAmountSchema, capPaise: paise.optional(),
  minSystemWatts: watts.optional(), maxSystemWatts: watts.optional(),
  sizeEvidenceFactIds: evidenceFactIds.optional(),
  eligibility: z.object({ allOf: z.array(benefitConditionSchema).max(50),
    anyOf: z.array(z.array(benefitConditionSchema).min(1).max(20)).max(10) }).strict(),
  compatibility: z.array(benefitCompatibilityEdgeSchema).max(100),
  overlapGroupId: code.optional(), overlapEvidenceFactIds: evidenceFactIds.optional(),
  combinedCapGroupId: code.optional(), combinedCapPaise: paise.optional(),
}).strict().superRefine((rule, context) => {
  if (rule.effectiveTo && rule.effectiveTo < rule.effectiveFrom) context.addIssue({ code: "custom", path: ["effectiveTo"], message: "Inverted effective period." });
  if (rule.minSystemWatts !== undefined && rule.maxSystemWatts !== undefined && rule.minSystemWatts > rule.maxSystemWatts) {
    context.addIssue({ code: "custom", path: ["maxSystemWatts"], message: "Inverted size range." });
  }
  if ((rule.combinedCapGroupId === undefined) !== (rule.combinedCapPaise === undefined)) {
    context.addIssue({ code: "custom", path: ["combinedCapPaise"], message: "Combined cap group and amount must appear together." });
  }
  if ((rule.minSystemWatts !== undefined || rule.maxSystemWatts !== undefined) !== !!rule.sizeEvidenceFactIds ||
    (rule.overlapGroupId !== undefined) !== !!rule.overlapEvidenceFactIds) {
    context.addIssue({ code: "custom", path: ["sizeEvidenceFactIds"],
      message: "Size and overlap restrictions require their own evidence references." });
  }
  const clauseIds = [
    ...(rule.sizeEvidenceFactIds ?? []), ...(rule.overlapEvidenceFactIds ?? []),
    ...rule.eligibility.allOf.flatMap(value => value.evidenceFactIds),
    ...rule.eligibility.anyOf.flatMap(group => group.flatMap(value => value.evidenceFactIds)),
    ...rule.compatibility.flatMap(value => [
      ...value.evidenceFactIds, ...(value.conditions ?? []).flatMap(condition => condition.evidenceFactIds),
    ]),
  ];
  if (clauseIds.some(factId => !rule.factIds.includes(factId))) {
    context.addIssue({ code: "custom", path: ["factIds"],
      message: "Every rule clause must cite a fact in the same policy version." });
  }
  if (new Set(rule.factIds).size !== rule.factIds.length ||
    new Set(rule.compatibility.map(edge => edge.withBenefitId)).size !== rule.compatibility.length ||
    rule.compatibility.some(edge => edge.withBenefitId === rule.benefitId)) {
    context.addIssue({ code: "custom", path: ["compatibility"], message: "Duplicate or self-referential rule linkage." });
  }
});

export const benefitEvaluationContextSchema = z.object({
  systemWatts: watts.positive(), eligibleQuotedCostPaise: paise.optional(),
  country: z.string().regex(/^[A-Z]{2}$/), state: z.string().regex(/^[A-Z0-9]{1,8}$/).optional(),
  district: code.optional(), localBody: code.optional(), discom: code.optional(),
  customerType: customerTypeSchema.optional(), propertyType: propertyTypeSchema.optional(),
  ownership: ownershipSchema.optional(), gridConnected: z.boolean().optional(),
  priorSubsidyReceived: z.boolean().optional(), vendorApproved: z.boolean().optional(),
  equipmentApproved: z.boolean().optional(), sanctionedLoadWatts: watts.optional(),
  installationDate: date.optional(), applicationDate: date.optional(), participatingSchemeIds: z.array(code).max(50).optional(),
}).strict();
export const policySourceHealthSchema = z.object({
  sourceId: identifier("SRC"), status: z.enum(["HEALTHY", "DEGRADED", "STALE", "FAILED"]),
  lastCheckedAt: z.iso.datetime({ offset: true }).optional(),
}).strict();
export const benefitCoverageSchema = z.object({
  central: z.boolean(), state: z.boolean(), discom: z.boolean(), local: z.boolean(), other: z.boolean(),
  verifiedAt: z.iso.datetime({ offset: true }).optional(),
}).strict().refine(value => !(value.central || value.state || value.discom || value.local || value.other) || !!value.verifiedAt,
  "Asserted coverage requires a verification time.");

export const benefitDecisionSchema = z.object({
  benefitId: identifier("BENEFIT"), ruleId: identifier("RULE"), scope: benefitScopeSchema,
  jurisdiction: policyJurisdictionSchema, effectiveFrom: date, effectiveTo: date.optional(),
  status: z.enum(["SELECTED", "INELIGIBLE", "UNKNOWN", "EXCLUDED"]),
  reasonCodes: z.array(z.string().regex(/^[A-Z][A-Z0-9_]{1,80}$/)).max(30),
  calculatedAmountPaise: paise.optional(), countedAmountPaise: paise.optional(),
  policyId: identifier("POLICY"), policyVersion: z.number().int().positive(),
  factIds: z.array(identifier("FACT")).min(1).max(50), citations: z.array(policyCitationSchema).min(1).max(50),
  sourceChecks: z.array(z.object({ sourceId: identifier("SRC"), lastCheckedAt: z.iso.datetime({ offset: true }).nullable(),
    fresh: z.boolean(), status: z.enum(["HEALTHY", "DEGRADED", "STALE", "FAILED", "UNKNOWN"]) }).strict()).min(1).max(50),
  verificationStatus: z.literal("VERIFIED"), lastVerifiedAt: z.iso.datetime({ offset: true }),
}).strict();
export const benefitStackResultSchema = z.object({
  schemaVersion: z.literal(1), source: z.literal("DETERMINISTIC_BENEFIT_STACK_V1"),
  evaluatedAt: z.iso.datetime({ offset: true }), totalEligibleBenefitPaise: paise,
  coverageComplete: z.boolean(), optimalWithinVerifiedRules: z.boolean(),
  decisions: z.array(benefitDecisionSchema).max(16),
  warnings: z.array(z.string().regex(/^[A-Z][A-Z0-9_]{1,80}$/)).max(30),
}).strict();

export type PolicyBenefitRuleV1 = z.infer<typeof policyBenefitRuleSchema>;
export type BenefitConditionV1 = z.infer<typeof benefitConditionSchema>;
export type BenefitEvaluationContextV1 = z.infer<typeof benefitEvaluationContextSchema>;
export type PolicySourceHealthV1 = z.infer<typeof policySourceHealthSchema>;
export type BenefitCoverageV1 = z.infer<typeof benefitCoverageSchema>;
export type BenefitStackResultV1 = z.infer<typeof benefitStackResultSchema>;
