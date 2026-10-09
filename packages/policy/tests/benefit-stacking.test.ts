import { describe, expect, it } from "vitest";
import { benefitClauseClaimKeyV1, buildPolicyCitation, evaluateBenefitStackV1, policyBenefitRuleSchema,
  type BenefitStackInputV1, type PolicyBenefitRuleV1, type PolicyEvidenceV1,
  type PolicySourceV1, type PolicyDocumentV1, type PolicyFactV1, type PolicyVersionV1 } from "../src";

const NOW = new Date("2026-10-08T12:00:00.000Z");
const checkedAt = "2026-10-08T10:00:00.000Z";
const source: PolicySourceV1 = {
  schemaVersion: 1, sourceId: "SRC#SYNTHETIC", registryVersion: 2, name: "Synthetic official source",
  publisherName: "Synthetic ministry", jurisdiction: "IN", sourceType: "MNRE", authorityTier: 1,
  registryStatus: "CURATED", healthStatus: "UNKNOWN", canonicalUrl: "https://mnre.gov.in/synthetic",
  allowedHosts: ["mnre.gov.in"], crawlFrequency: "DAILY", enabled: true,
  freshnessWindowHours: 48, curatedAt: checkedAt, curatorId: "curator-fixture",
  createdAt: checkedAt, updatedAt: checkedAt,
};

function rule(name: string, amountPaise: number, changed: Partial<PolicyBenefitRuleV1> = {}): PolicyBenefitRuleV1 {
  return { schemaVersion: 1, ruleId: `RULE#${name}`, benefitId: `BENEFIT#${name}`,
    policyId: `POLICY#${name}`, policyVersion: 1, factIds: [`FACT#${name}`], scope: "CENTRAL",
    jurisdiction: "IN", effectiveFrom: "2026-01-01", amount: { kind: "FIXED", amountPaise },
    eligibility: { allOf: [], anyOf: [] }, compatibility: [], ...changed };
}

function evidenceFor(benefit: PolicyBenefitRuleV1): PolicyEvidenceV1[] {
  const claims = new Map<string, string>();
  for (const condition of [...benefit.eligibility.allOf, ...benefit.eligibility.anyOf.flat(),
    ...benefit.compatibility.flatMap(edge => edge.conditions ?? [])]) {
    for (const id of condition.evidenceFactIds) claims.set(id, benefitClauseClaimKeyV1("ELIGIBILITY", condition));
  }
  for (const edge of benefit.compatibility) {
    for (const id of edge.evidenceFactIds) claims.set(id, benefitClauseClaimKeyV1("COMPATIBILITY", edge));
  }
  for (const id of benefit.sizeEvidenceFactIds ?? []) claims.set(id, benefitClauseClaimKeyV1("SIZE", benefit));
  for (const id of benefit.overlapEvidenceFactIds ?? []) claims.set(id, benefitClauseClaimKeyV1("OVERLAP", benefit));
  for (const step of benefit.processSteps ?? []) {
    for (const id of step.evidenceFactIds) claims.set(id, benefitClauseClaimKeyV1("PROCESS_STEP", step));
  }
  const document: PolicyDocumentV1 = { schemaVersion: 1, documentId: `DOC#${benefit.ruleId.slice(5)}`,
    sourceId: source.sourceId, sourceRegistryVersion: source.registryVersion, version: 1,
    title: "Synthetic fixture notice", documentType: "GUIDELINE", mimeType: "text/html",
    canonicalUrl: source.canonicalUrl, sha256: "a".repeat(64), retrievedAt: checkedAt };
  const value = benefit.amount.kind === "FIXED" ? benefit.amount.amountPaise / 100 : 0;
  const facts: PolicyFactV1[] = benefit.factIds.map((factId, index) => ({ schemaVersion: 1, factId, policyId: benefit.policyId,
    policyVersion: benefit.policyVersion, category: "CENTRAL_SUBSIDY", jurisdiction: "IN",
    claimKey: claims.get(factId) ?? `synthetic.${benefit.ruleId.slice(5).toLowerCase()}.${index}`,
    value: index === 0 ? { kind: "NUMBER", amount: value, unit: "INR" } :
      factId.endsWith("#CAP") ? { kind: "NUMBER", amount: (benefit.combinedCapPaise ?? 0) / 100,
        unit: "INR" } : { kind: "TEXT", text: "Synthetic verified clause text for this test fixture." },
    statement: index === 0 || factId.endsWith("#CAP") ? `Synthetic fixture amount INR ${value}` :
      "Synthetic verified clause text for this test fixture.",
    effectiveFrom: "2026-01-01",
    citation: buildPolicyCitation(source, document, { section: "Fixture statement" }),
    verificationStatus: "VERIFIED", lastVerifiedAt: checkedAt, verifiedBy: "independent-fixture",
    recordedAt: checkedAt }));
  const version: PolicyVersionV1 = { schemaVersion: 1, policyId: benefit.policyId, version: 1,
    category: "CENTRAL_SUBSIDY", jurisdiction: "IN", status: "ACTIVE", verificationStatus: "VERIFIED",
    effectiveFrom: "2026-01-01", factIds: facts.map(fact => fact.factId), documentRefs: [{ sourceId: source.sourceId,
      documentId: document.documentId, documentVersion: document.version, sha256: document.sha256 }],
    contentHash: "b".repeat(64), createdAt: checkedAt, createdBy: "fixture-author",
    lastVerifiedAt: checkedAt, verifiedBy: "independent-fixture", approvedAt: checkedAt,
    approvedBy: "independent-fixture", activatedAt: checkedAt };
  return facts.map(fact => ({ source, document, version, fact }));
}

function input(rules: PolicyBenefitRuleV1[], changed: Partial<BenefitStackInputV1> = {}): BenefitStackInputV1 {
  return { at: NOW, context: { systemWatts: 2_000, country: "IN" }, rules,
    evidence: rules.flatMap(evidenceFor), sourceHealth: [{ sourceId: source.sourceId,
      status: "HEALTHY", lastCheckedAt: checkedAt }],
    coverage: { central: false, state: false, discom: false, local: false, other: false }, ...changed };
}

function pair(a: PolicyBenefitRuleV1, b: PolicyBenefitRuleV1, mode: PolicyBenefitRuleV1["compatibility"][number]["mode"]):
  [PolicyBenefitRuleV1, PolicyBenefitRuleV1] {
  const aFact = `FACT#${a.ruleId.slice(5)}#EDGE#${b.ruleId.slice(5)}`;
  const bFact = `FACT#${b.ruleId.slice(5)}#EDGE#${a.ruleId.slice(5)}`;
  return [{ ...a, factIds: [...a.factIds, aFact],
    compatibility: [{ withBenefitId: b.benefitId, mode, evidenceFactIds: [aFact] }] },
  { ...b, factIds: [...b.factIds, bFact],
    compatibility: [{ withBenefitId: a.benefitId, mode, evidenceFactIds: [bFact] }] }];
}

describe("verified deterministic benefit stack", () => {
  it("returns zero and incomplete coverage when no verified rule exists", () => {
    const result = evaluateBenefitStackV1(input([]));
    expect(result).toMatchObject({ totalEligibleBenefitPaise: 0, decisions: [],
      coverageComplete: false, warnings: ["NO_VERIFIED_RULES", "POLICY_COVERAGE_UNVERIFIED"] });
  });

  it("uses current successful crawl state, echoes last check, and blocks stale or missing checks", () => {
    const base = input([rule("A", 10_000)]);
    const current = evaluateBenefitStackV1(base);
    expect(current.decisions[0]).toMatchObject({ status: "SELECTED", countedAmountPaise: 10_000,
      sourceChecks: [{ sourceId: source.sourceId, lastCheckedAt: checkedAt, fresh: true, status: "HEALTHY" }] });
    for (const status of ["FAILED", "DEGRADED"] as const) {
      const failed = evaluateBenefitStackV1({ ...base, sourceHealth: [{ sourceId: source.sourceId, status,
        lastCheckedAt: checkedAt }] });
      expect(failed).toMatchObject({ totalEligibleBenefitPaise: 0,
        coverageComplete: false, decisions: [{ status: "UNKNOWN", reasonCodes: ["SOURCE_STALE_OR_UNCHECKED"],
          sourceChecks: [{ fresh: false, status }] }],
        warnings: expect.arrayContaining(["SOURCE_CHECK_DEGRADED", "POLICY_COVERAGE_UNVERIFIED"]) });
      expect(failed.decisions[0]).not.toHaveProperty("calculatedAmountPaise");
    }
    for (const health of [[], [{ sourceId: source.sourceId, status: "STALE" as const,
      lastCheckedAt: checkedAt }], [{ sourceId: source.sourceId, status: "HEALTHY" as const,
      lastCheckedAt: "2026-10-01T00:00:00.000Z" }]]) {
      expect(evaluateBenefitStackV1({ ...base, sourceHealth: health })).toMatchObject({
        totalEligibleBenefitPaise: 0, decisions: [{ status: "UNKNOWN",
          reasonCodes: ["SOURCE_STALE_OR_UNCHECKED"] }] });
    }
  });

  it("omits a failed source's numeric amount when another healthy rule keeps the response available", () => {
    const healthy = rule("HEALTHY", 10_000), failed = rule("FAILED", 25_000);
    const base = input([healthy, failed]);
    const otherSource: PolicySourceV1 = { ...source, sourceId: "SRC#SYNTHETIC_OTHER",
      name: "Synthetic portal source", publisherName: "Synthetic portal",
      sourceType: "SCHEME_PORTAL", canonicalUrl: "https://solarrooftop.pmsuryaghar.gov.in/",
      allowedHosts: ["solarrooftop.pmsuryaghar.gov.in"] };
    const evidence = base.evidence.map(item => {
      if (item.fact.policyId !== failed.policyId) return item;
      const document = { ...item.document, sourceId: otherSource.sourceId,
        canonicalUrl: otherSource.canonicalUrl };
      return { ...item, source: otherSource, document,
        version: { ...item.version, documentRefs: item.version.documentRefs.map(ref => ({ ...ref,
          sourceId: otherSource.sourceId })) },
        fact: { ...item.fact, citation: buildPolicyCitation(otherSource, document,
          item.fact.citation.locator) } };
    });
    const result = evaluateBenefitStackV1({ ...base, evidence, sourceHealth: [
      { sourceId: source.sourceId, status: "HEALTHY", lastCheckedAt: checkedAt },
      { sourceId: otherSource.sourceId, status: "FAILED", lastCheckedAt: checkedAt },
    ] });
    expect(result.totalEligibleBenefitPaise).toBe(10_000);
    expect(result.decisions[0]).toMatchObject({ status: "UNKNOWN",
      reasonCodes: ["SOURCE_STALE_OR_UNCHECKED"], sourceChecks: [{ fresh: false, status: "FAILED" }] });
    expect(result.decisions[0]).not.toHaveProperty("calculatedAmountPaise");
    expect(result.decisions[1]).toMatchObject({ status: "SELECTED", countedAmountPaise: 10_000 });
    expect(result.warnings).toContain("SOURCE_CHECK_DEGRADED");
  });

  it("requires affirmative compatibility in both rules and respects explicit combined caps", () => {
    const a = rule("A", 30_000), b = rule("B", 25_000);
    expect(evaluateBenefitStackV1(input([a, b])).totalEligibleBenefitPaise).toBe(30_000);
    const [addA, addB] = pair(a, b, "ADDITIVE");
    expect(evaluateBenefitStackV1(input([addA, addB])).totalEligibleBenefitPaise).toBe(55_000);
    const [capA, capB] = pair({ ...a, factIds: [...a.factIds, "FACT#A#CAP"],
      combinedCapGroupId: "PAIR", combinedCapPaise: 40_000 },
    { ...b, factIds: [...b.factIds, "FACT#B#CAP"],
      combinedCapGroupId: "PAIR", combinedCapPaise: 40_000 }, "CAPPED_COMBINED");
    const capped = evaluateBenefitStackV1(input([capA, capB]));
    expect(capped.totalEligibleBenefitPaise).toBe(40_000);
    expect(capped.decisions.map(value => value.countedAmountPaise)).toEqual([30_000, 10_000]);
    const [exclusiveA, exclusiveB] = pair(a, b, "MUTUALLY_EXCLUSIVE");
    expect(evaluateBenefitStackV1(input([exclusiveA, exclusiveB])).totalEligibleBenefitPaise).toBe(30_000);
  });

  it("rejects eligibility and stacking clauses without separately verified quoted text facts", () => {
    const a = rule("A", 10_000), b = rule("B", 10_000);
    expect(policyBenefitRuleSchema.safeParse({ ...a,
      eligibility: { allOf: [{ kind: "GRID_CONNECTED", required: true }], anyOf: [] } }).success).toBe(false);
    expect(policyBenefitRuleSchema.safeParse({ ...a,
      compatibility: [{ withBenefitId: b.benefitId, mode: "ADDITIVE" }] }).success).toBe(false);
    const [supportedA, supportedB] = pair(a, b, "ADDITIVE");
    const base = input([supportedA, supportedB]);
    expect(evaluateBenefitStackV1(base).totalEligibleBenefitPaise).toBe(20_000);
    expect(() => evaluateBenefitStackV1({ ...base,
      evidence: base.evidence.map(item => item.fact.factId === "FACT#A#EDGE#B" ?
        { ...item, fact: { ...item.fact, value: { kind: "NUMBER", amount: 100, unit: "INR" } } } : item) }))
      .toThrow(/quoted text evidence/i);
    expect(() => evaluateBenefitStackV1({ ...base,
      evidence: base.evidence.map(item => item.fact.factId === "FACT#A#EDGE#B" ?
        { ...item, fact: { ...item.fact, claimKey: "clause.compatibility.wrong" } } : item) }))
      .toThrow(/quoted text evidence/i);
    expect(() => evaluateBenefitStackV1({ ...base,
      evidence: base.evidence.filter(item => item.fact.factId !== "FACT#B#EDGE#A") }))
      .toThrow(/immutable evidence binding/i);
  });

  it("requires each published process step to bind to verified text in the same policy version", () => {
    const step = { stepId: "APPLICATION_SUBMITTED", order: 1,
      title: "Submit the application", description: "Submit the application through the official portal.",
      required: true, evidenceFactIds: ["FACT#PROCESS"] };
    const benefit = rule("PROCESS", 10_000, { factIds: ["FACT#PROCESS#AMOUNT", "FACT#PROCESS"],
      processSteps: [step] });
    expect(policyBenefitRuleSchema.safeParse(benefit).success).toBe(true);
    expect(policyBenefitRuleSchema.safeParse({ ...benefit,
      processSteps: [step, { ...step, evidenceFactIds: ["FACT#PROCESS"] }] }).success).toBe(false);
    const base = input([benefit]);
    expect(evaluateBenefitStackV1(base).decisions[0]?.status).toBe("SELECTED");
    expect(() => evaluateBenefitStackV1({ ...base, evidence: base.evidence.map(item =>
      item.fact.factId === "FACT#PROCESS" ? { ...item, fact: { ...item.fact,
        claimKey: "clause.process_step.wrong" } } : item) })).toThrow(/quoted text evidence/i);
  });

  it("evaluates alternative applicant routes as OR and missing facts as unknown", () => {
    const benefit = rule("A", 10_000, { factIds: ["FACT#A", "FACT#A#COND1", "FACT#A#COND2"],
      eligibility: { allOf: [], anyOf: [
      [{ kind: "CUSTOMER_TYPE", oneOf: ["RESIDENTIAL"], evidenceFactIds: ["FACT#A#COND1"] }],
      [{ kind: "PROPERTY_TYPE", oneOf: ["HOUSING_SOCIETY"], evidenceFactIds: ["FACT#A#COND2"] }],
    ] } });
    const base = input([benefit]);
    expect(evaluateBenefitStackV1({ ...base, context: { systemWatts: 2_000, country: "IN",
      customerType: "COMMERCIAL", propertyType: "HOUSING_SOCIETY" } }).totalEligibleBenefitPaise).toBe(10_000);
    expect(evaluateBenefitStackV1({ ...base, context: { systemWatts: 2_000, country: "IN",
      customerType: "COMMERCIAL" } }).decisions[0]?.status).toBe("UNKNOWN");
    expect(evaluateBenefitStackV1({ ...base, context: { systemWatts: 2_000, country: "IN",
      customerType: "COMMERCIAL", propertyType: "BUSINESS" } }).decisions[0]?.status).toBe("INELIGIBLE");
  });

  it("finds the best valid subset when a greedy highest-single choice loses", () => {
    const a = rule("A", 30_000), b = rule("B", 20_000), c = rule("C", 20_000);
    const edge = (from: string, to: string, mode: "ADDITIVE" | "MUTUALLY_EXCLUSIVE") => ({
      withBenefitId: `BENEFIT#${to}`, mode, evidenceFactIds: [`FACT#${from}#EDGE#${to}`],
    });
    const rules: PolicyBenefitRuleV1[] = [
      { ...a, factIds: [...a.factIds, "FACT#A#EDGE#B", "FACT#A#EDGE#C"],
        compatibility: [edge("A", "B", "MUTUALLY_EXCLUSIVE"), edge("A", "C", "MUTUALLY_EXCLUSIVE")] },
      { ...b, factIds: [...b.factIds, "FACT#B#EDGE#A", "FACT#B#EDGE#C"],
        compatibility: [edge("B", "A", "MUTUALLY_EXCLUSIVE"), edge("B", "C", "ADDITIVE")] },
      { ...c, factIds: [...c.factIds, "FACT#C#EDGE#A", "FACT#C#EDGE#B"],
        compatibility: [edge("C", "A", "MUTUALLY_EXCLUSIVE"), edge("C", "B", "ADDITIVE")] },
    ];
    const result = evaluateBenefitStackV1(input(rules));
    expect(result.totalEligibleBenefitPaise).toBe(40_000);
    expect(result.decisions.map(value => value.status)).toEqual(["EXCLUDED", "SELECTED", "SELECTED"]);
  });

  it("keeps the same capped optimum for every input order and rejects asymmetric compatibility", () => {
    const amounts = { A: 30_000, B: 25_000, C: 20_000 } as const;
    const names = ["A", "B", "C"] as const;
    const capped = names.map(name => {
      const edges = names.filter(other => other !== name).map(other => ({
        withBenefitId: `BENEFIT#${other}`, mode: "CAPPED_COMBINED" as const,
        evidenceFactIds: [`FACT#${name}#EDGE#${other}`],
      }));
      return rule(name, amounts[name], { factIds: [`FACT#${name}`, `FACT#${name}#CAP`,
        ...edges.flatMap(edge => edge.evidenceFactIds)], combinedCapGroupId: "SHARED",
      combinedCapPaise: 40_000, compatibility: edges });
    });
    for (const permutation of [[capped[0], capped[1], capped[2]], [capped[0], capped[2], capped[1]],
      [capped[1], capped[0], capped[2]], [capped[1], capped[2], capped[0]],
      [capped[2], capped[0], capped[1]], [capped[2], capped[1], capped[0]]]) {
      const result = evaluateBenefitStackV1(input(permutation as PolicyBenefitRuleV1[]));
      expect(result.totalEligibleBenefitPaise).toBe(40_000);
      expect(result.decisions.filter(item => item.status === "SELECTED")
        .map(item => [item.benefitId, item.countedAmountPaise])).toEqual([
        ["BENEFIT#A", 30_000], ["BENEFIT#B", 10_000],
      ]);
    }
    const [a, b] = pair(rule("ASYMA", 30_000), rule("ASYMB", 25_000), "ADDITIVE");
    const asymmetric = { ...b, compatibility: b.compatibility.map(edge => ({ ...edge,
      mode: "MUTUALLY_EXCLUSIVE" as const })) };
    const result = evaluateBenefitStackV1(input([a, asymmetric]));
    expect(result.totalEligibleBenefitPaise).toBe(30_000);
    expect(result.decisions.map(item => item.status)).toEqual(["SELECTED", "EXCLUDED"]);
  });

  it("uses BigInt intermediates and checked paise results", () => {
    const original = input([rule("A", 10_000)]);
    const perKw: PolicyBenefitRuleV1 = { ...original.rules[0]!,
      amount: { kind: "PER_KW", ratePaisePerKw: 101 } };
    const evidence = original.evidence.map(item => ({ ...item, fact: { ...item.fact,
      value: { kind: "NUMBER" as const, amount: 1.01, unit: "INR_PER_KW" as const } } }));
    expect(evaluateBenefitStackV1({ ...original, context: { systemWatts: 1_500, country: "IN" },
      rules: [perKw], evidence }).totalEligibleBenefitPaise).toBe(152);
    const overflowRule: PolicyBenefitRuleV1 = { ...perKw,
      amount: { kind: "PER_KW", ratePaisePerKw: 1_000_000_000_000 } };
    const overflowEvidence = original.evidence.map(item => ({ ...item, fact: { ...item.fact,
      value: { kind: "NUMBER" as const, amount: 10_000_000_000, unit: "INR_PER_KW" as const } } }));
    expect(() => evaluateBenefitStackV1({ ...original, context: { systemWatts: 100_000_000,
      country: "IN" }, rules: [overflowRule], evidence: overflowEvidence })).toThrow(/bounded integer-paise/i);
  });

  it("applies sourced tier thresholds and a percent only to an explicit eligible cost", () => {
    const tier = rule("TIER", 0, { factIds: ["FACT#TIER#A", "FACT#TIER#B",
      "FACT#TIER#C", "FACT#TIER#D"], amount: { kind: "TIERED_KW", tiers: [
        { upToWatts: 1_000, ratePaisePerKw: 10_000 },
        { upToWatts: 3_000, ratePaisePerKw: 5_000 },
      ] } });
    const base = input([tier]);
    const values = [
      { kind: "NUMBER" as const, unit: "KW" as const, amount: 1 },
      { kind: "NUMBER" as const, unit: "INR_PER_KW" as const, amount: 100 },
      { kind: "NUMBER" as const, unit: "KW" as const, amount: 3 },
      { kind: "NUMBER" as const, unit: "INR_PER_KW" as const, amount: 50 },
    ];
    const evidence = base.evidence.map((item, index) => ({ ...item,
      fact: { ...item.fact, value: values[index]! } }));
    expect(evaluateBenefitStackV1({ ...base, evidence }).totalEligibleBenefitPaise).toBe(15_000);
    const percent = rule("PERCENT", 0, { amount: { kind: "PERCENT_ELIGIBLE_COST", basisPoints: 1_000 } });
    const percentBase = input([percent]);
    const percentEvidence = percentBase.evidence.map(item => ({ ...item,
      fact: { ...item.fact, value: { kind: "NUMBER" as const, unit: "PERCENT" as const, amount: 10 } } }));
    expect(evaluateBenefitStackV1({ ...percentBase, evidence: percentEvidence }).decisions[0])
      .toMatchObject({ status: "UNKNOWN", reasonCodes: ["ELIGIBLE_COST_UNKNOWN"] });
    expect(evaluateBenefitStackV1({ ...percentBase, evidence: percentEvidence,
      context: { systemWatts: 2_000, country: "IN", eligibleQuotedCostPaise: 12_345 } })
      .totalEligibleBenefitPaise).toBe(1_235);
  });

  it("blocks outside effective periods and unbacked numeric values", () => {
    const a = rule("A", 10_000);
    expect(evaluateBenefitStackV1(input([{ ...a, effectiveFrom: "2026-10-09" }])).decisions[0])
      .toMatchObject({ status: "INELIGIBLE", reasonCodes: ["OUTSIDE_EFFECTIVE_PERIOD"] });
    const original = input([a]);
    expect(() => evaluateBenefitStackV1({ ...original,
      rules: [{ ...a, amount: { kind: "FIXED", amountPaise: 20_000 } }] })).toThrow(/numeric fact/i);
    const badEvidence = input([a]);
    expect(() => evaluateBenefitStackV1({ ...badEvidence, evidence: badEvidence.evidence.map(item => ({ ...item,
      fact: { ...item.fact, verificationStatus: "UNVERIFIED" } })) })).toThrow(/active verified/i);
  });

  it("uses the India civil day at the IST midnight boundary in both rule and evidence gates", () => {
    const benefit = rule("IST", 10_000, { effectiveFrom: "2026-10-09" });
    const base = input([benefit]);
    const evidence = base.evidence.map(item => ({ ...item,
      fact: { ...item.fact, effectiveFrom: "2026-10-09" },
      version: { ...item.version, effectiveFrom: "2026-10-09" } }));
    const sourceHealth = [{ sourceId: source.sourceId, status: "HEALTHY" as const,
      lastCheckedAt: "2026-10-08T18:20:00.000Z" }];
    expect(evaluateBenefitStackV1({ ...base, at: new Date("2026-10-08T18:29:00.000Z"),
      evidence, sourceHealth }).decisions[0]?.status).toBe("INELIGIBLE");
    expect(evaluateBenefitStackV1({ ...base, at: new Date("2026-10-08T18:30:00.000Z"),
      evidence, sourceHealth }).decisions[0]?.status).toBe("SELECTED");
  });

  it("leaves a zero-payout eligible rule outside the stack with an explicit reason", () => {
    const result = evaluateBenefitStackV1(input([rule("ZERO", 0)]));
    expect(result.totalEligibleBenefitPaise).toBe(0);
    expect(result.decisions[0]).toMatchObject({ status: "EXCLUDED",
      calculatedAmountPaise: 0, reasonCodes: ["ZERO_VALUE_NO_PAYOUT"] });
  });

  it("keeps deterministic ties and rejects unsafe oversized rules and invalid ranges", () => {
    const a = rule("A", 10_000), b = rule("B", 10_000);
    const result = evaluateBenefitStackV1(input([b, a]));
    expect(result.decisions.map(value => value.status)).toEqual(["SELECTED", "EXCLUDED"]);
    expect(policyBenefitRuleSchema.safeParse({ ...a, effectiveTo: "2025-01-01" }).success).toBe(false);
    expect(policyBenefitRuleSchema.safeParse({ ...a, eligibility: { allOf: [{ kind: "APPLICATION_DATE_RANGE",
      from: "2026-12-01", through: "2026-01-01", evidenceFactIds: ["FACT#A"] }], anyOf: [] } }).success).toBe(false);
    expect(() => evaluateBenefitStackV1(input(Array.from({ length: 17 }, (_, index) =>
      rule(`X${index}`, 10_000))))).toThrow(/bound exceeded/i);
  });
});
