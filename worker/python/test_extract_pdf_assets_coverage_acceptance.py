"""Synthetic, bounded PDF acceptance cases; no clinical accuracy certification.

The real-OCR cases use the existing pinned local model and page deadlines. A
readable-looking substitution for a comparator or exponent is a failure, even
though OCR provenance correctly remains unverified.
"""

import importlib.util
from functools import partial
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
    return write_paged_fixture(directory, (build,), scanned=scanned)


def write_paged_fixture(directory, builders, scanned=False):
    path = Path(directory) / "synthetic-coverage.pdf"
    with fitz.open() as source:
        for build in builders:
            page = source.new_page(width=595, height=842)
            build(page)
        if scanned:
            with fitz.open() as scan:
                for page in source:
                    pixels = page.get_pixmap(dpi=300, colorspace=fitz.csGRAY)
                    target = scan.new_page(width=595, height=842)
                    target.insert_image(target.rect, stream=pixels.tobytes("png"))
                scan.save(path)
        else:
            source.save(path)
    return path


def symbol_table(page, font_name="helv", fontsize=11, exponent="⁹", thresholds=("1.5", "2.0")):
    """Unicode superscript and relation signs, rather than ASCII lookalikes."""
    xs, ys = (40, 220, 390, 555), (80, 112, 152, 192)
    for x in xs:
        page.draw_line((x, ys[0]), (x, ys[-1]), width=0.7)
    for y in ys:
        page.draw_line((xs[0], y), (xs[-1], y), width=0.7)
    writer = fitz.TextWriter(page.rect)
    font = fitz.Font(font_name)
    rows = (
        (f"Count (x 10{exponent}/L)", "Threshold", "SYNTHETIC action"),
        ("Example A", f"≤ {thresholds[0]}", "Withhold example A"),
        ("Example B", f"≥ {thresholds[1]}", "Review example B"),
    )
    for row_index, row in enumerate(rows):
        for column, text in enumerate(row):
            # TextWriter supplies MuPDF's bundled Unicode fallback for powers;
            # no host font, downloaded asset or binary fixture is needed.
            writer.append((xs[column] + 5, ys[row_index] + 21), text, font=font, fontsize=fontsize)
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


COMPARISON_ROWS = (
    ("Example A", "< 0.4", "Withhold example A"),
    ("Example B", "<= 0.04", "Review example B"),
    ("Example C", "> 1.2", "Repeat example C"),
    ("Example D", ">= 12.0", "Recheck example D"),
)


def paired_comparison_table(page):
    # These pairs deliberately differ in equality stroke, direction and decimal
    # position. Inferring a familiar threshold or upgrading every < to <= fails.
    draw_table(page, [40, 230, 390, 555], 80,
               ["Count (x 10^9/L)", "Threshold", "SYNTHETIC action"],
               [tuple([cell] for cell in row) for row in COMPARISON_ROWS],
               merged_header="SYNTHETIC COMPARISON CONTROLS")


PAGED_NOTES = (
    ("INITIAL PHASE ONLY", "< 0.4", "Withhold example A", "Only after fasting.", "10^9"),
    ("MAINTENANCE ONLY", "> 0.04", "Review example A", "Only after rest.", "10^6"),
)


def page_local_note_table(index):
    def build(page):
        phase, threshold, action, note, exponent = PAGED_NOTES[index]
        draw_table(page, [40, 230, 390, 555], 80,
                   [f"Count (x {exponent}/L)", "Threshold", "SYNTHETIC action"], [
                       (["Example A (a)"], [threshold], [action]),
                       (["Example B"], ["2.0"], ["Repeat example B"]),
                   ], merged_header=phase)
        # The marker is intentionally reused on the next page with a different
        # qualifier. A document-wide association must not join the two notes.
        page.insert_text((40, 210), f"Note (a): {note}", fontsize=11)
    return build


class CoverageAssertions:
    def assert_comparison_cells(self, text):
        self.assertIn("Count (x 10^9/L)", text)
        positions = []
        for row in COMPARISON_ROWS:
            marker = " | ".join(row)
            self.assertEqual(text.count(marker), 1, marker)
            positions.append(text.index(marker))
        self.assertEqual(positions, sorted(positions))

    def assert_page_local_notes(self, pages):
        self.assertEqual(len(pages), 2)
        for index, page in enumerate(pages):
            with self.subTest(physical_page=index + 1):
                phase, threshold, action, note, exponent = PAGED_NOTES[index]
                other_phase, other_threshold, other_action, other_note, other_exponent = PAGED_NOTES[1 - index]
                text = flat(page["text"])
                row = f"Example A (a) | {threshold} | {action}"
                footnote = f"Note (a): {note}"
                for marker in (phase, f"Count (x {exponent}/L)", row, footnote):
                    self.assertEqual(text.count(marker), 1, marker)
                self.assertLess(text.index(phase), text.index(row))
                self.assertLess(text.index(row), text.index(footnote))
                for foreign in (other_phase, other_threshold, other_action, other_note, other_exponent):
                    self.assertNotIn(foreign, text)
                self.assertEqual(page["pageNumber"], index + 1)
                self.assertEqual(page["metadata"]["source_provenance"]["physicalPageNumber"], index + 1)


class NativeCoverageAcceptanceTests(CoverageAssertions, unittest.TestCase):
    def test_paired_comparators_keep_decimal_positions_and_owning_actions(self):
        with tempfile.TemporaryDirectory() as directory:
            path = write_fixture(directory, paired_comparison_table)
            result = extractor.extract(str(path), str(Path(directory) / "out"))
        self.assert_comparison_cells(flat(result["pages"][0]["text"]))
        self.assertFalse(result["pages"][0]["ocrUsed"])

    def test_repeated_headers_and_footnote_markers_keep_page_local_owners(self):
        with tempfile.TemporaryDirectory() as directory:
            path = write_paged_fixture(directory, tuple(page_local_note_table(index) for index in range(2)))
            result = extractor.extract(str(path), str(Path(directory) / "out"))
        self.assert_page_local_notes(result["pages"])
        self.assertTrue(all(not page["ocrUsed"] for page in result["pages"]))

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
class RealOcrCoverageAcceptanceTests(CoverageAssertions, unittest.TestCase):
    def extract_scan(self, build):
        return flat(self.extract_scan_pages((build,))[0]["text"])

    def extract_scan_pages(self, builders):
        with tempfile.TemporaryDirectory() as directory:
            path = write_paged_fixture(directory, builders, scanned=True)
            with patch.dict(os.environ, {"PDF_RASTER_TABLE_OCR": "1"}):
                result = extractor.extract(str(path), str(Path(directory) / "out"))
        self.assertEqual(len(result["pages"]), len(builders))
        for page in result["pages"]:
            self.assertTrue(page["ocrUsed"])
            self.assertFalse(page["needsOcr"])
            provenance = page["metadata"]["source_provenance"]
            self.assertEqual(provenance["ocr"]["status"], "unverified")
            self.assertEqual(provenance["ocr"]["comparison"], "not_compared")
            self.assertIsNone(provenance["ocr"]["confidence"])
        return result["pages"]

    def test_scanned_paired_comparators_keep_decimal_positions_and_owning_actions(self):
        self.assert_comparison_cells(self.extract_scan(paired_comparison_table))

    def test_scanned_repeated_headers_and_footnote_markers_keep_page_local_owners(self):
        self.assert_page_local_notes(self.extract_scan_pages(
            tuple(page_local_note_table(index) for index in range(2))))

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

    def test_scanned_unicode_math_variants_keep_values_and_observe_input_transforms(self):
        variants = (
            ("tiro", 12, "⁶", "6", ("0.4", "3.25")),
            ("cour", 10, "³", "3", ("0.04", "12.0")),
        )
        pages = self.extract_scan_pages(tuple(
            partial(symbol_table, font_name=font, fontsize=size, exponent=exponent, thresholds=thresholds)
            for font, size, exponent, _power, thresholds in variants
        ))
        for page, (font, size, exponent, power, thresholds) in zip(pages, variants):
            with self.subTest(font=font, fontsize=size, power=power, thresholds=thresholds):
                text = flat(page["text"])
                patterns = (
                    rf"Count \(x 10(?:{re.escape(exponent)}|\^{power})/L\)",
                    rf"Example A \| ≤ {re.escape(thresholds[0])} \| Withhold example A",
                    rf"Example B \| ≥ {re.escape(thresholds[1])} \| Review example B",
                )
                for pattern in patterns:
                    self.assertEqual(len(re.findall(pattern, text)), 1, pattern)
                observations = page["metadata"]["raster_table_ocr"]
                self.assertEqual(observations["status"], "unverified")
                self.assertEqual(extractor.DEFAULT_BUDGET["maxRenderPixels"], 4_000_000)
                self.assertEqual(extractor.MAX_OCR_RENDER_SCALE, 450 / 72)
                self.assertEqual(observations["cellModel"], {
                    "language": "Latin",
                    "sha256": "sha256:6dbdaf8ecc6c40f025c2648bf3b3f3fbffe073e1fd2df2047fde2e2b2f020d53",
                    "bytes": 89_384_811,
                })
                transformed = [crop for crop in observations["crops"] if "ocrInputTransform" in crop]
                self.assertEqual(sorted(crop["ocrInputTransform"]["kind"] for crop in transformed),
                                 ["comparison", "comparison", "superscript"])
                for crop in observations["crops"]:
                    self.assertGreater(crop["width"], 0)
                    self.assertGreater(crop["height"], 0)
                    self.assertLessEqual(crop["width"] * crop["height"],
                                         extractor.DEFAULT_BUDGET["maxRenderPixels"])
                    self.assertLessEqual(crop["scale"], extractor.MAX_OCR_RENDER_SCALE)
                for crop in transformed:
                    transform = crop["ocrInputTransform"]
                    self.assertEqual(transform["algorithm"], "raster-math-topology-v1")
                    self.assertRegex(crop["pngSha256"], r"\Asha256:[0-9a-f]{64}\Z")
                    self.assertRegex(crop["pixelsSha256"], r"\Asha256:[0-9a-f]{64}\Z")
                    self.assertRegex(transform["pixelsSha256"], r"\Asha256:[0-9a-f]{64}\Z")
                    self.assertRegex(transform["codeSha256"], r"\Asha256:[0-9a-f]{64}\Z")
                    self.assertEqual(transform["codeSha256"],
                                     extractor.file_sha256(Path(extractor.__file__).with_name("raster_math_ocr.py")))
                    self.assertNotEqual(transform["pixelsSha256"], crop["pixelsSha256"])
                    self.assertGreater(transform["width"], 0)
                    self.assertGreater(transform["height"], 0)
                    self.assertLessEqual(transform["width"] * transform["height"],
                                         extractor.DEFAULT_BUDGET["maxRenderPixels"])


if __name__ == "__main__":
    unittest.main()
