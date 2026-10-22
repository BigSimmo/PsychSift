# RAG improvement programme — multi-session handover

**Status:** programme evidence and packet reference (original preparation 2026-08-17;
dated outcomes retained below). The programme design reference is
[README.md](README.md); protected-surface rules live in `docs/rag-behaviour/`.
This file retains dated programme outcomes, work packets and prompts. Current task ownership,
lifecycle, blockers and next action follow [task-receipts.md](../task-receipts.md).
Do not use the historical packet table as a competing live task board. The coordinator-side
layer — who dispatches sessions, merges their
PRs, and approves canaries, plus the babysit playbook — lives in
[COORDINATION.md](COORDINATION.md).

_Updated 2026-10-21 — routed lifecycle to the canonical task process; Documentation owns._

**How to use this file (for the agent reading it at session start):**

1. Read your session's packet below in full, then the matching section of
   [README.md](README.md), then `docs/rag-behaviour/README.md` (and its safeguards page if
   you will touch a protected surface).
2. Run the session-start checklist (§4).
3. Do only your packet. If you finish early, stop — do not start the next packet in the same
   session; context quality drops and the PR-per-session discipline breaks.
4. Before ending: run the session-end checklist (§5), update the existing task checkpoint
   and prepare its receipt under [task-receipts.md](../task-receipts.md). Add programme
   evidence here only when a new measured outcome belongs to the packet record.

---

## 1. Programme state snapshot (as of 2026-08-17)

- **Landed:** the reviewed/updated programme guide (`docs/rag-improvement/README.md`,
  PR #1895, merged 2026-08-13).
- **Landed:** **A1 phase 1 was PR #1899** (`feat(rag): record the structured
generation-quality verdict on fallback`), merged 2026-08-13 — structured
  `GenerationQualityError` diagnostics, `generation_quality_gate:*` retry reasons, fallback
  metadata, and the provider-safe `scripts/probe-generation-quality.ts` probe. Sessions S1+
  must treat that content as existing code. Do not re-implement it.
- **Landed:** **A1 phase 2 (S1) was PR #2022**, merged 2026-08-17 as squash `2bd146eed` —
  ladder rung 1. On healthy retrieval latency, generation-quality gates still dominated
  source-only fallbacks (eight owner-approved live probes; the decisive sertraline case
  generated in 3.9 s and still fell back), so route budgets stayed untouched. Two
  text-normalisation artefacts were fixed: markdown-emphasis atom splitting
  (`foldMarkdownEmphasis` in `src/lib/answer-verification.ts`) and PDF visual-wrap
  claim-segment fragmentation (`reflowBoundedSourceLines(..., { requireContinuationStart })`
  in `src/lib/rag/rag-source-segmentation.ts`, used by `src/lib/rag/rag-claim-support.ts`).
  Post-merge canary pair: baseline run 31964560921 (`8f8d111ab`) → post run 32025082010
  (`2bd146eed`), document/content recall 1.0/1.0, zero per-case rr regressions, answer gate
  44/44 (recorded here as 45/45 until S5 reconciled the denominator against the run's own
  report — `rag-eval-cases.ts` defines 44 cases; see `baseline-record.md` §3). **Residuals recorded, not fixed:** R1 unbudgeted strong escalation
  (`fast_unsupported_retry_strong` launches strong generation into the fast route's leftover
  ~10–13 s; now the dominant lithium fallback mode as `provider_timeout`) → packet S1b; R2
  directive-normativity strictness (`normativeDirectiveActions` lacks "usual / recommended …
  dose is …" phrasing) and R3 topic-overlap dilution → packet S1c.
- **Landed 2026-08-17 (S1b, S1c, S1d, G1) — canary state 2026-08-18:** the S1c follow-up
  #2065 (condition-first for/in binding) regressed `agitation-im-po-route-short-terms` live and
  was reverted by PR #2088; the confirmation run 32100681177 on `4ea310e48` is green (recall
  1.0/1.0, zero rr regressions, answer gate 44/44) and is the baseline half of the S2 canary
  pair. **Do not reintroduce condition-first for/in binding.** S2 (A2 + A3) merged 2026-08-18 as
  squash `dda4956ff`: `src/lib/rag/answer-composition.ts`, prompt `clinical-rag-answer-v19`,
  `answerSections.maxItems` 6, adversarial baseline re-captured for v19 (`baseline-record.md` §4). Its canary
  pair 32100681177 -> 32111839806 is green, and `eval:answer-quality` was neutral within
  nondeterminism (owner blinded read **complete 2026-08-21** — v18 `4ea310e48` 3 / v19
  `cdfcbaccd` 3 / tie 24 / neither 0, no measurable difference; caveats in the §2 S2 row).
  **Track A is complete with S3 (A4).**
- **Gate E tooling landed (2026-08-21, offline-only; `#E0N0QC`):** `eval-answer-quality`
  gained `--extra-cases` (owner capture-only questions) and gate-outcome dump fields, and
  `scripts/blind-answer-pairs.ts` builds the blinded reading pack / verdict sheet /
  assignment key and unblinds verdicts. **Gate E is CLOSED (2026-08-21):** the paid
  v18-vs-v19 capture and the owner's blinded read are both complete — tally and dump digests
  in the §2 Gate E row; `#E0N0QC` was already resolved on main at `1cc0d2987`. §2a is
  retained as the historical procedure, not as pending work; re-running it is a fresh
  provider-backed capture and needs owner approval on its own terms.
- **Owner decisions 2026-08-17:** (1) **R1 before S2** — A2/A3 add answer length, and length
  under the still-unbudgeted strong retry pushes more dosing queries into `provider_timeout`,
  not fewer; (2) **governance Option B** for the document-summary `similarity: 1` question
  (see G1 below): add a provenance tag, keep the confidence label, no canary.
- **Sibling stream sharing `src/lib/rag/**`:** ledger `#212` runtime row contracts. T1 (PR
  #1946, `rag.ts`), T2 (PR #1981, `rag-candidate-sources.ts`) and T3 (PR #2023,
  `src/app/api/**`, squash `440a34f71`) are merged; the RAG surface is complete for that
  defect class. T4 (`worker/main.ts`) is its own PR. Any RAG-surface packet here must not
  re-touch the row-contract helpers in `src/lib/rag/rag-row-contracts.ts` except G1.
- **Key issue refs:** `#231` (source-only degradation with healthy retrieval — A1), `#001`
  (semantic rerank stays off — constrains B6), `#100` (perceived latency / no token
  streaming — constrains A1), `#292` (check open PRs before acting on a queued item), `#212`
  (row contracts), `#324` / `#330` (verify landing by content after squash merges).
- **Decisive constraint from #231:** the 35–40 s route-budget probes were tested and
  rejected — generation completed inside the deadline and still failed the quality gate.
  Never "fix" A1 by raising `answerRouteBudgetMs` without new evidence that directly rebuts
  that recorded result. S1's evidence (2026-08-17) re-confirmed it.
  Full evidence and the re-scope of the row itself:
  [`231-diagnosis-2026-08-22.md`](231-diagnosis-2026-08-22.md).

## 2. Historical packet outcomes — evidence, not current task status

| Packet     | Scope                                                                                                                                                 | Branch                                           | PR                    | State                                                                                                                                                                                                                                                                                                                                         | Canary / evidence refs                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Guide      | Programme guide                                                                                                                                       | `claude/rag-plan-review-guide-vhrls9`            | #1895                 | Merged 2026-08-13                                                                                                                                                                                                                                                                                                                             | docs-only                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Handover   | Multi-session handover + coordination                                                                                                                 | `claude/rag-plan-review-guide-vhrls9`            | #1908 / #2024         | Merged 2026-08-13; coordination layer PR #2024                                                                                                                                                                                                                                                                                                | docs-only                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| S0         | A1 phase 1: structured fallback diagnostics                                                                                                           | `claude/lithium-generation-quality-debug-ji1vce` | #1899                 | Merged 2026-08-13                                                                                                                                                                                                                                                                                                                             | offline 93/93 focused                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| S1         | A1 phase 2: rung-1 verification-faithfulness fixes                                                                                                    | `claude/s1-rag-mitigation-231-86c182`            | #2022                 | Merged 2026-08-17 (squash `2bd146eed`, landed by content)                                                                                                                                                                                                                                                                                     | 8 pre-fix + 5 post-fix live probes 2026-08-17; offline 583/583; canary pair run 31964560921 (baseline `8f8d111ab`) -> run 32025082010 (`2bd146eed`): recall 1.0/1.0, zero per-case rr regressions, answer gate 44/44 (denominator reconciled by S5; see baseline-record §3); rung-2 measurement in `docs/audit/live-drift-forensics-2026-08.md` §5                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| S1b        | A1 rung 3 (R1): pre-deadline strong routing for dosing class                                                                                          | `claude/s1b-rag-dosing-routing-6u1mik`           | #2035                 | Merged 2026-08-17 (PR #2035, merge `92f7618`)                                                                                                                                                                                                                                                                                                 | canary pair pending: baseline run 32025082010 (`2bd146eed`) -> post-merge dispatch (owner-approved); offline 586/586 + verify:pr-local heavy scope green                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| S1c        | A1 residuals R2 + R3: claim-support strictness                                                                                                        | `claude/s1c-residuals-r2-r3-4pb1at`              | #2052                 | Merged 2026-08-17 (merge `b8e774bcd`; follow-up #2063 kept; follow-up #2065 reverted by PR #2088 after canary regression)                                                                                                                                                                                                                     | canary pair: baseline run 32049952885 -> post run 32052479537 (`084f63799`): recall 1.0/1.0, zero per-case rr regressions, answer gate 44/44                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| S1d        | A1 final-gate gap recovery: hedged cited low-confidence fast answers must recover extractively, not collapse to a citation-free `provider_source_gap` | `claude/s1d-final-gate-gap-recovery-dxgrn2`      | #2054                 | Merged 2026-08-17 (merge `0bbd64fbc`); landed by content; canary pair green after the #2065 revert (PR #2088)                                                                                                                                                                                                                                 | canary pair 32052479537 -> 32100681177 (`4ea310e48`) green: recall 1.0/1.0, zero per-case rr regressions, answer gate 44/44. Interim post run 32097916649 (`9904fbda8`) was RED on `agitation-im-po-route-short-terms` — bisected live to PR #2065 (S1c follow-up condition-first regex), not S1d; reverted by PR #2088; the confirmation run is 32100681177                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| G1         | Governance: provenance tag for document-summary rows (Option B)                                                                                       | `claude/g1-rag-document-context-qn9ubx`          | #2053                 | Merged 2026-08-17 (merge `125e98526`); rows #J912J9 / #0MSNT8 closed at reconcile                                                                                                                                                                                                                                                             | no canary (no behaviour change); `document_context` tag at `types.ts` + `rag-row-contracts.ts`, deriveConfidence pinned                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| S2         | A2 + A3: composition menu + moderate length                                                                                                           | `claude/s2-rag-composition-7330b0`               | #2097                 | Merged 2026-08-18 (squash dda4956ff), landed by content; A2 and A3 together; prompt clinical-rag-answer-v19, schema v4, answerSections.maxItems 6                                                                                                                                                                                             | offline: composition 9/9 + prompt pins 5/5, eval:rag:offline 26 suites / 623 tests, eval:rag:adversarial:offline 25/25 (3 divergences still pinned), rag.ts 4362/4362; canary pair 32100681177 (4ea310e48) -> 32111839806 GREEN (document/content recall 1.0/1.0, zero per-case rr regressions, answer gate clean; one non-blocking 20 s latency advisory on neuroleptic-side-effect-escalation); eval:answer-quality v18 (4ea310e48) vs v19 run 2026-08-18 neutral within nondeterminism (relevance 0.633->0.567 on two nondeterministic timeout/gap cases, targeting 0.409->0.429, readability at ceiling), owner blinded read **COMPLETE 2026-08-21**: 30 pairs, v18-`4ea310e48` 3 / v19-`cdfcbaccd` 3 / tie 24 / neither 0 — no measurable difference. 24 of 30 pairs were byte-identical between versions and only 6 carried `model_synthesis` on both sides, so the read measured the `#231` fallback rate (v18 20/30 `source_only`, v19 21/30) as much as the v18->v19 prompt change; read it as no-harm, not as demonstrated benefit. Note: the 220-word total-length readability ceiling in scoreAnswerQualityEvalCase is a known metric confound for A3 (baseline-record §4)                                                                                                                                                                                                             |
| S2b        | A3: moderate length (if separate review needed)                                                                                                       | —                                                | —                     | Not needed — A3 shipped inside S2 (combined diff stayed reviewable)                                                                                                                                                                                                                                                                           | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| S3         | A4: follow-up suggestion refinement                                                                                                                   | `claude/s3-follow-up-suggestions-95e160`         | #2108                 | Merged 2026-08-18 (squash 511d22f4d), landed by content; Track A complete                                                                                                                                                                                                                                                                     | offline only: answer-follow-up 27/27 (menu alignment across all 48 class×intent cells, evidence gate positive + discriminating negatives, suppression), answer-follow-up-chips DOM 6/6 (desktop + phone composer surfaces), answer-composition 9/9 unchanged; no canary — deterministic composition only, generation prompt untouched                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| S4         | B0: adversarial fixtures + baseline + register                                                                                                        | `claude/packet-s4-adversarial-fixtures-5ho5tp`   | #2036                 | Merged 2026-08-17 (squash `f5b093291`)                                                                                                                                                                                                                                                                                                        | Offline only: `check:rag:adversarial-fixtures` 24 cases / 8 categories / 6 canaries; `eval:rag:offline` 24 suites, 597 tests. Baseline `scripts/fixtures/rag-adversarial-baseline.v1.json` marks the three provider-backed gates `pending_owner_run`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| S5         | B1+B2: telemetry assessment + offline harness                                                                                                         | `claude/s5-rag-telemetry-harness-2wvis7`         | #2056                 | Merged 2026-08-17 (merge `093f9340c`); post-merge canary run 32049952885                                                                                                                                                                                                                                                                      | Offline only: `eval:rag:adversarial:offline` 25/25 (24 cases + canary-free report; 3 divergences pinned in `KNOWN_DIVERGENCES`); B1 gap = `verification_latency_ms` behind `RAG_TELEMETRY_EXTENDED` (default false); canary-absence tests green; 44/44 denominator reconciled                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| S6         | B3: Docling lab benchmark                                                                                                                             | `claude/packet-s6-docling-lab-d6foa6`            | #2057                 | Merged 2026-08-17 (merge `5a6418636`)                                                                                                                                                                                                                                                                                                         | Offline only: `check:docling-lab` 36 fixtures / 10 hostile / 6 canaries + Gate B template valid; `verify:pr-local` heavy plan failed:(none); contract test 20/20; legacy smoke 46 docs, 10/10 hostile contained, canary-clean report. Verdict is a separate owner dispatch of `docling-lab.yml`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| S6b        | Gate B run: docling-lab dispatch, verdict, decision record                                                                                            | `claude/docling-gate-b-eval-5czgln`              | (this PR)             | Gate B **PASS** 2026-08-18 (evidence run 32176604314 at `8a92378`); four latent harness defects found+fixed en route (setuptools pin, libGL, torch.compile/no-toolchain, HTML-entity scoring)                                                                                                                                                 | All five gates pass at pre-agreed 0 pp margins: parse 36/36 both engines, exactness 162/162 both, table F1 parity at ceiling (agreed 0 pp target; fixtures.v2 hardness follow-up queued), hostile 10/10 contained / 0 crash / 0 canary echo, resources max 12.6 s P95 / 1.40 GiB vs 120 s / 6 GiB caps; record: `docs/rag-improvement/gate-b-decision-record-2026-08-18.{md,json}`, validated `--final`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| S7         | B4: Docling worker shadow mode                                                                                                                        | `claude/docling-worker-shadow-mode-b6fa17`       | #2170                 | Merged 2026-08-19 (squash `5437c309f`), landed by content; default legacy — shadow is an operator flag (Railway); ledger #9DGA6R closed                                                                                                                                                                                                       | Offline only: `WORKER_DOCUMENT_EXTRACTOR_MODE=legacy\                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | shadow`(default legacy) +`WORKER_SHADOW_EXTRACTION_COHORT_PERCENT`(1–5, default 2) +`WORKER_DOCLING_PYTHON_BIN`; shadow runs after `commitDocumentIndexGeneration`, aggregate record in `documents.metadata.shadow_extraction` via the existing final metadata merge, no chunk/embedding/index/table-fact/`document_index_quality`writes; bounded 120 s / 40 pages / 1 process; vitest`tests/worker-shadow-extraction.test.ts`19/19 + Python unittest 7/7; caveats: table-heavy leg passed at parity-on-ceiling (fixtures.v2 first), eager-mode latency budgeted by the three bounds; rollback`WORKER_DOCUMENT_EXTRACTOR_MODE=legacy` |
| Gate E     | Blinded before/after read tooling (capture `--extra-cases` + gate-outcome dump fields; `blind-answer-pairs.ts` build/unblind)                         | `claude/gate-e-blinded-eval-b6076d`              | #2208                 | Merged 2026-08-21 (squash `588191c06`), offline-only. **Gate E CLOSED 2026-08-21** — the paid capture and the owner's blinded read are both complete; `#E0N0QC` closed at reconcile. Spend ~$0.66, an ESTIMATE derived from token counts because `estimated_cost_usd` is null in both dumps (no cost rates configured), never a measured cost | Offline only: blind-answer-pairs + eval-answer-quality focused suites 36/36 (blinding swap-proof, key round-trip, byte-stable builds); eval:rag:offline + eval:rag:adversarial:offline unchanged; no canary — no runtime behaviour change. **Gate E result 2026-08-21:** v18 `4ea310e48` (dump sha256 `16cbae11eaa604b045293410e505c6be2639deff6c9485e555692588bbccab9a`) vs v19 `cdfcbaccd` (dump sha256 `e09a5f1d8e764dbdbee58e469efb62659612af41bef6a1afc7e31dbc0142290e`); both captures exited 0 at 30/30 cases, 30 pairs built, 0 unpaired, pack leak-checked (0 hits for version labels or shas); owner tally **v18 3 / v19 3 / tie 24 / neither 0**. Three caveats travel with it: (a) the after-half is `cdfcbaccd`, NOT "current main" — main had advanced to `115504162` at write-up, and although the four intervening commits (#2245, #2246, #2247, #2248) touch only hooks, docs, scripts and tests with nothing under `src/lib/rag/**`, the record names what was actually captured; (b) 24 of 30 pairs were byte-identical between versions, and v18 was 20/30 `source_only` against v19 21/30 with 4 zero-citation answers each side, so most pairs compared two source lists and the tally partly measures the `#231` fallback rate rather than the prompt change; (c) the readability/length metric confound in `scoreAnswerQualityEvalCase` (baseline-record §4) still applies |
| S8+        | B5 Ragas / B6 reranker / B7 DSPy                                                                                                                      | —                                                | —                     | Still gated — owner decision                                                                                                                                                                                                                                                                                                                  | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| #212 T1–T3 | Runtime row contracts (rag.ts, rag-candidate-sources.ts, src/app/api) — sibling stream sharing `src/lib/rag/**`                                       | —                                                | #1946 / #1981 / #2023 | Merged (T3 squash `440a34f71` 2026-08-17)                                                                                                                                                                                                                                                                                                     | see the #212 ledger row; RAG surface complete for the cast class                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| #212 T4    | Runtime row contracts: `worker/main.ts` (11 casts) — sibling stream                                                                                   | `claude/ledger-212-tranche-4-worker-q3y6i4`      | #2037                 | Merged 2026-08-17 (squash `1726537b7`); #212 closed by reconcile PR #2045                                                                                                                                                                                                                                                                     | Governance Preflight complete; audit: 1 inbound cast (claim rows, per-row fail-soft) + 2 read-back param casts contracted, 9 outbound/interop left; closes #212 (inbox `done` queued in the PR)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

Record dated packet outcomes with their source and verification limits; retain historical
evidence. Current lifecycle updates belong to [task-receipts.md](../task-receipts.md),
not this table. Provider-backed verification still needs explicit approval.

## 2a. Gate E blinded read — owner procedure (HISTORICAL — this run is complete)

> **Status: executed and closed 2026-08-21.** All eight steps below were run for the
> v18 `4ea310e48` vs v19 `cdfcbaccd` comparison; the verdict is recorded in the §2 S2 and
> Gate E rows. This section is kept as the reusable procedure for any **future** blinded
> read — it is not outstanding work. Steps 3 and 4 are provider-backed and paid, so
> re-running them is a fresh capture: it needs new owner approval and produces a new
> capture pair, recorded on its own terms rather than folded into the 2026-08-21 result.

The executed run compared prompt v18 (commit `4ea310e48`, the S2 baseline canary half)
against v19 (commit `cdfcbaccd`) on the 30 `answerQualityEvalCases`; no owner-chosen live
questions were added, so 30 pairs were built with 0 unpaired. A future run may still add up
to ~10 live questions through `--extra-cases`. `scripts/eval-answer-quality.ts` and
`scripts/eval-utils.ts` were byte-identical between `4ea310e48` and `cdfcbaccd` and every new
dump field is defensive, so the updated script ran unmodified in a v18 worktree — re-confirm
that before reusing the shortcut against a newer after-half. Steps 3 and 4 are
**provider-backed and paid** (OpenAI + Supabase, cache-bypassed answers); the pre-run
estimate was ~$4–8 for ~80 answers, and the executed 30-case run came in at ~$0.66 — itself
an ESTIMATE derived from token counts because `estimated_cost_usd` is null in both dumps,
never a measured cost. Everything else is offline.

1. _(offline)_ Author `.local/gate-e/extra-cases.json` in the main checkout:
   `{"questions":[{"id":"live-01","question":"..."}, ...]}` — ids `live-*`; the tool rejects
   collisions with the fixed `quality-*` ids.
2. _(offline; handles credentials)_ `git worktree add ..\gate-e-v18 4ea310e48`, then in it
   `npm ci --include=dev`; copy in from main: `scripts\eval-answer-quality.ts`,
   `.local\gate-e\extra-cases.json`, and `.env.local` (never commit; delete before removing
   the worktree).
3. **PROVIDER (paid)** — in the v18 worktree:
   `npm run eval:answer-quality -- --json --extra-cases .local/gate-e/extra-cases.json --dump-answers output/gate-e/dump-v18.json > output/gate-e/summary-v18.json`
4. **PROVIDER (paid)** — in the main checkout at current HEAD: same command with
   `dump-v19` in both paths.
5. _(offline)_ Copy the v18 dump into the main checkout's `output/gate-e/`, then:
   `node scripts/run-tsx.mjs scripts/blind-answer-pairs.ts build --before output/gate-e/dump-v18.json --after output/gate-e/dump-v19.json --before-label v18-4ea310e48 --after-label v19-<HEAD-sha> --out-dir output/gate-e/blind`
   — check the printed pair count (expect 30 + the extra questions) and any unpaired ids.
6. _(offline, human)_ Open **only** `output/gate-e/blind/reading-pack.md`; record every
   verdict in `verdict-sheet.md` (`verdict=A|B|tie|neither`, optional `notes=`). Do not open
   `assignment-key.json` until every verdict is recorded.
7. _(offline)_
   `node scripts/run-tsx.mjs scripts/blind-answer-pairs.ts unblind --key output/gate-e/blind/assignment-key.json --verdicts output/gate-e/blind/verdict-sheet.md --out output/gate-e/blind/unblinded-report.md`
8. _(offline)_ Record the Gate E verdict (tallies + dump digests from the key) in the S2 and
   Gate E rows above via a docs PR + ledger append; delete `.env.local` from the v18
   worktree, then `git worktree remove ..\gate-e-v18`.

## 3. Session packets

Every packet inherits the standing rules in §6. "Done" for a packet always ends at an open
PR with the correct body, a ledger append, and a task receipt — never at a merge (the
owner merges) and never at watching CI.

### S1 — A1 phase 2: choose and implement the mitigation from evidence (`#231`)

- **Evidence update (2026-08-14 incident):** the mitigation ladder's rung 2 (pre-generation
  latency) has a live measurement — `supabase_rpc_latency_ms` 31,610 ms from two dropped
  trigram indexes, restored the same day (now 1,535 ms text / 8,519 ms hybrid). See
  `docs/audit/live-drift-forensics-2026-08.md` (Phases 1.3 and 5) for the before/after
  probes; any rung-2 reasoning must start from that file, not from the pre-incident
  assumption that retrieval latency was healthy.
- **Precondition:** PR #1899 merged; its diagnostics available. If live
  `generation_quality_gate:*` distributions exist in `rag_queries.metadata`, ask the owner
  for the aggregate counts (reading live Supabase is provider-gated — do not query it
  yourself without explicit approval). Otherwise reproduce offline with
  `scripts/probe-generation-quality.ts` and the offline fixtures.
- **Work:** follow README §A1's mitigation ladder in order: (1) fix the dominant specific
  generation-quality/verification/composition failure; (2) reduce pre-generation latency if
  measurements show it starves generation; (3) route length-heavy classes
  (`broad_summary`, `comparison`) to strong in `chooseAnswerRoute` **before** the deadline
  is created — not in `shouldRetryWithStrongAfterFast`; (4) budget changes only with
  evidence rebutting #231's stop condition.
- **Files:** `src/lib/rag/rag.ts`, `src/lib/rag/rag-routing.ts` (only for option 3),
  targeted tests. `src/lib/rag/rag-route-budget.ts` out of scope unless option 4's evidence
  bar is met.
- **Gates:** `eval:rag:offline` plus the relevant offline 44-case fixtures/contracts. The
  30-case `eval:answer-quality` run is provider-backed (OpenAI/Supabase) and requires explicit
  owner approval. Any behaviour change → `RAG impact: behaviour change — canary pair
<baseline> -> <post>` (owner approves each dispatch); Clinical Governance Preflight;
  `verify:pr-local`; and `check:production-readiness` whenever answer routing or generation
  behaviour changes.
- **Done:** PR open with the mitigation, its evidence trail (which gate reasons dominated,
  why this rung of the ladder), and a fallback-rate non-inferiority argument.

### S1b — A1 rung 3 (R1): route the dosing class to the strong route before the deadline

- **Precondition:** S1 merged (PR #2022, `2bd146eed`) and its canary pair green. Owner decision
  2026-08-17: R1 lands before S2. Check the open PR list for a routing PR first (`#292`).
- **Evidence:** S1's post-fix probes left "Lithium dosing?" 4/4 source-only, 3/4 as
  `provider_timeout`: `fast_unsupported_retry_strong` launches a strong generation into the
  fast route's leftover ~10–13 s and only the truncation self-heal is
  `deadlineAllowsGenerationRetry`-gated. The fix is routing, not budget.
- **Work:** in `chooseAnswerRoute` (`src/lib/rag/rag-routing.ts`) route the dosing /
  `medication_dose_risk` class (and `drug_dosing` only if evidence supports) to the strong
  route **before** the route deadline is created. Do not change
  `shouldRetryWithStrongAfterFast` as the fix; do not touch `answerRouteBudgetMs`,
  `OPENAI_ANSWER_TIMEOUT_MS`, any quality gate, or fallback caching. Non-dosing classes keep
  their routing unchanged and the PR must argue that explicitly.
- **Files:** `src/lib/rag/rag-routing.ts`, targeted tests. `rag.ts` has a 4,362-line
  no-growth budget — extract, never raise.
- **Gates:** focused vitest on routing, `eval:rag:offline`, `check:rag:fixtures`,
  `check:production-readiness` (answer routing changed), `verify:pr-local`; `RAG impact:
behaviour change — canary pair <latest green baseline> -> <post-merge dispatch>` (owner
  approves the dispatch); Clinical Governance Preflight. Live probes only with owner approval
  and always `node --env-file=.env.local scripts/run-tsx.mjs scripts/probe-generation-quality.ts "<query>"`.
- **Done:** PR open with the routing diff, offline proof, and the fallback-rate
  non-inferiority argument for non-dosing classes.

### S1c — A1 residuals R2 + R3: claim-support strictness

- **Precondition:** S1b merged and its canary green (keeps canary attribution clean).
- **Work:** R2 — add a `normativeDirectiveActions` pattern in `src/lib/rag/rag-claim-support.ts`
  for guideline phrasing "usual / recommended … dose is …" so imperative claims ("start
  lithium at 500 mg nocte") verify against descriptive norms, with adversarial negatives
  proving unrelated imperatives still fail. R3 — a claim synthesising two adjacent source
  bullets fails the ≥50 % single-segment topic-overlap requirement even when every atom
  matches; **measure** how often before loosening anything, and loosen only with a
  discriminating negative test. Both reproduce offline on the EMHS lithium chunk.
- **Hard boundaries:** no grounding-gate weakening beyond the two named artefacts; no
  retrieval/ranking edit; no budget change.
- **Gates:** as S1b; `RAG impact: behaviour change — canary pair …`; Clinical Governance
  Preflight; `check:production-readiness`.

### G1 — governance decision: provenance tag for document-summary rows (Option B)

- **Decision (owner, 2026-08-17):** `buildDocumentSummaryResults`
  (`src/lib/rag/rag-row-contracts.ts`) stamps `similarity: 1` on document-summary rows with
  no `similarity_origin`; its only caller is the document-summary route in `rag.ts`, never
  the general answer path; `deriveConfidence` (`src/lib/rag/rag-answer-support.ts`) excludes
  only `"synthetic_text"` from `strongestNonSynthetic`. On the summary route the "query" is
  the document itself and citation support is still verified by the same pipeline, so the
  "high" label stays. Option A (tag as `synthetic_text` → summaries cap at "medium") is
  recorded as rejected.
- **Work:** add a new origin value (proposed `"document_context"`) to the
  `similarity_origin` union in `src/lib/types.ts` and to `src/lib/answer-stream-contract.ts`;
  stamp it in `buildDocumentSummaryResults`; leave `deriveConfidence` unchanged and pin it
  with tests (tagged doc-summary rows still reach "high"; `synthetic_text` rows still do
  not); `rag.ts` `synthetic_similarity_count` must not count the new value; update
  `docs/clinical-hazard-analysis.md` H5a.
- **Gates:** focused vitest, `eval:rag:offline`, `check:rag:fixtures`, `verify:pr-local`;
  `RAG impact: no retrieval behaviour change — provenance tag only; confidence derivation
unchanged, pinned by test`; Clinical Governance Preflight. No canary.
- **Precondition:** none — disjoint from S1b/S1c/T4; may run in parallel.

### S1d — A1 final-gate gap recovery (found by the S1b canary, 2026-08-17)

- **Evidence:** the first post-S1b canary (run 32038751592) failed one case,
  `summary-discharge-guidance`, with `strong_routine_retrieval; final_quality_gate:provider_source_gap`,
  `grounded:false`, 0 citations. The re-run (32039841070) and 3/3 cache-bypassed live probes took the
  other branch: `generation_fallback:generation_quality_failed; source_backed_extractive_fallback`,
  grounded, 4 citations. Live index unchanged between runs; retrieval 36/36 identical. Only the fast
  model's phrasing chose the branch.
- **Mechanism:** inside the generation loop (`src/lib/rag/rag.ts` ~3580-3625) every fast-route
  failure shape — cited source-gap lead (`hasCitedProviderSourceGap`, lead-sentence regex),
  unsupported, unusable, template-like, quality-gate fail — throws into
  `shouldRecoverFastFailureExtractively`, which for `fast` + `strong_routine_retrieval` + results
  rebuilds a source-backed extractive answer. A hedged, **cited**, `confidence:"low"` fast answer whose
  lead does not match `providerSourceGapLeadPattern` but whose body matches the much broader
  `gapLikeAnswer` regex in `finalizeRagAnswerQualityCore`
  (`src/lib/rag/rag-extractive-answer.ts` ~3822-3845) survives the loop and is then converted to a
  citation-free `evidence_gap` (`final_quality_gate:provider_source_gap`) with **no** extractive
  recovery.
- **Work:** give the finalizer's gap conversion the same source-backed extractive recovery the in-loop
  path takes when the route was fast + `strong_routine_retrieval` and answer-input results exist (or
  apply the broad gap detection inside the loop so it recovers there — pick the smaller, prove which
  with the fixture). Keep the citation-free gap terminal for genuinely empty retrieval. Offline fixture:
  a hedged, cited, low-confidence fast answer with a gap-like body over grounded results must yield the
  extractive fallback; a gap answer over zero results must stay `evidence_gap`.
- **Why before S2:** A2/A3 lengthen answers → more hedged prose → more chances of this branch.
- **Files:** `src/lib/rag/rag-extractive-answer.ts` (finalizer) and/or `src/lib/rag/rag.ts` fast-failure
  block; targeted tests. Do not touch `rag-claim-support.ts` (S1c) or `rag-routing.ts` (S1b).
- **Gates:** focused vitest, `eval:rag:offline`, `check:rag:fixtures`, `check:production-readiness`,
  `verify:pr-local`; `RAG impact: behaviour change — canary pair …`; Clinical Governance Preflight.

### S2 — A2 composition, with a separately reviewable A3 length fallback

- **Precondition:** S1 merged (its evidence determines how much length headroom exists).
- **Work:** exactly README §A2 + §A3. New pure module `src/lib/rag/answer-composition.ts`
  mapping (`RagQueryClass`, `ClinicalQueryIntent`) → composition menu; one
  `related_information_menu:` line in `buildAnswerInput`'s "Interpreted clinical task"
  block; one paragraph in `answerInstructions` §"Answer sections"; prompt length targets
  35–75 → ~60–110 words, sections 2–5 → 3–6; keep "narrow question → narrow answer"
  verbatim. Bump `ragAnswerPromptVersion` (`src/lib/rag/rag-versioning.ts`). Check
  `trustCaps` in `src/lib/answer-render-policy.ts` accommodates larger menus.
- **Hard boundaries:** grounding contract untouched (every section cites or is omitted); no
  retrieval/ranking/selection edit of any kind; no new pipeline stage, `RagAnswer` field, or
  render block.
- **Split fallback:** keep A2 + A3 together only while the combined diff remains reviewable. If
  it does not, S2 ships A2 only and S2b ships A3 in a second PR, each with its own prompt
  version bump and approved canary pair.
- **Gates:** `eval:rag:offline` plus appropriate offline fixtures/contracts; 36/36 stays
  trivially green (retrieval untouched). The 30 `answerQualityEvalCases` comparison is
  `npm run eval:answer-quality`, a provider-backed OpenAI/Supabase evaluation requiring
  explicit owner approval; the ~10 owner-chosen live questions and canary pair are also
  approval-required. Run `check:production-readiness` for this answer-generation change and
  include the Clinical Governance Preflight.
- **Done:** PR open with menu table, prompt diff, offline baselines, and the canary-pair
  request spelled out for the owner (not executed without approval).

### S3 — A4: refine the existing follow-up suggestions

- **Precondition:** S2 merged (uses its composition menu).
- **Work:** README §A4. Improve `buildAnswerFollowUpSuggestions` in
  `src/lib/answer-follow-up.ts` **in place**: consume the A2 composition menu, require the
  suggested subject to appear in retrieved evidence, suppress redundant/already-answered
  suggestions, keep deterministic phrasing, zero extra provider calls. Touch
  `ClinicalDashboard.tsx` only if the function's input contract must expand.
- **Hard boundaries:** no second follow-up module, no new `RagAnswer` field, no new render
  block, generation prompt untouched.
- **Gates:** focused unit + DOM tests for both existing chip surfaces (phone + desktop);
  `RAG impact: no retrieval behaviour change — deterministic follow-up composition only`;
  `verify:phone-chrome` only if shared composer chrome changes.

### S4 — B0: adversarial fixture contract, baseline, data-flow register

- **Precondition:** none — parallel-safe with S1–S3 (disjoint files).
- **Work:** README §B0. New `scripts/check-rag-adversarial-fixtures.mjs` +
  `npm run check:rag:adversarial-fixtures` (the existing `check:rag:fixtures` is untouched);
  `scripts/fixtures/rag-adversarial-cases.v1.json` + schema, 20–30 synthetic cases across
  the 8 categories, PHI-like canary strings, validator rejects canaries in reportable
  output; baseline record + report key; `docs/rag-improvement/data-flow-register.md`.
  Remove the now-built paths from the `ALLOWLIST` in `scripts/check-docs-links.mjs` and the
  planned command from `scripts/check-docs-script-refs.mjs` in the same PR.
- **Hard boundaries:** fixtures are synthetic only — never real clinical text, filenames, or
  identifiers; the validator is deterministic and network-free.
- **Gates:** `verify:pr-local` (script changes fail closed to the heavy offline scope —
  expect lint/typecheck/full unit suite); `RAG impact: no retrieval behaviour change —
offline fixtures and validation only`.

### S5 — B1 + B2: telemetry gap assessment + offline adversarial harness

- **Precondition:** S4 merged (fixtures exist). Reuses A1 phase 1's instrumentation — read
  what #1899 landed before proposing new fields.
- **Work:** README §B1 + §B2. Dashboard questions first; add `RAG_TELEMETRY_EXTENDED`
  (typed, default `false`) only for proven gaps, with unit tests proving canaries never
  appear in emitted objects. Then the offline adversarial runner
  (`eval:rag:adversarial:offline`) over S4's fixtures — use a plain Vitest harness in this
  combined packet. A Promptfoo experiment, if later owner-approved, is a separate packet and
  PR with its package and lockfile change isolated. Route the S5 harness via
  `scripts/ci-change-scope.mjs` to RAG-surface PRs only; fail closed on missing fixture,
  network attempt, budget breach. Close the Phoenix decision record as deferred.
- **Gates:** `verify:pr-local`. No dependency change is permitted in S5; any later Promptfoo
  evaluation is operational-risk work in its dedicated PR.

### S6 — B3: Docling lab benchmark (isolated)

- **Precondition:** S4 merged (shared report-key convention). Independent of S1–S3.
- **Work:** README §B3. Everything under `eval/docling/` with a fully hashed lockfile and
  its own venv; sandboxed (non-root, no egress, CPU/memory/wall-clock/output limits);
  30–50 public/synthetic fixtures + hostile corpus; compare against the legacy extractor on
  parse success, resource bounds, table precision/recall, exact number/unit/comparator
  checks; aggregate-only reports.
- **Hard boundaries:** do NOT touch `worker/python/requirements*`, `Dockerfile.worker`,
  `worker/main.ts`, `src/lib/extractors/document.ts`, or the database. Benchmark runs are
  manual/dispatch-only.
- **Done:** PR open with the harness plus a Gate B decision record template; the benchmark
  verdict itself is a separate owner-reviewed run.

### S8+ — gated packets (do not start without an explicit owner decision)

- **B4 Docling shadow** — only after Gate B passes; worker-only,
  `WORKER_DOCUMENT_EXTRACTOR_MODE` default `legacy`; `ingestion-worker-reviewer` subagent
  reviews the PR. **Opened 2026-08-19 as S7** (row above): shadow runs after the legacy
  generation commits, on a 2 % index-quality-selected cohort (tables / OCR / layout proxy),
  aggregate metadata only, bounded 120 s / 40 pages / one process; the docling venv +
  models are provisioned in `Dockerfile.worker` from the Gate B lab lock. Enabling shadow
  in production is an operator step (Railway variable) with the runbook preconditions in
  `docs/worker-deploy-runbook.md`; the table-quality promotion argument still waits on
  `docling-lab-fixtures.v2`.
- **B5 Ragas pilot** — offline, judge-model use needs Gate A approval first.
- **B6 reranker benchmark** — offline; refutation constraints from README §B6 are binding
  (differently-relevant candidates; any serving score strictly below `relevance.score`;
  coordinate with `#001`).
- **B7 DSPy lab** — blocked on a ≥100-case clinician-reviewed dataset that does not exist.

## 4. Session-start checklist

1. Start in an isolated worktree using the `newtask` skill (or equivalent safe worktree
   bootstrap) from current `origin/main`. Do **not** use `git checkout -B <packet branch>`
   against an existing branch: it can discard unpushed packet commits. Never build on a stale head.
2. Read: your packet here → the matching README section → `docs/rag-behaviour/README.md`
   (+ `safeguards.md` before touching any protected surface).
3. Establish the task identity and ownership through [task-receipts.md](../task-receipts.md).
   Consult [repository issue history](../outstanding-issues.md) and dated packet outcomes (§2)
   as evidence. Check the open PR list for duplicate implementation
   only when explicit owner approval for provider access exists; otherwise proceed with
   local/offline evidence and note the duplicate-risk caveat (`#292`: an open ledger row is
   not proof nobody is building it — PR #1899 already covers A1 phase 1).
4. State the RAG-impact flag to the owner in your first message if your packet touches a
   protected surface (all of Track A does).
5. Confirm what is NOT authorised: live canary dispatches, provider-backed evals
   (`eval:rag`, `eval:quality`, `check:supabase-project`, `verify:release`), Supabase reads,
   reindexing, and merging — each needs the owner's explicit per-action approval.

## 5. Session-end checklist

1. Smallest correct gate run with the decisive output line pasted (exit 0 alone is not
   proof), following [verification gates](../agents/verification-gates.md).
   Routine answer-route or generation-prompt work uses focused offline evidence; add
   `npm run check:production-readiness:ci` when readiness/configuration structure is in scope.
   Release-mode readiness and provider calls retain their separate approval boundary.
   `npm run format` and **commit the formatted result**
   before push.
2. PR body from `.github/pull_request_template.md` in full prose: correct `RAG impact:`
   line, Clinical Governance Preflight when the packet touches clinical/RAG surfaces,
   verification evidence, risk/rollback.
3. `npm run ledger:append -- --ref <branch> --head <full-sha> --scope "<scope>" --outcome
<o> --checks "<checks>"`, commit the record file, push.
4. Update the same task checkpoint and receipt under [task-receipts.md](../task-receipts.md).
   Add a dated programme outcome here only when supported by new evidence.
5. Offer `/issues capture` for anything unresolved, then **stop at the open PR** — the owner
   merges; do not watch CI unless explicitly asked.

## 6. Standing rules (summary — AGENTS.md and the guide are authoritative)

- **Protected surfaces:** everything under `src/lib/rag/**`, `clinical-search.ts`,
  `retrieval-selection.ts`, `released-search-order.ts`, `ranking-config.ts`,
  `answer-ranking.ts`, `semantic-rerank.ts`, eval scripts/fixtures, retrieval RPCs. Flag
  before editing; `RAG impact:` line in the PR; behaviour change → live canary pair.
- **Refuted shapes (never re-walk):** feature-weight tuning; any comparator key above
  `relevance.score`; governance currentness penalties/boosts; token streaming; route-budget
  increases as the #231 fix.
- **Provider boundary:** OpenAI/Supabase/hosted-CI/live evals need explicit owner
  confirmation per action. Offline/mocked first, always.
- **One packet, one PR, one session.** No bundling across RAG-impact boundaries.
- **Evidence is never compressed:** paste the decisive gate line; state verified vs assumed.

## 7. Paste-ready session prompts

Copy one prompt per new cloud session, verbatim. Each deliberately grants nothing beyond its
packet — canary runs, provider calls, and merges still require separate owner approval
inside the session.

**S1 (A1 phase 2):**

> Implement packet S1 from `docs/rag-improvement/HANDOVER.md` in BigSimmo/Database: choose
> and implement the evidence-based mitigation for issue #231 using the structured
> generation-quality diagnostics landed by PR #1899. Read the S1 packet, then
> `docs/rag-improvement/README.md` §A1, then `docs/rag-behaviour/` before editing anything.
> This touches protected RAG surfaces — flag RAG impact first. Follow the mitigation ladder
> in order; do not change route budgets without evidence rebutting #231's recorded stop
> condition. No provider-backed commands or live canary dispatches without asking me first.
> Finish at an open PR with ledger append and a prepared task receipt, then stop.

**S1b (A1 rung 3 — R1 routing):**

> Implement packet S1b from `docs/rag-improvement/HANDOVER.md` in BigSimmo/Database: route the
> dosing / `medication_dose_risk` class to the strong route in `chooseAnswerRoute`
> (`src/lib/rag/rag-routing.ts`) before the route deadline is created, per README §A1 ladder
> rung 3 and S1's recorded residual R1. Read the S1b packet, README §A1, and
> `docs/rag-behaviour/` first — protected surface; flag RAG impact in your first message. Do
> not change route budgets, quality gates, or `shouldRetryWithStrongAfterFast`. Reproduce
> routing offline with focused tests; ask me before any live probe (probe needs
> `node --env-file=.env.local`). Gates: focused vitest, `eval:rag:offline`,
> `check:rag:fixtures`, `check:production-readiness`, `verify:pr-local` — paste decisive
> lines; `npm run format` and commit before push. PR: full template, `RAG impact: behaviour
change — canary pair …`, Clinical Governance Preflight, non-inferiority argument for
> non-dosing classes. Ledger append, HANDOVER S1b row, stop at the open PR. Handoff for the
> next chat: produce the tailored S1c prompt.

**S1c (R2 + R3):**

> Implement packet S1c from `docs/rag-improvement/HANDOVER.md` in BigSimmo/Database: the
> `normativeDirectiveActions` phrasing pattern (R2) and the measured topic-overlap decision
> (R3) in `src/lib/rag/rag-claim-support.ts`, with adversarial negatives. Protected surface —
> flag RAG impact first. No grounding-gate weakening beyond the two named artefacts, no
> retrieval edit, no budget change. Gates and PR body as S1b. Stop at the open PR.

**G1 (governance Option B):**

> Implement packet G1 from `docs/rag-improvement/HANDOVER.md` in BigSimmo/Database: add the
> `similarity_origin` value `"document_context"` to the union in `src/lib/types.ts` and to
> `src/lib/answer-stream-contract.ts`, stamp it in `buildDocumentSummaryResults`
> (`src/lib/rag/rag-row-contracts.ts`), keep `deriveConfidence` unchanged and pin it with
> discriminating tests, keep `synthetic_similarity_count` from counting it, and update
> `docs/clinical-hazard-analysis.md` H5a with the decision. Protected surface — flag RAG
> impact first; `RAG impact: no retrieval behaviour change — provenance tag only`. Clinical
> Governance Preflight. No canary. Stop at the open PR.

**S1d (final-gate gap recovery):**

> Implement packet S1d from `docs/rag-improvement/HANDOVER.md` in BigSimmo/Database: make a hedged,
> cited, low-confidence fast-route answer whose body matches the finalizer's gap-like regex recover
> to the source-backed extractive fallback (as every in-loop fast failure already does for
> `fast` + `strong_routine_retrieval` + results) instead of collapsing to a citation-free
> `final_quality_gate:provider_source_gap`. Read the S1d packet, README §A1, and
> `docs/rag-behaviour/` first — protected surface; flag RAG impact in your first message. Keep the
> citation-free gap terminal for genuinely empty retrieval. Offline fixtures for both cases. Do not
> touch `rag-claim-support.ts` (S1c) or `rag-routing.ts` (S1b). Gates: focused vitest,
> `eval:rag:offline`, `check:rag:fixtures`, `check:production-readiness`, `verify:pr-local` — paste
> decisive lines; format + commit before push. PR: full template, `RAG impact: behaviour change —
canary pair …`, Clinical Governance Preflight. Ledger append, HANDOVER S1d row, stop at the open PR.

**S2 (A2 + A3):**

> Implement packet S2 from `docs/rag-improvement/HANDOVER.md` in BigSimmo/Database:
> intent-conditioned related-information composition plus the moderate answer-length
> increase, per `docs/rag-improvement/README.md` §A2 and §A3. Read the S2 packet, both
> README sections, and `docs/rag-behaviour/` first — this changes the generation prompt, a
> protected surface; flag RAG impact before editing. Grounding contract and retrieval are
> untouched. Run the relevant offline fixture/contract gates, bump `ragAnswerPromptVersion`,
> run `check:production-readiness`, and prepare (but do not dispatch) the provider-backed
> 30-case evaluation and live canary-pair requests for my approval. Finish at
> an open PR with ledger append and a prepared task receipt, then stop.

**S3 (A4):**

> Implement packet S3 from `docs/rag-improvement/HANDOVER.md` in BigSimmo/Database: refine
> the existing follow-up suggestions in `src/lib/answer-follow-up.ts` per
> `docs/rag-improvement/README.md` §A4 — composition-menu aware, evidence-gated,
> deterministic, no new module/field/render block, generation prompt untouched. Read the S3
> packet and README §A4 first. Finish at an open PR with focused unit/DOM proof for both
> chip surfaces, ledger append, and a prepared task receipt, then stop.

**S4 (B0):**

> Implement packet S4 from `docs/rag-improvement/HANDOVER.md` in BigSimmo/Database: the
> adversarial fixture contract, validator command `check:rag:adversarial-fixtures`, baseline
> record, and data-flow register per `docs/rag-improvement/README.md` §B0. Fixtures are
> synthetic only with PHI-like canary strings; the validator is deterministic and
> network-free. Remove the corresponding planned-path allowlist entries from
> `scripts/check-docs-links.mjs` and `scripts/check-docs-script-refs.mjs` in the same PR.
> Finish at an open PR with ledger append and a prepared task receipt, then stop.

**S5 (B1 + B2):**

> Implement packet S5 from `docs/rag-improvement/HANDOVER.md` in BigSimmo/Database: the
> telemetry gap assessment and the offline adversarial regression harness per
> `docs/rag-improvement/README.md` §B1 and §B2, over the fixtures landed by packet S4. Read
> what PR #1899 already instruments before proposing new telemetry fields; any new fields
> are allow-listed metadata with canary-absence unit tests, behind `RAG_TELEMETRY_EXTENDED`
> defaulting false. The harness is network-free and routed to RAG-surface PRs only. Finish
> at an open PR with ledger append and a prepared task receipt, then stop.

**S6 (B3):**

> Implement packet S6 from `docs/rag-improvement/HANDOVER.md` in BigSimmo/Database: the
> isolated Docling lab benchmark under `eval/docling/` per
> `docs/rag-improvement/README.md` §B3. Hard boundary: do not touch the worker, its
> requirements, Dockerfile.worker, the extractors, or the database — this is a sandboxed,
> egress-blocked, dispatch-only lab with public/synthetic fixtures and a hostile corpus,
> reporting aggregates only. Finish at an open PR containing the harness and a Gate B
> decision-record template, with ledger append and a prepared task receipt, then
> stop.

---

_When all Track A packets and B0–B4 are merged, revisit §S8+ with the owner (Gate B verdict
was PASS 2026-08-18; B4 opened as PR #2170): whether Ragas/reranker experiments are still
wanted, and whether the DSPy dataset effort should start._
