"""Independent original-feature inventory on synthetic PDF bytes."""
from pathlib import Path
import tempfile
import unittest
import pymupdf as fitz
import inspect_native_pdf_source as inspector


class RichPdfInspectionTests(unittest.TestCase):
    def test_unrelated_gap_paint_cannot_prove_white_glyph_visibility(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / "synthetic.pdf"
            with fitz.open() as document:
                page = document.new_page()
                page.insert_text((72, 72), "A                         Z", fontsize=12, color=(1, 1, 1))
                page.draw_rect(fitz.Rect(100, 60, 130, 75), color=None, fill=(0, 0, 0))
                document.save(source)
            with self.assertRaisesRegex(inspector.InspectionRefusal, "hidden_text"):
                inspector.inspect_source(source, profile="rich")

    def test_only_bound_zero_width_ligature_continuations_are_accepted(self):
        first = (ord("f"), 42, (72, 72), (72, 60, 80, 72))
        continuation = (ord("i"), -1, (72, 72), (72, 60, 72, 72))
        self.assertEqual(len(inspector.meaningful_glyph_boxes({"chars": (first, continuation)})), 1)
        for malformed in (
            (ord("i"), -1, (72, 72), (72, 60, 80, 60)),
            (ord("i"), -1, (120, 72), (120, 60, 120, 72)),
            (ord("i"), -1, (72, 72), (72, 72, 72, 60)),
            (ord("z"), -1, (72, 72), (72, 60, 72, 72)),
        ):
            with self.subTest(malformed=malformed), self.assertRaisesRegex(inspector.InspectionRefusal, "hidden_text"):
                inspector.meaningful_glyph_boxes({"chars": (first, malformed)})

    def test_paint_between_distant_glyphs_does_not_hide_source_text(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / "synthetic.pdf"
            with fitz.open() as document:
                page = document.new_page()
                page.insert_text((72, 72), "A                         Z", fontsize=12)
                page.draw_rect(fitz.Rect(100, 60, 130, 75), color=None, fill=(0, 0, 0))
                page.insert_text((150, 72), "B", fontsize=12)
                document.save(source)
            self.assertEqual(inspector.inspect_source(source, profile="rich")["status"], "inspected")

    def test_blank_spans_in_complex_display_are_not_hidden_words(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / "synthetic.pdf"
            with fitz.open() as document:
                page = document.new_page()
                page.insert_text((72, 72), "SYNTHETIC VISIBLE SOURCE")
                page.insert_text((72, 100), "     ", color=(1, 1, 1))
                document.save(source)
            self.assertEqual(inspector.inspect_source(source, profile="rich")["status"], "inspected")

    def test_actual_meaningful_glyph_occlusion_and_hidden_text_still_refuse(self):
        for change in (
            lambda page: page.draw_rect(fitz.Rect(70, 55, 210, 77), color=None, fill=(1, 1, 1)),
            lambda page: page.insert_text((72, 100), "HIDDEN SYNTHETIC WORDS", render_mode=3),
            lambda page: page.insert_text((72, 100), "WHITE SYNTHETIC WORDS", color=(1, 1, 1)),
        ):
            with self.subTest(change=change), tempfile.TemporaryDirectory() as folder:
                source = Path(folder) / "synthetic.pdf"
                with fitz.open() as document:
                    page = document.new_page()
                    page.insert_text((72, 72), "SYNTHETIC VISIBLE SOURCE")
                    change(page)
                    document.save(source)
                with self.assertRaisesRegex(inspector.InspectionRefusal, "hidden_text"):
                    inspector.inspect_source(source, profile="rich")

    def test_native_table_and_figure_inventory_is_not_declared_empty(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / "synthetic.pdf"
            with fitz.open() as document:
                page = document.new_page()
                for x in (40, 220, 400):
                    page.draw_line((x, 100), (x, 220))
                for y in (100, 140, 180, 220):
                    page.draw_line((40, y), (400, y))
                for y, cells in ((125, ("Threshold", "Action")), (165, ("< 3.5", "Synthetic hold")), (205, ("> 3.5", "Synthetic review"))):
                    for x, text in zip((50, 230), cells):
                        page.insert_text((x, y), text)
                document.save(source)
            result = inspector.inspect_source(source, profile="rich")
            self.assertEqual(result["version"], "rich-pdf-structural-inspection-v2")
            self.assertGreater(result["pages"][0]["sourceFeatures"]["nativeTables"], 0)
            self.assertGreater(result["pages"][0]["sourceFeatures"]["vectorDrawings"], 0)
            self.assertEqual(result["pages"][0]["nativeTextSha256"], inspector.digest(result["pages"][0]["nativeText"].encode("utf-8")))

    def test_raster_original_is_inventoried_for_real_ocr_instead_of_refused_as_text_only(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / "scan.pdf"
            with fitz.open() as original:
                page = original.new_page()
                page.insert_text((72, 72), "SYNTHETIC SCANNED SOURCE", fontsize=16)
                pixels = page.get_pixmap(dpi=160)
                with fitz.open() as scanned:
                    scanned.new_page().insert_image(page.rect, pixmap=pixels)
                    scanned.save(source)
            result = inspector.inspect_source(source, profile="rich")
            self.assertEqual(result["pages"][0]["sourceFeatures"]["rasterImages"], 1)
            self.assertFalse(result["pages"][0]["nativeText"].strip())

    def test_ordinary_link_is_inert_but_javascript_still_refuses(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / "link.pdf"
            with fitz.open() as document:
                page = document.new_page()
                page.insert_text((72, 72), "Synthetic source link.")
                page.insert_link({"kind": fitz.LINK_URI, "from": fitz.Rect(72, 50, 250, 80), "uri": "https://example.invalid/reference"})
                document.save(source)
            self.assertEqual(inspector.inspect_source(source, profile="rich")["status"], "inspected")
            with fitz.open(source) as document:
                document.xref_set_key(document.pdf_catalog(), "OpenAction", "<</S/JavaScript/JS(synthetic)>>")
                changed = Path(folder) / "active.pdf"
                document.save(changed)
            with self.assertRaisesRegex(inspector.InspectionRefusal, "active_content"):
                inspector.inspect_source(changed, profile="rich")


if __name__ == "__main__":
    unittest.main()
