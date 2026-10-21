"""Synthetic, bounded PDF acceptance cases; no clinical accuracy certification.

The real-OCR cases use the existing pinned local model and page deadlines. A
readable-looking substitution for a comparator or exponent is a failure, even
though OCR provenance correctly remains unverified.
"""

import importlib.util
import os
from pathlib import Path
import re
import shutil
import tempfile
import unittest
from unittest.mock import patch

import extract_pdf_assets as extractor
from test_extract_pdf_assets_hard_tables import draw_table


fitz = extractor.fitz


def flat(text):
    return re.sub(r"\s+", " ", text or "").strip()


def write_fixture(directory, build, scanned=False):
    """Generate the same visible source as native text or a 300-dpi scan."""
    path = Path(directory) / "synthetic-coverage.pdf"
    with fitz.open() as source:
        page = source.new_page(width=595, height=842)
        build(page)
        if scanned:
            pixels = page.get_pixmap(dpi=300, colorspace=fitz.csGRAY)
            with fitz.open() as scan:
                target = scan.new_page(width=595, height=842)
                target.insert_image(target.rect, stream=pixels.tobytes("png"))
                scan.save(path)
        else:
            source.save(path)
    return path


def symbol_table(page):
    """Unicode superscript and relation signs, rather than ASCII lookalikes."""
    xs, ys = (40, 220, 390, 555), (80, 112, 152, 192)
    for x in xs:
        page.draw_line((x, ys[0]), (x, ys[-1]), width=0.7)
    for y in ys:
        page.draw_line((xs[0], y), (xs[-1], y), width=0.7)
    writer = fitz.TextWriter(page.rect)
    font = fitz.Font("helv")
    rows = (
        ("Count (x 10⁹/L)", "Threshold", "SYNTHETIC action"),
        ("Example A", "≤ 1.5", "Withhold example A"),
        ("Example B", "≥ 2.0", "Review example B"),
    )
    for row_index, row in enumerate(rows):
        for column, text in enumerate(row):
            # TextWriter supplies MuPDF's bundled Unicode fallback for ⁹;
            # no host font, downloaded asset or binary fixture is needed.
            writer.append((xs[column] + 5, ys[row_index] + 21), text, font=font, fontsize=11)
    writer.write_text(page)


def merged_qualifier_table(page):
    xs = (40, 215, 390, 555)
    ys = (80, 108, 136, 170, 204, 232, 266)
    for y in ys:
        page.draw_line((xs[0], y), (xs[-1], y), width=0.7)
    for x in (xs[0], xs[-1]):
        page.draw_line((x, ys[0]), (x, ys[-1]), width=0.7)
    # The two qualification bands span all three columns mid-table.
    for top, bottom in ((80, 108), (136, 204), (232, 266)):
        for x in xs[1:-1]:
            page.draw_line((x, top), (x, bottom), width=0.7)
    rows = (
        ("SYNTHETIC phase", "Result", "Action"),
        ("INITIAL PHASE ONLY: applies to both following rows",),
        ("Example A", "Below 1.0", "Withhold example A"),
        ("Example B", "Above 2.0", "Review example B"),
        ("MAINTENANCE ONLY: applies to the following row",),
        ("Example C", "Below 3.0", "Repeat example C"),
    )
    for index, row in enumerate(rows):
        for column, text in enumerate(row):
            page.insert_text((xs[column] + 4, ys[index] + 18), text, fontsize=9)


def staggered_columns(page):
    # Opposite insertion order and staggered baselines make PDF stream order
    # and line-major order both discriminate against intact physical columns.
    for x, top, lines in (
        (330, 60, ("RIGHT QUALIFIER", "Only after rest.", "Repeat before discharge.")),
        (40, 45, ("LEFT QUALIFIER", "Only after fasting.", "Recheck before action.")),
    ):
        for offset, line in enumerate(lines):
            page.insert_text((x, top + offset * 30), line, fontsize=11)
    draw_table(page, [40, 215, 390, 555], 180,
               ["SYNTHETIC result", "Action", "Timing"], [
                   (["Example A"], ["Withhold example A"], ["Day 3"]),
                   (["Example B"], ["Review example B"], ["Day 5"]),
               ])


class NativeCoverageAcceptanceTests(unittest.TestCase):
    def test_mid_table_merged_qualifiers_keep_their_row_groups(self):
        with tempfile.TemporaryDirectory() as directory:
            path = write_fixture(directory, merged_qualifier_table)
            result = extractor.extract(str(path), str(Path(directory) / "out"))
        text = flat(result["pages"][0]["text"])
        markers = (
            "INITIAL PHASE ONLY: applies to both following rows",
            "Example A | Below 1.0 | Withhold example A",
            "Example B | Above 2.0 | Review example B",
            "MAINTENANCE ONLY: applies to the following row",
            "Example C | Below 3.0 | Repeat example C",
        )
        positions = [text.index(marker) for marker in markers]
        self.assertEqual(positions, sorted(positions))
        for marker in markers:
            self.assertEqual(text.count(marker), 1)
        self.assertFalse(result["pages"][0]["ocrUsed"])

    def test_native_unicode_exponent_and_inclusive_comparators_are_preserved(self):
        with tempfile.TemporaryDirectory() as directory:
            path = write_fixture(directory, symbol_table)
            result = extractor.extract(str(path), str(Path(directory) / "out"))
        text = flat(result["pages"][0]["text"])
        self.assertIn("Count (x 10⁹/L)", text)
        self.assertIn("Example A | ≤ 1.5 | Withhold example A", text)
        self.assertIn("Example B | ≥ 2.0 | Review example B", text)
        self.assertFalse(result["pages"][0]["ocrUsed"])


@unittest.skipUnless(shutil.which("tesseract") and importlib.util.find_spec("pytesseract")
                     and importlib.util.find_spec("PIL"), "Local OCR dependencies are required")
class RealOcrCoverageAcceptanceTests(unittest.TestCase):
    def extract_scan(self, build):
        with tempfile.TemporaryDirectory() as directory:
            path = write_fixture(directory, build, scanned=True)
            with patch.dict(os.environ, {"PDF_RASTER_TABLE_OCR": "1"}):
                result = extractor.extract(str(path), str(Path(directory) / "out"))
        page = result["pages"][0]
        self.assertTrue(page["ocrUsed"])
        self.assertFalse(page["needsOcr"])
        provenance = page["metadata"]["source_provenance"]
        self.assertEqual(provenance["ocr"]["status"], "unverified")
        self.assertEqual(provenance["ocr"]["comparison"], "not_compared")
        self.assertIsNone(provenance["ocr"]["confidence"])
        return flat(page["text"])

    def test_staggered_outside_columns_keep_qualifiers_and_read_left_first(self):
        text = self.extract_scan(staggered_columns)
        left = "LEFT QUALIFIER Only after fasting. Recheck before action."
        right = "RIGHT QUALIFIER Only after rest. Repeat before discharge."
        self.assertIn(left, text)
        self.assertIn(right, text)
        self.assertLess(text.index(left), text.index(right))
        self.assertLess(text.index(right), text.index("Example A"))
        self.assertIn("Example A | Withhold example A | Day 3", text)
        self.assertIn("Example B | Review example B | Day 5", text)

    # Unresolved recognition defect: the pinned Latin vocabulary lacks these
    # glyphs, and bounded crop/model/segmentation diagnostics did not recover
    # equivalent semantics. Keep every strict assertion; report this expected
    # failure separately. Unexpected success forces reassessment on an upgrade.
    @unittest.expectedFailure
    def test_scanned_unicode_exponent_and_inclusive_comparators_are_preserved(self):
        text = self.extract_scan(symbol_table)
        # Accept either unambiguous exponent spelling, never baseline 109 or
        # a lost/reversed equality stroke. Source units must retain their power.
        for name, pattern in (
            ("unit exponent", r"Count \(x 10(?:⁹|\^9)/L\)"),
            ("inclusive upper threshold", r"Example A \| ≤ 1\.5 \| Withhold example A"),
            ("inclusive lower threshold", r"Example B \| ≥ 2\.0 \| Review example B"),
        ):
            with self.subTest(source_semantics=name):
                self.assertRegex(text, pattern)


if __name__ == "__main__":
    unittest.main()
