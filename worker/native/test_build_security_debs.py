"""Offline fail-closed checks; importing the builder never invokes apt."""
import copy
from email.parser import Parser
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location("native_builder", Path(__file__).with_name("build_security_debs.py"))
builder = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(builder)


class BuilderTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        (self.root / "components").mkdir()
        (self.root / "fix.patch").write_bytes(b"pinned security fix\n")
        self.data = {
            "schema_version": 1, "source": "example", "source_version": "1.2-3",
            "backport_version": "1.2-3+psychsift1", "dsc_sha256": "a" * 64,
            "patches": [{"file": "fix.patch", "sha256": hashlib.sha256(b"pinned security fix\n").hexdigest(),
                         "upstream_commit": "b" * 40}], "runtime_packages": ["example"],
            "extra_build_packages": [], "test_commands": [["true"]],
            "change_summary": "Fix an upstream security issue.", "source_date_epoch": 1792497600,
        }

    def load(self):
        (self.root / "components/example.json").write_text(json.dumps(self.data))
        return builder.load_component(self.root, "example")

    def test_valid_descriptor(self):
        self.assertEqual(self.load(), self.data)

    def test_corrupt_patch_prevents_any_apt_execution(self):
        self.load()
        (self.root / "fix.patch").write_bytes(b"changed")
        with patch.object(builder, "run") as run:
            with self.assertRaisesRegex(ValueError, "SHA256 mismatch"):
                builder.build(self.root, "example", self.root / "out")
            run.assert_not_called()

    def test_invalid_descriptors(self):
        original = copy.deepcopy(self.data)
        for field, bad in (("schema_version", 2), ("backport_version", "9.0-1"),
                           ("source", "--allow-unauthenticated"), ("dsc_sha256", "bad"),
                           ("source_date_epoch", True), ("test_commands", ["shell string"]),
                           ("runtime_packages", ["example", "example"])):
            with self.subTest(field=field):
                self.data = dict(original, **{field: bad})
                with self.assertRaises(ValueError):
                    self.load()

    def test_patch_path_escape_and_absolute_path(self):
        for path in ("../outside.patch", "/etc/passwd"):
            with self.subTest(path=path):
                self.data["patches"][0]["file"] = path
                with self.assertRaises(ValueError):
                    self.load()

    def test_symlink_escape(self):
        (self.root / "escape").symlink_to("/etc/passwd")
        with self.assertRaises(ValueError):
            builder.checked_path(self.root, "escape")

    def select(self, controls):
        paths = [Path(str(index) + ".deb") for index in range(len(controls))]
        lookup = dict(zip(paths, [Parser().parsestr(x) for x in controls]))
        return builder.select_packages(paths, self.data, lookup.__getitem__)

    def control(self, source=None, version="1.2-3+psychsift1"):
        return (f"Package: example\nVersion: {version}\nArchitecture: amd64\n" +
                (f"Source: {source}\n" if source else ""))

    def test_select_preserves_binary_epoch_and_explicit_source_version(self):
        result = self.select([self.control("example (1.2-3+psychsift1)", "1:1.2-3+psychsift1")])
        self.assertEqual(result["example"][1]["Version"], "1:1.2-3+psychsift1")

    def test_wrong_source_or_source_version_fails(self):
        for source in ("other (1.2-3+psychsift1)", "example (1.2-3)"):
            with self.subTest(source=source), self.assertRaises(ValueError):
                self.select([self.control(source)])

    def test_missing_and_duplicate_packages_fail(self):
        for controls in ([], [self.control(), self.control()]):
            with self.subTest(controls=controls), self.assertRaises(ValueError):
                self.select(controls)

    def test_only_requested_runtime_packages_are_selected(self):
        extra = "Package: example-dev\nVersion: 1.2-3+psychsift1\nArchitecture: amd64\n"
        self.assertEqual(list(self.select([extra, self.control()])), ["example"])

    def installed_manifest(self):
        evidence = {"schema_version": 1, "source": "example", "backport_version": "1.2-3+psychsift1",
                    "runtime_packages": [{"name": "example", "version": "1:1.2-3+psychsift1",
                                          "source": "example", "source_version": "1.2-3+psychsift1"}]}
        (self.root / "security-build-example.json").write_text(json.dumps(evidence))

    def test_installed_verification_uses_exact_epoch_and_source(self):
        self.installed_manifest()
        with patch.object(builder, "run", return_value="example\t1:1.2-3+psychsift1\texample\t1.2-3+psychsift1\n") as run:
            builder.verify_installed(self.root)
            self.assertEqual(run.call_args.args[0][0], "dpkg-query")
            self.assertEqual(run.call_count, 1)

    def test_installed_version_or_source_mismatch_fails(self):
        self.installed_manifest()
        for value in ("example\t1.2-3+psychsift1\texample\t1.2-3+psychsift1\n",
                      "example\t1:1.2-3+psychsift1\tother\t1.2-3+psychsift1\n"):
            with self.subTest(value=value), patch.object(builder, "run", return_value=value):
                with self.assertRaisesRegex(ValueError, "provenance mismatch"):
                    builder.verify_installed(self.root)

    def test_missing_installed_evidence_fails(self):
        with self.assertRaisesRegex(ValueError, "no installed"):
            builder.verify_installed(self.root)


if __name__ == "__main__":
    unittest.main()
