# Docling lab — isolated extraction benchmark (packet S6 / B3)

A sandboxed, dispatch-only benchmark comparing [Docling] against this repo's legacy
document extractor, per `docs/rag-improvement/README.md` §B3. It exists to answer
**Gate B** — "non-inferior on all safety/exactness measures, improved on the
table-heavy metric, no budget breach" — before any worker shadow mode (packet B4)
is considered. This directory ships the **harness only**: the benchmark verdict is
a separate owner-reviewed run recorded in a copy of the Gate B decision record
(`docs/rag-improvement/gate-b-decision-record.md`).

## Hard boundaries (HANDOVER S6)

- The dependency lock is also copied into `Dockerfile.worker` for isolated shadow
  extraction. Changes to the lock, model manifest or verifier therefore select
  the existing required container CI job; the benchmark remains manual-only.
- The lab harness does not modify `worker/**`, `worker/python/requirements*`,
  `Dockerfile.worker`, `src/lib/extractors/document.ts`, or the database. The
  legacy extractor and the worker's hashed lock are **read-only comparators**.
- Benchmark runs are manual-only, via `eval/docling/run-lab.sh` on an operator's own
  machine (no dedicated CI workflow), and never part of `pr-required`.
- No provider calls, no live data: fixtures are synthetic, generated from the
  committed manifest, and the benchmark container has **no network**.

## Layout

| Path                                          | Role                                                                                          |
| --------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `fixtures/manifest.v2.json`                   | Committed ground truth: 36 synthetic fixtures across 6 difficulty strata + 10 hostile files   |
| `fixtures/generate_fixtures.py`               | Renders the corpus **from** the manifest (PyMuPDF, seeded, self-checking); output uncommitted |
| `requirements.in` / `requirements.txt`        | The lab's own hashed lock (`pip-compile --generate-hashes`, Python 3.11, CPU-only torch)      |
| `generate-lock.mjs`                           | Lock generator (`npm run generate:docling-lab-lock`)                                          |
| `Dockerfile`                                  | Sandbox image: two venvs, tesseract, docling models baked in, non-root `lab` user             |
| `run-lab.sh`                                  | Build + egress-blocked run wrapper (limits below), then host-side report assembly             |
| `harness/entry.sh`                            | In-container phases: fixtures → legacy pass → docling pass → score                            |
| `harness/run-legacy.ts`                       | Single-doc legacy runner (read-only `extractDocument` import)                                 |
| `harness/run_docling.py`                      | Single-doc docling runner (tesseract-CLI OCR, baked models)                                   |
| `harness/run_corpus.py`                       | Uniform per-doc driver: process-group timeouts, `wait4` peak RSS, bounded stream tails        |
| `harness/score.py`                            | Reduces raw output to aggregate measurements (scoring definitions in its docstring)           |
| `report/lab-contract.mjs`                     | Pure validation + aggregate report builder; imports the S4 report-key contract                |
| `report/lab-config.json`                      | `docling-lab-config-v1`: report-key sources, extractor pins, sandbox limits, output caps      |
| `report/build-report.mjs`                     | CLI: `--validate-only` (offline gate), `--raw/--out` (report), `--validate-record`            |
| `report/gate-b-decision-record.template.json` | Machine-readable Gate B template (all gates `pending_owner_run`)                              |
| `out/`                                        | Run output (gitignored): generated corpus, raw per-doc results, final report                  |

## Sandbox contract

Enforced by `run-lab.sh` + `harness/run_corpus.py`, pinned in
`report/lab-config.json` (change both together):

- **Egress block:** `docker run --network=none`. Everything the run needs (both
  venvs and the docling layout/TableFormer models) is baked into the image at
  build time — a model fetch at run time would fail, loudly.
- **Non-root:** dedicated `lab` user, `--cap-drop=ALL`,
  `--security-opt=no-new-privileges`, read-only root fs and repo mount; only
  `/out` and a 1 GB `/tmp` tmpfs are writable.
- **Resource limits:** 2 CPUs, 6 GB memory (no swap headroom), 256 pids.
  Per-document wall clock 120 s (hostile: 60 s) enforced by SIGKILL to the child's
  process group; whole run capped at 3600 s; workflow `timeout-minutes: 90`.
- **Output caps:** 64 MB per-document text/result, 512 MB total raw output, 1 MB
  final report — enforced in the harness, fail closed.
- Memory is enforced at the container cgroup and _measured_ per document as child
  peak RSS via `os.wait4`; an OOM-killed child records as a resource-bound
  failure. (`RLIMIT_AS` is deliberately not used — torch's address-space
  reservations trip it spuriously.)

## Fixtures

Synthetic only, S4 posture (`scripts/fixtures/rag-adversarial-cases.v1.json`):
invented drug names, letters-only `CANARY-…` leak detectors, real-source denylist
enforced by validation. Six strata × 6 fixtures — `text_simple`,
`layout_multicolumn`, `table_simple`, `table_heavy`, `scanned_ocr`,
`numeric_dense` — plus 10 hostile constructions (truncated, malformed xref, deep
nesting, 64 MB compression bomb, encrypted, zero-byte, absurd MediaBox,
mislabelled PNG, huge page tree, prompt-injection text with a planted canary).

Every assertion string (dose, unit, comparator threshold) is validated to be
literally present in its fixture's declared text, and the generator renders from
that same text then re-extracts and re-checks — ground truth cannot drift from the
corpus. Generation is deterministic (fixed seed, pinned PDF dates, `no_new_id`);
all outputs are byte-identical across runs except `hostile-encrypted`, whose
AES-256 salts are inherently random.

**v2 table-hardness corpus:** five `table_heavy` fixtures now exercise unruled
tables, real `colSpan` merged cells, rotated headers, and combinations of those
shapes. Representative fixtures for each shape carry number, number/unit, and
comparator assertions whose strings exist only in the declared source table, so
prose cannot accidentally satisfy the fixture contract. The `source` and
`tableId` fields establish fixture provenance only: numeric exactness still
searches document-wide extracted text and table cells, while table cell F1
measures structural association. The offline contract fails if a hard shape or
its provenance binding disappears.

This corpus change is not a quality verdict. The recorded Gate B result used the
earlier v1 corpus; a new owner-dispatched v2 benchmark and pre-agreed thresholds
are still required before any table-quality promotion argument.

## Reports

Aggregate-only, by construction: `report/build-report.mjs` rebuilds measurements
through a numeric allowlist (`lab-contract.mjs`), stamps the six-field programme
report key imported from `scripts/rag-adversarial-contract.mjs` (see
`docs/rag-improvement/baseline-record.md` §1), scans the serialised report for
canary tokens and real-source names, and fails closed on any hit — printing
counts, never tokens. Extractor identities (docling at the version pinned in
`eval/docling/requirements.txt`, `pymupdf==1.28.2`) travel outside the key, like S4's `promptVersion`.

## Running

```bash
# Offline contract gate (CI-covered; no docling install needed):
node eval/docling/report/build-report.mjs --validate-only

# Full benchmark — run locally (no dedicated CI workflow):
npm ci --include=dev
bash eval/docling/run-lab.sh
# → eval/docling/out/report/docling-lab-report.json

# Regenerate the hashed lock after editing requirements.in (needs Python 3.11 + PyPI):
npm run generate:docling-lab-lock
```

The docker build stage needs network (hash-verified PyPI + CPU-torch index
installs, docling model prefetch from HuggingFace); the benchmark run itself has
none. A local run needs Docker and ~10 GB free disk for the image.

## Interpreting a run (Gate B)

Copy `docs/rag-improvement/gate-b-decision-record.md` (and/or the JSON template),
**agree thresholds before dispatching**, then fill gate results from the uploaded
`docling-lab-report-<run id>` artifact. Validate a filled record with
`node eval/docling/report/build-report.mjs --validate-record <copy> --final`.

[Docling]: https://github.com/docling-project/docling
