import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CHUNKER_VERSION,
  DOCUMENT_CHUNKER_VERSION,
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
