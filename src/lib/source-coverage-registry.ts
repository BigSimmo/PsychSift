import { z } from "zod";

const nonEmptyString = z.string().trim().min(1);

const expectedSourceCoverageRecordSchema = z
  .object({
    key: nonEmptyString,
    owner: nonEmptyString,
    reviewStatus: z.enum(["active", "absent", "not_approved", "retired"]),
    expectedDocumentIds: z.array(nonEmptyString),
    mustPassCaseIds: z.array(nonEmptyString),
  })
  .strict()
  .superRefine((record, context) => {
    if (new Set(record.expectedDocumentIds).size !== record.expectedDocumentIds.length) {
      context.addIssue({ code: "custom", message: "duplicate expected document ID", path: ["expectedDocumentIds"] });
    }
    if (new Set(record.mustPassCaseIds).size !== record.mustPassCaseIds.length) {
      context.addIssue({ code: "custom", message: "duplicate must-pass case ID", path: ["mustPassCaseIds"] });
    }
  });

const expectedSourceCoverageRegistrySchema = z
  .object({
    schemaVersion: z.literal(1),
    coverageVersion: nonEmptyString,
    records: z.array(expectedSourceCoverageRecordSchema),
  })
  .strict()
  .superRefine((registry, context) => {
    const keys = new Set<string>();
    for (const [index, record] of registry.records.entries()) {
      if (keys.has(record.key)) {
        context.addIssue({ code: "custom", message: "duplicate source coverage key", path: ["records", index, "key"] });
      }
      keys.add(record.key);
    }
  });

export type ExpectedSourceCoverageRecord = Readonly<{
  key: string;
  owner: string;
  reviewStatus: "active" | "absent" | "not_approved" | "retired";
  expectedDocumentIds: readonly string[];
  mustPassCaseIds: readonly string[];
}>;

export type ExpectedSourceCoverageRegistry = Readonly<{
  schemaVersion: 1;
  coverageVersion: string;
  records: readonly ExpectedSourceCoverageRecord[];
}>;

export type SourceCoverageFinding = Readonly<{
  key: string;
  outcome: "available" | "not_in_corpus" | "retrieval_miss" | "not_approved" | "retired";
  owner: string;
  mustPassCaseIds: readonly string[];
}>;

export function parseExpectedSourceCoverageRegistry(input: unknown): ExpectedSourceCoverageRegistry {
  return expectedSourceCoverageRegistrySchema.parse(input);
}

function intersects(left: readonly string[], right: ReadonlySet<string>) {
  return left.some((value) => right.has(value));
}

export function auditExpectedSourceCoverage(args: {
  expected: readonly ExpectedSourceCoverageRecord[];
  activeDocumentIds: ReadonlySet<string>;
  retrievedDocumentIdsByCase: ReadonlyMap<string, ReadonlySet<string>>;
}): readonly SourceCoverageFinding[] {
  const findings = args.expected
    .toSorted((left, right) => left.key.localeCompare(right.key))
    .map((record): SourceCoverageFinding => {
      let outcome: SourceCoverageFinding["outcome"];
      if (record.reviewStatus === "not_approved") {
        outcome = "not_approved";
      } else if (record.reviewStatus === "retired") {
        outcome = "retired";
      } else if (
        record.reviewStatus === "absent" ||
        record.expectedDocumentIds.length === 0 ||
        !intersects(record.expectedDocumentIds, args.activeDocumentIds)
      ) {
        outcome = "not_in_corpus";
      } else {
        const hasRetrievalMiss = record.mustPassCaseIds.some((caseId) => {
          const retrieved = args.retrievedDocumentIdsByCase.get(caseId) ?? new Set<string>();
          return !intersects(record.expectedDocumentIds, retrieved);
        });
        outcome = hasRetrievalMiss ? "retrieval_miss" : "available";
      }

      return Object.freeze({
        key: record.key,
        outcome,
        owner: record.owner,
        mustPassCaseIds: Object.freeze([...record.mustPassCaseIds].sort()),
      });
    });

  return Object.freeze(findings);
}
