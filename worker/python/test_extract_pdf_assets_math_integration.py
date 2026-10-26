"""Mocked producer wiring: one OCR call, exact crop identities and fail-closed restoration."""
import hashlib
import os
import time
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch
from PIL import Image
import extract_pdf_assets as extractor
import raster_math_ocr


class MathProducerIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.document = extractor.fitz.open()
        self.native_page = self.document.new_page(width=100, height=100)
        self.native_page.insert_text((12, 40), "SYNTHETIC")
        self.page = SimpleNamespace(rect=self.native_page.rect, rotation=0,
            get_text=lambda *_: "", get_pixmap=self.native_page.get_pixmap, number=0)
        self.input_bitmap = Image.new("RGB", (30, 20), "white")
        self.input_bitmap.putpixel((10, 10), (0, 0, 0))
        self.plan = SimpleNamespace(bitmap=self.input_bitmap, kind="comparison", restore=Mock(return_value="≤ 1.5"))
        self.engine = SimpleNamespace(image_to_string=Mock(return_value="1.5"))

    def tearDown(self):
        self.document.close()

    def patches(self):
        from contextlib import ExitStack
        stack = ExitStack()
        stack.enter_context(patch.dict(os.environ, {"PDF_RASTER_TABLE_OCR": "1"}))
        stack.enter_context(patch.object(extractor, "checked_raster_table_model", return_value="/unused"))
        stack.enter_context(patch.object(extractor, "observed_raster_runtime", return_value={}))
        def grid(image, deadline=None, grid_bounds=None):
            if grid_bounds is not None:
                grid_bounds.update(top=0, bottom=image.height)
            scale = image.width / 100
            return [[(scale, scale, 99 * scale, 99 * scale)]]
        stack.enter_context(patch.object(extractor, "raster_ruled_cells", side_effect=grid))
        stack.enter_context(patch.object(extractor, "raster_ink_line_count", return_value=1))
        self.planner = stack.enter_context(patch.object(raster_math_ocr, "plan_raster_math_ocr", return_value=self.plan))
        return stack

    def test_one_ocr_call_keeps_source_crop_and_transformed_input_identities(self):
        observations = {}
        budget = extractor.ExtractionBudget()
        with self.patches():
            text = extractor.maybe_raster_table_ocr(self.page, Image.new("RGB", (100, 100)), 1,
                budget, self.engine, time.monotonic() + 30, observations)
        self.assertEqual(text, "≤ 1.5")
        self.engine.image_to_string.assert_called_once()
        self.assertIs(self.engine.image_to_string.call_args.args[0], self.input_bitmap)
        self.assertIn("--psm 7", self.engine.image_to_string.call_args.kwargs["config"])
        self.assertNotIn("whitelist", self.engine.image_to_string.call_args.kwargs["config"])
        rect = extractor.fitz.Rect(1, 1, 99, 99)
        scale = extractor.bounded_clip_render_scale(rect, extractor.MAX_OCR_RENDER_SCALE, budget.limits["maxRenderPixels"])
        source = self.native_page.get_pixmap(matrix=extractor.fitz.Matrix(scale, scale), clip=rect, alpha=False)
        crop = observations["crops"][0]
        self.assertEqual(crop["pngSha256"], "sha256:" + hashlib.sha256(source.tobytes("png")).hexdigest())
        self.assertEqual(crop["pixelsSha256"], "sha256:" + hashlib.sha256(source.samples).hexdigest())
        transform = crop["ocrInputTransform"]
        self.assertEqual(transform["pixelsSha256"], "sha256:" + hashlib.sha256(self.input_bitmap.tobytes()).hexdigest())
        self.assertEqual(transform["codeSha256"], extractor.file_sha256(raster_math_ocr.__file__))
        self.assertNotEqual(transform["pixelsSha256"], crop["pixelsSha256"])
        self.assertEqual((transform["width"], transform["height"], transform["mode"]), (30, 20, "RGB"))
        self.assertEqual(observations["status"], "unverified")
        # Outward-rounded pixels are excluded geometrically, without noise deletion.
        analyzed = self.planner.call_args.args[0]
        self.assertEqual(analyzed.size, (611, 611))

    def test_comparison_with_unit_suffix_rereads_unchanged_source_without_transform(self):
        self.plan.restore.side_effect = raster_math_ocr.ComparisonSuffixUnsupported("unit suffix")
        self.engine.image_to_string.side_effect = ["0.5mmol/L", "< 0.5 mmol/L"]
        observations = {}
        with self.patches():
            text = extractor.maybe_raster_table_ocr(self.page, Image.new("RGB", (100, 100)), 1,
                extractor.ExtractionBudget(), self.engine, time.monotonic() + 30, observations)
        self.assertEqual(text, "< 0.5 mmol/L")
        calls = self.engine.image_to_string.call_args_list
        self.assertEqual(len(calls), 2)
        self.assertIs(calls[0].args[0], self.input_bitmap)
        self.assertIsNot(calls[1].args[0], self.input_bitmap)
        self.assertEqual(calls[1].kwargs["lang"], "Latin")
        self.assertNotIn("ocrInputTransform", observations["crops"][0])

    def test_failed_restoration_discards_candidate_and_keeps_original_page_fallback(self):
        self.plan.restore.side_effect = ValueError("raster math source alignment is ambiguous")
        self.engine.image_to_string.side_effect = ["1.5", "Original full-page source."]
        observations = {"stale": "must be removed"}
        with self.patches(), patch.dict("sys.modules", {"pytesseract": self.engine}):
            text, warning = extractor.maybe_ocr_page(self.page, extractor.ExtractionBudget(), observations)
        self.assertEqual(text, "Original full-page source.")
        self.assertIn("raster_table_ocr_refused", warning)
        self.assertEqual(observations, {})
        self.assertEqual(self.engine.image_to_string.call_count, 2)
        calls = self.engine.image_to_string.call_args_list
        self.assertIs(calls[0].args[0], self.input_bitmap)
        self.assertNotIn("lang", calls[1].kwargs)
        self.assertNotIn("--psm", calls[1].kwargs["config"])


    def test_decimal_free_comparison_that_the_unchanged_cell_reads_with_a_decimal_is_refused(self):
        # Audit EXT-03: an italic decimal point can share the digit's x-interval, so "15" aligned.
        self.plan.restore.return_value = "< 15"
        self.engine.image_to_string.side_effect = ["15", "< 1.5", "Original full-page source."]
        observations = {}
        with self.patches(), patch.dict("sys.modules", {"pytesseract": self.engine}):
            text, warning = extractor.maybe_ocr_page(self.page, extractor.ExtractionBudget(), observations)
        self.assertEqual(text, "Original full-page source.")
        self.assertIn("raster_table_ocr_refused", warning)
        calls = self.engine.image_to_string.call_args_list
        self.assertIs(calls[0].args[0], self.input_bitmap)
        self.assertIsNot(calls[1].args[0], self.input_bitmap)

    def test_decimal_free_comparison_confirmed_by_the_unchanged_cell_is_kept(self):
        self.plan.restore.return_value = "< 15"
        self.engine.image_to_string.side_effect = ["15", "< 15"]
        observations = {}
        with self.patches():
            text = extractor.maybe_raster_table_ocr(self.page, Image.new("RGB", (100, 100)), 1,
                extractor.ExtractionBudget(), self.engine, time.monotonic() + 30, observations)
        self.assertEqual(text, "< 15")
        self.assertEqual(self.engine.image_to_string.call_count, 2)

if __name__ == "__main__":
    unittest.main()
