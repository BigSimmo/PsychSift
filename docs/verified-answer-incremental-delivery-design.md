# Incremental delivery of verified answer content

Status: **Phase 1 shipped and enabled by default (2026-08-27); Phase 2 unbuilt and provider-gated**<br>
Phase 1 rollout: both flags default ON — server emission `RAG_INCREMENTAL_EVIDENCE_PREVIEW`
(`src/lib/env.ts`) and client rendering `NEXT_PUBLIC_RAG_INCREMENTAL_EVIDENCE_PREVIEW_RENDER`
(`src/lib/client-env.ts`, on unless the literal string `false`). Rollback order is unchanged:
server emission first, then client rendering. The render path is exercised by
`tests/answer-progress-ui-smoke.spec.ts` ("the sources arrive during the wait…" and "…paced
apart…"), which closes the browser-proof gap `#100` recorded.<br>
Tracks: [`#100`](outstanding-issues.md), [`#021`](outstanding-issues.md)<br>
Origin: [`latency-audit-2026-07-28.md`](audit/latency-audit-2026-07-28.md#l0--structural-1)

## Decision

Improve time to first useful content without reviving token streaming. The answer stream may
progressively disclose only immutable, independently verified units:

1. a bounded evidence preview after retrieval, ranking, owner-scope enforcement, the canonical
   danger-level source-governance decision, and client-payload trimming; then
2. answer sections after each complete section has passed the same citation, text, numeric, source,
   and claim-support checks required for the final answer.

The canonical `final` event remains mandatory and authoritative. Incremental units are an
append-only preview of content that is byte-identical to a subset of that final payload. A client
must discard previews if the stream errors, is cancelled, or the final payload does not reconcile.

This design explicitly rejects raw model-token delivery, provisional prose, in-place revision, and
any widening of `answerStreamEventNames`. Those shapes can expose a dose, threshold, or unsupported
claim before the existing post-generation safety gates can remove it.

## Current constraint

The provider call is buffered and returns one parsed structured object. Consequently, splitting the
existing fully generated object into frames would improve only post-processing paint time, not the
dominant generation wait. Meaningful per-section delivery requires a later provider-backed generation
experiment; retrieval-complete evidence can be delivered earlier without changing model behaviour.

## Stream contract

Keep the existing `progress`, `final`, and `error` event-name allowlist. Extend the public `progress`
DTO with an optional, discriminated `verifiedUnit` field. Existing clients ignore the field; new
clients render only recognized schema versions and unit kinds.

```ts
type VerifiedUnit =
  | {
      schemaVersion: 1;
      kind: "evidence_preview";
      sequence: 0;
      sources: ClientSourcePreview[];
      selectedContextCount: number;
    }
  | {
      schemaVersion: 1;
      kind: "answer_section";
      sequence: number;
      section: AnswerSection;
      citations: Citation[];
      supportLevel: Exclude<AnswerSectionSupportLevel, "unsupported">;
    };
```

Contract rules:

- `sequence` is strictly increasing and unique within one response. Retries start a new HTTP stream;
  units never carry across attempts.
- Evidence previews use the existing route-boundary source field policy and snippet limit. They never
  include full chunk context, table facts, document summaries, memory cards, images, service-role
  data, or another owner's document identifiers.
- A section is emitted only after all of its cited chunk IDs resolve to the already selected,
  owner-scoped evidence and its support level is not `unsupported`.
- The final response contains the same section body, citation identities, and source identities for
  every emitted unit. Reconciliation failure is a server fault, not permission to revise the preview.
- `complete` remains buffered until immediately before `final`. It never means that preview delivery
  alone succeeded.
- Cache hits may emit the same units from the already governed cached answer, but the final cache
  payload remains authoritative.

## Verification boundary

Create one pure server-only function for section finalization. It accepts a complete section plus the
selected evidence and returns either a governed immutable unit or a rejection. It must reuse, rather
than approximate, the current production gates:

1. the canonical danger-level source-governance refusal used by `buildGovernedAnswerClientResponse`;
2. citation sanitization and source membership;
3. answer and structured-text sanitization;
4. numeric verification and unbolding of unverified numbers;
5. quote-card sanitization where applicable;
6. claim-support assessment and labelled numeric-band coherence; and
7. the canonical answer render policy.

The governance refusal is evaluated before any evidence preview or answer section crosses the route
boundary. If it refuses the authoritative response, the stream emits zero verified units and continues
through the existing refusal/fallback contract; a preview must never disclose source content that the
final governed response withholds.

**Amendment, 2026-09-03 (owner decision), for the evidence preview only.** As first shipped, the
preview ran the danger-level check over the whole retrieval set (`answerInputResults`) and emitted
nothing on any hit. Because that is also the set the final response governs
(`answer.sources = answerInputResults` in `rag.ts`), it held the invariant above exactly — and it made
the feature unusable: one outdated or badly-extracted chunk among twelve to twenty-four retrieved
passages blanked the whole rail, which on a real corpus is most questions, and the sources it hid were
the clean ones.

The decision is now **per document**. A danger-level document is excluded from the preview; the
remaining sources are shown. Per card this is stricter than before — such a document can no longer
appear in the preview at all, where the wide check merely delayed its appearance until the answer's
own rail. The answer-level verdict (`WEAK_EVIDENCE`, from `relevance.verdict === "none"`) still
suppresses the entire preview, because it is not a property of any one document.

The residual, stated plainly rather than left to be discovered: when the final response refuses on
source governance it blanks `sources: []`, so a preview that showed clean cards has disclosed
document identities the final response then withholds. Those cards are documents that passed
governance individually and are reachable by ordinary search; the refusal blocks the synthesised
answer, not access to the documents. They are removed the moment the answer lands, because the rail
renders only while the request is in flight. This is a deliberate, owner-approved narrowing of the
invariant above, not an oversight, and it applies to the evidence preview only — Phase 2 answer
sections carry generated clinical prose and keep the unamended rule.

The exclusion set must never be derived from `sourceGovernanceWarnings`' returned list, which is
capped at eight for display. Evaluate one source at a time; see `src/lib/answer-preview.ts`.

Do not implement a second, weaker “stream-safe” verifier. If the current gates cannot operate on an
independent section, that section stays buffered until the final answer. Cross-section comparisons,
conflicts, and conclusions that depend on later sections are not independently emit-able in v1.

## Delivery phases

### Phase 0 — offline contract proof

- Add schema validation for `verifiedUnit`, sequence monotonicity, bounded payload size, and rejection
  of `token` / `revising`. (Amended 2026-09-05: the builder must fit the unit under the boundary's
  size cap itself, by dropping sources from the tail, and never emit a unit the boundary will reject.
  Until then a twelve-source unit of real-sized sources was ~83,000 characters against a 64,000 cap,
  so every non-fast answer's rail was built and then discarded as `contract_rejected`.)
- Add reconciliation tests proving every preview is an exact subset of `final` and is discarded on
  error, cancellation, retry, unknown schema version, or mismatch.
- Add a source-governance fixture proving an outdated or poorly extracted danger-level source is
  excluded from every evidence preview and emits zero answer-section units, that an answer-level
  `WEAK_EVIDENCE` verdict emits zero evidence previews, and that exclusion holds past the
  eight-warning display cap. (Amended 2026-09-03 with the per-document decision above; before that
  amendment any such source emitted zero evidence previews.)
- Add owner-boundary fixtures proving private source fields and cross-owner identifiers cannot cross
  the route boundary.

This phase is provider-free and must land before either visible phase.

### Phase 1 — retrieval-complete evidence preview

- After answer evidence is ranked and the final context pack is selected, run the same danger-level
  source-governance decision used by the authoritative final response, per document (see the
  2026-09-03 amendment above). Emit the sources it permits, through the existing client-source
  trimming policy, as `progress.verifiedUnit`; emit nothing when the answer-level verdict is
  danger-level or when no source survives.
- Render it where the answer's own source rail will land, so arrival swaps content in place rather
  than moving it. As shipped this is `AnswerEvidencePreview`, a rail of unnumbered cards under the
  status line and prose placeholder — not the labelled “Selected evidence” panel this design first
  described, which stacked a second loud block in the answer's position. Do not render it as answer
  prose, do not mark the answer complete, and do not number the cards: the preview is retrieval
  order while the final list is rebuilt from what the answer cites, so an early number can end up
  pointing at a different document.
- The cards are revealed one at a time, one per `--duration-moderate`, with the first standing the
  instant the unit arrives. Retrieval is a single call and the contract carries exactly one preview
  per answer, so this is presentation, not live discovery: the pacing exists because a rail that
  mounts whole is over before a reader watching an otherwise still screen registers it. The status
  line's count is read from the same reveal, so the number always equals the cards beneath it.
  Suppressing motion returns the full count with no timer in the path — a JS reveal could withhold
  content in a way a CSS delay never could.
- Preserve the current final source list, source governance warnings, feedback token, telemetry, and
  persistence behaviour.

This is the smallest useful increment: it brings owner-scoped, source-backed content forward while
leaving generation, retrieval ordering, and ranking byte-identical.

### Phase 2 — verified answer sections

- Experiment with generation in complete independently verifiable section units. A unit must be fully
  parsed before verification; model token deltas remain private to the server.
- Prefer a bounded lead section followed by supporting sections. Do not create one provider request per
  display paragraph without evidence that cost, latency, cancellation, and rate-limit behaviour remain
  acceptable.
- Run independent section finalization, emit accepted sections, then assemble and globally verify the
  canonical final answer. If global verification would change an emitted unit, fail closed, terminate
  that stream, and let the existing client retry start a fresh request; never patch already displayed
  prose or label the partial response complete.

Phase 2 changes answer generation and cannot begin without the provider-backed gate below.

## Failure, retry, and rollout behaviour

- **Disconnect or Stop:** abort provider and retrieval work as today; the client removes all previews.
- **Retry:** clear prior previews before opening the new stream. A sequence number has meaning only
  inside one response.
- **Verifier rejection:** emit no unit. Continue toward the governed final or existing conservative
  source-only fallback.
- **Stream error after preview:** discard every preview and display the existing error state. Evidence
  links from the failed stream do not remain visible; a retry starts with empty preview state.
- **Rolling deploy:** old clients safely ignore the optional field; new clients accept an absent field.
  No new SSE event name is introduced.
- **Feature flag:** gate rendering and emission separately. Deploy client parsing first, then server
  emission, then enable rendering for internal users. Rollback disables emission; no schema or stored
  data rollback is needed.

## Telemetry and acceptance

> **Gap (recorded 2026-10-20, audit finding DOC-11).** Phase 1 shipped default-on on 2026-08-27 without
> the timing measurement below. None of `retrieval_verified_unit_ms`, `first_verified_content_ms` or
> `first_verified_section_ms` exists in `src/lib` or `src/app/api/answer`; only `previewReason` and the
> `evidence_preview` unit do. So the Phase 1 latency criterion ("a lower median
> `first_verified_content_ms` than final-answer latency") has never been measured, and nothing yet shows
> how much sooner first content appears. The preview's safety criteria rest on the deterministic tests
> such as `tests/answer-incremental-delivery.test.ts`. Adding the timing fields is answer-path work and follows the RAG safeguards.

Record no clinical text in telemetry. Record timestamps and counts only:

- `retrieval_verified_unit_ms`, `first_verified_content_ms`, `first_verified_section_ms`;
- emitted/rejected unit counts and rejection-reason enums;
- final reconciliation success/failure;
- disconnect-before-final rate; and
- route, cache, fallback, and model class already recorded by the answer pipeline.

Acceptance requires:

- no change to retrieval results, ranking order, owner scope, final payload, source governance, or
  conservative fallback behaviour;
- zero preview/final reconciliation failures in deterministic tests;
- a lower median `first_verified_content_ms` than final-answer latency for Phase 1;
- for Phase 2, no regression in grounded-supported answers, citation failures, numeric verification,
  p95 final latency, provider cost, or disconnect-before-final rate; and
- accessibility proof that incremental additions do not repeatedly announce entire prior content or
  move focus.

## Required gates before runtime implementation

Local/offline:

1. focused stream-contract, parser, owner-scope, verification, and reconciliation tests;
2. `npm run eval:rag:offline`;
3. `npm run verify:cheap`;
4. `npm run check:production-readiness`;
5. `npm run ensure` followed by `npm run verify:ui` for the visible client phase; and
6. `npm run verify:pr-local` before handoff.

Provider-backed and therefore separately approval-gated:

1. `npm run eval:rag -- --limit 15` plus `npm run eval:quality -- --rag-only` for answer-generation
   and post-processing changes;
2. a baseline/post live canary pair with document/content recall pinned at `1.0`, zero per-case
   reciprocal-rank regressions, and no answer-quality regression; and
3. a staged observation window for final reconciliation, abort, latency, and cost metrics.

## Governance disposition

- **Clinical safety:** safer than token streaming because no provisional prose crosses the boundary;
  rejected units remain invisible and the existing source-only fallback remains intact.
- **Privacy and access:** no new data source or owner scope; the route emits only the bounded fields
  already permitted in final client payloads.
- **Source governance:** evidence remains linked to the same source identities and warnings; a preview
  is explicitly not a completed clinical answer.
- **SaMD:** this changes presentation timing, not intended purpose or recommendation logic. Reassess
  before Phase 2 because multiple generated units could change synthesis behaviour.
- **Rollback:** disable the server emission flag, then the client rendering flag. The canonical final
  contract and stored answer format remain unchanged.

## Explicit non-goals

- Reintroducing `token` or `revising` events.
- Streaming partial JSON or prose before a complete unit verifies.
- Changing retrieval, ranking, evidence selection, prompts, or final-answer quality thresholds in
  Phase 1.
- Persisting previews as completed answers or accepting feedback against preview-only content.
- Calling OpenAI, Supabase, hosted CI, or production services as part of this design-only change.
