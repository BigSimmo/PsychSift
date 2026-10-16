"""Regression: multi-line table cells must not interleave across columns.

Failing stage (pre-fix): page text came straight from
`page.get_text("text", sort=True)`, which orders text LINES by (y, x). A table
whose cells wrap onto several lines therefore reads straight ACROSS the columns,
so a figure in column one lands mid-sentence in column three.

Observed in production on 2026-09-16, in a WA clozapine haematological table
retrieved by the live public search. The served passage read:

    "Neutropenia Requires medical review. Stop clozapine. Contact
     WBC < 1.5 x 10 9/L. Flu-like symptoms such 3.2% haematologist ..."

binding the withhold threshold to the word "Contact" rather than to
"Neutropenia". Answer verification correctly refused to state a clozapine
threshold from that text, which is why four clozapine eval cases generated an
answer and then discarded it.

Fix stage: extract_pdf_assets.table_aware_page_text replaces detected grid
regions with the cell-by-cell rendering find_tables() already produces, leaving
surrounding prose in normal reading order.
"""

from __future__ import annotations

import os
import re
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(__file__))
import extract_pdf_assets as extractor

fitz = extractor.fitz

# Shaped like the real Rockingham Peel clozapine table: three columns, and a
# first column whose cell wraps over several lines. The wrap is what breaks
# line-major ordering, so a single-line-cell table would not reproduce this.
HEADER = ["Side effects/Signs and symptoms", "Rate", "Recommended action"]
ROWS = [
    (
        [
            "Neutropenia",
            "WBC < 1.5 x 10 9/L. Flu-like symptoms such",
            "as sore throat and fever may be present.",
            "(This is most common within the first 18",
            "weeks but may uncommonly occur after",
            "this maximal risk period).",
        ],
        ["3.2%"],
        [
            "Requires medical review. Stop clozapine. Contact",
            "haematologist at ClopineCentral or clozapine",
            "patient monitoring centre if further advice",
            "required. Re-introduction of clozapine should only",
            "occur with haematologist support.",
        ],
    ),
    (
        [
            "Agranulocytosis",
            "WBC < 0.5 x 10 9/L. Flu-like symptoms such",
            "as sore throat and fever may be present.",
        ],
        ["0.8%"],
        [
            "Requires medical review. Stop clozapine.",
            "Contact haematologist at ClopineCentral or",
            "clozapine patient monitoring centre.",
        ],
    ),
]

COLUMN_X = [40, 250, 310, 555]
LINE_HEIGHT = 13
# The exact interleaving signature seen in production: the action text from
# column three wedged between the condition and its threshold.
INTERLEAVED = re.compile(r"Stop clozapine\.\s*Contact\s*WBC < 1\.5")


def build_table_pdf(path):
    document = fitz.open()
    page = document.new_page(width=595, height=842)
    y = 60

    def rule(at):
        page.draw_line(fitz.Point(COLUMN_X[0], at), fitz.Point(COLUMN_X[-1], at), width=0.7)

    rule(y - 4)
    for index, heading in enumerate(HEADER):
        page.insert_text(fitz.Point(COLUMN_X[index] + 3, y + 8), heading, fontsize=9)
    y += LINE_HEIGHT + 4
    rule(y - 4)

    for cells in ROWS:
        top = y
        for index, lines in enumerate(cells):
            line_y = top
            for line in lines:
                page.insert_text(fitz.Point(COLUMN_X[index] + 3, line_y + 8), line, fontsize=9)
                line_y += LINE_HEIGHT
        y = top + max(len(cell) for cell in cells) * LINE_HEIGHT + 4
        rule(y - 4)

    for x in COLUMN_X:
        page.draw_line(fitz.Point(x, 56), fitz.Point(x, y - 4), width=0.7)

    document.save(path)
    document.close()


def flatten(value):
    return re.sub(r"\s+", " ", value or "").strip()


class TableReadingOrderTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls._directory = tempfile.TemporaryDirectory()
        cls.pdf_path = os.path.join(cls._directory.name, "clozapine-table.pdf")
        build_table_pdf(cls.pdf_path)

    @classmethod
    def tearDownClass(cls):
        cls._directory.cleanup()

    def page(self, document):
        return document[0]

    def test_raw_sorted_text_reproduces_the_interleaving(self):
        """Pin the defect itself, so a PyMuPDF change that fixes it upstream is visible."""
        with fitz.open(self.pdf_path) as document:
            raw = flatten(self.page(document).get_text("text", sort=True))
        self.assertRegex(raw, INTERLEAVED)

    def test_table_aware_text_keeps_each_cell_intact(self):
        with fitz.open(self.pdf_path) as document:
            page = self.page(document)
            rebuilt = flatten(extractor.table_aware_page_text(page, extractor.likely_table_candidates(page)))

        # The defect is gone.
        self.assertNotRegex(rebuilt, INTERLEAVED)
        # The threshold now sits with the condition it qualifies...
        self.assertRegex(rebuilt, r"Neutropenia WBC < 1\.5 x 10 9/L")
        self.assertRegex(rebuilt, r"Agranulocytosis WBC < 0\.5 x 10 9/L")
        # ...and the action is intact rather than shredded across the row.
        self.assertIn("Requires medical review. Stop clozapine. Contact haematologist", rebuilt)
        # Nothing is silently dropped.
        self.assertIn("3.2%", rebuilt)
        self.assertIn("0.8%", rebuilt)

    def test_pages_without_a_detected_grid_are_left_alone(self):
        with fitz.open() as document:
            page = document.new_page(width=595, height=842)
            page.insert_text(fitz.Point(40, 60), "Plain prose with no table at all.", fontsize=11)
            raw = page.get_text("text", sort=True)
            self.assertEqual(extractor.table_aware_page_text(page, []), raw)
            self.assertEqual(extractor.table_aware_page_text(page, extractor.likely_table_candidates(page)), raw)

    def test_retention_guard_keeps_raw_text_when_detection_would_swallow_the_page(self):
        """A misdetected grid must never trade a populated page for a sparse one."""
        with fitz.open(self.pdf_path) as document:
            page = self.page(document)
            raw = page.get_text("text", sort=True)
            swallowing = [
                {
                    "rect": fitz.Rect(page.rect),
                    "extraction_method": "pymupdf_find_tables",
                    "accessible_table_markdown": "| x |",
                }
            ]
            self.assertEqual(extractor.table_aware_page_text(page, swallowing), raw)

    def test_non_grid_candidates_are_ignored(self):
        """Heuristic text-block candidates carry no true cell structure, so they must not rewrite text."""
        with fitz.open(self.pdf_path) as document:
            page = self.page(document)
            raw = page.get_text("text", sort=True)
            heuristic = [
                {
                    "rect": fitz.Rect(page.rect),
                    "extraction_method": "text_block_heuristic",
                    "accessible_table_markdown": "| x |",
                }
            ]
            self.assertEqual(extractor.table_aware_page_text(page, heuristic), raw)


class DisplayTextPage:
    """Synthetic native blocks with independently specified displayed line boxes."""

    def __init__(self, displayed_blocks, rotation=0):
        self.rotation = rotation
        self.rotation_matrix = fitz.Matrix(0, 1, -1, 0, 800, 0) if rotation else fitz.Matrix(1, 0, 0, 1, 0, 0)
        inverse = ~self.rotation_matrix
        self.blocks = []
        ordered_lines = []
        for block in displayed_blocks:
            lines = []
            for bbox, text in block:
                lines.append({
                    "bbox": tuple(fitz.Rect(bbox) * inverse),
                    "dir": (0, -1) if rotation else (1, 0),
                    "spans": [{"text": text}],
                })
                ordered_lines.append((bbox[1], bbox[0], text))
            self.blocks.append({"lines": lines})
        # Deliberately line-major, rather than the expected intact card order.
        self.raw = "\n".join(text for _, _, text in sorted(ordered_lines))

    def get_text(self, kind, **kwargs):
        if kind == "dict":
            return {"blocks": self.blocks}
        if kind == "text":
            return self.raw
        raise AssertionError("unexpected text request: " + kind)


class IntactLayoutTests(unittest.TestCase):
    def test_disjoint_overlapping_callout_keeps_ratio_and_prose_separate(self):
        page = DisplayTextPage([
            [((30, 100, 180, 114), "Reasons for this advice:")],
            [((300, 95, 330, 109), "1 in"), ((300, 110, 330, 124), "250")],
            [((350, 100, 510, 114), "An illustrative risk estimate.")],
        ])
        raw = "1 inReasons for this advice: 250 An illustrative risk estimate."
        rebuilt = extractor.table_aware_page_text(page, [], raw_text=raw)
        self.assertIn("1 in\n250", rebuilt)
        self.assertIn("Reasons for this advice:", rebuilt)
        self.assertNotIn("inReasons", rebuilt)
        for text in ("1 in", "250", "Reasons for this advice:", "An illustrative risk estimate."):
            self.assertEqual(rebuilt.count(text), 1)

    def test_rotated_cards_keep_all_label_volume_percentage_pairs_exactly_once(self):
        cards = []
        expected = []
        for index in range(8):
            x = 30 + (index % 4) * 190
            y = 100 + (index // 4) * 180
            label = "SAMPLE " + chr(65 + index)
            detail = f"{111 + index * 10} ml | {index + 1}.1% alc/vol"
            cards.append([((x, y, x + 125, y + 14), label), ((x, y + 18, x + 150, y + 32), detail)])
            expected.append(label + " " + detail)
        # Reproduce a producer-native block containing two distant cards.
        page = DisplayTextPage([cards[0] + cards[2], cards[3], cards[1], *cards[4:]], rotation=90)
        self.assertNotIn(expected[0], flatten(page.raw))
        rebuilt = flatten(extractor.table_aware_page_text(page, []))
        for pair in expected:
            self.assertEqual(rebuilt.count(pair), 1)
        self.assertEqual(rebuilt.count(" ml | "), 8)
        self.assertEqual(rebuilt.count("% alc/vol"), 8)
        self.assertEqual(rebuilt, " ".join(expected))

    def test_rotated_grid_containment_uses_display_boxes_without_changing_crop_rect(self):
        page = DisplayTextPage([
            [((30, 110, 130, 124), "First 111 ml")],
            [((230, 110, 330, 124), "Second 222 ml")],
            [((30, 150, 130, 164), "Third 333 ml")],
            [((230, 150, 330, 164), "Fourth 444 ml")],
            [((30, 500, 200, 514), "Outside explanatory prose.")],
        ], rotation=90)
        rect = fitz.Rect(20, 100, 350, 180)
        before = tuple(rect)
        markdown = "| First 111 ml | Second 222 ml |\n| Third 333 ml | Fourth 444 ml |"
        rebuilt = extractor.table_aware_page_text(page, [{
            "rect": rect,
            "extraction_method": "pymupdf_find_tables",
            "accessible_table_markdown": markdown,
        }])
        self.assertIn(markdown, rebuilt)
        self.assertIn("Outside explanatory prose.", rebuilt)
        for label in ("First 111 ml", "Second 222 ml", "Third 333 ml", "Fourth 444 ml"):
            self.assertEqual(rebuilt.count(label), 1)
        self.assertEqual(tuple(rect), before)


class RotatedVisualGeometryTests(unittest.TestCase):
    def test_rejected_grid_retains_complete_rotated_visual_without_table_facts(self):
        with tempfile.TemporaryDirectory() as directory:
            path = os.path.join(directory, "rotated-illustration.pdf")
            with fitz.open() as document:
                page = document.new_page(width=500, height=800)
                for x in (0, 250, 500):
                    page.draw_line((x, 0), (x, 800))
                for y in (0, 400, 800):
                    page.draw_line((0, y), (500, y))
                page.insert_text((30, 50), "Top illustration with an independent label.", fontsize=9)
                page.insert_text((30, 700), "Second illustration has no shared table columns.", fontsize=9)
                # In display coordinates this marker lies beyond the native
                # page width, where the former mixed-frame crop lost content.
                page.draw_circle((30, 25), 8, color=(1, 0, 0), fill=(1, 0, 0))
                page.set_rotation(90)
                rejected = []
                self.assertEqual(extractor.likely_table_candidates(page, rejected), [])
                self.assertEqual(rejected, [fitz.Rect(0, 0, 800, 500)])
                document.save(path)

            result = extractor.extract(path, os.path.join(directory, "out"))
            self.assertFalse(any(image["sourceKind"] == "table_crop" for image in result["images"]))
            visuals = [image for image in result["images"] if image["sourceKind"] == "page_region"]
            self.assertEqual(len(visuals), 1)
            visual = visuals[0]
            self.assertEqual(visual["bbox"], [0, 0, 800, 500])
            self.assertEqual(visual["metadata"]["clip_bbox"], [0, 0, 800, 500])
            self.assertEqual(visual["metadata"]["page_rotation"], 90)
            self.assertNotIn("table_rows", visual["metadata"])
            self.assertNotIn("accessible_table_markdown", visual["metadata"])
            pixmap = fitz.Pixmap(visual["path"])
            red, green, blue = pixmap.pixel(int(775 * pixmap.width / 800), int(30 * pixmap.height / 500))[:3]
            self.assertGreater(red, 240)
            self.assertLess(green, 20)
            self.assertLess(blue, 20)
            self.assertIn("Top illustration with an independent label.", result["pages"][0]["text"])
            self.assertIn("Second illustration has no shared table columns.", result["pages"][0]["text"])

    def test_vector_geometry_is_transformed_before_display_page_clipping(self):
        with fitz.open() as document:
            page = document.new_page(width=500, height=800)
            boxes = [
                (50, 40, 150, 120), (250, 40, 350, 120),
                (50, 160, 150, 240), (250, 160, 350, 240),
            ]
            for box in boxes:
                page.draw_rect(box)
            page.set_rotation(90)
            self.assertEqual(extractor.likely_vector_region(page), fitz.Rect(548, 38, 772, 362))
            self.assertEqual(extractor.page_drawing_rects(page), [fitz.Rect(box) * page.rotation_matrix for box in boxes])


class OcrDecisionIndependenceTests(unittest.TestCase):
    """The table-aware rewrite must not change whether a page is OCR'd.

    Raised as P1 in review of PR #2810. `should_ocr_page` carries hard character
    thresholds (40 always, and 220 on image-dominant pages), so passing it the
    rebuilt text lets markdown syntax move a page across a threshold. The review
    predicted a page SKIPPING needed OCR; measured on synthetic image-dominant
    grids the rebuilt text is shorter and the error runs the other way, causing
    needless OCR. Both directions are the same defect: an OCR decision changed by
    a chunking fix. The decision is therefore taken on raw embedded text.
    """

    def build_image_dominant_grid(self, path, columns=2, rows=3, cell="Repeat FBC weekly"):
        document = fitz.open()
        page = document.new_page(width=560, height=400)
        pixmap = fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, 560, 215))
        pixmap.clear_with(200)
        page.insert_image(fitz.Rect(0, 0, 560, 215), pixmap=pixmap)

        xs = [20 + index * (520 // columns) for index in range(columns + 1)]
        ys = [240 + index * 18 for index in range(rows + 1)]
        for row in range(rows):
            for column in range(columns):
                page.insert_text(fitz.Point(xs[column] + 3, ys[row] + 11), cell, fontsize=7)
        for y in ys:
            page.draw_line(fitz.Point(xs[0], y), fitz.Point(xs[-1], y), width=0.7)
        for x in xs:
            page.draw_line(fitz.Point(x, ys[0]), fitz.Point(x, ys[-1]), width=0.7)
        document.save(path)
        document.close()

    def test_raw_and_rebuilt_text_disagree_on_this_page(self):
        """Guard the guard: if this stops disagreeing the next test proves nothing."""
        with tempfile.TemporaryDirectory() as directory:
            path = os.path.join(directory, "image-dominant-grid.pdf")
            self.build_image_dominant_grid(path)
            with fitz.open(path) as document:
                page = document[0]
                raw = page.get_text("text", sort=True) or ""
                rebuilt = extractor.table_aware_page_text(page, extractor.likely_table_candidates(page))
                self.assertGreaterEqual(extractor.page_image_coverage_ratio(page), 0.45)
                self.assertNotEqual(
                    extractor.should_ocr_page(raw, page),
                    extractor.should_ocr_page(rebuilt, page),
                    "fixture no longer exercises the threshold crossing",
                )

    def test_extract_takes_the_ocr_decision_from_raw_text(self):
        with tempfile.TemporaryDirectory() as directory:
            path = os.path.join(directory, "image-dominant-grid.pdf")
            self.build_image_dominant_grid(path)
            with fitz.open(path) as document:
                page = document[0]
                raw = page.get_text("text", sort=True) or ""
                expected = extractor.should_ocr_page(raw, page)

            output = os.path.join(directory, "out")
            os.makedirs(output, exist_ok=True)
            result = extractor.extract(path, output)
            first = result["pages"][0]
            attempted = bool(first["ocrUsed"]) or bool(first["needsOcr"])
            self.assertEqual(
                attempted,
                expected,
                "OCR decision must follow the raw embedded text, not the table-aware rewrite",
            )

    def test_raw_text_argument_is_honoured(self):
        with fitz.open() as document:
            page = document.new_page(width=400, height=400)
            page.insert_text(fitz.Point(40, 60), "Prose only.", fontsize=11)
            self.assertEqual(extractor.table_aware_page_text(page, [], raw_text="SUPPLIED"), "SUPPLIED")


if __name__ == "__main__":
    unittest.main()
