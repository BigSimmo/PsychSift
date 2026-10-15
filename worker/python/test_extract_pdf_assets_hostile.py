"""Hostile and malformed PDFs fail clearly instead of with a raw traceback (audit F18).

A locked, truncated, empty or mislabelled upload used to surface as whatever
exception PyMuPDF raised mid-extraction. Each must now stop at open with a
PDF_UNREADABLE message the ingestion status can show, while a PDF that only
restricts editing (owner password, empty user password) still extracts.
"""

from __future__ import annotations

import os
import gc
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
