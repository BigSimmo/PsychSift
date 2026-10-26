# Refuted ranking-improvement approaches (2026-07-20)

Two approaches to the fast-path rank-depth headroom were implemented, live-tested, and refuted
in one evening. They are recorded here so no future task re-attempts them in the same shape.
Full audit trail: `docs/branch-review-ledger.md` (2026-07-20 rows), PRs #1003–#1006.

## Refutation 1 — per-class feature-weight tuning (Phase B): live no-op

- **Shape:** offline tuner on the provenance-stamped ranking snapshot recommended three
  constrained per-class `featureFusion` nudges (document_lookup titleSectionRelevance→0.9,
  table_threshold clinicalEvidence→0.95, comparison hybridRelevance→0.95; proxy comparison-mrr
  0.833→1.0). Staged live via the `rag_ranking_config` dispatch input — no code defaults
  touched.
- **Live pair (#53 baseline vs #54 tuned, override proven active in the run log):**
  mrr@10 0.8922 → 0.8921; irrelevant@10 0.1083 → 0.1083; every headroom case byte-identical.
- **Why it failed:** the 5-candidate linear proxy space saturates — the proxy's predicted gains
  were already realized live, and the real headroom lives in saturated-tie structure that
  feature weights cannot express.
- **Standing consequence:** tuner recommendations are hypotheses only; adoption requires a live
  pair with measured gain (none → not adopted; nothing was rolled back because staging is
  per-run).

## Refutation 2 — saturation-tail spread of comparator keys (Phase C): live regression

- **Shape:** a pure, monotone, set-independent tail spreading tied imputed primaries inside
  "dead" score bands — table-fact `similarity` into (0.92, 0.94), lexical-chunk `hybrid` into
  (0.48, 0.5). Passed a red-proven discriminating test, tie-conservation guard, 121/121
  targeted offline tests, full-suite, AND an adversarial code review (APPROVE-WITH-NITS —
  the envelope math was correct: no gate crossed).
- **Live pair (#54 baseline vs #55 on the merged change):** FAILED 3/36 — doc_recall
  1.0 → 0.9167, mrr@10 0.8921 → 0.8138; patient-property rr 1.00 → 0.11, schizophrenia-overview
  1.00 → 0.14, patient-safety-plan 0.33 → 0.14. Reverted within the hour (#1005); restoration
  confirmed by canary #56.
- **Why it failed:** hybrid (S1) and similarity (S2) sort ABOVE `relevance.score` in the
  release comparators. Spreading them — even inside gate-free value bands — moved tie
  resolution from the boost/title/subject-aware relevance rank to raw ts_rank order.
  Lexically-loud chunks leapfrogged title-boosted correct documents: the #118 burial mechanism,
  reproduced live. The "arbitrary" ties were not arbitrary — relevance was already resolving
  them correctly.
- **Why offline missed it:** the discriminating fixtures used identical-content candidates
  (every key tied), which structurally cannot expose an ordering flip between
  differently-relevant candidates. The adversarial review audited values and gates, not the
  comparator _precedence_ semantics.

## Binding constraints for any third attempt

1. **Position:** a text-rank discriminator may only be inserted strictly BELOW
   `relevance.score` in the release comparators (i.e. between relevance and the id fallback),
   or as a bounded term INSIDE the relevance rank itself — never as/above a primary key.
2. **Fixtures:** the discriminating offline test must use differently-relevant candidates
   (different boosts/titles/coverage) and prove the OLD code orders them correctly by
   relevance while the id-fallback case improves — identical-content fixtures are disallowed
   as sole proof.
3. **Live pair:** dedicated baseline + post canary with doc/content recall pinned at 1.0 and
   zero per-case rr regressions; any regression = immediate single-commit revert (both
   directions proven cheap tonight).
4. **Approval:** separate explicit user approval; provider-backed runs are never automatic.
5. **Honest sizing:** the prize is rank depth on 3–4 already-passing cases (~0.03–0.08 mrr).
   Weigh against the demonstrated regression risk before attempting at all.

## Refutation 3 — governance metadata ranking penalties/boosts: measured regression (do not implement)

Ledger `#032` / source-governance audit (PR #1051) items that look like “gaps” but are **deliberate, measured non-features**:

- `review_due` carries **no** ranking penalty
- `unknownCurrentnessPenalty` ships at **0**
- `selectBestSourceRecommendation` **ignores** governance metadata for ordering

**Do not implement blanket governance ranking penalties or boosts.**

- **Measured harm (2026-07-02):** golden retrieval regressed to 16/23 (doc-recall@5 1.0→0.76, mrr 0.75→0.64) when metadata boosts/penalties reordered selection.
- **Why it fails here:** relevance scores saturate at the clamp, so stacked metadata swings override lexical relevance; the corpus is only partially enriched and `normalizeSourceMetadata` coerces unenriched docs to `unknown`/`unverified` — **unknown ≠ bad**. Even governance-as-tiebreak buried correct unenriched docs (three designs bisected).
- **Standing guard:** `tests/retrieval-selection.test.ts` keeps relevance ordering and asserts a higher-relevance `review_due`/`unverified` source outranks a lower-relevance `current`/`reviewed` one (`docs/rag-hybrid-findings-and-todo.md` item 20).
- **If ever revisited:** only via **RC8 — source-strength as a filter, not a penalty/boost in selection ordering**, gated on `eval:retrieval:quality` 36/36 plus an approved live canary pair. Prompt-side governance caveats are a separate generation-surface item (`#033`), not a ranking change.

## Refutation 4 — plural antipsychotic classifier correction alone: wrong-subject answer

- **Shape (2026-07-27):** the exact metabolic-monitoring case was classified as
  `document_lookup` because `medicationDoseRiskPattern` recognized singular `antipsychotic`
  but not plural `antipsychotics`. A one-token `antipsychotics?` correction was RED-proven
  locally and changed the live case to `medication_dose_risk`.
- **Live result:** targeting remained `0` with `no schedule/interval`, and the extractive
  recovery changed from schedule-free metabolic prose to an unrelated clozapine-clinic
  sentence. The expected metabolic document still ranked first, but its retrieved text and
  table facts did not contain an auditable monitoring schedule; its table image had no
  accessible table text. No model request or OpenAI cost was incurred.
- **Disposition:** the candidate was reverted immediately. Do not reintroduce the classifier
  correction as a standalone answer-quality fix. The remaining work is structured
  table/ingestion evidence for the schedule, followed by a fresh fixture and live canary; do
  not infer a clinical schedule from an image caption or loosen answer gates.

## Refutation 5 — generic comparator rejection or broad-citation retry for the ECT flow edge

- **Observed artifact (2026-07-27):** flattened OCR represented a procedural edge as
  `Referral for ECT > 6`. Treating every `> number` expression as structural is unsafe: real
  clinical thresholds, decimal comparators such as `> 6.5`, and ECT treatment counts also use
  comparator syntax.
- **Rejected recovery:** forcing the case through broader multi-source/model generation retained
  irrelevant citations and ended in generic review-fallback wording rather than a substantive
  ECT process answer.
- **Adopted bounded handling:** reject only the exact ECT referral-edge shape (with an optional
  table-normalization colon) and unambiguous arrow glyphs, rebuild every derived evidence surface
  from surviving sources, and reflow the known wrapped BASE directive. Negative fixtures preserve
  ordinary measurements, `> 6.5`, `> 7`, `> 60`, and treatment-count prose. The final live ECT case
  returned the complete Booking Assistant Scheduling Engine (BASE) step, grounded and substantive,
  with zero provider calls in about 1.3 seconds.

## Refutation 6 — token streaming to cut perceived answer latency (do not reintroduce)

Recorded 2026-07-29 from the latency audit (`docs/audit/latency-audit-2026-07-28.md`, L0-1). Unlike
Refutations 1–5 this was not re-attempted and measured — it is recorded **because the defect it
would "fix" is real and highly visible**, so the wrong fix is the one a future task will reach for
first.

- **Status note (2026-10-20).** Since 2026-08-27 the Phase 1 evidence preview
  (`RAG_INCREMENTAL_EVIDENCE_PREVIEW`, default on; `docs/verified-answer-incremental-delivery-design.md`)
  sends verified source cards before the final answer, so the panel is no longer blank for the whole
  wait. The answer prose itself still arrives in one `final` frame, and the timing measurement that
  would show how much earlier the first content now appears was not yet built. (Updated 24 Oct 2026:
  it has existed since commit `3145db839`, 21 Oct 2026. Answer logs now record
  `first_verified_content_ms` beside `total_latency_ms` when a preview was sent, and the SLO snapshot
  reports `timeToFirstContent` p50/p95. It is display only; no alert reads it.) The refutation below
  stands: the preview sends verified units, never raw tokens. Line numbers below were replaced with
  symbol names on 2026-10-20 because they had drifted.
- **The real defect.** Generation is fully buffered (`src/lib/openai.ts`, the comment _"Buffered
  (non-streaming) request — the baseline behaviour"_; only `responses.create`/`.parse`, never
  `.stream`), and the whole answer reaches the client in **one** `final` SSE frame
  (`sendFinal` in `src/app/api/answer/stream/route.ts`). So, before the evidence preview,
  **time-to-first-content equalled total answer latency**: a strong-route answer sitting perfectly inside its 25 s SLO still shows the clinician a
  blank panel for up to 25 s. `src/lib/sse-heartbeat.ts` sends a keepalive every 15 s because that
  silence routinely exceeds 15 s — it instruments the defect rather than fixing it.
- **The obvious fix is already refused in code.** `src/lib/answer-stream-contract.ts` (the
  "rolling deployment" comment) deliberately excludes the legacy `token` and `revising` event names: _"A new client can be routed
  to an older server during a rolling deployment, so accepting those events would re-expose
  unvalidated clinical prose."_ Token streaming **existed here and was removed as a clinical-safety
  control** — this is a prior decision, not an unbuilt feature.
- **Why it cannot simply come back.** Every answer clears a post-generation pipeline over a
  `responses.parse` structured object: `sanitizeCitations` (`rag.ts`),
  `sanitizeAnswerText`/`sanitizeStructuredText`, `applyNumericVerification` /
  `unboldUnverifiedNumbers`, `sanitizeQuoteCards`, `assessAndEnforceClaimSupport`. Forwarding raw
  tokens bypasses the numeric-faithfulness gate the 2026-07-01 audit filed as H1 — the gate that
  exists so a wrong dose or threshold never reaches a clinician as if verified.
- **Only admissible shape for a third attempt.** Progressive disclosure of _already-verified units_:
  retrieval-complete evidence and sources first, then each answer section **after that section
  clears verification**, carried over the existing whitelisted `progress` event. Never a
  reintroduced `token`/`revising` name, and never partial prose ahead of its own verification.
- **Standing constraint.** Any such change needs a clinical-governance decision **before** code, plus
  a live canary pair. Abort immediately if a design requires widening
  `answerStreamEventNames`. Tracked as ledger `#100`.

## Related follow-up plans

- **Word-boundary content matcher — ✅ IMPLEMENTED (2026-07-20, same-day follow-up).**
  `textContainsClinicalTerm` now matches on non-alphanumeric boundaries. Safety: proven strict
  superset by artifact replay (canary #53: 1,126 comparisons, 0 lost matches, 7 gained — the
  exact known punctuation-joined occurrences). The weekly scheduled canary provides the free
  live confirmation; a more-tolerant matcher cannot fail a previously-passing case.
- **irrelevant@10 labeling audit — diagnostics completed 2026-07-27; no ranking action.** Scheduled run
  `30216191889` kept irrelevant@10 exactly 0.0917 versus baseline `30018289898`. The 12 cases with
  non-zero rates and their top-10 titles/previews showed no broad under-labelled-sibling pattern;
  the obvious tail rows were off-topic service records, unrelated conditions, or generic policy
  fragments. The current artifact now persists each row's `relevanceGrade` and
  `matchedDeclaredSignals`; focused tests cover ideal and zero-grade rows, closing #084. Human
  disposition remains #023. Keep treating this as an evaluation-label audit surface, not permission
  to change ranking (`docs/observability-slos.md` §3.1).
- **Answer-side quality:** the final 44-case run passed every blocking gate with 30/30 substantive
  grounded supported answers and zero source-backed review stubs. #029 is resolved, and the quality
  gate now blocks any recurrence of that fallback rather than merely reporting it.
