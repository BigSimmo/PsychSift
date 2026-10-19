"""Hostile and malformed PDFs fail clearly instead of with a raw traceback (audit F18).

A locked, truncated, empty or mislabelled upload used to surface as whatever
exception PyMuPDF raised mid-extraction. Each must now stop at open with a
PDF_UNREADABLE message the ingestion status can show, while a PDF that only
restricts editing (owner password, empty user password) still extracts.
"""

from __future__ import annotations

import os
import gc
import json
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(__file__))
import extract_pdf_assets as extractor

fitz = extractor.fitz
SCRIPT = os.path.join(os.path.dirname(__file__), "extract_pdf_assets.py")


def write_pdf(path, text="Lithium level 0.6 to 0.8 mmol/L.", **save_options):
    document = fitz.open()
    page = document.new_page(width=400, height=400)
    page.insert_text(fitz.Point(40, 60), text, fontsize=11)
    document.save(path, **save_options)
    document.close()


class HostilePdfTests(unittest.TestCase):
    def setUp(self):
        self._directory = tempfile.TemporaryDirectory()
        self.dir = self._directory.name
        self.out = os.path.join(self.dir, "out")

    def tearDown(self):
        # Failed PyMuPDF constructors can retain file handles in exception cycles.
        # Collect them before Windows removes the fixture; cleanup errors still fail.
        gc.collect()
        self._directory.cleanup()

    def path(self, name):
        return os.path.join(self.dir, name)

    def assert_unreadable(self, path, fragment):
        with self.assertRaises(extractor.PdfUnreadable) as caught:
            extractor.extract(path, self.out)
        self.assertIn(fragment, str(caught.exception))

    def test_user_password_pdf_is_refused_with_a_clear_reason(self):
        path = self.path("locked.pdf")
        write_pdf(path, encryption=fitz.PDF_ENCRYPT_AES_256, user_pw="secret", owner_pw="owner")
        self.assert_unreadable(path, "password-protected")

    def test_owner_restricted_pdf_still_extracts(self):
        path = self.path("restricted.pdf")
        write_pdf(
            path,
            encryption=fitz.PDF_ENCRYPT_AES_256,
            owner_pw="owner",
            user_pw="",
            permissions=fitz.PDF_PERM_PRINT,
        )
        result = extractor.extract(path, self.out)
        self.assertIn("Lithium level 0.6 to 0.8 mmol/L.", result["pages"][0]["text"])

    def test_truncated_pdf_is_refused(self):
        path = self.path("truncated.pdf")
        write_pdf(path)
        with open(path, "rb") as handle:
            data = handle.read()
        with open(path, "wb") as handle:
            handle.write(data[:60])
        self.assert_unreadable(path, "could not be opened")

    def test_empty_file_is_refused(self):
        path = self.path("empty.pdf")
        open(path, "wb").close()
        self.assert_unreadable(path, "could not be opened")

    def test_text_file_named_pdf_is_refused(self):
        path = self.path("not-really.pdf")
        with open(path, "w", encoding="utf-8") as handle:
            handle.write("This is a plain text file, not a PDF.\n")
        self.assert_unreadable(path, "could not be opened")

    def test_real_zero_page_catalog_is_refused_instead_of_treated_as_an_empty_file(self):
        # PyMuPDF refuses to save an empty document, so construct a complete tiny
        # PDF catalog and empty page tree, including a valid xref/trailer.
        parts = [b"%PDF-1.7\n"]
        offsets = [0]
        for number, body in enumerate((
            b"<< /Type /Catalog /Pages 2 0 R >>",
            b"<< /Type /Pages /Kids [] /Count 0 >>",
        ), 1):
            offsets.append(sum(len(part) for part in parts))
            parts.append(str(number).encode("ascii") + b" 0 obj\n" + body + b"\nendobj\n")
        xref_offset = sum(len(part) for part in parts)
        parts.append(b"xref\n0 3\n0000000000 65535 f \n")
        parts.extend(f"{offset:010d} 00000 n \n".encode("ascii") for offset in offsets[1:])
        parts.append(f"trailer\n<< /Size 3 /Root 1 0 R >>\nstartxref\n{xref_offset}\n%%EOF\n".encode("ascii"))
        path = self.path("zero-page.pdf")
        with open(path, "wb") as handle:
            handle.write(b"".join(parts))
        with fitz.open(path) as document:
            self.assertEqual(document.page_count, 0, "fixture must reach the zero-page refusal branch")
        self.assert_unreadable(path, "it has no pages")
        self.assertFalse(os.listdir(self.out), "refusal must not produce extractable artifacts")

    def test_real_multi_page_pdf_hits_the_cli_page_budget_without_emitting_a_result(self):
        path = self.path("page-budget.pdf")
        with fitz.open() as document:
            for _ in range(2):
                document.new_page().insert_text((40, 60), "Synthetic page budget fixture.")
            document.save(path)
        budget_path = self.path("budget.json")
        with open(budget_path, "w", encoding="utf-8") as handle:
            json.dump({"maxPages": 1}, handle)
        result_path = self.path("extracted.json")
        completed = subprocess.run(
            [sys.executable, SCRIPT, path, self.out, result_path, budget_path],
            capture_output=True, text=True, timeout=30,
        )
        self.assertEqual(completed.returncode, 3, completed.stderr)
        self.assertIn("PDF_EXTRACTION_BUDGET_EXCEEDED: page count 2 exceeds 1", completed.stderr)
        self.assertNotIn("Traceback", completed.stderr)
        self.assertEqual(completed.stdout, "")
        self.assertFalse(os.path.exists(result_path))
        self.assertFalse(os.listdir(self.out), "budget refusal must happen before rendering or emitting artifacts")

    def test_command_line_exits_4_with_a_readable_message(self):
        path = self.path("locked.pdf")
        write_pdf(path, encryption=fitz.PDF_ENCRYPT_AES_256, user_pw="secret", owner_pw="owner")
        completed = subprocess.run(
            [sys.executable, SCRIPT, path, self.out], capture_output=True, text=True, timeout=120
        )
        self.assertEqual(completed.returncode, 4, completed.stderr)
        self.assertIn("PDF_UNREADABLE: PDF is password-protected", completed.stderr)
        self.assertNotIn("Traceback", completed.stderr)


if __name__ == "__main__":
    unittest.main()
