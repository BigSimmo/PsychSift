# RAG Hybrid Retrieval — Findings & To-Do (2026-07-01)

> **Status (2026-10-20): historical record, last reconciled 2026-07-14.** Do not treat the open items
> below as a current queue: re-check each against the code and
> [`docs/outstanding-issues.md`](outstanding-issues.md) before acting, and track any still-real item there.
> Some helper names it cites (for example `shouldReturnTextFastPath`) no longer exist.

Living list of issues found while fixing the live-only hybrid-RPC schema drift and optimising the
online RAG. Grouped by priority. **Last reconciled: 2026-07-14.** `✅` is complete/closed, `🔶` is
partially complete with an explicit remaining action, and `⏳` is genuinely open. Historical
measurements are evidence, not instructions to repeat provider-backed work without approval. See also the master plan
(a local Claude plan file, `please-review-the-current-synthetic-pinwheel.md`, not in the repository) for RC IDs and
`docs/search-rag-master-plan.md`.

---

## ✅ Completed this workstream

- **All four hybrid retrieval RPCs de-drifted, fixed, and hardened** (RC16). Each had been converted
  live-only `language sql`→`plpgsql` (to set `hnsw.ef_search`), which shadowed the `RETURNS TABLE`
  output params → `42702 column reference "id" is ambiguous` → RPC threw → app swallowed the error
  and silently ran on lexical + pure-vector fallbacks. Fixed + validated on live:
  - `match_document_chunks_hybrid` — migration `20260701010000` (content-tsv candidate filter kills
    the cross-table-OR seq-scan; 130s→~4s).
  - `match_document_index_units_hybrid` — text-candidate-gated, vector distance only for the bounded
    set (~0.6s). Migration `20260701020000`.
  - `match_document_embedding_fields_hybrid` — UNION of HNSW `vector_hits` + GIN `text_hits`, scores
    only the small combined id set; replaces the 215k-row vector/text OR seq-scan (~0.25–0.7s).
    Migration `20260701020000`.
  - `match_document_memory_cards_hybrid_v2` — plpgsql→sql only (it already had the good separate
    vector/text CTE shape); ef_search=100 still applied by the outer plpgsql wrapper. ~0.25–0.35s.
    Migration `20260701020000`.
  - Grants reconciled: every function locked to `service_role` (revoked `public`/`anon`/`authenticated`).
- **Full-stack eval after all four fixes** (`eval:retrieval:quality`, 10 golden cases, live):
  `content_recall@5 = 1.0`, `top_k_hit_rate = 1.0`, `document_recall@5 = 0.9`, `mrr@10 = 0.767`,
  median 1.5s, p90 8.6s. Hybrid path is fully alive; one golden case regressed on doc-ranking only
  (see P1 below).
- Naturalness: minimal/values-only **bolding**, v15 synthesis prompt for **flattened-table run-ons**,
  and the deterministic `separateSettingRunOns` safety-net — all validated on real answers.
- Offline / source-only fallback (Workstream F core): `RAG_PROVIDER_MODE=auto|openai|offline`,
  embedding-free retrieval, fail-closed on weak evidence, `answerQualityTier` labels + UI disclosure,
  `insufficient_quota` split from rate-limit.

---

## P0 — correctness / observability ✅ DONE (2026-07-01)

1. ✅ **App silently swallows hybrid-RPC failures — FIXED.** Added `recordHybridRpcError` in
   `src/lib/rag/rag.ts` (structured `logger.error("hybrid_rpc_failed", …)` + new
   `SearchTelemetry.hybrid_rpc_errors` map surfaced in `rag_retrieval_logs`), threaded through
   `searchEmbeddingFieldCandidates` / `searchIndexUnitCandidates` / the chunks call, and a matching
   `logger.error` at the memory-card call in `src/lib/deep-memory.ts`. A dead hybrid layer now logs +
   shows in telemetry instead of returning `[]` silently. Typecheck + 676 tests green.
2. ✅ **`search_schema_health()` execution smoke — DONE.** Migration
   `20260701030000_schema_health_hybrid_execution_smoke.sql` invokes each of the four hybrid RPCs with
   a zero vector + probe query in a per-RPC exception block and reports `<rpc>.execution:<sqlstate>` in
   `missing`. **Proven:** re-introducing the plpgsql ambiguity in a rollback tx made the check report
   `match_document_memory_cards_hybrid.execution:42702`; live is `ok:true`. Flows automatically into
   `check:indexing` and `setup-status` (both read `ok`/`missing`).
3. ✅ **Remaining live-only drift reconciled — DONE.** Migration
   `20260701040000_drop_dead_drifted_hybrid_variants.sql` drops the six dead, drifted plpgsql shadow
   variants (`_chunks_hybrid_review_v1`, `_embedding_fields_hybrid_v2`, `_embedding_fields_rrf`,
   `_embedding_fields_vector`, `_index_units_hybrid_v3`, `_memory_cards_hybrid_v3`) + the one eval
   helper (`eval_memory_retrieval_v2_v3`) that referenced v3 — all verified zero callers (app,
   scripts, migrations, live function bodies). Live now has exactly the 4 real RPCs + the memory_cards
   `_v2` delegate + its plpgsql wrapper, matching the migration-defined set.

## P1 — retrieval ranking quality

4. 🔍 **Answer-path ranking investigated (2026-07-01) — healthy; low mrr is a sibling-doc artifact,
   NOT a defect.** Probed every low-`rr@10` golden case. In each, the docs ranked above the pinned
   one are **legitimate siblings** the corpus genuinely contains: several _Safety Planning_ guidelines
   (KEMH/RKPG/AKG), multiple hospital versions of _Active Community Patients in ED_, multiple
   opioid-pharmacotherapy guidelines, and the two agitation guidelines. Recall stays 1.0 and the model
   gets correct context; forcing the pinned doc to #1 over equally-valid siblings would be overfitting.
   **So items 1/6 (query-class weighting to raise mrr) are deprioritized** — chasing that metric on
   this corpus optimizes for the golden's arbitrary single-doc pin, not answer quality.
   - Secondary observation: **`finalScore` saturates at the `clamp` ceiling of 1.0**
     (`clinical-search.ts:1362`) — base + the ~40 stacked boosts routinely exceed 1.0, so many strong
     matches tie at 1.0 and order by an arbitrary `document_id` tiebreak. It doesn't hurt these cases
     (the tied docs are all relevant), but it wastes the boost engineering. If ever revisited, break
     ties by the _pre-clamp_ score rather than raising the ceiling (downstream gates assume [0,1]).
   - The second-stage rerank (which uses unclamped scoring + a strong dose-amount/title boost) rarely
     fires for document_lookup/broad_summary (`shouldUseSecondStageRerank` needs `topScoresClose &&
hasVisualEvidence`, `rag.ts:548`). Widening it (RC10) could restore discrimination among the
     1.0-tied group, but since the tied docs are valid siblings the payoff is marginal and unvalidatable
     on the current golden set — do it only alongside a chunk-level "best-passage-first" eval metric.
5. ⏸️ **`ef_search` policy inconsistent — BLOCKED, deferred.** Attempted `ALTER FUNCTION … SET
hnsw.ef_search='100'` on the three sql functions; **hosted Supabase denies it (`42501 permission
denied to set parameter`)** — the RC11 blocker. The only method hosted allows is the plpgsql-wrapper
   - runtime `PERFORM set_config('hnsw.ef_search','100',true)` pattern (what memory_cards uses; measured
     latency-neutral: chunks 76→79ms warm). Deferred: the recall gain is unquantified (golden already 1.0)
     and there's no hard-query eval set to justify adding three plpgsql wrappers. Revisit once an
     expanded/hard eval set exists (see P2.8).
6. **RC5–RC13 ranking tuning** — partially addressed / re-scoped after the item-4 investigation:
   - ✅ **Same-document crowding (RC7)** — the `/api/search` results panel cap was lowered
     `maxPerDocument 4→3` (`app/api/search/route.ts`, backfill-protected so result count is unchanged).
     Note: this only affects the **panel**; the answer-retrieval path (`searchChunksWithTelemetry`) has
     no per-doc cap and doesn't need one — the comparison gate already enforces ≥2 distinct docs, and
     single-topic queries _should_ be able to draw multiple chunks from the best document.
   - 🔧 **Synthetic text similarity (RC9)** — superseded; see item 21 (2026-07-07 audit): the SQL
     formula is gone (`match_document_chunks_text` returns similarity 0), the three remaining
     app-side fabricators are tagged, and the fabricated-"high"-confidence defect is fixed;
     only the telemetry-gated threshold recalibration remains.
   - ⏳ **Source-strength as a filter not just a penalty (RC8)**; **threshold floors (RC5)**;
     **rerank trigger (RC10)** — see item 4's note (marginal without a chunk-level eval metric).
   - ⏳ **Differentials flowchart-action boost (dropped in the PR #120 merge).** The codex/RAG_FIX
     branch carried a `hasRiskFlowchartActionSignal` boost in `retrieval-selection.ts` (+0.18 for
     risk-flowchart action text, +0.05 metadata-conditional, −0.14 for flowcharts without action
     signals) tuned for differentials-mode queries against the pre-optimization scoring. It was
     dropped when merging main's relevance-first selection because its metadata-conditional part
     violates the "governance must not reorder selection" contract and it was never measured against
     the golden retrieval eval. If differentials-mode retrieval quality needs a lift, re-propose the
     action-signal part (without the metadata condition) through the golden eval; the original code
     is in PR #120 history (`git show 635485998^1:src/lib/retrieval-selection.ts`).
   - The former higher-value redirect than mrr-chasing was **item 9 (OCR enrichment/reindex)** plus
     **item 10 (DB-backed synonyms/typos)**. The bounded reference-backed OCR repair has since landed
     (item 24); only live backfill/measurement remains, not another broad heuristic.

## P2 — latency, eval coverage, data

7. 🔶 **Historical p90 retrieval ~8.6s; superseded by item 25.** Multiple sequential Supabase RPC
   round-trips remain relevant, but the approved 2026-07-14 live comparison found a much wider tail
   driven by slow hybrid RPC execution. Use item 25 for the current evidence and next action.
8. ✅ **Golden eval set expanded 10 → 23 (2026-07-01).** Added 12 verified cases built from real
   corpus content (condition guidelines — bipolar, alcohol, opioid, schizophrenia, insomnia, suicide,
   depression — which the original EMHS-only set lacked) across broad_summary/comparison/
   medication_dose_risk, plus the CIWA table_threshold case (8b regression guard). All queries
   pre-classified so `expectedQueryClass` matches; expectations anchored on clean title/filename
   substrings + robust content OR-groups. Agitation sibling accepted via a `clinicalDocumentAliases`
   entry (both agitation guidelines are correct sources), so `agitation-im-po-options` now passes.
   **New baseline (all green): 23 cases, document_recall@5=1.0, content_recall@5=1.0,
   top_k_hit_rate=1.0, mrr@10=0.74, median 1.1s / p90 4.4s, failed_cases=0.** A single case is now
   ~4.3% (was 10%). Still to add later: offline/degraded cases (measure source-only quality) and
   `rag_query_misses` queries.

   **Two real bugs the expansion surfaced — both now FIXED:**
   - **8a. ✅ `medication_dose_risk` over-triggered on "risk" — FIXED.** Bare `risk|urgent|escalat*`
     were removed from `medicationDoseRiskPattern` in `clinical-search.ts` (with no medication/dose
     signal they misrouted topical queries into the dose plan). "What does the guideline say about
     suicide risk mitigation?" now classifies `document_lookup` and retrieves the Suicide risk
     mitigation doc at ranks #1–4 (was buried, docRecall 0.0). Regression guard added to
     `tests/clinical-search.test.ts`; all legit medication_dose_risk cases unchanged.
   - **8b. ✅ FTS over-conjunction — FIXED.** Root cause: `websearch_to_tsquery` ANDs every term, so
     the 7-term query "ciwa score threshold drug treatment alcohol withdrawal" matched **0** chunks
     even though the answer chunk exists ("CIWA-Ar score <10 or GMAWS <2 do not require drug
     treatment"); only generic `table_facts` (BGL/infusion "threshold/level" matches) filled in. Added
     `relaxVariantToOrQuery` + an OR-relaxation fallback in `searchTextChunkCandidates` (`rag.ts`):
     when the strict AND variants return nothing, retry once with a term-OR query — `ts_rank_cd` still
     ranks chunks matching more terms highest, so topical docs surface on top (verified: Alcohol
     withdrawal docs now fill top-5, `text_candidates` 0→48) without flooding, and it never displaces a
     working precise match. Unit tests in `tests/retrieval-query-variants.test.ts` + the
     `alcohol-ciwa-threshold` golden case guard it. **This is a general recall win, not just CIWA** —
     any long multi-term query previously risked silent 0-match FTS.

9. ⚠️ **OCR "dropped-s" heuristic — attempted then REVERTED (2026-07-01); bounded reference repair
   later landed (item 24). Historical post-mortem below.**
   - **What's true:** real dropped-'s' corruption exists in some table-derived index units
     ("psychosocial"→"p ycho ocial", "1st mood stabiliser"→"1 t mood tabili er"). The **raw
     `document_chunks` (answer context) are clean** — 0 docs below 0.025 s-ratio — so **generated
     answer text is not degraded**; the defect only touches structured _table_ units (OCR'd from
     images), and the intact numbers survive ("CIWA-Ar **core** <10" keeps the "<10").
   - **The detection is the hard part — every heuristic false-positives.** First tried an s-ratio
     detector (`'s'`/letter < 0.03): it flagged 772 units but **only 135 were real (82% false
     positives)** — clean low-'s' clinical prose ("Withholding warfarin and commencing enoxaparin …
     INR < 1.5") trips it. Switched to a fragmentation signal (orphan 1–2 char tokens): it then
     false-positived on legitimate short table cells (risk-matrix "A/B/C"), "e.g."/"i.e." → "e","g",
     and ordinals "1st"/"2nd" → "st","nd". Each refinement (lowercase-only orphans, common-word
     exclusions) removed some FPs and revealed others. **Conclusion: simple token heuristics cannot
     separate real corruption from legitimate structured/abbreviated clinical text.**
   - **Guard reverted.** The `buildUnit` guard (append clean source-chunk text when corruption is
     detected) was removed along with `hasSuspectedOcrDropout` — it would fire on thousands of
     false-positive units, appending chunk text broadly with a precision cost, for a modest benefit.
     Shipping an unreliable heuristic into live clinical retrieval isn't justified.
   - **Broad backfill (task B) NOT run.** A validation run on ~50 stale images (via
     `backfill-visual-intelligence`, embeddings-only) actually **raised** the (mis)count, which is what
     exposed the detector's false positives. Those images were legitimately refreshed (they were
     version-stale anyway); a few units carry harmless appended source-chunk context from the
     since-reverted guard — will normalize on the next reindex. No further docs were processed.
   - **Current disposition (2026-07-27):** the broad low-`s` and token-fragment heuristics remain
     rejected. Item 24's dictionary/reference-backed repair now fixes only whitespace-fragmented OCR
     words aligned to clean same-page source text and directly covers `p ycho ocial`. The implementation
     is complete; a provider-backed backfill and live warning/repair-rate measurement were not run.
     Other enrichment work remains separate: confirm `20260627000000_retrieval_hnsw_ef_search.sql` on
     live; run `enrich:backfill` / `tags:backfill` only for genuinely missing synopsis/labels.
10. 🔧 **Query understanding (RC6/E) — pg_trgm typo correction started (2026-07-01).**
    - **Data-driven promotion is blocked:** `rag_query_misses` (71 rows) are privacy-redacted hashes
      with empty `candidate_aliases`, so the plan's "promote real misses to aliases" path can't run.
      Usable infra: `rag_aliases` (64 rows) + trigram indexes on `rag_aliases.alias`, `documents.title`,
      `document_labels.label`.
    - ✅ **pg_trgm term corrector** — migration `20260701060000_clinical_query_term_trgm_correction.sql`
      adds `correct_clinical_query_terms(text, min_sim)`: trigram-matches each query token against a
      vocabulary (rag_aliases aliases+canonicals + indexed document-title words) and replaces confident
      near-misses. Guards against false positives: only length ≥ 4 tokens, only same-length-or-longer
      matches (blocks morphological shortenings like "treated"→"treat", "symptoms"→"symptom"),
      min_sim 0.45. Validated: clozapin→clozapine, agitaton→agitation, schizophrenai→schizophrenia,
      bipoler→bipolar, withdrawl→withdrawal, lithiun→lithium; clean queries unchanged. ~85ms.
    - ✅ **Wired as a text-search fallback** in `searchTextChunkCandidates` (`rag.ts`): when strict AND
      variants return nothing, correct the query and retry (strictly, then OR-relaxed) _before_ the 8b
      OR-relaxation, so a typo like "clozapin monitoring" resolves to clozapine rather than OR-matching
      generic "monitoring" docs. Verified end-to-end: "clozapin anc threshold"→Clozapine docs, "dischage
      planning"→Discharge Planning. Golden set unchanged (23/23, no regression); 682 tests pass.
    - ✅ **Correction before the unsupported short-circuit (2026-07-01).** `searchChunksWithTelemetry`
      (`rag.ts:4986`) now, when a query would short-circuit as unsupported, trigram-corrects it and —
      if it changed — re-runs the whole retrieval once on the corrected text (guarded by an internal
      `typoCorrected` flag; only fires for would-be-unsupported queries so no hot-path cost). Rescues
      typo queries whose corrected form is a _supported_ class (e.g. a typo'd clozapine/dose query
      → table_threshold). Golden 23/23 unchanged, 682 tests pass.
    - ✅ **Finding #11 FIXED (2026-07-07) — corpus-grounded relevance.** Root cause was the
      nondeterministic LLM classifier deciding the unsupported soft tail (see
      docs/process-hardening.md 2026-07-03 entry). Two-part fix: PR #325's classifier-verdict
      memoization (interim determinism per query per 15-min TTL), then the Phase-2 fix on
      `claude/retrieval-correctness`: `corpus_topic_term_stats` (migration `20260707100000`,
      applied live) + `src/lib/corpus-grounding.ts` classify soft-tail queries against the
      corpus's own topic vocabulary (title-tsvector matches under a 5% genericity ceiling;
      chunk-absence = invented term) BEFORE any LLM call. In-corpus bare topics ("bipolar
      disorder", "anorexia management") deterministically reclassify to `broad_summary` and
      answer (verified live: 4/4 identical runs, docs at rank 1); corpus-absent queries
      ("florbizone syndrome management", "quxbyria disorder treatment") skip the LLM and refuse
      deterministically, with the trigram-correction escape hatch preserved for typos.
      Invented-term controls added to `ragEvalCases`; bare-topic golden cases added
      (`bare-topic-bipolar`, `bare-topic-anorexia`). Inconclusive verdicts (e.g. "gout
      management" — chunk-present but no title topic) keep the legacy memoized-LLM behaviour.
    - ⏳ Still hard-coded (lower priority now the trigram path exists): moving `synonymGroups` /
      `domainAliasGroups` / `medicationAliasGroups` into `rag_aliases`; generalising the special-case
      rewrites off `RagQueryClass`. **Design constraint (2026-07-07):** this is NOT a plain seed
      migration. The groups are consumed inside the synchronous deterministic analyzer
      (`analyzeClinicalQuery`), which must keep working in demo mode and in unit tests without a
      DB, while `rag_aliases` rows flow through a different mechanism (`fetchEnabledRagAliases` →
      retrieval query variants + the unsupported-short-circuit alias guard). Seeding the same
      groups into `rag_aliases` while the in-code groups remain would double-expand variants and
      change short-circuit behaviour corpus-wide — a behavior change needing its own golden +
      rag-only eval run, not a data chore. Deferred from the 2026-07-07 retrieval-correctness
      branch for that reason; do it as a dedicated eval-gated change (either an async analyzer
      vocabulary refactor, or DB-only expansion with the in-code groups retired from the variant
      path in the same change).

## P2 — offline/fallback remainder (Workstream F)

11. 🔶 **AI degradation visibility — PARTIAL.** Deep health exposes configured provider mode plus
    trailing degraded-answer and failure counters without making a paid provider call. Remaining:
    wire the existing thresholds/nightly canary into an operator alert channel. Do not add an active
    OpenAI request to the ordinary health endpoint merely to report reachability.
12. ✅ **Answer cache for offline/repeat reuse — DONE.** Process-local and owner-scoped shared
    `rag_response_cache` `cache_kind='answer'` paths are implemented and labelled as cached. The
    2026-07-14 retention reconciliation removes the duplicate unbounded purge job and keeps one
    hourly purge capped at 1,000 expired rows. Applied live 2026-07-14: bounded job 16 is active, the
    duplicate unbounded job is absent, and the cache contained no expired rows at verification time.
13. ✅ **Auto-degrade generation fallback labelling — DONE.** Final answer quality labelling stamps
    source-only answers with `answerQualityTier`, `fallbackReason`, and explicit `degradedMode`.
14. ✅ **Source-only disclosure browser assertion — DONE.** `tests/ui-smoke.spec.ts` asserts the
    `source-only-disclosure` badge and verify-against-sources guidance.

## P2 — naturalness residual

15. ✅ **Flattened TPR / postural-BP run-on — FIXED.** `polishClinicalAnswerProse` now separates the
    inpatient/community clauses deterministically with and without the comma form. Focused coverage
    in `tests/answer-prose-runons.test.ts` pins the original line and guards normal prose.

## Security (do outside this repo)

16. ⏳ **ROTATE all secrets** pasted in plaintext this session: OpenAI key, Supabase `service_role`
    JWT + legacy JWT secret, DB password, E2E password. `.env.local` is gitignored, but the values
    were exposed in chat.

## Follow-ups filed 2026-07-06 (universal-search workstream)

17. 🔶 **Alias promotion pipeline is blocked by privacy redaction — PARTIALLY UNBLOCKED
    (2026-07-06).** Weak-search misses now store `queryVocabularyAliasesForStorage(query)` as
    `candidate_aliases` when raw retention is off: only canonical terms from the curated
    clinical vocabulary that the query MATCHED are persisted (output text comes from the fixed
    vocabulary table, never the raw query, so RET-H4 holds). Remaining: terms OUTSIDE the
    curated vocabulary still cannot be captured without a privacy review; promotion tooling
    from `candidate_aliases` → `rag_aliases` is still manual.
18. ✅ **`document_index_units` vector recall / HNSW measurement — CLOSED as not worth adding
    (2026-07-09).** Measured with live keys under the explicit eval budget. Production baseline
    `eval:retrieval:quality -- --force-embedding` produced `document_recall_at_5=0.9306`,
    `content_recall_at_5=1`, `top_k_hit_rate=0.9444`, `force_embedding_failure_count=0`,
    `p90_latency_ms=23293`, and `index_units_layer_count=0`. A data-cloned Supabase preview branch
    (`rag-index-units-hnsw-20260709`) was created, branch-only HNSW index
    `document_index_units_embedding_hnsw_idx` was applied and confirmed, then the same eval was run
    against the branch. Candidate result: recall unchanged, failed cases unchanged, `index_units` still
    unused, median latency worsened by `+3698ms`, p90 worsened by `+13963ms`. The preview branch was
    deleted. **Do not add this HNSW index to production.** Revisit only if the retrieval path is changed
    to actually use `document_index_units.embedding` and a new eval shows at least one recall win without
    material p90 regression.
19. ✅ **Demo fallback can mask live retrieval failures in non-prod — DONE (2026-07-06).**
    `nonProductionSupabaseDemoFallbackReason` (the shared choke point for /api/search,
    /api/answer, and /api/answer/stream) now emits a loud `console.warn` naming the env vars to
    check whenever the non-prod demo fallback fires; behaviour and the
    `X-Clinical-KB-Fallback` header are unchanged. A visible dev-mode banner remains optional.
20. ✅ **Automated guard for governance-weighting regressions — ALREADY COVERED.** A keys-free
    structural test exists: `tests/retrieval-selection.test.ts` ("keeps relevance ordering and
    does not let source-governance metadata reorder selection") asserts a higher-relevance
    `review_due`/`unverified` source outranks a lower-relevance `current`/`reviewed` one. The
    manual golden-eval checklist remains the live backstop; no further action.
21. 🔶 **Recalibrate gates for synthetic text-only similarity (RC9 residual) — DATA NOW
    FLOWING (2026-07-06); audited 2026-07-07, scope reduced.** `synthetic_similarity_count` and
    `text_or_relaxation_used` are now persisted into `rag_retrieval_logs.metadata` (they were
    computed but dropped by the telemetry whitelist in /api/search). Once ~2 weeks of live rows
    exist, recalibrate `evaluateEvidenceCoverageGate` / text-fast-path thresholds against real
    cosine distributions: query `metadata->>'synthetic_similarity_count'` joined to `is_miss` to
    see how often synthetic scores cross the 0.58/0.62 gates on misses vs hits. Full consumer
    audit on `claude/retrieval-correctness`: the headline `least(0.95, 0.56 + text_rank*0.39)`
    proxy NO LONGER EXISTS — `match_document_chunks_text` already returns `similarity = 0` with
    hybrid capped at 0.5 and the lexical signal isolated in `lexical_score` (codified in
    schema.sql with the "do not fabricate" comment). What remains synthetic are three app-side
    fabricators, all tagged `similarity_origin: "synthetic_text"`: the document-lookup fast path
    (0.58 + documentScore, hybrid ≤ 0.94), memory-card chunk loader (0.58 + confidence·0.28,
    hybrid ≤ 0.89), and table-fact signal matches. Their consumers:
    `evaluateEvidenceCoverageGate` / `shouldReturnTextFastPath` / `chooseAnswerRoute` /
    `shouldUseExtractiveAnswer` (thresholds 0.32–0.76 — the fabricated 0.58 floor is
    deliberately load-bearing there, always paired with structural checks like
    `directTitleSupport`; re-gating them on native signals is the deferred recalibration and
    must not be attempted without the telemetry distributions), `buildRetrievalDiagnostics`
    (topScore < 0.5 weak gate — floor also load-bearing), and `deriveConfidence`. **Fixed
    (2026-07-07):** `deriveConfidence` no longer lets a fabricated 0.82+ mint a "high"
    answer-confidence label — "high" requires a genuine-cosine citation; synthetic-origin
    evidence caps at "medium" (strictly tightening, ordering/routing untouched, unit-tested in
    tests/rag-score.test.ts).
22. ✅ **Registry-to-corpus embedding (universal search Phase 5) — implemented behind the
    default-off flag, live owner embedded, and blocking gates clean (2026-07-09).** Medications/services/forms/differentials are federated into
    `/api/search/universal` but were not retrieval-corpus entities, so Answer mode could not cite them.
    Implemented pieces: `RAG_REGISTRY_CORPUS_EMBEDDING` default-off flag,
    `scripts/embed-registry-records.ts` dry-run/write/list-owner tool, synthetic document/chunk mapping
    with `metadata.source_kind = 'registry_record'`, source-governance labelling, comparator tooling,
    seed/reseed embedding paths, `reembedRegistryRecordAfterEdit` / `bestEffortReembedRegistryRecordAfterEdit`,
    and registry corpus tests. The sentinel-owner dry-run
    (`00000000-0000-0000-0000-000000000000`) correctly found zero rows. `--list-owners` found the real
    registry owner `4f1b3c19-3c39-4597-b9df-168c8e6007ff` with 739 eligible rows; guarded write with
    `RAG_REGISTRY_CORPUS_EMBEDDING=true --write --confirm` upserted 739 synthetic registry corpus
    chunks. Post-write retrieval eval passed with `document_recall_at_5=1`, `content_recall_at_5=1`,
    `top_k_hit_rate=1`, `force_embedding_failure_count=0`, `failed_cases=[]`. Post-write
    `eval:quality -- --rag-only` completed under budget; invented-term controls still refused and
    numeric grounding failure rate was `0`. The post-routing RAG-only rerun then cleared the former
    blocker metrics: `citation_failure_rate=0`, `numeric_grounding_failure_rate=0`, no blocking threshold
    failures, and `p95_latency_ms=20385`. Two individual cases still exceeded the 20-second latency target;
    that non-blocking performance debt remains tracked in item 25. Current productization boundary: there are no mutating registry
    edit routes today, so the re-embed-on-edit helper is present but not wired to a route; any future
    registry `POST`/`PATCH`/`PUT` path must call `bestEffortReembedRegistryRecordAfterEdit` after the
    write commits. The former citation UX follow-up is complete: `documentCitationHref` routes
    registry-backed citations to their native service/differential detail pages, with focused tests
    in `tests/citations.test.ts`.
23. ✅ **Finding #11 full fix — CLOSED.** The corpus-grounded relevance implementation described in
    item 10 (2026-07-07) superseded the earlier classifier-memo-only state. In-corpus bare topics and
    corpus-absent invented terms now follow deterministic corpus evidence; no duplicate Phase-2 task
    remains. Item 17's broader alias-promotion privacy/design work remains separate.
24. ✅ **OCR dropped-letter corruption in table index units — bounded repair landed.** The broad
    low-`s` heuristic remains rejected, but `repairOcrDropoutAgainstReference` now repairs only
    whitespace-fragmented OCR words that align to the same page's clean source-chunk text and stamps
    `ocr_repair_version=clean-chunk-fragment-v1`. `tests/document-index-units.test.ts` covers
    `p ycho ocial` → `psychosocial` plus the single-letter clinical-token false-positive guard.
    No broad provider-backed backfill was performed during this reconciliation.
25. 🔶 **Retrieval/RAG latency — serial-depth fixes landed; targeted table-facts DB plans are now
    acceptable, while the broader end-to-end tail remains.**
    Post-registry retrieval stayed quality-clean (`top_k_hit_rate=1`, `document_recall_at_5=1`,
    `content_recall_at_5=1`, `force_embedding_failure_count=0`) with local `p90_latency_ms=13145`.
    Post-routing RAG-only passed with `p95_latency_ms=20385` and no blocking threshold failures, but
    local-machine→remote-DB latency and remaining sequential layers still justify a measured perf pass.
    The 2026-07-14 local fix removes the second blocking `rag_response_cache` miss-diagnostic query and
    starts document metadata/index-quality plus page/direct-image hydration reads concurrently. Focused
    tests prove one shared-cache read per filtered miss and both concurrency boundaries.

    **Approved live comparison (2026-07-14):** a warmed repeat reported `supabase_rpc_latency_ms=0`,
    while two cold synthesis probes spent 48.5–49.4s in Supabase RPCs and 51–53s total. A six-case
    live-database retrieval run on the local code kept `document_recall_at_5=1`,
    `content_recall_at_5=1`, and `top_k_hit_rate=1`, with 1.8s median / 47.3s p90. Database statement
    statistics identify the legacy hybrid chunk/embedding-field RPC families as the tail source, with
    material temporary I/O. Forced-embedding/model-routing evaluation stopped after the provider
    returned quota exhaustion; no model or production configuration was changed.

    **Superseded next step:** do not optimise the table-facts plan, alter ranking, or scale compute from
    the earlier broad tail alone. The phase-aware profile below shows bounded database execution and a
    visible client/edge component. If the broad end-to-end tail persists, profile first-unprimed versus
    warm orchestration phases and remaining serial RPC depth separately; only reconsider compute after
    a repeatable database-plan bottleneck is demonstrated.

    **Targeted hosted profile (2026-07-27):** the first exact clinical-query pass recorded warm
    PostgreSQL median/p90 execution of 43.045/43.757 ms for clozapine, 75.489/81.738 ms for lithium,
    and 59.243/60.309 ms for metabolic monitoring; corresponding client median/p90 was
    210.193/217.388, 226.029/253.273, and 204.702/213.108 ms. A subsequent six-sample phase-aware pass
    labelled sample 1 `first_unprimed` and samples 2–6 `warm_repeat`: first-unprimed client/DB execution
    was 662.916/141.537, 277.661/96.229, and 322.598/148.378 ms respectively; warm DB median/p90 was
    88.292/89.355, 64.342/65.566, and 107.448/148.417 ms, while warm client median/p90 was
    187.029/198.907, 167.803/174.391, and 189.065/243.324 ms. Managed Supabase buffers were not flushed,
    so this deliberately does not claim a true cold-start measurement. The table-facts RPC is not the
    multi-second tail and is closed without hosted migration or ranking changes; broader latency remains
    an orchestration/RTT observation to diagnose independently.

26. ✅ **Fallback answer quality and measurement — CLOSED (2026-07-27).** The earlier 12/30 and
    3/44 review-fallback inventories are superseded. Evaluation now separates
    `source_backed_review_fallback` from substantive grounded answers and does not award targeting
    credit to echoed query boilerplate. Narrow source-bound paths cover the reproduced
    admission/discharge, active-community ED, community-home-visit, clozapine threshold/typo and Best
    Practice Prescription shapes. A cited provider source-gap is no longer promoted to grounded merely
    because its citation IDs are valid; it retries or enters source-backed recovery, while terminal gaps
    clear claim citations and retain an auditable reason. The final live 44-case gate recorded 30/30
    substantive grounded supported answers, 14/14 unsupported correct, zero review fallbacks, zero
    citation or numeric failures, zero route-ceiling failures, and p95 7,494 ms. The protected 36-case
    retrieval canary stayed at document/content recall 1.0 with no per-case reciprocal-rank regression.
    See `docs/evidence/rag-reliability-evidence-2026-07-27.md`.
