import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChunkInput } from "../src/lib/types";

const columns = ["Scenario", "Concentration", "Amount", "Volume", "Interval"];
const rows = [
  ["Scenario", "Concentration", "Amount", "Volume", "Interval"],
  ["Q-A", "0.5 mg/mL", "2 mg", "4 mL", "24 h"],
  ["Q-B", "0.5 mg/mL", "3.5 mg", "7 mL", "48 h"],
];
const tableText = [
  "| Scenario | Concentration | Amount | Volume | Interval |",
  "| --- | --- | --- | --- | --- |",
  "| Q-A | 0.5 mg/mL | 2 mg | 4 mL | 24 h |",
  "| Q-B | 0.5 mg/mL | 3.5 mg | 7 mL | 48 h |",
].join("\n");
const qualifications =
  "Rows A and B are alternative QA scenarios. Do not combine them.\nNo conversion to a real medicine is supported.";
const pageText = `SYNTHETIC QA ONLY - NOT FOR CLINICAL USE\n${tableText}\n${qualifications}`;
type Image = NonNullable<ChunkInput["images"]>[number];

function image(overrides: Partial<Image> = {}): Image {
  return {
    id: "native-qa-table",
    caption: "",
    pageNumber: 2,
    sourceKind: "table_crop",
    tableColumns: [...columns],
    tableRows: rows.map((row) => [...row]),
    tableTextSnippet: tableText,
    ...overrides,
  };
}

function page(text = pageText, images: Image[] = [image()], pageNumber: number | null = 2): ChunkInput {
  return { documentId: "synthetic-native-document", pageNumber, pageText: text, images, metadata: {} };
}

async function build(inputs: ChunkInput[], strategy: "page" | "document" = "page", size = "6000") {
  vi.resetModules();
  vi.stubEnv("CHUNK_STRATEGY", strategy);
  vi.stubEnv("CHUNK_SIZE", size);
  vi.stubEnv("CHUNK_OVERLAP", "200");
  const before = JSON.parse(JSON.stringify(inputs)) as ChunkInput[];
  const { buildChunks } = await import("../src/lib/chunking");
  const chunks = buildChunks(inputs);
  // Source narrative, captions and native rows are caller-owned evidence.
  expect(inputs).toEqual(before);
  return chunks;
}

async function expectUnlinked(input: ChunkInput, strategy: "page" | "document" = "page") {
  const chunks = await build([input], strategy);
  expect(chunks.length).toBeGreaterThan(0);
  expect(chunks.flatMap((chunk) => chunk.image_ids)).not.toContain("native-qa-table");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("page-local native table linkage through buildChunks", () => {
  it("links the literal complete qualified native table without changing source or description", async () => {
    const chunks = await build([page()]);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].image_ids).toEqual(["native-qa-table"]);
    expect(chunks[0].page_number).toBe(2);
    expect(chunks[0].metadata.chunk_strategy).toBe("page");
    expect(chunks[0].content).toContain(tableText);
    expect(chunks[0].content).toContain(qualifications);
    expect(chunks[0].content.replace(/\[\[IMAGE_DATA_START\]\][\s\S]*?\[\[IMAGE_DATA_END\]\]/g, "").trim()).toBe(
      pageText,
    );
    expect(chunks[0].retrieval_synopsis).toContain("Visual/table context: 1");
  });

  it("accepts only cell whitespace normalization and an optional alignment row", async () => {
    const text = tableText
      .replace("| --- | --- | --- | --- | --- |\n", "")
      .replace("Q-A", " Q-A  ")
      .replace("0.5 mg/mL", "0.5\tmg/mL");
    const chunks = await build([page(text)]);
    expect(chunks[0].image_ids).toEqual(["native-qa-table"]);
  });

  it("supports a generic explicit scenario label without hardcoding the retained fixture's IDs", async () => {
    const text = [
      "| Scenario | Concentration | Amount | Volume | Interval |",
      "| --- | --- | --- | --- | --- |",
      "| SCENARIO-17 | 0.5 mg/mL | 2 mg | 4 mL | 24 h |",
      "| SCENARIO-18 | 0.5 mg/mL | 3.5 mg | 7 mL | 48 h |",
      qualifications,
    ].join("\n");
    const chunks = await build([
      page(text, [
        image({
          tableRows: [
            ["Scenario", "Concentration", "Amount", "Volume", "Interval"],
            ["SCENARIO-17", "0.5 mg/mL", "2 mg", "4 mL", "24 h"],
            ["SCENARIO-18", "0.5 mg/mL", "3.5 mg", "7 mL", "48 h"],
          ],
        }),
      ]),
    ]);
    expect(chunks[0].image_ids).toEqual(["native-qa-table"]);
    expect(chunks[0].content).toContain("| SCENARIO-17 | 0.5 mg/mL | 2 mg | 4 mL | 24 h |");
    expect(chunks[0].content).toContain("| SCENARIO-18 | 0.5 mg/mL | 3.5 mg | 7 mL | 48 h |");
    expect(chunks[0].content).toContain(qualifications);
  });

  it.each([
    ["header only", "| Scenario | Concentration | Amount | Volume | Interval |\n| --- | --- | --- | --- | --- |"],
    ["numbers and units in prose", "Use 0.5 mg/mL, 2 mg, 4 mL and 24 h for a synthetic arithmetic check."],
    ["medicine prose", "Lithium monitoring and clozapine dosing use mg, mL and hours. Scenario A is unrelated."],
    ["one data row", tableText.replace("\n| Q-B | 0.5 mg/mL | 3.5 mg | 7 mL | 48 h |", "")],
    ["altered decimal", tableText.replace("3.5 mg", "3.6 mg")],
    ["altered unit", tableText.replace("7 mL", "7 mg")],
    ["cell substring", tableText.replace("Q-A", "Q-AA")],
    [
      "changed header semantics",
      tableText.replace("Amount | Volume | Interval", "Maximum amount | Maximum volume | Review interval"),
    ],
    ["swapped cells", tableText.replace("2 mg | 4 mL", "4 mL | 2 mg")],
    ["wrong column count", tableText.replace("2 mg | 4 mL | 24 h", "2 mg | 24 h")],
    [
      "reordered data rows",
      "| Scenario | Concentration | Amount | Volume | Interval |\n| Q-B | 0.5 mg/mL | 3.5 mg | 7 mL | 48 h |\n| Q-A | 0.5 mg/mL | 2 mg | 4 mL | 24 h |",
    ],
    ["escaped pipe", tableText.replace("Q-A", "Q\\|A")],
    ["multiline cell", tableText.replace("Q-A", "Q-\nA")],
  ])("refuses %s narrative", async (_name, text) => {
    await expectUnlinked(page(text));
  });

  it.each([
    ["missing rows", { tableRows: null }],
    ["missing columns", { tableColumns: null }],
    ["no data rows", { tableRows: [columns] }],
    ["nonrectangular rows", { tableRows: [columns, ["Q-A", "2 mg"]] }],
    ["empty cell", { tableRows: [columns, ["Q-A", "", "2 mg", "4 mL", "24 h"]] }],
    ["native multiline cell", { tableRows: [columns, ["Q-A", "0.5\nmg/mL", "2 mg", "4 mL", "24 h"]] }],
    ["nonstring native cell", { tableRows: [columns, ["Q-A", 0.5, "2 mg", "4 mL", "24 h"]] }],
  ])("refuses %s rather than parsing a snippet fallback", async (_name, overrides) => {
    await expectUnlinked(page(pageText, [image(overrides as Partial<Image>)]));
  });

  it.each(["2 mg", "mg/mL", "µg", "μg", "1e6 mmol/L", "mmHg", "cm", "bpm", "mm", "kPa", "Hz"])(
    "refuses numeric/unit-only row identifier %s",
    async (identifier) => {
      await expectUnlinked(
        page(`| Amount | Volume |\n| ${identifier} | 4 mL |`, [
          image({
            tableColumns: ["Amount", "Volume"],
            tableRows: [
              ["Amount", "Volume"],
              [identifier, "4 mL"],
            ],
          }),
        ]),
      );
    },
  );

  it.each(["SCENARIO", "case-17", "ROW 17", "17-18", "MM", "KPA", "HZ"])(
    "declines unsupported plain or malformed identifier %s",
    async (identifier) => {
      await expectUnlinked(
        page(`| Scenario | Action |\n| ${identifier} | observe |`, [
          image({
            tableColumns: ["Scenario", "Action"],
            tableRows: [
              ["Scenario", "Action"],
              [identifier, "observe"],
            ],
          }),
        ]),
      );
    },
  );

  it.each(["1", "2 mg", "mmHg", "cm", "bpm"])(
    "does not use a later lexical action to qualify row identifier %s",
    async (identifier) => {
      await expectUnlinked(
        page(`| Scenario | Action |\n| ${identifier} | observe |`, [
          image({
            tableColumns: ["Scenario", "Action"],
            tableRows: [
              ["Scenario", "Action"],
              [identifier, "observe"],
            ],
          }),
        ]),
      );
    },
  );

  it.each([
    ["complete injected image block", `Unrelated narrative.\n[[IMAGE_DATA_START]]\n${tableText}\n[[IMAGE_DATA_END]]`],
    ["complete omitted block", `Unrelated narrative.\n[[IMAGE_DATA_OMITTED]]\n${tableText}\n[[/IMAGE_DATA_OMITTED]]`],
    ["partial opening marker", `${pageText}\n[[IMAGE_DATA_START]`],
    ["unclosed block", `${pageText}\n[[IMAGE_DATA_START]]`],
    ["orphan closing marker", `${pageText}\n[[IMAGE_DATA_END]]`],
    [
      "nested image markers",
      `${pageText}\n[[IMAGE_DATA_START]][[IMAGE_DATA_START]]x[[IMAGE_DATA_END]][[IMAGE_DATA_END]]`,
    ],
    [
      "nested omitted/image markers",
      `${pageText}\n[[IMAGE_DATA_OMITTED]][[IMAGE_DATA_START]]x[[IMAGE_DATA_END]][[/IMAGE_DATA_OMITTED]]`,
    ],
  ])("refuses %s as linkage evidence", async (_name, text) => {
    await expectUnlinked(page(text));
  });

  it.each([1, 3, null])("refuses a native image on a different or unknown physical input page %s", async (number) => {
    await expectUnlinked(page(pageText, [image()], number));
  });

  it.each([1, 3, null, 0, -2, 2.5])("refuses an image with mismatched or invalid page %s", async (number) => {
    await expectUnlinked(page(pageText, [image({ pageNumber: number })]));
  });

  it("refuses even a single-page document-mode chunk", async () => {
    await expectUnlinked(page(), "document");
  });

  it("refuses document-mode cross-page association despite repeated native vocabulary", async () => {
    const chunks = await build(
      [
        page(`${tableText}\n${"Unrelated narrative words remain repeated. ".repeat(30)}`, [], 1),
        page(pageText),
        page("An unrelated final physical page.", [], 3),
      ],
      "document",
    );
    expect(chunks.flatMap((chunk) => chunk.image_ids)).not.toContain("native-qa-table");
  });

  it("refuses duplicate narrative blocks with different surrounding qualifications", async () => {
    await expectUnlinked(
      page(`${tableText}\nOnly for scenario group one.\n\n${tableText}\nOnly for scenario group two.`),
    );
  });

  it("refuses rows separated from their header-bound contiguous table block", async () => {
    await expectUnlinked(page(tableText.replace("\n| Q-B", "\n\nSeparate narrative qualification.\n\n| Q-B")));
  });

  it("does not associate a complete native descriptor with chunks containing only table fragments", async () => {
    const chunks = await build([page(tableText)], "page", "120");
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      const sourceText = chunk.content.replace(/\[\[IMAGE_DATA_START\]\][\s\S]*?\[\[IMAGE_DATA_END\]\]/g, "").trim();
      expect(sourceText).not.toContain(tableText);
    }
    expect(chunks.flatMap((chunk) => chunk.image_ids)).not.toContain("native-qa-table");
  });

  it("refuses identical rows under a second narrative header with different meanings", async () => {
    await expectUnlinked(
      page(
        `${tableText}\n\n${tableText.replace("Amount | Volume | Interval", "Maximum amount | Maximum volume | Review interval")}`,
      ),
    );
  });

  it.each([
    ["identical rows", image({ id: "other-crop" })],
    [
      "one shared row",
      image({ id: "other-crop", tableRows: [columns, rows[1], ["R-C", "1 mg/mL", "5 mg", "5 mL", "6 h"]] }),
    ],
    [
      "different header meanings",
      image({
        id: "other-crop",
        tableColumns: ["Scenario", "Concentration", "Maximum amount", "Maximum volume", "Review interval"],
        tableRows: [rows[1], rows[2]],
      }),
    ],
    ["unavailable rows", image({ id: "other-crop", tableRows: null })],
    ["malformed rows", image({ id: "other-crop", tableRows: [["Unknown"]] })],
  ])("refuses a same-page peer with %s", async (_name, peer) => {
    await expectUnlinked(page(pageText, [image(), peer]));
  });

  it("links only the complete distinctive crop when peers merely share headers and units", async () => {
    const peer = image({ id: "distinct-crop", tableRows: [columns, ["R-C", "0.5 mg/mL", "8 mg", "16 mL", "12 h"]] });
    const chunks = await build([page(pageText, [image(), peer])]);
    expect(chunks[0].image_ids).toEqual(["native-qa-table"]);
  });

  it("refuses conflicting duplicate image IDs", async () => {
    await expectUnlinked(
      page(pageText, [image(), image({ tableRows: [columns, ["R-C", "1 mg/mL", "8 mg", "8 mL", "12 h"]] })]),
    );
  });

  it("refuses blank-native duplicate IDs with different physical pages", async () => {
    await expectUnlinked(page(pageText, [image(), image({ pageNumber: 3 })]));
  });

  it("refuses the blank-native fallback while preserving a captioned duplicate's legacy association", async () => {
    const chunks = await build([page(pageText, [image(), image({ caption: "Unrelated crop description" })])]);
    // Zero would alter legacy matching; two would mean the blank fallback bypassed its collision refusal.
    expect(chunks[0].image_ids).toEqual(["native-qa-table"]);
  });

  it("checks duplicate descriptors before collapsing consistent IDs", async () => {
    const chunks = await build([page(pageText, [image(), image()])]);
    expect(chunks[0].image_ids).toEqual(["native-qa-table"]);
  });

  it("collapses a consistent native ID even when the same image object is supplied twice", async () => {
    const repeated = image();
    const chunks = await build([page(pageText, [repeated, repeated])]);
    expect(chunks[0].image_ids).toEqual(["native-qa-table"]);
    expect(chunks[0].retrieval_synopsis).toContain("Visual/table context: 1");
  });

  it("links a fourth crop beyond inline context without using injected metadata", async () => {
    const peers = ["R-A", "R-B", "R-C"].map((identifier) =>
      image({ id: identifier, tableRows: [columns, [identifier, "1 mg/mL", "8 mg", "8 mL", "12 h"]] }),
    );
    const chunks = await build([page(pageText, [...peers, image()])]);
    expect(chunks[0].content).not.toContain("Image ID: native-qa-table");
    expect(chunks[0].image_ids).toEqual(["native-qa-table"]);
  });

  it("checks a malformed fifth peer beyond the inline cap", async () => {
    const peers = ["R-A", "R-B", "R-C"].map((identifier) =>
      image({ id: identifier, tableRows: [columns, [identifier, "1 mg/mL", "8 mg", "8 mL", "12 h"]] }),
    );
    await expectUnlinked(page(pageText, [...peers, image(), image({ id: "unknown-fifth", tableRows: null })]));
  });

  it("associates real table rows without pretending missing qualifications are present", async () => {
    const chunks = await build([page(tableText)]);
    expect(chunks[0].image_ids).toEqual(["native-qa-table"]);
    expect(chunks[0].content).not.toContain(qualifications);
    // P2i's independent original-source oracle must still require both sentences.
  });

  it.each(["caption", "tableLabel", "tableTitle"] as const)(
    "preserves existing descriptive %s matching with unavailable native rows",
    async (field) => {
      const chunks = await build([
        page("Lithium monitoring chart describes renal checks.", [
          image({
            [field]: "Lithium monitoring chart",
            tableRows: null,
          }),
        ]),
      ]);
      expect(chunks[0].image_ids).toEqual(["native-qa-table"]);
    },
  );

  it("preserves embedded-image descriptive matching", async () => {
    const chunks = await build([
      page("Lithium monitoring chart describes renal checks.", [
        image({
          id: "embedded-chart",
          sourceKind: "embedded",
          caption: "Lithium monitoring chart",
          tableRows: null,
        }),
      ]),
    ]);
    expect(chunks[0].image_ids).toEqual(["embedded-chart"]);
  });
});
