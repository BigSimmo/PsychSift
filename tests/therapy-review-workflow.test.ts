import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  THERAPY_REVIEW_CHECK_KEYS,
  assertValidTherapyReviewRecords,
  finalizeTherapyReview,
  publicReviewerAttributionProblem,
  therapyReviewProblems,
  therapyReviewedContentSha256,
} from "../scripts/lib/therapy-review-contract.mjs";
import {
  conductTherapyBatchReview,
  conductTherapyReview,
  parseTherapyReviewArgs,
  persistTherapyReviewTransaction,
  renderTherapyPack,
  therapyHasReferences,
  therapyIndigenousContent,
  therapyNeedsSource,
  therapyPackCode,
  therapyWalkQueue,
  writeTherapySourceAtomically,
} from "../scripts/review-therapy.mjs";

const ROOT = process.cwd();
const SOURCE = join(ROOT, "src", "data", "therapies-source.json");
const SCRIPT = join(ROOT, "scripts", "review-therapy.mjs");
const NOW = new Date("2026-08-24T00:00:00.000Z");
const REVIEWED_AT = "2026-08-23T12:34:56.000Z";
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0))
    rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

function falseChecklist() {
  return Object.fromEntries(THERAPY_REVIEW_CHECK_KEYS.map((key) => [key, false]));
}

function yesAnswers() {
  return Object.fromEntries(THERAPY_REVIEW_CHECK_KEYS.map((key) => [key, true]));
}

function pendingRecord(overrides: Record<string, unknown> = {}) {
  return {
    slug: "fixture-therapy",
    name: "Fixture Therapy",
    clinicalSummary: "Source-backed fixture content.",
    contraindicationsOrCautions: "Check individual suitability.",
    reviewStatus: "needs_review",
    reviewChecklist: falseChecklist(),
    reviewCompleteness: 57,
    warnings: [
      "No explicit patient-facing explanation in uploaded record",
      "No explicit last reviewed date in therapy card",
      "Missing last reviewed date",
      "Not clinically reviewed",
    ],
    ...overrides,
  };
}

function reviewedRecord(overrides: Record<string, unknown> = {}) {
  const record = pendingRecord(overrides);
  return finalizeTherapyReview(record, {
    answers: yesAnswers(),
    reviewedBy: "Dr Alex Morgan",
    reviewedAt: REVIEWED_AT,
    now: NOW,
  });
}

function sequenceAsk(answers: string[]) {
  let index = 0;
  return vi.fn(async () => answers[index++] ?? "quit");
}

function outputSink() {
  return { write: vi.fn() };
}

function canonicalSourceBytes() {
  return readFileSync(SOURCE);
}

function transactionFixture() {
  const directory = mkdtempSync(join(tmpdir(), "therapy-review-transaction-"));
  temporaryDirectories.push(directory);
  const publicDirectory = join(directory, "public");
  mkdirSync(publicDirectory);

  const sourcePath = join(directory, "therapies-source.json");
  const serverIndex = join(directory, "therapies-index.json");
  const manifest = join(directory, "generated-assets.ts");
  const retiredAlias = join(publicDirectory, "therapies-home.json");
  const oldFull = join(publicDirectory, "therapies.1111111111111111.json");
  const oldIndex = join(publicDirectory, "therapies-index.2222222222222222.json");
  const newFull = join(publicDirectory, "therapies.aaaaaaaaaaaaaaaa.json");
  const newIndex = join(publicDirectory, "therapies-index.bbbbbbbbbbbbbbbb.json");
  const expectedRaw = JSON.stringify([pendingRecord()]);
  const sourceBefore = Buffer.from(expectedRaw);
  const generatedBefore = new Map([
    [serverIndex, Buffer.from("server-before\n")],
    [manifest, Buffer.from("manifest-before\n")],
    [oldFull, Buffer.from("full-before")],
    [oldIndex, Buffer.from("index-before\n")],
  ]);
  writeFileSync(sourcePath, sourceBefore);
  for (const [path, contents] of generatedBefore) writeFileSync(path, contents);

  return {
    directory,
    publicDirectory,
    sourcePath,
    serverIndex,
    manifest,
    retiredAlias,
    oldFull,
    oldIndex,
    newFull,
    newIndex,
    expectedRaw,
    sourceBefore,
    generatedBefore,
    fixedGeneratedPaths: [serverIndex, manifest, retiredAlias],
    listGeneratedPaths: () => readdirSync(publicDirectory).map((name) => join(publicDirectory, name)),
  };
}

function writePartialGeneratedState(fixture: ReturnType<typeof transactionFixture>) {
  writeFileSync(fixture.serverIndex, "partial-server\n");
  writeFileSync(fixture.manifest, "partial-manifest\n");
  rmSync(fixture.oldFull);
  writeFileSync(fixture.newFull, "new-full");
  writeFileSync(fixture.newIndex, "new-index\n");
  writeFileSync(fixture.retiredAlias, "new-retired-alias\n");
}

function expectGeneratedStateRestored(fixture: ReturnType<typeof transactionFixture>) {
  for (const [path, contents] of fixture.generatedBefore) expect(readFileSync(path).equals(contents)).toBe(true);
  expect(readdirSync(fixture.publicDirectory).sort()).toEqual([
    "therapies-index.2222222222222222.json",
    "therapies.1111111111111111.json",
  ]);
  expect(readdirSync(fixture.directory).some((name) => name.endsWith(".tmp") || name.endsWith(".review.lock"))).toBe(
    false,
  );
}

describe("Therapy review source contract", () => {
  it("accepts every canonical source record under the central contract", () => {
    const records = JSON.parse(canonicalSourceBytes().toString("utf8"));
    expect(records.length).toBeGreaterThan(0);
    expect(therapyReviewProblems(records)).toEqual([]);
  });

  it("requires exactly seven explicit boolean checks", () => {
    const missing = pendingRecord();
    delete (missing.reviewChecklist as Record<string, unknown>).sourceChecked;
    expect(therapyReviewProblems([missing], { now: NOW })).toContain(
      "fixture-therapy: reviewChecklist is missing sourceChecked.",
    );

    const nonBoolean = pendingRecord();
    (nonBoolean.reviewChecklist as Record<string, unknown>).proofread = "yes";
    expect(therapyReviewProblems([nonBoolean], { now: NOW })).toContain(
      "fixture-therapy: reviewChecklist.proofread must be boolean.",
    );

    const extra = pendingRecord();
    (extra.reviewChecklist as Record<string, unknown>).automaticApproval = true;
    expect(therapyReviewProblems([extra], { now: NOW })).toContain(
      "fixture-therapy: reviewChecklist contains unknown check automaticApproval.",
    );
  });

  it("accepts needs_review with absent or null attribution", () => {
    expect(therapyReviewProblems([pendingRecord()], { now: NOW })).toEqual([]);
    expect(
      therapyReviewProblems([pendingRecord({ reviewedBy: null, reviewedAt: null, reviewedContentSha256: null })], {
        now: NOW,
      }),
    ).toEqual([]);
  });

  it.each([
    ["reviewedBy", "Dr Alex Morgan"],
    ["reviewedAt", REVIEWED_AT],
    ["reviewedContentSha256", "a".repeat(64)],
  ])("rejects stale or partial %s metadata on needs_review", (key, value) => {
    expect(therapyReviewProblems([pendingRecord({ [key]: value })], { now: NOW })).toContain(
      `fixture-therapy: needs_review requires ${key} to be null or absent.`,
    );
  });

  it("refuses reviewed unless every check, attribution, timestamp, and content hash is valid", () => {
    const falseCheck = reviewedRecord();
    falseCheck.reviewChecklist.sourceChecked = false;
    expect(therapyReviewProblems([falseCheck], { now: NOW })).toContain(
      "fixture-therapy: reviewed requires reviewChecklist.sourceChecked to be true.",
    );

    const missingAttribution = reviewedRecord();
    delete missingAttribution.reviewedBy;
    expect(therapyReviewProblems([missingAttribution], { now: NOW })).toContain(
      "fixture-therapy: reviewedBy must be a non-empty public attribution.",
    );

    const missingTime = reviewedRecord();
    delete missingTime.reviewedAt;
    expect(therapyReviewProblems([missingTime], { now: NOW })).toContain(
      "fixture-therapy: reviewedAt must be a UTC ISO timestamp (YYYY-MM-DDTHH:mm:ss[.sss]Z).",
    );

    const missingHash = reviewedRecord();
    delete missingHash.reviewedContentSha256;
    expect(therapyReviewProblems([missingHash], { now: NOW })).toContain(
      "fixture-therapy: reviewed requires a lowercase reviewedContentSha256.",
    );
  });

  it("invalidates sign-off whenever non-review content changes", () => {
    const reviewed = reviewedRecord();
    expect(reviewed.reviewedContentSha256).toBe(therapyReviewedContentSha256(reviewed));
    expect(therapyReviewProblems([reviewed], { now: NOW })).toEqual([]);

    const changed = { ...reviewed, clinicalSummary: "Clinically material content changed after review." };
    expect(therapyReviewProblems([changed], { now: NOW })).toContain(
      "fixture-therapy: reviewedContentSha256 is stale; content changed after sign-off.",
    );
  });

  it("finalizes review-derived completeness and warnings consistently", () => {
    const reviewed = reviewedRecord();
    expect(reviewed.reviewCompleteness).toBe(100);
    expect(reviewed.warnings).toEqual(["No explicit patient-facing explanation in uploaded record"]);
    expect(therapyReviewProblems([reviewed], { now: NOW })).toEqual([]);

    const staleCompleteness = { ...reviewed, reviewCompleteness: 71 };
    staleCompleteness.reviewedContentSha256 = therapyReviewedContentSha256(staleCompleteness);
    expect(therapyReviewProblems([staleCompleteness], { now: NOW })).toContain(
      "fixture-therapy: reviewed requires reviewCompleteness to be 100.",
    );

    const staleWarning = { ...reviewed, warnings: [...reviewed.warnings, "Not clinically reviewed"] };
    staleWarning.reviewedContentSha256 = therapyReviewedContentSha256(staleWarning);
    expect(therapyReviewProblems([staleWarning], { now: NOW })).toContain(
      'fixture-therapy: reviewed cannot retain pending-review warning "Not clinically reviewed".',
    );

    const malformedWarning = { ...reviewed, warnings: [42] };
    malformedWarning.reviewedContentSha256 = therapyReviewedContentSha256(malformedWarning);
    expect(therapyReviewProblems([malformedWarning], { now: NOW })).toContain(
      "fixture-therapy: reviewed requires every warning to be a string.",
    );
  });

  it.each([
    ["email", "clinician@example.org"],
    ["account handle", "@clinical-reviewer"],
    ["UUID", "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d"],
    ["embedded UUID", "Clinical owner 9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d"],
    ["numeric private id", "123456789"],
    ["embedded numeric private id", "Dr Jane Smith 123456789"],
    ["alphanumeric registration id", "Dr Jane Smith MED0001234567"],
    ["phone number", "Dr Jane Smith +61 412 345 678"],
    ["AHPRA registration", "AHPRA MED0001234567"],
    ["provider number", "Provider number 1234567A"],
    ["staff id", "Staff ID WA-12345"],
    ["control character", "Dr Jane Smith\nprivate"],
    ["placeholder", "anonymous"],
    ["test clinician placeholder", "Test Clinician"],
    ["TBD clinician placeholder", "TBD clinician"],
    ["unknown reviewer placeholder", "Unknown reviewer"],
    ["placeholder clinician variant", "Placeholder clinician"],
    ["reversed placeholder variant", "Reviewer - testing"],
    ["anonymous clinician variant", "Anonymous clinician"],
    ["pending governance owner variant", "Pending governance owner"],
    ["unassigned reviewer variant", "Unassigned reviewer"],
    ["automated reviewer variant", "Automated reviewer"],
    ["system clinician variant", "System clinician"],
    ["missing reviewer variant", "Missing reviewer"],
    ["default clinician variant", "Default clinician"],
    ["dummy clinician variant", "Dummy clinician"],
    ["fake reviewer variant", "Fake reviewer"],
    ["sample committee variant", "Sample committee"],
    ["fake doctor abbreviation", "Fake Dr"],
    ["reversed fake doctor abbreviation", "Dr Fake"],
    ["test psychiatrist variant", "Test psychiatrist"],
    ["anonymous GP variant", "Anonymous GP"],
    ["dummy nurse variant", "Dummy nurse"],
    ["unknown psychologist variant", "Unknown psychologist"],
    ["placeholder therapist variant", "Placeholder therapist"],
    ["TBD counsellor variant", "TBD counsellor"],
    ["unassigned pharmacist variant", "Unassigned pharmacist"],
    ["pending social worker variant", "Pending social worker"],
    ["automated medical officer variant", "Automated medical officer"],
    ["system occupational therapist variant", "System occupational therapist"],
    ["default physiotherapist variant", "Default physiotherapist"],
    ["fake doctor followed by identity word", "Fake Dr Jane"],
    ["doctor followed by fake and identity word", "Dr Fake Jane"],
    ["anonymous GP followed by identity word", "Anonymous GP Smith"],
    ["N/A GP followed by identity word", "N/A GP Smith"],
    ["fake senior doctor followed by identity word", "Fake senior doctor Jane"],
    ["anonymous registered nurse followed by identity word", "Anonymous registered nurse Smith"],
  ])("rejects %s in public reviewedBy", (_label, value) => {
    expect(publicReviewerAttributionProblem(value)).not.toBeNull();
    const record = pendingRecord({ reviewedBy: value });
    expect(therapyReviewProblems([record], { now: NOW }).some((problem) => problem.includes("reviewedBy"))).toBe(true);
  });

  it.each([
    "Dr Jane Smith (Consultant Psychiatrist)",
    "Therapy Dr Alex Morgan",
    "Clinical owner: J Smith",
    "Dr Na Li",
    "Dr Na Li (Clinical reviewer)",
    "Dr Maria Testa (Consultant Psychiatrist)",
    "Test Valley Dr Alex Morgan",
    "Test Valley GP Governance Committee",
  ])("accepts display-approved public attribution %s", (value) => {
    expect(publicReviewerAttributionProblem(value)).toBeNull();
  });

  it.each(["2026-02-30T00:00:00.000Z", "2026-08-23", "2026-08-23T12:34:56+08:00", "2027-01-01T00:00:00.000Z"])(
    "rejects invalid or future reviewedAt %s",
    (reviewedAt) => {
      const reviewed = reviewedRecord();
      reviewed.reviewedAt = reviewedAt;
      expect(therapyReviewProblems([reviewed], { now: NOW }).some((problem) => problem.includes("reviewedAt"))).toBe(
        true,
      );
    },
  );

  it("rejects unknown review status strings", () => {
    expect(therapyReviewProblems([pendingRecord({ reviewStatus: "approved" })], { now: NOW })).toContain(
      'fixture-therapy: reviewStatus must be exactly "reviewed" or "needs_review".',
    );
  });

  it("will not overwrite an existing reviewed attestation", () => {
    expect(() =>
      finalizeTherapyReview(reviewedRecord(), {
        answers: yesAnswers(),
        reviewedBy: "Dr Jamie Lee",
        reviewedAt: REVIEWED_AT,
        now: NOW,
      }),
    ).toThrow("Only a needs_review Therapy record can enter the clinician sign-off workflow.");
  });
});

describe("Therapy clinician-input workflow", () => {
  it("rejects yes, batch, answer, provider, duplicate, and valueless CLI flags", () => {
    for (const args of [
      ["--yes"],
      ["--all"],
      ["--answers", "yes"],
      ["--provider", "live"],
      ["--write", "--write"],
      ["--slug"],
      ["--reviewed-by", "--write"],
    ]) {
      expect(() => parseTherapyReviewArgs(args)).toThrow();
    }
  });

  it("accepts --walk only as a write mode and never alongside one --slug", () => {
    expect(parseTherapyReviewArgs(["--write", "--walk", "--reviewed-by", "Dr Sam Taylor"])).toMatchObject({
      write: true,
      walk: true,
    });
    expect(() => parseTherapyReviewArgs(["--walk"])).toThrow(/--write/);
    expect(() => parseTherapyReviewArgs(["--write", "--walk", "--slug", "x"])).toThrow(/--slug/);
    expect(() => parseTherapyReviewArgs(["--write", "--walk", "--walk"])).toThrow(/once/);
  });

  it("walks only records awaiting review that have references, in catalogue order", () => {
    const records = [
      { slug: "a", reviewStatus: "needs_review", references: "RANZCP PS #54" },
      { slug: "b", reviewStatus: "reviewed", references: "NICE CG90" },
      { slug: "c", reviewStatus: "needs_review", references: "  " },
      { slug: "d", reviewStatus: "needs_review", references: "APA 2019" },
    ];
    expect(therapyWalkQueue(records)).toEqual(["a", "d"]);
    expect(therapyNeedsSource(records)).toEqual(["c"]);
  });

  it("never offers a record with Indigenous content (owner rule 2026-09-26)", () => {
    const records = [
      { slug: "a", reviewStatus: "needs_review", references: "APA 2019", clinicalSummary: "Plain CBT." },
      {
        slug: "b",
        reviewStatus: "needs_review",
        references: "APA 2019",
        clinicalSummary: "Adapted for Aboriginal and Torres Strait Islander clients.",
      },
    ];
    expect(therapyIndigenousContent(records[1])).toBe("Aboriginal");
    expect(therapyWalkQueue(records)).toEqual(["a"]);
  });

  it("treats a record with no references as unable to pass Source correspondence", () => {
    expect(therapyHasReferences({ references: "" })).toBe(false);
    expect(therapyHasReferences({ references: "   " })).toBe(false);
    expect(therapyHasReferences({})).toBe(false);
    expect(therapyHasReferences({ references: "RANZCP PS #54" })).toBe(true);
  });

  it("skips one record on request without committing", async () => {
    const commit = vi.fn();
    const result = await conductTherapyReview({
      record: pendingRecord(),
      reviewedBy: "Dr Alex Morgan",
      ask: sequenceAsk(["yes", "skip"]),
      commit,
      now: () => NOW,
      output: outputSink(),
    });
    expect(result.status).toBe("skipped");
    expect(commit).not.toHaveBeenCalled();
  });

  it("refuses a non-TTY walk before changing the source", () => {
    const before = readFileSync(SOURCE, "utf8");
    const result = spawnSync(process.execPath, [SCRIPT, "--write", "--walk", "--reviewed-by", "Dr Sam Taylor"], {
      cwd: ROOT,
      encoding: "utf8",
      input: "",
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/interactive TTY/);
    expect(readFileSync(SOURCE, "utf8")).toBe(before);
  });

  it("collects all seven explicit answers but never commits when any answer is no", async () => {
    const record = pendingRecord();
    const before = JSON.stringify(record);
    const ask = sequenceAsk(["yes", "yes", "no", "yes", "yes", "yes", "yes"]);
    const commit = vi.fn();
    const result = await conductTherapyReview({
      record,
      reviewedBy: "Dr Alex Morgan",
      ask,
      commit,
      now: () => NOW,
      output: outputSink(),
    });
    expect(ask).toHaveBeenCalledTimes(7);
    expect(commit).not.toHaveBeenCalled();
    expect(result.status).toBe("incomplete");
    expect(JSON.stringify(record)).toBe(before);
  });

  it("leaves the record byte-identical on quit", async () => {
    const record = pendingRecord();
    const before = JSON.stringify(record);
    const commit = vi.fn();
    const result = await conductTherapyReview({
      record,
      reviewedBy: "Dr Alex Morgan",
      ask: sequenceAsk(["yes", "quit"]),
      commit,
      now: () => NOW,
      output: outputSink(),
    });
    expect(commit).not.toHaveBeenCalled();
    expect(result.status).toBe("quit");
    expect(JSON.stringify(record)).toBe(before);
  });

  it("leaves the record byte-identical when final confirmation does not match", async () => {
    const record = pendingRecord();
    const before = JSON.stringify(record);
    const commit = vi.fn();
    const result = await conductTherapyReview({
      record,
      reviewedBy: "Dr Alex Morgan",
      ask: sequenceAsk([...Array(7).fill("yes"), "REVIEW another-slug"]),
      commit,
      now: () => NOW,
      output: outputSink(),
    });
    expect(commit).not.toHaveBeenCalled();
    expect(result.status).toBe("cancelled");
    expect(JSON.stringify(record)).toBe(before);
  });

  it.each([" REVIEW fixture-therapy", "REVIEW fixture-therapy ", "REVIEW fixture-therapy\n"])(
    "rejects non-exact final confirmation %j without committing",
    async (confirmation) => {
      const record = pendingRecord();
      const before = JSON.stringify(record);
      const commit = vi.fn();
      const result = await conductTherapyReview({
        record,
        reviewedBy: "Dr Alex Morgan",
        ask: sequenceAsk([...Array(7).fill("yes"), confirmation]),
        commit,
        now: () => NOW,
        output: outputSink(),
      });
      expect(commit).not.toHaveBeenCalled();
      expect(result.status).toBe("cancelled");
      expect(JSON.stringify(record)).toBe(before);
    },
  );

  it("commits exactly once only after seven yes answers and exact confirmation", async () => {
    const record = pendingRecord();
    const commit = vi.fn();
    const result = await conductTherapyReview({
      record,
      reviewedBy: "Dr Alex Morgan",
      ask: sequenceAsk([...Array(7).fill("yes"), "REVIEW fixture-therapy"]),
      commit,
      now: () => NOW,
      output: outputSink(),
    });
    expect(commit).toHaveBeenCalledTimes(1);
    expect(result.record).toMatchObject({
      reviewStatus: "reviewed",
      reviewedBy: "Dr Alex Morgan",
      reviewedAt: NOW.toISOString(),
    });
    expect(therapyReviewProblems([result.record], { now: NOW })).toEqual([]);
  });

  it("preserves compact one-line JSON during atomic source replacement", () => {
    const directory = mkdtempSync(join(tmpdir(), "therapy-review-atomic-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "therapies-source.json");
    writeFileSync(path, "[]", "utf8");
    const records = [pendingRecord()];
    writeTherapySourceAtomically(path, records);
    const written = readFileSync(path, "utf8");
    expect(written).toBe(JSON.stringify(records));
    expect(written).not.toContain("\n");
    expect(readdirSync(directory)).toEqual(["therapies-source.json"]);
  });

  it("refuses to overwrite source bytes that changed after review began", () => {
    const directory = mkdtempSync(join(tmpdir(), "therapy-review-race-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "therapies-source.json");
    const expectedRaw = JSON.stringify([pendingRecord()]);
    writeFileSync(path, expectedRaw, "utf8");
    const concurrentRaw = JSON.stringify([pendingRecord({ name: "Concurrent edit" })]);
    writeFileSync(path, concurrentRaw, "utf8");
    expect(() => writeTherapySourceAtomically(path, [pendingRecord()], { expectedRaw })).toThrow(
      "Therapy source changed after review began",
    );
    expect(readFileSync(path, "utf8")).toBe(concurrentRaw);
    expect(readdirSync(directory)).toEqual(["therapies-source.json"]);
  });

  it("restores exact source and generated bytes and removes new artifacts after injected generation failure", () => {
    const fixture = transactionFixture();

    expect(() =>
      persistTherapyReviewTransaction({
        sourcePath: fixture.sourcePath,
        records: [reviewedRecord()],
        expectedRaw: fixture.expectedRaw,
        fixedGeneratedPaths: fixture.fixedGeneratedPaths,
        listGeneratedPaths: fixture.listGeneratedPaths,
        runGenerator: () => {
          writePartialGeneratedState(fixture);
          throw Object.assign(new Error("injected generator/check I/O failure"), { code: "EIO" });
        },
      }),
    ).toThrow("exact pre-review source and generated asset bytes were restored");

    expect(readFileSync(fixture.sourcePath).equals(fixture.sourceBefore)).toBe(true);
    expectGeneratedStateRestored(fixture);
  });

  it("commits only when the canonical source still equals the exact intended JSON after generation", () => {
    const fixture = transactionFixture();
    const reviewed = reviewedRecord();

    expect(() =>
      persistTherapyReviewTransaction({
        sourcePath: fixture.sourcePath,
        records: [reviewed],
        expectedRaw: fixture.expectedRaw,
        fixedGeneratedPaths: fixture.fixedGeneratedPaths,
        listGeneratedPaths: fixture.listGeneratedPaths,
        runGenerator: () => undefined,
      }),
    ).not.toThrow();

    expect(readFileSync(fixture.sourcePath, "utf8")).toBe(JSON.stringify([reviewed]));
    expect(readdirSync(fixture.directory).some((name) => name.endsWith(".tmp") || name.endsWith(".review.lock"))).toBe(
      false,
    );
  });

  it("preserves concurrent source bytes and restores generated assets when generation otherwise succeeds", () => {
    const fixture = transactionFixture();
    const concurrentRaw = JSON.stringify([pendingRecord({ name: "Concurrent successful-generator edit" })]);

    expect(() =>
      persistTherapyReviewTransaction({
        sourcePath: fixture.sourcePath,
        records: [reviewedRecord()],
        expectedRaw: fixture.expectedRaw,
        fixedGeneratedPaths: fixture.fixedGeneratedPaths,
        listGeneratedPaths: fixture.listGeneratedPaths,
        runGenerator: () => {
          writePartialGeneratedState(fixture);
          writeFileSync(fixture.sourcePath, concurrentRaw);
        },
      }),
    ).toThrow("concurrent source bytes were preserved");

    expect(readFileSync(fixture.sourcePath, "utf8")).toBe(concurrentRaw);
    expectGeneratedStateRestored(fixture);
  });

  it("preserves concurrent source bytes and restores generated assets when generation throws", () => {
    const fixture = transactionFixture();
    const concurrentRaw = JSON.stringify([pendingRecord({ name: "Concurrent failing-generator edit" })]);

    expect(() =>
      persistTherapyReviewTransaction({
        sourcePath: fixture.sourcePath,
        records: [reviewedRecord()],
        expectedRaw: fixture.expectedRaw,
        fixedGeneratedPaths: fixture.fixedGeneratedPaths,
        listGeneratedPaths: fixture.listGeneratedPaths,
        runGenerator: () => {
          writePartialGeneratedState(fixture);
          writeFileSync(fixture.sourcePath, concurrentRaw);
          throw new Error("injected generator failure after concurrent edit");
        },
      }),
    ).toThrow("concurrent source bytes were preserved");

    expect(readFileSync(fixture.sourcePath, "utf8")).toBe(concurrentRaw);
    expectGeneratedStateRestored(fixture);
  });

  it("is report-only by default and refuses non-TTY writes before changing the source", () => {
    const before = canonicalSourceBytes();
    const report = spawnSync(process.execPath, [SCRIPT], { cwd: ROOT, encoding: "utf8" });
    expect(report.status).toBe(0);
    expect(report.stdout).toContain("Report only");
    expect(canonicalSourceBytes().equals(before)).toBe(true);

    const refused = spawnSync(
      process.execPath,
      [
        SCRIPT,
        "--write",
        "--slug",
        "acceptance-and-commitment-therapy-act",
        "--reviewed-by",
        "Dr Alex Morgan",
      ],
      { cwd: ROOT, encoding: "utf8" },
    );
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain("requires an interactive TTY");
    expect(canonicalSourceBytes().equals(before)).toBe(true);
  });

  it("guards the generator before any derived output and exposes the report-only npm command", () => {
    const generator = readFileSync(join(ROOT, "scripts", "build-therapies-index.mjs"), "utf8");
    expect(generator).toContain('from "./lib/therapy-review-contract.mjs";');
    expect(generator.indexOf("assertValidTherapyReviewRecords(therapies)")).toBeGreaterThan(0);
    expect(generator.indexOf("assertValidTherapyReviewRecords(therapies)")).toBeLessThan(
      generator.indexOf("syncTarget(serverTarget"),
    );
    const packageJson = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    expect(packageJson.scripts["therapy:review"]).toBe("node scripts/review-therapy.mjs");
    const types = readFileSync(join(ROOT, "src", "lib", "therapy-compass-types.ts"), "utf8");
    expect(types).toContain('export type ReviewStatus = "reviewed" | "needs_review";');
  });

  it("keeps the canonical source bytes stable under validation", () => {
    const before = canonicalSourceBytes();
    const records = JSON.parse(before.toString("utf8"));
    assertValidTherapyReviewRecords(records);
    expect(createHash("sha256").update(canonicalSourceBytes()).digest("hex")).toBe(
      createHash("sha256").update(before).digest("hex"),
    );
  });
});

describe("Therapy batch sign-off from a review pack (owner decision 2026-09-26)", () => {
  const OWNER = "Dr Sam Taylor";

  function packFixture() {
    return [
      pendingRecord({ slug: "alpha", name: "Alpha Therapy", references: "RANZCP PS #54" }),
      reviewedRecord({ slug: "beta", name: "Beta Therapy", references: "NICE CG90" }),
      pendingRecord({ slug: "gamma", name: "Gamma Therapy", references: "  " }),
      pendingRecord({ slug: "delta", name: "Delta Therapy", references: ["APA 2019"] }),
    ];
  }

  it("parses --pack, --batch and --exclude only in their valid combinations", () => {
    expect(parseTherapyReviewArgs(["--pack"])).toMatchObject({ pack: true, write: false, batch: false });
    expect(parseTherapyReviewArgs(["--pack", "--reviewed-by", OWNER])).toMatchObject({ pack: true, reviewedBy: OWNER });
    expect(
      parseTherapyReviewArgs(["--write", "--batch", "--reviewed-by", OWNER, "--exclude", "a, b,,c"]),
    ).toMatchObject({ write: true, batch: true, exclude: ["a", "b", "c"] });
    expect(() => parseTherapyReviewArgs(["--batch"])).toThrow(/--write/);
    expect(() => parseTherapyReviewArgs(["--write", "--batch", "--slug", "x"])).toThrow(/--slug/);
    expect(() => parseTherapyReviewArgs(["--write", "--batch", "--walk"])).toThrow(/--walk/);
    expect(() => parseTherapyReviewArgs(["--exclude", "a"])).toThrow(/--batch/);
    expect(() => parseTherapyReviewArgs(["--write", "--walk", "--exclude", "a"])).toThrow(/--batch/);
    for (const extra of [["--write"], ["--walk"], ["--batch"], ["--slug", "x"]]) {
      expect(() => parseTherapyReviewArgs(["--pack", ...extra])).toThrow(/--pack/);
    }
    expect(() => parseTherapyReviewArgs(["--pack", "--exclude", "a"])).toThrow();
  });

  it("changes the pack code when any pack record's content changes or a record is added", () => {
    const records = packFixture();
    const code = therapyPackCode(records);
    expect(code).toMatch(/^[0-9a-f]{8}$/);
    expect(therapyPackCode(packFixture())).toBe(code);

    const edited = packFixture();
    edited[3] = { ...edited[3], clinicalSummary: "Changed after the pack was written." };
    expect(therapyPackCode(edited)).not.toBe(code);

    const added = [...packFixture(), pendingRecord({ slug: "epsilon", references: "WHO mhGAP" })];
    expect(therapyPackCode(added)).not.toBe(code);

    const sourceAdded = packFixture();
    sourceAdded[2] = { ...sourceAdded[2], references: "Now sourced" };
    expect(therapyPackCode(sourceAdded)).not.toBe(code);
  });

  it("renders every pack record, the code and the checks, with HTML escaped", () => {
    const records = packFixture();
    records[0] = { ...records[0], clinicalSummary: '<script>alert("x")</script> & more' };
    const html = renderTherapyPack(records, { generatedAt: NOW.toISOString() });
    expect(html).toContain(therapyPackCode(records));
    expect(html).toContain('id="alpha"');
    expect(html).toContain('id="delta"');
    expect(html).not.toContain('id="beta"');
    expect(html).not.toContain('id="gamma"');
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; more");
    expect(html).toContain("I personally attest: Clinical accuracy (qualified clinician)");
    expect(html).toContain("1 records awaiting review list no references yet");
    expect(html).toContain("--reviewed-by &quot;&lt;your public name&gt;&quot;");

    const named = renderTherapyPack(records, { reviewedBy: OWNER, generatedAt: NOW.toISOString() });
    expect(named).toContain(`--reviewed-by &quot;${OWNER}&quot;`);
    expect(() => renderTherapyPack(records, { reviewedBy: "clinician@example.org" })).toThrow();
  });

  it("signs every non-excluded pack record with seven true checks and one shared timestamp", async () => {
    const records = [...packFixture(), pendingRecord({ slug: "epsilon", references: "WHO mhGAP" })];
    const before = records.map((record) => JSON.stringify(record));
    const code = therapyPackCode(records);
    const ask = sequenceAsk([...Array(7).fill("yes"), ` ${code.toUpperCase()} `]);
    const result = await conductTherapyBatchReview({
      records,
      reviewedBy: OWNER,
      exclude: ["delta"],
      ask,
      output: outputSink(),
      now: () => NOW,
    });
    expect(ask).toHaveBeenCalledTimes(8);
    expect(result.status).toBe("reviewed");
    expect(result.signed).toEqual(["alpha", "epsilon"]);
    const next = result.records as Array<Record<string, unknown>>;
    for (const slug of ["alpha", "epsilon"]) {
      const record = next.find((entry) => entry.slug === slug)!;
      expect(record).toMatchObject({ reviewStatus: "reviewed", reviewedBy: OWNER, reviewedAt: NOW.toISOString() });
      expect(Object.values(record.reviewChecklist as Record<string, boolean>)).toEqual(Array(7).fill(true));
    }
    // Excluded, already-reviewed and unsourced records are untouched.
    expect(JSON.stringify(next[1])).toBe(before[1]);
    expect(JSON.stringify(next[2])).toBe(before[2]);
    expect(JSON.stringify(next[3])).toBe(before[3]);
    expect(records.map((record) => JSON.stringify(record))).toEqual(before);
    expect(therapyReviewProblems(next, { now: NOW })).toEqual([]);
  });

  it.each([
    ["a no", ["yes", "yes", "no"], "incomplete"],
    ["a quit", ["yes", "quit"], "quit"],
  ])("signs nothing after %s", async (_label, answers, status) => {
    const records = packFixture();
    const result = await conductTherapyBatchReview({
      records,
      reviewedBy: OWNER,
      ask: sequenceAsk(answers),
      output: outputSink(),
      now: () => NOW,
    });
    expect(result.status).toBe(status);
    expect(result.signed).toEqual([]);
    expect(result.records).toBeUndefined();
  });

  it("signs nothing when the typed code does not match the recomputed code", async () => {
    const records = packFixture();
    const staleCode = therapyPackCode(records);
    records[0] = { ...records[0], clinicalSummary: "Edited after the pack was written." };
    const result = await conductTherapyBatchReview({
      records,
      reviewedBy: OWNER,
      ask: sequenceAsk([...Array(7).fill("yes"), staleCode]),
      output: outputSink(),
      now: () => NOW,
    });
    expect(result.status).toBe("code-mismatch");
    expect(result.signed).toEqual([]);
    expect(result.records).toBeUndefined();
  });

  it("refuses an --exclude slug that is not in the pack before asking anything", async () => {
    const ask = sequenceAsk([]);
    await expect(
      conductTherapyBatchReview({
        records: packFixture(),
        reviewedBy: OWNER,
        exclude: ["delta", "beta", "no-such-slug"],
        ask,
        output: outputSink(),
        now: () => NOW,
      }),
    ).rejects.toThrow(/not in the pack: beta, no-such-slug/);
    expect(ask).not.toHaveBeenCalled();
  });

  it("refuses a non-TTY batch before changing the source", () => {
    const before = canonicalSourceBytes();
    const result = spawnSync(process.execPath, [SCRIPT, "--write", "--batch", "--reviewed-by", OWNER], {
      cwd: ROOT,
      encoding: "utf8",
      input: "",
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/interactive TTY/);
    expect(canonicalSourceBytes().equals(before)).toBe(true);
  });
});
