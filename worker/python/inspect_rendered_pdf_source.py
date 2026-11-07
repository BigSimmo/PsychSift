"""Explicit, held renderer-authoritative PDF evidence; never a native fallback.

Only composited page PNGs enter a new raster-only PDF and the existing extractor.
Native source text/table strings and original embedded image streams never enter
the result. OCR is an observation, not proof of meaning or complete relationships.
Call the CLI in an externally deadline-limited process: MuPDF C calls cannot be
interrupted reliably in-process. The extraction child has its own tree deadline.
"""
from contextlib import redirect_stdout
import hashlib
from importlib.metadata import version as package_version
import json
import math
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import time

import pymupdf as fitz

with redirect_stdout(sys.stderr):
    import extract_pdf_assets as extractor
    from inspect_native_pdf_source import ACTIVE_ACTIONS, UNSUPPORTED_KEYS

VERSION = "rendered-pdf-source-v1"
DEFAULT_LIMITS = {
    **extractor.DEFAULT_BUDGET,
    "maxSourceBytes": 150 * 1024 * 1024,
    "maxXrefs": 100_000,
    "maxStreamBytes": 32 * 1024 * 1024,
    "maxTotalStreamBytes": 512 * 1024 * 1024,
}
RELATIONSHIP_HOLDS = ["table_relationships_unverified", "diagram_relationships_unverified"]
STANDARD_LIST_NUMBERING = {
    "/None", "/Disc", "/Circle", "/Square", "/Decimal",
    "/UpperRoman", "/LowerRoman", "/UpperAlpha", "/LowerAlpha",
}
_WINDOWS_JOB_HANDLE = None
_WINDOWS_JOB_MEMORY_LIMIT = None
DEFAULT_PROCESS_MEMORY_BYTES = extractor.DEFAULT_MAX_MEMORY_MB * 1024 * 1024
JOB_OBJECT_LIMIT_PROCESS_MEMORY = 0x100
JOB_OBJECT_LIMIT_JOB_MEMORY = 0x200
JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000


class InspectionRefusal(Exception):
    """Stable reason code only; never document text or source-library messages."""


class InspectionTerminationUnverified(InspectionRefusal):
    """Keep artifacts until the externally owned producer and its job exit."""


def refuse(reason):
    raise InspectionRefusal(reason)


def _ensure_process_containment(*, memory_limit_bytes=DEFAULT_PROCESS_MEMORY_BYTES):
    """On Windows, bind this producer and future children to an unnamed job.

    The noninheritable handle is intentionally retained until process exit. No
    breakaway flags are set. Windows closes the final handle on normal exit or
    TerminateProcess, killing descendants even if taskkill could not stop them.
    Process and aggregate job commit are capped before opening the source with
    MuPDF. This also bounds native stream expansion, whose size is only known
    after decoding. A private test hook may lower, never widen, the fixed cap;
    there is no CLI or environment override for the Windows job ceiling.
    Nested-job/cap incompatibility refuses before opening the source or creating
    any OCR subprocess. Closing a successfully assigned job is process-fatal.
    https://learn.microsoft.com/windows/win32/procthread/job-objects
    """
    global _WINDOWS_JOB_HANDLE, _WINDOWS_JOB_MEMORY_LIMIT
    if (type(memory_limit_bytes) is not int or
            not 0 < memory_limit_bytes <= DEFAULT_PROCESS_MEMORY_BYTES):
        refuse("budget_invalid")
    if os.name != "nt":
        return
    if _WINDOWS_JOB_HANDLE is not None:
        if _WINDOWS_JOB_MEMORY_LIMIT is None or _WINDOWS_JOB_MEMORY_LIMIT > memory_limit_bytes:
            refuse("process_containment_unavailable")
        return
    import ctypes
    from ctypes import wintypes

    class BasicLimits(ctypes.Structure):
        _fields_ = [("PerProcessUserTimeLimit", ctypes.c_longlong),
                    ("PerJobUserTimeLimit", ctypes.c_longlong), ("LimitFlags", wintypes.DWORD),
                    ("MinimumWorkingSetSize", ctypes.c_size_t), ("MaximumWorkingSetSize", ctypes.c_size_t),
                    ("ActiveProcessLimit", wintypes.DWORD), ("Affinity", ctypes.c_size_t),
                    ("PriorityClass", wintypes.DWORD), ("SchedulingClass", wintypes.DWORD)]

    class IoCounters(ctypes.Structure):
        _fields_ = [(name, ctypes.c_ulonglong) for name in (
            "ReadOperationCount", "WriteOperationCount", "OtherOperationCount",
            "ReadTransferCount", "WriteTransferCount", "OtherTransferCount")]

    class ExtendedLimits(ctypes.Structure):
        _fields_ = [("BasicLimitInformation", BasicLimits), ("IoInfo", IoCounters),
                    ("ProcessMemoryLimit", ctypes.c_size_t), ("JobMemoryLimit", ctypes.c_size_t),
                    ("PeakProcessMemoryUsed", ctypes.c_size_t), ("PeakJobMemoryUsed", ctypes.c_size_t)]

    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.CreateJobObjectW.argtypes = [ctypes.c_void_p, wintypes.LPCWSTR]
    kernel.CreateJobObjectW.restype = wintypes.HANDLE
    kernel.SetInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD]
    kernel.SetInformationJobObject.restype = wintypes.BOOL
    kernel.SetHandleInformation.argtypes = [wintypes.HANDLE, wintypes.DWORD, wintypes.DWORD]
    kernel.SetHandleInformation.restype = wintypes.BOOL
    kernel.GetCurrentProcess.argtypes = []
    kernel.GetCurrentProcess.restype = wintypes.HANDLE
    kernel.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
    kernel.AssignProcessToJobObject.restype = wintypes.BOOL
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel.CloseHandle.restype = wintypes.BOOL
    handle = kernel.CreateJobObjectW(None, None)
    if not handle:
        refuse("process_containment_unavailable")
    limits = ExtendedLimits()
    limits.BasicLimitInformation.LimitFlags = (JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE |
                                               JOB_OBJECT_LIMIT_PROCESS_MEMORY |
                                               JOB_OBJECT_LIMIT_JOB_MEMORY)
    limits.ProcessMemoryLimit = memory_limit_bytes
    limits.JobMemoryLimit = memory_limit_bytes
    if (not kernel.SetHandleInformation(handle, 1, 0) or
            not kernel.SetInformationJobObject(handle, 9, ctypes.byref(limits), ctypes.sizeof(limits)) or
            not kernel.AssignProcessToJobObject(handle, kernel.GetCurrentProcess())):
        kernel.CloseHandle(handle)  # no process has been assigned on this failure path
        refuse("process_containment_unavailable")
    _WINDOWS_JOB_HANDLE = handle
    _WINDOWS_JOB_MEMORY_LIMIT = memory_limit_bytes


def _windows_descendants_exited():
    """Verify job quiescence, rather than equating leader exit with tree exit."""
    if os.name != "nt":
        return True
    if _WINDOWS_JOB_HANDLE is None:
        return False
    import ctypes
    from ctypes import wintypes

    class Accounting(ctypes.Structure):
        _fields_ = [(name, ctypes.c_longlong) for name in (
            "TotalUserTime", "TotalKernelTime", "ThisPeriodTotalUserTime", "ThisPeriodTotalKernelTime")]
        _fields_ += [(name, wintypes.DWORD) for name in (
            "TotalPageFaultCount", "TotalProcesses", "ActiveProcesses", "TotalTerminatedProcesses")]

    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.QueryInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD, ctypes.c_void_p]
    kernel.QueryInformationJobObject.restype = wintypes.BOOL
    deadline = time.monotonic() + 1
    while True:
        accounting = Accounting()
        if not kernel.QueryInformationJobObject(_WINDOWS_JOB_HANDLE, 1, ctypes.byref(accounting), ctypes.sizeof(accounting), None):
            return False
        if accounting.ActiveProcesses == 1:  # this producer only
            return True
        if time.monotonic() >= deadline:
            return False
        time.sleep(0.02)


def _stop_extraction_child(process):
    if os.name == "nt":
        tree_stopped = False
        try:
            result = subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"],
                                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                    creationflags=subprocess.CREATE_NO_WINDOW, timeout=5)
            tree_stopped = result.returncode == 0
        except (OSError, subprocess.TimeoutExpired):
            pass
        if not tree_stopped:
            try:
                process.kill()
            except OSError:
                pass
    else:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        except OSError:
            raise InspectionTerminationUnverified("process_termination_unverified") from None
    try:
        process.wait(timeout=5)
    except (OSError, subprocess.TimeoutExpired):
        raise InspectionTerminationUnverified("process_termination_unverified") from None
    if not _windows_descendants_exited():
        raise InspectionTerminationUnverified("process_termination_unverified")


def digest(value):
    return "sha256:" + hashlib.sha256(value).hexdigest()


def _limits(supplied):
    limits = dict(DEFAULT_LIMITS)
    for key, value in (supplied or {}).items():
        if key not in limits or type(value) is not int or value <= 0 or value > limits[key]:
            refuse("budget_invalid")
        limits[key] = value
    if limits["version"] != 1:
        refuse("budget_invalid")
    return limits


def _supported_list_attributes(document, element):
    """Narrow standard StructElem /A form, never a general action exception.

    PDF structure elements also use /A for attribute objects (Adobe PDF
    Reference 1.6, Tables 10.10 and 10.34). Only the observed indirect /List
    dictionary is supported here. Other owners, direct/array forms, streams,
    extra keys, references as values and unknown enum values still refuse.
    Attribute strings never enter the rendered evidence.
    """
    structure_kind, structure_type = document.xref_get_key(element, "S")
    if structure_kind != "name" or structure_type in ACTIVE_ACTIONS | {"/GoTo"}:
        return False
    kind, reference = document.xref_get_key(element, "A")
    match = re.fullmatch(r"([1-9][0-9]*) [0-9]+ R", reference) if kind == "xref" else None
    if not match:
        return False
    attribute = int(match.group(1))
    if attribute >= document.xref_length() or document.xref_is_stream(attribute):
        return False
    if set(document.xref_get_keys(attribute)) != {"O", "ListNumbering"}:
        return False
    if document.xref_get_key(attribute, "O") != ("name", "/List"):
        return False
    numbering_kind, numbering = document.xref_get_key(attribute, "ListNumbering")
    return numbering_kind == "name" and numbering in STANDARD_LIST_NUMBERING


def _check_structure(document, limits, deadline):
    if document.is_encrypted or document.needs_pass or document.metadata.get("encryption"):
        refuse("encrypted")
    if document.is_repaired:
        refuse("source_repaired")
    if not 0 < document.page_count <= limits["maxPages"] or document.xref_length() > limits["maxXrefs"]:
        refuse("page_or_object_budget_exceeded")
    if document.embfile_count():
        refuse("active_content")
    total_stream_bytes = 0
    for xref in range(1, document.xref_length()):
        deadline()
        keys = set(document.xref_get_keys(xref))
        # Masking and blend modes are resolved by final composition. Optional
        # layers, actions, forms and attachments still have no supported profile.
        if keys.intersection(UNSUPPORTED_KEYS - {"SMask", "BM"}):
            refuse("active_content")
        if "S" in keys and document.xref_get_key(xref, "S")[1] in ACTIVE_ACTIONS - {"/URI"}:
            refuse("active_content")
        if "A" in keys:
            if document.xref_get_key(xref, "Type") == ("name", "/StructElem"):
                # /A has a different meaning in a structure element. A forged
                # StructElem carrying an action is NOT an action allowlist route.
                if not _supported_list_attributes(document, xref):
                    refuse("active_content")
            else:
                # Direct action dictionaries have no separate xref. Inert link
                # annotations are omitted by first_annot, so inspect this too.
                action = document.xref_get_key(xref, "A/S")[1]
                if action not in {"/URI", "/GoTo"} or document.xref_get_key(xref, "A/Next")[0] != "null":
                    refuse("active_content")
        if "S" in keys and document.xref_get_key(xref, "S")[1] in {"/URI", "/GoTo"} and "Next" in keys:
            refuse("active_content")
        subtype = document.xref_get_key(xref, "Subtype")[1]
        if subtype in {"/Widget", "/FileAttachment", "/RichMedia"}:
            refuse("active_content")
        if subtype == "/Type3":
            refuse("unsupported_display")
        is_image = subtype == "/Image"
        if is_image:
            try:
                width = int(document.xref_get_key(xref, "Width")[1])
                height = int(document.xref_get_key(xref, "Height")[1])
            except (TypeError, ValueError):
                refuse("image_decode_unverified")
            # Include inactive resources: this profile never waives an unsafe or
            # ambiguous image declaration merely because it appears unused.
            if min(width, height) <= 0 or width * height > extractor.MAX_EMBEDDED_IMAGE_PIXELS:
                refuse("image_decode_budget_exceeded")
        if document.xref_is_stream(xref):
            # Check compressed bytes first; original image pixels are never
            # decoded here. The decoded length check below is a postdecode
            # guard, not a preallocation bound: the OS memory ceiling installed
            # before MuPDF opens the source bounds native stream expansion.
            raw = document.xref_stream_raw(xref)
            if len(raw) > limits["maxStreamBytes"]:
                refuse("stream_budget_exceeded")
            stream_size = len(raw) if is_image else len(document.xref_stream(xref))
            total_stream_bytes += stream_size
            if stream_size > limits["maxStreamBytes"] or total_stream_bytes > limits["maxTotalStreamBytes"]:
                refuse("stream_budget_exceeded")
    diagnostics = []
    for page in document:
        deadline()
        if page.first_annot or page.first_widget:
            refuse("active_content")
        rect = page.rect
        geometry = {"pageRect": list(rect), "cropBox": list(page.cropbox),
                    "mediaBox": list(page.mediabox), "rotation": page.rotation}
        if any(not math.isfinite(value) for key in ("pageRect", "cropBox", "mediaBox") for value in geometry[key]) or rect.is_empty or not rect.is_valid:
            refuse("page_geometry_unsupported")
        images = page.get_images(full=True)
        skipped, unsafe = extractor.page_image_decode_preflight(page, images)
        if skipped or unsafe:
            refuse("image_decode_budget_exceeded")
        displayed = page.get_image_info(hashes=False, xrefs=False)
        if any(type(info.get(axis)) is not int or info[axis] <= 0 for info in displayed for axis in ("width", "height")):
            refuse("image_decode_unverified")
        display = page.get_bboxlog()
        diagnostics.append({
            "originalGeometry": geometry,
            "nativeFeatureDiagnostics": {
                "textPaintOperations": sum(kind in {"fill-text", "stroke-text", "ignore-text"} for kind, _ in display),
                "vectorPaintOperations": sum(kind in {"fill-path", "stroke-path", "fill-shade"} for kind, _ in display),
                "rasterImages": len(displayed),
                "nativeTables": "not_inspected_strings_excluded",
                "semanticRelationships": "not_established",
            },
        })
    return diagnostics


def _ocr_runtime(remaining):
    # Resolve only the server-installed OCR binary; inherited executable
    # overrides must not choose a program for this version probe.
    command = shutil.which("tesseract")
    if not command and os.name == "nt":
        command = next((path for path in (r"C:\Program Files\Tesseract-OCR\tesseract.exe",
                       r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe") if Path(path).is_file()), None)
    if not command:
        refuse("ocr_runtime_unverified")
    try:
        probe = subprocess.run([command, "--version"], capture_output=True, text=True,
                               encoding="utf-8", errors="replace", timeout=min(2, remaining),
                               creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
        first_line = probe.stdout.splitlines()[0] if probe.stdout else ""
        match = re.fullmatch(r"tesseract\s+v?([0-9][A-Za-z0-9.+_-]{0,127})", first_line.strip())
        if probe.returncode or not match:
            refuse("ocr_runtime_unverified")
        return command, match.group(1)
    except (OSError, subprocess.TimeoutExpired):
        refuse("ocr_runtime_unverified")


def _extract_with_deadline(raster_path, stage, limits, remaining, tesseract_command, render_usage):
    budget_path = stage / "extraction-budget.json"
    result_path = stage / "extraction-result.json"
    child_limits = {key: limits[key] for key in extractor.DEFAULT_BUDGET}
    child_limits["maxArtifacts"] -= render_usage["artifacts"]
    child_limits["maxArtifactBytes"] -= render_usage["artifactBytes"]
    if min(child_limits["maxArtifacts"], child_limits["maxArtifactBytes"]) < 1:
        refuse("artifact_budget_exceeded")
    child_limits["totalTimeoutMs"] = max(1, int(remaining * 1000))
    child_limits["ocrPageTimeoutSeconds"] = max(1, min(child_limits["ocrPageTimeoutSeconds"], math.ceil(remaining)))
    budget_path.write_text(json.dumps(child_limits), encoding="utf-8")
    environment = dict(os.environ)
    # This profile uses local Tesseract only. Optional table/model inference is
    # a different producer requiring its own reviewed evidence contract.
    environment["PDF_RASTER_TABLE_OCR"] = "0"
    environment["TESSERACT_CMD"] = tesseract_command
    command = [sys.executable, str(Path(extractor.__file__).resolve()), str(raster_path),
               str(stage / "extracted"), str(result_path), str(budget_path)]
    process = subprocess.Popen(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                               env=environment, start_new_session=os.name != "nt",
                               creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
    try:
        process.wait(timeout=remaining)
    except subprocess.TimeoutExpired:
        _stop_extraction_child(process)
        refuse("timeout")
    if not _windows_descendants_exited():
        raise InspectionTerminationUnverified("process_termination_unverified")
    if process.returncode:
        refuse("extraction_budget_exceeded" if process.returncode == 3 else "raster_extraction_failed")
    if not result_path.is_file() or result_path.stat().st_size > limits["maxResultBytes"]:
        refuse("result_budget_exceeded")
    result = json.loads(result_path.read_text(encoding="utf-8"))
    result_path.unlink()
    budget_path.unlink()
    return result


def inspect_rendered_source(pdf_path, output_dir, budget=None):
    """Return held final-pixel evidence; erase failures only after child quiescence.

    Budget keys are DEFAULT_LIMITS; callers may lower, never raise, limits.
    output_dir may already hold unrelated files, which are never overwritten.
    Unverified termination retains its stage for the external owner's cleanup
    after producer exit. On Windows this binds the invoking process to a job;
    production callers must use the externally deadline-limited CLI process.
    """
    _ensure_process_containment()
    limits = _limits(budget)
    started = time.monotonic()

    def deadline():
        if time.monotonic() - started >= limits["totalTimeoutMs"] / 1000:
            refuse("timeout")

    stage = None
    try:
        deadline()
        path = Path(pdf_path)
        size = path.stat().st_size
        if not 0 < size <= limits["maxSourceBytes"]:
            refuse("source_budget_exceeded")
        with path.open("rb") as handle:
            original = handle.read(size + 1)
        if len(original) != size or not original.startswith(b"%PDF-") or not original.rstrip().endswith(b"%%EOF"):
            refuse("source_format_unsupported")
        source_hash = digest(original)
        render_budget = extractor.ExtractionBudget({key: limits[key] for key in extractor.DEFAULT_BUDGET})
        with fitz.open(stream=original, filetype="pdf") as document:
            diagnostics = _check_structure(document, limits, deadline)
            render_budget.set_page_count(document.page_count)
            parent = Path(output_dir)
            parent.mkdir(parents=True, exist_ok=True)
            stage = Path(tempfile.mkdtemp(prefix="rendered-source-", dir=parent)).resolve()
            render_pages = []
            with fitz.open() as raster:
                for index, page in enumerate(document):
                    deadline()
                    render_budget.ensure_artifact_slot()
                    desired = min(extractor.MAX_OCR_RENDER_SCALE,
                                  math.sqrt(limits["maxRenderPixels"] / (page.rect.width * page.rect.height)) * 0.99)
                    scale = extractor.bounded_render_scale(page.rect, desired,
                                                          limits["maxRenderPixels"], extractor.MAX_OCR_RENDER_SCALE)
                    if scale is None:
                        refuse("render_geometry_budget_exceeded")
                    pixels = page.get_pixmap(matrix=fitz.Matrix(scale, scale), colorspace=fitz.csRGB,
                                             alpha=False, annots=False)
                    deadline()
                    if pixels.width * pixels.height > limits["maxRenderPixels"]:
                        refuse("render_pixel_budget_exceeded")
                    image_bytes = pixels.tobytes("png")
                    render_budget.add_artifact(len(image_bytes))
                    render_path = stage / f"page-{index + 1}.png"
                    render_path.write_bytes(image_bytes)
                    render_pages.append({"pageNumber": index + 1, **diagnostics[index],
                        "artifact": {"path": str(render_path), "sha256": digest(image_bytes),
                                     "byteLength": len(image_bytes), "width": pixels.width, "height": pixels.height},
                        "unresolvedFeatureHolds": list(RELATIONSHIP_HOLDS)})
                    # Insert ONLY the final page bitmap; native text/resources,
                    # metadata, annotations and attachments are never copied.
                    # Choose raster-container points so the existing 450-DPI
                    # reader uses the saved pixels at their native resolution.
                    # Its geometry is explicitly distinct from source points.
                    normalized = raster.new_page(width=pixels.width / extractor.MAX_OCR_RENDER_SCALE,
                                                 height=pixels.height / extractor.MAX_OCR_RENDER_SCALE)
                    normalized.insert_image(normalized.rect, stream=image_bytes)
                raster_path = stage / "rendered-pages.pdf"
                # A generated PDF /ID would change the strict review-bound hash
                # on every fresh inspection of identical source pixels.
                raster_bytes = raster.tobytes(garbage=4, deflate=True, no_new_id=True)
                render_budget.add_artifact(len(raster_bytes))
                raster_path.write_bytes(raster_bytes)
        deadline()
        remaining = limits["totalTimeoutMs"] / 1000 - (time.monotonic() - started)
        tesseract_command, tesseract_version = _ocr_runtime(remaining)
        deadline()
        remaining = limits["totalTimeoutMs"] / 1000 - (time.monotonic() - started)
        extraction = _extract_with_deadline(raster_path, stage, limits, remaining, tesseract_command, render_budget.usage())
        deadline()
        if [page.get("pageNumber") for page in extraction.get("pages", [])] != list(range(1, len(render_pages) + 1)):
            refuse("extraction_page_population_mismatch")
        for page, render in zip(extraction["pages"], render_pages):
            provenance = page["metadata"]["source_provenance"]
            if provenance["producer"].get("tesseractVersion") not in (None, tesseract_version):
                refuse("ocr_runtime_unverified")
            # Existing provenance described the raster intermediate as an
            # original native source. Bind both distinct identities explicitly.
            provenance["sourceContentSha256"] = source_hash
            provenance["rasterContainerSha256"] = digest(raster_bytes)
            provenance["renderSha256"] = render["artifact"]["sha256"]
            provenance["nativeLayerDisposition"] = "excluded_from_admitted_evidence"
            provenance.pop("nativeTextSha256", None)
            provenance["producer"].update(contractVersion="pdf-rendered-page-source-v1", route="python_pdf_rendered",
                rendererScriptSha256=extractor.file_sha256(__file__), tesseractVersion=tesseract_version)
            # The raster extractor's Windows version parser can report unknown
            # for a valid 'tesseract v...' banner. This separate producer has
            # already run a bounded probe and pinned that executable for OCR.
            # Recompute only the runtime-identity diagnostic from the final
            # observed identities; semantic/OCR/relationship holds stay intact.
            if not all(isinstance(provenance["producer"].get(key), str) and
                       re.fullmatch(r"[0-9][A-Za-z0-9.+_-]{0,127}", provenance["producer"][key])
                       for key in ("pythonVersion", "pymupdfVersion", "mupdfVersion", "tesseractVersion")):
                refuse("ocr_runtime_unverified")
            provenance["reasonCodes"] = [reason for reason in provenance["reasonCodes"]
                                         if reason != "pdf_runtime_identity_unknown"]
            provenance["coordinateSpace"] = "raster_container_page_points"
            provenance["reasonCodes"] = list(dict.fromkeys(provenance["reasonCodes"] + ["pdf_ocr_unverified", *RELATIONSHIP_HOLDS]))
            provenance["structuralDisposition"] = "unverified"
        for image in extraction.get("images", []):
            page_number = image.get("pageNumber")
            artifact_path = Path(image["path"]).resolve()
            if type(page_number) is not int or not 1 <= page_number <= len(render_pages) or not artifact_path.is_relative_to(stage / "extracted") or not artifact_path.is_file():
                refuse("raster_artifact_unverified")
            image["sourceKind"] = "rendered_page_pixels"
            image["metadata"]["source_kind"] = "rendered_page_pixels"
            image["metadata"]["render_sha256"] = render_pages[page_number - 1]["artifact"]["sha256"]
            image["metadata"]["source_content_sha256"] = source_hash
            image["metadata"]["coordinate_space"] = "raster_container_page_points"
            # These are intermediate xrefs and placements, never original PDF
            # embedded-image identities. Preserve placement without that claim.
            image["metadata"].pop("xref", None)
            for region in image["metadata"].get("source_regions", []):
                region["source_kind"] = "rendered_page_pixels"
                region.pop("xref", None)
        # Charge rendering, raster container and extraction against ONE shared
        # artifact ceiling, including actual files, rather than two full budgets.
        artifacts = [item for item in stage.rglob("*") if item.is_file()]
        if len(artifacts) > limits["maxArtifacts"] or sum(item.stat().st_size for item in artifacts) > limits["maxArtifactBytes"]:
            refuse("artifact_budget_exceeded")
        result = {"version": VERSION, "status": "held_for_review", "sourceSha256": source_hash,
            "sourceByteLength": size, "pageCount": len(render_pages),
            "nativeLayerDisposition": "excluded_from_admitted_evidence", "activeContent": "absent", "encryption": "absent",
            "runtime": {"pythonVersion": sys.version.split()[0], "pymupdfVersion": str(fitz.VersionBind),
                        "mupdfVersion": str(fitz.VersionFitz), "tesseractVersion": tesseract_version,
                        "pillowVersion": package_version("Pillow"), "pytesseractVersion": package_version("pytesseract"),
                        "rendererScriptSha256": extractor.file_sha256(__file__),
                        "extractorScriptSha256": extractor.file_sha256(extractor.__file__)},
            "rasterContainer": {"path": str(raster_path), "sha256": digest(raster_bytes), "byteLength": len(raster_bytes)},
            "renderPages": render_pages, "extraction": extraction,
            "budgetUsage": {"pages": len(render_pages), "artifacts": len(artifacts),
                            "artifactBytes": sum(item.stat().st_size for item in artifacts),
                            "textBytes": extraction["budgetUsage"]["textBytes"]},
            "limitations": ["ocr_text_unverified", *RELATIONSHIP_HOLDS, "whole_source_semantic_fidelity_not_established"]}
        render_budget.ensure_result(json.dumps(result))
        deadline()
        return result
    except Exception as exc:
        if stage is not None and not isinstance(exc, InspectionTerminationUnverified):
            # Also cover failures of the OCR version probe or other subprocess
            # work before the extraction wait helper is reached.
            if not _windows_descendants_exited():
                raise InspectionTerminationUnverified("process_termination_unverified") from None
            shutil.rmtree(stage)
        if isinstance(exc, InspectionRefusal):
            raise
        if isinstance(exc, extractor.ExtractionBudgetExceeded):
            refuse("extraction_budget_exceeded")
        if extractor.is_memory_exhaustion(exc):
            refuse("memory_budget_exceeded")
        refuse("source_processing_failed")


def main(argv):
    if len(argv) not in (3, 4):
        print("Usage: inspect_rendered_pdf_source.py input.pdf artifact_dir [budget.json]", file=sys.stderr)
        return 1
    extractor.apply_memory_limit()
    try:
        limits = json.loads(Path(argv[3]).read_text(encoding="utf-8")) if len(argv) == 4 else None
        with redirect_stdout(sys.stderr):
            result = inspect_rendered_source(argv[1], argv[2], limits)
        print(json.dumps(result))
        return 0
    except InspectionRefusal as exc:
        print(json.dumps({"version": VERSION, "status": "refused", "reasonCode": str(exc)}))
        return 3


if __name__ == "__main__":
    sys.exit(main(sys.argv))
