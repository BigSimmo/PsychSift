import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { resolvePythonBin } from "@/lib/python-bin";

const pythonBin = resolvePythonBin();
const hasPyMuPDF = spawnSync(pythonBin, ["-c", "import pymupdf"], { encoding: "utf8" }).status === 0;
const extractorDir = path.join(process.cwd(), "worker", "python");

describe.runIf(hasPyMuPDF)("PDF table edge-strip row recovery (3344a3a9)", () => {
  it("rejects a 3-line wrapped prose paragraph in the bottom strip below a 3-column table", () => {
    const script = [
      "import json, sys",
      "import pymupdf as fitz",
      `sys.path.insert(0, ${JSON.stringify(extractorDir)})`,
      "import extract_pdf_assets as e",
      "doc = fitz.open()",
      "page = doc.new_page(width=595, height=842)",
      "# 3-column table from x=50..560 (cols: 50..150, 150..340, 340..560), y=100..200",
      "original_rect = fitz.Rect(50, 100, 560, 200)",
      "extended_rect = fitz.Rect(50, 100, 560, 260)",
      "existing_rows = [['Score', 'State', 'Management'], ['0', 'Calm', 'Continue routine care']]",
      "column_ranges = [(50.0, 150.0), (150.0, 340.0), (340.0, 560.0)]",
      "# Insert a 3-line wrapped full-width prose paragraph in the bottom strip (y=205..245)",
      "prose_lines = [",
      "    (212, 'Patients who present with acute agitation must be assessed promptly by the duty medical officer and'),",
      "    (224, 'have baseline vital signs documented before administering any parenteral medication in the acute'),",
      "    (236, 'inpatient psychiatric unit or emergency department.'),",
      "]",
      "for y, line in prose_lines:",
      "    page.insert_text((52, y), line, fontsize=9)",
      "recovered = e.recover_table_rows_from_edge_strip(",
      "    page, original_rect, extended_rect, existing_rows, column_count=3, column_ranges=column_ranges",
      ")",
      "print(json.dumps(recovered))",
    ].join("\n");

    const stdout = execFileSync(pythonBin, ["-c", script], {
      cwd: process.cwd(),
      encoding: "utf8",
    });

    expect(JSON.parse(stdout.trim())).toEqual([]);
  });

  it("recovers genuine multi-column cells in the bottom strip aligned with column x-ranges and preserves top/bottom order", () => {
    const script = [
      "import json, sys",
      "import pymupdf as fitz",
      `sys.path.insert(0, ${JSON.stringify(extractorDir)})`,
      "import extract_pdf_assets as e",
      "doc = fitz.open()",
      "page = doc.new_page(width=595, height=842)",
      "original_rect = fitz.Rect(50, 120, 560, 200)",
      "extended_rect = fitz.Rect(50, 90, 560, 240)",
      "existing_rows = [['0', 'Asleep', 'Monitor vitals']]",
      "column_ranges = [(50.0, 120.0), (120.0, 310.0), (310.0, 560.0)]",
      "# Top-strip header row at y=108",
      "page.insert_text((54, 108), 'Score', fontsize=9)",
      "page.insert_text((124, 108), 'Patient state', fontsize=9)",
      "page.insert_text((314, 108), 'Management', fontsize=9)",
      "# Bottom-strip data row at y=218",
      "page.insert_text((54, 218), '5', fontsize=9)",
      "page.insert_text((124, 218), 'Highly aroused', fontsize=9)",
      "page.insert_text((314, 218), 'Emergency escalation', fontsize=9)",
      "recovered = e.recover_table_rows_from_edge_strip(",
      "    page, original_rect, extended_rect, existing_rows, column_count=3, column_ranges=column_ranges",
      ")",
      "top_rows, bottom_rows = e._recover_table_rows_split(",
      "    page, original_rect, extended_rect, existing_rows, column_count=3, column_ranges=column_ranges",
      ")",
      "combined = top_rows + existing_rows + bottom_rows",
      "print(json.dumps({'recovered': recovered, 'combined': combined}))",
    ].join("\n");

    const stdout = execFileSync(pythonBin, ["-c", script], {
      cwd: process.cwd(),
      encoding: "utf8",
    });

    const parsed = JSON.parse(stdout.trim()) as {
      recovered: string[][];
      combined: string[][];
    };
    expect(parsed.recovered).toEqual([
      ["Score", "Patient state", "Management"],
      ["5", "Highly aroused", "Emergency escalation"],
    ]);
    expect(parsed.combined).toEqual([
      ["Score", "Patient state", "Management"],
      ["0", "Asleep", "Monitor vitals"],
      ["5", "Highly aroused", "Emergency escalation"],
    ]);
  });

  function recoverBottomRow(lines: string[], scoreX = 54): string[][] {
    const script = [
      "import json, sys",
      "import pymupdf as fitz",
      `sys.path.insert(0, ${JSON.stringify(extractorDir)})`,
      "import extract_pdf_assets as e",
      "doc = fitz.open()",
      "page = doc.new_page(width=595, height=842)",
      "original_rect = fitz.Rect(50, 120, 560, 200)",
      "extended_rect = fitz.Rect(50, 120, 560, 250)",
      "existing_rows = [['0', 'Asleep', 'Monitor vitals']]",
      "column_ranges = [(50.0, 120.0), (120.0, 310.0), (310.0, 560.0)]",
      `page.insert_text((${scoreX}, 218), '5', fontsize=9)`,
      "page.insert_text((124, 218), 'Highly aroused', fontsize=9)",
      ...lines,
      "recovered = e.recover_table_rows_from_edge_strip(",
      "    page, original_rect, extended_rect, existing_rows, column_count=3, column_ranges=column_ranges",
      ")",
      "print(json.dumps(recovered))",
    ].join("\n");
    return JSON.parse(execFileSync(pythonBin, ["-c", script], { cwd: process.cwd(), encoding: "utf8" }).trim());
  }

  it("keeps a short note under a recovered row out of that row's cells", () => {
    expect(
      recoverBottomRow([
        "page.insert_text((314, 218), 'Call the duty registrar', fontsize=9)",
        "page.insert_text((54, 229), 'See note', fontsize=9)",
      ]),
    ).toEqual([["5", "Highly aroused", "Call the duty registrar"]]);
  });

  it("keeps a note out of the row when the cell above it is a short right-aligned value", () => {
    expect(
      recoverBottomRow(
        [
          "page.insert_text((314, 218), 'Call the duty registrar', fontsize=9)",
          "page.insert_text((54, 229), 'See note', fontsize=9)",
        ],
        111,
      ),
    ).toEqual([["5", "Highly aroused", "Call the duty registrar"]]);
  });

  it("still joins a cell whose text wrapped onto the next line", () => {
    expect(
      recoverBottomRow([
        "page.insert_text((314, 218), 'Give oral medication first, then call the duty registrar,', fontsize=9)",
        "page.insert_text((314, 229), 'security and nurse in charge', fontsize=9)",
      ]),
    ).toEqual([
      ["5", "Highly aroused", "Give oral medication first, then call the duty registrar, security and nurse in charge"],
    ]);
  });

  it("still joins a deliberate line break inside a cell, such as a dose under a drug name", () => {
    expect(
      recoverBottomRow([
        "page.insert_text((314, 218), 'Lorazepam', fontsize=9)",
        "page.insert_text((314, 229), '1 to 2 mg orally', fontsize=9)",
        "page.insert_text((314, 240), '- repeat once after 1 hour', fontsize=9)",
      ]),
    ).toEqual([["5", "Highly aroused", "Lorazepam 1 to 2 mg orally - repeat once after 1 hour"]]);
  });

  it("keeps footnotes flush with the first cell out of a recovered row", () => {
    expect(
      recoverBottomRow([
        "page.insert_text((314, 218), 'Call the duty registrar', fontsize=9)",
        "page.insert_text((54, 229), '* Off-label use', fontsize=9)",
      ]),
    ).toEqual([["5", "Highly aroused", "Call the duty registrar"]]);
    expect(
      recoverBottomRow([
        "page.insert_text((314, 218), 'Call the duty registrar', fontsize=9)",
        "page.insert_text((54, 229), '1 Not PBS listed', fontsize=9)",
      ]),
    ).toEqual([["5", "Highly aroused", "Call the duty registrar"]]);
  });

  it("extracts column ranges cleanly when a table row contains (None, None, None, None) merged/empty cells", () => {
    const script = [
      "import json, sys",
      `sys.path.insert(0, ${JSON.stringify(extractorDir)})`,
      "import extract_pdf_assets as e",
      "class DummyRow:",
      "    def __init__(self, cells):",
      "        self.cells = cells",
      "class DummyTable:",
      "    def __init__(self, rows):",
      "        self.rows = rows",
      "table = DummyTable([",
      "    DummyRow([(50.0, 100.0, 120.0, 130.0), (None, None, None, None), (310.0, 100.0, 560.0, 130.0)]),",
      "    DummyRow([(50.0, 130.0, 120.0, 160.0), (120.0, 130.0, 310.0, 160.0), None]),",
      "])",
      "ranges = e._extract_table_column_ranges(table, column_count=3)",
      "print(json.dumps(ranges))",
    ].join("\n");

    const stdout = execFileSync(pythonBin, ["-c", script], {
      cwd: process.cwd(),
      encoding: "utf8",
    });

    expect(JSON.parse(stdout.trim())).toEqual([
      [50, 120],
      [120, 310],
      [310, 560],
    ]);
  });
});
