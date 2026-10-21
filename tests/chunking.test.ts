import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CHUNKER_VERSION,
  DOCUMENT_CHUNKER_VERSION,
  OversizedTableRowError,
  MAX_ATOMIC_TABLE_UTF8_BYTES,
  buildChunks,
  buildImageTag,
  chunkContentKey,
  chunkTextWithOverlap,
  countWrappedDoseUnitLines,
} from "../src/lib/chunking";

describe("chunkTextWithOverlap", () => {
  it("keeps short text as one chunk", () => {
    expect(chunkTextWithOverlap("Lithium monitoring is required.", 2000, 200)).toEqual([
      "Lithium monitoring is required.",
    ]);
  });

  it("creates overlapping chunks for long text", () => {
    const text = Array.from({ length: 40 }, (_, index) => `Sentence ${index}.`).join(" ");
    const chunks = chunkTextWithOverlap(text, 120, 20);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].length).toBeLessThanOrEqual(140);
    expect(chunks.join(" ")).toContain("Sentence 0.");
  });

  // M17 (audit 2026-07-01): overlap >= chunkSize previously made the sentence
  // window loop spin forever (no forward progress), hanging the worker.
  it("terminates when overlap >= chunkSize (M17)", () => {
    const text = `${"Withhold clozapine and review blood results. ".repeat(60)}`.trim();
    const chunks = chunkTextWithOverlap(text, 200, 200);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join(" ")).toContain("Withhold clozapine");
  });

  // M14: only standalone page footers are noise. An inline page reference in a
  // clinical sentence must never delete the whole line.
  it("keeps clinical lines containing inline page references (M14)", () => {
    const text = "Give paracetamol, refer to p 3 for dosing.\nPage 3 of 12\nWithhold clozapine if ANC is low.";
    const chunks = chunkTextWithOverlap(text, 2000, 200);
    const joined = chunks.join(" ");
    expect(joined).toContain("refer to p 3 for dosing");
    expect(joined).toContain("Withhold clozapine");
    expect(joined).not.toMatch(/Page 3 of 12/);
  });

  // PDF extraction (PyMuPDF get_text with sort=True) wraps a dose across lines
  // in narrow table cells ("12.5\nmg"). The bare unit line is <= 2 chars, so the
  // short-line debris rule used to delete it, indexing a unitless "12.5".
  it("rejoins a dose unit wrapped onto its own line instead of deleting it as debris", () => {
    const text = "Commence clozapine at a starting dose of\n12.5\nmg\nonce daily.";
    const joined = chunkTextWithOverlap(text, 2000, 200).join(" ");
    expect(joined).toContain("12.5 mg");
  });

  it("rejoins wrapped units after bare-integer doses and longer unit tokens", () => {
    const text = "Thiamine\n300\nmg\ndaily. Fludrocortisone\n100\nmcg\nmane.";
    const joined = chunkTextWithOverlap(text, 2000, 200).join(" ");
    expect(joined).toContain("300 mg");
    expect(joined).toContain("100 mcg");
  });

  it("still drops a lone unit token with no preceding dose number", () => {
    const text = "Withhold clozapine.\nmg\nRepeat the full blood count.";
    const joined = chunkTextWithOverlap(text, 2000, 200).join(" ");
    expect(joined).not.toMatch(/\bmg\b/);
    expect(joined).toContain("Withhold clozapine.");
    expect(joined).toContain("Repeat the full blood count.");
  });

  it("does not merge a unit token into a standalone page footer", () => {
    const text = "Monitor lithium levels.\nPage 3 of 12\nmg\nReview renally.";
    const joined = chunkTextWithOverlap(text, 2000, 200).join(" ");
    expect(joined).not.toMatch(/Page 3 of 12/);
    expect(joined).not.toMatch(/\bmg\b/);
  });

  // countWrappedDoseUnitLines shares its predicate with the rejoin, so these
  // cases mirror the rejoin tests above — it must count exactly the units the
  // pre-fix chunker deleted. Used by scripts/measure-wrapped-dose-prevalence.ts
  // to quantify the bug in the live corpus without a re-index.
  it("counts wrapped dose units on raw page text and ignores non-bug shapes", () => {
    expect(countWrappedDoseUnitLines("dose of\n12.5\nmg\nonce daily")).toBe(1);
    expect(countWrappedDoseUnitLines("Thiamine\n300\nmg\ndaily. Fludrocortisone\n100\nmcg\nmane.")).toBe(2);
    // No preceding number, and a page footer before the unit: neither counts.
    expect(countWrappedDoseUnitLines("Withhold clozapine.\nmg\nrepeat")).toBe(0);
    expect(countWrappedDoseUnitLines("Monitor levels.\nPage 3 of 12\nmg\nreview")).toBe(0);
    // Already-inline "12.5 mg" is correct extraction, not a wrapped unit.
    expect(countWrappedDoseUnitLines("Commence at 12.5 mg once daily.")).toBe(0);
  });

  it("prefers paragraph boundaries before falling back to sentence windows", () => {
    const chunks = chunkTextWithOverlap("Heading\n\nFirst clinical paragraph.\n\nSecond clinical paragraph.", 32, 4);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]).toContain("Heading");
    expect(chunks[1]).toContain("First clinical paragraph");
  });

  it("carries overlap across paragraph-path chunk boundaries (IDX-H5)", () => {
    // Three distinct paragraphs that together exceed chunkSize, forcing a flush. With
    // overlap the start of a later chunk must repeat the tail of the previous one so a
    // clinical instruction spanning a paragraph boundary keeps shared context.
    const paraA = `If ANC falls below 0.5 then ${"alpha ".repeat(20)}`.trim();
    const paraB = `withhold clozapine and escalate ${"bravo ".repeat(20)}`.trim();
    const paraC = `Repeat the full blood count daily ${"charlie ".repeat(20)}`.trim();
    const text = [paraA, paraB, paraC].join("\n\n");

    const chunks = chunkTextWithOverlap(text, 200, 60);

    expect(chunks.length).toBeGreaterThan(1);
    // At least one later chunk should begin with content carried from the previous chunk's
    // tail (overlap present), rather than starting cleanly at a new paragraph.
    const hasOverlap = chunks.slice(1).some((chunk, index) => {
      const previous = chunks[index];
      const tailWords = previous.split(/\s+/).slice(-4).join(" ");
      return tailWords.length > 0 && chunk.includes(tailWords);
    });
    expect(hasOverlap).toBe(true);
  });

  it("keeps a small markdown table atomic instead of splitting it as prose (IDX-H6)", () => {
    const table = [
      "| Parameter | Threshold | Action |",
      "| --- | --- | --- |",
      "| ANC | < 0.5 | Withhold clozapine |",
      "| ANC | 0.5-1.0 | Repeat FBC daily |",
    ].join("\n");
    const text = `Monitoring guidance.\n\n${table}\n\nFollow up as needed.`;

    const chunks = chunkTextWithOverlap(text, 2000, 200);
    const tableChunk = chunks.find((chunk) => chunk.includes("| Parameter | Threshold | Action |"));
    expect(tableChunk).toBeDefined();
    // The whole table stays together in a single chunk: header + both data rows.
    expect(tableChunk).toContain("| ANC | < 0.5 | Withhold clozapine |");
    expect(tableChunk).toContain("| ANC | 0.5-1.0 | Repeat FBC daily |");
  });

  it("splits an oversized table on row boundaries and repeats the header (IDX-H6)", () => {
    const header = ["| Parameter | Threshold | Action |", "| --- | --- | --- |"];
    const rows = Array.from(
      { length: 30 },
      (_, index) => `| Row ${index} | < ${index}.0 | Withhold and escalate clinical response ${index} |`,
    );
    const table = [...header, ...rows].join("\n");

    const chunks = chunkTextWithOverlap(table, 400, 40);
    const tableChunks = chunks.filter((chunk) => chunk.includes("| Parameter | Threshold | Action |"));

    // Multiple chunks, and every table chunk repeats the header row so values are never
    // severed from their column headers.
    expect(tableChunks.length).toBeGreaterThan(1);
    for (const chunk of tableChunks) {
      expect(chunk).toContain("| Parameter | Threshold | Action |");
    }
    // No data row is lost across the split.
    const combined = tableChunks.join("\n");
    for (let index = 0; index < 30; index += 1) {
      expect(combined).toContain(`| Row ${index} |`);
    }
  });
});

describe("image-aware chunks", () => {
  it("preserves image captions as inline searchable context", () => {
    const tag = buildImageTag({
      id: "image-1",
      caption: "Table showing lithium baseline monitoring.",
    });

    expect(tag).toContain("[[IMAGE_DATA_START]]");
    expect(tag).toContain("lithium baseline monitoring");
    expect(tag).toContain("[[IMAGE_DATA_END]]");
  });

  it("preserves table labels, titles, and extracted table text as searchable context", () => {
    const tag = buildImageTag({
      id: "table-1",
      caption: "Agitation management table.",
      imageType: "clinical_table",
      sourceKind: "table_crop",
      tableLabel: "Table 1",
      tableTitle: "Agitation and arousal rating scale and associated management",
      tableRole: "clinical",
      tableTextSnippet: "Score 5 | Highly aroused and violent toward others and/or property",
    });

    expect(tag).toContain("Source kind: table_crop");
    expect(tag).toContain("Table label: Table 1");
    expect(tag).toContain("Table role: clinical");
    expect(tag).toContain("Agitation and arousal rating scale");
    expect(tag).toContain("Score 5");
  });

  it("attaches referenced image ids to chunks", () => {
    const chunks = buildChunks([
      {
        documentId: "doc-1",
        pageNumber: 2,
        pageText: "Medication monitoring guidance.",
        metadata: { content_hash: "abc", embedding_model: "text-embedding-3-small" },
        images: [
          {
            id: "image-1",
            caption: "Medication monitoring flowchart.",
            pageNumber: 2,
          },
        ],
      },
    ]);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].image_ids).toContain("image-1");
    expect(chunks[0].page_number).toBe(2);
    expect(chunks[0].metadata).toMatchObject({
      content_hash: "abc",
      embedding_model: "text-embedding-3-small",
      page_start: 2,
      page_end: 2,
      source_spans: expect.arrayContaining([
        expect.objectContaining({
          page_number: 2,
          excerpt: expect.stringContaining("Medication monitoring guidance"),
        }),
      ]),
    });
  });

  it("caps inline image and table context so narrative chunks are not overwhelmed", () => {
    const chunks = buildChunks([
      {
        documentId: "doc-1",
        pageNumber: 3,
        pageText: "Clozapine monitoring narrative guidance for blood tests and escalation.",
        metadata: {},
        images: Array.from({ length: 5 }, (_, index) => ({
          id: `table-${index + 1}`,
          caption: `Clinical table ${index + 1}`,
          sourceKind: "table_crop",
          tableTitle: `Monitoring table ${index + 1}`,
          tableTextSnippet: "ANC threshold | withhold clozapine | repeat FBC",
          pageNumber: 3,
        })),
      },
    ]);

    const content = chunks.map((chunk) => chunk.content).join("\n");
    expect(content.match(/\[\[IMAGE_DATA_START\]\]/g)).toHaveLength(3);
    expect(content).toContain("additional image/table blocks");
    expect(content).toContain("Clozapine monitoring narrative guidance");
  });
});

describe("buildChunks dedupe", () => {
  it("dedupes same-page chunks despite punctuation and table-label noise", () => {
    const chunks = buildChunks([
      {
        documentId: "doc-1",
        pageNumber: 1,
        pageText: "Table: Lithium monitoring",
        metadata: { content_hash: "abc", embedding_model: "text-embedding-3-small" },
      },
      {
        documentId: "doc-1",
        pageNumber: 1,
        pageText: "Lithium-monitoring",
        metadata: { content_hash: "abc", embedding_model: "text-embedding-3-small" },
      },
    ]);

    expect(chunks.map((chunk) => chunk.content)).toEqual(["Table: Lithium monitoring"]);
  });
});

describe("section-aware chunking groundwork", () => {
  it("carries the previous section path onto a following page without a new heading", () => {
    const chunks = buildChunks([
      {
        documentId: "doc-1",
        pageNumber: 1,
        pageText: "Clozapine Monitoring\n\nBaseline FBC and ANC monitoring applies.",
        metadata: {},
      },
      {
        documentId: "doc-1",
        pageNumber: 2,
        pageText: "Continue weekly blood-test monitoring until clinically stable.",
        metadata: {},
      },
    ]);

    const pageTwoChunk = chunks.find((chunk) => chunk.page_number === 2);
    expect(pageTwoChunk?.section_path).toContain("Clozapine Monitoring");
    expect(pageTwoChunk?.metadata.section_path).toContain("Clozapine Monitoring");
  });

  it("removes repeated page boilerplate while preserving clinical narrative", () => {
    const chunks = buildChunks([
      {
        documentId: "doc-1",
        pageNumber: 1,
        pageText:
          "Mental Health Guideline\n\nLithium Monitoring\n\nCheck renal function.\n\nPrinted uncontrolled document",
        metadata: {},
      },
      {
        documentId: "doc-1",
        pageNumber: 2,
        pageText:
          "Mental Health Guideline\n\nReview lithium levels after dose changes.\n\nPrinted uncontrolled document",
        metadata: {},
      },
    ]);

    const content = chunks.map((chunk) => chunk.content).join("\n");
    expect(content).not.toContain("Mental Health Guideline");
    expect(content).not.toContain("Printed uncontrolled document");
    expect(content).toContain("Check renal function");
    expect(content).toContain("Review lithium levels");
  });

  it("drops protective-marking banner lines from chunk content", () => {
    const chunks = buildChunks([
      {
        documentId: "doc-1",
        pageNumber: 1,
        pageText: "OFFICIAL: Sensitive\n\nLithium Monitoring\n\nCheck renal function before starting lithium therapy.",
        metadata: {},
      },
    ]);

    const content = chunks.map((chunk) => chunk.content).join("\n");
    expect(content).not.toContain("OFFICIAL");
    expect(content).toContain("Check renal function");
  });

  it("keeps the retrieval synopsis banner-free and never cut mid-word", () => {
    const longSentence =
      "Monitor lithium dose thresholds carefully and escalate abnormal results quickly because delayed review of toxicity increases the risk of renal impairment and neurotoxicity across the whole treatment pathway for every patient cohort.";
    const pageText = [
      "OFFICIAL: OFFICIAL Lithium Therapy - dose guidance requires monitoring.",
      longSentence,
      longSentence.replace("cohort", "cohort again"),
      longSentence.replace("cohort", "cohort as well"),
    ].join(" ");

    const chunks = buildChunks([{ documentId: "doc-1", pageNumber: 1, pageText, metadata: {} }]);
    const synopsis = chunks[0]?.retrieval_synopsis ?? "";

    expect(synopsis).not.toContain("OFFICIAL");
    expect(synopsis).toContain("Lithium Therapy - dose guidance requires monitoring");
    // The 720-char cap must land on a word boundary: the token before the
    // ellipsis has to be a complete word from the source text.
    expect(synopsis.endsWith("...")).toBe(true);
    const lastWord = (synopsis.slice(0, -3).trim().split(/\s+/).pop() ?? "").replace(/[.,;:]+$/, "");
    const sourceWords = new Set(pageText.split(/\s+/).map((word) => word.replace(/[.,;:]+$/, "")));
    expect(lastWord.length).toBeGreaterThan(0);
    expect(sourceWords.has(lastWord)).toBe(true);
  });

  it("keeps repeated clinical chunks on different pages instead of document-wide deduping them", () => {
    const repeatedMonitoringText =
      "Clozapine monitoring table\n\nANC threshold 0.5 x 10^9/L: withhold clozapine and repeat FBC daily.";
    const chunks = buildChunks([
      {
        documentId: "doc-1",
        pageNumber: 4,
        pageText: repeatedMonitoringText,
        metadata: {},
      },
      {
        documentId: "doc-1",
        pageNumber: 7,
        pageText: repeatedMonitoringText,
        metadata: {},
      },
    ]);

    expect(chunks.filter((chunk) => chunk.content.includes("ANC threshold 0.5 x 10^9/L"))).toHaveLength(2);
    expect(chunks.map((chunk) => chunk.page_number)).toEqual([4, 7]);
  });
});

describe("stable chunk identity (CI-4)", () => {
  it("stamps a stable chunk_key and chunker_version into metadata", () => {
    const chunks = buildChunks([
      { documentId: "doc-1", pageNumber: 1, pageText: "Check renal function before starting lithium.", metadata: {} },
    ]);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].metadata.chunker_version).toBe(CHUNKER_VERSION);
    expect(chunks[0].metadata.chunk_key).toMatch(/^[0-9a-f]{32}$/);
  });

  it("produces the same key across re-runs of identical input (idempotent re-index)", () => {
    const input = [{ documentId: "doc-1", pageNumber: 1, pageText: "Withhold clozapine if ANC is low.", metadata: {} }];
    const first = buildChunks(structuredClone(input));
    const second = buildChunks(structuredClone(input));
    expect(first[0].metadata.chunk_key).toBe(second[0].metadata.chunk_key);
  });

  it("is page-independent — identical content on different pages shares an identity", () => {
    const text = "ANC threshold guidance: withhold clozapine and repeat FBC daily.";
    const chunks = buildChunks([
      { documentId: "doc-1", pageNumber: 4, pageText: text, metadata: {} },
      { documentId: "doc-1", pageNumber: 7, pageText: text, metadata: {} },
    ]);
    expect(chunks).toHaveLength(2);
    expect(chunks[0].metadata.chunk_key).toBe(chunks[1].metadata.chunk_key);
  });

  it("changes the key when content or document differs, and ignores inline image tags", () => {
    const keyA = chunkContentKey("doc-1", "monitoring", "Withhold clozapine if ANC is low.");
    const keyDifferentContent = chunkContentKey("doc-1", "monitoring", "Continue clozapine and monitor weekly.");
    const keyDifferentDoc = chunkContentKey("doc-2", "monitoring", "Withhold clozapine if ANC is low.");
    expect(keyA).not.toBe(keyDifferentContent);
    expect(keyA).not.toBe(keyDifferentDoc);
    // Image-data tags are stripped before hashing, so attaching image context does not
    // change a chunk's stable identity.
    const withImageTag = chunkContentKey(
      "doc-1",
      "monitoring",
      "Withhold clozapine if ANC is low. [[IMAGE_DATA_START]] Image ID: x; Description: chart [[IMAGE_DATA_END]]",
    );
    expect(withImageTag).toBe(keyA);
  });
});

describe("document-mode chunking (CI-1)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  async function buildDocumentChunks(inputs: Parameters<typeof buildChunks>[0]) {
    vi.resetModules();
    vi.stubEnv("CHUNK_STRATEGY", "document");
    const mod = await import("../src/lib/chunking");
    return mod.buildChunks(inputs);
  }

  it("merges a section across a page break into a single cross-page chunk", async () => {
    const chunks = await buildDocumentChunks([
      {
        documentId: "doc-1",
        pageNumber: 1,
        pageText:
          "Clozapine Monitoring\n\nBaseline full blood count and absolute neutrophil count must be checked before starting clozapine therapy for the patient.",
        metadata: {},
      },
      {
        documentId: "doc-1",
        pageNumber: 2,
        pageText:
          "Continue weekly blood test monitoring and escalate any neutropenia to the prescriber and haematology team immediately.",
        metadata: {},
      },
    ]);

    // The section (heading on page 1, continuation on page 2) chunks together, so the
    // page-1 baseline requirement and the page-2 continuation land in one chunk.
    const spanning = chunks.find(
      (chunk) => chunk.content.includes("Baseline full blood count") && chunk.content.includes("weekly blood test"),
    );
    expect(spanning).toBeDefined();
    expect(spanning?.metadata.page_start).toBe(1);
    expect(spanning?.metadata.page_end).toBe(2);
    expect(spanning?.page_number).toBeNull();
    expect(spanning?.section_path).toContain("Clozapine Monitoring");
    // A cross-page chunk records a source span for each contributing page.
    const spanPageNumbers = (spanning?.metadata.source_spans as Array<{ page_number: number | null }>).map(
      (span) => span.page_number,
    );
    expect(spanPageNumbers).toEqual(expect.arrayContaining([1, 2]));
    const pageTwoSpan = (
      spanning?.metadata.source_spans as Array<{
        page_number: number | null;
        excerpt: string;
        character_start: number | null;
      }>
    ).find((span) => span.page_number === 2);
    expect(pageTwoSpan?.excerpt).toContain("Continue weekly blood test monitoring");
    expect(pageTwoSpan?.excerpt).not.toContain("Baseline full blood count");
    expect(pageTwoSpan?.character_start).not.toBeNull();
  });

  it("does not merge across a section boundary introduced by a new heading", async () => {
    const chunks = await buildDocumentChunks([
      {
        documentId: "doc-1",
        pageNumber: 1,
        pageText: "Section One\n\nAlpha guidance about clozapine baseline monitoring requirements for every patient.",
        metadata: {},
      },
      {
        documentId: "doc-1",
        pageNumber: 2,
        pageText: "Section Two\n\nBravo guidance about lithium renal function checks and thyroid monitoring tests.",
        metadata: {},
      },
    ]);

    const sectionTwo = chunks.find((chunk) => chunk.content.includes("Bravo guidance"));
    expect(sectionTwo?.metadata.page_start).toBe(2);
    expect(sectionTwo?.metadata.page_end).toBe(2);
    expect(sectionTwo?.section_path).toContain("Section Two");
    // The page-1 section must not have absorbed page-2 content.
    const sectionOne = chunks.find((chunk) => chunk.content.includes("Alpha guidance"));
    expect(sectionOne?.content).not.toContain("Bravo guidance");
    expect(sectionOne?.metadata.page_end).toBe(1);
  });

  it("still stamps the stable chunk_key and chunker_version in document mode", async () => {
    const chunks = await buildDocumentChunks([
      {
        documentId: "doc-1",
        pageNumber: 1,
        pageText: "Check renal function before starting lithium therapy.",
        metadata: {},
      },
    ]);
    expect(chunks[0].metadata.chunker_version).toBe(DOCUMENT_CHUNKER_VERSION);
    expect(chunks[0].metadata.chunk_strategy).toBe("document");
    expect(chunks[0].metadata.chunk_key).toMatch(/^[0-9a-f]{32}$/);
  });

  it("keeps document-mode images scoped to pages that contributed to the chunk", async () => {
    vi.stubEnv("CHUNK_SIZE", "900");
    const pageOneBody = Array.from({ length: 90 }, (_, index) => `Baseline monitoring instruction ${index}.`).join(" ");
    const chunks = await buildDocumentChunks([
      {
        documentId: "doc-1",
        pageNumber: 1,
        pageText: `Monitoring Guidance\n\n${pageOneBody}`,
        metadata: {},
        images: [],
      },
      {
        documentId: "doc-1",
        pageNumber: 2,
        pageText: "Continuation dosing table text for later review.",
        metadata: {},
        images: [
          {
            id: "page-2-table",
            caption: "Later-page table.",
            pageNumber: 2,
            sourceKind: "table_crop",
            tableTitle: "Monitoring Guidance",
          },
        ],
      },
    ]);

    const pageOneChunk = chunks.find((chunk) => chunk.metadata.page_start === 1 && chunk.metadata.page_end === 1);
    expect(pageOneChunk).toBeDefined();
    expect(pageOneChunk?.image_ids).not.toContain("page-2-table");
  });

  it("preserves repeated document-mode clinical chunks when page context differs", async () => {
    const repeatedMonitoringText =
      "Clozapine monitoring table\n\nANC threshold 0.5 x 10^9/L: withhold clozapine and repeat FBC daily.";
    const chunks = await buildDocumentChunks([
      {
        documentId: "doc-1",
        pageNumber: 4,
        pageText: repeatedMonitoringText,
        metadata: {},
      },
      {
        documentId: "doc-1",
        pageNumber: 7,
        pageText: repeatedMonitoringText,
        metadata: {},
      },
    ]);

    expect(chunks.filter((chunk) => chunk.content.includes("ANC threshold 0.5 x 10^9/L"))).toHaveLength(2);
    expect(chunks.map((chunk) => chunk.metadata.page_start)).toEqual([4, 7]);
  });
});

// Audit 2026-10-20 ING-B-01: the line-noise filter must drop only lines that are
// boilerplate as a whole. Synthetic probe strings from the audit (A3b, A7).
describe("line-noise filter keeps clinical content lines (ING-B-01)", () => {
  const joinedChunks = (text: string) => chunkTextWithOverlap(text, 2000, 200).join("\n");

  it("keeps a clinical line that also mentions copyright", () => {
    const joined = joinedChunks(
      "Neutrophil thresholds\nThis table is copyright of the issuing service; withhold clozapine if ANC < 1.5.\nRepeat the full blood count daily.",
    );
    expect(joined).toContain("withhold clozapine if ANC < 1.5");
  });

  it("keeps dose lines and wrapped prose lines that contain a web address", () => {
    const joined = joinedChunks(
      [
        "Max dose 400 mg daily, see www.example.org/dosing",
        "Maximum 400 mg daily for elderly patients; see",
        "www.example.org/lithium for the full protocol and the renal adjustment table.",
        "Avoid use in pregnancy.",
      ].join("\n"),
    );
    expect(joined).toContain("Max dose 400 mg daily, see www.example.org/dosing");
    expect(joined).toContain("for the full protocol and the renal adjustment table.");
  });

  it("still drops lines that are only a copyright notice, download stamp or bare web address", () => {
    const joined = joinedChunks(
      [
        "Check renal function before starting lithium.",
        "Copyright © 2026 Example Health Service, Example Region, Example Directorate. All rights reserved.",
        "Downloaded from www.example.org on 1 March 2026 by guest",
        "www.example.org",
        "Review lithium levels after dose changes.",
      ].join("\n"),
    );
    expect(joined).not.toMatch(/copyright|all rights reserved|downloaded from|www\.example\.org/i);
    expect(joined).toContain("Check renal function before starting lithium.");
    expect(joined).toContain("Review lithium levels after dose changes.");
  });

  it("keeps short answer words and numeric scale values", () => {
    const joined = joinedChunks(
      [
        "Is the patient pregnant?",
        "No",
        "Rating scale",
        "0",
        "1",
        "2",
        "3",
        "A score of 3 requires same-day review.",
      ].join("\n"),
    );
    expect(joined.split("\n")).toEqual(
      expect.arrayContaining(["No", "0", "1", "2", "3", "A score of 3 requires same-day review."]),
    );
  });

  it("still drops an isolated page number and stray punctuation debris", () => {
    const joined = joinedChunks(["4", "Monitor lithium levels.", "-", "Review renal function.", "12"].join("\n"));
    expect(joined).toBe("Monitor lithium levels.\nReview renal function.");
  });
});

// Audit 2026-10-20 ING-B-02: the repeated-line filter must remove running
// headers and footers, not repeated clinical headings or instructions.
describe("repeated-line filter keeps clinical headings (ING-B-02)", () => {
  const page = (pageNumber: number, pageText: string) => ({ documentId: "doc-1", pageNumber, pageText, metadata: {} });

  it("keeps a clinical heading that repeats at the top of each page", () => {
    const chunks = buildChunks([
      page(1, "Clinical monitoring\nCheck lithium level 5 to 7 days after dose change."),
      page(2, "Clinical monitoring\nCheck renal function every 6 months."),
      page(3, "Clinical monitoring\nCheck thyroid function every 6 months."),
    ]);
    const withHeading = chunks.filter((chunk) => chunk.content.includes("Clinical monitoring"));
    expect(withHeading).toHaveLength(3);
  });

  it("keeps a repeated instruction that sits in the body of the page", () => {
    const body = (detail: string) =>
      [
        "Mental Health Guideline",
        `Assess ${detail} at every review.`,
        `Record ${detail} observations on the chart.`,
        `Escalate a change in ${detail} to the treating team.`,
        "Follow the local procedure for escalation.",
        "Document the outcome in the clinical record.",
        `Discuss ${detail} with the patient and carer.`,
        `Repeat the ${detail} assessment weekly.`,
        "Printed uncontrolled document",
      ].join("\n");
    const chunks = buildChunks([page(1, body("sedation")), page(2, body("hydration"))]);
    const content = chunks.map((chunk) => chunk.content).join("\n");
    expect(content.match(/Follow the local procedure for escalation\./g)).toHaveLength(2);
    expect(content).not.toContain("Mental Health Guideline");
    expect(content).not.toContain("Printed uncontrolled document");
  });

  it("still removes an organisation running header, but never a repeated line with a dose", () => {
    const chunks = buildChunks([
      page(1, "Mental Health Services\nCheck renal function.\nLithium guideline target 0.6 to 1.0 mmol/L"),
      page(2, "Mental Health Services\nReview lithium levels.\nLithium guideline target 0.6 to 1.0 mmol/L"),
    ]);
    const content = chunks.map((chunk) => chunk.content).join("\n");
    expect(content).not.toContain("Mental Health Services");
    expect(content.match(/target 0\.6 to 1\.0 mmol\/L/g)).toHaveLength(2);
  });

  it("never removes a repeated line that states a threshold without a unit", () => {
    const chunks = buildChunks([
      page(1, "Check FBC weekly.\nReview renal function.\nPer procedure, withhold clozapine if ANC < 1.5"),
      page(2, "Check lipids yearly.\nReview weight.\nPer procedure, withhold clozapine if ANC < 1.5"),
    ]);
    const content = chunks.map((chunk) => chunk.content).join("\n");
    expect(content.match(/withhold clozapine if ANC < 1\.5/g)).toHaveLength(2);
  });
});

// Audit 2026-10-20 ING-B-03: the extractor joins a table title, the markdown
// table and its footnote with single newlines. A long table on such a page must
// still split into row groups that repeat the header, not one oversized chunk.
describe("table-aware chunking with a title and footnote (ING-B-03)", () => {
  const rows = Array.from({ length: 120 }, (_, index) => `| Level ${index} | ${index}.0 mmol/L | Action ${index} |`);
  const pageText = [
    "Table 3. Synthetic lithium dose adjustment",
    "| Level | Concentration | Action |",
    "| --- | --- | --- |",
    ...rows,
    "Do not give lithium if the patient is dehydrated.",
  ].join("\n");

  it("splits the table into row groups that each repeat the title and header", () => {
    const chunks = chunkTextWithOverlap(pageText, 1200, 200);
    const tableChunks = chunks.filter((chunk) => chunk.includes("| Level ") && chunk.includes("mmol/L"));
    expect(tableChunks.length).toBeGreaterThan(3);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(1200);
    for (const chunk of tableChunks) {
      expect(chunk).toContain("Table 3. Synthetic lithium dose adjustment");
      expect(chunk).toContain("| Level | Concentration | Action |\n| --- | --- | --- |");
    }
    const combined = chunks.join("\n");
    for (const row of rows) expect(combined).toContain(row);
    expect(combined).toContain("Do not give lithium if the patient is dehydrated.");
  });

  it("keeps the immediately following clinical footnote with every row group", () => {
    const footnote = "Do not give lithium if the patient is dehydrated.";
    const chunks = chunkTextWithOverlap(pageText, 1200, 200);
    expect(chunks.length).toBeGreaterThan(3);
    for (const chunk of chunks) {
      expect(chunk).toContain("| Level | Concentration | Action |");
      expect(chunk).toContain(footnote);
      expect(chunk.length).toBeLessThanOrEqual(1200);
    }
    const emittedRows = chunks.flatMap((chunk) => chunk.split("\n").filter((line) => /^\| Level \d/.test(line)));
    expect(emittedRows).toEqual(rows);
  });

  it("attaches a marked table note without absorbing subsequent prose", () => {
    const note = "* Repeat the measurement before changing treatment.";
    const after = "Next section discusses discharge planning.";
    const chunks = chunkTextWithOverlap(
      [
        "Table 3. Monitoring",
        "| Level | Concentration | Action |",
        "| --- | --- | --- |",
        ...rows,
        note,
        "",
        after,
      ].join("\n"),
      1200,
      200,
    );
    const tableChunks = chunks.filter((chunk) => chunk.includes("| Level |"));
    for (const chunk of tableChunks) {
      expect(chunk).toContain(note);
      expect(chunk).not.toContain(after);
      expect(chunk.length).toBeLessThanOrEqual(1200);
    }
    expect(chunks).toContain(after);
    expect(chunks).not.toContain(note);
  });

  it("retains a complete wrapped conditional note on every table row group", () => {
    const note = "Note: Do not give lithium\nunless renal function has been assessed.";
    const chunks = chunkTextWithOverlap(
      ["Table 3. Monitoring", "| Level | Concentration | Action |", "| --- | --- | --- |", ...rows, note].join("\n"),
      1200,
      200,
    );
    expect(chunks.length).toBeGreaterThan(3);
    for (const chunk of chunks) {
      expect(chunk).toContain(note);
      expect(chunk).toContain("| Level | Concentration | Action |");
      expect(chunk.length).toBeLessThanOrEqual(1200);
    }
  });

  it("keeps an adjacent note block intact while reserving the next table's title", () => {
    const first = ["Table 1. First", "| Group | Action |", "| --- | --- |", "| A | Repeat measurement. |"];
    const note = "Note: Use the source condition\nunless a later review applies.";
    const second = ["Table 2. Second", "| Group | Review |", "| --- | --- |", "| B | Review the result. |"];
    const budget = [...first, note].join("\n").length;
    const chunks = chunkTextWithOverlap([...first, note, ...second].join("\n"), budget, 0);
    expect(chunks).toEqual([[...first, note].join("\n"), second.join("\n")]);
  });

  it("keeps prose before an untitled table and splits the table with its column header", () => {
    const prose = "Lithium monitoring applies to every patient on maintenance therapy.";
    const chunks = chunkTextWithOverlap(
      [prose, "| Level | Concentration | Action |", "| --- | --- | --- |", ...rows].join("\n"),
      1200,
      200,
    );
    expect(chunks.join("\n")).toContain(prose);
    const tableChunks = chunks.filter((chunk) => chunk.includes("| Level "));
    expect(tableChunks.length).toBeGreaterThan(3);
    for (const chunk of tableChunks) expect(chunk).toContain("| Level | Concentration | Action |");
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(1200);
  });

  it("repeats a title the extractor wrapped over two lines on every table chunk", () => {
    const titleLines = [
      "Table A2.1 Number of synthetic lithium dose steps associated with alternative ",
      "serum concentration thresholds, depending on renal function",
    ];
    const chunks = chunkTextWithOverlap(
      [
        "Dose steps are summarised in the table below (Table A2.1).",
        ...titleLines,
        "| Level | Concentration | Action |",
        "| --- | --- | --- |",
        ...rows,
      ].join("\n"),
      1200,
      200,
    );
    const tableChunks = chunks.filter((chunk) => chunk.includes("| Level ") && chunk.includes("mmol/L"));
    expect(tableChunks.length).toBeGreaterThan(3);
    for (const chunk of tableChunks) {
      expect(chunk).toContain(titleLines.map((line) => line.trim()).join("\n"));
    }
    expect(chunks.join("\n")).toContain("Dose steps are summarised in the table below (Table A2.1).");
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(1200);
  });
});

// Table cells stay atomic: a character target cannot justify splitting a
// clinical condition from the assertion or another cell it qualifies.
describe("bounded atomic table row overflow", () => {
  const header = "| Group | Action |\n| --- | --- |";
  const row = `| GROUP-A | Do not change treatment unless ${"the original condition remains applicable ".repeat(50).trim()}. |`;
  const hardOversizedRow = `| GROUP-A | ${"original condition ".repeat(500)} |`;

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("preserves an indivisible long row above the character target", () => {
    const text = `${header}\n${row}`;
    expect(text.length).toBeGreaterThan(400);
    expect(chunkTextWithOverlap(text, 400, 40)).toEqual([text]);
  });

  it("refuses an indivisible row beyond the hard ceiling with a content-free typed error", () => {
    const text = `${header}\n${hardOversizedRow}`;
    expect(() => chunkTextWithOverlap(text, 400, 40)).toThrow(OversizedTableRowError);
    try {
      chunkTextWithOverlap(text, 400, 40);
    } catch (error) {
      expect(error).toMatchObject({
        name: "OversizedTableRowError",
        code: "TABLE_ROW_EXCEEDS_CHUNK_BUDGET",
        message: "TABLE_ROW_EXCEEDS_CHUNK_BUDGET",
      });
      expect(JSON.stringify(error)).not.toContain("GROUP-A");
      expect(String(error)).not.toContain("original condition");
    }
  });

  it("keeps the complete bounded table when a row exceeds the preferred target", () => {
    const title = "Table 4. Synthetic monitoring";
    const note = "Note: Do not change treatment\nunless the original condition applies.";
    const before = "| GROUP-B | Repeat the measurement. |";
    const after = "| GROUP-C | Review the result. |";
    const text = [title, header, before, row, after, note].join("\n");
    expect(chunkTextWithOverlap(text, 250, 0)).toEqual([text]);
  });

  it("retains merged qualification bands with every newly admitted oversized action row", () => {
    const initial = "| INITIAL PHASE ONLY: applies to both following rows | |";
    const maintenance = "| MAINTENANCE ONLY: applies to the following row | |";
    const text = [header, initial, row, "| GROUP-B | Review the result. |", maintenance, "| GROUP-C | Repeat. |"].join(
      "\n",
    );
    expect(chunkTextWithOverlap(text, 400, 0)).toEqual([text]);
  });

  it("refuses a qualification-bearing table when its complete scope exceeds the hard ceiling", () => {
    const band = "| INITIAL PHASE ONLY: applies to following rows | |";
    const rows = Array.from({ length: 3 }, (_, index) => `| GROUP-${index} | ${"Original condition. ".repeat(150)} |`);
    const text = [header, band, ...rows].join("\n");
    expect(Buffer.byteLength(text)).toBeGreaterThan(MAX_ATOMIC_TABLE_UTF8_BYTES);
    expect(() => chunkTextWithOverlap(text, 400, 0)).toThrow(OversizedTableRowError);
  });

  it("does not co-pack a captioned table with prose past the hard table ceiling", () => {
    const table = ["Table 4. Monitoring", header, `| GROUP-A | ${"a".repeat(5900)} |`].join("\n");
    const prose = "Separate narrative. " + "b".repeat(4000);
    const chunks = chunkTextWithOverlap(`${table}\n\n${prose}`, 20000, 0);
    expect(chunks.join("\n")).toContain(prose);
    const tables = chunks.filter((chunk) => chunk.includes("| GROUP-A |"));
    expect(tables).toEqual([table]);
    for (const chunk of tables) expect(Buffer.byteLength(chunk)).toBeLessThanOrEqual(MAX_ATOMIC_TABLE_UTF8_BYTES);
  });

  it("accepts a row exactly at the character target including title and footnote", () => {
    const title = "Table 4. Synthetic monitoring";
    const note = "Note: Preserve the original clinical qualification.";
    const rows = ["| GROUP-A | Repeat the measurement. |", "| GROUP-B | Review the result. |"];
    const atomic = [title, header, rows[0], note].join("\n");
    const text = [title, header, ...rows, note].join("\n");
    const expected = rows.map((line) => [title, header, line, note].join("\n"));
    expect(chunkTextWithOverlap(text, atomic.length, 0)).toEqual(expected);
    expect(chunkTextWithOverlap(text, atomic.length - 1, 0)).toEqual([text]);
  });

  it("accepts exactly 8191 UTF-8 bytes including caption, header, row and wrapped note", () => {
    const title = "Table 4. Synthetic monitoring";
    const note = "Note: Preserve this qualification\nunless the original condition changes.";
    const prefix = [title, header, "| GROUP-A | "].join("\n");
    const suffix = ` |\n${note}`;
    const text = prefix + "a".repeat(MAX_ATOMIC_TABLE_UTF8_BYTES - Buffer.byteLength(prefix + suffix)) + suffix;
    expect(Buffer.byteLength(text)).toBe(8191);
    expect(chunkTextWithOverlap(text, 400, 0)).toEqual([text]);
    expect(() => chunkTextWithOverlap(text.replace("| GROUP-A | ", "| GROUP-A | a"), 400, 0)).toThrow(
      OversizedTableRowError,
    );
  });

  it("uses UTF-8 bytes for multibyte evidence rather than character length", () => {
    const prefix = `${header}\n| GROUP-A | `;
    const suffix = " |";
    const remaining = MAX_ATOMIC_TABLE_UTF8_BYTES - Buffer.byteLength(prefix + suffix);
    const text = prefix + "漢".repeat(Math.floor(remaining / 3)) + "a".repeat(remaining % 3) + suffix;
    expect(text.length).toBeLessThan(MAX_ATOMIC_TABLE_UTF8_BYTES);
    expect(Buffer.byteLength(text)).toBe(MAX_ATOMIC_TABLE_UTF8_BYTES);
    expect(chunkTextWithOverlap(text, 400, 0)).toEqual([text]);
    expect(() => chunkTextWithOverlap(text.replace("| GROUP-A | ", "| GROUP-A | 漢"), 400, 0)).toThrow(
      OversizedTableRowError,
    );
  });

  it("keeps a large header intact within the hard ceiling and refuses one beyond it", () => {
    const text = `| Group | ${"Original column qualification ".repeat(20).trim()} |\n| --- | --- |`;
    expect(chunkTextWithOverlap(text, 400, 0)).toEqual([text]);
    const giant = text.replace("Original column qualification", "q".repeat(MAX_ATOMIC_TABLE_UTF8_BYTES));
    expect(() => chunkTextWithOverlap(giant, 400, 0)).toThrow(OversizedTableRowError);
  });

  it("preserves a large attached qualification and refuses one beyond the hard ceiling", () => {
    const note = `Note: ${"Preserve the original qualification. ".repeat(20).trim()}`;
    const text = [header, "| GROUP-A | Repeat the measurement. |", note].join("\n");
    expect(chunkTextWithOverlap(text, 400, 0)).toEqual([text]);
    expect(() => chunkTextWithOverlap(`${text} ${"q".repeat(MAX_ATOMIC_TABLE_UTF8_BYTES)}`, 400, 0)).toThrow(
      OversizedTableRowError,
    );
  });

  it("enforces the byte ceiling even when a configured character target is larger", () => {
    expect(() => chunkTextWithOverlap(`${header}\n${hardOversizedRow}`, 20000, 0)).toThrow(OversizedTableRowError);
  });

  it("checks all rows before returning any earlier table group", () => {
    const text = [header, "| GROUP-B | Repeat measurement. |", hardOversizedRow].join("\n");
    expect(() => chunkTextWithOverlap(text, 400, 0)).toThrow(OversizedTableRowError);
  });

  it("refuses target overflow for a model with an unknown tokenizer budget", async () => {
    vi.stubEnv("OPENAI_EMBEDDING_MODEL", "unknown-embedding-model");
    const mod = await import("../src/lib/chunking");
    expect(() => mod.chunkTextWithOverlap(`${header}\n${row}`, 400, 0)).toThrow(mod.OversizedTableRowError);
    expect(mod.chunkTextWithOverlap(`${header}\n| GROUP-A | Review. |`, 400, 0)).toEqual([
      `${header}\n| GROUP-A | Review. |`,
    ]);
  });

  it.each(["text-embedding-3-small", "text-embedding-3-large", "text-embedding-ada-002"])(
    "permits bounded overflow for %s",
    async (model) => {
      vi.stubEnv("OPENAI_EMBEDDING_MODEL", model);
      const mod = await import("../src/lib/chunking");
      expect(mod.chunkTextWithOverlap(`${header}\n${row}`, 400, 0)).toEqual([`${header}\n${row}`]);
    },
  );

  it.each(["page", "document"])(
    "marks bounded atomic overflow and keeps image context separate in %s mode",
    async (strategy) => {
      vi.stubEnv("CHUNK_STRATEGY", strategy);
      const mod = await import("../src/lib/chunking");
      const note = "Note: Do not change treatment\nunless the original condition applies.";
      const text = ["Table 4. Monitoring", header, row, note].join("\n");
      const chunks = mod.buildChunks([
        {
          documentId: "synthetic-document",
          pageNumber: 2,
          pageText: text,
          images: [
            { id: "synthetic-image", pageNumber: 2, caption: "Synthetic chart context.", sourceKind: "embedded" },
          ],
        },
      ]);
      const atomic = chunks.find((chunk) => chunk.content.includes("GROUP-A"));
      expect(atomic?.content).toBe(text);
      expect(atomic?.metadata.table_row_overflow).toEqual({
        reason: "indivisible_table_evidence",
        utf8_bytes: Buffer.byteLength(text),
        max_utf8_bytes: 8191,
        token_upper_bound: "utf8_bytes",
      });
      expect(atomic?.content).not.toContain("IMAGE_DATA_START");
      expect(chunks.some((chunk) => chunk.content.includes("IMAGE_DATA_START"))).toBe(true);
      for (const chunk of chunks.filter((chunk) => chunk !== atomic)) {
        expect(chunk.metadata.table_row_overflow).toBeUndefined();
      }
    },
  );

  it.each(["page", "document"])("propagates refusal without returning earlier chunks in %s mode", async (strategy) => {
    vi.stubEnv("CHUNK_STRATEGY", strategy);
    vi.stubEnv("CHUNK_SIZE", "400");
    vi.stubEnv("CHUNK_OVERLAP", "40");
    const mod = await import("../src/lib/chunking");
    const inputs = [
      { documentId: "synthetic-document", pageNumber: 1, pageText: "Earlier Section\n\nEarlier complete guidance." },
      {
        documentId: "synthetic-document",
        pageNumber: 2,
        pageText: `Table 4. Monitoring\n${header}\n${hardOversizedRow}`,
      },
    ];
    expect(() => mod.buildChunks(inputs)).toThrow(mod.OversizedTableRowError);
  });
});
