# Search/RAG Master Context

> **Status (2026-10-20): historical brief.** Most "Contract To Introduce" sections describe contracts that
> are now built, and some example helpers it names (`parseOffset`, `boundedInteger`) no longer exist. Check
> the code and [`docs/rag-behaviour/`](rag-behaviour/README.md) before relying on it.

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
- A failed fast answer may retry strong only when the existing route policy and remaining budget admit it; otherwise use the bounded verified recovery or source-gap path.

Fail closed:

- Superseded by the governed recovery amendment (2026-09-08): strong-generation failure may use one bounded source-backed recovery only when the existing citation, numeric, claim-support and source-governance gates pass.
- The former blanket extractive-fallback prohibition is retired. If the recovered material or available sources do not pass those gates, return a useful source-gap answer; unsupported stitched claims remain prohibited.

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
- Strong escalation follows the existing route and retry-budget gates; a denied retry does not block bounded verified recovery or a useful source-gap answer.
- Source-gap answers are clear, useful, and not overconfident.
- All visible evidence rows and source previews have reliable click targets where possible.
- Optional UI blocks are shown by policy, not by raw field presence.
- API validation is schema-first and consistent in the target route families.
- The behavior is test-covered and observable.

## P08C Task 8 local implementation — 2026-09-08

Answer cache v24 now hashes the complete canonical request, including retained user context, request depth and source-policy semantics, with the existing scope, snapshot and generation-version boundaries. The same fingerprint serves local/shared cache and coalescing; retrieval normalization stays lossy. Selected-source and access restrictions remain hard limits. Inferred domain preferences no longer remove otherwise eligible cross-domain candidates.

The Dashboard stores one bounded resolved query alongside the displayed latest question and reuses it for successive follow-ups and reload. Context contains user requests only; oversized or malformed envelopes fail within the existing 2,000-character API contract. Context queries remain redacted even with raw-query retention enabled. Answer requests no longer retry a lossy keyword variant. Asked parts and a bounded medicine/clinical-constraint safety dependency feed the existing four-subquestion budget; no extra planning model call or generic mandatory four-part answer template was added.

Trusted reviewed-policy configuration loads append-only, version-bound fixture events and revalidates access, source version/hash and expiry before the existing canonical conflict resolver. A missing adapter remains not assessed. Review-configured requests conservatively refuse caching/coalescing. No hosted review persistence, human approval, activation or deployment is established by these offline fixtures.

Server diagnostics use an explicit content-free projection, including required/represented/lost coverage-part counts. These counts do not prove numeric fact retention or clinical completeness. The public answer DTO excludes diagnostics. Task 7 generation degradation remains a separate signal and uses cache version v24.

This paragraph records the historical Task 8 handoff state. Its independent review/compiler and downstream local implementation have since completed; exact Task 8 evidence remains in the local-only artifact `.superpowers/sdd/P08C-task-8-implementation-20260908-report.md`. The root-owned, local-only M2 acceptance artifact at `.superpowers/sdd/M2-final-local-acceptance-20260909.md` is the authority for the current cumulative acceptance verdict and retained boundaries.

## Current local adaptive answer status — 2026-09-09

The implemented candidate extends legacy `clinical-rag-answer-v19` / schema v4 with `clinical-rag-answer-v20` / schema v5. Its canonical answer is one lead plus bounded, ordered, question-specific sections. The authoritative server DTO, final SSE reader, current/prior thread storage and restoration, render model, and clipboard formatter retain the same supported lead, sections, citations, gap/degradation disclosure and source status. Task 4's three synthetic Chromium viewports separately prove current/prior UI wiring and unclipped rendering/copy; they are not a live HTTP/provider browser journey.

The 85-word display cap was an independent client-side defect: it silently clipped finalized v19 prose and copy after clinical generation and verification. Its removal preserved sanitation and copy/screen parity without changing retrieval, prompt/schema limits or provider behavior. V20's longer shape comes instead from its governed lead-and-sections contract.

Two independent server-only controls remain default off. With `RAG_ADAPTIVE_ANSWER_ENABLED` off, new production uses v19/v4. With `RAG_ADAPTIVE_ANSWER_RENDER_ENABLED` off, adaptive main-surface sections are hidden, while stored and current v20 payloads and their version-driven canonical clipboard content remain unchanged. Versioned prompt, schema, response and cache identities isolate rollback. No local evidence activates these flags or demonstrates production cache population.

Clinical and governance boundaries remain unchanged: narrow questions stay concise; numeric and nonnumeric claims, comparison relations, qualifications and source images remain verified; unsupported parts produce exact gaps while supported parts survive; citations resolve only to retrieved chunks; and source role, currentness, receipt, canonical conflict, selected-source and access rules remain authoritative. Site/tool catalogue material supports catalogue facts, not clinical monitoring or risk claims.

Content-free diagnostics carry required, represented and lost part counts plus direct/partial/conflicting/absent coverage counts. They can reveal false insufficiency and loss between evidence and delivery, but do not establish numeric retention or clinical completeness. In the deterministic prospective evidence, exact source removal retains all other passage bytes and yields the precise risk gap; irrelevant evidence adds no claim; broad/mixed and two-follow-up/elaboration/restoration journeys preserve required facts through current/prior/SSE/storage/render/copy.

The original 11-case v19/v4 versus v20/v5 capture used identical inputs/evidence and fixed mocked provider facts. All 11 tie on server fact retention; v20 wins 10 on complete copy delivery and ties the concise narrow case. R1 later passed every paired assertion without fresh raw outcome rows. The result supports candidate delivery-contract benefit only. Shared natural-route relevance, coverage and extractive corrections affect both lanes, and there is no provider/model reasoning, clinical usefulness, latency or cost conclusion.

Final focused evidence is 421 PASS and a 2,036-input compiler PASS. Reused R1 domain evidence is 1,194 PASS with one known baseline-confirmed P16 failure; later assertions in that test remain unexecuted. Fixtures report 36 golden, 26 suite and 26 programme PASS. Sanitized readiness remains 4 PASS, 5 WARN and 1 FAIL for missing local configuration. The local-only Task 5 final-verification artifact at `.superpowers/sdd/P12C-task5-final-verification-20260909.md` retains the exact commands and provenance. The root-owned, local-only M2 acceptance artifact at `.superpowers/sdd/M2-final-local-acceptance-20260909.md` is the authority for the current cumulative acceptance verdict and retained boundaries.

Hosted/provider comparison, real corpus completeness, P16 uploaded-local full admission, production build/deployment, physical Safari/PWA, formal P17 receipt reconciliation and clinical/legal readiness remain unproved. Historical v18/v19 Gate E is not v20 acceptance. P10/P11 and any canary or activation remain later, separately authorized work.
