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
