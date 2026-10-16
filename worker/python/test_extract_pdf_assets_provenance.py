"""Every extraction records which reader produced it (audit F04).

When a parser defect is found (the clozapine column interleaving, #GJHKYC), the
documents it affected must be listable. Each result carries the extractor name,
its behaviour version, the PyMuPDF build and the table strategy; the worker
stores that on documents.metadata.extraction_provenance.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(__file__))
import extract_pdf_assets as extractor

fitz = extractor.fitz


class ProvenanceTests(unittest.TestCase):
    def test_result_names_the_extractor_version_and_table_strategy(self):
        with tempfile.TemporaryDirectory() as directory:
            path = os.path.join(directory, "plain.pdf")
            document = fitz.open()
            document.new_page(width=300, height=300).insert_text(fitz.Point(30, 40), "Plain text.", fontsize=11)
            document.save(path)
            document.close()
            result = extractor.extract(path, os.path.join(directory, "out"))
        provenance = result["extractor"]
        self.assertEqual(provenance["name"], "extract_pdf_assets")
        self.assertEqual(provenance["version"], extractor.EXTRACTOR_VERSION)
        self.assertRegex(provenance["version"], r"^\d{4}-\d{2}-\d{2}\.[a-z0-9-]+$")
        self.assertEqual(provenance["tableStrategy"], "table_aware_page_text")
        self.assertTrue(provenance["pymupdf"])


def _sha(data):
    return "sha256:" + hashlib.sha256(data).hexdigest()


def _build_mixed_pdf(path):
    """Plain, rotated, cropped and image-only pages: every provenance branch except runtime-unknown."""
    document = fitz.open()
    document.new_page(width=300, height=300).insert_text(fitz.Point(30, 40), "Plain lithium page with enough native text to skip OCR.", fontsize=9)
    rotated = document.new_page(width=300, height=400)
    rotated.insert_text(fitz.Point(30, 40), "Rotated clozapine page with enough native text to skip OCR.", fontsize=9)
    rotated.set_rotation(90)
    cropped = document.new_page(width=300, height=400)
    cropped.insert_text(fitz.Point(30, 40), "Cropped sertraline page with enough native text to skip OCR.", fontsize=9)
    cropped.set_cropbox(fitz.Rect(5, 5, 295, 390))
    blank = fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, 300, 300), False)
    blank.clear_with(255)
    scanned = document.new_page(width=300, height=300)
    scanned.insert_image(scanned.rect, pixmap=blank)
    document.save(path)
    document.close()


class PageSourceProvenanceTests(unittest.TestCase):
    """Mirror of pdfPageSourceProvenanceSchema in src/lib/extractors/pdf-source-provenance.ts."""

    def test_every_page_carries_source_provenance_matching_its_final_text(self):
        with tempfile.TemporaryDirectory() as directory:
            path = os.path.join(directory, "mixed.pdf")
            _build_mixed_pdf(path)
            with open(path, "rb") as handle:
                source_hash = _sha(handle.read())
            with open(extractor.__file__, "rb") as handle:
                script_hash = _sha(handle.read())
            # Serialize and decode as the TypeScript side receives it.
            result = json.loads(json.dumps(extractor.extract(path, os.path.join(directory, "out"))))

        pages = result["pages"]
        self.assertEqual(len(pages), 4)
        for page in pages:
            provenance = page["metadata"]["source_provenance"]
            self.assertEqual(
                set(provenance),
                {
                    "version", "format", "coordinateSpace", "physicalPageNumber", "sourceContentSha256",
                    "producer", "pageGeometry", "nativeTextSha256", "structuralDisposition", "reasonCodes",
                    "ocr", "textMapping", "textIdentity",
                },
            )
            self.assertEqual(provenance["version"], "extracted-page-source-v1")
            self.assertEqual(provenance["format"], "pdf")
            self.assertEqual(provenance["coordinateSpace"], "pymupdf_observed_page_points")
            self.assertEqual(provenance["physicalPageNumber"], page["pageNumber"])
            self.assertEqual(provenance["sourceContentSha256"], source_hash)
            producer = provenance["producer"]
            self.assertEqual(producer["contractVersion"], "pdf-native-page-source-v1")
            self.assertEqual(producer["route"], "python_pdf")
            self.assertEqual(producer["scriptSha256"], script_hash)
            self.assertTrue(producer["pythonVersion"])
            self.assertTrue(producer["pymupdfVersion"])
            geometry = provenance["pageGeometry"]
            for key in ("pageRect", "cropBox", "mediaBox"):
                x0, y0, x1, y1 = geometry[key]
                self.assertLess(x0, x1)
                self.assertLess(y0, y1)
            self.assertIn(geometry["rotation"], (0, 90, 180, 270))
            self.assertRegex(provenance["nativeTextSha256"], r"^sha256:[a-f0-9]{64}$")
            text_hash = _sha(page["text"].encode("utf-8"))
            self.assertEqual(
                provenance["textIdentity"],
                {
                    "originalExtractedTextSha256": text_hash,
                    "persistedTextSha256": text_hash,
                    "normalizationApplied": False,
                    "metadataNormalizationApplied": False,
                    "qualification": "UTF-8 extracted/persisted text bytes; not original PDF spans",
                },
            )
            self.assertEqual(provenance["textMapping"], {"status": "not_established", "offsets": None})
            ocr_unverified = page["ocrUsed"] or page["needsOcr"]
            self.assertEqual(
                provenance["ocr"],
                {
                    "status": "unverified" if ocr_unverified else "not_requested",
                    "confidence": None,
                    "confidenceStatus": "unavailable",
                    "textToPageMapping": "not_established",
                    "comparison": "not_compared" if ocr_unverified else "not_applicable",
                },
            )
            expected_reasons = []
            if geometry["rotation"] != 0 or geometry["cropBox"] != geometry["mediaBox"]:
                expected_reasons.append("pdf_geometry_transform_unverified")
            if ocr_unverified:
                expected_reasons.append("pdf_ocr_unverified")
            self.assertEqual(provenance["reasonCodes"], expected_reasons)
            self.assertEqual(provenance["structuralDisposition"], "unverified" if expected_reasons else "retained")

        reasons = [page["metadata"]["source_provenance"]["reasonCodes"] for page in pages]
        self.assertEqual(reasons[0], [])
        self.assertEqual(reasons[1], ["pdf_geometry_transform_unverified"])
        self.assertEqual(reasons[2], ["pdf_geometry_transform_unverified"])
        self.assertIn("pdf_ocr_unverified", reasons[3])
        self.assertTrue(pages[3]["ocrUsed"] or pages[3]["needsOcr"])

    def test_text_hash_matches_node_for_surrogates(self):
        # Node hashes a JSON-decoded string as UTF-8 with lone surrogates replaced by U+FFFD,
        # and joins an escaped surrogate pair into one character.
        self.assertEqual(extractor.text_sha256("caf\u00e9"), _sha("caf\u00e9".encode("utf-8")))
        self.assertEqual(extractor.text_sha256("a\ud800b"), _sha("a\ufffdb".encode("utf-8")))
        self.assertEqual(extractor.text_sha256("\ud83d\ude00"), _sha("\U0001F600".encode("utf-8")))


if __name__ == "__main__":
    unittest.main()
