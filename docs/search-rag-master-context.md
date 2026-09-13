# Search/RAG Master Context

## Purpose

This file preserves the working context for the Clinical KB search and answer-quality problem. It is intended to be the shared brief for future implementation work, reviews, and model handoffs.

The central issue is not just prompt wording. It is a combined routing, generation, API validation, evidence provenance, and rendering-policy problem.

The desired experience is:

- The user asks a clinical question.
- Search/RAG retrieves and ranks the best local evidence first.
- The first visible answer is a clear, natural, model-synthesized response grounded in that evidence.
- Supporting sources, citations, quote cards, evidence maps, warnings, and diagnostics appear after the answer only when allowed by an explicit trust/display policy.
- Every displayed source attachment is easy to click, review, copy, and trace back to document/page/chunk.
- Low-confidence or unsupported answers fail closed with useful source-gap language and nearby-source review, not stitched snippets.

## Current Implementation Status Through Phase 7b

### Governed ingestion availability boundary

Search and Answer must distinguish indexed data from data they can actually use. The canonical definitions of admitted, processing, extracted, indexed, technically eligible, active, kernel evidence available and available to Answer are in the [governed reindex lifecycle](reindex-runbook.md#state-vocabulary). These states cannot be collapsed, and a bounded recent-job view cannot prove queue emptiness.

The settled sequence is audit → local plan → authorized stage → exact-generation evaluate → authorized promote → observation → receipt-bound rollback if required → delayed manifest cleanup. Promotion is not first publication, evaluation `GO` is not operation authority, and U10's immutable generation-bound technical gate is mandatory and currently refuses. U11 owns final UI-specific wording for these states; this context does not pre-implement that presentation.

For a generation to be available to Answer, the Answer path must be able to retrieve only its active, permitted artifacts under separate runtime and source-governance gates. This U06 documentation does not establish that the current Answer path implements or consumed a newly governed generation. Kernel evidence availability never proves Answer consumption; the kernel remains default-off and later U12/Answer integration evidence is separate. Intentional null G0 requires immutable legacy proof, and retained baselines and failed candidates remain governed by policy-bound manifest deadlines. The operational details, crash windows and exact cleanup boundary are in the [reindex runbook](reindex-runbook.md#governed-generation-lifecycle).

Phase 7 performance hardening is implemented:

- `OPENAI_ANSWER_TIMEOUT_MS` is the answer-generation timeout budget. Phase 7 introduced it at 12000ms; the current default is **30000ms** — a deliberate product decision to favour natural, model-written answers over fast degradation to stitched extractive prose (see the rationale comment at `src/lib/env.ts` next to `OPENAI_ANSWER_TIMEOUT_MS`).
- `src/lib/rag/rag.ts` passes that timeout to structured answer generation so provider stalls fail into the existing source-backed fallback path faster than the global OpenAI request timeout.
- `scripts/eval-rag.ts` excludes `generation_fallback` answers from the intentional routine-extractive latency bucket so provider timeout waits do not distort the model-free extractive metric.
- Focused tests, typecheck, production-readiness, and capped RAG eval with threshold failure enabled passed after the change.

Phase 7b latency polish is implemented:

- `src/lib/rag/rag-routing.ts` detects explicit table, chart, flowchart, figure, appendix, and form lookup questions.
- Safe explicit lookup questions route to extractive with reason `explicit_table_or_source_lookup`.
- Medication/action/dose/threshold questions remain on model synthesis when they ask for clinical interpretation rather than source location.
- The `agitation-arousal-table-lookup` eval case moved to extractive with `generation_latency_ms=0` and sub-second total latency in the Phase 7b validation run.

Deployment/config note:

- `.env.example` documents `OPENAI_ANSWER_TIMEOUT_MS=30000`, matching the server default in `src/lib/env.ts`.
- Local `.env.local` may set it explicitly for parity; unset environments rely on the 30000ms server default.
- The historical 12000ms value in `docs/archive/search-rag-phase-0-baseline.md` and `docs/search-rag-master-plan.md` records the Phase 7 rollout, not current guidance.

## Skill Lenses Used

The master plan should be interpreted through these review lenses.

Primary skills:

- `api-review`: API contracts, validation, error taxonomy, request/response shape, pagination, auth, recoverability, observability.
- `ai-architecture-review`: retrieval, context assembly, model routing, structured outputs, safety filters, provenance, fallbacks, evals, cost, latency.
- `frontend-architecture-review`: Next/React boundaries, state ownership, duplicated client state, rendering contracts, component boundaries.
- `ux-review`: question-to-answer flow, source-review friction, evidence navigation, mobile/desktop usability.
- `testing-review`: unit/integration/E2E coverage, fragile tests, clinical safety assertions, verification sequence.

Selective skills:

- `security-review`: auth, local-no-auth, service-role exposure, public error envelopes, source access boundaries.
- `performance-review`: model latency/cost, duplicate answer coalescing, rendering waste, source drawer/document viewer load.
- `accessibility-review`: keyboard support, semantic buttons/links, drawer/tab behavior, copy controls, focus management.
- `release-readiness-review`: lint, typecheck, build, production-readiness, Supabase target checks, clinical governance preflight.
- `code-quality-review`: duplication, naming, abstractions, fragile conditionals, maintainability after contracts are defined.

Secondary skills:

- `design-review` and `frontend-design`: light-touch only. This is a clinical knowledge workflow, so the design target is dense, calm, trustworthy, and fast to scan rather than visually expressive.
- `repo-auditor`: use if ownership or duplication is unclear, not as the default path.

## Problem Summary

The app has several useful answer components already: retrieval, ranking, model generation, structured outputs, citations, source coverage, best-source links, quote cards, visual evidence, smart panels, and dashboard rendering.

The problem is that these pieces do not appear to be governed by one authoritative contract. Different layers can independently decide:

- whether the first answer should be generated or extractive,
- whether fallback extraction is acceptable,
- which model is used,
- which evidence is attached,
- which supporting blocks are shown,
- which source links are clickable,
- which confidence/trust state is presented to the user.

That allows the answer to feel stitched together. It can also make the UI noisy, inconsistent, or overconfident.

## Known User-Visible Failure Modes

- The first answer bubble can show a source heading or continuation fragment instead of a complete natural answer.
- Medication, dosing, threshold, risk, pathway, and referral questions can be treated too much like source lookup tasks.
- Extractive fallback can leak into user-facing clinical answers.
- Multiple evidence channels can duplicate or disagree visually.
- Extra blocks can appear because fields are populated rather than because a trust/display policy permits them.
- Evidence rows can have source hrefs in data but render as non-clickable text.
- Source preview can display multiple sources while actions only open the best source.
- Source-gap answers can hide nearby sources even though nearby-source review is exactly what the user needs.
- Copying an answer can omit citations/source status even when a richer formatter exists.
- Desktop and mobile evidence navigation diverge.
- API route families mix schema-first validation with manual parsing/clamping, creating drift risk.

## Relevant Existing Surfaces

Answer and RAG flow:

- `src/app/api/answer/route.ts`
- `src/app/api/answer/stream/route.ts`
- `src/lib/rag/rag.ts`
- `src/lib/rag/rag-routing.ts`
- `src/lib/smart-rag-api.ts`
- `src/lib/openai.ts`
- `src/lib/types.ts`

Answer rendering and evidence UI:

- `src/components/ClinicalDashboard.tsx`
- `src/components/clinical-dashboard/search-utils.ts`
- `src/components/clinical-dashboard/source-actions.tsx`
- `src/lib/answer-formatting.ts`
- `src/lib/ward-output.ts`
- `src/lib/evidence.ts`
- `src/lib/citations.ts`

Document/source targets:

- `src/app/(search-app)/documents/[id]/page.tsx`
- `src/components/DocumentViewer.tsx`

API validation route families:

- `src/app/api/documents`
- `src/app/api/jobs`
- `src/app/api/ingestion`
- `src/app/api/upload`

High-risk route examples previously identified:

- `src/app/api/documents/route.ts`: manual `parsePositiveInt` and `parseOffset`.
- `src/app/api/documents/[id]/route.ts`: manual `boundedInteger`.
- `src/app/api/documents/[id]/search/route.ts`: manual search limit parsing and clamping.
- `src/app/api/ingestion/quality/route.ts`: manual limit clamp.
- `src/app/api/upload/route.ts`: multipart parsing is not schema-first.

Validation examples already closer to desired style:

- `src/app/api/documents/bulk/route.ts`
- `src/app/api/documents/bulk/reindex/route.ts`
- `src/app/api/documents/[id]/labels/route.ts`
- `src/app/api/documents/[id]/table-facts/route.ts`
- `src/app/api/documents/[id]/signed-url/route.ts`
- `src/app/api/documents/[id]/summarize/route.ts`

## AI/RAG Contract To Preserve

Retrieval comes first:

- No user-facing answer should bypass source retrieval for clinical knowledge.
- If retrieval is weak or conflicting, the answer should reflect that explicitly.
- The model should synthesize only from retrieved evidence, not from hidden assumptions.

Synthesis is default for clinical answers:

- Medication, dosing, monitoring, threshold, risk, comparison, pathway, and referral questions should go through model synthesis.
- Extractive mode should be limited to explicit source/document lookup intents.

Fast and strong model routing:

- Fast model: routine, well-supported clinical answers with strong retrieval and low complexity.
- Strong model: safety-sensitive, complex, multi-document, conflicting, comparison, dosing/risk/threshold, governance-sensitive, or failed fast-output cases.
- Failed fast answer should retry strong before any fallback.

Fail closed:

- If strong generation fails quality gates or source support is insufficient, return a clean source-gap answer.
- Do not return stitched extractive fallback for clinical answers.

## Required Quality Gates

Before returning a generated answer:

- First sentence directly answers the user question.
- First answer is a complete sentence, not a heading or continuation fragment.
- No source-card labels or document headings are promoted as prose.
- No unsupported numbers, doses, thresholds, or clinical claims.
- No cross-medication leakage.
- Citations and evidence IDs must point to retrieved chunks.
- The answer covers the classified query intent.
- Conflicts or evidence gaps are stated when relevant.
- Unsupported answers use source-gap language and do not look confident.

## Render Contract To Introduce

The dashboard should render from a canonical answer render model, not raw optional fields.

The render model should decide:

- whether answer text is displayable,
- which trust state applies,
- which supplemental blocks are permitted,
- the order of those blocks,
- the maximum number of items per block,
- which sources are primary vs secondary,
- which source links are clickable,
- what can be copied,
- why each block was shown or hidden in QA/debug mode.

Display priority:

1. Direct answer.
2. Trust/source status strip.
3. Review sources packet with top linked passages.
4. Evidence map with claim-to-source links.
5. Quote cards, visual evidence, related documents, conflicts, warnings, diagnostics, only when allowed.

## API Contract To Introduce

The named API families should use one schema-first validation pattern.

API validation should cover:

- route params,
- query params,
- JSON request bodies,
- multipart/form-data fields,
- file requirements,
- pagination/limit/offset bounds,
- typed error responses,
- unknown field policy,
- coercion policy,
- clamp vs reject policy.

Manual parsing and clamping should move into shared utilities only.

## Security And Privacy Constraints

- Do not leak raw OpenAI, Supabase, stack, or service-role details in public error responses.
- Keep service-role keys server-only.
- Preserve auth checks and local-no-auth gating.
- Validate document/source access before exposing links.
- Do not make low-confidence clinical answers look authoritative.
- Do not expose partial clinical generation before schema/quality validation.

## Performance And Cost Constraints

- Preserve answer in-flight coalescing for duplicate requests where available.
- Avoid repeating expensive generation after cancellation or client retry.
- Keep prompt/cache versioning explicit when schema changes.
- Track model route, retry path, usage, request IDs, latency, cached-input/cache-write tokens, and fallback reason.
- Keep answer-generation timeout bounded separately from the global OpenAI request timeout.
- Keep explicit source/table/document lookup paths model-free when retrieval support is strong enough.
- Cap UI supplemental block counts to reduce render noise.
- Lazy-load heavy source/document UI where appropriate.

## Testing Expectations

Minimum test categories:

- RAG routing by query class.
- Fast-to-strong escalation.
- Strong fail-closed behavior.
- Source lookup remains extractive.
- Citation/evidence ID schema enforcement.
- Fragment/heading rejection.
- Unsupported number/dose rejection.
- Cross-medication leakage rejection.
- Render policy gating for unsupported, medium, and high trust.
- Source-link clickability.
- Copy-with-sources behavior.
- API validation edge cases for the named route families.
- Browser smoke for the source-backed answer flow.

Repo verification expectations:

- Focused Vitest tests first.
- `npm run verify:cheap` for broad source/config/test changes.
- `npm run check:production-readiness` for clinical answer/search/source-governance changes.
- `npm run eval:retrieval:quality` and `npm run eval:rag -- --limit 20 --json --fail-on-threshold` after retrieval/routing/performance changes.
- `npm run ensure` before browser/UI work.
- `npm run verify:ui` or focused Playwright smoke when rendering/source UX changes.

## Key Acceptance Criteria

- Clinical first answers are model-synthesized from retrieved evidence unless the user explicitly asks for source lookup.
- Extractive fallback is not the primary first-message path for clinical answers.
- Strong model escalation happens before source-gap fallback.
- Source-gap answers are clear, useful, and not overconfident.
- All visible evidence rows and source previews have reliable click targets where possible.
- Optional UI blocks are shown by policy, not by raw field presence.
- API validation is schema-first and consistent in the target route families.
- The behavior is test-covered and observable.
