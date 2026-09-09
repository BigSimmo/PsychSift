import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { sourceSegment } from "./helpers/source-contract";
import {
  agentFailureDecision,
  completionGateFromRow,
  deferralDecision,
  metadataNumber,
  missingArtifactPlan,
  parseJobStatusRpcResult,
  protectedPublicSourceChunkPage,
  publicSourceWorkerPolicyViolation,
  protectedPublicSourceChunkContents,
  scanProtectedPublicSourceChunkPages,
  shouldRunVisualArtifacts,
  type CompletionGateRow,
} from "../supabase/functions/indexing-v3-agent/behavior";
import { forbiddenPublicSourceIdentity } from "../supabase/functions/_shared/public-source-policy";
import {
  buildGenerationVisibility,
  isVisibleCommittedGenerationRow,
} from "../supabase/functions/_shared/ingestion-generation-visibility";
import { generationMetadata } from "../supabase/functions/indexing-v3-agent/utils";

const fencingSql = readFileSync(
  new URL("../supabase/migrations/20260831101000_fence_ingestion_leases_and_repairs.sql", import.meta.url),
  "utf8",
);
function fencedSqlBody(name: string) {
  const start = fencingSql.indexOf(`function public.${name}(`);
  expect(start).toBeGreaterThan(-1);
  return fencingSql.slice(start, fencingSql.indexOf("end $$;", start));
}

const completeGateRow: CompletionGateRow = {
  sections: 3,
  memory_cards: 8,
  generated_labels: 4,
  index_units: 12,
  title_embedding: true,
  summary_embedding: true,
  quality_extraction_quality: "good",
  quality_score: 0.91,
  missing: [],
  gate_passed: true,
};
function gateRow(overrides: Partial<CompletionGateRow> = {}): CompletionGateRow {
  return { ...completeGateRow, ...overrides };
}

const indexingAgentSource = readFileSync(
  new URL("../supabase/functions/indexing-v3-agent/index.ts", import.meta.url),
  "utf8",
);

function agentFunction(start: string, end: string) {
  return sourceSegment(indexingAgentSource, start, end, { label: start });
}

function statementWithin(functionSource: string, start: string, end: string, label: string) {
  return sourceSegment(functionSource, start, end, { label });
}

function normalizedSql(source: string) {
  return source.replace(/\s+/g, " ").trim();
}

function expectTypedGenerationPredicate(
  source: string,
  column: string,
  label: string,
  terminals: ReadonlyArray<string> = [],
) {
  const statement = normalizedSql(source);
  const whereIndex = statement.toLowerCase().indexOf("where ");
  const active = `${column} = \${generationPredicate.indexGenerationId}::uuid`;
  const legacy = `\${generationPredicate.isLegacy}::boolean and ${column} is null`;
  const activeIndex = statement.indexOf(active);
  expect(whereIndex, `${label}: WHERE`).toBeGreaterThanOrEqual(0);
  expect(activeIndex, `${label}: active generation predicate`).toBeGreaterThan(whereIndex);
  expect(statement, `${label}: positive legacy predicate`).toContain(legacy);
  for (const terminal of terminals) {
    const terminalIndex = statement.toLowerCase().indexOf(terminal.toLowerCase());
    expect(terminalIndex, `${label}: ${terminal}`).toBeGreaterThan(activeIndex);
  }
}

function expectMetadataGenerationPredicate(
  source: string,
  column: string,
  label: string,
  terminals: ReadonlyArray<string> = [],
) {
  const statement = normalizedSql(source);
  const whereIndex = statement.toLowerCase().indexOf("where ");
  const active = `${column} = \${generationPredicate.indexGenerationId}::text`;
  const legacy = `\${generationPredicate.isLegacy}::boolean and ${column} is null`;
  const activeIndex = statement.indexOf(active);
  expect(whereIndex, `${label}: WHERE`).toBeGreaterThanOrEqual(0);
  expect(activeIndex, `${label}: active metadata generation predicate`).toBeGreaterThan(whereIndex);
  expect(statement, `${label}: positive legacy metadata predicate`).toContain(legacy);
  for (const terminal of terminals) {
    const terminalIndex = statement.toLowerCase().indexOf(terminal.toLowerCase());
    expect(terminalIndex, `${label}: ${terminal}`).toBeGreaterThan(activeIndex);
  }
}

function expectTypedGenerationWrite(source: string, label: string) {
  const statement = normalizedSql(source);
  expect(statement, `${label}: typed generation column`).toContain("index_generation_id");
  expect(statement, `${label}: exact typed generation value`).toContain(
    "${generationPredicate.indexGenerationId}::uuid",
  );
  expect(statement, `${label}: metadata generation value`).toContain(
    "generationMetadata(generationPredicate.indexGenerationId)",
  );
}

describe("indexing-v3-agent behavior", () => {
  it("admits only legacy rows or the exact active committed generation", () => {
    const visibility = {
      activeGenerationByDocument: new Map([["doc-a", "gen-active"]]),
      committedGenerationIds: new Set(["gen-active", "gen-other"]),
      knownLegacyDocumentIds: new Set(["doc-legacy"]),
    };

    expect(isVisibleCommittedGenerationRow({ document_id: "doc-a", generation_id: null }, visibility)).toBe(false);
    expect(isVisibleCommittedGenerationRow({ document_id: "doc-legacy", generation_id: null }, visibility)).toBe(true);
    expect(isVisibleCommittedGenerationRow({ document_id: "doc-unknown", generation_id: null }, visibility)).toBe(
      false,
    );
    expect(isVisibleCommittedGenerationRow({ document_id: "doc-a", generation_id: "gen-active" }, visibility)).toBe(
      true,
    );
    expect(isVisibleCommittedGenerationRow({ document_id: "doc-a", generation_id: "gen-other" }, visibility)).toBe(
      false,
    );
    expect(
      isVisibleCommittedGenerationRow({ document_id: "doc-missing", generation_id: "gen-active" }, visibility),
    ).toBe(false);
  });

  it("constructs generation visibility only from complete validated document authority", () => {
    const active = "1a2b3c4d-6666-4aaa-8bbb-000000000006";
    const visibility = buildGenerationVisibility(
      [
        { id: "doc-active", index_generation_id: active, metadata: { index_generation_id: active } },
        { id: "doc-legacy", index_generation_id: null, metadata: {} },
      ],
      ["doc-active", "doc-legacy"],
    );
    expect(visibility.activeGenerationByDocument).toEqual(new Map([["doc-active", active]]));
    expect(visibility.committedGenerationIds).toEqual(new Set([active]));
    expect(visibility.knownLegacyDocumentIds).toEqual(new Set(["doc-legacy"]));

    expect(() => buildGenerationVisibility([], ["doc-active"])).toThrow(/incomplete/i);
    expect(() =>
      buildGenerationVisibility(
        [{ id: "doc-active", index_generation_id: active, metadata: { index_generation_id: "not-a-generation" } }],
        ["doc-active"],
      ),
    ).toThrow(/malformed|mismatch/i);
    expect(() =>
      buildGenerationVisibility(
        [
          { id: "doc-active", index_generation_id: active, metadata: { index_generation_id: active } },
          { id: "doc-active", index_generation_id: null, metadata: {} },
        ],
        ["doc-active"],
      ),
    ).toThrow(/overlap/i);
    expect(() =>
      buildGenerationVisibility([{ id: "doc-active", index_generation_id: active, metadata: {} }], ["doc-active"]),
    ).toThrow(/incomplete|mismatch/i);
    expect(() =>
      buildGenerationVisibility(
        [{ id: "doc-legacy", index_generation_id: null, metadata: { index_generation_id: null } }],
        ["doc-legacy"],
      ),
    ).toThrow(/mismatch/i);
  });

  it("binds each generation-aware read predicate to its own SQL statement before decisions", () => {
    const sourceLoader = agentFunction(
      "async function loadSourceAnchoredSummarySources",
      "async function persistSourceAnchoredSummary",
    );
    expect(normalizedSql(sourceLoader)).toContain(
      "chunk.index_generation_id = ${indexGenerationId}::uuid order by chunk.chunk_index asc, chunk.id asc",
    );
    expect(normalizedSql(sourceLoader)).toContain(
      "image.index_generation_id = ${indexGenerationId}::uuid and image.searchable is true order by image.clinical_relevance_score desc nulls last",
    );
    const ensureSummary = agentFunction("async function ensureSummary", "function unitsFromStructured");
    expect(ensureSummary).toContain("normalizeSourceAnchoredSummary(candidate");
    expect(ensureSummary).toContain("sources.authority");
    expect(ensureSummary).not.toMatch(/limit\s+24/i);

    // Generated labels now consume only the already validated summary projection.
    expect(indexingAgentSource).not.toContain("upsertGeneratedLabelsFromParsedArtifacts");
    expect(indexingAgentSource).toContain('edgeMutation(job, "persist_ingestion_summary_projection"');

    const sections = agentFunction(
      "async function ensureSectionsFromChunks",
      "async function upsertMemoryCardsFromSections",
    );
    expectTypedGenerationPredicate(
      statementWithin(sections, "const existing = await sql", "if ((existing[0]?.count", "section repair count"),
      "index_generation_id",
      "section repair count",
    );
    expectTypedGenerationPredicate(
      statementWithin(
        sections,
        "const chunkRows = await sql",
        "const chunks = visibleGenerationRows",
        "section repair chunks",
      ),
      "index_generation_id",
      "section repair chunks",
      ["order by chunk_index", "limit 24"],
    );

    const cards = agentFunction(
      "async function upsertMemoryCardsFromSections",
      "async function upsertSectionIndexUnits",
    );
    expectTypedGenerationPredicate(
      statementWithin(
        cards,
        "const sectionRows = await sql",
        "const sections = visibleGenerationRows",
        "memory card section input",
      ),
      "index_generation_id",
      "memory card section input",
      ["order by section_index", "limit 16"],
    );

    const sectionUnits = agentFunction(
      "async function upsertSectionIndexUnits",
      "async function upsertVisualArtifacts",
    );
    const sectionUnitInput = statementWithin(
      sectionUnits,
      "const sectionRows = await sql",
      "const sections = visibleGenerationRows",
      "section index-unit input",
    );
    expectTypedGenerationPredicate(sectionUnitInput, "c.index_generation_id", "section index-unit lateral chunk", [
      "order by case when c.id",
      "limit 1",
    ]);
    expectTypedGenerationPredicate(sectionUnitInput, "s.index_generation_id", "section index-unit section", [
      "order by s.section_index",
    ]);

    const visualArtifacts = agentFunction(
      "async function upsertVisualArtifacts",
      "async function upsertCoreEmbeddingFields",
    );
    expectTypedGenerationPredicate(
      statementWithin(
        visualArtifacts,
        "const imageRows = await sql",
        "const images = visibleGenerationRows",
        "visual image input",
      ),
      "index_generation_id",
      "visual image input",
      ["order by page_number"],
    );

    const quality = agentFunction("async function updateQuality", "async function completionGate");
    expectTypedGenerationPredicate(
      statementWithin(quality, "from public.document_index_units", "image_counts as (", "quality index-unit counts"),
      "index_generation_id",
      "quality index-unit counts",
    );
    expectTypedGenerationPredicate(
      statementWithin(quality, "from public.document_images", "u.visual_units", "quality image counts"),
      "index_generation_id",
      "quality image counts",
    );

    const visualDecision = agentFunction("async function needsVisualArtifacts", "async function updateAgentJobStatus");
    expectTypedGenerationPredicate(
      statementWithin(
        visualDecision,
        "from public.document_images",
        ") as eligible_images",
        "visual decision image count",
      ),
      "index_generation_id",
      "visual decision image count",
    );
    expectTypedGenerationPredicate(
      statementWithin(
        visualDecision,
        "from public.document_index_units",
        ") as generated_visual_units",
        "visual decision unit count",
      ),
      "index_generation_id",
      "visual decision unit count",
    );

    const protectedScan = agentFunction("async function assertPublicSourceWorkerPolicy", "async function processJob");
    expectTypedGenerationPredicate(
      statementWithin(
        protectedScan,
        "const rows = await sql",
        "return visibleGenerationRows",
        "protected-source chunk scan",
      ),
      "chunk.index_generation_id",
      "protected-source chunk scan",
      ["order by chunk.chunk_index", "limit ${limit}", "offset ${offset}"],
    );
  });

  it("binds generated family writes to the current fenced generation", () => {
    for (const name of [
      "replace_indexing_v3_sections",
      "replace_indexing_v3_memory_cards",
      "replace_indexing_v3_visual_artifacts",
      "replace_indexing_v3_core_embeddings",
    ]) {
      const body = fencedSqlBody(name);
      expect(body).toContain(
        "public.assert_current_ingestion_attempt(p_fence,(p_fence->>'expected_generation_id')::uuid)",
      );
      expect(body).toContain("'index_generation_id',v_generation");
      expect(body).toContain("'ingestion_lease_token',p_fence->>'lease_token'");
      expect(indexingAgentSource).toContain(`edgeMutation(job, "${name}"`);
    }
    const summary = fencedSqlBody("persist_ingestion_summary_projection");
    expect(summary).toContain("coalesce(v_summary.metadata,'{}'::jsonb) || p_summary->'metadata'");
    expect(summary).toContain(
      "v_label->'metadata'->>'index_generation_id' is distinct from p_fence->>'expected_generation_id'",
    );
  });

  it("generation-bounds each repair and replacement in the SQL domain owner", () => {
    for (const name of [
      "replace_indexing_v3_sections",
      "replace_indexing_v3_memory_cards",
      "replace_indexing_v3_visual_artifacts",
      "replace_indexing_v3_core_embeddings",
    ]) {
      const sql = fencedSqlBody(name);
      for (const deletion of sql.matchAll(/delete from public\.document_[^;]+;/g)) {
        expect(deletion[0]).toContain("document_id=v_document_id");
        expect(deletion[0]).toContain("index_generation_id=v_generation");
        expect(deletion[0]).toContain("metadata->>'generated_by'='indexing-v3-agent'");
      }
    }
    expect(indexingAgentSource).not.toMatch(/(?:insert into|delete from|update) public\.document_/);
  });

  it("blocks protected or incomplete public-source policy before provider or artifact work", async () => {
    expect(
      publicSourceWorkerPolicyViolation(
        {
          corpus_scope: "australian_public",
          source_catalogue_key: "wa-health",
          source_policy_version: "australian-source-policy-v1",
          content_mode: "indexed_content",
          licence_policy: "public_index_permitted",
          public_source_lifecycle: "shadow",
          source_policy_checked: true,
        },
        true,
      ),
    ).toBe("protected_source_identity");
    expect(publicSourceWorkerPolicyViolation({ corpus_scope: "australian_public" }, false)).toBe(
      "public_source_policy_invalid",
    );

    const edgeSource = String(
      await import("node:fs/promises").then((fs) =>
        fs.readFile(new URL("../supabase/functions/indexing-v3-agent/index.ts", import.meta.url), "utf8"),
      ),
    );
    const processStart = sourceSegment(
      edgeSource,
      "async function processJob",
      "let gate = await completionGate(job)",
      {
        label: "indexing-v3-agent public-source preflight",
      },
    );
    expect(processStart).toContain("assertPublicSourceWorkerPolicy(job, visibility)");
  });

  it("normalizes protected identities identically across acquisition and worker boundaries", () => {
    for (const value of [
      "Health<em>direct</em>",
      "Health direct",
      "Health&amp;direct",
      "Health&Tab;direct",
      "Health&NewLine;direct",
      "Health&#9direct",
      "Health&#9 direct",
      "Health&nbsp direct",
      "Health&#100;irect",
      "Health&#x64;irect",
      "Health&#100irect",
      "Health&#x64irect",
      "Health&#0;direct",
      "Health&#1;direct",
      "Health&#55296;direct",
      "Health&#x110000;direct",
      "He&afr;lthdirect",
      "Healthd&ifr;rect",
      "Health&dd;irect",
      "Health&DifferentialD;irect",
      "Australian Medicines Hand-book",
      "Australian Medicines Hand book",
      "Australian Medicines&Tab;Handbook",
      "Australian Medicines&#9Handbook",
      "Australian Medicines Hand&#98;ook",
      "Australian Medicines H&afr;ndbook",
      "Therapeutic\u200bGuidelines",
      "Therapeutic&NewLine;Guidelines",
      "Therapeutic&#10Guidelines",
      "Therapeutic Guide&#108;ines",
      "Therapeu&tscr;ic Guidelines",
      "Health&direct",
      "Health&di!rect",
      "Health&ltdirect",
      "Health&gtdirect",
      "Therapeutic&Guidelines",
      "Australian&Medicines&Handbook",
      "Health<direct",
      "Health<!--direct",
      "Health< direct",
    ]) {
      expect(forbiddenPublicSourceIdentity(value)).not.toBeNull();
    }
  });

  it("scans actual worker chunk rows through the shared protected-identity normalizer", async () => {
    for (const content of [
      "Health&Tab;direct guidance",
      "Health&#9direct guidance",
      "Health&nbsp direct guidance",
      "Health&#100;irect guidance",
      "Health&#x64;irect guidance",
      "Health&#100irect guidance",
      "Health&#x64irect guidance",
      "Health&#0;direct guidance",
      "Health&#1;direct guidance",
      "Health&#55296;direct guidance",
      "Health&#x110000;direct guidance",
      "He&afr;lthdirect guidance",
      "Healthd&ifr;rect guidance",
      "Health&dd;irect guidance",
      "Health&DifferentialD;irect guidance",
      "Australian Medicines&Tab;Handbook excerpt",
      "Australian Medicines&#9Handbook excerpt",
      "Australian Medicines Hand&#98;ook excerpt",
      "Australian Medicines H&afr;ndbook excerpt",
      "Therapeutic&NewLine;Guidelines advice",
      "Therapeutic&#10Guidelines advice",
      "Therapeutic Guide&#108;ines advice",
      "Therapeu&tscr;ic Guidelines advice",
    ]) {
      expect(protectedPublicSourceChunkContents([{ content }])).toBe(true);
    }

    const edgeSource = String(
      await import("node:fs/promises").then((fs) =>
        fs.readFile(new URL("../supabase/functions/indexing-v3-agent/index.ts", import.meta.url), "utf8"),
      ),
    );
    const scan = sourceSegment(
      edgeSource,
      "async function assertPublicSourceWorkerPolicy",
      "async function processJob",
      {
        label: "indexing-v3-agent protected content scan",
      },
    );
    expect(scan).toContain("select chunk.content");
    expect(scan).toContain("scanProtectedPublicSourceChunkPages(");
    expect(scan).toContain("limit ${limit}");
    expect(scan).not.toContain("chunk.content ~*");
  });

  it("pins the shared WHATWG decoder as an Edge-compatible direct dependency", () => {
    const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
      dependencies?: Record<string, string>;
    };
    const lock = JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url), "utf8")) as {
      packages?: Record<
        string,
        { dependencies?: Record<string, string>; version?: string; dev?: boolean; license?: string }
      >;
    };
    const denoLock = JSON.parse(readFileSync(new URL("../deno.lock", import.meta.url), "utf8")) as {
      workspace?: { packageJson?: { dependencies?: string[] } };
    };
    expect(manifest.dependencies?.entities).toBe("^8.0.0");
    expect(lock.packages?.[""]?.dependencies?.entities).toBe("^8.0.0");
    expect(lock.packages?.["node_modules/entities"]).toMatchObject({
      version: "8.0.0",
      license: "BSD-2-Clause",
    });
    expect(lock.packages?.["node_modules/entities"]?.dev).not.toBe(true);
    expect(denoLock.workspace?.packageJson?.dependencies).toContain("npm:entities@8");

    const policySource = readFileSync(
      new URL("../supabase/functions/_shared/public-source-policy.ts", import.meta.url),
      "utf8",
    );
    expect(policySource).toContain('import { decodeHTML } from "entities";');
    expect(policySource).not.toContain("jsdom");
  });

  it("retains protected identity state across the real 500-row worker page boundary", async () => {
    const firstPage = Array.from({ length: 500 }, (_, index) => ({
      content: index === 498 ? "Australian" : index === 499 ? "Medicines" : "x",
    }));
    const first = protectedPublicSourceChunkPage(firstPage);
    expect(first.containsProtectedSourceContent).toBe(false);

    const second = protectedPublicSourceChunkPage([{ content: "Handbook" }], first.streamState);
    expect(second.containsProtectedSourceContent).toBe(true);

    const pageReads: Array<[number, number]> = [];
    await expect(
      scanProtectedPublicSourceChunkPages(async (offset, limit) => {
        pageReads.push([offset, limit]);
        return offset === 0 ? firstPage : [{ content: "Handbook" }];
      }),
    ).resolves.toBe(true);
    expect(pageReads).toEqual([
      [0, 500],
      [500, 500],
    ]);

    const edgeSource = readFileSync(
      new URL("../supabase/functions/indexing-v3-agent/index.ts", import.meta.url),
      "utf8",
    );
    const scan = sourceSegment(
      edgeSource,
      "async function assertPublicSourceWorkerPolicy",
      "async function processJob",
      {
        label: "indexing-v3-agent paged protected-content scan",
      },
    );
    expect(scan).toContain("scanProtectedPublicSourceChunkPages(");
  });

  it("retains bounded content-free scanner state across arbitrarily long removable separators", async () => {
    const firstPage = Array.from({ length: 500 }, (_, index) => ({
      content: index === 498 ? "Health" : index === 499 ? ".".repeat(300) : "x",
    }));
    const finalPage = [{ content: "direct" }];
    const first = protectedPublicSourceChunkPage(firstPage);
    const second = protectedPublicSourceChunkPage(finalPage, first.streamState);
    const pageReads: Array<[number, number]> = [];
    const paged = await scanProtectedPublicSourceChunkPages(async (offset, limit) => {
      pageReads.push([offset, limit]);
      return offset === 0 ? firstPage : finalPage;
    });

    expect(protectedPublicSourceChunkContents([...firstPage, ...finalPage])).toBe(true);
    const snapshot = (first.streamState as unknown as { snapshot(): Record<string, unknown> }).snapshot();
    const veryLong = protectedPublicSourceChunkPage([{ content: ".".repeat(100_000) }], first.streamState).streamState;
    const veryLongSnapshot = (veryLong as unknown as { snapshot(): Record<string, unknown> }).snapshot();
    expect(Object.keys(veryLongSnapshot)).toEqual(Object.keys(snapshot));
    expect(
      Object.values(veryLongSnapshot).every((value) => typeof value === "number" || typeof value === "boolean"),
    ).toBe(true);
    expect(second.containsProtectedSourceContent).toBe(true);
    expect(paged).toBe(true);
    expect(pageReads).toEqual([
      [0, 500],
      [500, 500],
    ]);
  });

  it("preserves spaced-token identity state across removable formatting characters", async () => {
    const firstPage = Array.from({ length: 500 }, (_, index) => ({
      content: index === 498 ? "e" : index === 499 ? "\u200b".repeat(300) : ".",
    }));
    const finalPage = [{ content: "TG" }];

    expect(protectedPublicSourceChunkContents([...firstPage, ...finalPage])).toBe(true);
    await expect(
      scanProtectedPublicSourceChunkPages(async (offset) => (offset === 0 ? firstPage : finalPage)),
    ).resolves.toBe(true);
  });

  it("preserves a split named character reference at the worker page boundary", async () => {
    const firstPage = Array.from({ length: 500 }, (_, index) => ({
      content: index === 499 ? "He&af" : "x",
    }));
    const finalPage = [{ content: "r;lthdirect" }];
    const pageReads: Array<[number, number]> = [];

    await expect(
      scanProtectedPublicSourceChunkPages(async (offset, limit) => {
        pageReads.push([offset, limit]);
        return offset === 0 ? firstPage : finalPage;
      }),
    ).resolves.toBe(true);
    expect(pageReads).toEqual([
      [0, 500],
      [500, 500],
    ]);
  });

  it("streams unlimited references, tags, and comments across worker pages", async () => {
    const fixtures = [
      [
        Array.from({ length: 500 }, (_, index) => ({
          content: index === 498 ? "Health&#" : index === 499 ? "0".repeat(300) : ".",
        })),
        [{ content: "100;irect" }],
      ],
      [
        Array.from({ length: 500 }, (_, index) => ({
          content:
            index === 498 ? "Health<" : index === 499 ? `section data-safe="${"a".repeat(300)}>still-quoted"` : ".",
        })),
        [{ content: ">direct" }],
      ],
      [
        Array.from({ length: 500 }, (_, index) => ({
          content: index === 499 ? "Health<!--" : ".",
        })),
        Array.from({ length: 500 }, (_, index) => ({
          content: index === 0 ? `${"a".repeat(300)}>still-comment` : ".",
        })),
        [{ content: "-->direct" }],
      ],
    ] as const;

    for (const pages of fixtures) {
      const reads: Array<[number, number]> = [];
      expect(protectedPublicSourceChunkContents(pages.flat())).toBe(true);
      await expect(
        scanProtectedPublicSourceChunkPages(async (offset, limit) => {
          reads.push([offset, limit]);
          return pages[Math.floor(offset / 500)] ?? [];
        }),
      ).resolves.toBe(true);
      expect(reads).toEqual(pages.map((_, index) => [index * 500, 500]));
    }
  });

  it("continues named, numeric, and spaced-acronym identity state across three worker pages", async () => {
    const fixtures = [
      ["He&af", "r;", ".", "lthdirect"],
      ["Health&#x6", "4", ".", "irect"],
      ["e&ts", "cr;", "\u200b", "G"],
    ] as const;

    for (const [pageOneTail, pageTwoStart, pageTwoSeparator, pageThreeStart] of fixtures) {
      const pages = [
        Array.from({ length: 500 }, (_, index) => ({ content: index === 499 ? pageOneTail : "." })),
        Array.from({ length: 500 }, (_, index) => ({
          content: index === 0 ? pageTwoStart : pageTwoSeparator,
        })),
        [{ content: pageThreeStart }],
      ];
      const reads: Array<[number, number]> = [];

      expect(protectedPublicSourceChunkContents(pages.flat())).toBe(true);
      await expect(
        scanProtectedPublicSourceChunkPages(async (offset, limit) => {
          reads.push([offset, limit]);
          return pages[Math.floor(offset / 500)] ?? [];
        }),
      ).resolves.toBe(true);
      expect(reads).toEqual([
        [0, 500],
        [500, 500],
        [1000, 500],
      ]);
    }
  });

  it("preserves malformed entity and markup text across real worker pages", async () => {
    for (const value of [
      "Health&direct",
      "Health&di!rect",
      "Health&ltdirect",
      "Health&gtdirect",
      "Therapeutic&Guidelines",
      "Australian&Medicines&Handbook",
      "Health<direct",
      "Health<!--direct",
      "Health< direct",
    ]) {
      const reads: Array<[number, number]> = [];
      await expect(
        scanProtectedPublicSourceChunkPages(async (offset, limit) => {
          reads.push([offset, limit]);
          return offset < value.length ? [{ content: value[offset] ?? "" }] : [];
        }, 1),
      ).resolves.toBe(true);
      expect(reads.length).toBeGreaterThan(1);
    }
  });

  it("reconsumes adjacent malformed starters across one-code-point worker pages", async () => {
    for (const value of [
      "Health&&#100;irect",
      "Health&&amp;direct",
      "Health<<em>direct",
      "Health<&#100;irect",
      "Health&&&&#100;irect",
      "Health<<<<em>direct",
      "Healthd&not&#105;rect",
      "Health&lt&#100;irect",
      "Health&lt<em>direct",
      "TherapeuticGu&not&#105;deline",
      "AustralianMed&not&#105;cinesHandbook",
      "Healthd&not&&#105;rect",
      "Health&lt<<em>direct",
    ]) {
      const reads: Array<[number, number]> = [];
      await expect(
        scanProtectedPublicSourceChunkPages(async (offset, limit) => {
          reads.push([offset, limit]);
          return offset < value.length ? [{ content: value[offset] ?? "" }] : [];
        }, 1),
      ).resolves.toBe(true);
      expect(reads).toEqual(Array.from({ length: value.length }, (_, index) => [index, 1]));
    }
  });

  it("keeps malformed lexical speculation fixed-size and content-free", () => {
    const entityState = protectedPublicSourceChunkPage([{ content: `Health&di${"x".repeat(100_000)}` }]).streamState;
    const markupState = protectedPublicSourceChunkPage([
      { content: `Health<direct${"x".repeat(100_000)}` },
    ]).streamState;
    const legacyCheckpointState = protectedPublicSourceChunkPage([{ content: "Health&lt" }]).streamState;
    const checkpointBeforeExcess = legacyCheckpointState.snapshot();
    const checkpointAfterExcess = protectedPublicSourceChunkPage(
      [{ content: "d".repeat(100_000) }],
      legacyCheckpointState,
    ).streamState.snapshot();
    const repeatedStarterSnapshot = protectedPublicSourceChunkPage([
      { content: `Health${"&".repeat(100_000)}` },
    ]).streamState.snapshot();
    const entitySnapshot = entityState.snapshot();
    const markupSnapshot = markupState.snapshot();

    expect(Object.keys(entitySnapshot)).toEqual(Object.keys(markupSnapshot));
    expect(Object.keys(entitySnapshot)).toEqual(Object.keys(repeatedStarterSnapshot));
    expect(Object.keys(checkpointBeforeExcess)).toEqual(Object.keys(checkpointAfterExcess));
    expect(checkpointBeforeExcess.entityCheckpointCount).toBeGreaterThan(0);
    expect(checkpointAfterExcess.entityCheckpointCount).toBeLessThanOrEqual(
      checkpointAfterExcess.entityCheckpointLimit,
    );
    for (const snapshot of [
      entitySnapshot,
      markupSnapshot,
      repeatedStarterSnapshot,
      checkpointBeforeExcess,
      checkpointAfterExcess,
    ]) {
      expect(Object.values(snapshot).every((value) => typeof value === "number" || typeof value === "boolean")).toBe(
        true,
      );
      expect(JSON.stringify(snapshot).length).toBeLessThan(1_024);
    }
    expect(Object.values(entityState).every((value) => typeof value === "function")).toBe(true);
    expect(Object.values(markupState).every((value) => typeof value === "function")).toBe(true);
    expect(markupState.finish()).toBe("healthdirect");
  });

  it("schedules agent retries until the attempt budget is exhausted", () => {
    const retry = agentFailureDecision({ attemptCount: 2, maxAttempts: 3, nowMs: 1_000, retryDelayMs: 30_000 });
    expect(retry).toEqual({
      shouldRetry: true,
      status: "retry_pending",
      jobStatus: "pending",
      enrichmentStatus: "pending",
      nextRunAt: "1970-01-01T00:00:31.000Z",
    });

    expect(agentFailureDecision({ attemptCount: 3, maxAttempts: 3, nowMs: 1_000, retryDelayMs: 30_000 })).toEqual({
      shouldRetry: false,
      status: "failed",
      jobStatus: "failed",
      enrichmentStatus: "failed",
      nextRunAt: null,
    });
  });
  it("maps canonical strict-gate rows into pass/fail completion decisions", () => {
    const complete = completionGateFromRow(gateRow());
    expect(complete.result).toBe("complete");
    expect(complete.missing).toEqual([]);
    expect(complete.counts).toEqual({
      sections: 3,
      memory_cards: 8,
      generated_labels: 4,
      index_units: 12,
    });
    expect(complete.presence).toEqual({ title_embedding: true, summary_embedding: true });

    const missingLabels = completionGateFromRow(
      gateRow({
        generated_labels: 0,
        missing: ["generated_labels"],
        gate_passed: false,
      }),
    );
    expect(missingLabels.result).toBe("deferred");
    expect(missingLabels.counts.generated_labels).toBe(0);
    expect(missingLabels.missing).toEqual(["generated_labels"]);
  });

  it("plans only the missing enrichment stages before expensive work", () => {
    const plan = missingArtifactPlan(
      completionGateFromRow(
        gateRow({
          sections: 0,
          index_units: 0,
          title_embedding: false,
          summary_embedding: true,
          missing: ["sections", "index_units", "title_embedding"],
          gate_passed: false,
        }),
      ),
    );

    expect(plan).toEqual({
      needs_sections: true,
      needs_memory: false,
      needs_labels: false,
      needs_index_units: true,
      needs_title_embedding: true,
      needs_summary_embedding: false,
      needs_core_embeddings: true,
      needs_quality_promotion: false,
    });
  });

  it("defers missing generated labels without falsely completing the job", () => {
    const gate = completionGateFromRow(
      gateRow({
        generated_labels: 0,
        missing: ["generated_labels"],
        gate_passed: false,
      }),
    );
    const plan = missingArtifactPlan(gate);
    const decision = deferralDecision({
      metadata: { indexing_v3_agent_deferral_count: 1 },
      gate,
      maxDeferrals: 6,
      nowMs: Date.UTC(2026, 5, 25, 12, 0, 0),
    });

    expect(plan.needs_labels).toBe(true);
    expect(decision.status).toBe("deferred");
    expect(decision.enrichment_status).toBe("pending");
    expect(decision.terminal).toBe(false);
    expect(decision.details).toEqual(
      expect.objectContaining({
        code: "completion_gate_deferred",
        missing: ["generated_labels"],
        deferral_count: 2,
        max_deferrals: 6,
      }),
    );
    expect(decision.next_run_at).toBe("2026-06-25T12:30:00.000Z");
  });

  it("treats missing sections as a terminal artifact problem after repair attempts fail", () => {
    const gate = completionGateFromRow(
      gateRow({
        sections: 0,
        memory_cards: 0,
        index_units: 0,
        missing: ["sections", "memory_cards", "index_units"],
        gate_passed: false,
      }),
    );
    const plan = missingArtifactPlan(gate);
    const decision = deferralDecision({
      metadata: { indexing_v3_agent_deferral_count: 0 },
      gate,
      maxDeferrals: 6,
      nowMs: Date.UTC(2026, 5, 25, 12, 0, 0),
    });

    expect(plan.needs_sections).toBe(true);
    expect(plan.needs_index_units).toBe(true);
    expect(plan.needs_memory).toBe(true);
    expect(decision.status).toBe("needs_enrichment_artifacts");
    expect(decision.enrichment_status).toBe("needs_enrichment_artifacts");
    expect(decision.next_run_at).toBeNull();
  });

  it("does not rerun visual extraction once generated visual units exist", () => {
    expect(shouldRunVisualArtifacts({ eligible_images: 0, generated_visual_units: 0 })).toBe(false);
    expect(shouldRunVisualArtifacts({ eligible_images: 3, generated_visual_units: 0 })).toBe(true);
    expect(shouldRunVisualArtifacts({ eligible_images: 3, generated_visual_units: 2 })).toBe(false);
  });

  it("promotes quality only when artifacts are complete but quality is stale", () => {
    const staleQuality = missingArtifactPlan(
      completionGateFromRow(
        gateRow({
          quality_extraction_quality: "partial",
          quality_score: 0.7,
        }),
      ),
    );
    const currentQuality = missingArtifactPlan(completionGateFromRow(gateRow()));

    expect(staleQuality.needs_quality_promotion).toBe(true);
    expect(currentQuality.needs_quality_promotion).toBe(false);
  });

  it("documents that local worker visual units satisfy visual artifact capture", async () => {
    const edgeSource = String(
      await import("node:fs/promises").then((fs) =>
        fs.readFile(new URL("../supabase/functions/indexing-v3-agent/index.ts", import.meta.url), "utf8"),
      ),
    );

    expect(edgeSource).toContain("metadata->>'generated_by' = 'local-worker'");
    expect(edgeSource).toContain("metadata->>'source' = 'visual_intelligence'");
  });

  it("routes each generated family through one atomic fixed-domain transaction", () => {
    for (const [name, nextName, rpc] of [
      ["upsertMemoryCardsFromSections", "upsertSectionIndexUnits", "replace_indexing_v3_memory_cards"],
      ["upsertSectionIndexUnits", "upsertVisualArtifacts", "replace_indexing_v3_sections"],
      ["upsertVisualArtifacts", "upsertCoreEmbeddingFields", "replace_indexing_v3_visual_artifacts"],
      ["upsertCoreEmbeddingFields", "updateQuality", "replace_indexing_v3_core_embeddings"],
    ]) {
      const body = agentFunction(`async function ${name}`, `async function ${nextName}`);
      expect(body).toContain(`await edgeMutation(job, "${rpc}"`);
      expect(body).not.toContain("await sql.begin");
      const sql = fencedSqlBody(rpc);
      expect(sql.indexOf("assert_current_ingestion_attempt")).toBeLessThan(sql.indexOf("delete from public.document_"));
      expect(sql.indexOf("delete from public.document_")).toBeLessThan(sql.indexOf("insert into public.document_"));
    }
  });

  it("normalizes metadata counters for repeated idempotent runs", () => {
    expect(metadataNumber({ indexing_v3_agent_deferral_count: "4" }, "indexing_v3_agent_deferral_count")).toBe(4);
    expect(metadataNumber({ indexing_v3_agent_deferral_count: "bad" }, "indexing_v3_agent_deferral_count")).toBe(0);
    expect(metadataNumber(null, "indexing_v3_agent_deferral_count", 2)).toBe(2);
  });

  it("parses strict completion RPC rows returned as direct table columns", () => {
    const result = parseJobStatusRpcResult(
      {
        ok: true,
        gate_passed: true,
        status: "completed",
        missing: [],
      },
      "complete_strict_enrichment_job",
    );

    expect(result).toEqual({
      ok: true,
      gate_passed: true,
      status: "completed",
      missing: [],
    });
  });

  it("parses strict completion RPC rows returned as nested jsonb function columns", () => {
    const result = parseJobStatusRpcResult(
      {
        complete_strict_enrichment_job: {
          ok: true,
          gate_passed: true,
          status: "completed",
          missing: [],
        },
      },
      "complete_strict_enrichment_job",
    );

    expect(result).toEqual({
      ok: true,
      gate_passed: true,
      status: "completed",
      missing: [],
    });
  });

  it("treats null missing arrays from completion RPCs as no missing artifacts", () => {
    const result = parseJobStatusRpcResult(
      {
        complete_strict_enrichment_job: {
          ok: true,
          gate_passed: true,
          status: "completed",
          missing: null,
        },
      },
      "complete_strict_enrichment_job",
    );

    expect(result).toEqual({
      ok: true,
      gate_passed: true,
      status: "completed",
      missing: [],
    });
  });
});

describe("source-anchored summary Edge contract", () => {
  it("uses the shared coverage selector and source-anchored normalizer instead of first-N summary text", () => {
    expect(indexingAgentSource).toContain('from "../_shared/source-anchored-summary.ts"');
    expect(indexingAgentSource).toContain('from "../_shared/indexing-coverage.ts"');
    const ensureSummary = agentFunction("async function ensureSummary", "function unitsFromStructured");
    const sourceLoader = agentFunction(
      "async function loadSourceAnchoredSummarySources",
      "async function persistSourceAnchoredSummary",
    );
    expect(sourceLoader).toContain("selectCoverageAwarePromptChunks");
    expect(ensureSummary).toContain("buildSourceAnchoredFallbackPayload");
    expect(ensureSummary).toContain("normalizeSourceAnchoredSummary");
    expect(ensureSummary).not.toMatch(/limit\s+24/i);
    expect(ensureSummary).not.toContain("v3-summary-heuristic");
  });

  it("requires active generation and validates the summary before the first completion-gate decision", () => {
    const processJob = agentFunction("async function processJob", "Deno.serve");
    const policy = processJob.indexOf("await assertPublicSourceWorkerPolicy");
    const generation = processJob.indexOf("requireSourceAnchoredSummaryGeneration");
    const sources = processJob.indexOf("await loadSourceAnchoredSummarySources");
    const summary = processJob.indexOf("await ensureSummary");
    const gate = processJob.indexOf("await completionGate");
    expect(policy).toBeGreaterThan(-1);
    expect(generation).toBeGreaterThan(policy);
    expect(sources).toBeGreaterThan(generation);
    expect(summary).toBeGreaterThan(sources);
    expect(gate).toBeGreaterThan(summary);
  });

  it("pages and caps exact-generation chunks/images before deterministic selection", () => {
    const loader = agentFunction("async function loadSourceAnchoredSummarySources", "async function ensureSummary");
    expect(loader).toContain("SOURCE_ANCHORED_SOURCE_PAGE_SIZE");
    expect(loader).toContain("SOURCE_ANCHORED_MAX_CHUNKS");
    expect(loader).toContain("SOURCE_ANCHORED_MAX_IMAGES");
    expect(loader).toContain("source_anchored_summary_source_limit_exceeded");
    expect(loader).toMatch(/index_generation_id\s*=\s*\$\{indexGenerationId\}::uuid/);
    expect(loader).toMatch(/order by chunk\.chunk_index asc, chunk\.id asc/);
    expect(loader).toMatch(
      /clinical_relevance_score desc nulls last, image\.page_number asc nulls last, image\.id asc/,
    );
  });

  it("persists summary, labels and completion marker through one atomic projection operation", () => {
    const persistence = agentFunction("async function persistSourceAnchoredSummary", "async function ensureSummary");
    expect(persistence).toContain('edgeMutation(job, "persist_ingestion_summary_projection"');
    expect(persistence).toContain("projectSourceAnchoredLabels(payload)");
    expect(persistence).not.toMatch(/insert into|delete from|update public/);
    const sql = fencedSqlBody("persist_ingestion_summary_projection");
    expect(sql).toContain("source_anchored_summary_projection_complete_v1");
    expect(sql).toContain("delete from public.document_labels");
    expect(sql).toContain("update public.documents set metadata");
  });

  it("uses independent structured-model authority and checks every persisted summary projection", () => {
    const ensureSummary = agentFunction("async function ensureSummary", "function unitsFromStructured");
    expect(indexingAgentSource).toContain("OPENAI_INDEXING_MODEL");
    expect(ensureSummary).not.toContain("candidateRecord.model");
    expect(ensureSummary).toContain("persistedSourceAnchoredSummaryProjectionMatches");
    expect(normalizedSql(ensureSummary)).toContain(
      "select summary, clinical_specifics, source_chunk_ids, source_image_ids, model, metadata, generated_at",
    );
  });

  it("keeps zero-label Edge fallback provisional and deferred by the unchanged strict gate", async () => {
    const { buildSourceAnchoredFallbackPayload } =
      await import("../supabase/functions/_shared/source-anchored-summary");
    const fallback = buildSourceAnchoredFallbackPayload(
      {
        documentId: "11111111-1111-4111-8111-111111111111",
        indexGenerationId: "22222222-2222-4222-8222-222222222222",
        expectedStructuredModel: "gpt-indexing-test",
        expectedStructuredModelVersion: "rag-deep-memory-v1",
        selectedChunks: [
          {
            id: "33333333-3333-4333-8333-333333333333",
            page_number: 1,
            index_generation_id: "22222222-2222-4222-8222-222222222222",
          },
        ],
        selectedImages: [],
      },
      { generatedAt: "2026-09-01T00:00:00.000Z" },
    );
    const gate = completionGateFromRow(
      gateRow({ generated_labels: fallback.labels.length, missing: ["generated_labels"], gate_passed: false }),
    );
    expect(fallback.labels).toEqual([]);
    expect(gate).toMatchObject({ result: "deferred", missing: ["generated_labels"] });
    expect(indexingAgentSource).not.toMatch(/generated_labels\s*>?=\s*0/);
    expect(indexingAgentSource).not.toContain("complete_fallback_without_labels");
  });

  it("keeps Node and Edge coverage vectors identical including a late high-yield section", async () => {
    const edge = await import("../supabase/functions/_shared/indexing-coverage");
    const node = await import("@/lib/indexing-coverage");
    const chunks = Array.from({ length: 60 }, (_, chunk_index) => ({
      id: `chunk-${chunk_index}`,
      page_number: chunk_index + 1,
      chunk_index,
      section_heading: chunk_index % 12 === 0 ? `Section ${chunk_index}` : null,
      content: chunk_index === 52 ? "ANC threshold requires urgent specialist review." : `Routine ${chunk_index}`,
    }));
    expect(edge.selectCoverageAwarePromptChunks(chunks)).toEqual(node.selectCoverageAwarePromptChunks(chunks));
    expect(edge.selectCoverageAwarePromptChunks(chunks).chunks.map((chunk) => chunk.id)).toContain("chunk-52");
  });
});
