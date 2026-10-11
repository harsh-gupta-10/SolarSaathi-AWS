import { describe, expect, it } from "vitest";
import { classifyPartition, classifyPolicyItem, fabricationReasons, unmarshal, type Plain } from "./policy-seed-fingerprint";

const EMPTY = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const seeded = (): Record<string, Plain> => ({ PK: "PUBLISHED_POLICY#POLICY#X", SK: "VERSION#00000001", entityType: "POLICY_PUBLISHED_VERSION",
  value: { version: { verifiedBy: "solarsaathi-policy-team", contentHash: "a".repeat(64) },
    facts: [{ citation: { documentSha256: EMPTY } }] } });

describe("fabricated policy seed fingerprint", () => {
  it("flags records with several independent placeholder fingerprints", () => {
    expect(classifyPolicyItem(seeded())).toBe("FABRICATED_SEED");
    expect(fabricationReasons(seeded())).toEqual(expect.arrayContaining([
      "document hash is the SHA-256 of an empty file", "content hash is a repeated placeholder", 'placeholder actor "solarsaathi-policy-team"']));
  });
  it("keeps real-looking records, including one with a single odd field", () => {
    expect(classifyPolicyItem({ PK: "PUBLISHED_POLICY#POLICY#REAL", SK: "VERSION#00000001",
      value: { version: { verifiedBy: "admin-2", contentHash: "3f".repeat(32) }, facts: [{ citation: { documentSha256: "9c".repeat(32) } }] } })).toBe("KEEP");
    expect(classifyPolicyItem({ PK: "PUBLISHED_POLICY#POLICY#ONE", value: { verifiedBy: "solarsaathi-reviewer" } })).toBe("KEEP");
  });
  it("never touches records outside the policy publication and source partitions", () => {
    expect(classifyPolicyItem({ ...seeded(), PK: "POLICY_CRAWLER_RUNS#2026" })).toBe("KEEP");
    expect(classifyPolicyItem({ ...seeded(), PK: "USER#1" })).toBe("KEEP");
  });
  it("judges a seeded source by the combined evidence of its partition rows", () => {
    const rows: Record<string, Plain>[] = [
      { PK: "SOURCE#SRC#1", SK: "CURRENT", value: { curatorId: "solarsaathi-curator" } },
      { PK: "SOURCE#SRC#1", SK: "DOCUMENT#D#VERSION#1", value: { sha256: EMPTY } },
    ];
    expect(rows.map(classifyPolicyItem)).toEqual(["KEEP", "KEEP"]);
    expect(classifyPartition(rows)).toBe("FABRICATED_SEED");
    expect(classifyPartition([rows[0]!])).toBe("KEEP");
    expect(classifyPartition([{ PK: "SOURCE#SRC#2", SK: "CURRENT", value: { curatorId: "real-admin" } },
      { PK: "SOURCE#SRC#2", SK: "DOCUMENT", value: { sha256: "9c".repeat(32) } }])).toBe("KEEP");
  });
  it("reads AWS CLI DynamoDB JSON", () => {
    expect(unmarshal({ M: { a: { S: "x" }, b: { L: [{ N: "2" }, { BOOL: true }] } } })).toEqual({ a: "x", b: [2, true] });
  });
});
