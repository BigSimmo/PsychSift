"""Regression for #076: page-edge table crops keep on-page remnant geometry.

Failing stage (pre-fix): pymupdf_find_tables candidate detection stopped at the last
fully detected row. Fix stage: extend_table_rect_for_edge_content + save_page_crop.
Expected geometry: table_crop clip bottom reaches the page bottom and the straddling
score-5 remnant is retained (structured row and/or incompleteness signal).
"""

from __future__ import annotations

import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(__file__))
import extract_pdf_assets as extractor

FIXTURE_DIR = os.path.join(os.path.dirname(__file__), "fixtures")
FIXTURE_PDF = os.path.join(FIXTURE_DIR, "malformed-table-crop-page-edge.pdf")

# Geometry pinned by the checked-in synthetic fixture (A4).
PAGE_WIDTH = 595.28
PAGE_HEIGHT = 841.89
STRADDLING_ROW_Y0 = 824.0
EXPECTED_SCORE_ROW = "5"


@unittest.skipUnless(os.path.isfile(FIXTURE_PDF), "page-edge crop fixture missing")
class PageEdgeTableCropGeometryTests(unittest.TestCase):
    def test_fixture_find_tables_stage_still_drops_straddling_row_bbox(self):
        """Upstream diagnosis: find_tables alone still truncates; the fix extends afterward."""
        document = extractor.fitz.open(FIXTURE_PDF)
        try:
            page = document[0]
            self.assertAlmostEqual(float(page.rect.width), PAGE_WIDTH, places=2)
            self.assertAlmostEqual(float(page.rect.height), PAGE_HEIGHT, places=2)

            tables = page.find_tables()
            self.assertGreaterEqual(len(tables.tables), 1, "fixture must expose a find_tables candidate")
            candidate = extractor.fitz.Rect(tables.tables[0].bbox)
            self.assertLess(
                candidate.y1,
                PAGE_HEIGHT - 1,
                "fixture no longer stresses find_tables truncation at the page edge",
            )
            self.assertAlmostEqual(candidate.y1, STRADDLING_ROW_Y0, places=1)

            extended, info = extractor.extend_table_rect_for_edge_content(page, candidate)
            self.assertTrue(info["extended"])
            self.assertIn("bottom", info["edges"])
            self.assertTrue(info["clipped_by_page"])
            self.assertGreaterEqual(float(extended.y1), PAGE_HEIGHT - 1)
        finally:
            document.close()

    def test_table_crop_includes_on_page_remnant_of_straddling_row(self):
        """
        Stage: pymupdf_find_tables → extend_table_rect_for_edge_content → save_page_crop
        Expected geometry: clip_bbox[3] >= page_height - 1 (on-page remnant retained)
        Expected structure: table_rows includes the score-5 clinical row (or incompleteness is marked)
        """
        with tempfile.TemporaryDirectory(prefix="page-edge-crop-") as output_dir:
            result = extractor.extract(FIXTURE_PDF, output_dir)
            crops = [image for image in result["images"] if image.get("sourceKind") == "table_crop"]
            self.assertEqual(len(crops), 1, result)
            crop = crops[0]
            metadata = crop.get("metadata") or {}
            clip = crop.get("bbox") or metadata.get("clip_bbox")
            self.assertIsInstance(clip, list)
            self.assertGreaterEqual(len(clip), 4)

            clip_bottom = float(clip[3])
            page_height = float(metadata.get("page_height") or PAGE_HEIGHT)
            self.assertGreaterEqual(
                clip_bottom,
                page_height - 1.0,
                (
                    "stage=pymupdf_find_tables→extend_table_rect_for_edge_content→save_page_crop; "
                    f"expected clip bottom ≥ {page_height - 1.0}, got {clip_bottom}; "
                    f"candidate method={metadata.get('extraction_method')}"
                ),
            )

            rows = metadata.get("table_rows") or []
            has_score_row = any(str(row[0]).strip() == EXPECTED_SCORE_ROW for row in rows if row)
            crop_completeness = metadata.get("crop_completeness")
            incomplete = (
                isinstance(crop_completeness, (int, float)) and float(crop_completeness) < 0.99
            ) or any(
                "table_crop_edge_incomplete" in str(warning) for warning in result.get("warnings") or []
            )
            self.assertTrue(
                has_score_row or incomplete,
                (
                    "expected score-5 row in table_rows or an explicit incompleteness signal; "
                    f"rows={rows!r} crop_completeness={crop_completeness!r} warnings={result.get('warnings')!r}"
                ),
            )
            self.assertTrue(metadata.get("edge_content_extended"))
            self.assertIn("bottom", metadata.get("edge_content_edges") or [])


class UnassignedEdgeTextTests(unittest.TestCase):
    def test_column_aligned_key_in_an_outline_is_retained_without_table_cell_assignment(self):
        """Real PDF -> detection -> expanded crop, using current ruled-cell semantics."""
        rows = [["Score", "State", "Action"], ["0", "Asleep", "Observe"], ["5", "Aroused", "Call registrar"]]
        with tempfile.TemporaryDirectory(prefix="table-edge-key-") as directory:
            path = os.path.join(directory, "column-aligned-key.pdf")
            with extractor.fitz.open() as document:
                page = document.new_page(width=595, height=842)
                xs = [50, 120, 310, 560]
                ys = [100, 130, 160, 190]
                for row_index, row in enumerate(rows):
                    for column_index, text in enumerate(row):
                        page.draw_rect(extractor.fitz.Rect(
                            xs[column_index], ys[row_index], xs[column_index + 1], ys[row_index + 1],
                        ), width=0.5)
                        page.insert_text((xs[column_index] + 4, ys[row_index] + 18), text, fontsize=9)
                # The outline can extend the source crop, but supplies no
                # individual ruled cells for this aligned explanatory key.
                page.draw_rect(extractor.fitz.Rect(50, 195, 560, 250), width=0.5)
                page.insert_text((54, 212), "BELOW", fontsize=9)
                page.insert_text((124, 212), "Explanatory key", fontsize=9)
                document.save(path)
            result = extractor.extract(path, os.path.join(directory, "out"))

        crops = [image for image in result["images"] if image.get("sourceKind") == "table_crop"]
        self.assertEqual(len(crops), 1)
        crop = crops[0]
        metadata = crop["metadata"]
        self.assertEqual(metadata["table_rows"], rows)
        self.assertNotIn("BELOW", metadata["accessible_table_markdown"])
        self.assertNotIn("Explanatory key", metadata["table_text"])
        self.assertIn("BELOW", result["pages"][0]["text"])
        self.assertIn("Explanatory key", result["pages"][0]["text"])
        self.assertGreaterEqual(crop["bbox"][3], 250, "expanded crop must retain the source artwork")
        self.assertTrue(metadata["edge_recovery_needs_review"])
        unassigned = metadata["unassigned_edge_text"]
        self.assertEqual([segment["text"] for segment in unassigned], ["BELOW", "Explanatory key"])
        self.assertTrue(all(segment["edge"] == "bottom" and len(segment["bbox"]) == 4 for segment in unassigned))
        self.assertTrue(any("table_edge_association_unverified" in warning for warning in result["warnings"]))


if __name__ == "__main__":
    unittest.main()
