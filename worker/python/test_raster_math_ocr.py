"""Source-pixel geometry controls with supplied OCR text, never OCR execution.

These tests verify alignment and abstention contracts, not general recognition
accuracy. Independent fonts, values and units avoid a fixture-specific repair.
"""

import time
import unittest
from unittest.mock import patch

from PIL import Image, ImageDraw, ImageOps
import extract_pdf_assets as extractor
import raster_math_ocr as math_ocr


def render(text, font="helv", size=11):
    with extractor.fitz.open() as document:
        page = document.new_page(width=180, height=55)
        writer = extractor.fitz.TextWriter(page.rect)
        writer.append((5, 32), text, font=extractor.fitz.Font(font), fontsize=size)
        writer.write_text(page)
        pixels = page.get_pixmap(dpi=450, colorspace=extractor.fitz.csGRAY)
        bitmap = Image.frombytes("L", (pixels.width, pixels.height), pixels.samples)
        bounds = ImageOps.invert(bitmap).getbbox()
        return ImageOps.expand(bitmap.crop(bounds), border=15, fill=255)


def plan(bitmap, cap=400_000):
    return math_ocr.plan_raster_math_ocr(bitmap, time.monotonic() + 5, cap)


class RasterMathPlanTests(unittest.TestCase):
    def test_comparisons_keep_exact_polarity_and_observed_decimal_positions(self):
        for font, size in (("helv", 10), ("tiro", 13), ("cour", 11)):
            for sign in ("≤", "≥", "<", ">"):
                for numeric in ("7.25", "725", "0.08", "8.0"):
                    with self.subTest(font=font, size=size, sign=sign, numeric=numeric):
                        bitmap = render(sign + " " + numeric, font, size)
                        before = bitmap.tobytes()
                        candidate = plan(bitmap)
                        self.assertIsNotNone(candidate)
                        self.assertEqual(candidate.kind, "comparison")
                        self.assertEqual(candidate.restore(numeric), sign + " " + numeric)
                        self.assertEqual(bitmap.tobytes(), before)
                        self.assertLessEqual(candidate.bitmap.width * candidate.bitmap.height, 400_000)

    def test_decimal_addition_removal_and_relocation_are_refused(self):
        for source, recognized in (("1.5", "15"), ("15", "1.5"), ("1.25", "12.5")):
            with self.subTest(source=source, recognized=recognized):
                candidate = plan(render("≤ " + source))
                self.assertIsNotNone(candidate)
                with self.assertRaisesRegex(ValueError, "raster math"):
                    candidate.restore(recognized)

    def test_nonnumeric_suffix_is_never_forced_to_a_number(self):
        candidate = plan(render("≤ A"))
        if candidate is not None:
            with self.assertRaises(ValueError):
                candidate.restore("A")

    def test_ascii_equals_and_carets_keep_original_path(self):
        for text in ("<= 0.04", ">= 12.0", "Density (x 10^6/U)", "N 10^9/Z"):
            with self.subTest(text=text):
                self.assertIsNone(plan(render(text)))

    def test_ordinary_letters_never_become_chevrons(self):
        for text in ("Count", "Cell 105", "O 15", "C 1.5", "S 15", "= 3.1", "v 5.0", "_ 5.0"):
            with self.subTest(text=text):
                self.assertIsNone(plan(render(text)))

    def test_source_superscript_indices_preserve_other_digits_and_units(self):
        superscripts = "¹²³⁴⁵⁶⁷⁸⁹"
        for font, size in (("helv", 10), ("tiro", 12), ("cour", 14)):
            for digit, superscript in zip("123456789", superscripts):
                with self.subTest(font=font, size=size, digit=digit):
                    source = "N 10" + superscript + " / Z"
                    bitmap = render(source, font, size)
                    before = bitmap.tobytes()
                    candidate = plan(bitmap)
                    self.assertIsNotNone(candidate)
                    self.assertEqual(candidate.kind, "superscript")
                    self.assertEqual(candidate.restore("N 10" + digit + " / Z"), source)
                    self.assertEqual(bitmap.tobytes(), before)

    def test_baseline_digits_and_decimal_values_do_not_gain_superscripts(self):
        for text in ("N 109/Z", "109", "1.5", "15", "10.9", "Footnote 9"):
            with self.subTest(text=text):
                self.assertIsNone(plan(render(text)))

    def test_footnote_digit_retains_raised_glyph_without_inferred_meaning(self):
        candidate = plan(render("Note⁹", "tiro", 12))
        self.assertIsNotNone(candidate)
        self.assertEqual(candidate.restore("Note9"), "Note⁹")

    def test_circle_star_letter_and_blank_are_not_digit_inputs(self):
        for text in ("N 10°/Z", "N 10*/Z", "N 10ª/Z"):
            with self.subTest(text=text):
                self.assertIsNone(plan(render(text, "helv", 12)))
        self.assertIsNone(plan(Image.new("L", (80, 50), 255)))

    def test_zero_and_unknown_recognition_are_refused_after_normalization(self):
        candidate = plan(render("N 10⁰/Z", "helv", 12))
        self.assertIsNotNone(candidate)
        with self.assertRaises(ValueError):
            candidate.restore("N 100/Z")
        candidate = plan(render("N 10⁹/Z", "helv", 12))
        for text in ("N 10?/Z", "N 10*/Z", "N 10a/Z", "N 100/Z", "N 1099/Z", "N 10/Z"):
            with self.subTest(text=text):
                with self.assertRaises(ValueError):
                    candidate.restore(text)

    def test_multiple_raised_source_positions_restore_independently(self):
        candidate = plan(render("N 10⁹/Z 10⁷/R", "helv", 11))
        self.assertIsNotNone(candidate)
        self.assertEqual(candidate.restore("N 109/Z 107/R"), "N 10⁹/Z 10⁷/R")

    def test_internal_newlines_cannot_change_source_index_alignment(self):
        for source, recognized in (("≤ 1.5", "1.\n5"), ("N 10⁹/Z", "N 10\n9/Z")):
            candidate = plan(render(source))
            self.assertIsNotNone(candidate)
            with self.assertRaisesRegex(ValueError, "layout"):
                candidate.restore(recognized)

    def test_multiline_overlapping_and_noisy_geometry_abstains(self):
        bitmap = render("N 10⁹/Z")
        double = Image.new("L", (bitmap.width, bitmap.height * 2 + 20), 255)
        double.paste(bitmap, (0, 0))
        double.paste(bitmap, (0, bitmap.height + 20))
        self.assertIsNone(plan(double))
        noisy = bitmap.copy()
        noisy.putpixel((noisy.width - 1, noisy.height - 1), 0)
        self.assertIsNone(plan(noisy))

    def test_detached_offset_minus_is_not_an_inclusive_sign(self):
        bitmap = render("< 7.25")
        # A separate, offset annotation below the chevron does not own its width.
        draw = ImageDraw.Draw(bitmap)
        draw.line((3, bitmap.height - 5, 24, bitmap.height - 5), fill=0, width=3)
        self.assertIsNone(plan(bitmap))

    def test_allocation_and_deadline_limits_precede_work(self):
        bitmap = render("N 10⁹/Z")
        self.assertIsNone(plan(bitmap, cap=bitmap.width * bitmap.height - 1))
        self.assertIsNone(plan(Image.new("L", (1000, 401), 255)))
        candidate = plan(bitmap)
        self.assertIsNotNone(candidate)
        # A cap which admits the original but not the normalized image abstains.
        self.assertIsNone(plan(bitmap, cap=bitmap.width * bitmap.height))
        with patch.object(math_ocr.time, "monotonic", return_value=100):
            with self.assertRaises(TimeoutError):
                math_ocr.plan_raster_math_ocr(bitmap, 99, 400_000)
            candidate.deadline = 99
            with self.assertRaises(TimeoutError):
                candidate.restore("N 109/Z")

    def test_superscript_conditioning_enlarges_full_line_and_preserves_source(self):
        source = render("Count (x 10³/L)", "cour", 10)
        before = source.tobytes()
        candidate = plan(source)
        self.assertIsNotNone(candidate)
        bounds = ImageOps.invert(candidate.bitmap).getbbox()
        self.assertGreaterEqual(bounds[0], 40)
        self.assertGreaterEqual(bounds[1], 40)
        self.assertLessEqual(bounds[2], candidate.bitmap.width - 40)
        self.assertLessEqual(bounds[3], candidate.bitmap.height - 40)
        self.assertGreaterEqual(bounds[3] - bounds[1], 2 * candidate.body_height)
        self.assertLessEqual(candidate.bitmap.width * candidate.bitmap.height, 400_000)
        self.assertEqual(source.tobytes(), before)
        # Conditioning changes pixels submitted to OCR, never letter/value text.
        self.assertEqual(candidate.restore("Count (x 103/L)"), "Count (x 10³/L)")
        self.assertEqual(candidate.restore("Count (x 103/1)"), "Count (x 10³/1)")

    def test_conditioning_cap_is_checked_before_full_line_resizing(self):
        source = render("Count (x 10³/L)", "cour", 10)
        cap = source.width * source.height + 5000
        actual_resize, calls = Image.Image.resize, []

        def bounded_resize(image, size, *args, **kwargs):
            calls.append(size)
            self.assertLessEqual(size[0] * size[1], cap)
            return actual_resize(image, size, *args, **kwargs)

        with patch.object(Image.Image, "resize", bounded_resize):
            self.assertIsNone(plan(source, cap=cap))
        # The raised component fits; the subsequent full-line doubling must
        # abstain before making a resize allocation larger than the caller cap.
        self.assertTrue(calls)


if __name__ == "__main__":
    unittest.main()
