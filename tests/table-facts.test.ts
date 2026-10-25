import { describe, expect, it } from "vitest";
import { buildTableFactRows } from "../worker/table-facts";

describe("table fact generation", () => {
  it("generates facts for table images even when no chunk image_ids reference the image", () => {
    const facts = buildTableFactRows({
      job: {
        document_id: "doc-1",
        documents: { owner_id: "owner-1" },
      },
      chunkRows: [
        {
          id: "chunk-1",
          page_number: 4,
          image_ids: [],
          section_heading: "Clozapine monitoring",
          content: "This page describes ANC monitoring thresholds and management.",
        },
      ],
      insertedImages: [
        {
          id: "image-1",
          pageNumber: 4,
          caption: "Clozapine ANC action table.",
          tableTitle: "Clozapine ANC thresholds",
          tableRows: [["ANC below 1.5", "withhold clozapine", "repeat FBC"]],
          tableColumns: ["Parameter", "Threshold", "Action"],
          accessibleTableMarkdown: "| Parameter | Threshold | Action |",
        },
      ],
    });

    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({
      owner_id: "owner-1",
      document_id: "doc-1",
      source_chunk_id: "chunk-1",
      source_image_id: "image-1",
      page_number: 4,
      table_title: "Clozapine ANC thresholds",
      row_label: "ANC below 1.5",
      threshold_value: "withhold clozapine",
      action: "repeat FBC",
    });
  });

  // Audit 2026-10-20 ING-B-09: a vertically merged label cell comes back blank on later rows.
  it("carries a merged row label forward into clinical_parameter without rewriting the cells", () => {
    const facts = buildTableFactRows({
      job: { document_id: "doc-1", documents: { owner_id: "owner-1" } },
      chunkRows: [],
      insertedImages: [
        {
          id: "image-1",
          pageNumber: 2,
          tableTitle: "Synthetic monitoring table",
          tableRows: [
            ["Group A", "Level 1", "First instruction"],
            ["", "Level 2", "Second instruction"],
            ["Group B", "Level 3", "Third instruction"],
          ],
          tableColumns: ["Parameter", "Threshold", "Action"],
          tableMergedCells: [[1, 0]],
        },
      ],
    });

    expect(facts.map((fact) => fact.clinical_parameter)).toEqual(["Group A", "Group A", "Group B"]);
    expect(facts[1]).toMatchObject({ row_label: null, threshold_value: "Level 2" });
    expect(facts[1]?.metadata).toMatchObject({
      cells: ["", "Level 2", "Second instruction"],
      row_label_inherited_from: { row_index: 0, label: "Group A" },
    });
    expect(facts[0]?.metadata).not.toHaveProperty("row_label_inherited_from");
  });

  const carryFacts = (tableRows: string[][], tableMergedCells?: [number, number][] | null) =>
    buildTableFactRows({
      job: { document_id: "doc-1", documents: { owner_id: "owner-1" } },
      chunkRows: [],
      insertedImages: [
        {
          id: "image-1",
          pageNumber: 2,
          tableTitle: "Synthetic monitoring table",
          tableRows,
          tableColumns: ["Parameter", "Threshold", "Action"],
          tableMergedCells,
        },
      ],
    });

  it("does not carry a label into a blank cell without confirmed merge provenance", () => {
    const rows = [
      ["Group A", "Level 1", "First instruction"],
      ["", "", "Continuation note for the table"],
    ];
    for (const facts of [carryFacts(rows), carryFacts(rows, null), carryFacts(rows, [[1, 1]])]) {
      expect(facts[1]?.clinical_parameter).toBeNull();
      expect(facts[1]?.metadata).not.toHaveProperty("row_label_inherited_from");
    }
  });

  it("carries a confirmed merged label down a multi-row span only", () => {
    const facts = carryFacts(
      [
        ["Group A", "Level 1", "First instruction"],
        ["", "Level 2", "Second instruction"],
        ["", "Level 3", "Third instruction"],
        ["", "Level 4", "Unmerged blank label"],
      ],
      [
        [1, 0],
        [2, 0],
      ],
    );
    expect(facts.map((fact) => fact.clinical_parameter)).toEqual(["Group A", "Group A", "Group A", null]);
  });

  it("resets inheritance across an empty separator row even when the next cell is marked merged", () => {
    const facts = carryFacts(
      [
        ["Group A", "Level 1", "First instruction"],
        ["", "", ""],
        ["", "Level 2", "Second instruction"],
      ],
      [
        [1, 0],
        [2, 0],
      ],
    );
    expect(facts).toHaveLength(2);
    expect(facts[1]?.clinical_parameter).toBeNull();
    expect(facts[1]?.metadata).not.toHaveProperty("row_label_inherited_from");
  });

  it("does not carry a merged label across a page or section row break", () => {
    const rows = [
      ["Group A", "Level 1", "First instruction"],
      ["", "Level 2", "Second instruction"],
    ];
    const facts = buildTableFactRows({
      job: { document_id: "doc-1", documents: { owner_id: "owner-1" } },
      chunkRows: [],
      insertedImages: [
        {
          id: "image-1",
          pageNumber: 2,
          tableTitle: "Synthetic monitoring table",
          tableRows: rows,
          tableColumns: ["Parameter", "Threshold", "Action"],
          tableMergedCells: [[1, 0]],
          tableRowBreaks: [1],
        },
      ],
    });
    expect(facts[1]?.clinical_parameter).toBeNull();
    expect(facts[1]?.metadata).not.toHaveProperty("row_label_inherited_from");
  });

  it("does not carry a full-width section heading row down into merged cells below it", () => {
    const facts = carryFacts(
      [
        ["Group A", "Level 1", "First instruction"],
        ["Section 2: Renal", "", ""],
        ["", "Level 2", "Second instruction"],
      ],
      [
        [1, 1],
        [1, 2],
        [2, 0],
      ],
    );
    expect(facts[2]?.clinical_parameter).toBeNull();
    expect(facts[2]?.metadata).not.toHaveProperty("row_label_inherited_from");
  });

  // Audit EXT-06 (24 Oct 2026): a drug name spanning two columns covers the parameter cell from
  // the left, so that row must not inherit the parameter of the row above.
  it("does not carry a label down into a cell covered by a span from the left", () => {
    const facts = buildTableFactRows({
      job: { document_id: "doc-1", documents: { owner_id: "owner-1" } },
      chunkRows: [],
      insertedImages: [
        {
          id: "image-1",
          pageNumber: 3,
          tableTitle: "Table 3. Monitoring thresholds",
          tableRows: [
            ["Lithium", "Serum level", "> 1.5 mmol/L", "Withhold"],
            ["Valproate (all formulations)", "", "< 50 mg/L", "Check adherence"],
            ["", "Serum level", "> 1.2 mmol/L", "Repeat in 1 week"],
          ],
          tableColumns: ["Drug", "Parameter", "Threshold", "Action"],
          tableMergedCells: [[1, 1]],
        },
      ],
    });
    expect(facts.map((fact) => fact.clinical_parameter)).toEqual(["Serum level", null, "Serum level"]);
    expect(facts[1]?.metadata).not.toHaveProperty("row_label_inherited_from");
  });

  it("deduplicates repeated table rows from the same image", () => {
    const facts = buildTableFactRows({
      job: {
        document_id: "doc-1",
        documents: { owner_id: null },
      },
      chunkRows: [{ id: "chunk-1", page_number: 1, image_ids: ["image-1"], content: "Dose table" }],
      insertedImages: [
        {
          id: "image-1",
          pageNumber: 1,
          tableTitle: "Dose table",
          tableRows: [
            ["Lorazepam", "1 mg", "review before repeat"],
            ["Lorazepam", "1 mg", "review before repeat"],
          ],
          tableColumns: ["Medication", "Dose", "Action"],
        },
      ],
    });

    expect(facts).toHaveLength(1);
  });

  it("uses structured visual column roles before regex column names", () => {
    const facts = buildTableFactRows({
      job: {
        document_id: "doc-1",
        documents: { owner_id: null },
      },
      chunkRows: [{ id: "chunk-1", page_number: 1, image_ids: [], content: "Ambiguous medication chart" }],
      insertedImages: [
        {
          id: "image-1",
          pageNumber: 1,
          tableTitle: "Agitation medication chart",
          tableRows: [["Lorazepam", "1 mg", "IM", "review observations"]],
          tableColumns: ["A", "B", "C", "D"],
          structuredVisualProfile: {
            table_column_roles: {
              A: "medication",
              B: "dose",
              C: "route",
              D: "action",
            },
          },
        },
      ],
    });

    expect(facts[0]).toMatchObject({
      row_label: "Lorazepam",
      threshold_value: "1 mg",
      action: "review observations",
    });
    expect(facts[0].metadata.table_column_roles).toMatchObject({ B: "dose", D: "action" });
  });
});
