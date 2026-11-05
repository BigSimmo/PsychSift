"""Synthetic-only acceptance at the explicit rendered-source producer seam."""
import hashlib
import json
import os
from pathlib import Path
import tempfile
import textwrap
import time
import unittest
from unittest.mock import Mock, patch

import pymupdf as fitz

import inspect_rendered_pdf_source as inspector


class RenderedPdfSourceTests(unittest.TestCase):
    def _windows_memory_probe(self, cap=None):
        """Query the OS job, then exercise native commit in an isolated process."""
        import subprocess
        import sys
        code = textwrap.dedent("""
            import ctypes, json, subprocess, sys
            from ctypes import wintypes
            import inspect_rendered_pdf_source as inspector

            class Basic(ctypes.Structure):
                _fields_ = [("times", ctypes.c_longlong * 2), ("flags", wintypes.DWORD),
                            ("min_ws", ctypes.c_size_t), ("max_ws", ctypes.c_size_t),
                            ("active", wintypes.DWORD), ("affinity", ctypes.c_size_t),
                            ("priority", wintypes.DWORD), ("scheduling", wintypes.DWORD)]
            class Extended(ctypes.Structure):
                _fields_ = [("basic", Basic), ("io", ctypes.c_ulonglong * 6),
                            ("process", ctypes.c_size_t), ("job", ctypes.c_size_t),
                            ("peak_process", ctypes.c_size_t), ("peak_job", ctypes.c_size_t)]

            cap = json.loads(sys.argv[1])
            if cap is None:
                inspector._ensure_process_containment()
            else:
                inspector._ensure_process_containment(memory_limit_bytes=cap)
            kernel = ctypes.WinDLL("kernel32", use_last_error=True)
            class Memory(ctypes.Structure):
                _fields_ = [("cb", wintypes.DWORD), ("faults", wintypes.DWORD),
                            ("sizes", ctypes.c_size_t * 9)]
            kernel.GetCurrentProcess.restype = wintypes.HANDLE
            kernel.K32GetProcessMemoryInfo.argtypes = [wintypes.HANDLE, ctypes.c_void_p, wintypes.DWORD]
            kernel.K32GetProcessMemoryInfo.restype = wintypes.BOOL
            def private_commit():
                counters = Memory()
                counters.cb = ctypes.sizeof(counters)
                if not kernel.K32GetProcessMemoryInfo(kernel.GetCurrentProcess(),
                        ctypes.byref(counters), ctypes.sizeof(counters)):
                    raise RuntimeError("native_process_memory_query_failed")
                return counters.sizes[8]  # PROCESS_MEMORY_COUNTERS_EX.PrivateUsage
            kernel.QueryInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int,
                ctypes.c_void_p, wintypes.DWORD, ctypes.c_void_p]
            kernel.QueryInformationJobObject.restype = wintypes.BOOL
            def query():
                limits = Extended()
                if not kernel.QueryInformationJobObject(inspector._WINDOWS_JOB_HANDLE, 9,
                        ctypes.byref(limits), ctypes.sizeof(limits), None):
                    raise RuntimeError("native_job_query_failed")
                return limits
            limits = query()
            result = {"flags": limits.basic.flags, "process": limits.process, "job": limits.job}
            if cap is not None:
                kernel.VirtualAlloc.argtypes = [ctypes.c_void_p, ctypes.c_size_t, wintypes.DWORD, wintypes.DWORD]
                kernel.VirtualAlloc.restype = ctypes.c_void_p
                kernel.VirtualFree.argtypes = [ctypes.c_void_p, ctypes.c_size_t, wintypes.DWORD]
                kernel.VirtualFree.restype = wintypes.BOOL
                # Neither process requests 256 MiB. Holding 128 MiB while a child
                # requests another 128 MiB must hit aggregate commit, including
                # interpreter overhead. No pages need touching for commit proof.
                small = kernel.VirtualAlloc(None, 128 * 1024 * 1024, 0x3000, 4)
                result["smallAccepted"] = bool(small)
                permitted = query()
                result.update(permittedPeakProcess=permitted.peak_process, permittedPeakJob=permitted.peak_job)
                child_code = (
                    "import ctypes,json;from ctypes import wintypes;"
                    "k=ctypes.WinDLL('kernel32',use_last_error=True);"
                    "k.VirtualAlloc.argtypes=[ctypes.c_void_p,ctypes.c_size_t,wintypes.DWORD,wintypes.DWORD];"
                    "k.VirtualAlloc.restype=ctypes.c_void_p;"
                    "M=type('Memory',(ctypes.Structure,),{'_fields_':[('cb',wintypes.DWORD),('faults',wintypes.DWORD),('sizes',ctypes.c_size_t*9)]});"
                    "k.GetCurrentProcess.restype=wintypes.HANDLE;"
                    "k.K32GetProcessMemoryInfo.argtypes=[wintypes.HANDLE,ctypes.c_void_p,wintypes.DWORD];"
                    "m=M();m.cb=ctypes.sizeof(m);"
                    "assert k.K32GetProcessMemoryInfo(k.GetCurrentProcess(),ctypes.byref(m),ctypes.sizeof(m));"
                    "before=m.sizes[8];"
                    "ctypes.set_last_error(0);allocation=k.VirtualAlloc(None,128*1024*1024,0x3000,4);error=ctypes.get_last_error();"
                    "assert k.K32GetProcessMemoryInfo(k.GetCurrentProcess(),ctypes.byref(m),ctypes.sizeof(m));"
                    "print(json.dumps({'accepted':bool(allocation),'before':before,'after':m.sizes[8],'error':error}))"
                )
                result["producerCommitBeforeChild"] = private_commit()
                child = subprocess.run([sys.executable, "-c", child_code], capture_output=True,
                                       text=True, timeout=5, creationflags=subprocess.CREATE_NO_WINDOW)
                if child.returncode != 0:
                    raise RuntimeError("native_child_memory_probe_failed")
                result["childCommit"] = json.loads(child.stdout)
                # The over-cap request must fail atomically, never committing
                # its requested bytes. All allocations die with this process.
                result["producerCommitBeforeRefusal"] = private_commit()
                ctypes.set_last_error(0)
                large = kernel.VirtualAlloc(None, cap + 64 * 1024 * 1024, 0x3000, 4)
                result["overCapError"] = ctypes.get_last_error()
                result["producerCommitAfterRefusal"] = private_commit()
                result["overCapRefused"] = not large
                observed = query()
                result.update(peakProcess=observed.peak_process, peakJob=observed.peak_job)
                for allocation in (small, large):
                    if allocation:
                        kernel.VirtualFree(allocation, 0, 0x8000)
            print(json.dumps(result))
        """)
        result = subprocess.run([sys.executable, "-c", code, json.dumps(cap)],
                                cwd=Path(inspector.__file__).parent, capture_output=True,
                                text=True, timeout=15, creationflags=subprocess.CREATE_NO_WINDOW)
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout)

    @unittest.skipUnless(os.name == "nt", "Windows Job Object memory limits")
    def test_windows_job_has_native_process_and_aggregate_commit_limits(self):
        observed = self._windows_memory_probe()
        self.assertEqual(observed["flags"] & 0x2300, 0x2300)
        expected = inspector.extractor.DEFAULT_MAX_MEMORY_MB * 1024 * 1024
        self.assertEqual(observed["process"], expected)
        self.assertEqual(observed["job"], expected)

    @unittest.skipUnless(os.name == "nt", "Windows Job Object memory limits")
    def test_windows_job_refuses_native_over_cap_commit(self):
        cap = 256 * 1024 * 1024
        observed = self._windows_memory_probe(cap)
        self.assertEqual(observed["flags"] & 0x2300, 0x2300)
        self.assertEqual((observed["process"], observed["job"]), (cap, cap))
        self.assertTrue(observed["smallAccepted"])
        child = observed["childCommit"]
        self.assertFalse(child["accepted"])
        self.assertNotEqual(child["error"], 0)
        self.assertLess(child["before"] + 128 * 1024 * 1024, cap)
        self.assertGreater(observed["producerCommitBeforeChild"] + child["before"] + 128 * 1024 * 1024, cap)
        self.assertLessEqual(observed["producerCommitBeforeChild"] + child["after"], cap)
        self.assertLessEqual(child["after"], child["before"] + 64 * 1024)
        self.assertTrue(observed["overCapRefused"])
        self.assertNotEqual(observed["overCapError"], 0)
        self.assertLessEqual(observed["producerCommitAfterRefusal"], cap)
        self.assertLessEqual(observed["producerCommitAfterRefusal"], observed["producerCommitBeforeRefusal"] + 64 * 1024)
        self.assertGreater(observed["peakProcess"], 0)
        self.assertGreater(observed["peakJob"], 0)
        self.assertLessEqual(observed["permittedPeakProcess"], cap)
        self.assertLessEqual(observed["permittedPeakJob"], cap)
        # The native peak-job counter exceeded the configured limit after a
        # refused request on the test host. Public API docs do not specify that
        # accounting sequence: do not assert or claim an historical peak bound.
        # PrivateUsage snapshots above measure successful private commit only;
        # they are not an atomic total or proof of every intermediate state.

    def test_private_memory_cap_cannot_be_disabled_or_widened(self):
        for cap in (None, False, 0, -1, "256", inspector.DEFAULT_PROCESS_MEMORY_BYTES + 1):
            with self.subTest(cap=cap), self.assertRaisesRegex(inspector.InspectionRefusal, "budget_invalid"):
                inspector._ensure_process_containment(memory_limit_bytes=cap)

    @unittest.skipUnless(os.name == "nt", "Windows Job Object memory limits")
    def test_unsupported_job_memory_limits_refuse_before_source_open(self):
        import ctypes
        kernel = Mock()
        kernel.CreateJobObjectW.return_value = 123
        kernel.SetHandleInformation.return_value = True
        kernel.SetInformationJobObject.return_value = False
        with patch.object(inspector, "_WINDOWS_JOB_HANDLE", None), \
                patch.object(inspector, "_WINDOWS_JOB_MEMORY_LIMIT", None), \
                patch.object(ctypes, "WinDLL", return_value=kernel), \
                patch.object(inspector.fitz, "open") as source_open:
            with self.assertRaisesRegex(inspector.InspectionRefusal, "process_containment_unavailable"):
                inspector.inspect_rendered_source("not-opened.pdf", "not-created")
            kernel.AssignProcessToJobObject.assert_not_called()
            kernel.CloseHandle.assert_called_once_with(123)
            source_open.assert_not_called()

    @unittest.skipUnless(os.name == "nt", "Windows Job Object containment")
    def test_windows_job_contains_children_when_producer_is_terminated(self):
        import ctypes
        from ctypes import wintypes
        import subprocess
        import sys
        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
        kernel.OpenProcess.restype = wintypes.HANDLE
        kernel.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
        kernel.WaitForSingleObject.restype = wintypes.DWORD
        kernel.TerminateProcess.argtypes = [wintypes.HANDLE, wintypes.UINT]
        kernel.CloseHandle.argtypes = [wintypes.HANDLE]
        with tempfile.TemporaryDirectory() as folder:
            marker = Path(folder) / "owned-tree.json"
            grandchild_code = "import time;time.sleep(60)"
            child_code = (
                "import subprocess,sys,os,time,json;from pathlib import Path;"
                f"g=subprocess.Popen([sys.executable,'-c',{grandchild_code!r}],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,creationflags=subprocess.CREATE_NO_WINDOW);"
                "Path(sys.argv[1]).write_text(json.dumps({'child':os.getpid(),'grandchild':g.pid}));time.sleep(60)"
            )
            producer_code = (
                "import sys,subprocess,time;"
                f"sys.path.insert(0,{str(Path(inspector.__file__).parent)!r});"
                "import inspect_rendered_pdf_source as i;i._ensure_process_containment();"
                f"subprocess.Popen([sys.executable,'-c',{child_code!r},{str(marker)!r}],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,creationflags=subprocess.CREATE_NO_WINDOW);"
                "time.sleep(60)"
            )
            process = subprocess.Popen([sys.executable, "-c", producer_code], stdout=subprocess.DEVNULL,
                                       stderr=subprocess.DEVNULL, creationflags=subprocess.CREATE_NO_WINDOW)
            handles = []
            try:
                deadline = time.monotonic() + 5
                while not marker.exists() and process.poll() is None and time.monotonic() < deadline:
                    time.sleep(0.02)
                self.assertTrue(marker.exists(), "producer containment unavailable; no accepted child tree")
                ids = json.loads(marker.read_text())
                for pid in ids.values():
                    handle = kernel.OpenProcess(0x100001, False, pid)  # synchronize + terminate, owned only
                    self.assertTrue(handle)
                    handles.append(handle)
                    self.assertEqual(kernel.WaitForSingleObject(handle, 0), 258)  # still running
                process.terminate()  # native TerminateProcess, not cooperative Python cleanup
                process.wait(timeout=5)
                for handle in handles:
                    self.assertEqual(kernel.WaitForSingleObject(handle, 5000), 0)
            finally:
                if process.poll() is None:
                    process.kill()
                    process.wait(timeout=5)
                for handle in handles:
                    if kernel.WaitForSingleObject(handle, 0) == 258:
                        kernel.TerminateProcess(handle, 1)
                        kernel.WaitForSingleObject(handle, 5000)
                    kernel.CloseHandle(handle)

    def make_source(self, path, change=None, pages=1):
        with fitz.open() as doc:
            for index in range(pages):
                page = doc.new_page(width=400, height=300)
                page.insert_text((40, 100), f"VISIBLE PAGE {index + 1} END 73", fontsize=20)
                if change:
                    change(doc, page)
            doc.save(path)

    def test_final_pixels_exclude_hidden_native_text_tables_and_original_images(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / "source.pdf"
            with fitz.open() as hidden_image:
                hidden_image.new_page(width=300, height=80).insert_text(
                    (10, 40), "FORBIDDEN IMAGE", fontsize=22)
                image = hidden_image[0].get_pixmap().tobytes("png")
            with fitz.open() as doc:
                page = doc.new_page(width=500, height=400)
                page.insert_text((40, 70), "FORBIDDEN NATIVE", fontsize=22)
                for x in (40, 180, 320):
                    page.draw_line((x, 95), (x, 190))
                for y in (95, 140, 190):
                    page.draw_line((40, y), (320, y))
                page.insert_text((50, 125), "FORBIDDEN TABLE", fontsize=12)
                page.insert_image(fitz.Rect(40, 200, 340, 280), stream=image)
                page.draw_rect(fitz.Rect(0, 0, 500, 300), color=None, fill=(1, 1, 1))
                page.insert_text((40, 350), "VISIBLE SOURCE 47", fontsize=24)
                doc.save(source)
            target = Path(folder) / "artifacts"
            result = inspector.inspect_rendered_source(source, target)
            self.assertEqual(result["version"], "rendered-pdf-source-v1")
            self.assertEqual(result["sourceSha256"], "sha256:" + hashlib.sha256(source.read_bytes()).hexdigest())
            self.assertEqual(result["sourceByteLength"], source.stat().st_size)
            self.assertEqual(result["nativeLayerDisposition"], "excluded_from_admitted_evidence")
            self.assertEqual(result["pageCount"], 1)
            self.assertIn("VISIBLE SOURCE 47", result["extraction"]["pages"][0]["text"])
            self.assertNotIn("FORBIDDEN", json.dumps(result))
            render = result["renderPages"][0]["artifact"]
            self.assertEqual(render["sha256"], "sha256:" + hashlib.sha256(Path(render["path"]).read_bytes()).hexdigest())
            self.assertEqual(render["byteLength"], Path(render["path"]).stat().st_size)
            self.assertEqual(result["renderPages"][0]["unresolvedFeatureHolds"],
                             ["table_relationships_unverified", "diagram_relationships_unverified"])
            provenance = result["extraction"]["pages"][0]["metadata"]["source_provenance"]
            self.assertEqual(provenance["sourceContentSha256"], result["sourceSha256"])
            self.assertEqual(provenance["producer"]["contractVersion"], "pdf-rendered-page-source-v1")
            self.assertEqual(provenance["renderSha256"], render["sha256"])
            self.assertEqual(result["activeContent"], "absent")
            self.assertEqual(result["encryption"], "absent")
            self.assertTrue(result["runtime"]["tesseractVersion"])
            for page in result["extraction"]["pages"]:
                self.assertNotIn("pdf_runtime_identity_unknown", page["metadata"]["source_provenance"]["reasonCodes"])
            # Every downstream bitmap must also descend from the final pixels.
            import pytesseract
            from PIL import Image
            pytesseract.pytesseract.tesseract_cmd = r"C:\Program Files\Tesseract-OCR\tesseract.exe"
            for artifact in result["extraction"]["images"]:
                with Image.open(artifact["path"]) as bitmap:
                    self.assertNotIn("FORBIDDEN", pytesseract.image_to_string(bitmap, timeout=20))

    def test_all_pages_and_original_geometry_are_retained_without_native_provenance(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / "source.pdf"
            self.make_source(source, lambda doc, page: page.set_rotation(90), pages=2)
            result = inspector.inspect_rendered_source(source, Path(folder) / "out")
            self.assertEqual([page["pageNumber"] for page in result["renderPages"]], [1, 2])
            self.assertEqual([page["pageNumber"] for page in result["extraction"]["pages"]], [1, 2])
            self.assertEqual([page["originalGeometry"]["rotation"] for page in result["renderPages"]], [90, 90])
            for page in result["extraction"]["pages"]:
                provenance = page["metadata"]["source_provenance"]
                self.assertNotIn("nativeTextSha256", provenance)
                self.assertEqual(provenance["coordinateSpace"], "raster_container_page_points")
                self.assertEqual(provenance["rasterContainerSha256"], result["rasterContainer"]["sha256"])
            # Saved intermediate itself has no native text, tables or original
            # resources; each embedded image equals its final rendered page.
            with fitz.open(result["rasterContainer"]["path"]) as raster:
                for page, render in zip(raster, result["renderPages"]):
                    self.assertEqual(page.get_text(), "")
                    self.assertEqual(len(page.find_tables().tables), 0)
                    self.assertEqual(len(page.get_images()), 1)
                    from PIL import Image, ImageChops
                    import io
                    image = raster.extract_image(page.get_images()[0][0])["image"]
                    with Image.open(io.BytesIO(image)) as embedded, Image.open(render["artifact"]["path"]) as expected:
                        self.assertIsNone(ImageChops.difference(embedded.convert("RGB"), expected.convert("RGB")).getbbox())

    def test_active_inactive_and_ambiguous_features_fail_closed(self):
        changes = {
            "javascript": lambda doc, page: doc.xref_set_key(doc.pdf_catalog(), "OpenAction", "<</S/JavaScript/JS(synthetic)>>"),
            "attachment": lambda doc, page: doc.embfile_add("synthetic.txt", b"synthetic"),
            "annotation": lambda doc, page: page.add_text_annot((20, 20), "synthetic annotation"),
            "optional_layers": lambda doc, page: doc.add_ocg("synthetic hidden layer", on=False),
            "inactive_type3": lambda doc, page: doc.update_object(doc.get_new_xref(), "<</Type/Font/Subtype/Type3>>"),
            "inactive_unsafe_image": lambda doc, page: doc.update_object(doc.get_new_xref(), "<</Type/XObject/Subtype/Image/Width 100000/Height 100000>>"),
        }
        for name, change in changes.items():
            with self.subTest(name=name), tempfile.TemporaryDirectory() as folder:
                source = Path(folder) / "source.pdf"
                self.make_source(source, change)
                target = Path(folder) / "out"
                with self.assertRaises(inspector.InspectionRefusal):
                    inspector.inspect_rendered_source(source, target)
                self.assertFalse(target.exists())

    def test_even_empty_password_encryption_is_refused(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / "locked.pdf"
            with fitz.open() as doc:
                doc.new_page()
                doc.save(source, encryption=fitz.PDF_ENCRYPT_AES_256, owner_pw="synthetic-owner", user_pw="")
            with self.assertRaisesRegex(inspector.InspectionRefusal, "encrypted"):
                inspector.inspect_rendered_source(source, Path(folder) / "out")

    def test_direct_javascript_link_action_is_not_mistaken_for_an_inert_link(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / "source.pdf"
            def attach(doc, page):
                page.insert_link({"kind": fitz.LINK_URI, "from": fitz.Rect(10, 10, 100, 30),
                                  "uri": "https://example.invalid/"})
                link = page.get_links()[0] if page.get_links() else None
                # Reload because PyMuPDF links do not expose fresh xrefs until
                # page reload; modify the actual parsed link dictionary.
                page = doc.reload_page(page)
                xref = page.get_links()[0]["xref"]
                doc.xref_set_key(xref, "A", "<</S/JavaScript/JS(synthetic)>>")
            self.make_source(source, attach)
            with self.assertRaisesRegex(inspector.InspectionRefusal, "active_content"):
                inspector.inspect_rendered_source(source, Path(folder) / "out")

    def test_indirect_standard_list_attributes_are_not_mistaken_for_actions(self):
        with fitz.open() as document:
            document.new_page(width=100, height=100)
            attribute = document.get_new_xref()
            document.update_object(attribute, "<</O/List/ListNumbering/Decimal>>")
            element = document.get_new_xref()
            document.update_object(element, f"<</Type/StructElem/S/L/A {attribute} 0 R>>")
            # Exercise the structural parser only: no OCR, real sources or model.
            result = inspector._check_structure(document, inspector.DEFAULT_LIMITS, lambda: None)
            self.assertEqual(len(result), 1)

    def test_forged_structure_attributes_still_refuse_actions_and_unknown_forms(self):
        payloads = [
            "<</O/List/ListNumbering/Decimal/S/URI/URI(https://example.invalid/)>>",
            "<</O/List/ListNumbering/Decimal/JS(synthetic)>>",
            "<</O/List/ListNumbering/Decimal/Next<</S/JavaScript/JS(synthetic)>>>>",
            "<</O/List/ListNumbering<</S/JavaScript/JS(synthetic)>>>>",
            "<</O/List/ListNumbering/Unknown>>",
            "<</O/Unknown/ListNumbering/Decimal>>",
            "<</O/List>>",
            "<</S/URI/URI(https://example.invalid/)>>",
            "<</S/JavaScript/JS(synthetic)>>",
        ]
        for payload in payloads:
            with self.subTest(payload=payload), fitz.open() as document:
                document.new_page(width=100, height=100)
                attribute = document.get_new_xref()
                document.update_object(attribute, payload)
                element = document.get_new_xref()
                document.update_object(element, f"<</Type/StructElem/S/L/A {attribute} 0 R>>")
                with self.assertRaisesRegex(inspector.InspectionRefusal, "active_content"):
                    inspector._check_structure(document, inspector.DEFAULT_LIMITS, lambda: None)

    def test_unrecognized_structure_attribute_forms_fail_closed(self):
        for attribute in ("<</O/List/ListNumbering/Decimal>>", "[]", "9999 0 R", "null", "/List", "(synthetic)"):
            with self.subTest(attribute=attribute), fitz.open() as document:
                document.new_page(width=100, height=100)
                element = document.get_new_xref()
                document.update_object(element, f"<</Type/StructElem/S/L/A {attribute}>>")
                with self.assertRaisesRegex(inspector.InspectionRefusal, "active_content"):
                    inspector._check_structure(document, inspector.DEFAULT_LIMITS, lambda: None)
        for structure in ("", "/S/URI", "/S/JavaScript", "/S(synthetic)"):
            with self.subTest(structure=structure), fitz.open() as document:
                document.new_page(width=100, height=100)
                attribute = document.get_new_xref()
                document.update_object(attribute, "<</O/List/ListNumbering/Decimal>>")
                element = document.get_new_xref()
                document.update_object(element, f"<</Type/StructElem{structure}/A {attribute} 0 R>>")
                with self.assertRaisesRegex(inspector.InspectionRefusal, "active_content"):
                    inspector._check_structure(document, inspector.DEFAULT_LIMITS, lambda: None)

    def test_budget_refusals_cleanup_only_owned_files(self):
        for limits in ({"maxPages": 1}, {"maxSourceBytes": 1}, {"maxRenderPixels": 1},
                       {"maxArtifacts": 2}, {"maxArtifactBytes": 1000}, {"maxResultBytes": 10},
                       {"totalTimeoutMs": 1}, {"maxPages": True}, {"maxPages": 5001}):
            with self.subTest(limits=limits), tempfile.TemporaryDirectory() as folder:
                source = Path(folder) / "source.pdf"
                self.make_source(source, pages=2)
                target = Path(folder) / "out"
                target.mkdir()
                sentinel = target / "unrelated.txt"
                sentinel.write_text("preserved", encoding="utf-8")
                with self.assertRaises(inspector.InspectionRefusal):
                    inspector.inspect_rendered_source(source, target, limits)
                self.assertEqual(list(target.iterdir()), [sentinel])
                self.assertEqual(sentinel.read_text(encoding="utf-8"), "preserved")

    def test_total_extraction_deadline_kills_owned_child_and_cleans_artifacts(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / "source.pdf"
            self.make_source(source)
            target = Path(folder) / "out"
            # The public OS subprocess boundary simulates a blocked extractor;
            # no extraction implementation is mocked or allowed to write text.
            import subprocess
            with patch.object(subprocess, "Popen") as popen, \
                 patch.object(subprocess, "run", return_value=subprocess.CompletedProcess([], 0, "tesseract 5.4.0\n", "")) as run, \
                 patch.object(inspector.os, "killpg", create=True) as killpg:
                popen.return_value.pid = 123456789
                popen.return_value.wait.side_effect = [subprocess.TimeoutExpired("extractor", 1), 0]
                with self.assertRaisesRegex(inspector.InspectionRefusal, "timeout"):
                    inspector.inspect_rendered_source(source, target)
                self.assertEqual(list(target.iterdir()), [])
                if inspector.os.name == "nt":
                    self.assertEqual(run.call_args_list[-1].args[0],
                                     ["taskkill", "/PID", "123456789", "/T", "/F"])
                else:
                    killpg.assert_called_once_with(123456789, inspector.signal.SIGKILL)

    def test_unavailable_containment_refuses_before_any_child_or_artifact(self):
        import subprocess
        with tempfile.TemporaryDirectory() as folder, \
                patch.object(inspector, "_ensure_process_containment", side_effect=inspector.InspectionRefusal("process_containment_unavailable")), \
                patch.object(subprocess, "Popen") as popen, patch.object(subprocess, "run") as run:
            target = Path(folder) / "out"
            with self.assertRaisesRegex(inspector.InspectionRefusal, "process_containment_unavailable"):
                inspector.inspect_rendered_source(Path(folder) / "not-opened.pdf", target)
            popen.assert_not_called()
            run.assert_not_called()
            self.assertFalse(target.exists())

    def test_version_probe_failure_preserves_stage_if_descendants_are_unverified(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / "synthetic.pdf"
            self.make_source(source)
            target = Path(folder) / "out"
            with patch.object(inspector, "_ocr_runtime", side_effect=inspector.InspectionRefusal("ocr_runtime_unverified")), \
                    patch.object(inspector, "_windows_descendants_exited", return_value=False):
                with self.assertRaisesRegex(inspector.InspectionRefusal, "process_termination_unverified"):
                    inspector.inspect_rendered_source(source, target)
            self.assertTrue(any(target.iterdir()))

    @unittest.skipUnless(os.name == "nt", "Windows taskkill failure containment")
    def test_unverified_child_termination_preserves_stage_until_job_exit(self):
        import subprocess
        cases = [
            (subprocess.CompletedProcess([], 1), [subprocess.TimeoutExpired("extractor", 1), 0]),
            (subprocess.TimeoutExpired("taskkill", 1), [subprocess.TimeoutExpired("extractor", 1), 0]),
            (subprocess.CompletedProcess([], 0), [subprocess.TimeoutExpired("extractor", 1), subprocess.TimeoutExpired("extractor", 1)]),
        ]
        for killer_result, waits in cases:
            with self.subTest(killer_result=killer_result), tempfile.TemporaryDirectory() as folder:
                source = Path(folder) / "synthetic.pdf"
                self.make_source(source)
                target = Path(folder) / "out"
                with patch.object(subprocess, "Popen") as popen, \
                        patch.object(subprocess, "run", side_effect=[subprocess.CompletedProcess([], 0, "tesseract 5.4.0\n", ""), killer_result]), \
                        patch.object(inspector, "_windows_descendants_exited", return_value=False):
                    popen.return_value.pid = 123456789
                    popen.return_value.wait.side_effect = waits
                    with self.assertRaisesRegex(inspector.InspectionRefusal, "process_termination_unverified"):
                        inspector.inspect_rendered_source(source, target)
                    self.assertTrue(any(target.iterdir()), "uncertain live descendant stage must not be cleaned")
                    if isinstance(killer_result, subprocess.TimeoutExpired) or killer_result.returncode != 0:
                        popen.return_value.kill.assert_called_once()

    def test_missing_page_in_child_result_is_refused_and_cleaned(self):
        import subprocess
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / "source.pdf"
            self.make_source(source)
            target = Path(folder) / "out"
            with patch.object(subprocess, "Popen") as popen, \
                 patch.object(subprocess, "run", return_value=subprocess.CompletedProcess([], 0, "tesseract 5.4.0\n", "")):
                def finish(*args, **kwargs):
                    Path(popen.call_args.args[0][4]).write_text('{"pages": []}', encoding="utf-8")
                    return 0
                popen.return_value.wait.side_effect = finish
                popen.return_value.returncode = 0
                with self.assertRaisesRegex(inspector.InspectionRefusal, "extraction_page_population_mismatch"):
                    inspector.inspect_rendered_source(source, target)
                self.assertEqual(list(target.iterdir()), [])


if __name__ == "__main__":
    unittest.main()
