# Clinical RAG Improvement Programme — reviewed and updated implementation guide

> **Status (2026-10-20): programme complete; kept as history.** Every packet in the
> [HANDOVER status table](HANDOVER.md) has merged or been closed, and S8 onward stays gated on an owner
> decision. This is no longer the operational board: open RAG work lives in
> [`docs/outstanding-issues.md`](../outstanding-issues.md), and the rules live in
> [`docs/rag-behaviour/`](../rag-behaviour/README.md). Code comments still cite its sections, so it stays in
> place rather than moving to `docs/archive/`.

**Status:** maintained plan (2026-08-13). Supersedes the uploaded "Clinical RAG Improvement
Programme" PDF, which was pinned to main `130c7746` (main is now past `67db5a1`) and predates
several repo changes. This guide is grounded in the current codebase and is the working
reference for elevating the RAG: first the answer itself (intent-aware related information,
higher clinical yield, moderately longer output), then the PDF's evaluation/safety
infrastructure, corrected.

**Scope discipline:** every Track A item touches protected RAG surfaces
(`docs/rag-behaviour/safeguards.md`). Each PR must flag RAG impact before editing, carry a
`RAG impact:` line in its body (`scripts/pr-policy.mjs` blocks the merge otherwise), and any
behaviour change needs a live eval-canary pair (provider-backed, ~$1–2, explicit approval per
run). Nothing here authorises reindexing, migrations, or provider calls by itself.

**Canonical task queue:** per `AGENTS.md`, canonical cross-session task tracking and deduplication live in [`docs/outstanding-issues.md`](../outstanding-issues.md). Always consult the canonical ledger first. Check open PRs only when explicit owner approval for provider access exists; otherwise continue with local/offline evidence and note the duplicate-risk caveat.

---

## 1. Review verdict on the original PDF

### 1.1 Agreed — retained (with corrections applied in Track B)

| PDF item                                                                                    | Verdict                      | Why                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Additive, gate-first philosophy; no production change without a measured promotion gate     | **Keep**                     | Matches the repo's standing rule: "offline green is necessary, never sufficient" (`docs/rag-behaviour/README.md`) — the Phase C regression passed 121/121 offline and failed 3/36 live.                                                                                              |
| Phoenix deferred; assess existing Sentry first with an allow-listed telemetry contract      | **Keep**                     | `src/instrumentation.ts` + `src/lib/observability/agent-monitoring.ts` already trace without content capture; a second tracing vendor adds a data-processing route before proving value.                                                                                             |
| Docling as isolated lab benchmark → worker shadow mode only after Gate B                    | **Keep**                     | The known weak point is tables/layout/OCR; `src/lib/index-quality.ts` signals can select a small shadow cohort instead of mass reprocessing.                                                                                                                                         |
| Offline adversarial (Promptfoo) harness, synthetic-only, network-free                       | **Keep — genuinely missing** | The injection defences exist at runtime (`answerInstructions` §"Source excerpts are untrusted data" in `src/lib/rag/rag.ts`, `hasAdversarialManipulationIntent` in `src/lib/rag/rag-routing.ts:329`) but no fixture suite pins them; a prompt edit could silently weaken them today. |
| Reranker benchmark constraints: 36/36, zero per-case regression, latency/cost headroom      | **Keep**                     | Consistent with refutations 1–2 and outstanding issue `#001` (semantic rerank stays off without an approved ambiguity comparison).                                                                                                                                                   |
| DSPy deferred until ≥100 labelled cases                                                     | **Keep, re-scoped**          | See disagreement 2 — the proposed "query intent classification" target already exists in triplicate.                                                                                                                                                                                 |
| CI tiering through `scripts/ci-change-scope.mjs`, no duplicate workflows, cancel-superseded | **Keep**                     | Matches the existing risk-scoped CI design.                                                                                                                                                                                                                                          |
| PHI posture: synthetic/de-identified fixtures only; canary strings in every sink            | **Keep**                     | Aligns with the privacy boundary and `#053`.                                                                                                                                                                                                                                         |

### 1.2 Disagreed — corrected in this guide

1. **Stale pin and a name collision.** The PDF's PR 0 proposes adding
   `npm run check:rag:fixtures`. That command **already exists**
   (`scripts/check-rag-fixtures.mjs`, validating the golden retrieval fixture and ranking
   snapshot). The adversarial fixture validator must be a new command
   (`check:rag:adversarial-fixtures`) or an extension of the existing script — never a
   silent replacement.
2. **"Add query-intent classification" duplicates existing machinery.** Intent detection
   already exists in three layers: `RagQueryClass` (6 classes, `src/lib/types.ts:718`, with
   an LLM classifier fallback at `rag.ts` `analyzeQueryWithClassifierFallback`),
   `ClinicalQueryIntent` (8 intents, `src/lib/clinical-search.ts:838`), and the
   user-selectable `ClinicalQueryMode` (7 modes whose `clinicalModePrompt` is already
   injected into generation). The genuine gap is **per-intent answer composition** — what
   the answer shows for each question type — not detection. Track A2 targets that gap;
   the PDF's DSPy lab is re-scoped away from classification.
3. **The PDF optimises everything except the answer.** It contains no item on related
   information, answer length, clinical yield, or follow-up questions — the owner's actual
   priority. Track A (new) fills this and is sequenced **first**.
4. **No engagement with the refuted-approaches ledger.** `docs/rag-behaviour/refuted-approaches.md`
   records live-refuted shapes the PDF's conditional experiments could re-walk:
   per-class feature-weight tuning (live no-op), comparator-key spread (live regression,
   doc-recall 1.0 → 0.9167), governance currentness penalties/boosts (measured harm —
   deliberately shipped at 0), and token streaming (removed as a clinical-safety control;
   raw tokens bypass post-generation verification). Binding constraints are now embedded in
   Track B items 6–7: any new ranking discriminator sits **strictly below `relevance.score`**;
   benchmark fixtures must use differently-relevant candidates (identical-content fixtures
   are how Phase C's regression escaped offline detection); a live canary pair is mandatory.
5. **Ignores outstanding issue `#231`'s actual stop condition.** The 35–40-second route-budget
   probes were already tested and rejected. In the decisive probe, generation completed
   within budget with `route_deadline_exceeded=false`, but generation quality still failed
   and the answer degraded to source-only. The prerequisite is therefore structured
   generation-failure attribution and provider-safe instrumentation — not a larger timeout.
   Track A1 starts there and forbids budget increases unless new evidence directly overturns
   the recorded result.
6. **Roles table presumes a team.** Product/privacy/application/worker/evaluation owners are
   one person here. Collapsed to: **owner** (clinical intent, privacy sign-off, release
   thresholds, canary approval) and **agent sessions** (implementation, gates, evidence).
7. **Follow-up assumptions were wrong.** The repository already has
   `buildAnswerFollowUpSuggestions` and `buildAnswerFollowUpQuery` in
   `src/lib/answer-follow-up.ts`; `ClinicalDashboard.tsx` computes the suggestions and
   renders wired phone and desktop chips. The genuine gap is stronger evidence gating and
   intent/composition-aware selection on that existing surface, not a duplicate module,
   `RagAnswer` field, or render block. `relatedDocuments` also already exists
   (`buildRelatedDocumentsSafe` in `rag.ts`, rendered under `trustCaps[trust].related` in
   `src/lib/answer-render-policy.ts`). Track A4 refines what is present.

---

## 2. Current-state anchor (what the pipeline already does)

Read `docs/rag-behaviour/` first for the protected mechanics. The short version relevant to
this plan:

- **Flow:** `/api/answer` → `answerQuestionWithScopeUncoalesced` (`src/lib/rag/rag.ts`) →
  hybrid retrieval (vector + tsvector + trigram + aliases + table facts + index units) →
  `selectRetrievalEvidence` (`src/lib/retrieval-selection.ts`) → deterministic second stage
  (`src/lib/rag/rag-second-stage.ts`) → `chooseAnswerRoute` (`src/lib/rag/rag-routing.ts`) →
  fast/strong generation (reasoning-effort routing, not different models) → numeric
  verification, claim support, citation sanitisation → render policy trust ladder.
- **Answer shape today (post-S2, prompt `clinical-rag-answer-v19`, 2026-08-18):** the
  `answer` field is prompted to 2–4 sentences (~60–110 words) for complex questions, with the
  narrow-question rule verbatim (a definition, one threshold, a single dose, or a yes/no stays
  1–3 sentences, ~35–75 words); `answerSections` carries 0–1 sections for simple facts, 3–6
  for complex questions when the excerpts support them (schema `maxItems` 6). The prompt
  (`answerInstructions`, `src/lib/rag/rag-answer-instructions.ts`) and the "Interpreted
  clinical task" block built by `buildAnswerInput` carry `intent`, `query_class`,
  `answer_focus`, `answer_scope`, the A2 `related_information_menu` line
  (`src/lib/rag/answer-composition.ts`), and the full `answer_plan.*` fields. Before S2 the
  targets were 1–3 sentences / 35–75 words and 2–5 sections.
- **Budgets:** `unsupported 0 / extractive 12s / fast 25s / strong 35s`; a
  truncation self-heal retries with `strongRetryMaxOutputTokens`. Source-only fallback
  (`source_backed_review_fallback`) fires on quality-gate failure, ungrounded extractive
  fallback, or post-generation claim-support gaps — conservative by design.
- **Evals:** 36-case golden retrieval fixture (`scripts/fixtures/rag-retrieval-golden.json`,
  zero-tolerance), 44-case `ragEvalCases` + 30-case `answerQualityEvalCases`
  (`src/lib/rag/rag-eval-cases.ts`), ranking-candidate snapshot with lockstep pin and 30-day
  freshness, live canary pairs via the `eval-canary` repository dispatch only.

---

## 3. Track A — answer quality (sequenced first)

Goal: for any clinical question, the system should (a) answer it directly, (b) surface the
_related_ high-yield information a psychiatrist colleague would append unprompted — chosen by
question type, and (c) be moderately longer (~1.5×) where evidence supports it, without
raising the source-only fallback rate or weakening a single grounding gate.

### A1 — Diagnose generation-quality fallbacks before changing length (prerequisite; `#231`)

> **Diagnosis updated 2026-08-22 — read it before acting on `#231`:**
> [`231-diagnosis-2026-08-22.md`](231-diagnosis-2026-08-22.md). The retrieval-budget premise is
> false: `answerRouteBudgetMs.fast` binds in only 3 of 60 case-runs, and half the timeouts use the
> 35 s strong budget. The remaining `provider_timeout` label contains two paths: response-bearing
> cases support a quality-retry ladder with no deadline admission check, while three zero-response
> cases need per-attempt timing/response telemetry before attribution. A grounded first-choice
> extractive answer bypasses the quality-gate call site, but the two cited incoherent answers pass
> the current predicates, so predicate strictness must be established before a reachability edit.
> Item 4 below stands and is reinforced, not rebutted.

**Problem.** Healthy retrieval still sometimes ends in a source-only fallback. The decisive
extended-budget probe completed generation inside the route deadline and still failed the
quality path, so route duration is not established as the binding cause. Increasing output
length before identifying the structured failure reason risks increasing fallbacks without
fixing the mechanism.

**Work.**

- Complete allow-listed timing and decision metadata across the whole route: pre-retrieval
  cache/version work, retrieval phase latencies, search total, route budget/deadline state,
  generation failure reason/detail, and retry count/reasons. Never record query, answer,
  provider-error, or source text.
- Attribute each source-only fallback to a stable stage and structured reason before changing
  behaviour. Preserve the existing conservative fallback while diagnosing it.
- Choose the mitigation from evidence, in this order:
  1. fix the specific generation-quality, verification, or composition failure;
  2. reduce pre-generation latency if measurements show it is starving generation;
  3. when a length-heavy class such as `broad_summary` or `comparison` genuinely requires the
     strong route, select it in `chooseAnswerRoute` **before** the route deadline is created —
     not in `shouldRetryWithStrongAfterFast`, which runs only after the fast attempt;
  4. change a timeout or `answerRouteBudgetMs` only if new measurements directly show the
     deadline is binding and explicitly rebut `#231`'s recorded stop condition.
- Do **not** reintroduce token streaming. The only admissible perceived-latency improvement is
  progressive disclosure of already-verified units over the existing `progress` SSE event
  (refutation 6, ledger `#100`).
- **Files:** principally `src/lib/rag/rag.ts`, `src/lib/types.ts`, existing answer-telemetry
  helpers, `src/lib/rag/rag-routing.ts` only if initial routing changes, and targeted tests.
  `src/lib/rag/rag-route-budget.ts` is out of scope unless the evidence threshold above is met.
- **Gate:** telemetry-only work must leave offline 44-case + 30-case behaviour unchanged and
  prove no sensitive text enters metadata. Any routing, prompt, quality-gate, or budget change
  is a separate behaviour change with a `RAG impact:` statement and live canary pair.

### A2 — Intent-conditioned answer composition ("related information")

**Design.** A small pure module, `src/lib/rag/answer-composition.ts`, mapping
(`RagQueryClass`, `ClinicalQueryIntent`) → a **composition menu**: which `answerSections`
kinds the model should attempt when — and only when — the retrieved evidence supports them.
Illustrative menu (tune during implementation):

| Question type                          | Related information to offer                                                                                                                             |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `medication_dose_risk` / `drug_dosing` | monitoring schedule, contraindications/cautions, escalation & stop triggers, dose-adjustment populations (renal/hepatic/older adults), related documents |
| `table_threshold`                      | adjacent thresholds in the same scale, required actions per band, escalation pathway                                                                     |
| `comparison`                           | decision factors, per-source differences/conflicts, switching/washout considerations                                                                     |
| `broad_summary` / `protocol`           | weighted management map (risk → first-line → adjuncts → monitoring → special populations), documentation/forms, source gaps                              |
| `escalation_risk`                      | immediate actions, thresholds, who to contact/refer, documentation                                                                                       |
| `definition` / `document_lookup`       | stays narrow — zero or one section, exactly as today                                                                                                     |

**Mechanism (three small changes, no new pipeline stage):**

1. Serialise the selected menu into the "Interpreted clinical task" block in
   `buildAnswerInput` (one new line, e.g. `related_information_menu: monitoring, contraindications, escalation`).
2. Add one paragraph to `answerInstructions` §"Answer sections": attempt the listed kinds
   when the excerpts support them; omit silently when they don't; never pad.
3. Grounding contract unchanged: every related item carries `citation_chunk_ids` or is
   omitted. Verification (`applyNumericVerification`, `assessAndEnforceClaimSupport`) and the
   render trust ladder apply to related sections exactly as to the core answer, so failure
   still degrades conservatively.

The render side needs nothing new: `answerSections` and `relatedDocuments` blocks already
exist under `answer-render-policy.ts`; check `trustCaps` section limits accommodate the
larger menus at `medium`/`high` trust.

- **Files:** new `src/lib/rag/answer-composition.ts` (+ unit test), `src/lib/rag/rag.ts`
  (prompt + `buildAnswerInput`), possibly `src/lib/answer-render-policy.ts` caps.
- **Gate:** offline 30/30 + 44-case suites re-baselined; retrieval untouched → 36/36 stays
  trivially green; live canary pair before trusting (prompt changes alter answer behaviour);
  Clinical Governance Preflight in the PR body.

### A3 — Moderate length increase (~1.5×)

- Prompt targets in `answerInstructions`: answer field 35–75 → **~60–110 words** (2–4
  sentences); complex-question sections 2–5 → **3–6** where evidence supports. Keep the
  "narrow question → narrow answer" rule verbatim — a definition or single threshold must
  not bloat; the length increase applies to management/comparison/threshold questions where
  yield is real.
- Verify A1's evidence first: generation-quality reasons, available headroom, and fallback
  rate are the binding evidence, not an assumed need for a longer route timeout. Check
  `trustCaps` and any verification heuristics that assume the current shape (quote-card
  counts, section caps).
- Bundle with A2 in one PR if the diff stays reviewable — both are prompt-surface changes
  sharing one canary pair; otherwise ship A2 first, A3 second with its own pair.
- **Files:** `src/lib/rag/rag.ts` (prompt), `src/lib/rag/rag-versioning.ts` (bump
  `ragAnswerPromptVersion` so the response cache and prompt cache key roll), eval baselines.

### A4 — Improve the existing suggested follow-up questions

- Keep `buildAnswerFollowUpSuggestions` and `buildAnswerFollowUpQuery` in
  `src/lib/answer-follow-up.ts` as the single implementation. The current deterministic
  surface already derives up to four suggestions from medications, canonical terms, query
  class, comparison intent, and source gaps, and `ClinicalDashboard.tsx` already renders
  wired phone and desktop chips.
- Improve the existing function rather than duplicating it: incorporate A2's composition menu,
  require the suggested subject to be supported by retrieved evidence, suppress redundant or
  already-answered suggestions, and retain deterministic phrasing with no extra provider call
  or latency.
- Keep submission on the current composer path. Cross-mode deep links, when appropriate, go
  through `src/lib/cross-mode-links.ts` / `src/lib/app-modes.ts` hrefs — never raw `<a>`.
- Do **not** add a second follow-up module, a new `RagAnswer` field, or another render block.
  Change `ClinicalDashboard.tsx` only if the existing function's input contract must expand.
- **Files:** `src/lib/answer-follow-up.ts` and its focused tests; optionally the existing
  `ClinicalDashboard.tsx` call site and A2 composition types.
- **Gate:** `RAG impact: no retrieval behaviour change — deterministic follow-up composition
only` when the generation prompt is untouched; focused DOM proof for both existing chip
  surfaces and `verify:phone-chrome` only if shared composer chrome changes.

**Track A sequencing:** A1 diagnosis → (A2 + A3) → A4 refinement. Each PR:
`npm run format` + commit, `verify:pr-local`, offline eval re-baseline, canary pair where
behaviour changes, ledger append, one PR at a time (no bundling across RAG-impact boundaries).

---

## 4. Track B — evaluation & safety infrastructure (corrected PDF Orders 0–7)

Sequenced after Track A's A1–A3 unless a Track A canary surfaces a safety gap first. All
items are offline/lab work with no production behaviour change until their gate passes.

### B0 — Baseline, adversarial fixture contract, data-flow register

As PDF PR 0, corrected:

- Command is **`npm run check:rag:adversarial-fixtures`** (new script
  `scripts/check-rag-adversarial-fixtures.mjs`); the existing `check:rag:fixtures` is
  untouched.
- Fixtures at `scripts/fixtures/rag-adversarial-cases.v1.json` + schema; 20–30 synthetic
  cases in the PDF's 8 categories (injection, citation fabrication, unsupported claim,
  empty/conflicting evidence, scope/tenant, provider failure, adversarial metadata,
  cost/timeout abuse). Include PHI-like canary strings; validator rejects canary literals in
  any reportable output.
- Baseline record: commit SHA, 36/36 result, 30/30 + 44-case results, prompt version,
  `RAG_SEMANTIC_RERANK_ENABLED=false`, report key
  `{commit_sha, dataset_version, eval_config_version, model_version, embedding_version, index_version}`.
- Data-flow register in this directory (`data-flow-register.md`): each input/process/sink,
  retention, and whether de-identified data is permitted — including temp worker paths, CI
  artifacts, caches, provider logs.

### B1 — Telemetry gap assessment (no Phoenix)

As PDF PR 1: dashboard questions first (stage timeout rate, fallback rate, candidate-count
distribution, p50/p95 stage latency); map to existing Sentry/answer-telemetry fields; add
`RAG_TELEMETRY_EXTENDED` (typed in `src/lib/env.ts`, default `false`) only for proven gaps;
unit tests assert canaries never appear in emitted objects. Much of this is shared with
Track A1's instrumentation — build once.

**Delivered by packet S5 (2026-08-17):** the assessment found three of the four dashboard
questions fully answerable from the fields PR #1899 and earlier instrumentation already
persist to `rag_queries.metadata`; the single proven gap was `verification_latency_ms`
(measured into `latencyTimings`, dropped at the persistence boundary). It ships behind
`RAG_TELEMETRY_EXTENDED` through the allow-listed numeric projection in
`src/lib/rag/rag-answer-telemetry-metadata.ts`, with canary-absence tests in
`tests/rag-telemetry-canary-absence.test.ts`.

**Phoenix decision record — closed 2026-08-17: deferred.** `src/instrumentation.ts` and
`src/lib/observability/agent-monitoring.ts` already trace without content capture; the B1
assessment showed the named dashboard questions answerable from existing fields plus one
flag-gated addition; a second tracing vendor would add a data-processing route (Gate A)
before proving value. Revisit only if a dashboard question becomes unanswerable from
`rag_queries.metadata` plus the existing Sentry surface.

### B2 — Offline adversarial regression harness

As PDF PR 2: Promptfoo pinned as a dev dependency, custom offline provider around the
repository's own offline harness (`RAG_PROVIDER_MODE=offline`, fetch/network rejected),
deterministic assertion functions with their own tests, fed by B0 fixtures. New command
`eval:rag:adversarial:offline`, routed by `scripts/ci-change-scope.mjs` to RAG-surface PRs
only; fails closed on missing fixture, network attempt, or budget breach. If Promptfoo's
dependency footprint proves heavy, a plain Vitest harness over the same fixtures is an
acceptable substitute — the fixtures and assertions are the asset, not the runner.

**Delivered by packet S5 (2026-08-17) as the plain-Vitest substitute** (no dependency
change; a Promptfoo experiment would be its own PR): `eval:rag:adversarial:offline` runs
`scripts/check-rag-adversarial-fixtures.mjs` then `tests/rag-adversarial-harness.test.ts`
over the 24 B0 cases with a stubbed-throwing `fetch`, a per-case Supabase round-trip
ceiling, and canary-absence assertions on every persisted telemetry row. CI runs it in the
`safety` job only when `rag_eval_changed` is true; `verify:pr-local` selects it for the
same scope. Three fixture expectations diverge from current pipeline behaviour and are
pinned in the harness's self-expiring `KNOWN_DIVERGENCES` register rather than being
recalibrated away.

### B3 — Docling lab benchmark (isolated)

As PDF PR 3, unchanged in substance: `eval/docling/` with hashed lockfile, sandboxed
(non-root, no egress, resource limits), 30–50 public/synthetic fixtures stratified by
document difficulty plus a hostile corpus; compare against the legacy extractor
(`src/lib/extractors/document.ts`, `worker/python/extract_pdf_assets.py`) on parse success,
resource bounds, table precision/recall, exact number/unit/comparator checks. **Do not touch
worker requirements, Dockerfile.worker, or the database.** Gate B: non-inferiority on all
safety/exactness measures + pre-agreed table-heavy improvement.

The committed `docling-lab-fixtures.v2` corpus now includes unruled, merged-cell,
and rotated-header table cases with numeric assertion provenance bound to
representative source tables. `source` and `tableId` constrain fixture construction;
numeric exactness still searches document-wide extracted text and table cells, while
table cell F1 measures structural association. That closes the fixture-hardness gap
only; the 2026-08-18 Gate B record remains v1 evidence, and no promotion may cite v2
until a new owner-dispatched benchmark is recorded.

### B4 — Docling worker shadow mode (conditional on Gate B)

As PDF PR 4: `WORKER_DOCUMENT_EXTRACTOR_MODE=legacy|shadow` (typed, default `legacy`),
shadow runs after legacy success on a 1–5% cohort selected by `src/lib/index-quality.ts`
signals, aggregate metadata only, no chunks/embeddings/index writes, kill switch, one-step
rollback to `legacy`. Worker-reviewer subagent (`ingestion-worker-reviewer`) reviews the PR.

### B5 — Ragas calibration pilot (optional, offline)

As PDF PR 5: adapter reads existing evaluation JSON, egress denied, judge-model use requires
Gate A approval. Retained only if it flags failures the deterministic gates miss at agreed
precision; otherwise archived. Never a release gate.

### B6 — Local cross-encoder reranker benchmark (conditional, offline)

As PDF PR 6, with refutation constraints made explicit: candidates exported with
**differently-relevant** content per case; any serving proposal keeps its score contribution
strictly below `relevance.score` in every comparator chain; requires 36/36, zero per-case
regression, citation-support parity, latency/cost headroom, then a separate default-off
serving PR (`RAG_LOCAL_RERANK_ENABLED=false`) with its own canary pair. Coordinate with
issue `#001` — the existing ambiguity-band semantic reranker stays independent and off.

### B7 — DSPy lab (deferred, re-scoped)

Entry criterion unchanged (≥100 clinician-reviewed cases, 60/20/20 split). **Re-scoped:**
optimise only answer phrasing/section-composition prompts (Track A2/A3 surfaces) — not
query-intent classification, which exists, and never authorization, evidence gates,
citations, or abstention policy. Candidates ship as static reviewed prompt PRs behind
default-off flags.

### Gates A–F (retained from the PDF, collapsed roles)

- **A — data-flow/privacy:** register complete; canary strings absent from every sink;
  owner sign-off before any vendor/provider use.
- **B — Docling extraction:** non-inferior safety/exactness, improved table-heavy metric,
  no budget breach.
- **C — adversarial behaviour:** B2 suite green on the expected refusal/abstention/citation
  contract.
- **D — retrieval/ranking:** 36/36, zero per-case regression, p95 latency and cost in budget.
- **E — clinical quality:** owner's blinded review on representative sources — evidence,
  citations, harmful-advice, abstention. For Track A: before/after answer comparison on a
  fixed question set (the 30 `answerQualityEvalCases` plus ~10 owner-chosen live questions).
- **F — operations:** flag, one-step rollback, runbook, cost cap, redacted telemetry.

---

## 5. Sequencing summary

Execution across cloud sessions is coordinated by [HANDOVER.md](HANDOVER.md): per-session
work packets, the live status table, checklists, and paste-ready prompts. Canonical task
ownership and cross-session tracking remain registered in [`docs/outstanding-issues.md`](../outstanding-issues.md).

| Order | Item                                            | Depends on                      | Behaviour change?                         |
| ----- | ----------------------------------------------- | ------------------------------- | ----------------------------------------- |
| 1     | A1 structured fallback diagnosis (`#231`)       | —                               | No for telemetry; separate pair for fixes |
| 2     | A2 + A3 intent-conditioned composition + length | A1 evidence                     | Yes → canary pair + Gate E comparison     |
| 3     | A4 improve existing follow-up suggestions       | A2                              | Deterministic composition only            |
| 4     | B0 baseline + adversarial fixtures              | — (can run parallel to Track A) | No                                        |
| 5     | B1 telemetry assessment                         | B0 (shares A1 instrumentation)  | No                                        |
| 6     | B2 adversarial harness                          | B0                              | No                                        |
| 7     | B3 Docling lab                                  | B0                              | No                                        |
| 8     | B4 Docling shadow                               | Gate B                          | Worker-only, shadow                       |
| 9     | B5/B6 Ragas/reranker                            | conditional                     | No until separately promoted              |
| 10    | B7 DSPy                                         | ≥100 labelled cases             | No until separately promoted              |

Cross-links: `#231` cross-links to `docs/database-remediation-plan.md` Phase 5.2 (re-test after
the trigram-index restore) — satisfied by S1's healthy-latency probes 2026-08-17; `#316` Phase
1.2 found the RPC divergence attribute-only.

## 6. Verification commands (per PR, smallest first)

```bash
npm run format                      # and COMMIT the result before push
npm run test:focused -- --files <changed source + tests>
npm run check:rag:fixtures          # existing golden/snapshot validator
npm run check:rag:adversarial-fixtures  # adversarial fixture contract (B0)
npm run eval:rag:offline            # offline RAG suite (Track A PRs)
npm run eval:rag:adversarial:offline    # offline adversarial harness (B2, RAG-surface PRs)
npm run verify:pr-local -- --dry-run --files <paths>   # then run selected gate
npm run check:production-readiness  # domain changes (env flags, answer path)
```

Live canary pairs fire only via the `eval-canary` repository dispatch with explicit owner
approval per run; regression → single-commit revert + confirmation run. See
`docs/rag-behaviour/safeguards.md` § the eval-canary pair protocol for the exact trigger
mechanics (dispatch/cron-only, no `ref` input) and the comparison command.

## 7. Rollback map

| Change                     | Rollback                                                                |
| -------------------------- | ----------------------------------------------------------------------- |
| A1 telemetry/diagnosis     | revert additive metadata commit; no budget change is implied            |
| A1 behavioural mitigation  | revert the separately measured routing/quality fix                      |
| A2/A3 prompt + composition | revert commit; `ragAnswerPromptVersion` bump isolates caches            |
| A4 suggestions             | revert changes to the existing `answer-follow-up.ts` implementation     |
| B1 telemetry               | `RAG_TELEMETRY_EXTENDED=false`                                          |
| B4 shadow                  | `WORKER_DOCUMENT_EXTRACTOR_MODE=legacy`; no migration or reindex needed |
| B6 reranker                | `RAG_LOCAL_RERANK_ENABLED=false`                                        |

No item in this guide requires an irreversible action; index/database changes and any
cloud-vendor activation remain separate, explicit approval points.
