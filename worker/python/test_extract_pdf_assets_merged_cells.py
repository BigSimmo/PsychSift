import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(__file__))

from extract_pdf_assets import extract_table_payload  # noqa: E402


class FakeTable:
    def __init__(self, rows):
        self._rows = rows
        self.rows = []

    def extract(self):
        return self._rows


class MergedCellProvenanceTests(unittest.TestCase):
    """Only cells PyMuPDF reports as span-covered (None) are recorded as merged."""

    def test_none_cells_are_merged_and_blank_strings_are_not(self):
        payload = extract_table_payload(
            FakeTable(
                [
                    ["Parameter", "Threshold", "Action"],
                    ["Group A", "Level 1", "First"],
                    [None, "Level 2", "Second"],
                    [None, None, None],
                    ["", "Level 3", "Third"],
                ]
            )
        )
        self.assertEqual(len(payload["rows"]), 4)
        # Row indices are in cleaned-row coordinates (the all-empty row is dropped).
        self.assertEqual(payload["merged_cells"], [[2, 0]])


if __name__ == "__main__":
    unittest.main()
