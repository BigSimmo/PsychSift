"""Synthetic structural inspection tests; no clinical or legal clearance."""
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import pymupdf as fitz
import inspect_native_pdf_source as inspector


class NativePdfInspectionTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.path = Path(self.temporary.name) / "synthetic.pdf"

    def tearDown(self):
        self.temporary.cleanup()

    def fixture(self, change=None, encrypted=False):
        with fitz.open() as document:
            page = document.new_page()
            page.insert_text((72, 72), "Synthetic native source. Threshold < 3.5.")
            if change:
                change(document, page)
            if encrypted:
                document.save(self.path, encryption=fitz.PDF_ENCRYPT_AES_256, owner_pw="owner", user_pw="secret")
            else:
                document.save(self.path)

    def test_native_pdf_has_exact_complete_inventory(self):
        self.fixture(lambda document, _page: document.new_page().insert_text((72, 72), "Second page source."))
        result = inspector.inspect_source(self.path)
        self.assertEqual(result["status"], "inspected")
        self.assertEqual(result["pageCount"], 2)
        self.assertEqual([page["pageNumber"] for page in result["pages"]], [1, 2])
        self.assertEqual(result["sourceSha256"], inspector.digest(self.path.read_bytes()))
        for page in result["pages"]:
            self.assertEqual(page["textSha256"], inspector.digest(page["text"].encode("utf-8")))
        self.assertIn("not_clinical_or_semantic_completeness", result["limitations"])

    def test_active_action_refused(self):
        self.fixture(lambda document, _page: document.xref_set_key(document.pdf_catalog(), "OpenAction", "<</S/JavaScript/JS(synthetic)>>"))
        with self.assertRaisesRegex(inspector.InspectionRefusal, "active_content"):
            inspector.inspect_source(self.path)

    def test_simple_native_inventory_matches_the_actual_extractor(self):
        import extract_pdf_assets
        self.fixture()
        actual = extract_pdf_assets.extract(str(self.path), str(Path(self.temporary.name) / "extracted"))
        observed = inspector.inspect_source(self.path)
        self.assertEqual([page["text"] for page in actual["pages"]], [page["text"] for page in observed["pages"]])

    def rich_visual_fixture(self, page_count=1):
        with fitz.open() as document:
            for _ in range(page_count):
                page = document.new_page()
                page.insert_text((72, 72), "Synthetic visible source with a retained original image.")
                pixels = fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, 100, 100), False)
                pixels.clear_with(100)
                page.insert_image(fitz.Rect(72, 200, 200, 328), pixmap=pixels)
            document.save(self.path)

    def assert_actual_extraction_covers_inventory(self, inventory):
        import extract_pdf_assets
        actual = extract_pdf_assets.extract(str(self.path), str(Path(self.temporary.name) / "extracted"))
        for page in inventory["pages"]:
            boxes = page["rasterBboxes"] + page["vectorBboxes"] + page["tableBboxes"]
            self.assertTrue(boxes)
            images = [image for image in actual["images"]
                      if image["pageNumber"] == page["pageNumber"] and image["sourceKind"] != "cover_page"]
            for box in boxes:
                self.assertTrue(any(fitz.Rect(image["bbox"]).contains(fitz.Rect(box)) for image in images))

    def test_missing_optional_render_preserves_inventory_already_covered_by_actual_extraction(self):
        import extract_pdf_assets
        self.rich_visual_fixture()
        with patch.object(extract_pdf_assets, "save_page_crop", return_value=None):
            inventory = inspector.inspect_source(self.path, profile="rich", render_dir=Path(self.temporary.name) / "coverage")
        self.assertEqual(inventory["status"], "inspected")
        self.assertIsNone(inventory["pages"][0].get("coverageImage"))
        self.assert_actual_extraction_covers_inventory(inventory)

    def test_exhausted_optional_render_slots_preserve_complete_inventory(self):
        import extract_pdf_assets
        self.rich_visual_fixture(page_count=2)
        budget = extract_pdf_assets.ExtractionBudget({"maxArtifacts": 1})
        with patch.object(extract_pdf_assets, "ExtractionBudget", return_value=budget):
            inventory = inspector.inspect_source(self.path, profile="rich", render_dir=Path(self.temporary.name) / "coverage")
        self.assertEqual(inventory["pageCount"], 2)
        self.assertIsNotNone(inventory["pages"][0].get("coverageImage"))
        self.assertIsNone(inventory["pages"][1].get("coverageImage"))
        self.assertEqual(budget.artifact_count, 1)
        self.assert_actual_extraction_covers_inventory(inventory)

    def test_attempted_render_over_byte_budget_is_not_suppressed(self):
        import extract_pdf_assets
        self.rich_visual_fixture()
        budget = extract_pdf_assets.ExtractionBudget({"maxArtifactBytes": 1})
        with patch.object(extract_pdf_assets, "ExtractionBudget", return_value=budget):
            with self.assertRaisesRegex(extract_pdf_assets.ExtractionBudgetExceeded, "artifact bytes"):
                inspector.inspect_source(self.path, profile="rich", render_dir=Path(self.temporary.name) / "coverage")

    def test_already_exceeded_render_count_is_not_suppressed(self):
        import extract_pdf_assets
        self.rich_visual_fixture()
        budget = extract_pdf_assets.ExtractionBudget({"maxArtifacts": 1})
        budget.artifact_count = 2
        with patch.object(extract_pdf_assets, "ExtractionBudget", return_value=budget):
            with self.assertRaisesRegex(extract_pdf_assets.ExtractionBudgetExceeded, "artifact count"):
                inspector.inspect_source(self.path, profile="rich", render_dir=Path(self.temporary.name) / "coverage")

    def test_encryption_refused(self):
        self.fixture(encrypted=True)
        with self.assertRaisesRegex(inspector.InspectionRefusal, "encrypted"):
            inspector.inspect_source(self.path)

    def test_invisible_or_white_or_occluded_text_refused(self):
        changes = [
            lambda _document, page: page.insert_text((72, 120), "Invisible synthetic", render_mode=3),
            lambda _document, page: page.insert_text((72, 120), "White synthetic", color=(1, 1, 1)),
            lambda _document, page: page.draw_rect(fitz.Rect(60, 50, 400, 85), color=None, fill=(1, 1, 1), overlay=True),
        ]
        for change in changes:
            with self.subTest(change=change):
                self.fixture(change)
                with self.assertRaisesRegex(inspector.InspectionRefusal, "hidden_text"):
                    inspector.inspect_source(self.path)
                self.path.unlink()

    def test_unknown_clipping_fidelity_refuses_instead_of_certifying_hidden_text(self):
        def clip(document, page):
            content = page.get_contents()[0]
            document.update_stream(content, b"q 0 0 1 1 re W n\n" + document.xref_stream(content) + b"\nQ")
        self.fixture(clip)
        with self.assertRaisesRegex(inspector.InspectionRefusal, "unsupported_display"):
            inspector.inspect_source(self.path)

    def test_scan_only_page_refused(self):
        with fitz.open() as document:
            page = document.new_page()
            pixels = fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, 10, 10), False)
            pixels.clear_with(255)
            page.insert_image(page.rect, pixmap=pixels)
            document.save(self.path)
        with self.assertRaisesRegex(inspector.InspectionRefusal, "ocr_required"):
            inspector.inspect_source(self.path)

    def test_mixed_native_text_and_original_visuals_refused(self):
        def raster(_document, page):
            pixels = fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, 10, 10), False)
            pixels.clear_with(100)
            page.insert_image(fitz.Rect(72, 200, 150, 280), pixmap=pixels)
        changes = [raster, lambda _document, page: page.draw_rect(fitz.Rect(72, 200, 150, 280))]
        for change in changes:
            with self.subTest(change=change):
                self.fixture(change)
                with self.assertRaisesRegex(inspector.InspectionRefusal, "visual_content"):
                    inspector.inspect_source(self.path)
                self.path.unlink()

    def test_embedded_attachment_refused(self):
        self.fixture(lambda document, _page: document.embfile_add("synthetic.txt", b"Synthetic attachment"))
        with self.assertRaisesRegex(inspector.InspectionRefusal, "active_content"):
            inspector.inspect_source(self.path)

    def test_size_and_page_and_text_limits_refused(self):
        self.fixture()
        for limits in [{"max_source_bytes": 8}, {"max_page_text_bytes": 2}, {"max_total_text_bytes": 2}]:
            with self.subTest(limits=limits), self.assertRaisesRegex(inspector.InspectionRefusal, "budget"):
                inspector.inspect_source(self.path, limits)
        self.path.unlink()
        self.fixture(lambda document, _page: document.new_page())
        with self.assertRaisesRegex(inspector.InspectionRefusal, "budget"):
            inspector.inspect_source(self.path, {"max_pages": 1})

    def test_deadline_is_checked_before_parsing(self):
        self.fixture()
        with patch.object(inspector.time, "monotonic", side_effect=[0, 5]):
            with self.assertRaisesRegex(inspector.InspectionRefusal, "timeout"):
                inspector.inspect_source(self.path, {"max_seconds": 1})


if __name__ == "__main__":
    unittest.main()
