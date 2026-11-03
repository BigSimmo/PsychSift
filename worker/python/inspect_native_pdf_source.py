"""Bounded structural inspection for a conservative native-text PDF profile.

This does not assess clinical meaning, rights, table relationships or whole-source
semantic completeness. Unsupported display features refuse rather than implying
hidden-content fidelity. Run in a subprocess with an external wall-clock deadline.
"""
import hashlib
from contextlib import redirect_stdout
import json
import math
from pathlib import Path
import re
import signal
import sys
import time

# The deprecated fitz alias prints to stdout on current pinned releases, which
# would corrupt this subprocess's strict JSON protocol.
import pymupdf as fitz

VERSION = "native-pdf-structural-inspection-v1"
DEFAULT_LIMITS = {
    "max_source_bytes": 150 * 1024 * 1024,
    "max_pages": 1000,
    "max_page_text_bytes": 2 * 1024 * 1024,
    "max_total_text_bytes": 8 * 1024 * 1024,
    "max_xrefs": 100000,
    "max_stream_bytes": 8 * 1024 * 1024,
    "max_total_stream_bytes": 32 * 1024 * 1024,
    "max_seconds": 30,
}
UNSUPPORTED_KEYS = {
    "AA", "OpenAction", "JS", "JavaScript", "AcroForm", "XFA", "EmbeddedFiles",
    "EF", "RichMedia", "Launch", "Sound", "Movie", "3D", "OCProperties", "OC", "SMask", "BM",
}
ACTIVE_ACTIONS = {"/JavaScript", "/Launch", "/GoToR", "/SubmitForm", "/ImportData", "/URI", "/Rendition"}


class InspectionRefusal(Exception):
    pass


def refuse(reason):
    raise InspectionRefusal(reason)


def digest(value):
    return "sha256:" + hashlib.sha256(value).hexdigest()


def meaningful_glyph_boxes(span):
    """Exclude explicit whitespace and zero-width ligature continuation boxes.

    A texttrace span can contain distant characters or several lines. Its union
    bbox is not evidence that paint in the intervening blank area hides text.
    Unknown/nonfinite meaningful glyph geometry still refuses.
    """
    boxes = []
    compound = None
    ligatures = {"fi", "ff", "fl", "ft", "st", "ffi", "ffl"}
    for char in span.get("chars", ()):
        if chr(char[0]).isspace():
            compound = None
            continue
        box = fitz.Rect(char[3])
        if not all(math.isfinite(value) for value in (*box, *char[2])) or not box.is_valid:
            refuse("hidden_text_unsupported")
        if char[1] == -1:
            # PyMuPDF represents the rest of an fi/ff/etc compound glyph with
            # glyph id -1 and zero width; the first glyph covers the compound.
            if (compound is None or box.width != 0 or box.height <= 0 or
                    tuple(char[2]) != compound["origin"] or
                    tuple(box) != (compound["box"].x0, compound["box"].y0,
                                   compound["box"].x0, compound["box"].y1) or
                    compound["text"] + chr(char[0]) not in ligatures):
                refuse("hidden_text_unsupported")
            compound["text"] += chr(char[0])
            continue
        if box.is_empty:
            refuse("hidden_text_unsupported")
        boxes.append(box)
        compound = {"text": chr(char[0]), "origin": tuple(char[2]), "box": box}
    return boxes


def inspect_source(source_path, supplied_limits=None, profile="text", render_dir=None):
    if profile not in {"text", "rich"}:
        refuse("profile_invalid")
    rich = profile == "rich"
    limits = dict(DEFAULT_LIMITS)
    if rich:
        # The full feature profile uses the existing extraction budgets, while
        # preserving the smaller v1 native-text contract unchanged.
        limits.update(max_pages=5000, max_total_text_bytes=64 * 1024 * 1024,
                      max_stream_bytes=32 * 1024 * 1024, max_total_stream_bytes=512 * 1024 * 1024,
                      max_seconds=120)
    for key, value in (supplied_limits or {}).items():
        if key not in limits or not isinstance(value, (int, float)) or not math.isfinite(value) or value <= 0 or value > limits[key]:
            refuse("budget_invalid")
        limits[key] = value
    start = time.monotonic()

    def deadline():
        if time.monotonic() - start >= limits["max_seconds"]:
            refuse("timeout")

    deadline()
    path = Path(source_path)
    size = path.stat().st_size
    if size < 1 or size > limits["max_source_bytes"]:
        refuse("source_budget_exceeded")
    original = path.read_bytes()
    if len(original) != size or not original.startswith(b"%PDF-") or not original.rstrip().endswith(b"%%EOF"):
        refuse("source_format_unsupported")
    original_hash = digest(original)
    deadline()
    try:
        document = fitz.open(stream=original, filetype="pdf")
    except Exception:
        refuse("source_unreadable")
    pages = []
    total_text_bytes = 0
    try:
        if document.is_encrypted or document.needs_pass:
            refuse("encrypted")
        if document.is_repaired:
            refuse("source_repaired")
        if document.page_count < 1 or document.page_count > limits["max_pages"] or document.xref_length() > limits["max_xrefs"]:
            refuse("page_or_object_budget_exceeded")
        if document.embfile_count():
            refuse("active_content")
        # Inspect parsed dictionary keys, including indirect action dictionaries;
        # do not assume a raw-byte regex finds compressed or escaped objects.
        total_stream_bytes = 0
        content_xrefs = {xref for page in document for xref in page.get_contents()}
        complex_display = False
        render_budget = None
        if rich and render_dir is not None:
            with redirect_stdout(sys.stderr):
                import extract_pdf_assets as original_producer
            Path(render_dir).mkdir(parents=True, exist_ok=True)
            render_budget = original_producer.ExtractionBudget()
        for xref in range(1, document.xref_length()):
            deadline()
            keys = set(document.xref_get_keys(xref))
            unsupported_keys = UNSUPPORTED_KEYS - {"SMask", "BM"} if rich else UNSUPPORTED_KEYS
            if keys.intersection(unsupported_keys):
                refuse("active_content")
            if keys.intersection({"SMask", "BM"}):
                complex_display = True
            active_actions = ACTIVE_ACTIONS - {"/URI"} if rich else ACTIVE_ACTIONS
            if "S" in keys and document.xref_get_key(xref, "S")[1] in active_actions:
                refuse("active_content")
            if "Subtype" in keys and document.xref_get_key(xref, "Subtype")[1] in {"/Widget", "/FileAttachment", "/RichMedia"}:
                refuse("active_content")
            if "Subtype" in keys and document.xref_get_key(xref, "Subtype")[1] == "/Type3":
                refuse("unsupported_display")
            if document.xref_is_stream(xref):
                stream = document.xref_stream(xref)
                total_stream_bytes += len(stream)
                if len(stream) > limits["max_stream_bytes"] or total_stream_bytes > limits["max_total_stream_bytes"]:
                    refuse("stream_budget_exceeded")
                # Conservative rejection includes possible false positives inside
                # content strings. No clipping/masking fidelity is inferred from
                # extraction when this bounded profile cannot establish it.
                is_form = "Subtype" in keys and document.xref_get_key(xref, "Subtype")[1] == "/Form"
                if (xref in content_xrefs or is_form) and re.search(rb"(?:^|[\s\[\]<>/%(){}])W\*?(?=[\s\[\]<>/%(){}]|$)", stream):
                    if not rich:
                        refuse("unsupported_display")
                    complex_display = True
        for index, page in enumerate(document):
            deadline()
            if page.first_annot or page.first_widget or (page.get_links() and not rich):
                refuse("active_content")
            trace = page.get_texttrace()
            display = page.get_bboxlog()
            text_paint = {}
            for span in trace:
                text_paint.setdefault(span["seqno"], []).extend(meaningful_glyph_boxes(span))
            text = page.get_text("text", sort=True)
            if not rich and not text.strip() and (page.get_images(full=True) or any(kind == "fill-image" for kind, _box in display)):
                refuse("ocr_required")
            if not rich and not text.strip() and any(kind in {"fill-path", "stroke-path"} for kind, _box in display):
                refuse("unsupported_outlined_text")
            for span in trace:
                glyph_boxes = meaningful_glyph_boxes(span)
                if not glyph_boxes:
                    # Blank characters carry layout, but no hidden source text.
                    continue
                bbox = fitz.Rect(span["bbox"])
                color = span.get("color", ())
                white = ((len(color) in (1, 3) and all(component >= 0.95 for component in color)) or
                         (len(color) == 4 and all(component <= 0.05 for component in color)))
                if (span.get("type") != 0 or span.get("opacity") != 1.0 or span.get("layer") or
                        span.get("size", 0) < 3 or (white and not rich) or len(color) not in (1, 3, 4) or
                        bbox.is_empty or not all(math.isfinite(v) for v in bbox) or
                        any(not page.rect.contains(box) for box in glyph_boxes)):
                    refuse("hidden_text_unsupported")
                if rich and (white or complex_display):
                    # Render the actual clipped/masked source region locally.
                    # Contrast elsewhere in a span's union cannot prove that an
                    # individual meaningful glyph is visible.
                    for glyph in glyph_boxes:
                        deadline()
                        pixels = page.get_pixmap(matrix=fitz.Matrix(1, 1), clip=glyph, colorspace=fitz.csGRAY, alpha=False)
                        samples = pixels.samples
                        if not samples or max(samples) - min(samples) < 16:
                            refuse("hidden_text_unsupported")
                # Later paint over a native span is ambiguous even when the span
                # remains extractable. Reject it rather than exposing hidden text.
                for seqno in range(span["seqno"] + 1, len(display)):
                    kind, later_box = display[seqno]
                    if kind not in {"ignore-text", "fill-text", "fill-image", "fill-path", "fill-shade"}:
                        continue
                    later_boxes = text_paint.get(seqno, [fitz.Rect(later_box)]) if kind == "fill-text" else [fitz.Rect(later_box)]
                    if any(later.intersects(glyph) for later in later_boxes for glyph in glyph_boxes):
                        refuse("hidden_text_occluded")
            if any(kind == "ignore-text" and (seqno not in text_paint or text_paint[seqno])
                   for seqno, (kind, _box) in enumerate(display)):
                refuse("hidden_text_unsupported")
            # This first functional terminal supports native text only. Do not
            # let its supplier declare empty visual obligations for mixed pages.
            # Extractor-created page-preview rasters are not original objects.
            if not rich and (page.get_images(full=True) or any(kind != "fill-text" for kind, _box in display)):
                refuse("unsupported_visual_content")
            encoded = text.encode("utf-8", errors="strict")
            total_text_bytes += len(encoded)
            if len(encoded) > limits["max_page_text_bytes"] or total_text_bytes > limits["max_total_text_bytes"]:
                refuse("text_budget_exceeded")
            if rich:
                with redirect_stdout(sys.stderr):
                    tables = list(page.find_tables().tables)
                raster = [list(item["bbox"]) for item in page.get_image_info()]
                vectors = [list(item["rect"]) for item in page.get_drawings()]
                page_record = {
                    "pageNumber": index + 1, "nativeText": text, "nativeTextSha256": digest(encoded),
                    "sourceFeatures": {"nativeText": bool(text.strip()), "rasterImages": len(raster), "vectorDrawings": len(vectors), "nativeTables": len(tables)},
                    "rasterBboxes": raster, "vectorBboxes": vectors, "tableBboxes": [list(table.bbox) for table in tables],
                }
                if render_budget is not None and (raster or vectors or tables):
                    page_record["coverageImage"] = original_producer.save_page_crop(
                        page, page.rect, str(render_dir), f"source-page-{index + 1}.png", "page_region",
                        {"pageNumber": index + 1, "candidate_type": "independent_original_feature_coverage", "source_sha256": original_hash},
                        render_budget, [],
                    )
                    if page_record["coverageImage"] is None:
                        refuse("source_visual_capture_unavailable")
                pages.append(page_record)
            else:
                pages.append({"pageNumber": index + 1, "text": text, "textSha256": digest(encoded)})
        deadline()
        if not total_text_bytes and not rich:
            refuse("empty_native_text")
        if path.stat().st_size != size or digest(path.read_bytes()) != original_hash:
            refuse("source_changed")
        return {
            "version": "rich-pdf-structural-inspection-v2" if rich else VERSION, "status": "inspected", "sourceSha256": original_hash,
            "sourceByteLength": size, "pageCount": len(pages), "pages": pages,
            "pageInventory": "complete", "activeContent": "absent", "encryption": "not_encrypted",
            "hiddenText": "consistent", "profile": "original-feature-inventory-v2" if rich else "visible-native-text-conservative-v1",
            "producer": {"pymupdfVersion": str(fitz.VersionBind)},
            "limitations": ["not_clinical_or_semantic_completeness", "not_table_or_image_acceptance", "unsupported_display_features_refused"],
        }
    finally:
        document.close()


def main():
    try:
        if len(sys.argv) not in (3, 4) or (len(sys.argv) == 4 and sys.argv[3] != "rich"):
            refuse("arguments_invalid")
        seconds = float(sys.argv[2])
        if not math.isfinite(seconds) or seconds <= 0 or seconds > (120 if len(sys.argv) == 4 else DEFAULT_LIMITS["max_seconds"]):
            refuse("budget_invalid")
        if hasattr(signal, "setitimer"):
            signal.signal(signal.SIGALRM, lambda _signal, _frame: refuse("timeout"))
            signal.setitimer(signal.ITIMER_REAL, seconds)
        # Unix worker subprocess: cap parser address space before decompression.
        # The Node caller also enforces a hard wall-clock/output bound.
        try:
            import resource
            resource.setrlimit(resource.RLIMIT_AS, (1024 * 1024 * 1024, 1024 * 1024 * 1024))
        except ImportError:
            # Windows requires host process isolation; do not claim this limit there.
            pass
        result = inspect_source(sys.argv[1], {"max_seconds": seconds}, profile="rich" if len(sys.argv) == 4 else "text",
                                render_dir=str(Path(sys.argv[1]).parent / "source-visuals") if len(sys.argv) == 4 else None)
        print(json.dumps(result, ensure_ascii=False, separators=(",", ":")))
        return 0
    except InspectionRefusal as error:
        print(json.dumps({"status": "refused", "reason": str(error)}))
        return 2
    except Exception:
        print(json.dumps({"status": "refused", "reason": "inspection_failed"}))
        return 2


if __name__ == "__main__":
    sys.exit(main())
