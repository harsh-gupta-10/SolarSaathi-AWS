import { benefitClauseClaimKeyV1 } from "./benefit-clause-keys";
import type { BenefitCoverageV1, BenefitEvaluationContextV1, BenefitStackResultV1, PolicyBenefitRuleV1, PolicySourceHealthV1 } from "./benefit-rules";
import { evaluateBenefitStackV1 } from "./benefit-stacking";
import { buildPolicyCitation, type PolicyEvidenceV1 } from "./precedence";
import type { PolicyDocumentV1, PolicyFactV1, PolicySourceV1, PolicyVersionV1 } from "./schema";

export interface ActivePolicyBundleV1 {
  schemaVersion: 1;
  policyId: string;
  benefitId: string;
  version: PolicyVersionV1;
  facts: PolicyFactV1[];
  rule: PolicyBenefitRuleV1;
  activatedAt: string;
}

export interface BaselinePolicyState {
  sourceId: string;
  revision: number;
  status: "READY";
  nextDueAtEpochSeconds: number;
  lastCheckedAt: string;
  lastDocumentId: string;
  lastDocumentVersion: number;
  lastObservedSha256: string;
  failureCount: number;
}

const CHECKED_AT = "2026-10-08T00:00:00.000Z";
const SHA_ZERO = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const SHA_MH = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b856";

// 1. National Source: PM Surya Ghar
export const BASELINE_SOURCE_IN: PolicySourceV1 = {
  schemaVersion: 1,
  sourceId: "SRC#00000000000000000000000000000001",
  registryVersion: 1,
  name: "National Rooftop Solar Portal",
  publisherName: "PM Surya Ghar / MNRE",
  jurisdiction: "IN",
  sourceType: "SCHEME_PORTAL",
  authorityTier: 1,
  registryStatus: "CURATED",
  healthStatus: "HEALTHY",
  canonicalUrl: "https://solarrooftop.pmsuryaghar.gov.in/",
  allowedHosts: ["solarrooftop.pmsuryaghar.gov.in"],
  crawlFrequency: "DAILY",
  freshnessWindowHours: 720,
  curatorId: "solarsaathi-curator",
  curatedAt: CHECKED_AT,
  enabled: true,
  createdAt: CHECKED_AT,
  updatedAt: CHECKED_AT,
};

// 2. Maharashtra State Source: MSEDCL
export const BASELINE_SOURCE_MH: PolicySourceV1 = {
  schemaVersion: 1,
  sourceId: "SRC#00000000000000000000000000000002",
  registryVersion: 1,
  name: "MSEDCL I-SMART rooftop solar portal",
  publisherName: "Maharashtra State Electricity Distribution Co. Ltd.",
  jurisdiction: "IN-MH",
  sourceType: "DISCOM",
  authorityTier: 1,
  registryStatus: "CURATED",
  healthStatus: "HEALTHY",
  canonicalUrl: "https://portal.mahadiscom.in/ismart/",
  allowedHosts: ["portal.mahadiscom.in"],
  crawlFrequency: "DAILY",
  freshnessWindowHours: 720,
  curatorId: "solarsaathi-curator",
  curatedAt: CHECKED_AT,
  enabled: true,
  createdAt: CHECKED_AT,
  updatedAt: CHECKED_AT,
};

// 3. Official Documents
export const BASELINE_DOC_IN: PolicyDocumentV1 = {
  schemaVersion: 1,
  documentId: "DOC#00000000000000000000000000000001",
  sourceId: BASELINE_SOURCE_IN.sourceId,
  sourceRegistryVersion: 1,
  version: 1,
  title: "PM - Surya Ghar: Muft Bijli Yojana Operational Guidelines",
  documentType: "SCHEME_NOTIFICATION",
  mimeType: "text/html",
  canonicalUrl: BASELINE_SOURCE_IN.canonicalUrl,
  sha256: SHA_ZERO,
  retrievedAt: CHECKED_AT,
  publishedAt: "2024-02-15",
  effectiveFrom: "2024-02-15",
};

export const BASELINE_DOC_MH: PolicyDocumentV1 = {
  schemaVersion: 1,
  documentId: "DOC#00000000000000000000000000000002",
  sourceId: BASELINE_SOURCE_MH.sourceId,
  sourceRegistryVersion: 1,
  version: 1,
  title: "MSEDCL Rooftop Solar Net Metering Connection Procedures and Facilitation",
  documentType: "GUIDELINE",
  mimeType: "text/html",
  canonicalUrl: BASELINE_SOURCE_MH.canonicalUrl,
  sha256: SHA_MH,
  retrievedAt: CHECKED_AT,
  publishedAt: "2020-01-01",
  effectiveFrom: "2020-01-01",
};

// 4. Central PM Surya Ghar Facts
const factCentralTier1: PolicyFactV1 = {
  schemaVersion: 1,
  factId: "FACT#PMSURYAGHAR#TIER1",
  policyId: "POLICY#PMSURYAGHAR",
  policyVersion: 1,
  category: "CENTRAL_SUBSIDY",
  jurisdiction: "IN",
  claimKey: "pmsuryaghar.cfa.tier1",
  statement: "Central subsidy of INR 30,000 per kW for residential systems up to 2 kW",
  value: { kind: "NUMBER", amount: 30000, unit: "INR_PER_KW" },
  effectiveFrom: "2024-02-15",
  citation: buildPolicyCitation(BASELINE_SOURCE_IN, BASELINE_DOC_IN, { section: "Para 3.1" }),
  verificationStatus: "VERIFIED",
  lastVerifiedAt: CHECKED_AT,
  verifiedBy: "solarsaathi-policy-team",
  recordedAt: CHECKED_AT,
};

const factCentralTier1Bound: PolicyFactV1 = {
  schemaVersion: 1,
  factId: "FACT#PMSURYAGHAR#TIER1#BOUND",
  policyId: "POLICY#PMSURYAGHAR",
  policyVersion: 1,
  category: "CENTRAL_SUBSIDY",
  jurisdiction: "IN",
  claimKey: "pmsuryaghar.cfa.tier1.bound",
  statement: "PM Surya Ghar tier 1 applies for capacity up to 2 kW",
  value: { kind: "NUMBER", amount: 2, unit: "KW" },
  effectiveFrom: "2024-02-15",
  citation: buildPolicyCitation(BASELINE_SOURCE_IN, BASELINE_DOC_IN, { section: "Para 3.1" }),
  verificationStatus: "VERIFIED",
  lastVerifiedAt: CHECKED_AT,
  verifiedBy: "solarsaathi-policy-team",
  recordedAt: CHECKED_AT,
};

const factCentralTier2: PolicyFactV1 = {
  schemaVersion: 1,
  factId: "FACT#PMSURYAGHAR#TIER2",
  policyId: "POLICY#PMSURYAGHAR",
  policyVersion: 1,
  category: "CENTRAL_SUBSIDY",
  jurisdiction: "IN",
  claimKey: "pmsuryaghar.cfa.tier2",
  statement: "Additional central subsidy of INR 18,000 per kW between 2 kW and 3 kW, capped at INR 78,000",
  value: { kind: "NUMBER", amount: 18000, unit: "INR_PER_KW" },
  effectiveFrom: "2024-02-15",
  citation: buildPolicyCitation(BASELINE_SOURCE_IN, BASELINE_DOC_IN, { section: "Para 3.2" }),
  verificationStatus: "VERIFIED",
  lastVerifiedAt: CHECKED_AT,
  verifiedBy: "solarsaathi-policy-team",
  recordedAt: CHECKED_AT,
};

const factCentralTier2Bound: PolicyFactV1 = {
  schemaVersion: 1,
  factId: "FACT#PMSURYAGHAR#TIER2#BOUND",
  policyId: "POLICY#PMSURYAGHAR",
  policyVersion: 1,
  category: "CENTRAL_SUBSIDY",
  jurisdiction: "IN",
  claimKey: "pmsuryaghar.cfa.tier2.bound",
  statement: "PM Surya Ghar tier 2 applies for capacity up to 3 kW",
  value: { kind: "NUMBER", amount: 3, unit: "KW" },
  effectiveFrom: "2024-02-15",
  citation: buildPolicyCitation(BASELINE_SOURCE_IN, BASELINE_DOC_IN, { section: "Para 3.2" }),
  verificationStatus: "VERIFIED",
  lastVerifiedAt: CHECKED_AT,
  verifiedBy: "solarsaathi-policy-team",
  recordedAt: CHECKED_AT,
};

const factCentralCap: PolicyFactV1 = {
  schemaVersion: 1,
  factId: "FACT#PMSURYAGHAR#CAP",
  policyId: "POLICY#PMSURYAGHAR",
  policyVersion: 1,
  category: "CENTRAL_SUBSIDY",
  jurisdiction: "IN",
  claimKey: "pmsuryaghar.cfa.cap",
  statement: "Maximum central subsidy cap of INR 78,000 for residential systems",
  value: { kind: "NUMBER", amount: 78000, unit: "INR" },
  effectiveFrom: "2024-02-15",
  citation: buildPolicyCitation(BASELINE_SOURCE_IN, BASELINE_DOC_IN, { section: "Para 3.3" }),
  verificationStatus: "VERIFIED",
  lastVerifiedAt: CHECKED_AT,
  verifiedBy: "solarsaathi-policy-team",
  recordedAt: CHECKED_AT,
};

const factCentralCustomer: PolicyFactV1 = {
  schemaVersion: 1,
  factId: "FACT#PMSURYAGHAR#COND#CUSTOMER",
  policyId: "POLICY#PMSURYAGHAR",
  policyVersion: 1,
  category: "CENTRAL_SUBSIDY",
  jurisdiction: "IN",
  claimKey: benefitClauseClaimKeyV1("ELIGIBILITY", { kind: "CUSTOMER_TYPE", oneOf: ["RESIDENTIAL"], evidenceFactIds: ["FACT#PMSURYAGHAR#COND#CUSTOMER"] }),
  statement: "Applicant must be a residential electricity customer",
  value: { kind: "TEXT", text: "Applicant must be a residential electricity customer" },
  effectiveFrom: "2024-02-15",
  citation: buildPolicyCitation(BASELINE_SOURCE_IN, BASELINE_DOC_IN, { section: "Para 4.1" }),
  verificationStatus: "VERIFIED",
  lastVerifiedAt: CHECKED_AT,
  verifiedBy: "solarsaathi-policy-team",
  recordedAt: CHECKED_AT,
};

const factCentralGrid: PolicyFactV1 = {
  schemaVersion: 1,
  factId: "FACT#PMSURYAGHAR#COND#GRID",
  policyId: "POLICY#PMSURYAGHAR",
  policyVersion: 1,
  category: "CENTRAL_SUBSIDY",
  jurisdiction: "IN",
  claimKey: benefitClauseClaimKeyV1("ELIGIBILITY", { kind: "GRID_CONNECTED", required: true, evidenceFactIds: ["FACT#PMSURYAGHAR#COND#GRID"] }),
  statement: "Rooftop solar system must be connected to the distribution grid",
  value: { kind: "TEXT", text: "Rooftop solar system must be connected to the distribution grid" },
  effectiveFrom: "2024-02-15",
  citation: buildPolicyCitation(BASELINE_SOURCE_IN, BASELINE_DOC_IN, { section: "Para 4.2" }),
  verificationStatus: "VERIFIED",
  lastVerifiedAt: CHECKED_AT,
  verifiedBy: "solarsaathi-policy-team",
  recordedAt: CHECKED_AT,
};

const factCentralEdgeMh: PolicyFactV1 = {
  schemaVersion: 1,
  factId: "FACT#PMSURYAGHAR#EDGE#MH",
  policyId: "POLICY#PMSURYAGHAR",
  policyVersion: 1,
  category: "CENTRAL_SUBSIDY",
  jurisdiction: "IN",
  claimKey: benefitClauseClaimKeyV1("COMPATIBILITY", { withBenefitId: "BENEFIT#MH_MSEDCL_NETMETERING", mode: "ADDITIVE", evidenceFactIds: ["FACT#PMSURYAGHAR#EDGE#MH"] }),
  statement: "Central CFA is additive with state utility net metering and interconnection",
  value: { kind: "TEXT", text: "Central CFA is additive with state utility net metering and interconnection" },
  effectiveFrom: "2024-02-15",
  citation: buildPolicyCitation(BASELINE_SOURCE_IN, BASELINE_DOC_IN, { section: "Para 5.1" }),
  verificationStatus: "VERIFIED",
  lastVerifiedAt: CHECKED_AT,
  verifiedBy: "solarsaathi-policy-team",
  recordedAt: CHECKED_AT,
};

// 5. Maharashtra State Facts
const factMhFixedZero: PolicyFactV1 = {
  schemaVersion: 1,
  factId: "FACT#MH#FIXED#ZERO",
  policyId: "POLICY#MH_MSEDCL",
  policyVersion: 1,
  category: "STATE_SUBSIDY",
  jurisdiction: "IN-MH",
  claimKey: "msedcl.netmetering.payout",
  statement: "MSEDCL solar net metering interconnection facilitation without separate direct cash payout",
  value: { kind: "NUMBER", amount: 0, unit: "INR" },
  effectiveFrom: "2020-01-01",
  citation: buildPolicyCitation(BASELINE_SOURCE_MH, BASELINE_DOC_MH, { section: "Section 1" }),
  verificationStatus: "VERIFIED",
  lastVerifiedAt: CHECKED_AT,
  verifiedBy: "solarsaathi-policy-team",
  recordedAt: CHECKED_AT,
};

const factMhCustomer: PolicyFactV1 = {
  schemaVersion: 1,
  factId: "FACT#MH#COND#CUSTOMER",
  policyId: "POLICY#MH_MSEDCL",
  policyVersion: 1,
  category: "STATE_SUBSIDY",
  jurisdiction: "IN-MH",
  claimKey: benefitClauseClaimKeyV1("ELIGIBILITY", { kind: "CUSTOMER_TYPE", oneOf: ["RESIDENTIAL"], evidenceFactIds: ["FACT#MH#COND#CUSTOMER"] }),
  statement: "MSEDCL solar net metering available to residential consumers",
  value: { kind: "TEXT", text: "MSEDCL solar net metering available to residential consumers" },
  effectiveFrom: "2020-01-01",
  citation: buildPolicyCitation(BASELINE_SOURCE_MH, BASELINE_DOC_MH, { section: "Section 2" }),
  verificationStatus: "VERIFIED",
  lastVerifiedAt: CHECKED_AT,
  verifiedBy: "solarsaathi-policy-team",
  recordedAt: CHECKED_AT,
};

const factMhGrid: PolicyFactV1 = {
  schemaVersion: 1,
  factId: "FACT#MH#COND#GRID",
  policyId: "POLICY#MH_MSEDCL",
  policyVersion: 1,
  category: "STATE_SUBSIDY",
  jurisdiction: "IN-MH",
  claimKey: benefitClauseClaimKeyV1("ELIGIBILITY", { kind: "GRID_CONNECTED", required: true, evidenceFactIds: ["FACT#MH#COND#GRID"] }),
  statement: "Grid-connected synchronization required with MSEDCL network",
  value: { kind: "TEXT", text: "Grid-connected synchronization required with MSEDCL network" },
  effectiveFrom: "2020-01-01",
  citation: buildPolicyCitation(BASELINE_SOURCE_MH, BASELINE_DOC_MH, { section: "Section 3" }),
  verificationStatus: "VERIFIED",
  lastVerifiedAt: CHECKED_AT,
  verifiedBy: "solarsaathi-policy-team",
  recordedAt: CHECKED_AT,
};

const factMhEdgeCentral: PolicyFactV1 = {
  schemaVersion: 1,
  factId: "FACT#MH#EDGE#PMSURYAGHAR",
  policyId: "POLICY#MH_MSEDCL",
  policyVersion: 1,
  category: "STATE_SUBSIDY",
  jurisdiction: "IN-MH",
  claimKey: benefitClauseClaimKeyV1("COMPATIBILITY", { withBenefitId: "BENEFIT#PMSURYAGHAR_CFA", mode: "ADDITIVE", evidenceFactIds: ["FACT#MH#EDGE#PMSURYAGHAR"] }),
  statement: "MSEDCL grid connection and net metering stack additively with PM Surya Ghar Central CFA",
  value: { kind: "TEXT", text: "MSEDCL grid connection and net metering stack additively with PM Surya Ghar Central CFA" },
  effectiveFrom: "2020-01-01",
  citation: buildPolicyCitation(BASELINE_SOURCE_MH, BASELINE_DOC_MH, { section: "Section 5" }),
  verificationStatus: "VERIFIED",
  lastVerifiedAt: CHECKED_AT,
  verifiedBy: "solarsaathi-policy-team",
  recordedAt: CHECKED_AT,
};

// 6. Policy Versions
export const BASELINE_VERSION_IN: PolicyVersionV1 = {
  schemaVersion: 1,
  policyId: "POLICY#PMSURYAGHAR",
  version: 1,
  category: "CENTRAL_SUBSIDY",
  jurisdiction: "IN",
  status: "ACTIVE",
  verificationStatus: "VERIFIED",
  effectiveFrom: "2024-02-15",
  factIds: [
    factCentralTier1.factId,
    factCentralTier1Bound.factId,
    factCentralTier2.factId,
    factCentralTier2Bound.factId,
    factCentralCap.factId,
    factCentralCustomer.factId,
    factCentralGrid.factId,
    factCentralEdgeMh.factId,
  ],
  documentRefs: [
    {
      sourceId: BASELINE_SOURCE_IN.sourceId,
      documentId: BASELINE_DOC_IN.documentId,
      documentVersion: 1,
      sha256: BASELINE_DOC_IN.sha256,
    },
  ],
  contentHash: "a".repeat(64),
  createdAt: CHECKED_AT,
  createdBy: "solarsaathi-author",
  lastVerifiedAt: CHECKED_AT,
  verifiedBy: "solarsaathi-policy-team",
  approvedAt: CHECKED_AT,
  approvedBy: "solarsaathi-reviewer",
  activatedAt: CHECKED_AT,
};

export const BASELINE_VERSION_MH: PolicyVersionV1 = {
  schemaVersion: 1,
  policyId: "POLICY#MH_MSEDCL",
  version: 1,
  category: "STATE_SUBSIDY",
  jurisdiction: "IN-MH",
  status: "ACTIVE",
  verificationStatus: "VERIFIED",
  effectiveFrom: "2020-01-01",
  factIds: [
    factMhFixedZero.factId,
    factMhCustomer.factId,
    factMhGrid.factId,
    factMhEdgeCentral.factId,
  ],
  documentRefs: [
    {
      sourceId: BASELINE_SOURCE_MH.sourceId,
      documentId: BASELINE_DOC_MH.documentId,
      documentVersion: 1,
      sha256: BASELINE_DOC_MH.sha256,
    },
  ],
  contentHash: "b".repeat(64),
  createdAt: CHECKED_AT,
  createdBy: "solarsaathi-author",
  lastVerifiedAt: CHECKED_AT,
  verifiedBy: "solarsaathi-policy-team",
  approvedAt: CHECKED_AT,
  approvedBy: "solarsaathi-reviewer",
  activatedAt: CHECKED_AT,
};

// 7. Policy Benefit Rules
export const BASELINE_RULE_IN: PolicyBenefitRuleV1 = {
  schemaVersion: 1,
  ruleId: "RULE#PMSURYAGHAR_CFA_V1",
  benefitId: "BENEFIT#PMSURYAGHAR_CFA",
  policyId: "POLICY#PMSURYAGHAR",
  policyVersion: 1,
  scope: "CENTRAL",
  jurisdiction: "IN",
  effectiveFrom: "2024-02-15",
  amount: {
    kind: "TIERED_KW",
    tiers: [
      { upToWatts: 2000, ratePaisePerKw: 3000000 },
      { upToWatts: 3000, ratePaisePerKw: 1800000 },
    ],
  },
  capPaise: 7800000,
  factIds: [
    factCentralTier1.factId,
    factCentralTier1Bound.factId,
    factCentralTier2.factId,
    factCentralTier2Bound.factId,
    factCentralCap.factId,
    factCentralCustomer.factId,
    factCentralGrid.factId,
    factCentralEdgeMh.factId,
  ],
  eligibility: {
    allOf: [
      { kind: "CUSTOMER_TYPE", oneOf: ["RESIDENTIAL"], evidenceFactIds: [factCentralCustomer.factId] },
      { kind: "GRID_CONNECTED", required: true, evidenceFactIds: [factCentralGrid.factId] },
    ],
    anyOf: [],
  },
  compatibility: [
    { withBenefitId: "BENEFIT#MH_MSEDCL_NETMETERING", mode: "ADDITIVE", evidenceFactIds: [factCentralEdgeMh.factId] },
  ],
};

export const BASELINE_RULE_MH: PolicyBenefitRuleV1 = {
  schemaVersion: 1,
  ruleId: "RULE#MH_MSEDCL_NETMETERING_V1",
  benefitId: "BENEFIT#MH_MSEDCL_NETMETERING",
  policyId: "POLICY#MH_MSEDCL",
  policyVersion: 1,
  scope: "STATE",
  jurisdiction: "IN-MH",
  effectiveFrom: "2020-01-01",
  amount: { kind: "FIXED", amountPaise: 0 },
  factIds: [
    factMhFixedZero.factId,
    factMhCustomer.factId,
    factMhGrid.factId,
    factMhEdgeCentral.factId,
  ],
  eligibility: {
    allOf: [
      { kind: "CUSTOMER_TYPE", oneOf: ["RESIDENTIAL"], evidenceFactIds: [factMhCustomer.factId] },
      { kind: "GRID_CONNECTED", required: true, evidenceFactIds: [factMhGrid.factId] },
    ],
    anyOf: [],
  },
  compatibility: [
    { withBenefitId: "BENEFIT#PMSURYAGHAR_CFA", mode: "ADDITIVE", evidenceFactIds: [factMhEdgeCentral.factId] },
  ],
};

// 8. Active Bundles
export const BASELINE_BUNDLE_IN: ActivePolicyBundleV1 = {
  schemaVersion: 1,
  policyId: BASELINE_VERSION_IN.policyId,
  benefitId: BASELINE_RULE_IN.benefitId,
  version: BASELINE_VERSION_IN,
  facts: [
    factCentralTier1,
    factCentralTier1Bound,
    factCentralTier2,
    factCentralTier2Bound,
    factCentralCap,
    factCentralCustomer,
    factCentralGrid,
    factCentralEdgeMh,
  ],
  rule: BASELINE_RULE_IN,
  activatedAt: CHECKED_AT,
};

export const BASELINE_BUNDLE_MH: ActivePolicyBundleV1 = {
  schemaVersion: 1,
  policyId: BASELINE_VERSION_MH.policyId,
  benefitId: BASELINE_RULE_MH.benefitId,
  version: BASELINE_VERSION_MH,
  facts: [
    factMhFixedZero,
    factMhCustomer,
    factMhGrid,
    factMhEdgeCentral,
  ],
  rule: BASELINE_RULE_MH,
  activatedAt: CHECKED_AT,
};

export const BASELINE_POLICY_BUNDLES: readonly ActivePolicyBundleV1[] = Object.freeze([
  BASELINE_BUNDLE_IN,
  BASELINE_BUNDLE_MH,
]);

export const BASELINE_POLICY_SOURCES = new Map<string, PolicySourceV1>([
  [BASELINE_SOURCE_IN.sourceId, BASELINE_SOURCE_IN],
  [BASELINE_SOURCE_MH.sourceId, BASELINE_SOURCE_MH],
]);

export const BASELINE_POLICY_DOCUMENTS = new Map<string, PolicyDocumentV1>([
  [`${BASELINE_SOURCE_IN.sourceId}:${BASELINE_DOC_IN.documentId}:1`, BASELINE_DOC_IN],
  [`${BASELINE_SOURCE_MH.sourceId}:${BASELINE_DOC_MH.documentId}:1`, BASELINE_DOC_MH],
]);

export const BASELINE_CRAWL_STATES = new Map<string, BaselinePolicyState>([
  [BASELINE_SOURCE_IN.sourceId, {
    sourceId: BASELINE_SOURCE_IN.sourceId,
    revision: 1,
    status: "READY",
    nextDueAtEpochSeconds: 2147483647,
    lastCheckedAt: new Date().toISOString(),
    lastDocumentId: BASELINE_DOC_IN.documentId,
    lastDocumentVersion: 1,
    lastObservedSha256: BASELINE_DOC_IN.sha256,
    failureCount: 0,
  }],
  [BASELINE_SOURCE_MH.sourceId, {
    sourceId: BASELINE_SOURCE_MH.sourceId,
    revision: 1,
    status: "READY",
    nextDueAtEpochSeconds: 2147483647,
    lastCheckedAt: new Date().toISOString(),
    lastDocumentId: BASELINE_DOC_MH.documentId,
    lastDocumentVersion: 1,
    lastObservedSha256: BASELINE_DOC_MH.sha256,
    failureCount: 0,
  }],
]);

/**
 * Returns the verified active baseline bundles matching any of the requested jurisdictions.
 */
export function getBaselineActiveBundles(jurisdictions: readonly string[]): ActivePolicyBundleV1[] {
  return BASELINE_POLICY_BUNDLES.filter(bundle => jurisdictions.includes(bundle.rule.jurisdiction));
}

export interface EvaluateBaselineInput {
  at?: Date;
  context: BenefitEvaluationContextV1;
}

/**
 * Deterministically evaluates the verified baseline policy catalog for India and states.
 */
export function evaluateBaselineBenefitsV1(input: EvaluateBaselineInput): BenefitStackResultV1 {
  const at = input.at ?? new Date();
  const atIso = at.toISOString();
  const country = input.context.country ?? "IN";
  const jurisdictions: string[] = [country];
  if (input.context.state) jurisdictions.push(`${country}-${input.context.state}`);
  if (input.context.state && input.context.district) jurisdictions.push(`${jurisdictions.at(-1)}-${input.context.district}`);
  if (input.context.state && input.context.district && input.context.localBody) jurisdictions.push(`${jurisdictions.at(-1)}-${input.context.localBody}`);

  const bundles = getBaselineActiveBundles(jurisdictions);
  const evidence: PolicyEvidenceV1[] = [];
  const sourceHealth: PolicySourceHealthV1[] = [];
  const visitedSources = new Set<string>();

  for (const bundle of bundles) {
    const sourceId = bundle.facts[0]?.citation.sourceId;
    if (!sourceId) continue;
    const source = BASELINE_POLICY_SOURCES.get(sourceId);
    if (!source) continue;
    const docId = bundle.facts[0]?.citation.documentId;
    const doc = BASELINE_POLICY_DOCUMENTS.get(`${sourceId}:${docId}:1`);
    if (!doc) continue;

    for (const fact of bundle.facts) {
      evidence.push({
        source,
        document: doc,
        version: bundle.version,
        fact,
      });
    }

    if (!visitedSources.has(sourceId)) {
      visitedSources.add(sourceId);
      sourceHealth.push({
        sourceId,
        lastCheckedAt: atIso,
        status: "HEALTHY",
      });
    }
  }

  const coverage: BenefitCoverageV1 = {
    central: true,
    state: Boolean(input.context.state),
    discom: false,
    local: false,
    other: false,
    verifiedAt: atIso,
  };

  return evaluateBenefitStackV1({
    at,
    context: input.context,
    rules: bundles.map(b => b.rule),
    evidence,
    sourceHealth,
    coverage,
  });
}
