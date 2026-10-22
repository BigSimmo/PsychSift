"""Resource limits for hostile or oversized PDFs (audit ING-B-04, ING-B-05, ING-B-06).

ING-B-04: an embedded image is decoded by PyMuPDF inside ``extract_image`` and
``get_image_rects``. A 389 KB PDF declaring a 400-megapixel image used 842 MB,
and an image MuPDF refuses ("Overly large image") used to abort the whole
document. The declared size from the page's image table is now checked first,
so an oversized image is skipped and recorded and the rest of the page extracts.

ING-B-05: the command-line extractor caps its own address space, and running out
of memory is reported as a resource refusal (exit 3), which the worker never
hands to the in-process JavaScript fallback.

ING-B-06: Tesseract runs single-threaded, so OpenMP busy-waiting on a shared CPU
cannot time out every OCR page.
"""

from __future__ import annotations

import gc
import importlib.util
import io
import os
import shutil
import subprocess
import sys
import tempfile
import types
import unittest
import zlib
from contextlib import redirect_stderr
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(__file__))
import extract_pdf_assets as extractor

fitz = extractor.fitz
SCRIPT = os.path.join(os.path.dirname(__file__), "extract_pdf_assets.py")
PAGE_TEXT = "Synthetic page: lithium level 0.6 to 0.8 mmol/L, repeat in 3 days."


def write_declared_image_pdf(path, side, text=PAGE_TEXT):
    """A tiny PDF whose one grey image DECLARES side x side pixels (all zero bytes).

    The image stream compresses to almost nothing, so the file stays small while
    any full decode would allocate side * side bytes.
    """
    compressor = zlib.compressobj(9)
    zero_block = b"\x00" * (1 << 20)
    remaining = side * side
    parts = []
    while remaining > 0:
        size = min(remaining, len(zero_block))
        parts.append(compressor.compress(zero_block[:size]))
        remaining -= size
    parts.append(compressor.flush())
    data = b"".join(parts)
    content = b"q 100 0 0 100 10 10 cm /Im0 Do Q"
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 400] /Contents 4 0 R "
        b"/Resources << /XObject << /Im0 5 0 R >> >> >>",
        b"<< /Length %d >>\nstream\n" % len(content) + content + b"\nendstream",
        b"<< /Type /XObject /Subtype /Image /Width %d /Height %d /ColorSpace /DeviceGray "
        b"/BitsPerComponent 8 /Filter /FlateDecode /Length %d >>\nstream\n" % (side, side, len(data))
        + data
        + b"\nendstream",
    ]
    output = bytearray(b"%PDF-1.4\n")
    offsets = []
    for number, body in enumerate(objects, 1):
        offsets.append(len(output))
        output += b"%d 0 obj\n" % number + body + b"\nendobj\n"
    xref = len(output)
    output += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objects) + 1)
    for offset in offsets:
        output += b"%010d 00000 n \n" % offset
    output += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objects) + 1, xref)
    raw_path = path + ".raw.pdf"
    with open(raw_path, "wb") as handle:
        handle.write(bytes(output))
    # Add a real text layer with PyMuPDF; saving copies the compressed image
    # stream without decoding it.
    with fitz.open(raw_path) as document:
        document[0].insert_text(fitz.Point(40, 300), text, fontsize=9)
        document.save(path)
    os.remove(raw_path)


def write_small_image_pdf(path, text=PAGE_TEXT):
    pixmap = fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, 120, 90), False)
    pixmap.clear_with(200)
    with fitz.open() as document:
        page = document.new_page(width=400, height=400)
        page.insert_text(fitz.Point(40, 300), text, fontsize=9)
        page.insert_image(fitz.Rect(40, 40, 160, 130), pixmap=pixmap)
        document.save(path)


def write_indirect_decode_pdf(path, kind, side=9_000, text=PAGE_TEXT):
    """Tiny synthetic streams declaring unsafe inline or soft-mask dimensions."""
    with fitz.open() as document:
        page = document.new_page(width=400, height=400)
        if text:
            page.insert_text((40, 300), text, fontsize=9)
        if kind == "inline":
            compressed = zlib.compress(b"\x00" * (120 * 90 if side == 120 else 1))
            inline = (b"q 100 0 0 100 10 10 cm BI /W %d /H %d /CS /G /BPC 8 /F /Fl ID "
                      % (side, 90 if side == 120 else side)) + compressed + b" EI Q"
            contents = b"\n".join(document.xref_stream(xref) for xref in page.get_contents())
            xref = document.get_new_xref()
            document.update_object(xref, "<<>>")
            document.update_stream(xref, contents + b"\n" + inline)
            page.set_contents(xref)
        elif kind == "soft_mask":
            pixmap = fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, 120, 90), True)
            pixmap.clear_with(200)
            xref = page.insert_image(fitz.Rect(40, 40, 160, 130), pixmap=pixmap)
            mask = int(document.xref_get_key(xref, "SMask")[1].split()[0])
            document.xref_set_key(mask, "Width", str(side))
            document.xref_set_key(mask, "Height", str(side))
        else:
            raise ValueError(kind)
        document.save(path)


def write_form_mask_pdf(path, unused=False, visible_masked_sibling=False):
    source = path + ".source.pdf"
    write_indirect_decode_pdf(source, "soft_mask")
    with fitz.open(source) as original, fitz.open() as document:
        if unused:
            # This synthetic fixture's final stream paints the oversized mask.
            original.update_stream(original[0].get_contents()[-1], b"")
        if visible_masked_sibling:
            # Same base dimensions as the unsafe resource, different safe mask.
            pixels = fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, 120, 90), True)
            pixels.clear_with(100)
            original[0].insert_image(fitz.Rect(200, 40, 320, 130), pixmap=pixels)
        page = document.new_page(width=400, height=400)
        page.show_pdf_page(page.rect, original, 0)
        document.save(path)


class TemporaryDirectoryTestCase(unittest.TestCase):
    def setUp(self):
        self._directory = tempfile.TemporaryDirectory()
        self.dir = self._directory.name
        self.out = os.path.join(self.dir, "out")

    def tearDown(self):
        gc.collect()
        self._directory.cleanup()

    def path(self, name):
        return os.path.join(self.dir, name)


class OversizedEmbeddedImageTests(TemporaryDirectoryTestCase):
    def test_declared_oversized_flate_image_is_skipped_before_any_decode(self):
        side = 9_000  # 81 megapixels declared, above the embedded-image ceiling
        self.assertGreater(side * side, extractor.MAX_EMBEDDED_IMAGE_PIXELS)
        path = self.path("oversized.pdf")
        write_declared_image_pdf(path, side)

        def refuse_decode(*_args, **_kwargs):
            raise AssertionError("an image above the declared-pixel ceiling must not be decoded")

        with patch.object(fitz.Document, "extract_image", side_effect=refuse_decode), patch.object(
            fitz.Page, "get_image_rects", side_effect=refuse_decode
        ), patch.object(
            fitz.Page, "get_pixmap", side_effect=refuse_decode
        ):
            result = extractor.extract(path, self.out)

        self.assertIn("lithium level 0.6 to 0.8 mmol/L", result["pages"][0]["text"])
        self.assertEqual([image for image in result["images"] if image["sourceKind"] == "embedded"], [])
        skipped = [warning for warning in result["warnings"] if warning.startswith("embedded_image_skipped")]
        self.assertEqual(len(skipped), 1, result["warnings"])
        self.assertIn(f"{side}x{side}", skipped[0])
        self.assertIn(str(extractor.MAX_EMBEDDED_IMAGE_PIXELS), skipped[0])
        # Coverage still counts the oversized image from its declared placement.
        self.assertGreater(result["pages"][0]["metadata"]["image_coverage_ratio"], 0)

    def test_oversized_inline_image_is_refused_before_hashing_or_rendering(self):
        path = self.path("inline.pdf")
        write_indirect_decode_pdf(path, "inline", text="")
        original = fitz.Page.get_image_info

        def headers_only(page, hashes=False, xrefs=False):
            self.assertFalse(hashes)
            self.assertFalse(xrefs)
            return original(page, hashes=hashes, xrefs=xrefs)

        with patch.object(fitz.Page, "get_image_info", headers_only), patch.object(
            fitz.Page, "get_image_rects", side_effect=AssertionError("must not hash images")
        ), patch.object(fitz.Page, "get_pixmap", side_effect=AssertionError("must not render images")):
            result = extractor.extract(path, self.out)
        self.assertEqual(result["images"], [])
        self.assertTrue(result["pages"][0]["needsOcr"])
        self.assertFalse(result["pages"][0]["ocrUsed"])
        self.assertGreater(result["pages"][0]["metadata"]["image_coverage_ratio"], 0)
        self.assertTrue(any(warning.startswith("page_render_skipped") for warning in result["warnings"]))

    def test_small_image_with_oversized_soft_mask_is_skipped_before_any_decode(self):
        path = self.path("soft-mask.pdf")
        write_indirect_decode_pdf(path, "soft_mask")
        with patch.object(fitz.Document, "extract_image", side_effect=AssertionError("must not extract image")), patch.object(
            fitz.Page, "get_image_rects", side_effect=AssertionError("must not hash images")
        ), patch.object(fitz.Page, "get_pixmap", side_effect=AssertionError("must not render images")):
            result = extractor.extract(path, self.out)
        self.assertIn("lithium level 0.6 to 0.8 mmol/L", result["pages"][0]["text"])
        self.assertEqual(result["images"], [])
        self.assertTrue(any("soft mask" in warning and "9000x9000" in warning for warning in result["warnings"]))

    def test_form_soft_mask_is_refused_without_hash_based_placement(self):
        path = self.path("form-mask.pdf")
        write_form_mask_pdf(path)
        with patch.object(fitz.Page, "get_image_bbox") as bbox, patch.object(
            fitz.Page, "get_image_rects"
        ) as rects, patch.object(fitz.Page, "get_pixmap") as render:
            result = extractor.extract(path, self.out)
        bbox.assert_not_called()
        rects.assert_not_called()
        render.assert_not_called()
        self.assertEqual(result["images"], [])
        self.assertIn("lithium level 0.6 to 0.8 mmol/L", result["pages"][0]["text"])
        self.assertTrue(any("soft mask" in warning and "9000x9000" in warning for warning in result["warnings"]))

    def test_unused_form_mask_does_not_block_same_size_visible_masked_sibling(self):
        path = self.path("unused-form-mask.pdf")
        write_form_mask_pdf(path, unused=True, visible_masked_sibling=True)
        with fitz.open(path) as document:
            page = document[0]
            self.assertTrue(all(info[-1] != 0 for info in page.get_images(full=True)))
            displayed = page.get_image_info(hashes=False, xrefs=False)
            self.assertEqual([(info["width"], info["height"], info["has-mask"]) for info in displayed],
                             [(120, 90, True)])
            with patch.object(fitz.Page, "get_image_bbox") as bbox, patch.object(
                fitz.Page, "get_image_rects"
            ) as rects, patch.object(fitz.Page, "get_pixmap") as render:
                skipped, unsafe = extractor.page_image_decode_preflight(page, page.get_images(full=True))
            bbox.assert_not_called()
            rects.assert_not_called()
            render.assert_not_called()
        self.assertEqual(len(skipped), 1)
        self.assertFalse(unsafe)

    def test_unused_form_mask_without_visible_masks_needs_no_native_adapter(self):
        path = self.path("unused-form-no-mask.pdf")
        write_form_mask_pdf(path, unused=True)
        with fitz.open(path) as document:
            page = document[0]
            with patch.object(fitz.Page, "get_image_info", return_value=[]), patch.object(
                fitz.Page, "get_textpage", side_effect=AssertionError("no masked image is displayed")
            ) as native:
                skipped, unsafe = extractor.page_image_decode_preflight(page, page.get_images(full=True))
            native.assert_not_called()
        self.assertEqual(len(skipped), 1)
        self.assertFalse(unsafe)

    def test_unknown_native_mask_adapter_keeps_refusal(self):
        path = self.path("unknown-form-mask.pdf")
        write_form_mask_pdf(path, unused=True, visible_masked_sibling=True)
        with fitz.open(path) as document:
            page = document[0]
            displayed = page.get_image_info(hashes=False, xrefs=False)
            with patch.object(fitz.Page, "get_image_info", return_value=displayed), patch.object(
                fitz.Page, "get_textpage", return_value=object()
            ):
                skipped, unsafe = extractor.page_image_decode_preflight(page, page.get_images(full=True))
        self.assertTrue(unsafe)
        self.assertTrue(any("mask placement unverified" in warning for warning in skipped.values()))

    def test_malformed_native_mask_headers_keep_refusal(self):
        path = self.path("malformed-form-mask.pdf")
        write_form_mask_pdf(path, unused=True, visible_masked_sibling=True)
        with fitz.open(path) as document:
            page = document[0]
            displayed = page.get_image_info(hashes=False, xrefs=False)
            from unittest.mock import Mock
            native = Mock()
            native.extractIMGINFO.return_value = [{**displayed[0], "number": "not-a-block-index"}]
            with patch.object(fitz.Page, "get_image_info", return_value=displayed), patch.object(
                fitz.Page, "get_textpage", return_value=native
            ):
                skipped, unsafe = extractor.page_image_decode_preflight(page, page.get_images(full=True))
        self.assertTrue(unsafe)
        self.assertTrue(any("mask placement unverified" in warning for warning in skipped.values()))

    def test_safe_embedded_sibling_survives_without_hashing_unsafe_inline_image(self):
        source = self.path("inline-source.pdf")
        path = self.path("inline-sibling.pdf")
        write_indirect_decode_pdf(source, "inline")
        with fitz.open(source) as document:
            pixels = fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, 120, 90), False)
            pixels.clear_with(200)
            document[0].insert_image(fitz.Rect(150, 40, 270, 130), pixmap=pixels)
            document.save(path)
        with patch.object(fitz.Page, "get_image_rects", side_effect=AssertionError("must not hash sibling")), patch.object(
            fitz.Page, "get_pixmap", side_effect=AssertionError("must not render images")
        ):
            result = extractor.extract(path, self.out)
        embedded = [image for image in result["images"] if image["sourceKind"] == "embedded"]
        self.assertEqual(len(embedded), 1)
        self.assertEqual((embedded[0]["width"], embedded[0]["height"]), (120, 90))
        self.assertIsNone(embedded[0]["bbox"])
        self.assertTrue(any(warning.startswith("embedded_image_placement_unavailable") for warning in result["warnings"]))
        self.assertIn("lithium level 0.6 to 0.8 mmol/L", result["pages"][0]["text"])

    @unittest.skipUnless(shutil.which("tesseract") and importlib.util.find_spec("pytesseract"),
                         "Actual Tesseract and pytesseract are required")
    def test_unused_oversized_resources_keep_safe_scanned_page_ocr_and_renders(self):
        for kind in ("embedded", "soft_mask"):
            with self.subTest(kind=kind):
                source = self.path(f"dead-{kind}.pdf")
                path = self.path(f"safe-scan-{kind}.pdf")
                if kind == "embedded":
                    write_declared_image_pdf(source, 9_000, text="")
                else:
                    write_indirect_decode_pdf(source, "soft_mask", text="")
                with fitz.open() as native:
                    page = native.new_page(width=400, height=400)
                    page.insert_text((40, 100), "SYNTHETIC OFFLINE SCAN", fontsize=16)
                    page.insert_text((40, 140), "Keep source text visible.", fontsize=16)
                    scan = page.get_pixmap(dpi=150).tobytes("png")
                with fitz.open(source) as document:
                    page = document[0]
                    dead_xrefs = {image[0] for image in page.get_images(full=True)}
                    for xref in page.get_contents():
                        document.update_stream(xref, b"")
                    page.insert_image(page.rect, stream=scan)
                    document.save(path)
                original_extract = fitz.Document.extract_image
                original_rects = fitz.Page.get_image_rects

                def safe_extract(document, xref):
                    self.assertNotIn(xref, dead_xrefs)
                    return original_extract(document, xref)

                def safe_rects(page, xref, *args, **kwargs):
                    self.assertNotIn(xref, dead_xrefs)
                    return original_rects(page, xref, *args, **kwargs)

                with patch.object(fitz.Document, "extract_image", safe_extract), patch.object(
                    fitz.Page, "get_image_rects", safe_rects
                ):
                    result = extractor.extract(path, self.path(f"out-{kind}"))
                self.assertTrue(result["pages"][0]["ocrUsed"])
                self.assertFalse(result["pages"][0]["needsOcr"])
                self.assertIn("Keep source text visible.", result["pages"][0]["text"])
                self.assertTrue(any(image["sourceKind"] == "cover_page" for image in result["images"]))
                self.assertTrue(any(image["sourceKind"] == "page_region" for image in result["images"]))
                self.assertFalse(any(warning.startswith("page_render_skipped") for warning in result["warnings"]))
                self.assertTrue(any(warning.startswith("embedded_image_skipped") for warning in result["warnings"]))

    def test_normal_inline_image_coverage_is_read_without_decoding_image_bytes(self):
        path = self.path("normal-inline.pdf")
        write_indirect_decode_pdf(path, "inline", side=120)
        with fitz.open(path) as document:
            page = document[0]
            self.assertEqual(page.get_images(full=True), [])
            with patch.object(fitz.Page, "get_image_rects", side_effect=AssertionError("must not hash images")):
                self.assertAlmostEqual(extractor.page_image_coverage_ratio(page), 100 * 100 / (400 * 400))

    def test_native_line_segments_request_no_image_bytes_from_dict(self):
        path = self.path("dict.pdf")
        write_small_image_pdf(path)
        original = fitz.Page.get_text

        def text_only(page, option="text", *args, **kwargs):
            if option == "dict":
                self.assertFalse(kwargs.get("flags", fitz.TEXTFLAGS_DICT) & fitz.TEXT_PRESERVE_IMAGES)
            return original(page, option, *args, **kwargs)

        with fitz.open(path) as document, patch.object(fitz.Page, "get_text", text_only):
            segments = extractor._extract_page_line_segments(document[0])
        self.assertTrue(any("lithium level" in segment[4] for segment in segments))

    def test_an_image_mupdf_refuses_to_load_does_not_abort_the_document(self):
        path = self.path("refused.pdf")
        write_small_image_pdf(path)

        def overly_large(*_args, **_kwargs):
            raise RuntimeError("code=5: Overly large image")

        with patch.object(fitz.Page, "get_image_rects", side_effect=overly_large), patch.object(
            fitz.Document, "extract_image", side_effect=overly_large
        ):
            result = extractor.extract(path, self.out)

        self.assertIn("lithium level 0.6 to 0.8 mmol/L", result["pages"][0]["text"])
        self.assertEqual([image for image in result["images"] if image["sourceKind"] == "embedded"], [])
        self.assertTrue(
            any(
                warning.startswith("embedded_image_skipped") and "RuntimeError" in warning
                for warning in result["warnings"]
            ),
            result["warnings"],
        )

    def test_a_normal_embedded_image_is_still_extracted_with_its_placement(self):
        path = self.path("normal.pdf")
        write_small_image_pdf(path)
        result = extractor.extract(path, self.out)
        embedded = [image for image in result["images"] if image["sourceKind"] == "embedded"]
        self.assertEqual(len(embedded), 1)
        self.assertEqual((embedded[0]["width"], embedded[0]["height"]), (120, 90))
        self.assertIsNotNone(embedded[0]["bbox"])
        self.assertFalse(any(warning.startswith("embedded_image_skipped") for warning in result["warnings"]))


class MalformedSoftMaskPreflightTests(unittest.TestCase):
    """A bad soft-mask Width/Height skips that image instead of aborting the PDF."""

    def _page(self, width_value):
        doc = types.SimpleNamespace(
            xref_get_key=lambda xref, key: ("int", width_value) if key == "Width" else ("int", "10"))
        bbox = types.SimpleNamespace(is_empty=True, is_infinite=False)
        return types.SimpleNamespace(
            parent=doc,
            get_image_info=lambda hashes=False, xrefs=False: [],
            get_image_bbox=lambda info: bbox,
        )

    def test_unparsable_mask_dimension_is_skipped_not_raised(self):
        for bad in ("null", "", "1.5e3x"):
            with self.subTest(bad=bad):
                info = (7, 9, 10, 10, 8, "DeviceRGB", "", "Im1", "FlateDecode", 0)
                skipped, unsafe = extractor.page_image_decode_preflight(self._page(bad), [info])
                self.assertIn(7, skipped)
                self.assertIn("unreadable Width/Height", skipped[7])
                self.assertFalse(unsafe)

    def test_missing_mask_key_tuple_is_skipped_not_raised(self):
        doc = types.SimpleNamespace(xref_get_key=lambda xref, key: ())
        page = types.SimpleNamespace(
            parent=doc,
            get_image_info=lambda hashes=False, xrefs=False: [],
            get_image_bbox=lambda info: types.SimpleNamespace(is_empty=True, is_infinite=False),
        )
        info = (7, 9, 10, 10, 8, "DeviceRGB", "", "Im1", "FlateDecode", 0)
        skipped, _ = extractor.page_image_decode_preflight(page, [info])
        self.assertIn("unreadable Width/Height", skipped[7])

    def test_valid_small_mask_is_not_skipped(self):
        info = (7, 9, 10, 10, 8, "DeviceRGB", "", "Im1", "FlateDecode", 0)
        skipped, unsafe = extractor.page_image_decode_preflight(self._page("10"), [info])
        self.assertEqual(skipped, {})
        self.assertFalse(unsafe)


class ExtractorMemoryLimitTests(unittest.TestCase):
    def fake_resource(self, soft, hard):
        calls = []
        module = types.SimpleNamespace(
            RLIMIT_AS=9,
            RLIM_INFINITY=-1,
            getrlimit=lambda _which: (soft, hard),
            setrlimit=lambda which, limits: calls.append((which, limits)),
        )
        return module, calls

    def test_default_limit_is_applied_to_the_address_space(self):
        module, calls = self.fake_resource(-1, -1)
        with patch.object(extractor, "resource", module), patch.dict(os.environ, {}, clear=False):
            os.environ.pop("PDF_EXTRACTOR_MAX_MEMORY_MB", None)
            applied = extractor.apply_memory_limit()
        expected = extractor.DEFAULT_MAX_MEMORY_MB * 1024 * 1024
        self.assertEqual(applied, expected)
        self.assertEqual(calls, [(9, (expected, -1))])

    def test_operator_override_and_existing_lower_hard_limit_are_respected(self):
        module, calls = self.fake_resource(-1, -1)
        with patch.object(extractor, "resource", module), patch.dict(os.environ, {"PDF_EXTRACTOR_MAX_MEMORY_MB": "3072"}):
            self.assertEqual(extractor.apply_memory_limit(), 3072 * 1024 * 1024)
        self.assertEqual(calls[-1], (9, (3072 * 1024 * 1024, -1)))

        lower_hard = 512 * 1024 * 1024
        module, calls = self.fake_resource(lower_hard, lower_hard)
        with patch.object(extractor, "resource", module), patch.dict(os.environ, {"PDF_EXTRACTOR_MAX_MEMORY_MB": "4096"}):
            self.assertEqual(extractor.apply_memory_limit(), lower_hard)
        self.assertEqual(calls, [(9, (lower_hard, lower_hard))])

    def test_invalid_values_fall_back_to_the_bounded_default_and_zero_disables(self):
        module, calls = self.fake_resource(-1, -1)
        with patch.object(extractor, "resource", module):
            for value in ("lots", "-5", "1.5", ""):
                with patch.dict(os.environ, {"PDF_EXTRACTOR_MAX_MEMORY_MB": value}):
                    self.assertEqual(extractor.apply_memory_limit(), extractor.DEFAULT_MAX_MEMORY_MB * 1024 * 1024)
            calls.clear()
            with patch.dict(os.environ, {"PDF_EXTRACTOR_MAX_MEMORY_MB": "0"}):
                self.assertIsNone(extractor.apply_memory_limit())
        self.assertEqual(calls, [])

    def test_platforms_without_rlimit_support_skip_the_limit(self):
        with patch.object(extractor, "resource", None):
            self.assertIsNone(extractor.apply_memory_limit())

    def test_memory_exhaustion_is_classified_for_the_resource_exit(self):
        self.assertTrue(extractor.is_memory_exhaustion(MemoryError()))
        self.assertTrue(extractor.is_memory_exhaustion(RuntimeError("code=2: malloc (400000000 bytes) failed")))
        self.assertFalse(extractor.is_memory_exhaustion(RuntimeError("code=5: Overly large image")))
        self.assertFalse(extractor.is_memory_exhaustion(ValueError("bad page")))

    def test_command_line_reports_memory_exhaustion_as_a_budget_refusal(self):
        stderr = io.StringIO()
        with patch.object(extractor, "apply_memory_limit", return_value=None), patch.object(
            extractor, "extract", side_effect=RuntimeError("code=2: malloc (400000000 bytes) failed")
        ), redirect_stderr(stderr), self.assertRaises(SystemExit) as caught:
            extractor.main(["extract_pdf_assets.py", "in.pdf", "out"])
        self.assertEqual(caught.exception.code, 3)
        self.assertIn("PDF_EXTRACTION_BUDGET_EXCEEDED: memory limit reached", stderr.getvalue())
        self.assertNotIn("Traceback", stderr.getvalue())

    def test_command_line_applies_the_limit_before_extracting(self):
        order = []
        with patch.object(extractor, "apply_memory_limit", side_effect=lambda: order.append("limit")), patch.object(
            extractor, "extract", side_effect=lambda *_args: order.append("extract") or {"pages": []}
        ), redirect_stderr(io.StringIO()), patch("builtins.print"):
            extractor.main(["extract_pdf_assets.py", "in.pdf", "out"])
        self.assertEqual(order, ["limit", "extract"])

    @unittest.skipUnless(getattr(extractor, "resource", None) is not None and sys.platform.startswith("linux"), "needs RLIMIT_AS")
    def test_real_command_line_run_under_the_default_limit_extracts_a_normal_pdf(self):
        with tempfile.TemporaryDirectory() as directory:
            path = os.path.join(directory, "normal.pdf")
            write_small_image_pdf(path)
            env = {key: value for key, value in os.environ.items() if key != "PDF_EXTRACTOR_MAX_MEMORY_MB"}
            completed = subprocess.run(
                [sys.executable, SCRIPT, path, os.path.join(directory, "out"), os.path.join(directory, "out.json")],
                capture_output=True, text=True, timeout=120, env=env,
            )
            self.assertEqual(completed.returncode, 0, completed.stderr)


class TesseractThreadLimitTests(unittest.TestCase):
    def run_ocr(self):
        seen = []
        pytesseract = types.SimpleNamespace(
            pytesseract=types.SimpleNamespace(tesseract_cmd=None),
            image_to_string=lambda _image, **_kwargs: seen.append(os.environ.get("OMP_THREAD_LIMIT")) or "text",
        )
        pil = types.SimpleNamespace(Image=types.SimpleNamespace(open=lambda _stream: object()))

        class Pix:
            width = 100
            height = 100

            def tobytes(self, _format):
                return b"png"

        class Rect:
            width = 100
            height = 100

        class Page:
            number = 0
            rect = Rect()

            def get_pixmap(self, **_kwargs):
                return Pix()

        with patch.dict(sys.modules, {"pytesseract": pytesseract, "PIL": pil}):
            text, warning = extractor.maybe_ocr_page(Page(), extractor.ExtractionBudget())
        self.assertEqual(text, "text")
        self.assertIsNone(warning)
        return seen

    def test_tesseract_runs_single_threaded_by_default(self):
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("OMP_THREAD_LIMIT", None)
            self.assertEqual(self.run_ocr(), ["1"])

    def test_an_operator_thread_limit_is_kept(self):
        with patch.dict(os.environ, {"OMP_THREAD_LIMIT": "2"}):
            self.assertEqual(self.run_ocr(), ["2"])


if __name__ == "__main__":
    unittest.main()
