"""Docling shadow-extraction runner for the ingestion worker (packet B4).

Invoked by worker/shadow-extraction.ts from the docling venv (WORKER_DOCLING_PYTHON_BIN)
AFTER the legacy index generation has been committed:

    /opt/docling-venv/bin/python worker/python/shadow_docling_extract.py <pdf> <result.json>

The converter configuration mirrors the Gate B lab runner (eval/docling/harness/run_docling.py)
so shadow measurements stay comparable with the recorded gate: CPU only, tesseract-CLI OCR
(the worker's OCR engine), table structure on, models from DOCLING_ARTIFACTS_PATH. The caller
forces TORCHDYNAMO_DISABLE=1 (eager torch) and HF_HUB_OFFLINE=1 (no run-time model fetch).

The result file carries AGGREGATE NUMBERS ONLY — page, character, table, cell and numeric-token
counts plus peak RSS. It never contains extracted text, table cells, file names, or error
messages; the only strings are the docling version and an exception class name.

Exit codes: 0 success, 10 clean extraction failure (recorded as `extraction_failed`),
20 docling import failure (recorded as `runtime_unavailable`), anything else is a crash.
docling is imported lazily inside build_converter() so this module imports cleanly in the
OCR venv, where the image build's unittest discovery runs.
"""

from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

# Must stay identical to SHADOW_NUMERIC_TOKEN_PATTERN in worker/shadow-extraction.ts.
# ASCII digits only: Python's \d matches every Unicode digit, JavaScript's does not.
NUMERIC_TOKEN_PATTERN = re.compile(r"[0-9]+(?:[.,][0-9]+)?")

EXIT_OK = 0
EXIT_EXTRACTION_FAILED = 10
EXIT_RUNTIME_UNAVAILABLE = 20


class DoclingUnavailableError(RuntimeError):
    """docling (or one of its runtime dependencies) could not be imported."""


def build_converter():
    try:
        from docling.datamodel.base_models import InputFormat
        from docling.datamodel.pipeline_options import PdfPipelineOptions, TesseractCliOcrOptions
        from docling.document_converter import DocumentConverter, PdfFormatOption
    except ImportError as exc:  # docling venv missing or broken
        raise DoclingUnavailableError(str(exc)) from exc

    artifacts_path = os.environ.get("DOCLING_ARTIFACTS_PATH")
    options = PdfPipelineOptions(artifacts_path=artifacts_path) if artifacts_path else PdfPipelineOptions()
    options.do_ocr = True
    # The worker image installs only tesseract-ocr-eng. Docling's default
    # language list (fra/deu/spa/eng) now raises OcrLanguageNotSupportedError
    # for missing traineddata instead of skipping it, so pin the shipped model.
    options.ocr_options = TesseractCliOcrOptions(lang=["eng"])
    options.do_table_structure = True
    return DocumentConverter(format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=options)})


def docling_version() -> str | None:
    try:
        from importlib.metadata import version

        return version("docling")
    except Exception:  # noqa: BLE001 - version is informational only
        return None


def count_numeric_tokens(text: str) -> int:
    return len(NUMERIC_TOKEN_PATTERN.findall(text or ""))


def table_counts(document) -> tuple[int, int]:
    """(table_count, non-empty cell count) over document.tables[*].data.grid — same walk as the lab."""
    table_count = 0
    cell_count = 0
    for table in getattr(document, "tables", []) or []:
        table_count += 1
        data = getattr(table, "data", None)
        grid = getattr(data, "grid", None)
        if not grid:
            continue
        for row in grid:
            for cell in row:
                text = getattr(cell, "text", "")
                if isinstance(text, str) and text.strip():
                    cell_count += 1
    return table_count, cell_count


def summarize_document(document) -> dict:
    """Aggregate, numbers-only projection of a docling document. Never returns text."""
    text = document.export_to_markdown()
    table_count, table_cell_count = table_counts(document)
    return {
        "page_count": len(getattr(document, "pages", {}) or {}),
        "text_character_count": len(text),
        "table_count": table_count,
        "table_cell_count": table_cell_count,
        "numeric_token_count": count_numeric_tokens(text),
    }


def peak_rss_bytes() -> int | None:
    try:
        import resource  # POSIX only; absent on Windows dev machines

        usage = resource.getrusage(resource.RUSAGE_SELF)
        # Linux reports ru_maxrss in KiB (macOS in bytes; the worker image is Linux).
        return int(usage.ru_maxrss) * 1024
    except Exception:  # noqa: BLE001 - measurement is best-effort
        return None


def write_result(result_path: Path, payload: dict) -> None:
    result_path.write_text(json.dumps(payload), encoding="utf-8")


def run(file_path: Path, result_path: Path, converter_factory=build_converter) -> int:
    base = {"engine": "docling", "docling_version": docling_version()}
    try:
        converter = converter_factory()
    except DoclingUnavailableError:
        write_result(result_path, {**base, "ok": False, "error_kind": "runtime_unavailable"})
        return EXIT_RUNTIME_UNAVAILABLE
    try:
        result = converter.convert(str(file_path), raises_on_error=True)
        summary = summarize_document(result.document)
        write_result(result_path, {**base, "ok": True, **summary, "peak_rss_bytes": peak_rss_bytes()})
        return EXIT_OK
    except Exception as error:  # noqa: BLE001 - any converter failure is a recorded outcome
        write_result(
            result_path,
            {**base, "ok": False, "error_kind": type(error).__name__, "peak_rss_bytes": peak_rss_bytes()},
        )
        return EXIT_EXTRACTION_FAILED


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        print("Usage: shadow_docling_extract.py input.pdf result.json", file=sys.stderr)
        return 1
    return run(Path(argv[1]), Path(argv[2]))


if __name__ == "__main__":
    sys.exit(main(sys.argv))
