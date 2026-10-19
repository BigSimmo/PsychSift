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
    def assert_unverified_fallback(self, image, text):
        """Retain legacy OCR bytes when optional column interpretation is refused."""
        from types import SimpleNamespace
        from unittest.mock import Mock
        import io
        source = Image.new("L", (image.width, image.height + 220), 255)
        source.paste(image, (0, 0))
        draw = ImageDraw.Draw(source)
        for y in (image.height + 20, image.height + 70, image.height + 120, image.height + 170):
            draw.line((30, y, image.width - 30, y), fill=0, width=2)
        for x in (30, 180, 330, image.width - 30):
            draw.line((x, image.height + 20, x, image.height + 170), fill=0, width=2)
        stream = io.BytesIO()
        source.save(stream, format="PNG")
        pixels = SimpleNamespace(width=source.width, height=source.height, tobytes=lambda _: stream.getvalue())
        # Fixed mock pixels must match the requested render scale, rather than
        # posing as a much larger point-sized page at the render-pixel ceiling.
        scale = extractor.MAX_OCR_RENDER_SCALE
        page = SimpleNamespace(number=0, rotation=0,
                               rect=extractor.fitz.Rect(0, 0, source.width / scale, source.height / scale),
                               get_text=lambda _: "", get_pixmap=lambda **_: pixels)
        engine = SimpleNamespace(pytesseract=SimpleNamespace(tesseract_cmd="fixture-tesseract"),
                                 image_to_string=Mock(return_value=text))
        observations = {}
        with patch.dict(os.environ, {"PDF_RASTER_TABLE_OCR": "1", "TESSERACT_CMD": "fixture-tesseract"}), patch.dict(
            "sys.modules", {"pytesseract": engine},
        ), patch.object(extractor, "checked_raster_table_model", side_effect=AssertionError("no cell model")):
            actual, warning = extractor.maybe_ocr_page(page, extractor.ExtractionBudget(), observations)
        self.assertIsNone(warning)
        self.assertEqual(actual, text)
        self.assertEqual(observations, {})
        engine.image_to_string.assert_called_once()
        self.assertNotIn("--psm", engine.image_to_string.call_args.kwargs["config"])
        geometry = {"rotation": 0, "cropBox": list(page.rect), "mediaBox": list(page.rect)}
        provenance = extractor.page_source_provenance(geometry, 1, "", actual, True, False, {
            "producer": {"pythonVersion": "fixture", "pymupdfVersion": "fixture", "mupdfVersion": "fixture"},
        })
        self.assertEqual(provenance["ocr"]["status"], "unverified")
        self.assertEqual(provenance["ocr"]["comparison"], "not_compared")

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
        with self.assertRaises(extractor.RasterLayoutAmbiguous):
            extractor.raster_prose_regions(image, (0, 0, image.width, bounds["top"]), time.monotonic() + 5)
        # Check fringe preservation within each known fixture column separately;
        # their ambiguous combined alignment now retains full-page fallback.
        middle = image.width // 2
        regions = []
        for left, right in ((0, middle), (middle, image.width)):
            regions.extend(extractor.raster_prose_regions(image, (left, 0, right, bounds["top"]), time.monotonic() + 5))
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

    def test_aligned_columns_after_a_spanning_heading_retain_unverified_fallback(self):
        image = Image.new("L", (600, 280), 255)
        draw = ImageDraw.Draw(image)
        draw.text((40, 20), "Spanning explanatory heading across both independent physical columns", fill=0)
        for y in (80, 100, 120):
            draw.text((40, y), "Left paragraph words", fill=0)
            draw.text((350, y), "Right paragraph words", fill=0)
        with self.assertRaises(extractor.RasterLayoutAmbiguous):
            extractor.raster_prose_regions(image, (0, 0, 600, 280), time.monotonic() + 1)
        self.assert_unverified_fallback(image, "Spanning heading\nLeft paragraph words\nRight paragraph words")

    def test_light_gray_outside_paragraph_is_preserved_for_ocr(self):
        image = Image.new("L", (600, 180), 255)
        draw = ImageDraw.Draw(image)
        draw.text((40, 40), "A light gray source qualification", fill=128)
        regions = extractor.raster_prose_regions(image, (0, 0, 600, 180), time.monotonic() + 1)
        self.assertEqual(len(regions), 1)
        self.assertLessEqual(regions[0][0], 40)
        self.assertGreater(regions[0][2], 100)

    def test_aligned_paragraphs_with_large_internal_gaps_retain_unverified_fallback(self):
        image = Image.new("L", (600, 240), 255)
        draw = ImageDraw.Draw(image)
        for y in (40, 60, 150, 170):
            draw.text((40, y), "Left paragraph words", fill=0)
            draw.text((350, y), "Right paragraph words", fill=0)
        with self.assertRaises(extractor.RasterLayoutAmbiguous):
            extractor.raster_prose_regions(image, (0, 0, 600, 240), time.monotonic() + 1)
        self.assert_unverified_fallback(image, "Left paragraph words\nRight paragraph words")

    def test_paired_notes_at_ordinary_and_wide_spacing_refuse_column_major_reordering(self):
        # Same source geometry as the independently reproduced condition/action
        # defect. Three rows must be refused too, without a two-row count rule.
        for ys in ((60, 76), (60, 76, 92), (60, 220), (40, 130, 220)):
            with self.subTest(rows=len(ys)):
                image = Image.new("L", (600, 300), 255)
                draw = ImageDraw.Draw(image)
                for y, condition, action in zip(ys, ("If pregnant", "If breastfeeding", "If unwell"),
                                                ("avoid X", "consult Y", "review Z")):
                    draw.text((40, y), condition, fill=0)
                    draw.text((330, y), action, fill=0)
                with self.assertRaises(extractor.RasterLayoutAmbiguous):
                    extractor.raster_prose_regions(image, (0, 0, 600, 300), time.monotonic() + 1)

    def test_aligned_continuous_paragraphs_retain_unverified_fallback_content(self):
        image = Image.new("L", (600, 300), 255)
        draw = ImageDraw.Draw(image)
        for x, lines in ((40, ("LEFT CONTEXT", "Keep this qualification", "attached to its own", "paragraph.")),
                         (330, ("RIGHT CONTEXT", "Keep this independent", "explanation with its", "own source."))):
            for y, line in zip((60, 76, 92, 108), lines):
                draw.text((x, y), line, fill=0)
        with self.assertRaises(extractor.RasterLayoutAmbiguous):
            extractor.raster_prose_regions(image, (0, 0, 600, 300), time.monotonic() + 1)
        self.assert_unverified_fallback(image, "LEFT CONTEXT Keep this qualification attached to its own paragraph.\n"
                                      "RIGHT CONTEXT Keep this independent explanation with its own source.")

    def test_clearly_non_row_aligned_columns_can_still_be_partitioned(self):
        image = Image.new("L", (600, 240), 255)
        draw = ImageDraw.Draw(image)
        for y in (40, 60, 80):
            draw.text((40, y), "Left paragraph words", fill=0)
        for y in (130, 150, 170):
            draw.text((330, y), "Right paragraph words", fill=0)
        regions = extractor.raster_prose_regions(image, (0, 0, 600, 240), time.monotonic() + 1)
        self.assertEqual(len(regions), 2)
        self.assertLess(regions[0][2], regions[1][0])

    def test_outside_line_gap_analysis_merges_disconnected_dots_before_classifying_rows(self):
        image = Image.new("L", (600, 200), 255)
        draw = ImageDraw.Draw(image)
        for x in (40, 330):
            for y in (40, 70, 100):
                draw.rectangle((x, y, x + 60, y + 3), fill=0)
                draw.rectangle((x, y + 6, x + 60, y + 20), fill=0)
        with self.assertRaises(extractor.RasterLayoutAmbiguous):
            extractor.raster_prose_regions(image, (0, 0, 600, 200), time.monotonic() + 1)
        self.assert_unverified_fallback(image, "Dotted left paragraph.\nDotted right paragraph.")
        for ys in ((20, 180), (20, 130, 240)):
            with self.subTest(separated_rows=len(ys)):
                image = Image.new("L", (600, 300), 255)
                draw = ImageDraw.Draw(image)
                for x in (40, 330):
                    for y in ys:
                        draw.rectangle((x, y, x + 60, y + 3), fill=0)
                        draw.rectangle((x, y + 6, x + 60, y + 20), fill=0)
                with self.assertRaises(extractor.RasterLayoutAmbiguous):
                    extractor.raster_prose_regions(image, (0, 0, 600, 300), time.monotonic() + 1)

    def test_ambiguous_outside_notes_refuse_replacement_before_model_or_cell_ocr(self):
        from types import SimpleNamespace
        from unittest.mock import Mock
        image = Image.new("L", (600, 600), 255)
        draw = ImageDraw.Draw(image)
        for y in (40, 180):
            draw.text((40, y), "If qualified", fill=0)
            draw.text((330, y), "retain instruction", fill=0)
        for y in (350, 400, 450, 500):
            draw.line((30, y, 570, y), fill=0, width=2)
        for x in (30, 180, 330, 570):
            draw.line((x, 350, x, 500), fill=0, width=2)
        page = SimpleNamespace(rotation=0, rect=extractor.fitz.Rect(0, 0, 600, 600), get_text=lambda _: "")
        engine = SimpleNamespace(image_to_string=Mock(side_effect=AssertionError("no candidate OCR")))
        observations = {}
        with patch.dict(os.environ, {"PDF_RASTER_TABLE_OCR": "1"}), patch.object(
            extractor, "checked_raster_table_model", side_effect=AssertionError("no candidate model load"),
        ):
            candidate = extractor.maybe_raster_table_ocr(
                page, image, 1, extractor.ExtractionBudget(), engine, time.monotonic() + 1, observations,
            )
        self.assertIsNone(candidate)
        self.assertEqual(observations, {})
        engine.image_to_string.assert_not_called()

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

    def test_deadline_during_model_hash_is_a_timeout_not_a_model_identity_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            model = Path(directory) / "Latin.traineddata"
            model.write_bytes(b"synthetic model bytes")
            with patch.dict(os.environ, {"PDF_RASTER_TABLE_MODEL_PATH": str(model)}), patch.object(
                extractor, "RASTER_TABLE_MODEL_BYTES", model.stat().st_size,
            ), patch.object(extractor.time, "monotonic", side_effect=[0, 0, 1]):
                with self.assertRaises(TimeoutError):
                    extractor.checked_raster_table_model(1)


class RasterCandidateFallbackTests(unittest.TestCase):
    """Real PDF/render geometry; deterministic OCR failures and a shared clock."""

    def setUp(self):
        import pytesseract
        self.engine = pytesseract
        self.document = extractor.fitz.open()
        self.page = self.document.new_page(width=96, height=64)
        for y in (8, 16, 24, 32):
            self.page.draw_line((5, y), (90, y), width=0.5)
        for x in (5, 30, 55, 90):
            self.page.draw_line((x, 8), (x, 32), width=0.5)
        self.now = 0.0
        self.budget = extractor.ExtractionBudget()
        self.observations = {}

    def tearDown(self):
        self.document.close()

    def extract(self, **kwargs):
        with patch.dict(os.environ, {"PDF_RASTER_TABLE_OCR": "1"}), patch.object(
            extractor.time, "monotonic", side_effect=lambda: self.now,
        ):
            return extractor.maybe_ocr_page(self.page, self.budget, self.observations, **kwargs)

    def test_transient_candidate_failures_preserve_full_page_ocr_without_partial_observations(self):
        for failure in (TimeoutError("geometry timeout"), ValueError("unsafe raster cell geometry"),
                        RuntimeError("Tesseract process timeout")):
            with self.subTest(failure=type(failure).__name__):
                def candidate(_page, _image, _scale, budget, _engine, deadline, observations):
                    self.assertIs(budget, self.budget)
                    self.assertLessEqual(deadline, 50)
                    observations["partial"] = "discard"
                    self.now = deadline
                    raise failure
                self.now = 0
                self.observations = {"stale": "discard"}
                with patch.object(extractor, "maybe_raster_table_ocr", side_effect=candidate), patch.object(
                    self.engine, "image_to_string", return_value="Full page source retained.",
                ) as full_page:
                    text, _warning = self.extract()
                self.assertEqual(text, "Full page source retained.")
                self.assertEqual(self.observations, {})
                full_page.assert_called_once()
                self.assertEqual(full_page.call_args.kwargs["timeout"], 10)
                self.assertNotIn("lang", full_page.call_args.kwargs)
                self.assertNotIn("--psm", full_page.call_args.kwargs["config"])

    def test_real_candidate_crop_failure_uses_original_full_page_render(self):
        calls = []
        def ocr(image, **kwargs):
            calls.append((image.size, kwargs))
            if "lang" in kwargs:
                raise RuntimeError("Tesseract process timeout")
            return "Original full page source."
        with patch.object(extractor, "checked_raster_table_model", return_value="/unused"), patch.object(
            extractor, "observed_raster_runtime", return_value={},
        ), patch.object(self.engine, "image_to_string", side_effect=ocr):
            text, _warning = self.extract()
        self.assertEqual(text, "Original full page source.")
        self.assertEqual(len(calls), 2)
        self.assertEqual(calls[0][1]["lang"], "Latin")
        self.assertEqual(calls[1][0], (600, 400))
        self.assertNotIn("lang", calls[1][1])
        self.assertEqual(self.observations, {})

    def test_model_provision_failures_remain_terminal_even_with_fallback_time(self):
        with tempfile.TemporaryDirectory() as directory:
            model = Path(directory) / "Latin.traineddata"
            model.write_bytes(b"untrusted model")
            for failure in ("missing", "size", "hash"):
                with self.subTest(failure=failure), patch.dict(os.environ, {
                    "PDF_RASTER_TABLE_MODEL_PATH": str(model) if failure != "missing" else str(model.parent / "missing" / model.name),
                }), patch.object(extractor, "RASTER_TABLE_MODEL_BYTES", model.stat().st_size if failure == "hash" else 89_384_811), patch.object(
                    self.engine, "image_to_string",
                ) as full_page:
                    text, warning = self.extract()
                self.assertEqual(text, "")
                self.assertIn("RasterTableModelError", warning)
                full_page.assert_not_called()
                self.assertEqual(self.observations, {})

    def test_candidate_window_reserves_time_after_initial_render_cost(self):
        original_render = self.page.get_pixmap
        def render(**kwargs):
            pixels = original_render(**kwargs)
            self.now = 42
            return pixels
        def candidate(*args):
            self.assertEqual(args[5], 50)
            self.now = args[5]
            raise TimeoutError("optional time consumed")
        with patch.object(self.page, "get_pixmap", side_effect=render), patch.object(
            extractor, "maybe_raster_table_ocr", side_effect=candidate,
        ), patch.object(self.engine, "image_to_string", return_value="Reserved fallback.") as full_page:
            text, _warning = self.extract()
        self.assertEqual(text, "Reserved fallback.")
        self.assertEqual(full_page.call_args.kwargs["timeout"], 10)

    def test_refused_candidate_cannot_publish_partial_observations(self):
        def candidate(*args):
            args[6]["partial"] = "discard"
            return None
        self.observations = {"stale": "discard"}
        with patch.object(extractor, "maybe_raster_table_ocr", side_effect=candidate), patch.object(
            self.engine, "image_to_string", return_value="Unmodified fallback.",
        ):
            text, _warning = self.extract()
        self.assertEqual(text, "Unmodified fallback.")
        self.assertEqual(self.observations, {})

    def test_late_candidate_success_is_discarded_and_fallback_keeps_reserved_time(self):
        def candidate(*args):
            self.now = args[5] + 1
            args[6]["late"] = "discard"
            return "Late candidate text."
        with patch.object(extractor, "maybe_raster_table_ocr", side_effect=candidate), patch.object(
            self.engine, "image_to_string", return_value="On-time fallback.",
        ) as full_page:
            text, _warning = self.extract()
        self.assertEqual(text, "On-time fallback.")
        self.assertEqual(full_page.call_args.kwargs["timeout"], 9)
        self.assertEqual(self.observations, {})

    def test_candidate_can_finish_within_page_budget_without_an_arbitrary_short_cap(self):
        def candidate(*args):
            self.now = 34
            args[6]["complete"] = "observed"
            return "Complete candidate source."
        with patch.object(extractor, "maybe_raster_table_ocr", side_effect=candidate), patch.object(
            self.engine, "image_to_string",
        ) as full_page:
            text, warning = self.extract()
        self.assertEqual(text, "Complete candidate source.")
        self.assertIsNone(warning)
        self.assertEqual(self.observations, {"complete": "observed"})
        full_page.assert_not_called()

    def test_short_custom_page_budget_skips_optional_candidate(self):
        self.budget = extractor.ExtractionBudget({"ocrPageTimeoutSeconds": 2})
        with patch.object(extractor, "maybe_raster_table_ocr") as candidate, patch.object(
            self.engine, "image_to_string", return_value="Short-budget fallback.",
        ) as full_page:
            text, _warning = self.extract()
        self.assertEqual(text, "Short-budget fallback.")
        candidate.assert_not_called()
        self.assertEqual(full_page.call_args.kwargs["timeout"], 2)

    def test_late_full_page_result_does_not_escape_original_page_deadline(self):
        def ocr(*_args, **_kwargs):
            self.now = 61
            return "Late full page text."
        with patch.object(extractor, "maybe_raster_table_ocr", return_value=None), patch.object(
            self.engine, "image_to_string", side_effect=ocr,
        ):
            text, warning = self.extract()
        self.assertEqual(text, "")
        self.assertIn("deadline", warning)

    def test_global_budget_failure_is_terminal_without_resetting_shared_usage(self):
        self.budget.add_artifact(25)
        with patch.object(extractor, "maybe_raster_table_ocr", side_effect=extractor.ExtractionBudgetExceeded("artifact cap")), patch.object(
            self.engine, "image_to_string",
        ) as full_page:
            with self.assertRaises(extractor.ExtractionBudgetExceeded):
                self.extract()
        full_page.assert_not_called()
        self.assertEqual(self.budget.artifact_count, 1)
        self.assertEqual(self.budget.artifact_bytes, 25)


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
