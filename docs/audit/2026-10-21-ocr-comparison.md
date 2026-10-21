# Standard and optional table OCR comparison — 21 October 2026

Knowledge and records owns this report. It records an experiment on product
commit `56b69dca2487c6f7e6123f7d39e0a520d7946fe6` for PR #3716.
This publication adds documentation and aggregate results; it changes no product
code, resource limit, extraction default or clinical approval.

**Recommendation: keep `PDF_RASTER_TABLE_OCR` default-off.** The optional reader
demonstrated a small table transcription benefit, but this sample did not
establish better clinical-number or symbol accuracy across real documents.

## Cohort and execution

Thirty cases were processed under both flag settings: 60 full Python producer
CLI runs, with 180 predeclared checks assessed under each setting.

- Ten full pages from six clinical publications: WHO hypertension, IADPSG
  gestational diabetes, NICE NG133, CDC group B streptococcus prevention, USPSTF
  aspirin and WHO antenatal corticosteroids. Eight pages contain clinical tables
  and two contain dose algorithms. A seventh acquired PDF, NICE NG28, was not
  selected because its relevant material was narrative.
- All 20 official PubTabNet example table crops from 20 distinct PMC article IDs.
  They include mixed scientific domains and low-resolution text. Footnote bodies
  outside the crops are unavailable. They are a separate benchmark stratum, not
  20 clinical guidelines or full pages.
- There were 26 source families. The experiment did not reach a cohort of 30
  full clinical pages from 10 clinical publications and included no authentic
  field or camera scans. Full PDF pages were rasterized at 300 dpi. Unmodified
  crop pixels were wrapped in PDFs at a declared 72 dpi because their original
  effective DPI is unknown; upscaling cannot restore missing source detail.

The source roster, source-derived checks and input hashes were frozen before
OCR. Coding agents inspected source images before candidate outputs. Agents
adjudicated mode-masked text; an independent agent audited hashes, denominators,
exact observations and the changed clinical page. Output formatting can reveal
the intervention, so label masking is not formal clinical-study blinding.

Both settings received identical image-only PDF bytes and used the same runtime,
model and limits: 4 million OCR-render pixels and 60 seconds of OCR time per page,
a 100-second outer extraction watchdog and at most two producer subprocesses.
Pair submission order alternated; concurrent execution order was not guaranteed.
All 60 scored runs completed. No case was dropped or selectively retried. Paired
execution took 527.479 seconds; sourcing, reference preparation and adjudication
were additional work. Software/model identities and freeze hashes are retained
in the private evidence; aggregate results are in
[the accompanying JSON](2026-10-21-ocr-comparison.json).

## Results

| Selected checks meeting exact-text and required association criteria | Standard | Optional setting |
| --- | ---: | ---: |
| Clinical full pages | 28/60 | 29/60 |
| Benchmark table crops | 11/120 | 11/120 |
| Combined frozen checks | 39/180 | 40/180 |

There was one check improvement, zero check regressions and 179 tied checks.
At case level there was one improvement and 29 ties. The 29 tied pairs returned
byte-identical text, verified against raw JSON, text files and SHA256 receipts.

These are selected-check verification counts, not whole-document OCR accuracy
percentages. Nonpasses include actual digit/symbol corruption, strict typography
differences, unverifiable association and known reference limitations. They must
not all be described as clinical errors. Low-resolution mixed-domain crop scores
do not estimate production clinical error rates. Seven exact clinical matches
per mode and six exact benchmark matches per mode were correctly withheld from
passes because their required associations could not be verified.

The optional reader actually engaged on only one case: NICE NG133 physical
page 24, producing eight cell crops and two outside-prose crops for one table.
Its six checks improved from 5/6 to 6/6: `37 weeks lonwards` became
`37 weeks onwards`, with explicit delimited rows. Independent source and output
reviewers agreed. The selected improvement did not change a clinical number,
unit, inequality sign or superscript. An exploratory review outside the six
checks found an additional `NICE quideline` to `NICE guideline` correction and
no additional enhanced numeric/unit/qualifier regression; this is not a
whole-page accuracy certificate.

The other 29 optional-setting cases returned standard full-page OCR fallback.
Three receipts explicitly record a candidate `RuntimeError`; the precise
attempt/detector reason is not exposed for the other 26 nonengaged cases.
Nonengagement must not be counted as a completed successful candidate attempt.

## Remaining source-fidelity failures

Shared fallback outputs still corrupted important source-visible information:

| Source/check | Source text | Both returned outputs |
| --- | --- | --- |
| WHO hypertension p40 c2 | `≥20/10 mmHg` | `20/10 mmHg` |
| IADPSG p3 c2 | `≥7.0 mmol/l (126 mg/dl)` | `=7.0 mmol/l (126 mg/dl)` |
| IADPSG p3 c6 threshold fragment | `≥11.1 mmol/l (200 mg/dl)` | `211.1 mmol/l (200 mg/dl)` |
| CDC p16 c2 | `≥18 hours` | `218 hours` |

These are extraction observations, not clinical recommendations. OCR provenance
remained unverified. Successful process exit and readable prose do not verify
clinical figures. Leaving the current default unchanged does not endorse these
fallback outputs as clinically verified.

## Reference limitations and audit corrections

The frozen source truth and denominator remain unchanged. The audit found that
WHO ACS p10 c6 expected `within the next 7 days.` while the source and both
outputs say `in the next 7 days.` An initial adjudication also repeated that
incorrect expected wording as an observation. The superseded adjudication was
retained, the actual observation corrected, and both primary scores reduced by
one. This is a reference transcription mistake, not an OCR defect. A separately
documented posthoc correction of that single reference wording yields 40/180 and
41/180; the paired improvement remains one.

Two CDC p23 checks use dehyphenated reference words despite visible source/output
line-wrap hyphenation. Their strict failures are reference/presentation
limitations, not established clinical semantic changes. None of these three
checks was silently removed. Three ambiguous benchmark range-symbol checks were
excluded and replaced using source-only inspection before OCR, with an amendment
preserving the originals; two suspected image/HTML discrepancies were not scored.
All 20 benchmark cases remained in the roster.

Only Unicode NFC and whitespace runs were normalized. Every final claimed exact
match was additionally verified against returned text with numeric boundaries
and ordered fragments: `7.1` cannot match `17.1`, and `5` cannot match `15`,
`0.5` or `5.0`. Twelve literal-boundary controls passed. The scorer passed eight
normalization and three scoring smoke controls. Independent final accounting
found no unresolved discrepancy. Association judgments remain agent review,
not an automated proof of layout or clinical-owner sign-off.

## Controls and runtime limits

Fresh separate controls passed: paired native text stayed byte-identical without
OCR; a password-locked PDF was refused with exit 4; five existing mocked producer
tests covered missing-model refusal, transient candidate cleanup, late candidate
rejection, late full-page rejection and failed math-restoration cleanup. These
controls are outside the 30-case accuracy denominator. A frozen manifest note
named four focused tests; five were actually run, adding coverage without
rewriting the experiment's manifest.

Standard CLI median/max wall times were 11.139/48.117 seconds; optional-setting
median/max were 11.267/64.713 seconds. They include non-OCR artifact work, so
whole-CLI time can exceed the OCR-only 60-second limit. These concurrently
scheduled single attempts are descriptive timings, not a controlled speed
benchmark. Peak RSS was not measured. Time/pixel bounds are execution controls,
not accuracy claims.

## Follow-up and publication boundary

The next useful work is to diagnose the three candidate refusals, retain the
source-grounded number/comparator failures as regression evidence, and test
more genuinely eligible clinical tables with complete row/column/qualifier
truth. Broader acceptance still needs more clinical publications, authentic
degraded scans and full footnote context. A later implementation comparison
needs a new frozen run; tuning against this sample does not create a holdout.

Originals came from pinned public GitHub mirrors and the official PubTabNet
examples. Canonical-publication byte parity and each benchmark article's license
were not independently established. Original PDFs, scans, full extracted text,
per-check evidence, amendments and scratch tools are retained privately in the
task's saved execution artifact rather than redistributed in this commit.

No production ingestion, reindexing, database operation, provider inference,
deployment, extraction-default change or clinical sign-off occurred. This
publication-only addition did not repeat formatting, tests, lint, typecheck,
builds or hosted-CI observation; prior exact-product-head evidence remains
historical evidence rather than a new gate verdict.
