"""Synthetic PDF grid: wrapped actions, a merged group and distinct row relationships.

The numbers and instructions are test markers, not clinical guidance. Exercise the real
PDF reader so a correct table-facts fixture alone cannot hide column interleaving.
"""
import os
import re
import sys
import unittest

sys.path.insert(0, os.path.dirname(__file__))
import extract_pdf_assets as extractor


class RelationalAdversarialTests(unittest.TestCase):
    def test_wrapped_actions_and_merged_group_keep_each_threshold_rate_pair(self):
        fitz = extractor.fitz
        with fitz.open() as document:
            page = document.new_page(width=720, height=460)
            page.insert_text((50, 40), "Synthetic monitoring table: no clinical meaning", fontsize=10)
            xs = [50, 180, 300, 420, 690]
            ys = [60, 90, 160, 230, 300]
            for x in xs:
                page.draw_line((x, ys[0]), (x, ys[-1]), width=0.7)
            for index, y in enumerate(ys):
                # The group label spans the first two data rows, not the third.
                page.draw_line((xs[1] if index == 2 else xs[0], y), (xs[-1], y), width=0.7)
            rows = [
                ["Parameter", "Threshold", "Rate", "Recommended action"],
                ["Marker Alpha", "4 units", "11%", "Synthetic action one\nretain the alpha pair"],
                ["", "8 units", "22%", "Synthetic action two\nretain the second pair"],
                ["Marker Beta", "12 units", "33%", "Synthetic action three\nretain the beta pair"],
            ]
            for row_index, row in enumerate(rows):
                for column_index, cell in enumerate(row):
                    for line_index, line in enumerate(cell.split("\n")):
                        page.insert_text(
                            (xs[column_index] + 4, ys[row_index] + 15 + line_index * 12),
                            line,
                            fontsize=9,
                        )

            # Reopen a real PDF representation, rather than a mocked table object.
            with fitz.open(stream=document.tobytes(), filetype="pdf") as saved:
                page = saved[0]
                candidates = extractor.likely_table_candidates(page)
                grids = [item for item in candidates if item.get("extraction_method") == "pymupdf_find_tables"]
                self.assertEqual(len(grids), 1)
                grid = grids[0]
                normalise = lambda value: re.sub(r"\s+", " ", value or "").strip()
                expected = [[normalise(cell) for cell in row] for row in rows]
                actual = [[normalise(cell) for cell in row] for row in grid["table_rows"]]
                self.assertEqual(actual, expected)
                self.assertIn([2, 0], grid["table_merged_cells"])
                self.assertNotIn([3, 0], grid["table_merged_cells"])
                rebuilt = normalise(extractor.table_aware_page_text(page, candidates))
                for row in expected[1:]:
                    relation = normalise("| " + " | ".join(row) + " |")
                    self.assertIn(relation, rebuilt)
                    self.assertEqual(rebuilt.count(row[-1]), 1)


if __name__ == "__main__":
    unittest.main()
