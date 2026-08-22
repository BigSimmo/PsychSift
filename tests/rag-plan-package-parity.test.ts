import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { validateJsonSchema } from "../scripts/lib/json-schema-contract-validator.mjs";
import {
  acceptedHistoryAgentReuseErrors,
  acceptedHistoryContinuityErrors,
  acceptanceStatusErrors,
  agentReuseErrors,
  atomicMetadataCommitErrors,
  buildReviewPackageBytes,
  finalReviewRoutingErrors,
  packageIdentityErrors,
  phaseAcceptanceContinuityErrors,
  predecessorStartErrors,
  programmeFinalHeadErrors,
  p00AnchorErrors,
  programmeVerificationErrors,
  resumeStateErrors,
  reviewPackageEvidenceErrors,
  requiredResidualGateErrors,
  taskChainErrors,
  tddEvidenceErrors,
  trackedBytesErrors,
  verificationOnlyEvidenceErrors,
} from "../scripts/lib/rag-receipt-contracts.mjs";

const phaseSchema = JSON.parse(
  readFileSync("docs/superpowers/rag-upgrade/canonical/phase-receipt.schema.json", "utf8"),
);
const phaseTemplate = JSON.parse(
  readFileSync("docs/superpowers/rag-upgrade/canonical/phase-receipt.template.json", "utf8"),
);
const programmeSchema = JSON.parse(
  readFileSync("docs/superpowers/rag-upgrade/canonical/programme-receipt.schema.json", "utf8"),
);
const programmeTemplate = JSON.parse(
  readFileSync("docs/superpowers/rag-upgrade/canonical/programme-receipt.template.json", "utf8"),
);

describe("RAG plan execution packages", () => {
  it("keeps Local and Cloud task bodies identical and executable", () => {
    expect(() =>
      execFileSync(process.execPath, ["scripts/build-rag-plan-packages.mjs", "--check", "--require-origin-main"], {
        cwd: process.cwd(),
        encoding: "utf8",
        stdio: "pipe",
      }),
    ).not.toThrow();
  });

  it("ships a valid resumable phase-receipt contract", () => {
    expect(() =>
      execFileSync(process.execPath, ["scripts/check-rag-phase-receipts.mjs"], {
        cwd: process.cwd(),
        encoding: "utf8",
        stdio: "pipe",
      }),
    ).not.toThrow();
  });

  it("enforces required, additional, enum, pattern, and strategy fields from the JSON Schema", () => {
    expect(validateJsonSchema(phaseTemplate, phaseSchema)).toEqual([]);

    const missing = structuredClone(phaseTemplate);
    delete missing.modelRouting;
    expect(validateJsonSchema(missing, phaseSchema).join("\n")).toContain("missing required property modelRouting");

    const additional = { ...structuredClone(phaseTemplate), unexpected: true };
    expect(validateJsonSchema(additional, phaseSchema).join("\n")).toContain(
      "additional property unexpected is not allowed",
    );

    const badEnum = structuredClone(phaseTemplate);
    badEnum.modelRouting.provider = "unknown";
    expect(validateJsonSchema(badEnum, phaseSchema).join("\n")).toContain("must be one of");

    const badPattern = { ...structuredClone(phaseTemplate), phaseId: "phase-zero" };
    expect(validateJsonSchema(badPattern, phaseSchema).join("\n")).toContain("does not match");

    const wrongStrategy = structuredClone(phaseTemplate);
    wrongStrategy.tasks = [
      {
        globalTaskKey: "P00/adaptive/task-0",
        strategy: "tdd",
        taskBaseSha: "0".repeat(40),
        taskHeadSha: "1".repeat(40),
        commits: ["1".repeat(40)],
        briefPath:
          "docs/superpowers/rag-upgrade/execution-artifacts/rag-answer-quality-and-repository-coverage-v1/P00/P00-adaptive-task-0-brief.md",
        briefSha256: "0".repeat(64),
        implementerReportPath:
          "docs/superpowers/rag-upgrade/execution-artifacts/rag-answer-quality-and-repository-coverage-v1/P00/P00-adaptive-task-0-implementer-report.md",
        implementerReportSha256: "0".repeat(64),
        implementerAgentId: "implementer-1",
        evidence: {
          precondition: [{ command: "check", expected: "selected", outcome: "passed", result: "selected" }],
          acceptance: [{ command: "verify", expected: "pass", outcome: "passed", result: "pass" }],
        },
        reviews: [],
      },
    ];
    expect(validateJsonSchema(wrongStrategy, phaseSchema).join("\n")).toContain("oneOf");

    expect(validateJsonSchema(programmeTemplate, programmeSchema)).toEqual([]);

    const missingProgrammeField = structuredClone(programmeTemplate);
    delete missingProgrammeField.finalHeadSha;
    expect(validateJsonSchema(missingProgrammeField, programmeSchema).join("\n")).toContain(
      "missing required property finalHeadSha",
    );

    const missingFinalReviewRouting = structuredClone(programmeTemplate);
    delete missingFinalReviewRouting.finalReviewRouting;
    expect(validateJsonSchema(missingFinalReviewRouting, programmeSchema).join("\n")).toContain(
      "missing required property finalReviewRouting",
    );

    const additionalProgrammeField = { ...structuredClone(programmeTemplate), unexpected: true };
    expect(validateJsonSchema(additionalProgrammeField, programmeSchema).join("\n")).toContain(
      "additional property unexpected is not allowed",
    );

    const badProgrammeEnum = { ...structuredClone(programmeTemplate), status: "complete" };
    expect(validateJsonSchema(badProgrammeEnum, programmeSchema).join("\n")).toContain("must be one of");

    const badProgrammePattern = { ...structuredClone(programmeTemplate), finalHeadSha: "not-a-sha" };
    expect(validateJsonSchema(badProgrammePattern, programmeSchema).join("\n")).toContain("does not match");
  });

  it("fails closed on broken phase lineage, package identity, resume state, and reused agents", () => {
    const receipt = {
      phaseId: "P08A",
      status: "accepted",
      phaseStartSha: "a".repeat(40),
      phaseEndSha: "d".repeat(40),
      tasks: [
        {
          globalTaskKey: "P08A/retrieval/task-3",
          taskBaseSha: "b".repeat(40),
          taskHeadSha: "c".repeat(40),
        },
      ],
    };
    expect(taskChainErrors(receipt, ["P08A/retrieval/task-3", "P08A/retrieval/task-4"], true).join("\n")).toContain(
      "task base must equal preceding accepted head",
    );
    expect(taskChainErrors(receipt, ["P08A/retrieval/task-3", "P08A/retrieval/task-4"], true).join("\n")).toContain(
      "accepted task keys must equal",
    );
    expect(taskChainErrors(receipt, ["P08A/retrieval/task-3"], true).join("\n")).toContain(
      "final task head must equal phaseEndSha",
    );

    const p00 = {
      packageVariant: "cloud",
      packageHash: "1".repeat(64),
      packageBaseSha: "2".repeat(40),
      packageHeadSha: "3".repeat(40),
    };
    expect(packageIdentityErrors({ ...p00, packageHeadSha: "4".repeat(40) }, p00, "P08A").join("\n")).toContain(
      "packageHeadSha differs from the immutable P00 package",
    );
    expect(
      p00AnchorErrors({
        programmeImplementationBase: "2".repeat(40),
        phaseStartSha: "3".repeat(40),
        packageHeadSha: "3".repeat(40),
      }).join("\n"),
    ).toContain("P00 requires programmeImplementationBase");

    const draft = {
      phaseId: "P08A",
      status: "draft",
      phaseStartSha: "a".repeat(40),
      tasks: [
        {
          globalTaskKey: "P08A/retrieval/task-4",
          taskHeadSha: "c".repeat(40),
        },
      ],
    };
    expect(
      resumeStateErrors(draft, ["P08A/retrieval/task-3", "P08A/retrieval/task-4"], "d".repeat(40)).join("\n"),
    ).toContain("completed tasks are not an exact manifest prefix");
    expect(resumeStateErrors(draft, ["P08A/retrieval/task-4"], "d".repeat(40)).join("\n")).toContain(
      "current HEAD must equal the last completed task head",
    );
    expect(agentReuseErrors(new Set(["agent-2"]), new Set(["agent-1", "agent-2"]), "P08A")).toEqual([
      "P08A: agent agent-2 was already used by an earlier phase",
    ]);
    expect(agentReuseErrors(new Set(["task-1-reviewer"]), new Set(["task-1-reviewer"]), "P08A")).toEqual([
      "P08A: agent task-1-reviewer was already used by an earlier phase",
    ]);
    expect(agentReuseErrors(new Set(["task-1-implementer"]), new Set(["task-1-implementer"]), "P08A")).toEqual([
      "P08A: agent task-1-implementer was already used by an earlier phase",
    ]);
    expect(
      acceptedHistoryAgentReuseErrors([
        { label: "P01", agentIds: new Set(["p01-implementer", "p01-reviewer"]) },
        { label: "P02", agentIds: new Set(["p01-reviewer", "p02-reviewer"]) },
      ]),
    ).toEqual(["P02: agent p01-reviewer was already used by an earlier phase"]);

    const immutablePackage = {
      packageVariant: "cloud",
      packageHash: "1".repeat(64),
      packageBaseSha: "2".repeat(40),
      packageHeadSha: "3".repeat(40),
    };
    expect(
      acceptedHistoryContinuityErrors([
        {
          phaseId: "P00",
          executionPredecessor: null,
          receipt: { ...immutablePackage, phaseStartSha: "3".repeat(40) },
          commit: "4".repeat(40),
        },
        {
          phaseId: "P01",
          executionPredecessor: "P00",
          receipt: { ...immutablePackage, phaseStartSha: "5".repeat(40) },
          commit: "6".repeat(40),
        },
        {
          phaseId: "P02",
          executionPredecessor: "P01",
          receipt: { ...immutablePackage, phaseStartSha: "6".repeat(40) },
          commit: "7".repeat(40),
        },
      ]).join("\n"),
    ).toContain("P01: phaseStartSha must equal the execution-predecessor receipt commit");

    expect(
      phaseAcceptanceContinuityErrors(
        { ...p00, packageHeadSha: "4".repeat(40) },
        p00,
        new Set(["agent-2"]),
        new Set(["agent-1", "agent-2"]),
        "P08A",
      ),
    ).toEqual([
      "P08A: packageHeadSha differs from the immutable P00 package",
      "P08A: agent agent-2 was already used by an earlier phase",
    ]);
    expect(acceptanceStatusErrors("draft", "programme")).toEqual(["programme: acceptance requires status accepted"]);
    expect(acceptanceStatusErrors("accepted", "programme")).toEqual([]);
    expect(predecessorStartErrors("a".repeat(40), "b".repeat(40), "P08A")).toEqual([
      "P08A: phaseStartSha must equal the execution-predecessor receipt commit",
    ]);
    expect(predecessorStartErrors("a".repeat(40), "a".repeat(40), "P08A")).toEqual([]);
    expect(programmeFinalHeadErrors("a".repeat(40), "b".repeat(40))).toEqual([
      "programme finalHeadSha must equal the accepted P17 receipt commit",
    ]);
    expect(programmeFinalHeadErrors("a".repeat(40), "a".repeat(40))).toEqual([]);
    const finalReviewRouting = {
      provider: "codex",
      plannedModel: "gpt-5.6-sol",
      actualModel: "gpt-5.6-terra",
      capabilityClass: "workhorse-high",
      reasoning: "high",
      providerMappingUsed: false,
      fallbackUsed: true,
    };
    expect(finalReviewRoutingErrors(finalReviewRouting, "gpt-5.6-sol", "xhigh").join("\n")).toContain(
      "final review reasoning must be xhigh",
    );
    expect(finalReviewRoutingErrors(finalReviewRouting, "gpt-5.6-sol", "xhigh").join("\n")).toContain(
      "Codex final review actual model must match the plan",
    );
    expect(finalReviewRoutingErrors(finalReviewRouting, "gpt-5.6-sol", "xhigh").join("\n")).toContain(
      "final review fallbackUsed must remain false",
    );
    expect(requiredResidualGateErrors([], ["provider-canary", "targeted-reindex"]).join("\n")).toContain(
      "programme residualGates is missing provider-canary",
    );

    const verificationContract = {
      preCommand: "npm run verify:pr-local -- --dry-run",
      preExpected: "The selector reports the exact gates.",
      acceptanceCommands: [{ command: "npm run check:rag:fixtures", expected: "The fixture gate passes." }],
    };
    expect(
      verificationOnlyEvidenceErrors(
        "ingestion/task-9",
        {
          precondition: [
            {
              command: verificationContract.preCommand,
              expected: "A different disposition.",
              outcome: "passed",
            },
          ],
          acceptance: [
            {
              command: "npm run check:rag:fixtures",
              expected: "The fixture gate passes.",
              outcome: "passed",
            },
          ],
        },
        verificationContract,
      ).join("\n"),
    ).toContain("verification precondition command or expected result differs from the matrix");
  });

  it("requires passing programme gates, tracked bytes, and the complete review range", () => {
    const requiredCommands = ["npm run plans:rag:check", "npm run verify:pr-local"];
    const evidence = [
      { command: requiredCommands[0], outcome: "passed" },
      { command: requiredCommands[1], outcome: "blocked" },
    ];
    expect(programmeVerificationErrors(evidence, requiredCommands).join("\n")).toContain(
      `programme verification is missing passing command: ${requiredCommands[1]}`,
    );
    expect(programmeVerificationErrors(evidence, requiredCommands).join("\n")).toContain(
      "programme verification evidence must pass or reuse a valid receipt",
    );

    const working = Buffer.from("receipt");
    expect(trackedBytesErrors(working, null, "P08A.json")).toEqual([
      "P08A.json: accepted receipt is not tracked at HEAD",
    ]);
    expect(trackedBytesErrors(working, Buffer.from("different"), "P08A.json")).toEqual([
      "P08A.json: working receipt differs from HEAD",
    ]);

    const base = "a".repeat(40);
    const head = "b".repeat(40);
    const commits = ["c".repeat(40), "d".repeat(40)];
    const fullRange = buildReviewPackageBytes(base, head, commits, Buffer.from("diff --git a/a b/a\n"));
    expect(reviewPackageEvidenceErrors(fullRange, base, head, commits, "patch-1", "patch-1")).toEqual([]);
    expect(
      reviewPackageEvidenceErrors(fullRange, base, head, commits.slice(1), "patch-1", "patch-1").join("\n"),
    ).toContain("header or full commit list differs");
    expect(reviewPackageEvidenceErrors(fullRange, base, head, commits, "patch-1", "patch-2").join("\n")).toContain(
      "patch differs from the recorded full range",
    );

    const expectedMetadataPaths = ["receipts/P08A.json", "artifacts/P08A-review.diff"];
    const validMetadata = {
      commits: [head],
      metadataCommit: head,
      receiptExistedAtBase: false,
      changes: expectedMetadataPaths.map((path) => ({ status: "A", path })),
      expectedPaths: expectedMetadataPaths,
      label: "P08A",
    };
    expect(atomicMetadataCommitErrors(validMetadata)).toEqual([]);
    expect(
      atomicMetadataCommitErrors({
        ...validMetadata,
        changes: [...validMetadata.changes, { status: "A", path: "src/lib/rag/rag.ts" }],
      }).join("\n"),
    ).toContain("metadata commit paths must equal");
    expect(atomicMetadataCommitErrors({ ...validMetadata, receiptExistedAtBase: true }).join("\n")).toContain(
      "receipt was rewritten",
    );
    expect(atomicMetadataCommitErrors({ ...validMetadata, commits: [base, head] }).join("\n")).toContain(
      "exactly one commit",
    );
    expect(
      atomicMetadataCommitErrors({ ...validMetadata, changes: validMetadata.changes.slice(0, 1) }).join("\n"),
    ).toContain("metadata commit paths must equal");

    const tddContract = {
      redCommand: "node scripts/run-vitest.mjs run tests/example.test.ts",
      redExpected: "FAIL because the behavior is absent.",
      greenCommand: "node scripts/run-vitest.mjs run tests/example.test.ts",
      greenExpected: "The identical focused command passes after implementing the task contract.",
    };
    const wrongFailureReason = {
      red: [
        {
          command: tddContract.redCommand,
          expected: "FAIL because dependencies are missing.",
          outcome: "failed-as-expected",
        },
      ],
      green: [
        {
          command: tddContract.greenCommand,
          expected: tddContract.greenExpected,
          outcome: "passed",
        },
      ],
    };
    expect(tddEvidenceErrors("P00/adaptive/task-0", wrongFailureReason, tddContract).join("\n")).toContain(
      "expected product failure differs",
    );
  });
});
