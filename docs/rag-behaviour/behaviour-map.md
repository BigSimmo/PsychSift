# RAG behaviour map (verified 2026-07-20)

Everything below was verified against live canary evidence (runs #49–#56) and direct source
inspection during the ADDENDUM-4 cycle. Line numbers drift with refactors — search by symbol.

## 1. Score imputation on the embedding-free text fast path

When a query resolves without embeddings (`strategy=text_fast_path` and friends), candidates
carry **imputed** primaries derived only from Postgres `text_rank`:

| Site               | Where                                                 | Formula (current, reviewed state)                                                                                                                   | Saturation                          |
| ------------------ | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| S1 text chunks     | SQL `match_document_chunks_text(_v2)`                 | `similarity = 0` (truthful contract — no fabricated cosine); `hybrid = least(0.5, 0.18 + least(text_rank,1)·0.3)`; honest signal in `lexical_score` | tr ≥ 1 → hybrid exactly 0.48        |
| S2 table facts     | `rag-candidate-sources.ts` (`runTableFacts` grouping) | `similarity = min(0.94, 0.62 + min(tr,1)·0.3)`; `hybrid = min(0.97, 0.66 + min(tr,1)·0.3)`                                                          | tr ≥ 1 → byte-identical 0.92 / 0.96 |
| S3 document lookup | `rag-candidate-sources.ts` (documentScore path)       | partial discrimination via `chunkScore·0.08`; doc rank clamps at 0.34, sim cap 0.92 reachable                                                       | high-tr + high-sim pools tie        |
| S4 memory cards    | `rag-candidate-sources.ts`                            | `sim = min(0.92, 0.58 + confidence·0.28)`                                                                                                           | equal-confidence cards tie          |

`text_rank` itself is unbounded above 1 (ts_rank_cd + title-weighted + trigram/term bonuses)
and the SQL orders by it — so the RPCs discriminate candidates that the `min(tr,1)` clamps then
collapse to byte-identical app-side primaries. **This saturation is why unrelated documents
matching the same terms tie exactly.**

## 2. What resolves ties (the comparator chains)

- **Selection** (`retrieval-selection.ts`): clamped score → lexicalScore → rerankScore →
  contentCoverageScore (#987) → chunkId. The clamped-score contract is sacred (measured
  golden doc-recall 1.0→0.76 when violated — the #118 lesson). Coverage is carried ONLY as a
  late tie-break, never added to score.
- **Release without second stage** (`released-search-order.ts`): hybrid → similarity →
  relevance.score → id.
- **Release with second stage**: releaseRankScore (= max(hybrid, finalScore + position
  adjustment)) → similarity → relevance.score → id. Position adjustments launder the selection
  order into release order, so for engaged pools the selection comparator is what matters.
- **rankClinicalResults** (`clinical-search.ts`): unbounded rankScore → similarity → id.

**The critical property: in all-saturated pools, hybrid AND similarity tie, so ordering falls
to `relevance.score` — the boost/title/subject-aware clinical rank. That fallback is doing
correct clinical work.** (Proven live: spreading similarity/hybrid above it caused the Phase C
regression — see `refuted-approaches.md`.)

## 3. Second-stage engagement (`shouldUseSecondStageRerank`)

- `table_threshold` / `medication_dose_risk`: engages on visual evidence OR `topScoresClose`
  (|top1−top2| ≤ 0.04) — saturated pools always engage.
- `comparison`: engages on overflow or closeness.
- Everything else: needs closeness AND visual evidence — plain lexical pools do NOT engage.

Live mapping (canary #54): engaged — clozapine, alcohol-ciwa-threshold; not engaged —
patient-safety-plan, opioid-withdrawal, flowchart-next-step. Fixes that only touch release-time
tie-breaks can never move engaged pools.

## 4. The gate/threshold ladder (why score bands matter)

All functional gates read `max(hybrid ?? similarity)` and live at ≤ 0.82: fast-path acceptance
0.62/0.64/0.66, coverage gates 0.48–0.62, answer routing 0.32/0.48/0.64/0.76, confidence bars
0.5/0.68, conflict/high-confidence 0.82. The bands (0.92, 0.94] (table-fact sim), (0.96, 0.97]
(table-fact hybrid) and (0.48, 0.5) (lexical hybrid) contain **no gates** — but they are NOT
free real estate for ordering keys (see §2's critical property).

## 5. Live case ↔ path map (canary #53/#54 evidence)

- Perfect rank-1 under current behaviour: 27+ of 36 cases.
- Known rank-depth headroom, all `text_fast_path`, all still PASSING their gates:
  flowchart-next-step rr 0.20, alcohol-ciwa-threshold 0.25 (second-stage-engaged),
  patient-safety-plan 0.33, opioid-withdrawal 0.33.
- `lithium-therapy-monitoring` rr was a hardcoded 0.00 until 2026-07-20 (no document
  expectation); now gated on `["Lithium"]` and measuring 1.0. Treat 2026-07-20 as an mrr@10
  baseline step (+~0.028 from de-noising).
- `irrelevant_source_rate@10` ≈ 0.108 is dominated by broad/vector cases pulling topically
  adjacent sibling guidelines — audit labels before treating as ranking debt
  (`docs/observability-slos.md` §3.1).

## 6. Eval measurement mechanics

- Golden gates are zero-tolerance top-5 per-case checks; `--fail-on-threshold` fails the run on
  any miss. The canary log's per-case lines + human summary are what humans and the
  failure-issue analyzer read; `--json-out` writes the machine artifact independently.
- `textContainsClinicalTerm` uses word-boundary matching (2026-07-20 upgrade): boundaries and
  internal separators accept any non-alphanumeric run, so punctuation-joined corpus tokens
  (`CIWA-Ar`, `treatment,`, `(opioid`, line-broken `ciwa- ar`) match their fixture terms. The
  change is a proven STRICT SUPERSET of the old whitespace matcher (artifact replay on canary
  #53: 1,126 comparisons, 0 lost matches, 7 gained — exactly the known blind-spot occurrences),
  so gates can only stay equal or become more satisfiable. Sanctioned aliases
  (`scripts/lib/clinical-aliases.ts`, the STRICT tier) remain the drift-absorption mechanism
  for genuinely different spellings; the WIDER captured-case tier in
  `src/lib/eval-document-matching.ts` must never be bulk-merged into the strict tier.
- Fixture and ranking snapshot move in lockstep (test-pinned); the snapshot carries
  `generatedAt` provenance with an active 30-day freshness gate; regenerate from the latest
  `eval-canary-output` artifact via `npm run build:ranking-snapshot`.
- Run-over-run trends: `npm run eval:trend -- <artifact.json...>`.

## 7. Generation-quality failure diagnostics (#231, metadata-only)

- "Generation quality" is not one gate: `generatedAnswerQualityFailureReason`
  (`src/lib/rag/rag-answer-quality-gate.ts`) is a 14-branch first-match-wins classifier, plus
  the post-finalize source-safe gates in `rag.ts` (`claim_support_high_risk_gap`,
  `material_source_governance_gap`, `numeric_band_coherence_gap`, `numeric_faithfulness_gap`)
  and the `finalizeRagAnswerQualityCore` gates.
- Since 2026-08-17 (S1d) the finalizer's gap conversion first attempts the same
  source-backed extractive recovery the loop and outer catch use
  (`recoverFinalGateGapExtractively`): a fast + `strong_routine_retrieval` gap-like answer
  over non-empty results rebuilds extractively (marker
  `final_quality_gate_source_backed_recovery:<reason>`); empty-retrieval, strong-route, and
  comparison/dose/threshold gaps stay terminal as `final_quality_gate:<reason>`.
- Since 2026-08-12 the quality-gate throw sites raise `GenerationQualityError`
  (`src/lib/rag/rag-generation-quality-diagnostics.ts`) carrying `{stage, gateReason,
answerShape}` where `answerShape` is provider-safe counts/lengths only — never prose. The
  catch path records `generation_quality_gate:<reason>` in `answer_retry_reasons`, the
  fallback `rag_queries` log gains `generation_quality_gate_reason`,
  `generation_quality_gate_stage` and `generation_quality_answer_shape`, and eval
  diagnostics gain `generation_quality_gate_reasons`.
- This is instrumentation, not behaviour: the error message, the flattened
  `generation_fallback:generation_quality_failed` degraded token, cache exclusion, and the
  source-only fallback are byte-for-byte unchanged. Do not use these fields to relax a gate;
  they exist so a live degraded answer can name the gate that rejected it.

## 8. Answer composition menu (packet S2, 2026-08-18)

- `src/lib/rag/answer-composition.ts` is a pure map from (`RagQueryClass`,
  `ClinicalQueryIntent`) to a **related-information menu**: the `answerSections` kinds the
  model should attempt when — and only when — the retrieved excerpts support them.
  `buildAnswerInput` (`rag.ts`) serialises it as one `related_information_menu:` line in the
  "Interpreted clinical task" block; `answerInstructions` §"Answer sections" tells the model the
  menu is advisory, evidence-gated, cited like any other section, and subordinate to the
  verbatim narrow-question rule. Prompt version `clinical-rag-answer-v19`, schema `maxItems` 6.
- Rule: the query class is authoritative; the heuristic intent refines only
  `medication_dose_risk` / `table_threshold`, and only on `escalation_risk` (dosing/threshold
  menus otherwise). `comparison` and `broad_summary` carry fixed menus; `document_lookup` and
  `unsupported_or_general` deliberately carry **none** — the latter is the only class where
  `isOverExpandedSimpleGeneratedAnswer` (> 95 words / > 1 section) can fire. `definition`
  intent does not silence a menu because `intentFromSignals` matches "long-term" / "determine".
- Prompt-only: no pipeline stage, `RagAnswer` field, render block, routing, retrieval,
  ranking, selection, claim-support, or finalizer change. Verification and the render trust
  ladder apply to menu sections unchanged. Contract pins: `tests/answer-composition.test.ts`
  (all 48 class×intent cells), `tests/rag-answer-composition-prompt.test.ts`,
  `tests/rag-answer-fallback.test.ts` (menu line in the real prompt input).
- Downstream consumer (packet S3, 2026-08-18): `src/lib/answer-follow-up.ts` reads the same menu to
  compose the answer surface's follow-up chips — menu-derived candidates, gated on the retrieved
  evidence the client actually received, and suppressed when the answer body or an emitted section of
  that kind already covers them. It only READS the menu and changes no retrieval, ranking or prompt
  surface. Its templates are index-aligned with the menu items, asserted over all 48 cells in
  `tests/answer-follow-up.test.ts`, so a menu edit fails offline instead of silently dropping a chip.
