import { describe, expect, it } from "vitest";

import {
  auditExpectedSourceCoverage,
  parseExpectedSourceCoverageRegistry,
  type ExpectedSourceCoverageRecord,
} from "@/lib/source-coverage-registry";

function expectedCoverageFixture(): ExpectedSourceCoverageRecord[] {
  return [
    {
      key: "current-guideline",
      owner: "Clinical governance",
      reviewStatus: "active",
      expectedDocumentIds: ["expected-doc"],
      mustPassCaseIds: ["must-pass-1"],
    },
  ];
}

describe("expected source coverage registry", () => {
  it("distinguishes an absent source from a retrieval miss", () => {
    const expected = expectedCoverageFixture();
    expect(
      auditExpectedSourceCoverage({
        expected,
        activeDocumentIds: new Set(),
        retrievedDocumentIdsByCase: new Map(),
      }),
    ).toContainEqual(expect.objectContaining({ outcome: "not_in_corpus" }));
    expect(
      auditExpectedSourceCoverage({
        expected,
        activeDocumentIds: new Set(["expected-doc"]),
        retrievedDocumentIdsByCase: new Map([["must-pass-1", new Set()]]),
      }),
    ).toContainEqual(expect.objectContaining({ outcome: "retrieval_miss" }));
  });

  it("reports available, not-approved, and retired coverage without recommending index work", () => {
    const expected: ExpectedSourceCoverageRecord[] = [
      ...expectedCoverageFixture(),
      {
        key: "not-approved-source",
        owner: "Source governance",
        reviewStatus: "not_approved",
        expectedDocumentIds: [],
        mustPassCaseIds: [],
      },
      {
        key: "retired-source",
        owner: "Source governance",
        reviewStatus: "retired",
        expectedDocumentIds: ["retired-doc"],
        mustPassCaseIds: [],
      },
    ];

    expect(
      auditExpectedSourceCoverage({
        expected,
        activeDocumentIds: new Set(["expected-doc"]),
        retrievedDocumentIdsByCase: new Map([["must-pass-1", new Set(["expected-doc"])]]),
      }),
    ).toEqual([
      {
        key: "current-guideline",
        outcome: "available",
        owner: "Clinical governance",
        mustPassCaseIds: ["must-pass-1"],
      },
      {
        key: "not-approved-source",
        outcome: "not_approved",
        owner: "Source governance",
        mustPassCaseIds: [],
      },
      {
        key: "retired-source",
        outcome: "retired",
        owner: "Source governance",
        mustPassCaseIds: [],
      },
    ]);
  });

  it("validates accountability, review state, unique keys, and unique case mappings", () => {
    const valid = {
      schemaVersion: 1,
      coverageVersion: "rag-expected-source-coverage-v1",
      records: expectedCoverageFixture(),
    };

    expect(parseExpectedSourceCoverageRegistry(valid)).toEqual(valid);
    expect(() =>
      parseExpectedSourceCoverageRegistry({ ...valid, records: [...valid.records, ...valid.records] }),
    ).toThrow(/duplicate.*key/i);
    expect(() =>
      parseExpectedSourceCoverageRegistry({
        ...valid,
        records: [{ ...valid.records[0], owner: "" }],
      }),
    ).toThrow(/owner/i);
    expect(() =>
      parseExpectedSourceCoverageRegistry({
        ...valid,
        records: [{ ...valid.records[0], mustPassCaseIds: ["must-pass-1", "must-pass-1"] }],
      }),
    ).toThrow(/duplicate.*case/i);
  });

  it("returns sorted immutable findings regardless of registry input order", () => {
    const expected = [
      ...expectedCoverageFixture(),
      {
        key: "absent-source",
        owner: "Clinical governance",
        reviewStatus: "absent" as const,
        expectedDocumentIds: [],
        mustPassCaseIds: ["must-pass-2"],
      },
    ].reverse();

    const findings = auditExpectedSourceCoverage({
      expected,
      activeDocumentIds: new Set(["expected-doc"]),
      retrievedDocumentIdsByCase: new Map([["must-pass-1", new Set(["expected-doc"])]]),
    });
    expect(findings.map((finding) => finding.key)).toEqual(["absent-source", "current-guideline"]);
    expect(findings[0]).toMatchObject({ outcome: "not_in_corpus", mustPassCaseIds: ["must-pass-2"] });
    expect(Object.isFrozen(findings)).toBe(true);
    expect(Object.isFrozen(findings[0])).toBe(true);
  });
});
