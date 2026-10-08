# RAG ranking safeguards

_Updated 2026-10-08 — corrected documentation guidance; operational evidence retains its original dates._

The protection stack that keeps retrieval/ranking behaviour from being changed casually — by
any task, session, or agent. Added 2026-07-20 after the Phase C live regression proved that
offline-green + review-approved is not sufficient for this surface.

## Protected surfaces

Code and ground truth whose edits change (or re-measure) retrieval/ranking behaviour:

- `src/lib/rag/**` — the retrieval waterfall, candidate sources, release pipeline
- `src/lib/clinical-search.ts`, `src/lib/retrieval-selection.ts`,
  `src/lib/released-search-order.ts`, `src/lib/ranking-config.ts`, `src/lib/evidence.ts`,
  `src/lib/result-sort.ts`, `src/lib/answer-ranking.ts`, `src/lib/evidence-relevance.ts`,
  `src/lib/semantic-rerank.ts`, `src/lib/eval-document-matching.ts`
- `src/lib/source-authority-registry.ts`, `src/lib/australian-source-priority.ts` — one step
  further back, but still ordering: `classifySourceAuthority` assigns a result's tier,
  `australianSourceTier` reads it, and `selectAustralianClinicalContext` orders and trims the
  model's context by it. Registering or re-scoping a publisher moves that ordering without
  touching a score. Added 2026-09-07 (PR #2711 declared its RAG impact voluntarily because the
  gate did not yet ask). Note this is authority _classification_, not a governance ranking
  penalty or boost — the latter stays refuted, see `refuted-approaches.md` § Refutation 3.
- `src/lib/chunking.ts`, `src/lib/extractors/**`, `worker/python/extract_pdf_assets.py` — one
  step further back again: ingestion decides the TEXT that becomes chunks, embeddings and cited
  evidence, so changing it changes what retrieval can return and what an answer can be grounded
  in. Until 2026-09-16 none of these matched a pattern here, `src/lib/chunking.ts` classified as
  neither ragRanking nor clinicalRisk, and the `AGENTS.md` "Flag it" list did not name any of
  them either — so nothing asked, early or late. Added after PR #2810 changed PDF table
  extraction — a table read across its columns instead of down them had bound a clozapine
  withhold threshold to the wrong words — and had to declare its RAG impact voluntarily because
  the gate did not ask. Note the canary pair for an ingestion change belongs around the
  RE-INDEX, not around the merge: the new code cannot alter any retrieval result until documents
  are re-ingested.
- `src/lib/document-index-units.ts`, `src/lib/model-index-extraction.ts`, `src/lib/deep-memory.ts`
  — the second producer of retrieval inputs, and not reached by `src/lib/rag/**` because all three
  sit one directory up. `searchIndexUnitCandidates` (`rag-candidate-sources.ts`) queries
  `match_document_index_units_hybrid_v2` unconditionally in the candidate fan-out, so the index
  units these modules build and embed — tables, workflows, algorithms, aliases, typed signals —
  decide which chunks that branch can surface at all. `deep-memory.ts` is stronger still: it
  exports `applyMemoryCardBoosts`, which rescores `SearchResult[]` in that same path, making it a
  ranking surface outright rather than only an input to one. Added 2026-09-16 after Codex review
  on PR #2832 pointed out that gating raw chunk extraction alone left the structured-evidence
  producers open. The re-index note above applies here too: index units change only when
  documents are re-ingested.
- `src/lib/retrieval-rpc-rollout.ts`, `src/lib/clinical-evidence-haystack.ts`,
  `src/lib/cross-document-synthesis.ts`, `src/lib/corpus-grounding.ts`, `src/lib/keyword-query.ts`
  — retrieval inputs outside `src/lib/rag/**`: which RPC version the fan-out calls, the image
  evidence haystack `clinical-search` scores against, the synthesis read by
  `retrieval-selection` and the context pack, the classifier fallback's grounding verdict, and
  the lexical query and stop-word set. Added 2026-09-25 after a codebase survey found them
  unprotected.
- `src/lib/document-enrichment.ts`, `src/lib/visual-intelligence.ts`, `src/lib/image-filtering.ts`,
  `worker/embedding-fields.ts`, `worker/table-facts.ts`, `worker/assertion-tagging.ts` — the
  remaining producers of rows the retrieval RPCs query (enrichment, image captions, embedding
  fields, table facts, assertion tags). Added 2026-09-25. `worker/main.ts` stays out: it
  orchestrates these producers rather than deciding their content. The re-index note applies.
- `scripts/eval-retrieval.ts`, `scripts/lib/clinical-aliases.ts`,
  `scripts/lib/ranking-tuning.ts`, `scripts/lib/ranking-snapshot-builder.ts`,
  `scripts/build-ranking-snapshot.ts`, `scripts/tune-search-weights.ts`
- `scripts/fixtures/rag-retrieval-golden.json`,
  `scripts/fixtures/rag-ranking-candidate-snapshot.v1.json`
- The contract-pinning tests: `tests/rag-fast-path-ordering.test.ts`,
  `tests/ranking-tuning.test.ts`, `tests/retrieval-selection.test.ts`,
  `tests/rag-second-stage-ranking.test.ts`, `tests/eval-retrieval.test.ts`
- Retrieval RPCs in `supabase/schema.sql` / migrations (covered by the clinical-risk gate)

## Layer 1 — PR-body declaration (advisory warning)

`scripts/pr-policy.mjs` classifies changed files. Since 2026-09-17, a protected-surface
PR without the acknowledgment line receives a **warning, not a blocking failure**.
The standing rule still requires the declaration; source-pin checks and the
behaviour-change live-canary requirement below remain binding:

```
RAG impact: <one of>
  RAG impact: no retrieval behaviour change — <why (docs/tests/tooling-only, refactor with
    byte-identical output, etc.)>
  RAG impact: behaviour change — canary pair <baseline run/link> -> <post run/link or
    "planned post-merge">
```

The line must state either **no behaviour change** (with a reason) or reference the **canary**
pair. This makes RAG impact a conscious declaration on every PR, from every session.

## Layer 2 — source-pin contract test (enforced, offline)

`tests/rag-imputation-contract.test.ts` pins the exact imputation formulas and the release
comparator key ORDER as source text. Any edit — including by a task that never read this folder
— goes red in unit tests with a failure message pointing here and to the process in
`refuted-approaches.md`. Updating the pins is allowed only alongside the full protocol
(design + differently-relevant fixtures + canary pair + user approval).

## Layer 3 — behaviour guards (pre-existing, standing)

- Zero-tolerance golden gates (36 cases, weekly scheduled canary + on-demand dispatch)
- Fast-path ordering suite (production-pipeline replays of the 2026-07-19 failure shapes)
- Snapshot gates: golden-regression quartet at production weights, full-snapshot high-risk
  hard-negative floor, fixture↔snapshot lockstep pin, 30-day freshness gate
- Clinical Governance Preflight (blocking) for all clinical-risk paths

## Layer 4 — process (agent memory)

`AGENTS.md` § "RAG ranking protection" mirrors these rules so every agent session loads them:
flag RAG impact before editing, canary pair for behaviour changes, never insert comparator
keys above relevance, read this folder first. **Also:** do not add `review_due` /
`unknownCurrentness` / governance-metadata ranking penalties or boosts — that shape is
refuted (`refuted-approaches.md` § Refutation 3; ledger `#032`). The eval-canary pair protocol:

`.github/workflows/eval-canary.yml` fires only on the `eval-canary` repository dispatch and the
Sunday 18:00 UTC cron (`schedule: cron: "0 18 * * 0"`) — it has no `workflow_dispatch` and no
`ref` input, both asserted absent by `tests/eval-canary-workflow.test.ts`. Every run, scheduled
or dispatched, always loads code from the default branch, so a canary can only ever measure
`main` — there is no way to canary an open branch or PR head directly.

1. Baseline: the latest green canary on current `main` **before the merge** (a scheduled run or
   a prior dispatch).
2. Change merges to `main`.
3. Post: one repository dispatch **after the merge** —
   `gh api repos/BigSimmo/PsychSift/dispatches -f event_type=eval-canary` — then compare the
   pair's `--json-out` artifacts, both named `eval-canary-output`, one per run:

   ```bash
   npm run eval:retrieval:compare -- <baseline.json> <post.json> --fail-on-regression
   ```

   The command diffs per-case `rr@10`/`contentRR@10` and exits non-zero on any per-case
   regression, a non-identical case set, or an unavailable rank metric. Gates: document/content
   recall 1.0/1.0, zero per-case reciprocal-rank regressions, and the answer-quality gate clean
   — read the denominator from the run's own report rather than assuming a fixed case count; it
   has moved as `rag-eval-cases.ts` grew.

4. Regression → immediate single-commit revert + one confirmation dispatch.

Provider-backed dispatches always need explicit user approval (~$1–2 each).

**Reading a canary result:**

- A red first post-run may be an unrelated non-golden case, not a diff regression — root-cause
  with a live probe before blaming the diff. Precedent: the first post-S1b canary (run
  `32038751592`) failed one answer-quality case; a re-run (`32039841070`) plus cache-bypassed
  live probes showed the fast model's phrasing had taken a different, still-correct branch, not
  a retrieval or code fault — retrieval stayed 36/36 identical across both runs.
- A deterministic extractive-path flip is a real regression — bisect by probe and revert in a
  single commit. Precedent: interim post run `32097916649` went red on
  `agitation-im-po-route-short-terms`; live bisection isolated it to PR #2065 (S1c's
  condition-first `for`/`in` binding regex), which was reverted by PR #2088, with confirmation
  run `32100681177` restoring green.

## Rollback proof (2026-07-20)

The full cycle was exercised live: merge (#1004) → regression detected by canary #55 within
~35 minutes → revert (#1005) → restoration confirmed 36/36 (canary #56). Total main exposure
under the regression: eval traffic only.

## Adaptive answer safeguards — local implementation (2026-09-09)

The locally implemented adaptive lane extends the legacy `clinical-rag-answer-v19` / `clinical-rag-answer-schema-v4` contract with a candidate `clinical-rag-answer-v20` / `clinical-rag-answer-schema-v5` contract. The candidate keeps one canonical lead and can add ordered, question-specific sections so supported parts are not lost from the main answer, prior turns, final SSE payload, persisted thread, restored answer, or copied text. The server-produced DTO remains authoritative across those consumers. The earlier 85-word UI helper was a separate display defect: it clipped an already verified lead after generation and was removed without changing provider prompt, schema, retrieval, or answer-contract limits.

Both rollout controls are server-only and default off: `RAG_ADAPTIVE_ANSWER_ENABLED` selects v19/v4 for new production when off, while `RAG_ADAPTIVE_ANSWER_RENDER_ENABLED` hides adaptive main-surface sections when off. Render rollback does not rewrite stored or current v20 payloads, and their canonical copied content remains version-driven. Versioned prompt/schema/response/cache identities prevent candidate and legacy artifacts from sharing a namespace. No flag has been activated by this local work.

The candidate does not relax clinical or source safeguards. Narrow questions remain concise. Every displayed numeric and nonnumeric claim still needs support; population, polarity, temporal and conditional qualifiers stay bound to the owning predicate. Partial answers retain independently supported parts and name the exact unsupported part rather than filling it from another predicate or an ineligible source. Catalogue/tool records support catalogue facts only. Selected-source, access, currentness, source-role, receipt, conflict, source-image, citation-chunk and final claim-verification boundaries remain in force.

Content-free diagnostics report `required_part_count`, `represented_part_count`, `required_part_loss_count`, and direct/partial/conflicting/absent coverage counts. These expose false-insufficiency and delivery loss without logging query or source content. They do not prove numeric fact retention, clinical completeness, or provider quality; the paired evaluation tracks supported server facts separately from facts delivered in canonical copied output.

Local deterministic evidence covers complete broad and mixed answers, exact support removal with a useful partial, irrelevant-evidence invariance, a concise narrow answer, two follow-ups, elaboration, restoration, and canonical current/prior/SSE/storage/render/copy delivery. With identical requests, evidence and fixed mocked provider facts, the original 11-case capture records 11 server-fact-retention ties and 10 candidate copy-delivery wins with one narrow tie. A later R1 run passed all 11 assertions but emitted no fresh compact outcome rows, so the original raw capture remains the numerical source. Shared relevance, coverage and extractive corrections benefit both lanes and are not attributed solely to v20. This is product-contract evidence, not model/provider usefulness, clinical adequacy, latency or cost evidence.

Final focused evidence is 421 passing tests and a 2,036-input compiler pass. Reused R1 domain evidence is 1,194 passes plus one known baseline-confirmed P16 `reviewed_input_state` failure; later assertions in that failed test were not executed. Fixture validation passed 36 golden, 26 suite and 26 programme cases. Sanitized readiness was 4 PASS, 5 WARN and 1 FAIL for missing local configuration. Task 4 separately supplied three passing synthetic Chromium viewports; it is not a live provider-to-browser run. See the local-only Task 5 final-verification artifact at `.superpowers/sdd/P12C-task5-final-verification-20260909.md`. The root-owned, local-only M2 acceptance artifact at `.superpowers/sdd/M2-final-local-acceptance-20260909.md` is the authority for the current cumulative acceptance verdict and retained boundaries.

No hosted/provider comparison, corpus completeness, P16 uploaded-local full admission, production cache population, production build, deployment, physical Safari/PWA, formal P17 receipt reconciliation, or clinical/legal readiness is established. Historical v18/v19 Gate E evidence is baseline context and does not accept v20. Provider canaries and activation remain separately approval-gated.
