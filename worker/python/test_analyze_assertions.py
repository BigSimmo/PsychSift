"""Assertion-tagging safe-logging guard: malformed-chunk warnings must never
carry chunk text (clinical guideline content), only a positional index."""

from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(__file__))
import analyze_assertions  # noqa: E402


class MalformedChunkWarningTests(unittest.TestCase):
    def test_warning_omits_chunk_text_and_names_the_index(self):
        secret_text = "Lithium levels above 1.5 mmol/L require urgent review of the dosing regimen."
        payload = {
            "chunks": [
                {"id": "chunk-1", "text": "fine"},
                {"text": secret_text},  # malformed: missing "id"
            ],
            # No targets: analyze_assertions.run() skips loading medspaCy models
            # entirely and takes the "nlp is None" branch for well-formed chunks.
            "targets": [],
        }
        with tempfile.TemporaryDirectory() as tmp:
            input_path = os.path.join(tmp, "input.json")
            output_path = os.path.join(tmp, "output.json")
            with open(input_path, "w", encoding="utf-8") as handle:
                json.dump(payload, handle)

            analyze_assertions.run(input_path, output_path)

            with open(output_path, "r", encoding="utf-8") as handle:
                result = json.load(handle)

        malformed_warnings = [w for w in result["warnings"] if "malformed" in w]
        self.assertEqual(len(malformed_warnings), 1)
        warning = malformed_warnings[0]
        self.assertNotIn(secret_text, warning)
        self.assertNotIn("Lithium", warning)
        self.assertIn("index 1", warning)


class RuntimeCompatibilityTests(unittest.TestCase):
    def test_default_pipeline_preserves_clinical_assertion_categories(self):
        # Exercise the real medspaCy/QuickUMLS/NLTK import and pipeline after
        # dependency updates; empty-target logging tests never construct it.
        cases = [
            ("Nil auditory hallucinations at present.", "auditory hallucinations", "negated_terms"),
            (
                "Suspected myocarditis in week three of clozapine titration.",
                "myocarditis", "uncertain_terms",
            ),
            (
                "Family history of bipolar disorder in her mother.",
                "bipolar disorder", "family_terms",
            ),
            (
                "Previous episode of catatonia responded well to electroconvulsive therapy.",
                "catatonia", "historical_terms",
            ),
        ]
        nlp = analyze_assertions.build_nlp([term for _, term, _ in cases])
        for index, (text, term, expected_category) in enumerate(cases):
            with self.subTest(category=expected_category):
                result = analyze_assertions.analyze_chunk(nlp, {"id": str(index), "text": text})
                self.assertIn(term, result[expected_category])
                for category in ("negated_terms", "uncertain_terms"):
                    if category != expected_category:
                        self.assertNotIn(term, result[category])


if __name__ == "__main__":
    unittest.main()
