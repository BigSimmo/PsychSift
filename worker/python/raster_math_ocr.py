"""Bounded pixel plans for isolated comparisons and raised digits; OCR stays unverified.

No dictionary, units, expected values or source-specific templates are consulted.
Unsupported geometry keeps the original OCR path. A changed bitmap must always
pass restore(), otherwise the caller must discard the complete table candidate.
"""

from dataclasses import dataclass
import re
from statistics import median
import time


MAX_MATH_PIXELS = 400_000
SUPERSCRIPTS = str.maketrans("123456789", "¹²³⁴⁵⁶⁷⁸⁹")


def _check(deadline):
    if time.monotonic() >= deadline:
        raise TimeoutError("raster math analysis exhausted page deadline")


def _runs(values, deadline):
    spans = []
    for index, value in enumerate(values):
        if index % 64 == 0:
            _check(deadline)
        if value:
            if spans and spans[-1][1] == index:
                spans[-1][1] = index + 1
            else:
                spans.append([index, index + 1])
    return spans


def _bar(ink, box):
    x0, y0, x1, y1 = box
    return ink.crop(box).histogram()[255] >= (x1 - x0) * (y1 - y0) * .65


def _operator(ink, glyph, deadline):
    """A chevron has two sloped arms; an inclusive sign has a separate bar below."""
    box, bands = glyph
    x0, y0, x1, y1 = box
    width = x1 - x0
    if len(bands) not in (1, 2):
        return None
    a, b = bands[0]
    height = b - a
    if height < 8 or not .35 <= width / height <= 1.7:
        return None
    centers = []
    for position in (.15, .30, .45, .55, .70, .85):
        _check(deadline)
        y = a + round((height - 1) * position)
        spans = _runs(ink.crop((x0, y, x1, y + 1)).getprojection()[0], deadline)
        if len(spans) != 1:
            return None
        centers.append(sum(spans[0]) / 2 / width)
    slopes = [centers[1] - centers[0], centers[2] - centers[1],
              centers[3] - centers[4], centers[4] - centers[5]]
    if all(slope <= -.12 for slope in slopes) and max(centers[2:4]) < .35:
        sign = "<"
    elif all(slope >= .12 for slope in slopes) and min(centers[2:4]) > .65:
        sign = ">"
    else:
        return None
    if len(bands) == 2:
        c, d = bands[1]
        arm_bounds = ink.crop((x0, a, x1, b)).getbbox()
        bar_bounds = ink.crop((x0, c, x1, d)).getbbox()
        if not (0 < c - b < height * .5 and d - c <= height * .25
                and _bar(ink, (x0, c, x1, d))
                and max(abs(arm_bounds[edge] - bar_bounds[edge]) for edge in (0, 2)) <= 2):
            return None
        sign = "≤" if sign == "<" else "≥"
    return sign


@dataclass
class MathOcrPlan:
    bitmap: object
    kind: str
    glyphs: list
    deadline: float
    operator: str = ""
    raised: tuple = ()
    body_height: float = 0
    baseline: float = 0

    def restore(self, text):
        _check(self.deadline)
        if "\n" in text.strip() or "\r" in text.strip():
            raise ValueError("raster math text layout is ambiguous")
        characters = [char for char in text if not char.isspace()]
        if len(characters) != len(self.glyphs):
            raise ValueError("raster math source alignment is ambiguous")
        if self.kind == "comparison":
            numeric = "".join(characters)
            if not re.fullmatch(r"[0-9]+(?:\.[0-9]+)?", numeric):
                raise ValueError("raster math numeric recognition is ambiguous")
            for char, (box, _) in zip(characters, self.glyphs):
                _check(self.deadline)
                x0, y0, x1, y1 = box
                if char == ".":
                    if not (max(x1 - x0, y1 - y0) <= self.body_height * .3
                            and y0 >= self.baseline - self.body_height * .3
                            and abs(y1 - self.baseline) <= self.body_height * .2):
                        raise ValueError("raster math decimal alignment is ambiguous")
                elif y1 - y0 < self.body_height * .65:
                    raise ValueError("raster math digit alignment is ambiguous")
            return self.operator + " " + numeric
        # The digit's index is its observed, disjoint source x-interval. Never
        # replace a text pattern such as 109, a question mark, or a known unit.
        if any(characters[index] not in "123456789" for index in self.raised):
            # Zero is intentionally unsupported: a normalized degree circle
            # was actually recognized as 0 by the pinned model without a whitelist.
            raise ValueError("raster math raised recognition is ambiguous")
        result, index = [], 0
        for char in text:
            _check(self.deadline)
            if not char.isspace():
                if index in self.raised:
                    char = char.translate(SUPERSCRIPTS)
                index += 1
            result.append(char)
        return "".join(result)


def plan_raster_math_ocr(bitmap, deadline, max_pixels):
    """Return one replacement OCR input plus a mandatory coordinate restoration.

    Only small, single-line, x-disjoint source components are supported. This
    does not certify OCR accuracy or infer whether a raised digit is a power
    or a footnote. Input/output pixels and all work share the caller's limits.
    """
    _check(deadline)
    cap = min(MAX_MATH_PIXELS, max_pixels)
    if bitmap.mode not in ("L", "RGB") or bitmap.width * bitmap.height > cap:
        return None
    ink = bitmap.convert("L").point(lambda value: 255 if value < 128 else 0)
    _check(deadline)
    glyphs = []
    for x0, x1 in _runs(ink.getprojection()[0], deadline):
        bands = _runs(ink.crop((x0, 0, x1, ink.height)).getprojection()[1], deadline)
        y0, y1 = bands[0][0], bands[-1][1]
        glyphs.append(((x0, y0, x1, y1), bands))
        if len(glyphs) > 96:
            return None
    if len(glyphs) < 2:
        return None
    bands = _runs(ink.getprojection()[1], deadline)
    gap = max(2, median(b - a for a, b in bands) * .35)
    if any(right[0] - left[1] > gap for left, right in zip(bands, bands[1:])):
        return None
    heights = sorted(box[3] - box[1] for box, _ in glyphs)
    height = median(heights[len(heights) // 2:])
    if height < 12:
        return None
    baseline = median(box[3] for box, _ in glyphs if box[3] - box[1] >= height * .8)
    if any(abs(box[3] - baseline) > height * .35 for box, _ in glyphs
           if box[3] - box[1] >= height * .8):
        return None
    sign = _operator(ink, glyphs[0], deadline)
    if sign:
        # ASCII <= and >= contain a second, side-by-side equals glyph. Keep
        # that source spelling on the ordinary OCR path.
        box, second_bands = glyphs[1]
        if len(second_bands) == 2 and all(
                _bar(ink, (box[0], a, box[2], b)) for a, b in second_bands):
            return None
        suffix = glyphs[1:]
        left = suffix[0][0][0]
        right = suffix[-1][0][2]
        _check(deadline)
        return MathOcrPlan(bitmap.crop((max(0, left - 4), 0, min(bitmap.width, right + 4), bitmap.height)),
                           "comparison", suffix, deadline, sign, body_height=height, baseline=baseline)
    raised = []
    for index, (box, component_bands) in enumerate(glyphs):
        _check(deadline)
        x0, y0, x1, y1 = box
        h = y1 - y0
        if .3 * height <= h <= .8 * height and y1 <= baseline - .25 * height:
            # Near-circular degree signs, broad stars/letters, isolated marks
            # and overlapping x-intervals do not become normalized digit inputs.
            if (not index or len(component_bands) != 1 or not .18 <= (x1 - x0) / h <= .86
                    or x0 - glyphs[index - 1][0][2] > height * .65):
                return None
            raised.append(index)
    if not raised or len(raised) > 8:
        return None
    body = round(height)
    widths = {i: round((glyphs[i][0][2] - glyphs[i][0][0]) * body /
                       (glyphs[i][0][3] - glyphs[i][0][1])) for i in raised}
    extra = sum(widths[i] - (glyphs[i][0][2] - glyphs[i][0][0]) + 3 for i in raised)
    if (bitmap.width + extra) * bitmap.height > cap or baseline < body:
        return None
    from PIL import Image, ImageChops, ImageOps
    _check(deadline)
    normalized = Image.new(bitmap.mode, (bitmap.width + extra, bitmap.height), "white")
    source, shift = 0, 0
    for index in raised:
        _check(deadline)
        x0, y0, x1, y1 = glyphs[index][0]
        normalized.paste(bitmap.crop((source, 0, x0, bitmap.height)), (source + shift, 0))
        patch = bitmap.crop((x0, y0, x1, y1)).resize((widths[index], body), Image.Resampling.LANCZOS)
        normalized.paste(patch, (x0 + shift, round(baseline) - body))
        shift += widths[index] - (x1 - x0) + 3
        source = x1
    normalized.paste(bitmap.crop((source, 0, bitmap.width, bitmap.height)), (source + shift, 0))
    _check(deadline)
    # Small source fonts can confuse ordinary body glyphs after the raised
    # component is enlarged. Condition the entire line equally: remove only
    # exactly white margins, double resolution, then add a 40-pixel white border
    # (20 source pixels). No letter or digit is classified or substituted here.
    bounds = ImageChops.difference(normalized, Image.new(bitmap.mode, normalized.size, "white")).getbbox()
    ink_width, ink_height = bounds[2] - bounds[0], bounds[3] - bounds[1]
    if (ink_width + 40) * (ink_height + 40) * 4 > cap:
        return None
    _check(deadline)
    conditioned = ImageOps.expand(normalized.crop(bounds).resize(
        (ink_width * 2, ink_height * 2), Image.Resampling.LANCZOS), border=40, fill="white")
    _check(deadline)
    return MathOcrPlan(conditioned, "superscript", glyphs, deadline, raised=tuple(raised),
                       body_height=height, baseline=baseline)
