import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolvePythonBin } from "../src/lib/python-bin";
import { buildTableFactRows } from "../worker/table-facts";

const python = resolvePythonBin();
const hasPyMuPDF = spawnSync(python, ["-c", "import pymupdf"], { encoding: "utf8" }).status === 0;

describe("synthetic relational table evidence", () => {
  it.runIf(hasPyMuPDF)("extracts the adversarial grid from an actual PDF without interleaving", () => {
    execFileSync(python, [path.join(process.cwd(), "worker/python/test_extract_pdf_relational_adversarial.py")], {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: "pipe",
    });
  });

  it("keeps a wrapped action, threshold and extra column together through confirmed merge inheritance", () => {
    const rows = [
      ["Marker Alpha", "4 units", "11%", "Synthetic action one\nretain the alpha pair"],
      ["", "8 units", "22%", "Synthetic action two\nretain the second pair"],
      ["Marker Beta", "12 units", "33%", "Synthetic action three\nretain the beta pair"],
    ];
    const facts = buildTableFactRows({
      job: { document_id: "synthetic-doc", documents: { owner_id: "synthetic-owner" } },
      chunkRows: [{ id: "synthetic-chunk", page_number: 1, image_ids: ["synthetic-grid"], content: "Synthetic table" }],
      insertedImages: [
        {
          id: "synthetic-grid",
          pageNumber: 1,
          tableTitle: "Synthetic monitoring table",
          tableColumns: ["Parameter", "Threshold", "Rate", "Recommended action"],
          tableRows: rows,
          tableMergedCells: [[1, 0]],
        },
      ],
    });
    expect(facts).toHaveLength(3);
    expect(
      facts.map(({ clinical_parameter, threshold_value, action }) => [clinical_parameter, threshold_value, action]),
    ).toEqual([
      ["Marker Alpha", "4 units", "Synthetic action one retain the alpha pair"],
      ["Marker Alpha", "8 units", "Synthetic action two retain the second pair"],
      ["Marker Beta", "12 units", "Synthetic action three retain the beta pair"],
    ]);
    for (const [index, fact] of facts.entries()) {
      expect(fact).toMatchObject({
        owner_id: "synthetic-owner",
        document_id: "synthetic-doc",
        source_chunk_id: "synthetic-chunk",
        source_image_id: "synthetic-grid",
        page_number: 1,
      });
      expect(fact.metadata).toMatchObject({
        row_index: index,
        cells: rows[index].map((cell) => cell.replace(/\s+/g, " ")),
      });
    }
    expect(facts[1]).toMatchObject({
      row_label: null,
      metadata: { row_label_inherited_from: { row_index: 0, label: "Marker Alpha" } },
    });
    expect(facts[2].metadata).not.toHaveProperty("row_label_inherited_from");
  });
});
