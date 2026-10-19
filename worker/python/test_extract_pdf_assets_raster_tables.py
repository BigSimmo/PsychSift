"""Default-off ruled raster OCR: actual source cells, not inferred clinical values."""
import importlib.util
import os
from pathlib import Path
import re
import shutil
import tempfile
import time
import unittest
from unittest.mock import patch

import extract_pdf_assets as extractor
from test_extract_pdf_assets_hard_tables import draw_table, LITHIUM_ROWS, LITHIUM_XS

try:
    from PIL import Image, ImageDraw
except ImportError:
    Image = ImageDraw = None

MERGED_ROWS = [
    (["WBC"], ["3.5 or above"], ["3.0 to 3.5:", "repeat twice", "weekly"], ["Below 3.0:", "stop clozapine"]),
    (["Neutrophils"], ["2.0 or above"], ["1.5 to 2.0:", "repeat twice", "weekly"], ["Below 1.5:", "stop clozapine"]),
]


def scanned_table(directory, merged=True, outside_columns=False):
    native = extractor.fitz.open()
    page = native.new_page(width=595, height=842)
    page.insert_text((40, 40), "SYNTHETIC TEST SOURCE - NOT CLINICAL GUIDANCE", fontsize=9)
    table_top = 220 if outside_columns else 80
    if outside_columns:
        page.insert_textbox(extractor.fitz.Rect(40, 60, 270, 150), "LEFT CONTEXT\nKeep this qualification attached\nto its own paragraph.", fontsize=10)
        page.insert_textbox(extractor.fitz.Rect(330, 60, 555, 150), "RIGHT CONTEXT\nKeep this independent explanation\nwith its own source.", fontsize=10)
    if merged:
        draw_table(page, [40, 170, 300, 430, 555], table_top,
                   ["Count (x 10^9/L)", "Green", "Amber", "Red"], MERGED_ROWS,
                   merged_header="Clozapine full blood count ranges")
    else:
        draw_table(page, LITHIUM_XS, table_top, ["Level", "Timing", "Action", "Follow-up"], LITHIUM_ROWS)
    pixels = page.get_pixmap(dpi=300, colorspace=extractor.fitz.csGRAY)
    scan = extractor.fitz.open()
    target = scan.new_page(width=595, height=842)
    target.insert_image(target.rect, stream=pixels.tobytes("png"))
    path = Path(directory) / "scan.pdf"
    scan.save(path)
    scan.close()
    native.close()
    return path


@unittest.skipIf(Image is None, "Pillow is required for raster geometry")
class RasterGridGeometryTests(unittest.TestCase):
    def test_merged_heading_and_empty_cells_use_physical_cell_boundaries(self):
        image = Image.new("L", (600, 400), 255)
        draw = ImageDraw.Draw(image)
        for y in (50, 80, 120, 180, 240):
            draw.line((30, y, 570, y), fill=0, width=2)
        for x in (30, 570):
            draw.line((x, 50, x, 240), fill=0, width=2)
        for x in (180, 330, 450):
            draw.line((x, 80, x, 240), fill=0, width=2)
        rows = extractor.raster_ruled_cells(image)
        self.assertEqual([len(row) for row in rows], [1, 4, 4, 4])
        self.assertLess(rows[1][0][2], rows[1][1][0])
        self.assertLess(rows[1][0][3], rows[2][0][1])

    def test_outside_bounds_exclude_antialiased_ruled_border(self):
        with tempfile.TemporaryDirectory() as directory:
            path = scanned_table(directory, merged=False, outside_columns=True)
            with extractor.fitz.open(path) as document:
                page = document[0]
                scale = extractor.bounded_render_scale(page.rect, 6.25, 4_000_000, max_scale=6.25)
                pixels = page.get_pixmap(matrix=extractor.fitz.Matrix(scale, scale), alpha=False)
                image = Image.frombytes("RGB", (pixels.width, pixels.height), pixels.samples)
        bounds = {}
        rows = extractor.raster_ruled_cells(image, time.monotonic() + 5, grid_bounds=bounds)
        self.assertIsNotNone(rows)
        regions = extractor.raster_prose_regions(image, (0, 0, image.width, bounds["top"]), time.monotonic() + 5)
        # The synthetic source heading fits inside the left physical column.
        self.assertEqual(len(regions), 2)
        self.assertLess(regions[0][2], regions[1][0])
        self.assertLessEqual(max(box[3] for box in regions), bounds["top"])
        ink = image.convert("L").point(lambda value: 255 if value < 255 else 0)
        for box in regions:
            ImageDraw.Draw(ink).rectangle((box[0], box[1], box[2]-1, box[3]-1), fill=0)
        self.assertIsNone(ink.crop((0, 0, image.width, bounds["top"])).getbbox())

    def test_expired_page_deadline_stops_geometry_before_any_ocr(self):
        image = Image.new("L", (8, 4000), 255)
        with self.assertRaises(TimeoutError):
            extractor.raster_ruled_cells(image, deadline=time.monotonic() - 1)

    def test_offset_clip_rounding_retains_actual_pixel_cap(self):
        document = extractor.fitz.open()
        page = document.new_page(width=595, height=842)
        rect = extractor.fitz.Rect(0, 176.37, 595, 842)
        scale = extractor.bounded_clip_render_scale(rect, 6.25, 4_000_000)
        pixels = page.get_pixmap(matrix=extractor.fitz.Matrix(scale, scale), clip=rect, alpha=False)
        self.assertLessEqual(pixels.width * pixels.height, 4_000_000)
        document.close()

    def test_physical_columns_follow_a_separate_spanning_heading(self):
        image = Image.new("L", (600, 280), 255)
        draw = ImageDraw.Draw(image)
        draw.text((40, 20), "Spanning explanatory heading across both independent physical columns", fill=0)
        for y in (80, 100, 120):
            draw.text((40, y), "Left paragraph words", fill=0)
            draw.text((350, y), "Right paragraph words", fill=0)
        regions = extractor.raster_prose_regions(image, (0, 0, 600, 280), time.monotonic() + 1)
        self.assertEqual(len(regions), 3)
        self.assertLess(regions[0][3], regions[1][1])
        self.assertLess(regions[1][2], regions[2][0])

    def test_light_gray_outside_paragraph_is_preserved_for_ocr(self):
        image = Image.new("L", (600, 180), 255)
        draw = ImageDraw.Draw(image)
        draw.text((40, 40), "A light gray source qualification", fill=128)
        regions = extractor.raster_prose_regions(image, (0, 0, 600, 180), time.monotonic() + 1)
        self.assertEqual(len(regions), 1)
        self.assertLessEqual(regions[0][0], 40)
        self.assertGreater(regions[0][2], 100)

    def test_column_context_precedes_large_internal_paragraph_gaps(self):
        image = Image.new("L", (600, 240), 255)
        draw = ImageDraw.Draw(image)
        for y in (40, 60, 150, 170):
            draw.text((40, y), "Left paragraph words", fill=0)
            draw.text((350, y), "Right paragraph words", fill=0)
        regions = extractor.raster_prose_regions(image, (0, 0, 600, 240), time.monotonic() + 1)
        self.assertEqual(len(regions), 2)
        self.assertLess(regions[0][2], regions[1][0])
        self.assertLessEqual(regions[0][1], 40)
        self.assertGreater(regions[0][3], 170)
        self.assertLessEqual(regions[1][1], 40)
        self.assertGreater(regions[1][3], 170)

    def test_one_paragraph_is_not_split_into_word_columns(self):
        image = Image.new("L", (600, 180), 255)
        draw = ImageDraw.Draw(image)
        for y in (40, 60, 80):
            draw.text((40, y), "One ordinary paragraph has several words", fill=0)
        regions = extractor.raster_prose_regions(image, (0, 0, 600, 180), time.monotonic() + 1)
        self.assertEqual(len(regions), 1)

    def test_disconnected_glyph_parts_remain_one_physical_line(self):
        image = Image.new("L", (100, 100), 255)
        draw = ImageDraw.Draw(image)
        draw.rectangle((20, 10, 23, 13), fill=0)
        draw.rectangle((21, 16, 22, 30), fill=0)
        self.assertEqual(extractor.raster_ink_line_count(image, time.monotonic() + 1), 1)
        draw.rectangle((21, 60, 22, 75), fill=0)
        self.assertEqual(extractor.raster_ink_line_count(image, time.monotonic() + 1), 2)

    def test_expired_deadline_stops_outside_layout_scan(self):
        image = Image.new("L", (600, 180), 255)
        with self.assertRaises(TimeoutError):
            extractor.raster_prose_regions(image, (0, 0, 600, 180), time.monotonic() - 1)

    def test_outlined_prose_is_not_a_table(self):
        image = Image.new("L", (600, 400), 255)
        draw = ImageDraw.Draw(image)
        draw.rectangle((30, 50, 570, 250), outline=0, width=2)
        for y in (80, 110, 140, 170):
            draw.text((45, y), "Ordinary explanatory prose inside one outline", fill=0)
        self.assertIsNone(extractor.raster_ruled_cells(image))

    def test_light_gray_side_qualifier_rejects_grid_replacement(self):
        image = Image.new("L", (600, 400), 255)
        draw = ImageDraw.Draw(image)
        for y in (50, 100, 150, 200):
            draw.line((100, y, 550, y), fill=0, width=2)
        for x in (100, 250, 400, 550):
            draw.line((x, 50, x, 200), fill=0, width=2)
        draw.text((5, 110), "NOTE", fill=128)
        self.assertIsNone(extractor.raster_ruled_cells(image))

    def test_side_prose_rejects_ambiguous_grid_replacement(self):
        image = Image.new("L", (600, 400), 255)
        draw = ImageDraw.Draw(image)
        for y in (50, 100, 150, 200):
            draw.line((100, y, 550, y), fill=0, width=2)
        for x in (100, 250, 400, 550):
            draw.line((x, 50, x, 200), fill=0, width=2)
        draw.text((5, 110), "NOTE", fill=0)
        self.assertIsNone(extractor.raster_ruled_cells(image))


class RasterModelContractTests(unittest.TestCase):
    def test_missing_model_is_refused(self):
        with patch.dict(os.environ, {"PDF_RASTER_TABLE_MODEL_PATH": "/nonexistent/Latin.traineddata"}):
            with self.assertRaisesRegex(ValueError, "unavailable"):
                extractor.checked_raster_table_model(time.monotonic() + 1)

    def test_wrong_size_model_is_refused(self):
        with tempfile.TemporaryDirectory() as directory:
            model = Path(directory) / "Latin.traineddata"
            model.write_bytes(b"untrusted model")
            with patch.dict(os.environ, {"PDF_RASTER_TABLE_MODEL_PATH": str(model)}):
                with self.assertRaisesRegex(ValueError, "size"):
                    extractor.checked_raster_table_model(time.monotonic() + 1)

    def test_wrong_hash_model_is_refused(self):
        with tempfile.TemporaryDirectory() as directory:
            model = Path(directory) / "Latin.traineddata"
            model.write_bytes(b"untrusted model")
            with patch.dict(os.environ, {"PDF_RASTER_TABLE_MODEL_PATH": str(model)}), patch.object(extractor, "RASTER_TABLE_MODEL_BYTES", model.stat().st_size):
                with self.assertRaisesRegex(ValueError, "sha256"):
                    extractor.checked_raster_table_model(time.monotonic() + 1)

    def test_missing_cell_model_refuses_instead_of_falling_back_to_english(self):
        from types import SimpleNamespace
        from unittest.mock import Mock
        image = Image.new("L", (600, 400), 255)
        draw = ImageDraw.Draw(image)
        for y in (50, 100, 150, 200):
            draw.line((30, y, 570, y), fill=0, width=2)
        for x in (30, 180, 330, 570):
            draw.line((x, 50, x, 200), fill=0, width=2)
        import io
        stream = io.BytesIO()
        image.save(stream, format="PNG")
        pixels = SimpleNamespace(width=600, height=400, tobytes=lambda _: stream.getvalue())
        page = SimpleNamespace(number=0, rotation=0, rect=extractor.fitz.Rect(0, 0, 600, 400), get_text=lambda _: "", get_pixmap=lambda **_: pixels)
        engine = SimpleNamespace(pytesseract=SimpleNamespace(tesseract_cmd="/usr/bin/tesseract"), image_to_string=Mock(side_effect=AssertionError("no fallback OCR")))
        with patch.dict(os.environ, {"PDF_RASTER_TABLE_OCR": "1", "PDF_RASTER_TABLE_MODEL_PATH": "/nonexistent/Latin.traineddata"}), patch.dict("sys.modules", {"pytesseract": engine}):
            text, warning = extractor.maybe_ocr_page(page, extractor.ExtractionBudget())
        self.assertEqual(text, "")
        self.assertIn("model unavailable", warning)
        engine.image_to_string.assert_not_called()

    def test_expired_deadline_refuses_model_before_open(self):
        with patch("builtins.open", side_effect=AssertionError("no read after page deadline")):
            with self.assertRaises(TimeoutError):
                extractor.checked_raster_table_model(time.monotonic() - 1)


@unittest.skipUnless(shutil.which("tesseract") and importlib.util.find_spec("pytesseract") and Image,
                     "Actual Tesseract and locked parser dependencies are required")
class RasterGridRealOcrTests(unittest.TestCase):
    def test_gated_merged_scan_keeps_exponent_cells_and_owning_rows(self):
        with tempfile.TemporaryDirectory() as directory:
            path = scanned_table(directory)
            with patch.dict(os.environ, {"PDF_RASTER_TABLE_OCR": "1"}):
                result = extractor.extract(str(path), str(Path(directory) / "out"))
        text = re.sub(r"\s+", " ", result["pages"][0]["text"])
        self.assertIn("Count (x 10^9/L)", text)
        self.assertIn("Clozapine full blood count ranges", text)
        wbc, neutrophils = text.index("WBC"), text.index("Neutrophils")
        for cells, row_text in ((MERGED_ROWS[0], text[wbc:neutrophils]), (MERGED_ROWS[1], text[neutrophils:])):
            for lines in cells:
                self.assertIn(" ".join(lines), row_text)
        self.assertEqual(result["extractor"]["version"], "2026-10-19.ruled-edge-raster-table-ocr-v9")
        provenance = result["pages"][0]["metadata"]["source_provenance"]
        self.assertEqual(provenance["ocr"]["status"], "unverified")
        self.assertIsNone(provenance["ocr"]["confidence"])
        self.assertEqual(provenance["ocr"]["comparison"], "not_compared")

    def test_outside_multicolumn_prose_keeps_its_own_qualifiers(self):
        with tempfile.TemporaryDirectory() as directory:
            path = scanned_table(directory, merged=False, outside_columns=True)
            with patch.dict(os.environ, {"PDF_RASTER_TABLE_OCR": "1"}):
                result = extractor.extract(str(path), str(Path(directory) / "out"))
        text = re.sub(r"\s+", " ", result["pages"][0]["text"])
        self.assertIn("LEFT CONTEXT Keep this qualification attached to its own paragraph.", text)
        self.assertIn("RIGHT CONTEXT Keep this independent explanation with its own source.", text)
        self.assertLess(text.index("LEFT CONTEXT"), text.index("Below 0.4 mmol/L"))
        self.assertLess(text.index("RIGHT CONTEXT"), text.index("Below 0.4 mmol/L"))

    def test_gated_wrapped_scan_retains_all_existing_source_cells(self):
        with tempfile.TemporaryDirectory() as directory:
            path = scanned_table(directory, merged=False)
            with patch.dict(os.environ, {"PDF_RASTER_TABLE_OCR": "1"}):
                result = extractor.extract(str(path), str(Path(directory) / "out"))
        text = re.sub(r"\s+", " ", result["pages"][0]["text"])
        for row in LITHIUM_ROWS:
            for lines in row:
                self.assertIn(" ".join(lines), text)
