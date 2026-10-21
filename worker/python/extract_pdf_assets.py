import hashlib
import io
import json
import math
import os
import re
import sys
import shlex
import shutil
import subprocess
import time
from functools import lru_cache
from statistics import median

try:
    import resource  # POSIX only; Windows developer machines run without the memory cap.
except ImportError:  # pragma: no cover - exercised only on Windows
    resource = None

try:
    import pymupdf as fitz  # PyMuPDF (fitz alias deprecated in 1.28.2+)
except Exception as exc:
    print(f"PyMuPDF is required for robust PDF extraction: {exc}", file=sys.stderr)
    sys.exit(2)


# Behaviour version of this extractor, recorded on every document it produces (audit F04) so a
# parser defect can be traced to the documents it touched. Bump the date and label whenever a
# change alters the text, tables or images produced for the same PDF. 2026-09-16 is PR #2810,
# which replaced line-major table text with table_aware_page_text (#GJHKYC).
EXTRACTOR_VERSION = "2026-10-21.merged-cell-provenance-v11"
TABLE_STRATEGY = "table_aware_page_text"

# IDX-H6: caps on serialized table size. Raised from the previous 80/120-row and 8000-char
# limits so realistic long clinical tables (dose/threshold grids) are not silently truncated
# mid-table. When a cap is still hit we record rows_truncated/row_count so the truncation is
# observable in index_quality rather than dropping tail rows invisibly.
MAX_TABLE_ROWS = 400
MAX_TABLE_TEXT_CHARS = 24000
TARGET_CROP_DPI = 220
TARGET_COVER_MAX_WIDTH = 480
MAX_RENDER_SCALE = 4.0
TARGET_OCR_DPI = 450
MAX_OCR_RENDER_SCALE = TARGET_OCR_DPI / 72
MIN_USEFUL_RENDER_SCALE = 0.25

# Audit L12: embedded image streams are copied out of the PDF as-is, and their
# MIME type used to be derived from PyMuPDF's filter extension
# (`f"image/{ext}"`), which yields image/jpx, image/jb2, image/tiff, image/bmp,
# image/pnm for JPEG2000/JBIG2/other filters. The vision provider rejects those,
# and the rejection used to fail the WHOLE document. Only these formats are
# forwarded untouched; everything else is re-encoded to PNG under the existing
# render-pixel budget. A single embedded artifact is also capped on its own,
# because the aggregate maxArtifactBytes budget lets one huge stream through.
WEB_SAFE_IMAGE_EXTS = ("png", "jpg", "jpeg", "gif", "webp")
MAX_EMBEDDED_IMAGE_BYTES = 20 * 1024 * 1024

# Audit ING-B-04: PyMuPDF decodes an embedded image inside extract_image() and
# get_image_rects(), whatever its format, so a 389 KB PDF declaring a
# 20,000 x 20,000 image used 842 MB before any budget check could run. Every
# embedded image's DECLARED size (from page.get_images, which decodes nothing)
# is checked against this ceiling first; a larger image is skipped and recorded,
# never decoded. It sits well above real clinical figures and 600 DPI A4 scans
# (about 35 megapixels), so ordinary documents keep every image they had.
MAX_EMBEDDED_IMAGE_PIXELS = 64_000_000

# Audit ING-B-05: the command-line extractor caps its own address space so a
# hostile PDF cannot take the whole worker container down. Normal documents,
# including Tesseract OCR (which inherits the limit), measured well under 512 MB.
# PDF_EXTRACTOR_MAX_MEMORY_MB overrides it; 0 turns it off.
DEFAULT_MAX_MEMORY_MB = 2048
MEMORY_EXHAUSTION_PATTERN = re.compile(r"\bmalloc \(\d+ bytes\) failed|\bout of memory\b", re.IGNORECASE)

DEFAULT_BUDGET = {
    "version": 1,
    "maxRenderPixels": 4_000_000,
    "maxPages": 5_000,
    "maxArtifacts": 10_000,
    "maxArtifactBytes": 512 * 1024 * 1024,
    "maxTextBytes": 64 * 1024 * 1024,
    "maxResultBytes": 64 * 1024 * 1024,
    "ocrPageTimeoutSeconds": 60,
    "totalTimeoutMs": 15 * 60 * 1000,
}


class ExtractionBudgetExceeded(RuntimeError):
    pass


class ExtractionBudget:
    def __init__(self, limits=None):
        self.limits = {**DEFAULT_BUDGET, **(limits or {})}
        for key, value in self.limits.items():
            if not isinstance(value, int) or value <= 0:
                raise ValueError(f"Invalid PDF extraction budget value for {key}")
        self.page_count = 0
        self.artifact_count = 0
        self.artifact_bytes = 0
        self.text_bytes = 0

    def set_page_count(self, count):
        if count > self.limits["maxPages"]:
            raise ExtractionBudgetExceeded(
                f"page count {count} exceeds {self.limits['maxPages']}"
            )
        self.page_count = count

    def add_text(self, text):
        self.text_bytes += len((text or "").encode("utf-8"))
        if self.text_bytes > self.limits["maxTextBytes"]:
            raise ExtractionBudgetExceeded(
                f"extracted UTF-8 text exceeds {self.limits['maxTextBytes']} bytes"
            )

    def add_artifact(self, byte_length):
        next_count = self.artifact_count + 1
        next_bytes = self.artifact_bytes + max(0, int(byte_length))
        if next_count > self.limits["maxArtifacts"]:
            raise ExtractionBudgetExceeded(
                f"artifact count {next_count} exceeds {self.limits['maxArtifacts']}"
            )
        if next_bytes > self.limits["maxArtifactBytes"]:
            raise ExtractionBudgetExceeded(
                f"temporary artifact bytes exceed {self.limits['maxArtifactBytes']}"
            )
        self.artifact_count = next_count
        self.artifact_bytes = next_bytes

    def ensure_artifact_slot(self):
        if self.artifact_count + 1 > self.limits["maxArtifacts"]:
            raise ExtractionBudgetExceeded(
                f"artifact count {self.artifact_count + 1} exceeds {self.limits['maxArtifacts']}"
            )

    def ensure_result(self, serialized):
        byte_length = len(serialized.encode("utf-8"))
        if byte_length > self.limits["maxResultBytes"]:
            raise ExtractionBudgetExceeded(
                f"result JSON exceeds {self.limits['maxResultBytes']} bytes"
            )

    def usage(self):
        return {
            "pages": self.page_count,
            "artifacts": self.artifact_count,
            "artifactBytes": self.artifact_bytes,
            "textBytes": self.text_bytes,
        }


def embedded_image_mime_type(ext):
    """MIME type for an embedded image the worker will hand to the vision model.

    Never returns a PDF-filter extension: anything outside WEB_SAFE_IMAGE_EXTS
    has been re-encoded to PNG by normalize_embedded_image before this is called.
    """
    normalized = str(ext or "").lower().lstrip(".")
    if normalized in ("jpg", "jpeg"):
        return "image/jpeg"
    if normalized in WEB_SAFE_IMAGE_EXTS:
        return f"image/{normalized}"
    return "image/png"


def declared_image_pixels(image_info):
    """Pixels an embedded image declares in the page's image table (no decode)."""
    try:
        return max(0, int(image_info[2] or 0)) * max(0, int(image_info[3] or 0))
    except (IndexError, TypeError, ValueError):
        return 0


def oversized_embedded_image_warning(image_info, max_pixels=MAX_EMBEDDED_IMAGE_PIXELS):
    """Warning for an image whose declared size is over the ceiling, else None."""
    pixels = declared_image_pixels(image_info)
    if pixels <= max_pixels:
        return None
    return (
        f"embedded_image_skipped: xref {image_info[0]} declares {image_info[2]}x{image_info[3]} "
        f"({pixels} pixels), above the {max_pixels}-pixel embedded-image ceiling; not decoded"
    )


def is_memory_exhaustion(exc):
    """True for Python or MuPDF allocation failures under the address-space limit."""
    return isinstance(exc, MemoryError) or bool(MEMORY_EXHAUSTION_PATTERN.search(str(exc)))


def apply_memory_limit():
    """Cap this process's address space (ING-B-05); returns the bytes applied, or None.

    Only the soft limit is lowered, never above an existing hard limit, and child
    processes such as Tesseract inherit it. Unsupported platforms run uncapped.
    """
    if resource is None or not hasattr(resource, "RLIMIT_AS"):
        return None
    raw = os.environ.get("PDF_EXTRACTOR_MAX_MEMORY_MB", "").strip()
    limit_mb = DEFAULT_MAX_MEMORY_MB
    if raw.isdigit():
        limit_mb = int(raw)
        if limit_mb == 0:
            return None
    limit = limit_mb * 1024 * 1024
    try:
        soft, hard = resource.getrlimit(resource.RLIMIT_AS)
        if hard != resource.RLIM_INFINITY and hard >= 0:
            limit = min(limit, hard)
        if soft != resource.RLIM_INFINITY and 0 <= soft <= limit:
            limit = soft
        resource.setrlimit(resource.RLIMIT_AS, (limit, hard))
    except (OSError, ValueError):
        return None
    return limit


def normalize_embedded_image(document, xref, extracted, budget, max_bytes=MAX_EMBEDDED_IMAGE_BYTES):
    """Return ``(payload, warning)`` for one embedded image stream.

    ``payload`` is None when the image must be skipped; the warning then says why
    (never quoting the bytes). A skipped image is one skipped image — the caller
    keeps going, and the document still completes.
    """
    ext = str(extracted.get("ext") or "png").lower().lstrip(".")
    image_bytes = extracted.get("image") or b""
    width = extracted.get("width")
    height = extracted.get("height")

    if ext not in WEB_SAFE_IMAGE_EXTS:
        max_pixels = budget.limits["maxRenderPixels"]
        pixels = int(width or 0) * int(height or 0)
        if pixels > max_pixels:
            return None, (
                f"embedded_image_skipped: xref {xref} is {ext} at {pixels} pixels, "
                f"above the {max_pixels} render-pixel budget"
            )
        try:
            pixmap = fitz.Pixmap(document, xref)
            if pixmap.n - pixmap.alpha >= 4:
                # CMYK / separation colourspaces cannot be written as PNG directly.
                pixmap = fitz.Pixmap(fitz.csRGB, pixmap)
            image_bytes = pixmap.tobytes("png")
            width = getattr(pixmap, "width", width)
            height = getattr(pixmap, "height", height)
            ext = "png"
        except Exception as exc:
            return None, f"embedded_image_skipped: xref {xref} ({ext}) could not be re-encoded to PNG: {type(exc).__name__}"

    if len(image_bytes) > max_bytes:
        return None, (
            f"embedded_image_skipped: xref {xref} is {len(image_bytes)} bytes, "
            f"above the {max_bytes}-byte per-image cap"
        )

    return (
        {
            "ext": ext,
            "bytes": image_bytes,
            "mime": embedded_image_mime_type(ext),
            "width": width,
            "height": height,
        },
        None,
    )


def bounded_render_scale(rect, desired_scale, max_pixels, max_scale=MAX_RENDER_SCALE):
    width = float(rect.width)
    height = float(rect.height)
    if not all(math.isfinite(value) and value > 0 for value in (width, height, desired_scale)):
        return None
    scale = min(float(desired_scale), max_scale)
    scale = min(scale, math.sqrt(max_pixels / (width * height)))
    if not math.isfinite(scale) or scale < MIN_USEFUL_RENDER_SCALE:
        return None

    # PyMuPDF rounds transformed dimensions. Use conservative ceiling dimensions
    # and a small multiplicative correction rather than relying on float equality.
    for _ in range(4):
        rounded_pixels = math.ceil(width * scale) * math.ceil(height * scale)
        if rounded_pixels <= max_pixels:
            break
        scale *= math.sqrt(max_pixels / rounded_pixels) * (1.0 - 1e-9)
    if math.ceil(width * scale) * math.ceil(height * scale) > max_pixels:
        return None
    if scale < MIN_USEFUL_RENDER_SCALE:
        return None
    return scale


RASTER_TABLE_MODEL_SHA256 = "6dbdaf8ecc6c40f025c2648bf3b3f3fbffe073e1fd2df2047fde2e2b2f020d53"
RASTER_TABLE_MODEL_BYTES = 89_384_811
RASTER_TABLE_MODEL_PATH = "/opt/psychsift-ocr-models/Latin.traineddata"
# Optional cell OCR must leave time for the existing whole-page reader. Small
# custom page budgets use that reader directly; no extraction budget is reset.
RASTER_TABLE_FALLBACK_RESERVE_SECONDS = 10


class RasterTableModelError(ValueError):
    pass


def checked_raster_table_model(deadline):
    """Verify the provisioned cell model; never download or repair source glyphs."""
    path = os.environ.get("PDF_RASTER_TABLE_MODEL_PATH", RASTER_TABLE_MODEL_PATH)
    if time.monotonic() >= deadline:
        raise TimeoutError("model check exhausted page OCR timeout")
    try:
        if os.path.basename(path) != "Latin.traineddata" or os.path.getsize(path) != RASTER_TABLE_MODEL_BYTES:
            raise RasterTableModelError("raster cell model size or basename mismatch")
        digest = hashlib.sha256()
        with open(path, "rb") as model:
            while True:
                if time.monotonic() >= deadline:
                    raise TimeoutError("model hash exhausted page OCR timeout")
                chunk = model.read(1024 * 1024)
                if not chunk:
                    break
                digest.update(chunk)
        if digest.hexdigest() != RASTER_TABLE_MODEL_SHA256:
            raise RasterTableModelError("raster cell model sha256 mismatch")
        return os.path.dirname(os.path.abspath(path))
    except TimeoutError:
        raise
    except OSError:
        raise RasterTableModelError("provisioned raster cell model unavailable") from None


@lru_cache(maxsize=8)
def observed_tesseract_version(command, timeout=2):
    """Observe the executable, not a configured version; bound and cache the probe."""
    try:
        result = subprocess.run([command, "--version"], capture_output=True, text=True,
                                encoding="utf-8", errors="replace", timeout=timeout, check=False)
        line = (result.stdout or "").splitlines()[0] if result.stdout else ""
        match = re.fullmatch(r"tesseract\s+([0-9][A-Za-z0-9.+_-]{0,127})", line.strip())
        return match.group(1) if result.returncode == 0 and match else None
    except Exception:
        return None


def observed_raster_runtime(pytesseract, deadline):
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise TimeoutError("runtime observation exhausted page OCR timeout")
    command = pytesseract.pytesseract.tesseract_cmd
    version = observed_tesseract_version(shutil.which(command) or command, min(2, remaining))
    if not version:
        raise ValueError("raster OCR engine identity unavailable")
    return {"pythonVersion": sys.version.split()[0], "pymupdfVersion": str(fitz.VersionBind),
            "mupdfVersion": str(fitz.VersionFitz), "tesseractVersion": version}


def raster_ruled_cells(image, deadline=None, grid_bounds=None):
    """Conservative physical cells for one complete ruled raster grid.

    No text, numeric vocabulary, OCR confidence or clinical values select cells.
    Merged bands use their observed vertical rules; ambiguous side content and
    incomplete/multiple grids return None rather than being silently reordered.
    """
    def check_deadline():
        if deadline is not None and time.monotonic() >= deadline:
            raise TimeoutError("raster geometry exhausted page OCR timeout")

    check_deadline()
    ink = image.convert("L").point(lambda value: 255 if value < 96 else 0)
    check_deadline()
    width, height = ink.size
    rules = []
    for y in range(height):
        if y % 32 == 0:
            check_deadline()
        strip = ink.crop((0, y, width, y + 1))
        box = strip.getbbox()
        if not box or box[2] - box[0] < width * 0.3:
            continue
        if strip.histogram()[255] < (box[2] - box[0]) * 0.96:
            continue
        left, right = box[0], box[2]
        if rules and y <= rules[-1][1] + 2:
            rules[-1][1] = y
        else:
            rules.append([y, y, left, right])
        if len(rules) > 24:
            return None
    if len(rules) < 4:
        return None
    left, right = rules[0][2:]
    if any(abs(rule[2] - left) > 3 or abs(rule[3] - right) > 3 for rule in rules):
        return None
    grid_top, grid_bottom = rules[0][0], rules[-1][1] + 1
    # Rule detection may ignore faint ink; source preservation must not.
    side_ink = image.convert("L").point(lambda value: 255 if value < 255 else 0)
    check_deadline()
    # Do not move or silently omit even light-gray side qualifications.
    if (left > 3 and side_ink.crop((0, grid_top, left - 3, grid_bottom)).getbbox()) or (
        right + 3 < width and side_ink.crop((right + 3, grid_top, width, grid_bottom)).getbbox()
    ):
        return None
    rows = []
    for upper, lower in zip(rules, rules[1:]):
        check_deadline()
        top, bottom = upper[1] + 2, lower[0] - 1
        if bottom - top < 6:
            return None
        columns = []
        for x in range(max(0, left - 2), min(width, right + 2)):
            if x % 32 == 0:
                check_deadline()
            count = ink.crop((x, top, x + 1, bottom)).histogram()[255]
            if count < (bottom - top) * 0.96:
                continue
            if columns and x <= columns[-1][1] + 2:
                columns[-1][1] = x
            else:
                columns.append([x, x])
        if len(columns) < 2 or abs(columns[0][0] - left) > 3 or abs(columns[-1][1] - right) > 3:
            return None
        row = [(a[1] + 2, top, b[0] - 1, bottom) for a, b in zip(columns, columns[1:])]
        if any(x1 - x0 < 4 for x0, _, x1, _ in row):
            return None
        rows.append(row)
    if sum(len(row) > 1 for row in rows) < 2 or sum(map(len, rows)) > 80:
        return None
    if grid_bounds is not None:
        # Cell interiors are not outside-region bounds. Preserve the observed
        # outer rule, including its adjacent antialiased raster fringe.
        fringe = image.convert("L").point(lambda value: 255 if value < 255 else 0)
        outer_top, outer_bottom = grid_top, grid_bottom
        for y in range(grid_top - 1, max(-1, grid_top - 4), -1):
            check_deadline()
            if fringe.crop((left, y, right, y + 1)).histogram()[255] < (right - left) * 0.96:
                break
            outer_top = y
        for y in range(grid_bottom, min(height, grid_bottom + 3)):
            check_deadline()
            if fringe.crop((left, y, right, y + 1)).histogram()[255] < (right - left) * 0.96:
                break
            outer_bottom = y + 1
        grid_bounds.update(top=outer_top, bottom=outer_bottom)
    return rows


def bounded_clip_render_scale(rect, desired_scale, max_pixels):
    """Bound independently rounded clip edges, not just width/height products."""
    scale = bounded_render_scale(rect, desired_scale, max_pixels, max_scale=MAX_OCR_RENDER_SCALE)
    if scale is None:
        return None
    for _ in range(4):
        width = math.ceil(rect.x1 * scale) - math.floor(rect.x0 * scale)
        height = math.ceil(rect.y1 * scale) - math.floor(rect.y0 * scale)
        pixels = width * height
        if pixels <= max_pixels:
            return scale
        scale *= math.sqrt(max_pixels / pixels) * (1 - 1e-9)
    return None


class RasterLayoutAmbiguous(ValueError):
    pass


def raster_prose_regions(image, bounds, deadline):
    """Bounded physical whitespace cuts; never infer columns from source words."""
    def check():
        if time.monotonic() >= deadline:
            raise TimeoutError("outside raster layout exhausted page OCR timeout")

    def runs(values, populated):
        groups = []
        for index, value in enumerate(values):
            if index % 32 == 0:
                check()
            if bool(value) != populated:
                continue
            if groups and index == groups[-1][1]:
                groups[-1][1] = index + 1
            else:
                groups.append([index, index + 1])
        return groups

    def physical_lines(projection):
        bands = runs(projection, True)
        if not bands:
            return []
        # Join dots/accents before measuring interline whitespace, as in cells.
        small_gap = max(2, median(end - start for start, end in bands) * 0.35)
        merged = [bands[0][:]]
        for start, end in bands[1:]:
            check()
            if start - merged[-1][1] <= small_gap:
                merged[-1][1] = end
            else:
                merged.append([start, end])
        return merged

    def aligned_multiline_rows(left, right):
        left, right = physical_lines(left), physical_lines(right)
        i = j = 0
        aligned = 0
        while i < len(left) and j < len(right):
            check()
            a0, a1 = left[i]
            b0, b1 = right[j]
            if min(a1, b1) > max(a0, b0):
                aligned += 1
                if aligned >= 2:
                    return True
                i += 1
                j += 1
                continue
            if a1 <= b1:
                i += 1
            else:
                j += 1
        return False

    check()
    # Geometry must not silently discard light source glyphs. Non-white noise
    # may conservatively prevent a cut, leaving that full region for real OCR.
    ink = image.convert("L").point(lambda value: 255 if value < 255 else 0)
    check()
    regions = []

    def partition(box, depth=0):
        check()
        crop = ink.crop(box)
        content = crop.getbbox()
        if not content:
            return
        x0, y0 = box[0] + content[0], box[1] + content[1]
        x1, y1 = box[0] + content[2], box[1] + content[3]
        crop = ink.crop((x0, y0, x1, y1))
        xs, ys = crop.getprojection()
        check()
        def column_cut(region):
            check()
            region_image = ink.crop(region)
            content = region_image.getbbox()
            if not content:
                return None
            rx0, ry0 = region[0] + content[0], region[1] + content[1]
            rx1, ry1 = region[0] + content[2], region[1] + content[3]
            projection = ink.crop((rx0, ry0, rx1, ry1)).getprojection()[0]
            gaps = runs(projection, False)
            if not gaps:
                return None
            gap = max(gaps, key=lambda span: span[1] - span[0])
            cut = rx0 + (gap[0] + gap[1]) // 2
            if gap[1] - gap[0] < max(12, (rx1 - rx0) * 0.04):
                return None
            if min(cut - rx0, rx1 - cut) < (rx1 - rx0) * 0.2:
                return None
            left = ink.crop((rx0, ry0, cut, ry1)).getprojection()[1]
            right = ink.crop((cut, ry0, rx1, ry1)).getprojection()[1]
            # Aligned lines may be paired rows at any spacing. Independent
            # paragraphs can share this geometry too; retain the full-page
            # unverified fallback rather than guessing their associations.
            if aligned_multiline_rows(left, right):
                raise RasterLayoutAmbiguous("outside raster notes have ambiguous row/column ownership")
            return cut if len(runs(left, True)) >= 2 and len(runs(right, True)) >= 2 else None

        if depth < 4:
            # Keep each physical column's paragraphs together before considering
            # their internal horizontal whitespace.
            cut = column_cut((x0, y0, x1, y1))
            if cut is not None:
                partition((x0, y0, cut, y1), depth + 1)
                partition((cut, y0, x1, y1), depth + 1)
                return
            gaps = runs(ys, False)
            for gap in gaps:
                # Only a short leading spanning heading may precede columns.
                # Never split two multi-paragraph columns into cross-page rows.
                if len(runs(ys[:gap[0]], True)) > 2:
                    break
                if gap[1] - gap[0] <= max(6, median(span[1] - span[0] for span in gaps) * 1.8):
                    continue
                if column_cut((x0, y0 + gap[1], x1, y1)) is not None:
                    cut = y0 + (gap[0] + gap[1]) // 2
                    partition((x0, y0, x1, cut), depth + 1)
                    partition((x0, cut, x1, y1), depth + 1)
                    return
        # Restore a small source margin around antialiased glyph fringes.
        regions.append((max(bounds[0], x0 - 3), max(bounds[1], y0 - 3),
                        min(bounds[2], x1 + 3), min(bounds[3], y1 + 3)))

    partition(tuple(map(int, bounds)))
    check()
    return regions


def raster_ink_line_count(image, deadline):
    if time.monotonic() >= deadline:
        raise TimeoutError("cell line analysis exhausted page OCR timeout")
    rows = image.convert("L").point(lambda value: 255 if value < 96 else 0).getprojection()[1]
    bands = []
    for index, value in enumerate(rows):
        if index % 32 == 0 and time.monotonic() >= deadline:
            raise TimeoutError("cell line analysis exhausted page OCR timeout")
        if value:
            if bands and index == bands[-1][1]:
                bands[-1][1] = index + 1
            else:
                bands.append([index, index + 1])
    if not bands:
        return 0
    # Dots, accents and raised punctuation can be disconnected within one line.
    small_gap = max(2, median(end - start for start, end in bands) * 0.35)
    return 1 + sum(right[0] - left[1] > small_gap for left, right in zip(bands, bands[1:]))


def maybe_raster_table_ocr(page, image, render_scale, budget, pytesseract, deadline, observations=None):
    """Default-off candidate; preserve full-page fallback on uncertain geometry.

    OCR each physical cell at the existing target and per-render pixel bound.
    All calls share the candidate deadline inside the page OCR budget. No source glyph is rewritten.
    """
    if os.environ.get("PDF_RASTER_TABLE_OCR") != "1" or page.rotation or page.get_text("text").strip():
        return None
    grid_bounds = {}
    rows = raster_ruled_cells(image, deadline=deadline, grid_bounds=grid_bounds)
    if not rows:
        return None
    # Plan both outside areas before launching any cell OCR. Ambiguous note
    # rows retain the existing full-page fallback, never a partial replacement.
    top = min(cell[1] for row in rows for cell in row) / render_scale
    bottom = max(cell[3] for row in rows for cell in row) / render_scale
    try:
        before = raster_prose_regions(
            image, (0, 0, image.width, max(0, grid_bounds["top"])), deadline,
        ) if top > 2 else []
        after = raster_prose_regions(
            image, (0, min(image.height, grid_bounds["bottom"]), image.width, image.height), deadline,
        ) if bottom < page.rect.height - 2 else []
    except RasterLayoutAmbiguous:
        return None
    from PIL import Image
    model_directory = checked_raster_table_model(deadline)
    record = {"version": "raster-table-ocr-observations-v1", "status": "unverified",
              "cellModel": {"language": "Latin", "sha256": "sha256:" + RASTER_TABLE_MODEL_SHA256,
                            "bytes": RASTER_TABLE_MODEL_BYTES},
              "outsideModel": {"language": "eng", "sha256": None, "status": "not_observed"},
              "runtime": observed_raster_runtime(pytesseract, deadline),
              "detector": {"width": image.width, "height": image.height, "scale": render_scale}, "crops": []}

    def read_region(rect, cell=False):
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError("raster cell OCR exhausted page timeout")
        scale = bounded_clip_render_scale(rect, MAX_OCR_RENDER_SCALE, budget.limits["maxRenderPixels"])
        if scale is None:
            raise ValueError("unsafe raster cell geometry")
        if time.monotonic() >= deadline:
            raise TimeoutError("raster cell render exhausted page timeout")
        pixels = page.get_pixmap(matrix=fitz.Matrix(scale, scale), clip=rect, alpha=False)
        if pixels.width * pixels.height > budget.limits["maxRenderPixels"]:
            raise ValueError("raster cell render exceeded pixel limit")
        png = pixels.tobytes("png")
        bitmap = Image.open(io.BytesIO(png))
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError("raster cell OCR exhausted page timeout")
        config = f"--dpi {round(scale * 72)}"
        if cell:
            mode = 7 if raster_ink_line_count(bitmap, deadline) == 1 else 6
            config = f"--psm {mode} --tessdata-dir {shlex.quote(model_directory)} " + config
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError("cell layout exhausted page OCR timeout before launch")
        text = pytesseract.image_to_string(bitmap, lang="Latin" if cell else "eng", config=config, timeout=remaining).strip()
        if time.monotonic() >= deadline:
            raise TimeoutError("raster OCR completed after page deadline")
        if len(record["crops"]) >= 112:
            raise ValueError("raster OCR observation limit")
        record["crops"].append({"kind": "cell" if cell else "outside", "language": "Latin" if cell else "eng",
                                "sourceRect": list(rect), "scale": scale, "width": pixels.width, "height": pixels.height,
                                "pngSha256": "sha256:" + hashlib.sha256(png).hexdigest(),
                                "pixelsSha256": "sha256:" + hashlib.sha256(pixels.samples).hexdigest(),
                                "textSha256": text_sha256(text)})
        if time.monotonic() >= deadline:
            raise TimeoutError("raster crop observation exhausted page deadline")
        return text

    pieces = []
    # Outside prose is retained from non-overlapping source regions; side prose
    # within the grid band was rejected above rather than assigned to a cell.
    for box in before:
        pieces.append(read_region(fitz.Rect(*(coordinate / render_scale for coordinate in box))))
    for row in rows:
        cells = []
        for box in row:
            rect = fitz.Rect(*(coordinate / render_scale for coordinate in box))
            cells.append(" ".join(read_region(rect, cell=True).split()))
        pieces.append(" | ".join(cells))
    for box in after:
        pieces.append(read_region(fitz.Rect(*(coordinate / render_scale for coordinate in box))))
    if observations is not None:
        observations.update(record)
    return "\n".join(piece for piece in pieces if piece)


def maybe_ocr_page(page, budget, raster_observations=None, runtime_identity=None):
    deadline = time.monotonic() + budget.limits["ocrPageTimeoutSeconds"]
    raster_enabled = os.environ.get("PDF_RASTER_TABLE_OCR") == "1"
    if raster_enabled and raster_observations is not None:
        raster_observations.clear()
    if runtime_identity is not None:
        runtime_identity["tesseractVersion"] = None
    # OCR needs the source glyph detail that thumbnail/crop rendering can omit.
    # Keep its larger target separate from other renders and bounded by the
    # caller's existing pixel limit; a 4M budget does not promise 450 DPI.
    render_scale = bounded_render_scale(
        page.rect, MAX_OCR_RENDER_SCALE, budget.limits["maxRenderPixels"],
        max_scale=MAX_OCR_RENDER_SCALE,
    )
    if render_scale is None:
        return "", f"render_skipped: OCR page {page.number + 1} has unsafe geometry"
    # Audit ING-B-06: Tesseract's OpenMP threads busy-wait on a shared CPU until
    # every page hits the timeout. One thread per call is the documented fix and
    # does not change what Tesseract reads; an operator value is kept.
    os.environ.setdefault("OMP_THREAD_LIMIT", "1")
    try:
        import pytesseract
        from PIL import Image

        tesseract_cmd = os.environ.get("TESSERACT_CMD")
        if tesseract_cmd:
            pytesseract.pytesseract.tesseract_cmd = tesseract_cmd
        elif os.name == "nt":
            for candidate in (
                r"C:\Program Files\Tesseract-OCR\tesseract.exe",
                r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe",
            ):
                if os.path.exists(candidate):
                    pytesseract.pytesseract.tesseract_cmd = candidate
                    break

        if runtime_identity is not None:
            command = pytesseract.pytesseract.tesseract_cmd
            remaining = deadline - time.monotonic()
            if remaining > 0:
                runtime_identity["tesseractVersion"] = observed_tesseract_version(
                    shutil.which(command) or command, min(2, remaining)
                )
        if os.environ.get("PDF_RASTER_TABLE_OCR") == "1" and time.monotonic() >= deadline:
            raise TimeoutError("raster OCR exhausted page timeout before rendering")
        pix = page.get_pixmap(
            matrix=fitz.Matrix(render_scale, render_scale), alpha=False
        )
        if pix.width * pix.height > budget.limits["maxRenderPixels"]:
            return "", f"render_skipped: OCR page {page.number + 1} exceeded the rounded pixel limit"
        image = Image.open(io.BytesIO(pix.tobytes("png")))
        candidate_warning = None
        if raster_enabled:
            reserve = min(RASTER_TABLE_FALLBACK_RESERVE_SECONDS, budget.limits["ocrPageTimeoutSeconds"])
            candidate_deadline = deadline - reserve
            if time.monotonic() < candidate_deadline:
                candidate_observations = {}
                try:
                    candidate = maybe_raster_table_ocr(
                        page, image, render_scale, budget, pytesseract, candidate_deadline, candidate_observations,
                    )
                    if time.monotonic() >= candidate_deadline:
                        raise TimeoutError("optional raster OCR completed after its deadline")
                    if candidate is not None:
                        if raster_observations is not None:
                            raster_observations.update(candidate_observations)
                        return candidate, None
                except (RasterTableModelError, ExtractionBudgetExceeded):
                    raise  # Model identity and document-wide limits remain fail-closed.
                except Exception as exc:
                    # Discard every candidate crop/text observation; only the
                    # original full-page render can reach the legacy reader.
                    candidate_warning = f"raster_table_ocr_refused: page {page.number + 1}: {type(exc).__name__}"
        timeout = budget.limits["ocrPageTimeoutSeconds"]
        if os.environ.get("PDF_RASTER_TABLE_OCR") == "1":
            timeout = deadline - time.monotonic()
            if timeout <= 0:
                raise TimeoutError("raster OCR exhausted page timeout before fallback")
        text = pytesseract.image_to_string(
            image, config=f"--dpi {round(render_scale * 72)}", timeout=timeout
        )
        if raster_enabled and time.monotonic() >= deadline:
            raise TimeoutError("full-page OCR completed after page deadline")
        return text, candidate_warning
    except ExtractionBudgetExceeded:
        raise
    except Exception as exc:
        return "", f"OCR failed on page {page.number + 1}: {type(exc).__name__}: {exc}"


def page_image_coverage_ratio(page):
    """Fraction of the page area covered by raster images (clamped to 1.0).

    IDX-H4: dose/threshold tables are frequently rendered as a large image with only a
    short heading/caption of real text. A flat character floor misses those pages, so we
    also use image coverage to decide whether a page is image-dominant.
    """
    page_area = float(page.rect.width) * float(page.rect.height)
    if page_area <= 0:
        return 0.0
    covered = 0.0
    seen = set()
    for image_info in page.get_images(full=True):
        xref = image_info[0]
        if xref in seen:
            continue
        seen.add(xref)
        try:
            if oversized_embedded_image_warning(image_info):
                # ING-B-04: get_image_rects decodes the image. Use the declared
                # placement instead, which reads the page content only.
                bbox = page.get_image_bbox(image_info)
                rects = [] if bbox.is_infinite or bbox.is_empty else [bbox]
            else:
                rects = page.get_image_rects(xref) or []
        except MemoryError:
            raise
        except Exception:
            # One unreadable image must not abort the document; it adds no coverage.
            continue
        for rect in rects:
            covered += abs(float(rect.width) * float(rect.height))
    return min(1.0, covered / page_area)


def should_ocr_page(text, page):
    """Decide whether to OCR a page based on text density vs. image coverage.

    IDX-H4: OCR when the embedded text layer is near-empty (old behaviour) OR when the page
    is image-dominant with low text density even though it clears the old 40-char floor —
    e.g. an image-rendered dose table with a >40-char caption.
    """
    stripped = text.strip()
    if len(stripped) < 40:
        return True
    coverage = page_image_coverage_ratio(page)
    # Low text density for a page that is mostly image -> the real content is in the image.
    if coverage >= 0.45 and len(stripped) < 220:
        return True
    return False


def merge_ocr_text(existing_text, ocr_text):
    """Combine the embedded text layer with OCR output without dropping either (IDX-H4)."""
    existing = (existing_text or "").strip()
    ocr = (ocr_text or "").strip()
    if not ocr:
        return existing_text
    if not existing:
        return ocr_text
    if ocr in existing:
        return existing_text
    return f"{existing_text.rstrip()}\n{ocr}"


def rect_payload(rect):
    return [round(rect.x0, 2), round(rect.y0, 2), round(rect.x1, 2), round(rect.y1, 2)]


def write_pixmap(pix, path, budget):
    image_bytes = pix.tobytes("png")
    budget.add_artifact(len(image_bytes))
    with open(path, "wb") as handle:
        handle.write(image_bytes)
    return {"width": pix.width, "height": pix.height}


def save_cover_page(page, output_dir, budget, warnings):
    """Render page 1 as a compact non-searchable cover thumbnail for search cards."""
    page_rect = page.rect
    if page_rect.is_empty or page_rect.width < 40 or page_rect.height < 40:
        return None

    scale = min(TARGET_COVER_MAX_WIDTH / max(float(page_rect.width), 1.0), MAX_RENDER_SCALE)
    if scale < MIN_USEFUL_RENDER_SCALE:
        warnings.append("render_skipped: cover_page has unsafe geometry")
        return None

    render_scale = bounded_render_scale(page_rect, scale, budget.limits["maxRenderPixels"])
    if render_scale is None:
        warnings.append("render_skipped: cover_page has unsafe geometry")
        return None

    budget.ensure_artifact_slot()
    pix = page.get_pixmap(matrix=fitz.Matrix(render_scale, render_scale), alpha=False)
    if pix.width * pix.height > budget.limits["maxRenderPixels"]:
        warnings.append("render_skipped: cover_page exceeded the rounded pixel limit")
        return None
    if pix.width < 64 or pix.height < 64:
        return None

    image_path = os.path.join(output_dir, "page-1-cover.png")
    dimensions = write_pixmap(pix, image_path, budget)
    return {
        "pageNumber": 1,
        "path": image_path,
        "mimeType": "image/png",
        "bbox": rect_payload(page_rect),
        "width": dimensions["width"],
        "height": dimensions["height"],
        "sourceKind": "cover_page",
        "metadata": {
            "pageNumber": 1,
            "source_kind": "cover_page",
            "candidate_type": "document_cover",
            "bbox": rect_payload(page_rect),
            "page_width": round(float(page_rect.width), 2),
            "page_height": round(float(page_rect.height), 2),
            "page_rotation": int(page.rotation or 0),
            "render_scale": round(render_scale, 3),
            "render_dpi": round(render_scale * 72),
            "clinical_use_class": "decorative_or_empty",
            "source_regions": [
                {
                    "source_kind": "cover_page",
                    "bbox": rect_payload(page_rect),
                    "page_number": 1,
                }
            ],
        },
    }


def save_page_crop(page, rect, output_dir, file_name, source_kind, metadata, budget, warnings):
    page_rect = page.rect
    clipped = rect & page_rect
    if clipped.is_empty:
        return None

    if clipped.width < 80 or clipped.height < 60:
        return None

    render_scale = bounded_render_scale(
        clipped,
        TARGET_CROP_DPI / 72.0,
        budget.limits["maxRenderPixels"],
    )
    if render_scale is None:
        warnings.append(
            f"render_skipped: {source_kind} page {metadata['pageNumber']} has unsafe geometry"
        )
        return None
    budget.ensure_artifact_slot()
    pix = page.get_pixmap(matrix=fitz.Matrix(render_scale, render_scale), clip=clipped, alpha=False)
    if pix.width * pix.height > budget.limits["maxRenderPixels"]:
        warnings.append(
            f"render_skipped: {source_kind} page {metadata['pageNumber']} exceeded the rounded pixel limit"
        )
        return None
    if pix.width < 180 or pix.height < 120:
        return None

    image_path = os.path.join(output_dir, file_name)
    dimensions = write_pixmap(pix, image_path, budget)
    crop_completeness = crop_completeness_score(rect, clipped, page.rect)
    crop_metadata = {
        **metadata,
        "bbox": rect_payload(rect),
        "clip_bbox": rect_payload(clipped),
        "page_width": round(float(page.rect.width), 2),
        "page_height": round(float(page.rect.height), 2),
        "page_rotation": int(page.rotation or 0),
        "render_scale": round(render_scale, 3),
        "render_dpi": round(render_scale * 72),
        "crop_completeness": crop_completeness,
        "crop_touches_page_edge": crop_completeness < 0.99,
        "source_regions": [
            {
                "source_kind": source_kind,
                "bbox": rect_payload(clipped),
                "page_number": metadata["pageNumber"],
            }
        ],
    }
    return {
        "pageNumber": metadata["pageNumber"],
        "path": image_path,
        "mimeType": "image/png",
        "bbox": rect_payload(clipped),
        "width": dimensions["width"],
        "height": dimensions["height"],
        "sourceKind": source_kind,
        "metadata": crop_metadata,
    }


def expanded_rect(rect, page_rect, x_padding=4, y_padding=4):
    return fitz.Rect(
        max(rect.x0 - x_padding, page_rect.x0),
        max(rect.y0 - y_padding, page_rect.y0),
        min(rect.x1 + x_padding, page_rect.x1),
        min(rect.y1 + y_padding, page_rect.y1),
    )


def table_expanded_rect(rect, page_rect):
    return expanded_rect(rect, page_rect, x_padding=10, y_padding=18)


def crop_completeness_score(requested_rect, clipped_rect, page_rect):
    requested_area = max(float(requested_rect.width) * float(requested_rect.height), 1.0)
    clipped_area = max(float(clipped_rect.width) * float(clipped_rect.height), 0.0)
    score = min(1.0, clipped_area / requested_area)
    edge_penalty = 0.0
    tolerance = 1.0
    if abs(clipped_rect.x0 - page_rect.x0) <= tolerance or abs(clipped_rect.x1 - page_rect.x1) <= tolerance:
        edge_penalty += 0.04
    if abs(clipped_rect.y0 - page_rect.y0) <= tolerance or abs(clipped_rect.y1 - page_rect.y1) <= tolerance:
        edge_penalty += 0.04
    return round(max(0.0, score - edge_penalty), 3)

# Max gap between a find_tables bbox edge and continuing cell drawings that
# still belong to the same table. Keeps footers/unrelated blocks from merging in.
TABLE_EDGE_CONTENT_GAP = 24.0


def _rects_overlap_horizontally(a, b, tolerance=2.0):
    return not (a.x1 < b.x0 - tolerance or a.x0 > b.x1 + tolerance)


def _rects_overlap_vertically(a, b, tolerance=2.0):
    return not (a.y1 < b.y0 - tolerance or a.y0 > b.y1 + tolerance)


def page_drawing_rects(page):
    rects = []
    for drawing in page.get_drawings() or []:
        rect = drawing.get("rect")
        if not rect:
            continue
        rect = fitz.Rect(rect) * page.rotation_matrix
        # Ignore hairline page rules / tiny marks.
        if rect.width < 8 or rect.height < 8:
            continue
        rects.append(rect)
    return rects


def extend_table_rect_for_edge_content(page, rect, max_gap=TABLE_EDGE_CONTENT_GAP):
    """Grow a find_tables bbox to keep on-page remnants of straddling table rows/cols.

    `page.find_tables()` often stops at the last fully detected row when the final
    row straddles the page edge. Cell drawings for that remnant still exist on the
    page; fold them into the crop rectangle (clamped to the page). Text blocks are
    intentionally ignored here so titles/footers do not inflate the crop.
    """
    page_rect = page.rect
    content_rects = page_drawing_rects(page)
    x0, y0, x1, y1 = float(rect.x0), float(rect.y0), float(rect.x1), float(rect.y1)
    edges = []
    clipped_by_page = False

    def absorb(axis):
        nonlocal x0, y0, x1, y1, clipped_by_page
        changed = False
        current = fitz.Rect(x0, y0, x1, y1)
        for content in content_rects:
            if axis in ("bottom", "top") and not _rects_overlap_horizontally(current, content):
                continue
            if axis in ("left", "right") and not _rects_overlap_vertically(current, content):
                continue
            if axis == "bottom":
                if content.y1 <= y1 + 0.5 or content.y0 > y1 + max_gap:
                    continue
                if content.y1 > page_rect.y1 + 0.5:
                    clipped_by_page = True
                next_y1 = min(max(y1, float(content.y1)), float(page_rect.y1))
                if next_y1 > y1 + 0.5:
                    y1 = next_y1
                    changed = True
            elif axis == "top":
                if content.y0 >= y0 - 0.5 or content.y1 < y0 - max_gap:
                    continue
                if content.y0 < page_rect.y0 - 0.5:
                    clipped_by_page = True
                next_y0 = max(min(y0, float(content.y0)), float(page_rect.y0))
                if next_y0 < y0 - 0.5:
                    y0 = next_y0
                    changed = True
            elif axis == "right":
                if content.x1 <= x1 + 0.5 or content.x0 > x1 + max_gap:
                    continue
                if content.x1 > page_rect.x1 + 0.5:
                    clipped_by_page = True
                next_x1 = min(max(x1, float(content.x1)), float(page_rect.x1))
                if next_x1 > x1 + 0.5:
                    x1 = next_x1
                    changed = True
            elif axis == "left":
                if content.x0 >= x0 - 0.5 or content.x1 < x0 - max_gap:
                    continue
                if content.x0 < page_rect.x0 - 0.5:
                    clipped_by_page = True
                next_x0 = max(min(x0, float(content.x0)), float(page_rect.x0))
                if next_x0 < x0 - 0.5:
                    x0 = next_x0
                    changed = True
        return changed

    for axis in ("bottom", "top", "right", "left"):
        guard = 0
        while absorb(axis) and guard < 8:
            if axis not in edges:
                edges.append(axis)
            guard += 1

    extended = fitz.Rect(x0, y0, x1, y1) & page_rect
    return extended, {
        "extended": bool(edges),
        "clipped_by_page": clipped_by_page,
        "edges": edges,
    }


def _extract_table_column_ranges(table, column_count=0):
    col_bounds = {}
    try:
        raw_rows = getattr(table, "rows", None) or []
        for row in raw_rows:
            cells = getattr(row, "cells", row)
            if not isinstance(cells, (list, tuple)):
                continue
            for col_idx, cell in enumerate(cells):
                if not cell or len(cell) < 4 or cell[0] is None or cell[2] is None:
                    continue
                try:
                    x0, x1 = float(cell[0]), float(cell[2])
                except (TypeError, ValueError):
                    continue
                if x1 <= x0:
                    continue
                if col_idx not in col_bounds:
                    col_bounds[col_idx] = [x0, x1]
                else:
                    col_bounds[col_idx][0] = min(col_bounds[col_idx][0], x0)
                    col_bounds[col_idx][1] = max(col_bounds[col_idx][1], x1)
        if col_bounds:
            max_col = max(col_bounds.keys())
            total_cols = max(int(column_count or 0), max_col + 1)
            ranges = []
            for idx in range(total_cols):
                if idx in col_bounds:
                    ranges.append((round(col_bounds[idx][0], 2), round(col_bounds[idx][1], 2)))
            if len(ranges) >= 2:
                return ranges
    except Exception:
        pass
    return []


def _extract_page_line_segments(page):
    segments = []
    try:
        text_dict = page.get_text("dict") or {}
        for block in text_dict.get("blocks") or []:
            if block.get("type", 0) != 0:
                continue
            for line in block.get("lines") or []:
                spans = [
                    span
                    for span in (line.get("spans") or [])
                    if clean_cell(span.get("text")) and len(span.get("bbox") or ()) >= 4
                ]
                if not spans:
                    line_bbox = line.get("bbox")
                    line_text = clean_cell(line.get("text"))
                    if line_bbox and len(line_bbox) >= 4 and line_text:
                        segments.append(
                            (
                                float(line_bbox[0]),
                                float(line_bbox[1]),
                                float(line_bbox[2]),
                                float(line_bbox[3]),
                                line_text,
                            )
                        )
                    continue
                spans.sort(key=lambda s: float(s["bbox"][0]))
                cur_x0, cur_y0, cur_x1, cur_y1 = (
                    float(spans[0]["bbox"][0]),
                    float(spans[0]["bbox"][1]),
                    float(spans[0]["bbox"][2]),
                    float(spans[0]["bbox"][3]),
                )
                cur_text = clean_cell(spans[0].get("text"))
                for span in spans[1:]:
                    sx0, sy0, sx1, sy1 = (
                        float(span["bbox"][0]),
                        float(span["bbox"][1]),
                        float(span["bbox"][2]),
                        float(span["bbox"][3]),
                    )
                    stext = clean_cell(span.get("text"))
                    if sx0 - cur_x1 <= 8.0 and abs(sy0 - cur_y0) <= 3.0:
                        cur_x1 = max(cur_x1, sx1)
                        cur_y0 = min(cur_y0, sy0)
                        cur_y1 = max(cur_y1, sy1)
                        cur_text = clean_cell(f"{cur_text} {stext}")
                    else:
                        segments.append((cur_x0, cur_y0, cur_x1, cur_y1, cur_text))
                        cur_x0, cur_y0, cur_x1, cur_y1, cur_text = sx0, sy0, sx1, sy1, stext
                segments.append((cur_x0, cur_y0, cur_x1, cur_y1, cur_text))
    except Exception:
        segments = []
    # Text positions are unrotated; table and drawing rects are in the rotated page space.
    rotation = getattr(page, "rotation_matrix", fitz.Identity)
    rotated = []
    for x0, y0, x1, y1, text in segments:
        rect = fitz.Rect(x0, y0, x1, y1) * rotation
        rotated.append((rect.x0, rect.y0, rect.x1, rect.y1, text))
    return rotated


def _resolve_effective_column_ranges(original_rect, column_count, column_ranges, all_segments):
    if column_ranges and len(column_ranges) >= 2:
        normalized = [
            (float(r[0]), float(r[1]))
            for r in column_ranges
            if isinstance(r, (list, tuple)) and len(r) >= 2 and float(r[1]) > float(r[0])
        ]
        if len(normalized) >= 2:
            return normalized

    col_count = int(column_count or 0)
    if col_count < 2:
        return []

    in_table = [
        seg
        for seg in all_segments
        if seg[1] >= original_rect.y0 - 2.0
        and seg[3] <= original_rect.y1 + 2.0
        and seg[0] >= original_rect.x0 - 6.0
        and seg[2] <= original_rect.x1 + 6.0
    ]
    if in_table:
        in_table.sort(key=lambda s: (s[1], s[0]))
        bands = []
        for seg in in_table:
            if not bands or abs(seg[1] - bands[-1][0][1]) > 3.0:
                bands.append([seg])
            else:
                bands[-1].append(seg)
        matching_bands = [sorted(b, key=lambda s: s[0]) for b in bands if len(b) == col_count]
        if matching_bands:
            starts = [
                min(band[col_idx][0] for band in matching_bands)
                for col_idx in range(col_count)
            ]
            if all(starts[i] < starts[i + 1] - 4.0 for i in range(col_count - 1)):
                inferred = []
                for col_idx in range(col_count):
                    c_x0 = float(original_rect.x0) if col_idx == 0 else max(float(original_rect.x0), starts[col_idx] - 2.0)
                    c_x1 = (
                        float(original_rect.x1)
                        if col_idx == col_count - 1
                        else max(c_x0 + 4.0, starts[col_idx + 1] - 2.0)
                    )
                    inferred.append((c_x0, c_x1))
                return inferred

    total_width = float(original_rect.x1) - float(original_rect.x0)
    if total_width <= 0:
        return []
    step = total_width / col_count
    return [
        (float(original_rect.x0) + idx * step, float(original_rect.x0) + (idx + 1) * step)
        for idx in range(col_count)
    ]


def _match_segment_to_column(sx0, sx1, effective_ranges):
    seg_width = max(0.0, sx1 - sx0)
    overlapping_cols = []
    for col_idx, (cx0, cx1) in enumerate(effective_ranges):
        overlap = min(sx1, cx1) - max(sx0, cx0)
        if overlap > 4.0 or (seg_width <= 4.0 and sx0 >= cx0 - 4.0 and sx1 <= cx1 + 4.0):
            overlapping_cols.append(col_idx)
    if len(overlapping_cols) != 1:
        return None
    col_idx = overlapping_cols[0]
    cx0, cx1 = effective_ranges[col_idx]
    col_width = max(1.0, cx1 - cx0)
    if sx0 < cx0 - 6.0 or sx1 > cx1 + 6.0:
        return None
    if seg_width > col_width * 1.35:
        return None
    return col_idx


def _edge_grid_cells(page, original_rect, extended_rect, column_ranges):
    """Require actual PDF ruling on all four sides; proximity is not row authority."""
    horizontals, verticals = [], []
    rotation = getattr(page, "rotation_matrix", fitz.Identity)
    for drawing in page.get_drawings():
        if drawing.get("type") not in ("s", "fs") or drawing.get("color") is None or drawing.get("stroke_opacity", 1) <= 0:
            continue
        for item in drawing.get("items", []):
            pairs = []
            if item[0] == "l":
                pairs = [(item[1], item[2])]
            elif item[0] == "re":
                r = fitz.Rect(item[1])
                pairs = [(r.tl, r.tr), (r.tr, r.br), (r.br, r.bl), (r.bl, r.tl)]
            for a, b in pairs:
                a, b = a * rotation, b * rotation
                if abs(a.y - b.y) <= 1:
                    horizontals.append((min(a.x,b.x), max(a.x,b.x), (a.y+b.y)/2))
                elif abs(a.x - b.x) <= 1:
                    verticals.append(((a.x+b.x)/2, min(a.y,b.y), max(a.y,b.y)))
    cells = []
    for col, (left, right) in enumerate(column_ranges):
        ys = sorted(set(round(y, 2) for x0, x1, y in horizontals
            if x0 <= left + 1 and x1 >= right - 1
            and extended_rect.y0 - 1 <= y <= extended_rect.y1 + 1))
        for top, bottom in zip(ys, ys[1:]):
            if bottom <= top + 2:
                continue
            if all(any(abs(x-edge) <= 1 and y0 <= top+1 and y1 >= bottom-1
                       for x,y0,y1 in verticals) for edge in (left,right)):
                cells.append((col, left, top, right, bottom))
    return cells


def _recover_table_rows_split(page, original_rect, extended_rect, existing_rows, column_count=0,
                              column_ranges=None, unassigned_segments=None):
    """Recover ruled edge cells; retain ambiguous edge text separately, never infer a clinical row."""
    all_segments = _extract_page_line_segments(page)
    ranges = _resolve_effective_column_ranges(original_rect, column_count, column_ranges, all_segments)
    if len(ranges) < 2:
        return [], []
    cells = _edge_grid_cells(page, original_rect, extended_rect, ranges)
    grouped = {}
    for x0,y0,x1,y1,text in sorted(all_segments, key=lambda seg: (seg[1],seg[0])):
        rect = fitz.Rect(x0,y0,x1,y1)
        if (extended_rect & rect).is_empty or x0 < original_rect.x0-8 or x1 > original_rect.x1+8:
            continue
        side = "bottom" if y1 > original_rect.y1+0.5 and y0 >= original_rect.y1-2 else (
            "top" if y0 < original_rect.y0-0.5 and y1 <= original_rect.y0+2 else None)
        if side is None:
            continue
        matches = [(col,top,bottom) for col,left,top,right,bottom in cells
                   if x0 >= left-0.5 and x1 <= right+0.5 and y0 >= top-0.5 and y1 <= bottom+0.5]
        if len(matches) != 1:
            if unassigned_segments is not None:
                unassigned_segments.append({"text": clean_cell(text), "bbox": rect_payload(rect), "edge": side})
            continue
        col,top,bottom = matches[0]
        key = (side,top,bottom)
        row = grouped.setdefault(key, [""] * len(ranges))
        row[col] = clean_cell(f"{row[col]} {text}")
    existing = {tuple(clean_cell(c) for c in row) for row in existing_rows or []}
    top_rows, bottom_rows = [], []
    for (side,top,bottom), row in sorted(grouped.items(), key=lambda item: item[0][1]):
        if tuple(row) in existing:
            continue
        # A genuine ruled row may contain an empty or staggered cell.
        (top_rows if side == "top" else bottom_rows).append(row)
    return top_rows, bottom_rows


def recover_table_rows_from_edge_strip(
    page,
    original_rect,
    extended_rect,
    existing_rows,
    column_count=0,
    column_ranges=None,
):
    """Recover structured rows from text that continues past a truncated find_tables bbox."""
    top_rows, bottom_rows = _recover_table_rows_split(
        page,
        original_rect,
        extended_rect,
        existing_rows,
        column_count=column_count,
        column_ranges=column_ranges,
    )
    return top_rows + bottom_rows


def rect_intersection_ratio(a, b):
    intersection = a & b
    if intersection.is_empty:
        return 0
    intersection_area = intersection.width * intersection.height
    smaller_area = max(min(a.width * a.height, b.width * b.height), 1)
    return intersection_area / smaller_area


def merge_rects(rects, page_rect):
    if not rects:
        return None
    x0 = max(min(rect.x0 for rect in rects) - 12, page_rect.x0)
    y0 = max(min(rect.y0 for rect in rects) - 12, page_rect.y0)
    x1 = min(max(rect.x1 for rect in rects) + 12, page_rect.x1)
    y1 = min(max(rect.y1 for rect in rects) + 12, page_rect.y1)
    return fitz.Rect(x0, y0, x1, y1)


def clean_cell(value):
    return re.sub(r"\s+", " ", str(value or "")).strip()


def table_rows_to_markdown(rows):
    cleaned = [[clean_cell(cell) for cell in row] for row in rows if any(clean_cell(cell) for cell in row)]
    if not cleaned:
        return ""

    column_count = max(len(row) for row in cleaned)
    padded = [row + [""] * (column_count - len(row)) for row in cleaned]
    header = padded[0]
    separator = ["---"] * column_count
    body = padded[1:]

    def markdown_row(row):
        escaped = [cell.replace("|", "\\|") for cell in row]
        return "| " + " | ".join(escaped) + " |"

    return "\n".join([markdown_row(header), markdown_row(separator), *[markdown_row(row) for row in body]])


def table_columns_from_rows(rows):
    cleaned = [[clean_cell(cell) for cell in row] for row in rows if any(clean_cell(cell) for cell in row)]
    if not cleaned:
        return []
    return cleaned[0]


def text_grid_rows(text):
    rows = []
    for line in (text or "").splitlines():
        cleaned = re.sub(r"\s+", " ", line).strip()
        if not cleaned:
            continue
        cells = [clean_cell(cell) for cell in re.split(r"\s{2,}|\t|\|", line) if clean_cell(cell)]
        rows.append(cells if len(cells) > 1 else [cleaned])
    return rows


def extract_table_payload(table):
    try:
        rows = table.extract()
        cleaned = []
        merged_cells = []
        for row in rows:
            if not any(clean_cell(cell) for cell in row):
                continue
            # PyMuPDF returns None (not "") for a cell covered by a merged span, so
            # these coordinates are confirmed merge provenance, not merely blank cells.
            merged_cells.extend([len(cleaned), column] for column, cell in enumerate(row) if cell is None)
            cleaned.append([clean_cell(cell) for cell in row])
        column_count = max((len(row) for row in cleaned), default=0)
        column_ranges = _extract_table_column_ranges(table, column_count)
        return {
            "text": table_rows_to_markdown(rows),
            "rows": cleaned[:MAX_TABLE_ROWS],
            "merged_cells": [cell for cell in merged_cells if cell[0] < MAX_TABLE_ROWS],
            "columns": table_columns_from_rows(rows)[:24],
            "accessible_markdown": table_rows_to_markdown(rows),
            "row_count": len(cleaned),
            "rows_truncated": len(cleaned) > MAX_TABLE_ROWS,
            "column_count": column_count,
            "repeated_populated_geometry": repeated_populated_table_geometry(rows, getattr(table, "rows", [])),
            "column_ranges": column_ranges,
        }
    except Exception:
        return {
            "text": "",
            "rows": [],
            "merged_cells": [],
            "columns": [],
            "accessible_markdown": "",
            "row_count": 0,
            "rows_truncated": False,
            "column_count": 0,
            "repeated_populated_geometry": False,
            "column_ranges": [],
        }


def extract_table_text(table):
    return extract_table_payload(table)["text"]


def split_table_heading(text):
    cleaned = re.sub(r"\s+", " ", text or "").strip(" :-\u2013\u2014")
    if not cleaned:
        return None, None

    # Caption labels start their text block; inline cross-references are not headings.
    patterns = (
        r"(?i)^(table\s+[a-z]?\d+(?:\.\d+)*[a-z]?)\b\s*[:.\-\u2013\u2014]?\s*(.+)",
        r"(?i)^(appendix\s+\d+[a-z]?)\b\s*[:.\-\u2013\u2014]?\s*(.+)",
    )
    for pattern in patterns:
        match = re.search(pattern, cleaned)
        if match:
            label = re.sub(r"\s+", " ", match.group(1)).title()
            title = re.sub(r"\s+", " ", match.group(2)).strip(" :-\u2013\u2014")
            return label, title[:240] if title else None

    section_match = re.search(r"(?i)(?:^|\s)\d+\.?\s+(roles and responsibilities)\b", cleaned)
    if section_match:
        return None, section_match.group(1).title()

    if re.fullmatch(r"(?i)roles and responsibilities", cleaned):
        return None, "Roles and responsibilities"

    known_section_headings = (
        "recommended pharmacological treatment options",
        "*maximum dose refers to total maximum oral and im dose (including regular)",
    )
    if cleaned.lower() in known_section_headings:
        return None, cleaned[:180]

    return None, None


def nearby_table_heading(page, rect, table_text):
    blocks = sorted(page.get_text("blocks") or [], key=lambda block: (block[1], block[0]))
    candidates = []
    for block in blocks:
        if len(block) < 5:
            continue
        x0, y0, x1, y1 = fitz.Rect(block[:4]) * getattr(page, "rotation_matrix", fitz.Identity)
        text = block[4]
        if y1 > rect.y0 + 16 or y1 < rect.y0 - 140:
            continue
        if x1 < rect.x0 - 40 or x0 > rect.x1 + 40:
            continue
        cleaned = re.sub(r"\s+", " ", str(text)).strip()
        if cleaned:
            candidates.append(cleaned)

    for candidate in reversed(candidates):
        label, title = split_table_heading(candidate)
        if label or title:
            return label, title, candidate

    lowered_table = table_text.lower()
    if "role" in lowered_table and "responsibility" in lowered_table:
        return None, "Roles and responsibilities", "Roles and responsibilities"
    return None, None, ""


def clinical_table_score(text):
    lowered = text.lower()
    score = 0
    keywords = (
        "management",
        "monitor",
        "observation",
        "medication",
        "dose",
        "benzodiazepine",
        "antipsychotic",
        "intramuscular",
        "oral",
        "risk",
        "escalat",
        "responsibil",
        "patient",
        "score",
        "frequency",
        "post im",
        "post po",
        "appendix",
        "table",
    )
    for keyword in keywords:
        if keyword in lowered:
            score += 1
    return score


def table_text_metrics(table_text):
    text = table_text or ""
    lines = [line for line in text.splitlines() if line.strip()]
    return {
        "bars": text.count("|"),
        "line_count": len(lines),
        "clinical_score": clinical_table_score(text),
    }


def table_role_for_candidate(label, title, table_text):
    combined = " ".join([label or "", title or "", table_text or ""]).lower()
    clinical_markers = (
        "management",
        "monitor",
        "observation",
        "medication",
        "dose",
        "benzodiazepine",
        "antipsychotic",
        "intramuscular",
        "oral",
        "risk",
        "escalat",
        "patient",
        "score",
        "frequency",
        "post im",
        "post po",
        "treatment",
        "assessment",
        "side effect",
        "contraindicat",
        "responsibil",
    )
    admin_markers = (
        "authorisation date",
        "published date",
        "version control",
        "document owner",
        "approval",
        "endorsed",
        "review date",
        "contact person",
        "policy sponsor",
        "compliance monitoring",
        "amendment",
        "amended",
        "revision",
        "reviewed",
        "superseded",
        "section 4.0",
        "section 13",
    )
    reference_markers = (
        "references",
        "relevant standards",
        "documents support",
        "bibliography",
        "legislation",
        "associated documents",
    )

    if title and title.lower() == "roles and responsibilities":
        return "clinical"
    if any(marker in combined for marker in reference_markers):
        return "reference"
    if any(marker in combined for marker in admin_markers):
        return "admin"
    if any(marker in combined for marker in clinical_markers):
        return "clinical"
    if label and label.lower().startswith(("table", "appendix")):
        return "unclear"
    return "unclear"


def table_candidate_confidence(label, title, table_text, row_count=0, column_count=0):
    metrics = table_text_metrics(table_text)
    confidence = 0.2
    if label:
        confidence += 0.18
    if title:
        confidence += 0.14
    if row_count >= 2:
        confidence += 0.16
    if row_count >= 4:
        confidence += 0.1
    if column_count >= 2:
        confidence += 0.16
    if column_count >= 3:
        confidence += 0.08
    if metrics["bars"] >= 8:
        confidence += 0.12
    if metrics["line_count"] >= 3:
        confidence += 0.08
    if metrics["clinical_score"] >= 3:
        confidence += 0.08
    return round(min(confidence, 0.99), 2)


def repeated_populated_table_geometry(rows, source_rows):
    """Count occupied row bands using observed cells, including vertical spans."""
    cells = set()
    for values, source_row in zip(rows, source_rows):
        for value, box in zip(values, source_row.cells):
            if box is not None and clean_cell(value):
                rect = fitz.Rect(box)
                if rect.width > 0 and rect.height > 0:
                    cells.add(tuple(rect))
    boundaries = sorted({edge for box in cells for edge in (box[1], box[3])})
    populated_bands = 0
    for top, bottom in zip(boundaries, boundaries[1:]):
        middle = (top + bottom) / 2
        occupied = sorted((box for box in cells if box[1] <= middle < box[3]), key=lambda box: box[0])
        # Distinct cells must occupy separate columns; overlapping boxes do not
        # establish extra columns or duplicate a shared spanning cell's text.
        if any(left[2] <= right[0] + 0.5 for left, right in zip(occupied, occupied[1:])):
            populated_bands += 1
    return populated_bands >= 2


def real_table_candidate(label, title, table_text, row_count=0, column_count=0, rows=None, repeated_geometry=False):
    # A poster's frame can produce a nominal grid with nearly every cell empty.
    # Repeated populated columns establish a matrix; generated Markdown bars do not.
    if not repeated_geometry and sum(sum(bool(str(cell or "").strip()) for cell in row) >= 2 for row in rows or []) < 2:
        return False
    metrics = table_text_metrics(table_text)
    combined = " ".join([label or "", title or "", table_text or ""]).lower()
    known_table_heading = bool(label) or (title or "").lower() in (
        "roles and responsibilities",
        "recommended pharmacological treatment options",
    )

    if known_table_heading and metrics["line_count"] >= 2:
        return True
    if row_count >= 2 and column_count >= 2 and metrics["line_count"] >= 2:
        return True
    if metrics["bars"] >= 6 and metrics["line_count"] >= 3:
        return True
    if "role" in combined and "responsibility" in combined and metrics["line_count"] >= 3:
        return True
    if any(marker in combined for marker in ("version control", "authorisation date", "published date")):
        return metrics["line_count"] >= 3
    return False


def likely_table_candidates(page, rejected_rects=None):
    candidates = []
    try:
        tables = page.find_tables()
        for index, table in enumerate(tables.tables):
            rect = fitz.Rect(table.bbox)
            payload = extract_table_payload(table)
            table_text = payload["text"]
            label, title, heading_text = nearby_table_heading(page, rect, table_text)
            row_count = payload["row_count"]
            column_count = payload["column_count"]
            if not real_table_candidate(
                label, title, table_text, row_count, column_count, payload.get("rows"),
                payload.get("repeated_populated_geometry", False),
            ):
                if rejected_rects is not None:
                    rejected_rects.append(rect)
                continue
            role = table_role_for_candidate(label, title, table_text)
            candidates.append(
                {
                    "rect": rect,
                    "table_text": table_text,
                    "table_label": label,
                    "table_title": title,
                    "table_role": role,
                    "table_confidence": table_candidate_confidence(label, title, table_text, row_count, column_count),
                    "table_rows": payload.get("rows", []),
                    "table_merged_cells": payload.get("merged_cells", []),
                    "table_columns": payload.get("columns", []),
                    "accessible_table_markdown": payload.get("accessible_markdown") or table_text,
                    "row_count": row_count,
                    "column_count": column_count,
                    "column_ranges": payload.get("column_ranges", []),
                    "heading_text": heading_text,
                    "extraction_method": "pymupdf_find_tables",
                    "table_index": index + 1,
                }
            )
    except Exception:
        pass

    return candidates


def fallback_table_candidates(page, existing_rects):
    blocks = sorted(page.get_text("blocks") or [], key=lambda block: (block[1], block[0]))
    text_blocks = []
    for block in blocks:
        if len(block) < 5:
            continue
        rect = fitz.Rect(block[:4]) * getattr(page, "rotation_matrix", fitz.Identity)
        raw_text = str(block[4])
        # Only original delimited lines establish fallback rows. Flattening a
        # multiline card joins its label and details, and can merge nearby cards
        # into a false row even though no table was present in the source.
        rows = text_grid_rows(raw_text)
        if not rows or any(sum(bool(re.search(r"[^\W_]", cell)) for cell in row) < 2 for row in rows):
            continue
        # Outline/list labels are not a substantive column. PDF blocks can put
        # only a paragraph's first line beside its label; promoting that fragment
        # would silently omit its continuation and invent a table header.
        if any(
            re.fullmatch(r"(?:[A-Za-z]\.|\d+\.(?:\d+(?:\.\d+)*)?\.?)", row[0])
            and any(re.search(r"[^\W\d_]", cell) for cell in row[1:])
            and "|" not in source_line
            for row, source_line in zip(rows, (line for line in raw_text.splitlines() if line.strip()))
        ):
            continue
        text = raw_text.strip()
        if not text or rect.height < 10:
            continue
        text_blocks.append((rect, text, raw_text))

    candidates = []
    active = []
    for rect, text, raw_text in text_blocks:
        score = clinical_table_score(text)
        has_columns = raw_text.count("  ") >= 2 or "\t" in raw_text or "|" in raw_text
        table_role = table_role_for_candidate(None, None, text)
        if score >= 2 or has_columns or table_role in ("admin", "reference"):
            active.append((rect, text))
            continue

        if active:
            candidates.extend(active)
            active = []
    if active:
        candidates.extend(active)

    if not candidates:
        return []

    rects = [rect for rect, _ in candidates]
    region = merge_rects(rects, page.rect)
    text = "\n".join(text for _, text in candidates)
    if not region:
        return []
    if any(rect_intersection_ratio(region, existing) > 0.45 for existing in existing_rects):
        return []

    label, title, heading_text = nearby_table_heading(page, region, text)
    inferred_columns = max((len(re.split(r"\s{2,}|\t|\|", line.strip())) for line in text.splitlines() if line.strip()), default=0)
    inferred_rows = len([line for line in text.splitlines() if line.strip()])
    rows = text_grid_rows(text)
    role = table_role_for_candidate(label, title, text)
    if not real_table_candidate(label, title, text, inferred_rows, inferred_columns, rows):
        return []
    return [
        {
            "rect": region,
            "table_text": text[:MAX_TABLE_TEXT_CHARS],
            "table_label": label,
            "table_title": title,
            "table_role": role,
            "table_confidence": table_candidate_confidence(label, title, text, inferred_rows, inferred_columns),
            "table_rows": rows[:MAX_TABLE_ROWS],
            "table_columns": (rows[0] if rows else [])[:24],
            "accessible_table_markdown": table_rows_to_markdown(rows) if rows and max((len(row) for row in rows), default=0) > 1 else text[:MAX_TABLE_TEXT_CHARS],
            "row_count": inferred_rows,
            "rows_truncated": len(rows) > MAX_TABLE_ROWS or len(text) > MAX_TABLE_TEXT_CHARS,
            "column_count": inferred_columns,
            "heading_text": heading_text,
            "extraction_method": "text_grid_heuristic",
            "table_index": len(existing_rects) + 1,
        }
    ]


def merge_related_table_candidates(candidates, page_rect):
    if len(candidates) < 2:
        return candidates

    merged = []
    used = set()
    for index, candidate in enumerate(candidates):
        if index in used:
            continue

        label = (candidate.get("table_label") or "").lower()
        if not label.startswith("appendix"):
            merged.append(candidate)
            continue

        group = [candidate]
        for other_index, other in enumerate(candidates):
            if other_index == index or other_index in used:
                continue
            title = (other.get("table_title") or "").lower()
            text = (other.get("table_text") or "").lower()
            vertical_gap = other["rect"].y0 - candidate["rect"].y1
            if other["rect"].y0 >= candidate["rect"].y0 and vertical_gap < 160 and (
                "recommended pharmacological treatment options" in title
                or "maximum dose" in title
                or "intramuscular" in text
                or "benzodiazepine" in text
            ):
                group.append(other)
                used.add(other_index)

        if len(group) > 1:
            rect = merge_rects([item["rect"] for item in group], page_rect)
            merged_text = "\n\n".join(item.get("table_text") or "" for item in group).strip()
            merged_rows = []
            merged_cells = []
            for item in group:
                offset = len(merged_rows)
                merged_cells.extend([row + offset, column] for row, column in item.get("table_merged_cells") or [])
                merged_rows.extend(item.get("table_rows") or [])
            candidate = {
                **candidate,
                "rect": rect,
                "table_text": merged_text,
                "table_role": table_role_for_candidate(
                    candidate.get("table_label"),
                    candidate.get("table_title"),
                    merged_text,
                ),
                "table_confidence": max(item.get("table_confidence") or 0 for item in group),
                "table_rows": merged_rows[:MAX_TABLE_ROWS],
                "table_merged_cells": [cell for cell in merged_cells if cell[0] < MAX_TABLE_ROWS],
                "table_columns": (merged_rows[0] if merged_rows else candidate.get("table_columns") or [])[:24],
                "accessible_table_markdown": table_rows_to_markdown(merged_rows) if merged_rows else merged_text,
                "row_count": sum(item.get("row_count") or 0 for item in group),
                "rows_truncated": len(merged_rows) > MAX_TABLE_ROWS
                or any(item.get("rows_truncated") for item in group),
                "column_count": max(item.get("column_count") or 0 for item in group),
                "extraction_method": "merged_appendix_tables",
            }
        merged.append(candidate)
        used.add(index)

    return merged


def likely_vector_region(page):
    drawings = page.get_drawings()
    rects = []
    for drawing in drawings:
        rect = drawing.get("rect")
        if not rect:
            continue
        if rect.width < 40 or rect.height < 20:
            continue
        rects.append(fitz.Rect(rect) * page.rotation_matrix)

    if len(rects) < 4:
        return None

    region = merge_rects(rects, page.rect)
    if not region:
        return None

    page_area = page.rect.width * page.rect.height
    region_area = region.width * region.height
    if region_area < page_area * 0.06 or region_area > page_area * 0.82:
        return None
    return region


def page_visual_weight(page):
    drawing_count = len(page.get_drawings())
    image_count = len(page.get_images(full=True))
    text_blocks = page.get_text("blocks") or []
    block_heights = [abs(block[3] - block[1]) for block in text_blocks if len(block) >= 4]
    tall_blocks = sum(1 for height in block_heights if height > 70)
    median_block_height = median(block_heights) if block_heights else 0
    return drawing_count + image_count * 4 + tall_blocks + (2 if median_block_height > 40 else 0)


def fallback_visual_region(page, image_coverage=0.0, ocr_used=False):
    if page_visual_weight(page) < 8 and image_coverage < 0.35 and not ocr_used:
        return None

    text = (page.get_text("text", sort=True) or "").lower()
    admin_markers = (
        "authorisation",
        "published date",
        "document owner",
        "version control",
        "relevant standards",
        "references",
        "compliance monitoring",
    )
    high_value_markers = (
        "dose",
        "intramuscular",
        "benzodiazepine",
        "antipsychotic",
        "lorazepam",
        "olanzapine",
        "score",
        "observation",
        "post im",
        "post po",
    )
    if any(marker in text for marker in ("relevant standards", "references", "document owner", "compliance monitoring")):
        return None
    if any(marker in text for marker in admin_markers) and not any(marker in text for marker in high_value_markers):
        return None
    if ("version control" in text or "authorisation date" in text) and "recommended pharmacological treatment options" not in text:
        return None

    top_margin = page.rect.height * 0.08
    bottom_margin = page.rect.height * 0.08
    return fitz.Rect(
        page.rect.x0 + page.rect.width * 0.04,
        page.rect.y0 + top_margin,
        page.rect.x1 - page.rect.width * 0.04,
        page.rect.y1 - bottom_margin,
    )


# If table-aware assembly drops more than this share of the page's characters,
# detection is assumed to have misfired and the raw reading-order text is kept.
TABLE_TEXT_MIN_RETENTION_RATIO = 0.6


def _rect_area(rect):
    return max(0.0, rect.x1 - rect.x0) * max(0.0, rect.y1 - rect.y0)


def _dense_length(value):
    return len(re.sub(r"\s+", "", value or ""))


def _intact_display_text_pieces(page, exclude_rects=None):
    """Keep native lines intact, using displayed geometry only for text assembly.

    Native text boxes are unrotated, whereas find_tables() boxes describe the
    displayed page. Cropping retains its existing coordinates outside this helper.
    A native block can itself contain adjacent cards: split disjoint horizontal
    line groups so each card's label and details stay together after rotation.
    """
    pieces = []
    needs_layout = bool(page.rotation)
    text_flags = fitz.TEXTFLAGS_DICT & ~fitz.TEXT_PRESERVE_IMAGES
    for block in (page.get_text("dict", flags=text_flags) or {}).get("blocks", []):
        lines = []
        for line in block.get("lines", []):
            text = "".join(span.get("text", "") for span in line.get("spans", [])).strip()
            if not text:
                continue
            rect = fitz.Rect(line["bbox"]) * page.rotation_matrix
            # Only completely contained lines are represented by table markdown.
            # A crossing instruction may extend beyond the structured cell text.
            if any(table_rect.contains(rect) for table_rect in exclude_rects or []):
                continue
            lines.append((rect, text))
            direction = line.get("dir", (1, 0))
            needs_layout = needs_layout or abs(direction[0] - 1) > 0.001 or abs(direction[1]) > 0.001
        # Connected x intervals split side-by-side cards, without joining words
        # or lines across native blocks or inventing paragraph-wide row bands.
        groups = []
        for index in sorted(range(len(lines)), key=lambda item: lines[item][0].x0):
            rect = lines[index][0]
            if groups and rect.x0 < groups[-1][0].x1:
                groups[-1][0] |= rect
                groups[-1][1].append(index)
            else:
                groups.append([fitz.Rect(rect), [index]])
        needs_layout = needs_layout or len(groups) > 1
        for rect, indices in groups:
            pieces.append((rect, "\n".join(lines[index][1] for index in sorted(indices))))
    for index, (rect, _) in enumerate(pieces):
        if any(
            min(rect.y1, other.y1) > max(rect.y0, other.y0)
            and (rect.x1 <= other.x0 or other.x1 <= rect.x0)
            for other, _ in pieces[index + 1:]
        ):
            needs_layout = True
            break
    return pieces, needs_layout


def table_aware_page_text(page, grid_candidates, raw_text=None):
    """Assemble page text with detected table grids rendered cell by cell.

    `page.get_text("text", sort=True)` orders text LINES by (y, x). When a table
    cell wraps onto several lines that reads straight across the columns, so a
    figure in column one lands mid-sentence in column three. A real WA clozapine
    table extracted this way reads "Stop clozapine. Contact WBC < 1.5 x 10 9/L",
    which binds the threshold to "Contact" instead of to "Neutropenia" and makes
    the passage unusable as evidence for a threshold claim -- the cause of the
    clozapine answer-quality failures investigated on 2026-09-16.

    find_tables() already recovers those cells intact and the result is already
    computed for table candidates, so table regions are replaced by that grid
    rendering while surrounding prose keeps its normal reading order. Rotated
    cards and overlapping callouts retain native line groups, rather than the
    cross-block word reconstruction that can fuse unrelated text.
    """
    raw = raw_text if raw_text is not None else (page.get_text("text", sort=True) or "")
    usable = [
        candidate
        for candidate in grid_candidates or []
        if candidate.get("extraction_method") == "pymupdf_find_tables"
        and (candidate.get("accessible_table_markdown") or "").strip()
    ]
    # Non-grid heuristic candidates still have no cell structure to rewrite.
    if not usable and grid_candidates:
        return raw

    try:
        table_rects = [fitz.Rect(candidate["rect"]) for candidate in usable]
        text_pieces, needs_layout = _intact_display_text_pieces(page, exclude_rects=table_rects)
        if not usable and not needs_layout:
            return raw
        pieces = [(rect.y0,rect.x0,body) for rect,body in text_pieces]
        for candidate, table_rect in zip(usable, table_rects):
            markdown = (candidate.get("accessible_table_markdown") or "").strip()
            if markdown:
                pieces.append((table_rect.y0, table_rect.x0, markdown))
        pieces.sort(key=lambda piece: (piece[0], piece[1]))
        rebuilt = "\n".join(piece[2] for piece in pieces if piece[2]).strip()
    except Exception:
        return raw

    if not rebuilt:
        return raw
    # Never trade a populated page for a sparse one. A misdetected grid that
    # swallows prose is a worse failure than the interleaving fixed here.
    raw_dense = _dense_length(raw)
    if raw_dense and _dense_length(rebuilt) < TABLE_TEXT_MIN_RETENTION_RATIO * raw_dense:
        return raw
    return rebuilt


class PdfUnreadable(Exception):
    """The upload cannot be read at all; the message is shown as the ingestion failure reason."""


def open_pdf_for_extraction(pdf_path):
    """Open a PDF, refusing locked, damaged, empty or mislabelled files with a plain reason.

    Before this (audit F18) such files failed mid-extraction with whatever PyMuPDF raised. A PDF
    that only restricts editing opens with an empty user password, so it is still extracted.
    """
    try:
        document = fitz.open(pdf_path, filetype="pdf")
    except Exception as exc:  # PyMuPDF raises several types for empty, truncated and non-PDF input
        raise PdfUnreadable(f"PDF could not be opened (it may be damaged, truncated or not a PDF): {exc}") from exc
    if document.needs_pass and not document.authenticate(""):
        document.close()
        raise PdfUnreadable("PDF is password-protected. Upload an unlocked copy.")
    if document.page_count == 0:
        document.close()
        raise PdfUnreadable("PDF could not be opened: it has no pages.")
    return document


def extract(pdf_path, output_dir, budget=None):
    budget = budget or ExtractionBudget()
    os.makedirs(output_dir, exist_ok=True)
    document = open_pdf_for_extraction(pdf_path)
    try:
        identity = {
            "sourceContentSha256": file_sha256(pdf_path),
            "producer": {
                "contractVersion": "pdf-native-page-source-v1",
                "route": "python_pdf",
                "scriptSha256": file_sha256(__file__),
                "pythonVersion": sys.version.split()[0] or None,
                "pymupdfVersion": str(getattr(fitz, "VersionBind", "") or getattr(fitz, "__version__", "")) or None,
                "mupdfVersion": str(getattr(fitz, "VersionFitz", "") or "") or None,
            },
        }
        return _extract_document(document, output_dir, budget, identity)
    finally:
        document.close()


def file_sha256(file_path):
    digest = hashlib.sha256()
    with open(file_path, "rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return "sha256:" + digest.hexdigest()


SURROGATE_PATTERN = re.compile("[\ud800-\udfff]")


def text_sha256(text):
    """Hash text exactly as the TypeScript side hashes the JSON-decoded string.

    Node hashes a JS string as UTF-8, replacing each unpaired surrogate with U+FFFD, and
    JSON decoding joins an escaped high/low surrogate pair into one character. Round-trip
    through UTF-16 so a Python string carrying surrogates hashes to the same bytes instead
    of raising UnicodeEncodeError. Ordinary text is unchanged by the round trip.
    """
    if SURROGATE_PATTERN.search(text):
        text = text.encode("utf-16-le", "surrogatepass").decode("utf-16-le", "replace")
    return "sha256:" + hashlib.sha256(text.encode("utf-8")).hexdigest()


def page_source_provenance(geometry, page_number, native_text, text, ocr_used, needs_ocr, identity, ocr_runtime=None):
    """Per-page source observations checked by src/lib/extractors/pdf-source-provenance.ts.

    Metadata only: it records hashes of the final page text and never alters that text.
    """
    ocr_unverified = ocr_used or needs_ocr
    reasons = []
    if geometry["rotation"] != 0 or geometry["cropBox"] != geometry["mediaBox"]:
        reasons.append("pdf_geometry_transform_unverified")
    if ocr_unverified:
        reasons.append("pdf_ocr_unverified")
    producer = {**identity["producer"], **(ocr_runtime or {})}
    if any(producer.get(key) is None for key in ("pythonVersion", "pymupdfVersion", "mupdfVersion")) or (
        "tesseractVersion" in producer and producer["tesseractVersion"] is None
    ):
        reasons.append("pdf_runtime_identity_unknown")
    text_hash = text_sha256(text)
    return {
        "version": "extracted-page-source-v1",
        "format": "pdf",
        "coordinateSpace": "pymupdf_observed_page_points",
        "physicalPageNumber": page_number,
        **identity,
        "producer": producer,
        "pageGeometry": geometry,
        "nativeTextSha256": text_sha256(native_text),
        "structuralDisposition": "unverified" if reasons else "retained",
        "reasonCodes": reasons,
        "ocr": {
            "status": "unverified" if ocr_unverified else "not_requested",
            "confidence": None,
            "confidenceStatus": "unavailable",
            "textToPageMapping": "not_established",
            "comparison": "not_compared" if ocr_unverified else "not_applicable",
        },
        "textMapping": {"status": "not_established", "offsets": None},
        "textIdentity": {
            "originalExtractedTextSha256": text_hash,
            "persistedTextSha256": text_hash,
            "normalizationApplied": False,
            "metadataNormalizationApplied": False,
            "qualification": "UTF-8 extracted/persisted text bytes; not original PDF spans",
        },
    }


def _extract_document(document, output_dir, budget, identity):
    pages = []
    images = []
    warnings = []
    budget.set_page_count(document.page_count)

    for page_index, page in enumerate(document):
        page_number = page_index + 1
        # Some reader helpers temporarily alter the page crop; retain the source
        # observations before table detection or crop rendering can touch them.
        source_geometry = {
            "pageRect": list(page.rect),
            "cropBox": list(page.cropbox),
            "mediaBox": list(page.mediabox),
            "rotation": page.rotation,
        }
        # Detect grid tables BEFORE assembling page text: the same candidates feed
        # the table-aware text assembly and the table-candidate pass below, so
        # find_tables() runs once per page rather than twice.
        rejected_table_rects = []
        grid_table_candidates = likely_table_candidates(page, rejected_table_rects)
        # The OCR-density decision stays on the RAW embedded text. should_ocr_page
        # has hard character thresholds (40, and 220 on image-dominant pages), so
        # feeding it table-aware text would let markdown syntax -- pipes and the
        # separator row -- move a page across a threshold and change whether a
        # scanned page is OCR'd at all. That is an unrelated side effect of a
        # chunking fix, in either direction: measured on synthetic image-dominant
        # grids the rebuilt text is SHORTER and triggers needless OCR, and on
        # wider grids it can be longer and skip OCR that the page needs. Raw text
        # in, table-aware text out.
        raw_page_text = page.get_text("text", sort=True) or ""
        text = table_aware_page_text(page, grid_table_candidates, raw_text=raw_page_text)
        ocr_used = False
        needs_ocr = False
        raster_observations = {}
        ocr_runtime = {}
        image_coverage = page_image_coverage_ratio(page)

        # IDX-H4: trigger OCR by text-density relative to image coverage, not only a flat
        # 40-char floor. Image-dominant pages with low text density (e.g. a dose table
        # rendered as an image with a short caption) are OCR'd and merged with the existing
        # text layer so caption + table contents are both retained.
        if should_ocr_page(raw_page_text, page):
            ocr_text, ocr_warning = maybe_ocr_page(page, budget, raster_observations, ocr_runtime)
            if ocr_warning:
                warnings.append(ocr_warning)
            if ocr_text.strip():
                text = merge_ocr_text(text, ocr_text)
                ocr_used = True
            else:
                needs_ocr = True

        budget.add_text(text)
        pages.append(
            {
                "pageNumber": page_number,
                "text": text,
                "ocrUsed": ocr_used,
                "needsOcr": needs_ocr,
                "metadata": {
                    **({"raster_table_ocr": raster_observations} if raster_observations else {}),
                    "image_coverage_ratio": round(image_coverage, 4),
                    "source_provenance": page_source_provenance(
                        source_geometry, page_number, raw_page_text, text, ocr_used, needs_ocr, identity, ocr_runtime
                    ),
                },
            }
        )

        page_image_count = 0
        for image_index, image_info in enumerate(page.get_images(full=True)):
            xref = image_info[0]
            budget.ensure_artifact_slot()
            oversized_warning = oversized_embedded_image_warning(image_info)
            if oversized_warning:
                warnings.append(oversized_warning)
                continue
            try:
                extracted = document.extract_image(xref)
            except MemoryError:
                raise
            except Exception as exc:
                # ING-B-04: one image MuPDF refuses must not abort the whole document.
                warnings.append(
                    f"embedded_image_skipped: xref {xref} could not be extracted: {type(exc).__name__}"
                )
                continue
            normalized, normalize_warning = normalize_embedded_image(document, xref, extracted, budget)
            if normalize_warning:
                warnings.append(normalize_warning)
            if normalized is None:
                continue
            ext = normalized["ext"]
            image_bytes = normalized["bytes"]
            width = normalized["width"]
            height = normalized["height"]
            try:
                rects = page.get_image_rects(xref) or []
            except MemoryError:
                raise
            except Exception as exc:
                warnings.append(
                    f"embedded_image_placement_unavailable: xref {xref}: {type(exc).__name__}"
                )
                rects = []
            bbox = rect_payload(rects[0]) if rects else None
            image_path = os.path.join(
                output_dir, f"page-{page_number}-image-{image_index + 1}.{ext}"
            )
            budget.add_artifact(len(image_bytes))
            with open(image_path, "wb") as handle:
                handle.write(image_bytes)

            mime = normalized["mime"]
            images.append(
                {
                    "pageNumber": page_number,
                    "path": image_path,
                    "mimeType": mime,
                    "bbox": bbox,
                    "width": width,
                    "height": height,
                    "sourceKind": "embedded",
                    "metadata": {
                        "pageNumber": page_number,
                        "source_kind": "embedded",
                        "xref": xref,
                        "bbox": bbox,
                        "page_width": round(float(page.rect.width), 2),
                        "page_height": round(float(page.rect.height), 2),
                        "page_rotation": int(page.rotation or 0),
                        "image_coverage_ratio": round(image_coverage, 4),
                        "source_regions": [
                            {
                                "source_kind": "embedded",
                                "bbox": bbox,
                                "page_number": page_number,
                                "xref": xref,
                            }
                        ],
                    },
                }
            )
            page_image_count += 1

        crop_index = 1
        table_rects = []
        table_candidates = list(grid_table_candidates)
        table_candidates.extend(fallback_table_candidates(
            page, [candidate["rect"] for candidate in table_candidates] + rejected_table_rects,
        ))
        table_candidates = merge_related_table_candidates(table_candidates, page.rect)
        for table_candidate in table_candidates:
            detected_rect = table_candidate["rect"]
            edge_rect, edge_info = extend_table_rect_for_edge_content(page, detected_rect)
            table_rows = list(table_candidate.get("table_rows") or [])
            table_merged_cells = [list(cell) for cell in table_candidate.get("table_merged_cells") or []]
            column_count = int(table_candidate.get("column_count") or (len(table_rows[0]) if table_rows else 0) or 0)
            recovered_rows = []
            unassigned_edge_text = []
            recovered_truncated = False
            if edge_info["extended"]:
                top_rows, bottom_rows = _recover_table_rows_split(
                    page,
                    detected_rect,
                    edge_rect,
                    table_rows,
                    column_count,
                    table_candidate.get("column_ranges"),
                    unassigned_segments=unassigned_edge_text,
                )
                recovered_rows = top_rows + bottom_rows
                if recovered_rows:
                    combined_rows = top_rows + table_rows + bottom_rows
                    table_merged_cells = [
                        [row + len(top_rows), column]
                        for row, column in table_merged_cells
                        if row + len(top_rows) < MAX_TABLE_ROWS
                    ]
                    recovered_truncated = len(combined_rows) > MAX_TABLE_ROWS
                    table_rows = combined_rows[:MAX_TABLE_ROWS]
            rows_truncated = (
                bool(table_candidate.get("rows_truncated"))
                or bool(edge_info["clipped_by_page"])
                or recovered_truncated
            )
            if edge_info["clipped_by_page"]:
                warnings.append(
                    f"table_crop_edge_incomplete: page {page_number} table continues past the page edge; "
                    "retained the on-page remnant in the crop"
                )
            table_rect = expanded_rect(edge_rect, page.rect, 4, 4)
            table_text = (table_candidate.get("table_text") or "")[:MAX_TABLE_TEXT_CHARS]
            accessible = (
                table_candidate.get("accessible_table_markdown") or table_candidate.get("table_text") or ""
            )[:MAX_TABLE_TEXT_CHARS]
            if recovered_rows:
                accessible = (table_rows_to_markdown(table_rows) or accessible)[:MAX_TABLE_TEXT_CHARS]
                table_text = accessible
            crop_metadata = {
                "pageNumber": page_number,
                "source_kind": "table_crop",
                "candidate_type": "table",
                "table_label": table_candidate.get("table_label"),
                "table_title": table_candidate.get("table_title"),
                "table_text": table_text,
                "table_role": table_candidate.get("table_role"),
                "table_confidence": table_candidate.get("table_confidence"),
                "table_rows": table_rows,
                "table_merged_cells": table_merged_cells,
                "table_columns": table_candidate.get("table_columns") or [],
                "accessible_table_markdown": accessible,
                "row_count": len(table_rows) if table_rows else table_candidate.get("row_count"),
                "rows_truncated": rows_truncated,
                "column_count": column_count or table_candidate.get("column_count"),
                "heading_text": table_candidate.get("heading_text"),
                "bbox": rect_payload(table_rect),
                "extraction_method": table_candidate.get("extraction_method"),
                "table_index": table_candidate.get("table_index"),
            }
            if unassigned_edge_text:
                crop_metadata["unassigned_edge_text"] = unassigned_edge_text
                crop_metadata["edge_recovery_needs_review"] = True
                warnings.append(f"table_edge_association_unverified: page {page_number}; "
                                "retained edge text without assigning it to clinical cells")
            if edge_info["extended"]:
                crop_metadata["edge_content_extended"] = True
                crop_metadata["edge_content_edges"] = edge_info["edges"]
            if edge_info["clipped_by_page"]:
                # Partial last row still visible on-page, but structured extraction cannot be complete.
                crop_metadata["crop_completeness"] = 0.9
            crop = save_page_crop(
                page,
                table_rect,
                output_dir,
                f"page-{page_number}-table-crop-{crop_index}.png",
                "table_crop",
                crop_metadata,
                budget,
                warnings,
            )
            if crop:
                images.append(crop)
                table_rects.append(table_rect)
                crop_index += 1

        visual_rects = list(table_rects)
        # A rejected grid still marks source artwork worth retaining. Its bbox
        # is already in display coordinates, including on rotated pages; keep
        # the complete region without inventing table headers or relationships.
        for rejected_rect in rejected_table_rects:
            region = expanded_rect(rejected_rect, page.rect)
            if any(rect_intersection_ratio(region, existing) > 0.45 for existing in visual_rects):
                continue
            crop = save_page_crop(
                page,
                region,
                output_dir,
                f"page-{page_number}-visual-crop-{crop_index}.png",
                "page_region",
                {
                    "pageNumber": page_number,
                    "source_kind": "page_region",
                    "candidate_type": "rejected_table_region",
                },
                budget,
                warnings,
            )
            if crop:
                images.append(crop)
                visual_rects.append(region)
                crop_index += 1

        vector_region = likely_vector_region(page)
        if vector_region and not any(rect_intersection_ratio(vector_region, existing) > 0.45 for existing in visual_rects):
            crop = save_page_crop(
                page,
                vector_region,
                output_dir,
                f"page-{page_number}-vector-crop-{crop_index}.png",
                "diagram_crop",
                {
                    "pageNumber": page_number,
                    "source_kind": "diagram_crop",
                    "candidate_type": "vector_region",
                },
                budget,
                warnings,
            )
            if crop:
                images.append(crop)
                crop_index += 1

        should_capture_fallback_region = crop_index == 1 and (
            page_image_count == 0 or image_coverage >= 0.18 or ocr_used
        )
        if should_capture_fallback_region:
            fallback_region = fallback_visual_region(page, image_coverage=image_coverage, ocr_used=ocr_used)
            if fallback_region and not any(
                rect_intersection_ratio(fallback_region, table_rect) > 0.45 for table_rect in table_rects
            ):
                candidate_type = (
                    "ocr_page_region"
                    if ocr_used
                    else "image_dominant_page_region"
                    if page_image_count > 0
                    else "fallback_visual_region"
                )
                crop = save_page_crop(
                    page,
                    fallback_region,
                    output_dir,
                    f"page-{page_number}-visual-region.png",
                    "page_region",
                    {
                        "pageNumber": page_number,
                        "source_kind": "page_region",
                        "candidate_type": candidate_type,
                        "image_coverage_ratio": round(image_coverage, 4),
                        "page_visual_weight": page_visual_weight(page),
                        "ocr_used": ocr_used,
                  },
                    budget,
                    warnings,
                )
                if crop:
                    images.append(crop)

    # Optional cover after searchable artifacts so a near-limit budget cannot
    # fail indexing because the decorative thumbnail consumed the last slot.
    if document.page_count > 0:
        try:
            cover = save_cover_page(document[0], output_dir, budget, warnings)
            if cover:
                images.append(cover)
        except ExtractionBudgetExceeded as exc:
            warnings.append(f"cover_page_skipped: {exc}")

    return {
        "pages": pages,
        "images": images,
        "warnings": warnings,
        "budgetUsage": budget.usage(),
        "extractor": {
            "name": "extract_pdf_assets",
            "version": EXTRACTOR_VERSION,
            "pymupdf": str(getattr(fitz, "VersionBind", "") or getattr(fitz, "__version__", "")),
            "tableStrategy": TABLE_STRATEGY,
        },
    }


def main(argv):
    if len(argv) not in (3, 4, 5):
        print(
            "Usage: extract_pdf_assets.py input.pdf output_dir [output.json] [budget.json]",
            file=sys.stderr,
        )
        sys.exit(1)

    apply_memory_limit()
    try:
        limits = None
        if len(argv) == 5:
            with open(argv[4], "r", encoding="utf-8") as handle:
                limits = json.load(handle)
        extraction_budget = ExtractionBudget(limits)
        result = extract(argv[1], argv[2], extraction_budget)
        serialized = json.dumps(result)
        extraction_budget.ensure_result(serialized)
        if len(argv) >= 4:
            with open(argv[3], "w", encoding="utf-8") as handle:
                handle.write(serialized)
        else:
            print(serialized)
    except ExtractionBudgetExceeded as exc:
        print(f"PDF_EXTRACTION_BUDGET_EXCEEDED: {exc}", file=sys.stderr)
        sys.exit(3)
    except PdfUnreadable as exc:
        print(f"PDF_UNREADABLE: {exc}", file=sys.stderr)
        sys.exit(4)
    except Exception as exc:
        if not is_memory_exhaustion(exc):
            raise
        # ING-B-05: running out of the address-space limit is a resource refusal,
        # so the worker neither retries it nor re-parses the file in-process.
        print(
            f"PDF_EXTRACTION_BUDGET_EXCEEDED: memory limit reached ({type(exc).__name__})",
            file=sys.stderr,
        )
        sys.exit(3)


if __name__ == "__main__":
    main(sys.argv)
