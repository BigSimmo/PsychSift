import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { buildChunks } from "../src/lib/chunking";
import { auditChunkDedupImpact, runOfflineChunkDedupImpactAudit } from "../scripts/audit-chunk-dedup-impact";

const digest = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const sourceId = "11111111-1111-4111-8111-111111111111";
const generationId = "22222222-2222-4222-8222-222222222222";
function input(contents = ["synthetic result < 1.5 units.", "synthetic result > 1.5 units."]) {
  return {
    schemaVersion: 1,
    evidenceKind: "synthetic_pre_dedup_candidates",
    sourceId,
    generationId,
    sourceSha256: digest("synthetic exact source bytes"),
    scopeMode: "page",
    candidates: contents.map((content, index) => ({
      candidateId: `candidate-${index}`,
      scope: { pageNumber: 1 },
      content,
    })),
  };
}

const temporaryDirectories: string[] = [];
afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("offline historical chunk deduplication evidence", () => {
  it.each([
    ["<", ">"],
    ["≤", "≥"],
    ["+", "−"],
    ["α", "β"],
    ["pH", "PH"],
    ["table", "figure"],
  ])("reports lossy %s/%s collisions without returning bodies", (left, right) => {
    const fixture = input([
      `synthetic value ${left} with a qualification.`,
      `synthetic value ${right} with a qualification.`,
    ]);
    const report = auditChunkDedupImpact(fixture);
    expect(report.counts).toMatchObject({
      candidates: 2,
      legacyRetained: 1,
      currentRetained: 2,
      collisionGroups: 1,
      distinctCandidatesLostByLegacy: 1,
    });
    expect(report.sourceId).toBe(sourceId);
    expect(report.generationId).toBe(generationId);
    expect(report.sourceSha256).toBe(fixture.sourceSha256);
    expect(report.legacySourceCommit).toBe("60c342b497f985eb0eb6d527fa0223f8c664e68c");
    expect(report.collisions[0]).toMatchObject({
      candidateIds: ["candidate-0", "candidate-1"],
      legacyRetained: 1,
      currentRetained: 2,
    });
    const serialized = JSON.stringify(report);
    for (const candidate of fixture.candidates) expect(serialized).not.toContain(candidate.content);
    expect(report.collisions[0]?.contentSha256).toEqual(
      fixture.candidates.map((candidate) => digest(candidate.content)),
    );
  });

  it("matches current runtime page-mode retention on explicitly supplied synthetic candidates", () => {
    const fixture = input();
    const chunks = buildChunks(
      fixture.candidates.map((candidate) => ({
        documentId: sourceId,
        pageNumber: 1,
        pageText: candidate.content,
        metadata: {},
      })),
    );
    expect(auditChunkDedupImpact(fixture).counts.currentRetained).toBe(chunks.length);
    expect(chunks.map((chunk) => chunk.content)).toEqual(fixture.candidates.map((candidate) => candidate.content));
  });

  it("does not report exact/whitespace duplicates as symbol-loss collisions", () => {
    const report = auditChunkDedupImpact(
      input(["synthetic < 1.5 units.", "synthetic   < 1.5 units.", "synthetic < 1.5 units."]),
    );
    expect(report.counts).toMatchObject({
      candidates: 3,
      legacyRetained: 1,
      currentRetained: 1,
      collisionGroups: 0,
      distinctCandidatesLostByLegacy: 0,
    });
    expect(report.collisions).toEqual([]);
  });

  it("isolates pages and retains legacy-empty fingerprints instead of treating them as discarded", () => {
    const fixture = input();
    fixture.candidates[1]!.scope.pageNumber = 2;
    expect(auditChunkDedupImpact(fixture).counts).toMatchObject({
      legacyRetained: 2,
      currentRetained: 2,
      collisionGroups: 0,
    });
    const emptyLegacy = auditChunkDedupImpact(input(["α", "β", "α"]));
    expect(emptyLegacy.counts).toMatchObject({
      legacyRetained: 3,
      currentRetained: 2,
      collisionGroups: 0,
      distinctCandidatesLostByLegacy: 0,
    });
  });

  it("uses document section-path hashes and physical spans without exposing section labels", () => {
    const fixture = input();
    const scoped = {
      ...fixture,
      scopeMode: "document",
      candidates: fixture.candidates.map((candidate) => ({
        ...candidate,
        scope: { sectionPathSha256: digest("same joined section path"), pageStart: 9, pageEnd: 11 },
      })),
    };
    expect(auditChunkDedupImpact(scoped).counts.collisionGroups).toBe(1);
    scoped.candidates[1]!.scope.sectionPathSha256 = digest("different joined section path");
    expect(auditChunkDedupImpact(scoped).counts.collisionGroups).toBe(0);
    scoped.candidates[1]!.scope.sectionPathSha256 = scoped.candidates[0]!.scope.sectionPathSha256;
    scoped.candidates[1]!.scope.pageEnd = 12;
    expect(auditChunkDedupImpact(scoped).counts.collisionGroups).toBe(0);
  });

  it("reports only supplied evidence and never claims current corpus impact or completeness", () => {
    const report = auditChunkDedupImpact(input());
    expect(report.evidenceLimit).toBe(
      "supplied_pre_dedup_candidates_only_not_corpus_prevalence_completeness_or_provider_proof",
    );
    expect(report.currentFingerprintVersion).toBe("1.3.4");
    expect(auditChunkDedupImpact(input())).toEqual(report);
  });

  it.each([
    (fixture: ReturnType<typeof input>) => ({ ...fixture, schemaVersion: 2 }),
    (fixture: ReturnType<typeof input>) => ({ ...fixture, evidenceKind: "private" }),
    (fixture: ReturnType<typeof input>) => ({ ...fixture, sourceSha256: "not-a-hash" }),
    (fixture: ReturnType<typeof input>) => ({ ...fixture, sourceId: "patient-name@example.org" }),
    (fixture: ReturnType<typeof input>) => ({ ...fixture, generationId: "sk-synthetic" }),
    (fixture: ReturnType<typeof input>) => ({ ...fixture, title: "unapproved raw field" }),
    (fixture: ReturnType<typeof input>) => ({
      ...fixture,
      candidates: fixture.candidates.map((candidate) => ({ ...candidate, candidateId: "candidate-0" })),
    }),
    (fixture: ReturnType<typeof input>) => ({
      ...fixture,
      candidates: [{ ...fixture.candidates[0], scope: { pageNumber: -1 } }],
    }),
    (fixture: ReturnType<typeof input>) => ({
      ...fixture,
      candidates: Array.from({ length: 10_001 }, (_, index) => ({
        ...fixture.candidates[0],
        candidateId: `candidate-${index}`,
      })),
    }),
  ])("refuses unsupported metadata with a content-free error", (transform) => {
    expect(() => auditChunkDedupImpact(transform(input()))).toThrow("chunk_dedup_impact_input_invalid");
  });

  it("rejects credential-shaped candidate bodies without returning them in failures", () => {
    const marker = "sk-synthetic";
    expect(() => auditChunkDedupImpact(input([marker, `synthetic ${marker} body`]))).toThrow(
      "chunk_dedup_impact_input_invalid",
    );
  });

  it("rejects bad later descriptors before accessing earlier bodies", () => {
    const fixture = input();
    let bodyRead = false;
    Object.defineProperty(fixture.candidates[0], "content", {
      enumerable: true,
      get() {
        bodyRead = true;
        return "unapproved body";
      },
    });
    fixture.candidates[1]!.candidateId = "invalid identity";
    expect(() => auditChunkDedupImpact(fixture)).toThrow("chunk_dedup_impact_input_invalid");
    expect(bodyRead).toBe(false);
  });

  it("reads only an explicit bounded JSON input and creates output without overwriting", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "chunk-impact-"));
    temporaryDirectories.push(directory);
    const inputPath = path.join(directory, "synthetic.json");
    const outputPath = path.join(directory, "report.json");
    await writeFile(inputPath, JSON.stringify(input()));
    const report = await runOfflineChunkDedupImpactAudit(["--input", inputPath]);
    expect(report.counts.collisionGroups).toBe(1);
    await runOfflineChunkDedupImpactAudit(["--input", inputPath, "--output", outputPath]);
    expect(JSON.parse(await readFile(outputPath, "utf8"))).toEqual(report);
    await expect(runOfflineChunkDedupImpactAudit(["--input", inputPath, "--output", outputPath])).rejects.toThrow(
      "chunk_dedup_impact_output_refused",
    );
    expect(JSON.parse(await readFile(outputPath, "utf8"))).toEqual(report);
    await writeFile(inputPath, " ".repeat(1_048_577));
    await expect(runOfflineChunkDedupImpactAudit(["--input", inputPath])).rejects.toThrow(
      "chunk_dedup_impact_input_invalid",
    );
    await expect(runOfflineChunkDedupImpactAudit(["--input", directory])).rejects.toThrow(
      "chunk_dedup_impact_input_invalid",
    );
    await expect(runOfflineChunkDedupImpactAudit(["--live-read"])).rejects.toThrow(
      "chunk_dedup_impact_arguments_invalid",
    );
  });

  it("refuses malformed UTF-8 instead of replacing source symbols and writing evidence", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "chunk-impact-utf8-"));
    temporaryDirectories.push(directory);
    const inputPath = path.join(directory, "synthetic-invalid.json");
    const outputPath = path.join(directory, "report.json");
    const marker = "MALFORMED_PLACEHOLDER";
    const json = JSON.stringify(input([`synthetic prefix ${marker} suffix`]));
    const position = json.indexOf(marker);
    await writeFile(
      inputPath,
      Buffer.concat([
        Buffer.from(json.slice(0, position)),
        Buffer.from([0xc3, 0x28]),
        Buffer.from(json.slice(position + marker.length)),
      ]),
    );
    await expect(runOfflineChunkDedupImpactAudit(["--input", inputPath, "--output", outputPath])).rejects.toThrow(
      "chunk_dedup_impact_input_invalid",
    );
    await expect(readFile(outputPath)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
