"""Harder clinically relational tables for the table-aware reader (audit F20).

The clozapine regression (test_extract_pdf_assets_table_reading_order.py) wraps
only the first column. Real WA guideline tables also wrap several columns at
once, leave cells empty, and merge a header across columns. Each fixture here
asserts the relationship that matters clinically: a threshold stays in the same
row as its label and its action, and nothing is dropped.
"""

from __future__ import annotations

import os
import re
import sys
import tempfile
import unittest
from types import SimpleNamespace

sys.path.insert(0, os.path.dirname(__file__))
import extract_pdf_assets as extractor

fitz = extractor.fitz
LINE = 12


def draw_table(page, xs, top, header, rows, merged_header=None):
    """Draw a ruled grid. `rows` is a list of rows; each cell is a list of lines."""

    def rule(y):
        page.draw_line(fitz.Point(xs[0], y), fitz.Point(xs[-1], y), width=0.7)

    y = top
    rule(y - 4)
    if merged_header:
        # One heading spanning every column: no vertical rules through this band.
        page.insert_text(fitz.Point(xs[0] + 3, y + 8), merged_header, fontsize=9)
        y += LINE + 4
        rule(y - 4)
    header_top = y - 4
    for index, heading in enumerate(header):
        page.insert_text(fitz.Point(xs[index] + 3, y + 8), heading, fontsize=9)
    y += LINE + 4
    rule(y - 4)
    for cells in rows:
        row_top = y
        for index, lines in enumerate(cells):
            for offset, line in enumerate(lines):
                page.insert_text(fitz.Point(xs[index] + 3, row_top + 8 + offset * LINE), line, fontsize=8)
        y = row_top + max(1, max(len(cell) for cell in cells)) * LINE + 4
        rule(y - 4)
    for x in xs:
        page.draw_line(fitz.Point(x, header_top), fitz.Point(x, y - 4), width=0.7)
    if merged_header:
        for x in (xs[0], xs[-1]):
            page.draw_line(fitz.Point(x, top - 4), fitz.Point(x, header_top), width=0.7)


def rebuilt_text(build):
    with tempfile.TemporaryDirectory() as directory:
        path = os.path.join(directory, "table.pdf")
        document = fitz.open()
        page = document.new_page(width=595, height=842)
        build(page)
        document.save(path)
        document.close()
        with fitz.open(path) as opened:
            page = opened[0]
            text = extractor.table_aware_page_text(page, extractor.likely_table_candidates(page))
    return re.sub(r"\s+", " ", text or "").strip()


LITHIUM_XS = [40, 150, 270, 430, 555]
LITHIUM_ROWS = [
    (
        ["Below 0.4 mmol/L"],
        ["Check timing:", "12 hours after", "the last dose"],
        ["Review adherence and", "interacting drugs before", "increasing the dose"],
        ["Recheck in 5 to 7 days"],
    ),
    (
        ["Above 1.2 mmol/L"],
        ["Any time"],
        ["Withhold lithium.", "Urgent medical review", "for toxicity"],
        ["Check renal function", "and electrolytes"],
    ),
]


class MultiColumnWrapTests(unittest.TestCase):
    """Several columns wrap at once, so line-major order would splice three cells together."""

    @classmethod
    def setUpClass(cls):
        cls.text = rebuilt_text(
            lambda page: draw_table(page, LITHIUM_XS, 80, ["Level", "Timing", "Action", "Follow-up"], LITHIUM_ROWS)
        )

    def test_each_threshold_keeps_its_own_action(self):
        high = self.text.index("Above 1.2 mmol/L")
        withhold = self.text.index("Withhold lithium.")
        low = self.text.index("Below 0.4 mmol/L")
        review = self.text.index("Review adherence and interacting drugs before increasing the dose")
        self.assertLess(low, review)
        self.assertLess(review, high, "the low-level action must not drift into the high-level row")
        self.assertLess(high, withhold)

    def test_wrapped_cells_read_as_whole_sentences(self):
        self.assertIn("Check timing: 12 hours after the last dose", self.text)
        self.assertIn("Withhold lithium. Urgent medical review for toxicity", self.text)
        self.assertNotRegex(self.text, r"Withhold lithium\.\s*Check renal")


class EmptyCellTests(unittest.TestCase):
    """An empty cell must not pull a neighbouring cell's text into its row."""

    def test_empty_middle_cell_keeps_the_row_aligned(self):
        rows = [
            (["Neutrophils 1.5 to 2.0", "(amber range,", "any week)"], [], ["Twice-weekly FBC", "until back in", "the green range"]),
            (["Neutrophils below 1.5", "(red range)"], ["Stop clozapine", "and seek", "haematology advice"], ["Daily FBC"]),
        ]
        text = rebuilt_text(lambda page: draw_table(page, [40, 200, 360, 555], 80, ["Result", "Action", "Monitoring"], rows))
        amber = text.index("Neutrophils 1.5 to 2.0")
        red = text.index("Neutrophils below 1.5")
        self.assertIn("Neutrophils 1.5 to 2.0 (amber range, any week)", text)
        self.assertIn("Twice-weekly FBC until back in the green range", text)
        self.assertLess(amber, text.index("Twice-weekly FBC"))
        self.assertLess(text.index("Twice-weekly FBC"), red)
        self.assertIn("Stop clozapine and seek haematology advice", text)
        self.assertLess(red, text.index("Stop clozapine"), "the stop instruction belongs to the red row only")


class MatrixValidationTests(unittest.TestCase):
    def test_vertical_spanning_cells_preserve_a_genuine_sparse_matrix(self):
        document = fitz.open()
        try:
            page = document.new_page()
            for x in (40, 200, 360, 560):
                page.draw_line((x, 80), (x, 200))
            for y in (80, 200):
                page.draw_line((40, y), (560, y))
            for y in (120, 160):
                page.draw_line((200, y), (360, y))
            page.insert_text((50, 100), "Group A")
            page.insert_text((210, 100), "First instruction")
            page.insert_text((210, 140), "Second instruction")
            page.insert_text((210, 180), "Third instruction")
            page.insert_text((370, 100), "Shared timing")
            found = page.find_tables().tables
            self.assertEqual(len(found), 1)
            self.assertEqual(found[0].extract(), [
                ["Group A", "First instruction", "Shared timing"],
                [None, "Second instruction", None],
                [None, "Third instruction", None],
            ])
            candidates = extractor.likely_table_candidates(page)
            self.assertEqual(len(candidates), 1)
            text = extractor.table_aware_page_text(page, candidates)
            for value in ("Group A", "First instruction", "Second instruction", "Third instruction", "Shared timing"):
                self.assertEqual(text.count(value), 1)
            self.assertLess(text.index("First instruction"), text.index("Second instruction"))
            self.assertLess(text.index("Second instruction"), text.index("Third instruction"))
        finally:
            document.close()

    def test_sparse_frame_is_not_a_table_even_with_a_nominal_grid_and_caption(self):
        rows = [["Split", "", "heading", ""], ["All examples in one cell", "", "", ""], ["", "Footer", "", ""]]
        markdown = extractor.table_rows_to_markdown(rows)
        self.assertFalse(extractor.real_table_candidate("Table 99", "Illustrations", markdown, 3, 4, rows))
        table = SimpleNamespace(bbox=(10, 10, 580, 400), extract=lambda: rows)
        page = SimpleNamespace(
            find_tables=lambda: SimpleNamespace(tables=[table]),
            get_text=lambda kind: [],
        )
        self.assertEqual(extractor.likely_table_candidates(page), [])

    def test_sparse_frame_cannot_be_readmitted_by_text_grid_fallback(self):
        blocks = [
            (10, 10, 580, 30, "Split | heading | |"),
            (10, 40, 580, 60, "All examples in one cell | | |"),
            (10, 70, 580, 90, "| Footer | |"),
        ]
        page = SimpleNamespace(rect=fitz.Rect(0, 0, 595, 842), get_text=lambda kind: blocks)
        self.assertEqual(extractor.fallback_table_candidates(page, []), [])

    def test_multiline_cards_and_tabbed_bullets_are_not_fallback_rows(self):
        blocks = [
            (30, 60, 180, 100, "EXAMPLE A\n111 ml | 1.1%\n"),
            (230, 60, 380, 100, "EXAMPLE B\n222 ml | 2.2%\n"),
            (30, 160, 380, 200, "EXAMPLE C\n333 ml | 3.3%\nEXAMPLE D\n444 ml | 4.4%\n"),
            (30, 260, 540, 280, "•\t First independent advice sentence.\n"),
            (30, 300, 540, 320, "•\t Second independent advice sentence.\n"),
        ]
        page = SimpleNamespace(rect=fitz.Rect(0, 0, 595, 842), get_text=lambda kind: blocks)
        self.assertEqual(extractor.fallback_table_candidates(page, []), [])

    def test_original_delimited_lines_remain_valid_fallback_rows(self):
        blocks = [(30, 60, 540, 120, "Result | Action | Timing\nExample A | Review | Day 3\nExample B | Withhold | Day 5\n")]
        page = SimpleNamespace(rect=fitz.Rect(0, 0, 595, 842), get_text=lambda kind: blocks)
        candidates = extractor.fallback_table_candidates(page, [])
        self.assertEqual(len(candidates), 1)
        self.assertEqual(candidates[0]["table_rows"], [
            ["Result", "Action", "Timing"],
            ["Example A", "Review", "Day 3"],
            ["Example B", "Withhold", "Day 5"],
        ])

    def test_outline_reference_and_recommendation_labels_are_not_columns(self):
        examples = (
            ["1.\tIntroduction", "1.1\tAim", "1.2\tScope"],
            ["134.\tFirst reference begins here", "135.\tSecond reference begins here"],
            ["A.\tFirst recommendation begins here", "B.\tSecond recommendation begins here"],
        )
        for lines in examples:
            with self.subTest(lines=lines):
                blocks = [(30, 60 + 40 * i, 540, 80 + 40 * i, line) for i, line in enumerate(lines)]
                blocks.append((30, 250, 540, 290, "Continuation completes the preceding paragraph.\n"))
                page = SimpleNamespace(rect=fitz.Rect(0, 0, 595, 842), get_text=lambda kind: blocks)
                self.assertEqual(extractor.fallback_table_candidates(page, []), [])

    def test_decimal_numeric_columns_remain_eligible(self):
        blocks = [(30, 60, 540, 120, "Value\tResult\n1.3\t2.7\n2.4\t3.8\n")]
        page = SimpleNamespace(rect=fitz.Rect(0, 0, 595, 842), get_text=lambda kind: blocks)
        candidates = extractor.fallback_table_candidates(page, [])
        self.assertEqual(len(candidates), 1)
        self.assertEqual(candidates[0]["table_rows"][1], ["1.3", "2.7"])

    def test_explicit_pipe_decimal_to_text_columns_remain_eligible(self):
        blocks = [(30, 60, 540, 120, "Value | Action | Timing\n1.3 | Review | Day 3\n2.4 | Withhold | Day 5\n")]
        page = SimpleNamespace(rect=fitz.Rect(0, 0, 595, 842), get_text=lambda kind: blocks)
        candidates = extractor.fallback_table_candidates(page, [])
        self.assertEqual(len(candidates), 1)
        self.assertEqual(candidates[0]["table_rows"][1], ["1.3", "Review", "Day 3"])

    def test_rejected_grid_cannot_be_readmitted_in_either_coordinate_frame(self):
        for rotation in (0, 90):
            with self.subTest(rotation=rotation):
                matrix = fitz.Matrix(0, 1, -1, 0, 800, 0) if rotation else fitz.Identity
                display_rect = fitz.Rect(590, 80, 790, 220)
                blocks = [
                    (*tuple(fitz.Rect(610, y, 770, y + 20) * ~matrix), text)
                    for y, text in ((100, "Alpha | 25 units"), (160, "Beta | 75 units"))
                ]
                table = SimpleNamespace(bbox=tuple(display_rect), extract=lambda: [["Only one populated cell", ""], ["", ""]])
                page = SimpleNamespace(
                    rect=fitz.Rect(0, 0, 800, 500),
                    rotation_matrix=matrix,
                    find_tables=lambda: SimpleNamespace(tables=[table]),
                    get_text=lambda kind: blocks,
                )
                rejected = []
                self.assertEqual(extractor.likely_table_candidates(page, rejected), [])
                self.assertEqual(rejected, [display_rect])
                # The source lines would otherwise pass the weaker heuristic.
                candidates = extractor.fallback_table_candidates(page, [])
                self.assertEqual(len(candidates), 1)
                self.assertGreater(candidates[0]["rect"].x0, 590)
                self.assertEqual(extractor.fallback_table_candidates(page, rejected), [])

    def test_repeated_matrix_accepts_merged_headers_and_empty_cells(self):
        rows = [["Shared heading", None, None], ["Result", "Action", "Timing"], ["Example A", "", "Day 3"], ["Example B", "Review", ""]]
        markdown = extractor.table_rows_to_markdown(rows)
        self.assertTrue(extractor.real_table_candidate(None, None, markdown, 4, 3, rows))
        table = SimpleNamespace(bbox=(10, 10, 580, 400), extract=lambda: rows)
        page = SimpleNamespace(
            find_tables=lambda: SimpleNamespace(tables=[table]),
            get_text=lambda kind: [],
        )
        candidates = extractor.likely_table_candidates(page)
        self.assertEqual(len(candidates), 1)
        self.assertEqual(candidates[0]["table_rows"], [["Shared heading", "", ""], *rows[1:]])


class MergedHeaderTests(unittest.TestCase):
    """A title row merged across every column sits above an ordinary grid."""

    def test_rows_stay_intact_under_a_merged_title(self):
        rows = [
            (["WBC"], ["3.5 or above"], ["3.0 to 3.5:", "repeat twice", "weekly"], ["Below 3.0:", "stop clozapine"]),
            (["Neutrophils"], ["2.0 or above"], ["1.5 to 2.0:", "repeat twice", "weekly"], ["Below 1.5:", "stop clozapine"]),
        ]
        text = rebuilt_text(
            lambda page: draw_table(
                page,
                [40, 170, 300, 430, 555],
                80,
                ["Count (x 10^9/L)", "Green", "Amber", "Red"],
                rows,
                merged_header="Clozapine full blood count ranges",
            )
        )
        self.assertIn("Clozapine full blood count ranges", text)
        wbc, neutrophils = text.index("WBC"), text.index("Neutrophils")
        self.assertLess(wbc, text.index("Below 3.0"))
        self.assertLess(text.index("Below 3.0"), neutrophils, "WBC red range must stay in the WBC row")
        self.assertLess(neutrophils, text.index("Below 1.5"))
        self.assertIn("Below 3.0: stop clozapine", text)
        self.assertIn("1.5 to 2.0: repeat twice weekly", text)


if __name__ == "__main__":
    unittest.main()
