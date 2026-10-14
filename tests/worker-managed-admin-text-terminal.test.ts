import { describe, expect, it, vi } from "vitest";
import {
  bytesDigest,
  generationEvidenceBytes,
  originalApplicabilityFamilies,
  type OriginalApplicabilityWitness,
  type SourceExpectation,
} from "../src/lib/ingestion-generation-evidence";
import { IngestionAttempt } from "../supabase/functions/_shared/ingestion-attempt";
import { buildGenerationRetentionPacket } from "../worker/generation-evidence";
import {
  buildManagedAdminTextChunks,
  completeManagedAdminTextAttempt,
  decodeManagedAdminTextTerminalReadback,
  prepareManagedAdminTextTerminalPacket,
  prepareManagedAdminTextSections,
  stageManagedAdminTextSections,
  type ManagedAdminTextSourceSectionLayout,
} from "../worker/managed-admin-text-terminal";

const documentId = "00000000-0000-4000-8000-000000000001";
const generationId = "00000000-0000-4000-8000-000000000002";
const jobId = "00000000-0000-4000-8000-000000000003";
const lease = "00000000-0000-4000-8000-000000000004";
const ownerId = "00000000-0000-4000-8000-000000000005";
function fixture(
  text = "Synthetic reference derivative.\r\nComplete literal source including its final line.\n",
  declaredSourceUnits?: NonNullable<SourceExpectation["units"]>,
  candidateGenerationId = generationId,
) {
  const originalBytes = Buffer.from(text);
  const sourceUnits: NonNullable<SourceExpectation["units"]> = declaredSourceUnits ?? [
    {
      id: "whole-txt",
      required: true,
      dependencies: [],
      locator: `utf8-bytes:0:${originalBytes.length}`,
      nativeMapping: "unavailable",
    },
  ];
  const witness: OriginalApplicabilityWitness = {
    version: "ingestion-original-applicability-v1",
    qualification: "independently_declared_unverified",
    sourceSha256: bytesDigest(originalBytes),
    sourceByteLength: originalBytes.length,
    sourceUnits,
    groups: originalApplicabilityFamilies.map((family) => ({
      family,
      population: {
        tag: "known",
        requirements:
          family === "chunks"
            ? [{ id: "whole-txt-chunks", required: true, sourceEvidenceIds: sourceUnits.map((unit) => unit.id) }]
            : [],
        basis: { scope: "whole_original", kind: "independent_original_declaration" },
        reason: family === "chunks" ? null : "no_original_requirements_in_scope",
      },
    })),
  };
  const witnessBytes = generationEvidenceBytes(witness);
  const sourceExpectation: SourceExpectation = {
    version: 1,
    sourceSha256: bytesDigest(originalBytes),
    tag: "known",
    units: sourceUnits,
    witness: { reference: "independent-test-source", sha256: bytesDigest(witnessBytes) },
    limitation: null,
  };
  const extracted = { pages: [{ pageNumber: 1, text, ocrUsed: false }], images: [] };
  const packet = buildGenerationRetentionPacket({
    documentId,
    generationId: candidateGenerationId,
    originalBytes,
    sourceExpectation,
    sourceExpectationWitnessBytes: witnessBytes,
    extracted,
    persistedPages: [{ document_id: documentId, page_number: 1, text, ocr_used: false, metadata: {} }],
    deferOptionalProducerDeclarations: true,
  });
  const input = { documentId, originalBytes, witnessBytes, extracted, packet };
  const chunkRows = buildManagedAdminTextChunks(input);
  const issued = {
    documentId,
    generationId: candidateGenerationId,
    jobId,
    workerId: "test-worker",
    firstLeaseToken: lease,
    attemptNumber: 1,
    batchId: null,
    authorityDigest: `sha256:${"a".repeat(64)}`,
    predecessorGenerationId: null,
  };
  const terminal = prepareManagedAdminTextTerminalPacket({ ...input, issued, ownerId, chunkRows });
  return { ...input, chunkRows, issued, terminal };
}
function sectionFixture(candidateGenerationId = generationId) {
  // Freeze expectations from independent synthetic source segments before either producer is invoked.
  const sourceSegments = [
    { id: "preamble", text: "Synthetic derivative preamble.\r\n", heading: null },
    {
      id: "adult",
      text: "Guideline\u00a01: Adults\r\n" + "Literal α😀 complete qualification.\r\n".repeat(100),
      heading: "Guideline\u00a01: Adults",
    },
    { id: "page-marker", text: "[Synthetic preparer page marker]\n", heading: null },
    {
      id: "under18",
      text: "Guideline\u00a02: Children and people under \n18\u00a0years of age\nOriginal child qualification.\n",
      heading: "Guideline\u00a02: Children and people under \n18\u00a0years of age",
    },
    {
      id: "pregnancy",
      text: "Guideline 3: Women who are pregnant \nor\u00a0breastfeeding\nOriginal breastfeeding qualifier.\n",
      heading: "Guideline 3: Women who are pregnant \nor\u00a0breastfeeding",
    },
    { id: "trailer", text: "TRAILER\n \t", heading: null },
  ] as const;
  const originalBytes = Buffer.from(sourceSegments.map((segment) => segment.text).join(""));
  let offset = 0;
  const ranges = sourceSegments.map((segment) => {
    const start = offset;
    offset += Buffer.byteLength(segment.text);
    return { ...segment, start, end: offset };
  });
  const sourceUnits = ranges.map((unit) => ({
    id: unit.id,
    required: true,
    dependencies: [],
    locator: `utf8-bytes:${unit.start}:${unit.end}`,
    nativeMapping: "unavailable" as const,
  }));
  const sourceSectionLayout: ManagedAdminTextSourceSectionLayout = Object.freeze({
    sourceSha256: bytesDigest(originalBytes),
    units: Object.freeze(
      ranges.map((unit) =>
        Object.freeze({
          sourceUnitId: unit.id,
          headingByteStart: unit.heading === null ? null : unit.start,
          headingByteEnd: unit.heading === null ? null : unit.start + Buffer.byteLength(unit.heading),
        }),
      ),
    ),
  });
  return {
    ...fixture(originalBytes.toString("utf8"), sourceUnits, candidateGenerationId),
    sourceSectionLayout,
    ranges,
  };
}
function response(packet: ReturnType<typeof fixture>["terminal"], replay = "already_completed") {
  const bytes = generationEvidenceBytes({
    version: "managed-admin-text-seal-v1",
    scope: "whole_retained_utf8_txt",
    activated: true,
    packet,
    clinicalApproval: "not_assessed",
    publicationApproval: "not_granted",
  });
  return {
    ok: true,
    managedAdminTextTerminal: {
      status: "admin_text_completed",
      replay,
      activated: true,
      seal: { bytesHex: bytes.toString("hex"), sha256: bytesDigest(bytes), byteLength: bytes.length },
    },
  };
}
describe("managed administrator whole TXT terminal", () => {
  it("retains only literal-heading sections with real bodies, chunk dependencies and source provenance", () => {
    const f = sectionFixture();
    const rows = buildManagedAdminTextChunks(f);
    const document = {
      id: documentId,
      owner_id: ownerId,
      title: "Synthetic source",
      file_name: "source.txt",
      source_path: "local/source.txt",
    };
    const plan = prepareManagedAdminTextSections({ ...f, document, chunkRows: rows });
    expect(plan.sections).toHaveLength(3);
    expect(plan.sections.map((s) => s.body.heading)).toEqual(
      f.ranges.filter((u) => u.heading !== null).map((u) => u.heading),
    );
    for (const [ordinal, section] of plan.sections.entries()) {
      const row = rows.filter((r) => r.section_heading !== null)[ordinal];
      expect(section.body.chunk_ids).toEqual([row.id]);
      expect(section.dependencies).toEqual([{ family: "chunks", key: `${row.id}:final` }]);
      expect(section.sourceEvidenceIds).toEqual([row.metadata.source_unit_id]);
      expect(section.body.metadata).toMatchObject({
        index_generation_id: generationId,
        source_path: "local/source.txt",
        source_sha256: bytesDigest(f.originalBytes),
        source_expectation_digest: f.packet.registration.sourceExpectationSha256,
      });
      const artifact = plan.manifest.units[ordinal].artifact;
      expect(JSON.parse(Buffer.from(artifact.bytesHex, "hex").toString("utf8"))).toEqual(section.body);
      expect(artifact.sha256).toBe(bytesDigest(Buffer.from(artifact.bytesHex, "hex")));
      expect(plan.manifest.units[ordinal].declaration.sourceEvidenceIds).toEqual([]);
      expect(plan.manifest.units[ordinal].originalReferences).toEqual(section.sourceEvidenceIds);
      expect(plan.manifest.units[ordinal].declaration.required).toBe(true);
    }
    const before = prepareManagedAdminTextTerminalPacket({ ...f, ownerId, chunkRows: rows });
    const terminal = prepareManagedAdminTextTerminalPacket({ ...f, ownerId, chunkRows: rows, sectionPlan: plan });
    expect(terminal.version).toBe("managed-admin-text-complete-v2");
    expect(terminal.quality.metrics.section_count).toBe(3);
    expect(terminal.quality.quality_score).toBeCloseTo(before.quality.quality_score + 0.055, 3);
    expect(terminal.quality.issues).not.toContain("no structured sections");
    for (const issue of [
      "no memory cards",
      "missing document title embedding",
      "missing document summary embedding",
      "clinical_approval_not_assessed",
    ])
      expect(terminal.quality.issues).toContain(issue);
    expect(terminal.chunks).toEqual(before.chunks);
  });
  it("never promotes title, content guessing or Page fallback into a no-heading section", () => {
    const f = sectionFixture();
    const sourceSectionLayout = {
      ...f.sourceSectionLayout,
      units: f.sourceSectionLayout.units.map((u) => ({ ...u, headingByteStart: null, headingByteEnd: null })),
    };
    const input = { ...f, sourceSectionLayout };
    const chunkRows = buildManagedAdminTextChunks(input);
    const plan = prepareManagedAdminTextSections({
      ...input,
      chunkRows,
      document: {
        id: documentId,
        owner_id: ownerId,
        title: "Invented heading",
        file_name: "invented.txt",
        source_path: null,
      },
    });
    expect(plan.sections).toEqual([]);
    expect(plan.manifest.group.declaration.population).toMatchObject({
      tag: "known",
      expectedUnits: [],
      reason: "no_units_expected",
    });
    expect(
      prepareManagedAdminTextTerminalPacket({ ...f, ownerId, chunkRows, sectionPlan: plan }).quality.metrics
        .section_count,
    ).toBe(0);
  });
  it("refuses fabricated headings, missing/duplicate/foreign source rows and count-only section plans", () => {
    const f = sectionFixture();
    const rows = buildManagedAdminTextChunks(f);
    const document = {
      id: documentId,
      owner_id: ownerId,
      title: "Synthetic",
      file_name: "source.txt",
      source_path: null,
    };
    for (const chunkRows of [
      rows.slice(0, -1),
      [...rows, rows[0]],
      rows.map((r, i) => (i === 1 ? { ...r, section_heading: "Invented" } : r)),
      rows.map((r, i) => (i === 1 ? { ...r, index_generation_id: ownerId } : r)),
    ]) {
      expect(() => prepareManagedAdminTextSections({ ...f, document, chunkRows })).toThrow(
        "section_chunk_population_mismatch",
      );
    }
    const plan = prepareManagedAdminTextSections({ ...f, document, chunkRows: rows });
    for (const sections of [
      plan.sections.slice(0, -1),
      [...plan.sections, plan.sections[0]],
      plan.sections.map((s, i) => (i === 0 ? { ...s, dependencies: [] } : s)),
    ]) {
      expect(() =>
        prepareManagedAdminTextTerminalPacket({ ...f, ownerId, chunkRows: rows, sectionPlan: { ...plan, sections } }),
      ).toThrow("section_plan_mismatch");
    }
  });
  it("stages the exact declared retained sections before terminal dispatch and refuses failed writes", async () => {
    const f = sectionFixture();
    const plan = prepareManagedAdminTextSections({
      ...f,
      chunkRows: buildManagedAdminTextChunks(f),
      document: { id: documentId, owner_id: ownerId, title: "Synthetic", file_name: "source.txt", source_path: null },
    });
    const mutation = vi.fn().mockResolvedValue({ ok: true });
    await stageManagedAdminTextSections({ plan, generationId, mutation });
    expect(mutation.mock.calls.map((call) => call[0])).toEqual([
      "register_admin_text_source_section_layout",
      "declare_ingestion_generation_evidence",
      "retain_ingestion_generation_artifacts",
      "record_ingestion_generation_outcomes",
    ]);
    expect(mutation.mock.calls[2][1].p_artifacts).toEqual(plan.manifest.units.map((u) => u.artifact));
    expect(mutation.mock.calls[0][1]).toEqual({
      p_generation: generationId,
      p_source_expectation_digest: f.packet.registration.sourceExpectationSha256,
      p_layout: f.sourceSectionLayout,
      p_layout_hex: generationEvidenceBytes(f.sourceSectionLayout).toString("hex"),
      p_layout_sha256: bytesDigest(generationEvidenceBytes(f.sourceSectionLayout)),
    });
    const failed = vi.fn().mockResolvedValue({ ok: false, reason: "lease_lost" });
    await expect(stageManagedAdminTextSections({ plan, generationId, mutation: failed })).rejects.toThrow(
      "section_stage_current_attempt_required",
    );
    expect(failed).toHaveBeenCalledTimes(1);
  });
  it("produces exact complete source units with original wrapped headings and complementary regions", () => {
    const f = sectionFixture();
    const rows = buildManagedAdminTextChunks(f);
    expect(rows).toHaveLength(6);
    expect(rows.map((row) => row.content)).toEqual(f.ranges.map((unit) => unit.text));
    expect(Buffer.from(rows.map((row) => row.content).join(""))).toEqual(f.originalBytes);
    expect(rows.map((row) => row.section_heading)).toEqual(f.ranges.map((unit) => unit.heading));
    for (const [index, row] of rows.entries()) {
      const unit = f.ranges[index];
      expect(row.section_path).toEqual(unit.heading === null ? [] : [unit.heading]);
      expect(row.parent_heading).toBeNull();
      expect(row.heading_level).toBe(unit.heading === null ? null : 1);
      expect(row.retrieval_synopsis).toBeNull();
      expect(row.content_hash).toBe(bytesDigest(f.originalBytes.subarray(unit.start, unit.end)).slice(7));
      expect(row.metadata.source_unit_id).toBe(unit.id);
      expect(row.metadata.source_byte_start).toBe(unit.start);
      expect(row.metadata.source_byte_end).toBe(unit.end);
    }
    expect(rows[1].content.length).toBeGreaterThan(1800);
    const terminal = prepareManagedAdminTextTerminalPacket({ ...f, ownerId, chunkRows: rows });
    expect(terminal.chunks.map(({ start, end }) => ({ start, end }))).toEqual(
      f.ranges.map(({ start, end }) => ({ start, end })),
    );
    expect(terminal.chunks.at(-1)?.end).toBe(f.originalBytes.length);
    expect(terminal.quality.issues).toContain("clinical_approval_not_assessed");
    expect(() => prepareManagedAdminTextTerminalPacket({ ...f, ownerId, chunkRows: rows.slice(0, -1) })).toThrow(
      "chunk_coverage_mismatch",
    );
  });
  it("retains the ordinary 1800-character null-heading fallback when no layout is supplied", () => {
    const f = sectionFixture();
    const rows = buildManagedAdminTextChunks({ ...f, sourceSectionLayout: undefined });
    const characters = Array.from(f.extracted.pages[0].text);
    expect(rows.map((row) => row.content)).toEqual(
      Array.from({ length: Math.ceil(characters.length / 1800) }, (_, index) =>
        characters.slice(index * 1800, (index + 1) * 1800).join(""),
      ),
    );
    expect(rows).toEqual(f.chunkRows);
    expect(rows.every((row) => row.section_heading === null && row.section_path.length === 0)).toBe(true);
    expect(rows.every((row) => row.metadata.extractor === "literal-admin-utf8-text-v1")).toBe(true);
  });
  it("refuses missing, duplicate and foreign layout unit identities", () => {
    const f = sectionFixture();
    for (const units of [
      f.sourceSectionLayout.units.slice(0, -1),
      [...f.sourceSectionLayout.units, f.sourceSectionLayout.units[0]],
      f.sourceSectionLayout.units.map((unit, index) => (index === 1 ? { ...unit, sourceUnitId: "foreign" } : unit)),
    ]) {
      expect(() =>
        buildManagedAdminTextChunks({ ...f, sourceSectionLayout: { ...f.sourceSectionLayout, units } }),
      ).toThrow("section_unit_population_mismatch");
    }
  });
  it("refuses overlapping independent source units for the section subset", () => {
    const f = sectionFixture();
    const units = f.packet.registration.sourceExpectation.units!.map((unit, index) =>
      index === 1 ? { ...unit, locator: `utf8-bytes:${f.ranges[1].start - 1}:${f.ranges[1].end}` } : unit,
    );
    const changed = fixture(f.extracted.pages[0].text, units);
    expect(() => buildManagedAdminTextChunks({ ...changed, sourceSectionLayout: f.sourceSectionLayout })).toThrow(
      "section_unit_partition_mismatch",
    );
  });
  it("refuses an original coverage gap and an unrepresented required source unit", () => {
    const f = sectionFixture();
    const units = f.packet.registration.sourceExpectation.units!.map((unit, index) =>
      index === 1 ? { ...unit, locator: `utf8-bytes:${f.ranges[1].start + 1}:${f.ranges[1].end}` } : unit,
    );
    expect(() => fixture(f.extracted.pages[0].text, units)).toThrow("source_coverage_gap");
    const witness: OriginalApplicabilityWitness = JSON.parse(f.witnessBytes.toString("utf8"));
    const group = witness.groups.find((entry) => entry.family === "chunks")!;
    if (group.population.tag !== "known") throw new Error("test original population must be known");
    group.population.requirements[0].sourceEvidenceIds = ["adult"];
    const witnessBytes = generationEvidenceBytes(witness);
    const packet = {
      ...f.packet,
      registration: {
        ...f.packet.registration,
        sourceExpectation: {
          ...f.packet.registration.sourceExpectation,
          witness: { reference: "independent-missing-obligation", sha256: bytesDigest(witnessBytes) },
        },
      },
    };
    expect(() => buildManagedAdminTextChunks({ ...f, packet, witnessBytes })).toThrow(
      "source_obligation_unrepresented",
    );
  });
  it("refuses source-unit UTF8 boundaries inside a code point", () => {
    const f = sectionFixture();
    const split = f.originalBytes.indexOf(Buffer.from("😀")) + 1;
    const units = [
      {
        id: "first",
        required: true,
        dependencies: [],
        locator: `utf8-bytes:0:${split}`,
        nativeMapping: "unavailable" as const,
      },
      {
        id: "rest",
        required: true,
        dependencies: [],
        locator: `utf8-bytes:${split}:${f.originalBytes.length}`,
        nativeMapping: "unavailable" as const,
      },
    ];
    const changed = fixture(f.extracted.pages[0].text, units);
    expect(() =>
      buildManagedAdminTextChunks({
        ...changed,
        sourceSectionLayout: {
          sourceSha256: bytesDigest(f.originalBytes),
          units: units.map((unit) => ({ sourceUnitId: unit.id, headingByteStart: null, headingByteEnd: null })),
        },
      }),
    ).toThrow("section_utf8_boundary");
  });
  it("refuses changed source commitments, heading spans and split heading UTF8", () => {
    const f = sectionFixture();
    expect(() =>
      buildManagedAdminTextChunks({
        ...f,
        sourceSectionLayout: { ...f.sourceSectionLayout, sourceSha256: `sha256:${"0".repeat(64)}` },
      }),
    ).toThrow("section_source_mismatch");
    const heading = f.sourceSectionLayout.units[1];
    const split = f.originalBytes.indexOf(Buffer.from("\u00a0"), f.ranges[1].start) + 1;
    for (const change of [
      { headingByteStart: heading.headingByteStart! + 1 },
      { headingByteEnd: f.ranges[1].end + 1 },
      { headingByteEnd: null },
    ]) {
      const units = f.sourceSectionLayout.units.map((unit, index) => (index === 1 ? { ...unit, ...change } : unit));
      expect(() =>
        buildManagedAdminTextChunks({ ...f, sourceSectionLayout: { ...f.sourceSectionLayout, units } }),
      ).toThrow("section_heading_span_mismatch");
    }
    const units = f.sourceSectionLayout.units.map((unit, index) =>
      index === 1 ? { ...unit, headingByteEnd: split } : unit,
    );
    expect(() =>
      buildManagedAdminTextChunks({ ...f, sourceSectionLayout: { ...f.sourceSectionLayout, units } }),
    ).toThrow("section_utf8_boundary");
    expect(() => buildManagedAdminTextChunks({ ...f, originalBytes: Buffer.from("changed original") })).toThrow();
    const changedUnits = f.packet.registration.sourceExpectation.units!.map((unit, index) =>
      index === 1 ? { ...unit, locator: `utf8-bytes:${f.ranges[1].start}:${f.ranges[1].end - 1}` } : unit,
    );
    const changedPacket = {
      ...f.packet,
      registration: {
        ...f.packet.registration,
        sourceExpectation: { ...f.packet.registration.sourceExpectation, units: changedUnits },
      },
    };
    expect(() => buildManagedAdminTextChunks({ ...f, packet: changedPacket })).toThrow("source_units_mismatch");
  });
  it("uses fresh candidate identities for the independently issued revised generation", () => {
    const before = sectionFixture();
    const after = sectionFixture("00000000-0000-4000-8000-000000000006");
    const rows = buildManagedAdminTextChunks(after);
    const oldIds = new Set(before.chunkRows.map((row) => row.id));
    expect(rows.every((row) => !oldIds.has(row.id))).toBe(true);
    expect(rows.every((row) => row.index_generation_id === after.issued.generationId)).toBe(true);
    expect(() =>
      prepareManagedAdminTextTerminalPacket({ ...after, issued: before.issued, ownerId, chunkRows: rows }),
    ).toThrow("chunk_coverage_mismatch");
  });
  it("preserves every byte, including CRLF, Unicode and final whitespace, across chunks", () => {
    const f = fixture("Literal α😀 prose.\r\n".repeat(200) + "TAIL\n ");
    expect(f.chunkRows.length).toBeGreaterThan(1);
    expect(Buffer.from(f.chunkRows.map((r) => r.content).join(""))).toEqual(f.originalBytes);
    expect(f.terminal.chunks.at(-1)?.end).toBe(f.originalBytes.length);
    expect(f.chunkRows.every((r) => r.retrieval_synopsis === null && r.image_ids.length === 0)).toBe(true);
  });
  it("refuses lost original or extracted text and a shortened chunk population", () => {
    const f = fixture();
    expect(() => buildManagedAdminTextChunks({ ...f, originalBytes: Buffer.from("changed") })).toThrow();
    expect(() =>
      buildManagedAdminTextChunks({
        ...f,
        extracted: { ...f.extracted, pages: [{ ...f.extracted.pages[0], text: f.extracted.pages[0].text.trim() }] },
      }),
    ).toThrow("extracted_text_mismatch");
    expect(() => prepareManagedAdminTextTerminalPacket({ ...f, ownerId, chunkRows: [] })).toThrow(
      "chunk_coverage_mismatch",
    );
  });
  it("requires independently declared empty original populations", () => {
    const f = fixture();
    const witness = JSON.parse(f.witnessBytes.toString());
    witness.groups.find((g: { family: string }) => g.family === "index_units").population = {
      tag: "unknown",
      limitation: "unassessed",
    };
    const witnessBytes = generationEvidenceBytes(witness);
    const packet = {
      ...f.packet,
      registration: {
        ...f.packet.registration,
        sourceExpectation: {
          ...f.packet.registration.sourceExpectation,
          witness: { reference: "changed-independent-test", sha256: bytesDigest(witnessBytes) },
        },
      },
    };
    expect(() => buildManagedAdminTextChunks({ ...f, witnessBytes, packet })).toThrow("original_family_unknown");
  });
  it("refuses receipt mutation and never grants clinical/publication approval", () => {
    const f = fixture();
    expect(decodeManagedAdminTextTerminalReadback(f.terminal, response(f.terminal)).activated).toBe(true);
    const bad = response(f.terminal);
    bad.managedAdminTextTerminal.seal.sha256 = `sha256:${"0".repeat(64)}`;
    expect(() => decodeManagedAdminTextTerminalReadback(f.terminal, bad)).toThrow("receipt_commitment_mismatch");
    expect(() =>
      decodeManagedAdminTextTerminalReadback(
        { ...f.terminal, identity: { ...f.terminal.identity, jobId: ownerId } },
        response(f.terminal),
      ),
    ).toThrow("receipt_mismatch");
  });
  it("recovers a lost write response through one completed read and cancels the attempt", async () => {
    const f = fixture();
    const attempt = new IngestionAttempt({
      job_kind: "node",
      job_id: jobId,
      document_id: documentId,
      worker_id: "test-worker",
      lease_token: lease,
      expected_generation_id: null,
      authority_digest: f.issued.authorityDigest,
    });
    const stopHeartbeat = vi.fn();
    const rpc = vi
      .fn()
      .mockRejectedValueOnce(new Error("lost response"))
      .mockResolvedValueOnce({ data: response(f.terminal), error: null });
    await completeManagedAdminTextAttempt({ attempt, packet: f.terminal, stopHeartbeat, rpc });
    expect(stopHeartbeat).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls.map((c) => c[1].p_read_only)).toEqual([false, true]);
    expect(() => attempt.check()).toThrow();
  });
  it("recovers a resolved malformed acknowledgement through one strict completed read", async () => {
    const f = fixture();
    const attempt = new IngestionAttempt({
      job_kind: "node",
      job_id: jobId,
      document_id: documentId,
      worker_id: "test-worker",
      lease_token: lease,
      expected_generation_id: null,
      authority_digest: f.issued.authorityDigest,
    });
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: response(f.terminal), error: null });
    await completeManagedAdminTextAttempt({ attempt, packet: f.terminal, stopHeartbeat: vi.fn(), rpc });
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls.map((c) => c[1].p_read_only)).toEqual([false, true]);
    expect(() => attempt.check()).toThrow();
  });
  it("refuses a different valid completed-read seal after a verified write acknowledgement", async () => {
    const f = fixture();
    const attempt = new IngestionAttempt({
      job_kind: "node",
      job_id: jobId,
      document_id: documentId,
      worker_id: "test-worker",
      lease_token: lease,
      expected_generation_id: null,
      authority_digest: f.issued.authorityDigest,
    });
    const read = response(f.terminal);
    const sealBody = JSON.parse(Buffer.from(read.managedAdminTextTerminal.seal.bytesHex, "hex").toString("utf8"));
    const bytes = generationEvidenceBytes({ ...sealBody, nativeFidelity: "different_readback" });
    read.managedAdminTextTerminal.seal = {
      bytesHex: bytes.toString("hex"),
      sha256: bytesDigest(bytes),
      byteLength: bytes.length,
    };
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: response(f.terminal, "completed"), error: null })
      .mockResolvedValueOnce({ data: read, error: null });
    await expect(
      completeManagedAdminTextAttempt({ attempt, packet: f.terminal, stopHeartbeat: vi.fn(), rpc }),
    ).rejects.toThrow("replay_mismatch");
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(() => attempt.check()).toThrow();
  });
});
