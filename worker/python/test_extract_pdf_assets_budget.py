import os
import sys
import types
import unittest
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(__file__))
import extract_pdf_assets as extractor


def limits(**overrides):
    return {**extractor.DEFAULT_BUDGET, **overrides}


class Rect:
    def __init__(self, width, height):
        self.width = width
        self.height = height


class PdfExtractionBudgetTests(unittest.TestCase):
    def test_exact_render_boundary_is_allowed(self):
        scale = extractor.bounded_render_scale(Rect(1000, 1000), 2.0, 4_000_000)
        self.assertEqual(scale, 2.0)
        self.assertLessEqual(1000 * scale * 1000 * scale, 4_000_000)

    def test_invalid_and_unhelpfully_large_geometry_is_skipped_before_render(self):
        self.assertIsNone(extractor.bounded_render_scale(Rect(float("nan"), 100), 2.0, 4_000_000))

        class Page:
            number = 0
            rect = Rect(100_000, 100_000)

            def get_pixmap(self, **_kwargs):
                raise AssertionError("unsafe geometry must not render")

        text, warning = extractor.maybe_ocr_page(Page(), extractor.ExtractionBudget())
        self.assertEqual(text, "")
        self.assertIn("render_skipped", warning)

    def test_page_text_artifact_and_result_exact_boundaries_then_reject_overflow(self):
        budget = extractor.ExtractionBudget(
            limits(maxPages=1, maxTextBytes=2, maxArtifacts=1, maxArtifactBytes=2, maxResultBytes=2)
        )
        budget.set_page_count(1)
        budget.add_text("é")
        budget.add_artifact(2)
        budget.ensure_result("é")
        with self.assertRaises(extractor.ExtractionBudgetExceeded):
            budget.add_artifact(1)

        with self.assertRaises(extractor.ExtractionBudgetExceeded):
            extractor.ExtractionBudget(limits(maxPages=1)).set_page_count(2)
        with self.assertRaises(extractor.ExtractionBudgetExceeded):
            extractor.ExtractionBudget(limits(maxTextBytes=1)).add_text("é")
        with self.assertRaises(extractor.ExtractionBudgetExceeded):
            extractor.ExtractionBudget(limits(maxResultBytes=1)).ensure_result("é")

    def test_ocr_receives_the_per_page_timeout(self):
        calls = []
        pytesseract = types.SimpleNamespace(
            pytesseract=types.SimpleNamespace(tesseract_cmd=None),
            image_to_string=lambda _image, **kwargs: calls.append(kwargs) or "text",
        )
        image_module = types.SimpleNamespace(open=lambda _stream: object())
        pil = types.SimpleNamespace(Image=image_module)

        class Pix:
            width = 100
            height = 100

            def tobytes(self, _format):
                return b"png"

        class Page:
            number = 0
            rect = Rect(100, 100)

            def get_pixmap(self, **_kwargs):
                return Pix()

        with patch.dict(sys.modules, {"pytesseract": pytesseract, "PIL": pil}):
            text, warning = extractor.maybe_ocr_page(
                Page(), extractor.ExtractionBudget(limits(ocrPageTimeoutSeconds=60))
            )
        self.assertEqual(text, "text")
        self.assertIsNone(warning)
        self.assertEqual(calls, [{"config": "--dpi 450", "timeout": 60}])

    def test_ocr_detail_is_separate_from_other_renders_and_stays_pixel_bounded(self):
        rect = Rect(452, 317)
        self.assertEqual(extractor.bounded_render_scale(rect, 6.25, 6_000_000), 4.0)
        detail = extractor.bounded_render_scale(
            rect, extractor.MAX_OCR_RENDER_SCALE, 6_000_000,
            max_scale=extractor.MAX_OCR_RENDER_SCALE,
        )
        self.assertEqual(detail, 6.25)
        limited = extractor.bounded_render_scale(
            rect, extractor.MAX_OCR_RENDER_SCALE, 4_000_000,
            max_scale=extractor.MAX_OCR_RENDER_SCALE,
        )
        self.assertLess(limited, detail)
        import math
        self.assertLessEqual(math.ceil(rect.width * limited) * math.ceil(rect.height * limited), 4_000_000)

    def test_ocr_uses_bounded_detail_and_reports_its_actual_dpi_to_engine(self):
        calls = []
        matrices = []
        pytesseract = types.SimpleNamespace(
            pytesseract=types.SimpleNamespace(tesseract_cmd=None),
            image_to_string=lambda _image, **kwargs: calls.append(kwargs) or "observed text",
        )
        pil = types.SimpleNamespace(Image=types.SimpleNamespace(open=lambda _stream: object()))

        class Page:
            number = 0
            rect = Rect(452, 317)

            def get_pixmap(self, **kwargs):
                matrices.append(kwargs["matrix"])
                return types.SimpleNamespace(width=2000, height=1500, tobytes=lambda _format: b"png")

        with patch.dict(sys.modules, {"pytesseract": pytesseract, "PIL": pil}):
            for pixels in (6_000_000, 4_000_000):
                text, warning = extractor.maybe_ocr_page(
                    Page(), extractor.ExtractionBudget(limits(maxRenderPixels=pixels))
                )
                self.assertEqual(text, "observed text")
                self.assertIsNone(warning)
        self.assertEqual(matrices[0].a, 6.25)
        self.assertLess(matrices[1].a, 6.25)
        self.assertEqual(calls[0], {"config": "--dpi 450", "timeout": 60})
        self.assertEqual(calls[1]["config"], f"--dpi {round(matrices[1].a * 72)}")

    def test_ocr_rounded_pixel_overflow_never_reaches_engine(self):
        pytesseract = types.SimpleNamespace(
            pytesseract=types.SimpleNamespace(tesseract_cmd=None),
            image_to_string=lambda *_args, **_kwargs: self.fail("over-budget image reached OCR"),
        )
        pil = types.SimpleNamespace(Image=types.SimpleNamespace(open=lambda _stream: self.fail("over-budget image decoded")))

        class Page:
            number = 0
            rect = Rect(452, 317)

            def get_pixmap(self, **_kwargs):
                return types.SimpleNamespace(width=3000, height=2001)

        with patch.dict(sys.modules, {"pytesseract": pytesseract, "PIL": pil}):
            text, warning = extractor.maybe_ocr_page(
                Page(), extractor.ExtractionBudget(limits(maxRenderPixels=6_000_000))
            )
        self.assertEqual(text, "")
        self.assertIn("rounded pixel limit", warning)

    def test_crop_completeness_penalizes_page_edge_clipping(self):
        page = type("PageRect", (), {"x0": 0, "y0": 0, "x1": 200, "y1": 200, "width": 200, "height": 200})()
        requested = type("Rect", (), {"width": 120, "height": 120})()
        complete = type("Clip", (), {"width": 120, "height": 120, "x0": 20, "y0": 20, "x1": 140, "y1": 140})()
        clipped = type("Clip", (), {"width": 90, "height": 120, "x0": 0, "y0": 20, "x1": 90, "y1": 140})()

        self.assertEqual(extractor.crop_completeness_score(requested, complete, page), 1.0)
        self.assertLess(extractor.crop_completeness_score(requested, clipped, page), 0.82)


if __name__ == "__main__":
    unittest.main()
