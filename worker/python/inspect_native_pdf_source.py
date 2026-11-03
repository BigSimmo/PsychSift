"""Bounded structural inspection for a conservative native-text PDF profile.

This does not assess clinical meaning, rights, table relationships or whole-source
semantic completeness. Unsupported display features refuse rather than implying
hidden-content fidelity. Run in a subprocess with an external wall-clock deadline.
"""
import hashlib
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


def inspect_source(source_path, supplied_limits=None):
    limits = dict(DEFAULT_LIMITS)
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
        for xref in range(1, document.xref_length()):
            deadline()
            keys = set(document.xref_get_keys(xref))
            if keys.intersection(UNSUPPORTED_KEYS):
                refuse("active_content")
            if "S" in keys and document.xref_get_key(xref, "S")[1] in ACTIVE_ACTIONS:
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
                    refuse("unsupported_display")
        for index, page in enumerate(document):
            deadline()
            if page.first_annot or page.first_widget or page.get_links():
                refuse("active_content")
            trace = page.get_texttrace()
            display = page.get_bboxlog()
            text = page.get_text("text", sort=True)
            if not text.strip() and (page.get_images(full=True) or any(kind == "fill-image" for kind, _box in display)):
                refuse("ocr_required")
            if not text.strip() and any(kind in {"fill-path", "stroke-path"} for kind, _box in display):
                refuse("unsupported_outlined_text")
            for span in trace:
                bbox = fitz.Rect(span["bbox"])
                color = span.get("color", ())
                white = ((len(color) in (1, 3) and all(component >= 0.95 for component in color)) or
                         (len(color) == 4 and all(component <= 0.05 for component in color)))
                if (span.get("type") != 0 or span.get("opacity") != 1.0 or span.get("layer") or
                        span.get("size", 0) < 3 or white or len(color) not in (1, 3, 4) or
                        bbox.is_empty or not all(math.isfinite(v) for v in bbox) or not page.rect.contains(bbox)):
                    refuse("hidden_text_unsupported")
                # Later paint over a native span is ambiguous even when the span
                # remains extractable. Reject it rather than exposing hidden text.
                for kind, later_box in display[span["seqno"] + 1:]:
                    if kind == "ignore-text" or fitz.Rect(later_box).intersects(bbox):
                        refuse("hidden_text_occluded")
            if any(kind == "ignore-text" for kind, _box in display):
                refuse("hidden_text_unsupported")
            # This first functional terminal supports native text only. Do not
            # let its supplier declare empty visual obligations for mixed pages.
            # Extractor-created page-preview rasters are not original objects.
            if page.get_images(full=True) or any(kind != "fill-text" for kind, _box in display):
                refuse("unsupported_visual_content")
            encoded = text.encode("utf-8", errors="strict")
            total_text_bytes += len(encoded)
            if len(encoded) > limits["max_page_text_bytes"] or total_text_bytes > limits["max_total_text_bytes"]:
                refuse("text_budget_exceeded")
            pages.append({"pageNumber": index + 1, "text": text, "textSha256": digest(encoded)})
        deadline()
        if not total_text_bytes:
            refuse("empty_native_text")
        if path.stat().st_size != size or digest(path.read_bytes()) != original_hash:
            refuse("source_changed")
        return {
            "version": VERSION, "status": "inspected", "sourceSha256": original_hash,
            "sourceByteLength": size, "pageCount": len(pages), "pages": pages,
            "pageInventory": "complete", "activeContent": "absent", "encryption": "not_encrypted",
            "hiddenText": "consistent", "profile": "visible-native-text-conservative-v1",
            "producer": {"pymupdfVersion": str(fitz.VersionBind)},
            "limitations": ["not_clinical_or_semantic_completeness", "not_table_or_image_acceptance", "unsupported_display_features_refused"],
        }
    finally:
        document.close()


def main():
    try:
        if len(sys.argv) != 3:
            refuse("arguments_invalid")
        seconds = float(sys.argv[2])
        if not math.isfinite(seconds) or seconds <= 0 or seconds > DEFAULT_LIMITS["max_seconds"]:
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
        result = inspect_source(sys.argv[1], {"max_seconds": seconds})
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
