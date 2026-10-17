import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CHUNKER_VERSION,
  DOCUMENT_CHUNKER_VERSION,
  buildChunks,
  chunkTextWithOverlap,
  countWrappedDoseUnitLines,
  detectHeading,
} from "@/lib/chunking";
import type { ChunkInput } from "@/lib/types";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const chunkingSourcePath = path.join(repoRoot, "src/lib/chunking.ts");

function buildMultiPageClinicalFixture(): ChunkInput[] {
  const tableBlock = [
    "| Scenario | Concentration | Amount | Volume | Interval |",
    "| --- | --- | --- | --- | --- |",
    "| Q-A | 0.5 mg/mL | 2 mg | 4 mL | 24 h |",
    "| Q-B | 0.5 mg/mL | 3.5 mg | 7 mL | 48 h |",
  ].join("\n");

  const page1Text = [
    "OFFICIAL: Sensitive",
    "Mental Health Guideline",
    "1. Clozapine Initiation and Dosing",
    "",
    "Baseline full blood count and absolute neutrophil count must be checked before starting clozapine therapy.",
    "Commence clozapine at a starting dose of",
    "12.5",
    "mg",
    "once daily on day one, then titrate cautiously according to response.",
    "For adults with neutropenia or agranulocytosis, do not administer clozapine until haematology review is complete.",
    "Page 1 of 3",
    "Printed uncontrolled document",
  ].join("\n");

  const page2Text = [
    "Mental Health Guideline",
    "Continue weekly blood test monitoring and escalate any neutropenia to the prescriber immediately.",
    "When the patient has unstable neutrophil counts, must not restart clozapine without specialist approval.",
    "",
    tableBlock,
    "",
    "Rows A and B are alternative synthetic QA scenarios. Do not combine them.",
    "Page 2 of 3",
    "Printed uncontrolled document",
  ].join("\n");

  const page3Text = [
    "Mental Health Guideline",
    "2. Lithium Maintenance and Monitoring",
    "",
    "Check renal function, thyroid function, and serum calcium at baseline and every 6 months.",
    "Thiamine",
    "300",
    "mg",
    "daily when clinically indicated.",
    "In patients with acute renal toxicity, withhold lithium and check serum concentration urgently.",
    "Page 3 of 3",
    "Printed uncontrolled document",
  ].join("\n");

  return [
    {
      documentId: "doc-regex-hoist-fixture",
      pageNumber: 1,
      pageText: page1Text,
      metadata: { source: "synthetic-guideline" },
      images: [
        {
          id: "clozapine-flowchart-1",
          caption: "Clozapine baseline FBC and ANC monitoring flowchart.",
          pageNumber: 1,
          sourceKind: "figure",
        },
      ],
    },
    {
      documentId: "doc-regex-hoist-fixture",
      pageNumber: 2,
      pageText: page2Text,
      metadata: { source: "synthetic-guideline" },
      images: [
        {
          id: "native-qa-table-2",
          caption: "",
          pageNumber: 2,
          sourceKind: "table_crop",
          tableColumns: ["Scenario", "Concentration", "Amount", "Volume", "Interval"],
          tableRows: [
            ["Scenario", "Concentration", "Amount", "Volume", "Interval"],
            ["Q-A", "0.5 mg/mL", "2 mg", "4 mL", "24 h"],
            ["Q-B", "0.5 mg/mL", "3.5 mg", "7 mL", "48 h"],
          ],
          tableTextSnippet: tableBlock,
        },
      ],
    },
    {
      documentId: "doc-regex-hoist-fixture",
      pageNumber: 3,
      pageText: page3Text,
      metadata: { source: "synthetic-guideline" },
      images: [],
    },
  ];
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("chunking hoisted regex determinism and safety (#BGDVPD)", () => {
  it("produces identical chunks, keys, spans, synopses, table links, and dose joins across repeated page-mode runs", () => {
    const first = buildChunks(buildMultiPageClinicalFixture());
    const second = buildChunks(buildMultiPageClinicalFixture());
    const third = buildChunks(buildMultiPageClinicalFixture());

    expect(second).toEqual(first);
    expect(third).toEqual(first);
    expect(first.length).toBeGreaterThanOrEqual(3);

    for (const chunk of first) {
      expect(chunk.metadata.chunker_version).toBe(CHUNKER_VERSION);
      expect(chunk.metadata.chunk_key).toMatch(/^[0-9a-f]{32}$/);
      expect(Array.isArray(chunk.metadata.source_spans)).toBe(true);
      expect(chunk.retrieval_synopsis?.length).toBeGreaterThan(0);
      expect(chunk.retrieval_synopsis).not.toContain("OFFICIAL");
    }

    const joinedContent = first.map((chunk) => chunk.content).join("\n");
    expect(joinedContent).toContain("12.5 mg");
    expect(joinedContent).toContain("300 mg");
    expect(joinedContent).toContain("| Q-A | 0.5 mg/mL | 2 mg | 4 mL | 24 h |");
    expect(first.flatMap((chunk) => chunk.image_ids)).toContain("native-qa-table-2");
    expect(countWrappedDoseUnitLines(buildMultiPageClinicalFixture()[0].pageText)).toBe(1);
    expect(detectHeading("Clozapine Initiation and Dosing:\nBody text")).toBe("Clozapine Initiation and Dosing");
  });

  it("produces identical chunks, keys, cross-page source spans, and synopses across repeated document-mode runs", async () => {
    vi.resetModules();
    vi.stubEnv("CHUNK_STRATEGY", "document");
    const mod = await import("@/lib/chunking");

    const first = mod.buildChunks(buildMultiPageClinicalFixture());
    const second = mod.buildChunks(buildMultiPageClinicalFixture());
    const third = mod.buildChunks(buildMultiPageClinicalFixture());

    expect(second).toEqual(first);
    expect(third).toEqual(first);
    expect(first.length).toBeGreaterThanOrEqual(2);

    for (const chunk of first) {
      expect(chunk.metadata.chunker_version).toBe(DOCUMENT_CHUNKER_VERSION);
      expect(chunk.metadata.chunk_key).toMatch(/^[0-9a-f]{32}$/);
      expect(Array.isArray(chunk.metadata.source_spans)).toBe(true);
      expect(chunk.retrieval_synopsis?.length).toBeGreaterThan(0);
    }

    const crossPageChunk = first.find((chunk) => chunk.metadata.page_start === 1 && chunk.metadata.page_end === 2);
    expect(crossPageChunk).toBeDefined();
    expect(crossPageChunk?.content).toContain("12.5 mg");
    expect(crossPageChunk?.content).toContain("Continue weekly blood test monitoring");
  });

  it("preserves clinical prohibition overlap boundaries identically across repeated calls", () => {
    const text = [
      "Clinical guideline for rapid tranquilisation in psychiatric emergencies.",
      "Ensure continuous monitoring of pulse oximetry, respiratory rate, and blood pressure following administration.",
      "For adults with unstable cardiorespiratory status, do not administer intramuscular olanzapine concomitantly with intravenous benzodiazepines due to fatal risk.",
      "Appropriate resuscitation equipment and flumazenil must be readily accessible in the clinical environment.",
    ].join(" ");

    const baseline = chunkTextWithOverlap(text, 190, 35);
    expect(baseline.length).toBeGreaterThan(1);
    for (let i = 0; i < 5; i += 1) {
      const next = chunkTextWithOverlap(text, 190, 35);
      expect(next).toEqual(baseline);
      for (const chunk of next) {
        if (chunk.includes("intramuscular olanzapine concomitantly")) {
          expect(chunk).toContain("do not administer");
        }
      }
    }
  });

  it("hoists sentenceBoundaryGlobal and never uses .test() or .exec() on stateful /g or /y module regexes", () => {
    const source = readFileSync(chunkingSourcePath, "utf8");

    const fnStart = source.indexOf("function chunkTextBySentence(");
    expect(fnStart).toBeGreaterThan(0);
    const nextFnStart = source.indexOf("\nfunction ", fnStart + 1);
    const chunkTextBySentenceBody = source.slice(fnStart, nextFnStart > fnStart ? nextFnStart : undefined);
    expect(chunkTextBySentenceBody).not.toContain("new RegExp(");
    expect(chunkTextBySentenceBody).toContain("sentenceBoundaryGlobal");

    // Collect every module-scope regex identifier that carries the stateful /g or /y flag.
    const statefulRegexNames = new Set<string>(["sentenceBoundaryGlobal"]);
    const regexDeclPattern =
      /^const\s+([A-Za-z0-9_]+)\s*=\s*(?:\/(?:\\.|[^/\\\r\n])+\/([dgimsuvy]*)|new RegExp\([^;]+,\s*"([^"]*)"\));/gm;
    for (const match of source.matchAll(regexDeclPattern)) {
      const name = match[1];
      const flags = match[2] ?? match[3] ?? "";
      if (flags.includes("g") || flags.includes("y")) {
        statefulRegexNames.add(name);
      }
    }

    expect(statefulRegexNames.size).toBeGreaterThan(5);
    for (const name of statefulRegexNames) {
      const statefulCallPattern = new RegExp(`\\b${name}\\.(?:test|exec)\\s*\\(`);
      expect(
        statefulCallPattern.test(source),
        `Stateful regex "${name}" (/g or /y) must never be used with .test() or .exec()`,
      ).toBe(false);
    }
  });
});
