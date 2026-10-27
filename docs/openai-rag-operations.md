# OpenAI and RAG operations

_Updated 2026-10-27 — Sol 6.1 answer candidate and bounded comparison; Answer engine owns._

## Supported architecture

The app uses the OpenAI Responses API for stateless structured generation and
multimodal image inputs, plus the embeddings API for owner-scoped Supabase retrieval. It does not
use Chat Completions, Assistants, the Agents SDK, Realtime, built-in file search, or persisted
OpenAI conversation state.

The clinical request path is:

`ClinicalDashboard -> /api/answer/stream -> retrieval/classification -> Responses API -> deterministic quality and source-governance gates -> final SSE event`

The SSE connection emits progress events and heartbeat comments while work is running. Clinical
answer prose is sent only in the validated `final` event. The browser deliberately ignores legacy
`token` and `revising` events so a mixed-version deployment cannot restore provisional prose.

## Workload models

| Workload                                                                 | Environment variable            | Documented rollout value                    |
| ------------------------------------------------------------------------ | ------------------------------- | ------------------------------------------- |
| Fast clinical synthesis                                                  | `OPENAI_FAST_ANSWER_MODEL`      | `gpt-6.1-sol` (low effort)                  |
| Strong clinical synthesis                                                | `OPENAI_STRONG_ANSWER_MODEL`    | `gpt-6.1-sol` (medium effort)               |
| Query classifier                                                         | `OPENAI_QUERY_CLASSIFIER_MODEL` | `gpt-5.6-luna`                              |
| Document summaries                                                       | `OPENAI_SUMMARY_MODEL`          | `gpt-5.6-terra`                             |
| Enrichment/index profiles                                                | `OPENAI_INDEXING_MODEL`         | `gpt-5.6-terra`                             |
| Vision classification/captioning                                         | `OPENAI_VISION_MODEL`           | `gpt-5.6-terra`                             |
| Embeddings                                                               | `OPENAI_EMBEDDING_MODEL`        | `text-embedding-3-small` at 1536 dimensions |
| Optional semantic rerank (off unless `RAG_SEMANTIC_RERANK_ENABLED=true`) | `OPENAI_RERANK_MODEL`           | `gpt-5.6-luna` (code default)               |
| Clinical Ask voice transcription                                         | `OPENAI_TRANSCRIPTION_MODEL`    | `gpt-4o-mini-transcribe` (code default)     |

These are candidate configuration values, not evidence of hosted activation. Explicit deployment
variables remain pinned until changed. Runtime answer defaults remain GPT-5.6 Terra (answer/fast)
and GPT-5.6 Sol (strong); the three explicit Sol overrides are a separate activation step after
the approved comparison. Merging this preparation must not activate Sol by itself.
When workload-specific variables are omitted, classifier
and summary code fallbacks stay on `gpt-5.6-terra`, and indexing stays on `gpt-5.6-sol`. The example
configuration's explicit Luna classifier and Terra indexing overrides remain unchanged. Changing
answer models must not migrate ingestion, embeddings or retrieval.

OpenAI recommends the Responses API for current general-purpose multimodal and tool-capable
workflows. See the [Responses migration guide](https://developers.openai.com/api/docs/guides/migrate-to-responses),
[latest-model guide](https://developers.openai.com/api/docs/guides/latest-model), and
[model catalog](https://developers.openai.com/api/docs/models).

## Compatibility and safety controls

- GPT-5.6 and Sol 6.1 requests use `prompt_cache_options.ttl`; they never receive the deprecated
  `prompt_cache_retention` field. `OPENAI_PROMPT_CACHE_TTL=off` omits the extended TTL option.
  Pre-5.6 models retain the legacy retention configuration.
- Answer caches and in-flight coalescing include a fingerprint of models, reasoning effort,
  provider mode, answer prompt/schema versions, retrieval version, and indexing prompt version.
- Static query-classifier output uses `responses.parse` with a strict Zod schema. The dynamic
  clinical answer schema remains strict JSON Schema because its evidence-ID enums are generated
  from the retrieved source set.
- Generation retries remain disabled at the SDK layer. The RAG pipeline performs explicit,
  state-aware fast-to-strong and deterministic quality retries and fails closed to a labelled
  source-only answer.
- `response.failed`, content-filtered, and empty/absent outputs are explicit provider failures.
  Timeout, key, access, missing-model, quota, rate-limit, invalid-request, and service failures use
  distinct public-safe error codes.
- When `OPENAI_SAFETY_IDENTIFIER_SECRET` is configured, authenticated Responses requests use an
  HMAC-SHA256 pseudonym. Raw owner IDs are never sent; anonymous/background requests omit it.
- Usage telemetry includes input, output, total, cached-input, cache-write, and reasoning tokens.
- Sol 6.1 requires reasoning: an explicit `none` becomes `low`. The existing answer routes pass
  their own effort explicitly even though both now use the same model. No new router is added.

## Sol 6.1 comparison and activation

The owner approved preparing Sol 6.1 for all generated answers, conditional on better quality at
no higher cost per successful answer, no safety/citation regression and no material latency regression.
This is not approval for paid evaluation, production activation, publication or deployment.

Use `node scripts/run-tsx.mjs scripts/compare-answer-models.ts` for the provider-free dry run.
The component experiment uses frozen synthetic evidence and the production generation/validation
components; it does not establish live retrieval or complete route equivalence. Twelve cases, two
measured passes and one labelled warm-up per route per arm give 52 planned answer executions.
Both model/effort combinations are warmed before measurement. No paid model
judge is used. Blinded review remains human; clinical sign-off remains owner-only.

Before a live run, verify account access and current official prices, approve that exact bounded
run and inspect the harness's approval manifest and reservations. The planned ceilings are US$15,
150 requests including recovery, one million input tokens, 400,000 output tokens including reasoning,
and concurrency one. This full plan cannot fit those caps: output reservations alone are
832,000 tokens against the 400,000 cap. A feasible revised scope and its own approval are required.
Conservative admission can stop the experiment before all cases complete;
an incomplete comparison never passes. No credentials or production content belong in a manifest.
Thrown failures and incomplete provider responses both stop the schedule without retries.
Malformed output recovered into a safe refusal earns no model-quality credit; the raw response
must contain the issued answer envelope and explicitly declare unsupported confidence.
The manifest's absolute `outputDirectory` binds it to one new ignored run directory in this checkout. That directory is
atomically consumed and a durable approval receipt is written before transport; an interrupted
or failed run cannot reuse it. Run the harness from its own checkout root so the approved hashes
identify the code that actually executes.

Existing evaluators accept `RAG_EVAL_MODEL_PRICES_JSON` with explicit per-million USD rates keyed
by exact model ID (`input`, `output`, optional `cachedInput` and `cacheWrite`). Attempt records
retain each generation's model/usage; unknown failed-call usage makes cost unknown. Unmeasured
cache writes use a labelled conservative premium. Without the table, legacy global rate overrides
remain labelled aggregate estimates. Reasoning is already included in output tokens.

Compare blinded quality, groundedness, citations and unsupported handling, total costs including
failed attempts, and median/p90 latency (no more than 10% above control, no additional deadline
failures). Keep upstream embeddings/retrieval/reranking frozen and provider-free in this experiment;
their experimental charge is zero, not a claim about production costs. Provider cache writes,
regional premiums and any later hosted/evaluation charges need inclusion in the approved price basis.

For activation, separately approve setting `OPENAI_ANSWER_MODEL`, `OPENAI_FAST_ANSWER_MODEL` and
`OPENAI_STRONG_ANSWER_MODEL` to `gpt-6.1-sol`, while retaining non-answer workload overrides and
`OPENAI_STORE_RESPONSES=false`. Retain low/medium effort and current context/output ceilings.
Record previous environment settings and artifact first. Rollback restores those settings/artifact;
model-aware cache identities prevent cross-model reuse. No re-embedding, re-indexing or migration
is needed. Source defaults and a dry run do not establish account availability or answer quality.

Model identity and compatibility: [Sol 6.1](https://developers.openai.com/api/docs/models/gpt-6.1-sol).
Pricing basis: [OpenAI pricing](https://developers.openai.com/api/docs/pricing), checked 27 October 2026;
refresh before a paid run. Standard short-context Sol 6.1 is US$2 input/US$10 output per million,
versus Terra 5.6 US$2/US$12 and Sol 5.6 US$4/US$20; token rates alone do not prove answer savings.

## Rollout sequence

Change one workload at a time: classifier, indexing/enrichment, summaries, vision, fast answers,
then strong answers. Do not change prompts and models in the same experiment. A model or prompt
change automatically misses the prior answer cache because the generation fingerprint changes.

Before provider-backed rollout, manually confirm model access, project/org permissions, pricing,
rate limits, DPA/ZDR posture, prompt-cache handling, and the privacy basis in
[openai-cross-border-basis.md](openai-cross-border-basis.md).

## Local validation

Keep provider variables cleared for local/static/mocked checks:

```powershell
$env:OPENAI_API_KEY=$null
$env:OPENAI_ORG_ID=$null
$env:OPENAI_PROJECT_ID=$null

npm run test -- tests/openai-cache.test.ts tests/openai-error-mapping.test.ts tests/openai-safety-identifier.test.ts tests/rag-generation-fingerprint.test.ts tests/rag-classifier-memo.test.ts tests/rag-answer-fallback.test.ts tests/private-rag-access.test.ts tests/document-mutation-routes.test.ts
npm run eval:rag:offline
npm run verify:cheap
```

### Clinical Ask provider boundary

Clinical Ask follows Catalogue → authorised Indexed → allowlisted External Authority, in that order. External web
search is server-only and is permitted only for a deterministic evidence gap, unresolved conflict, staleness, or a
`needs_review` source. The server validates the registered domain and path before and after redirects, retains exact
publisher attribution and retrieval time, meters the request, and discards the fetched page/extract after the request.
It does not turn provider output or an external page into durable catalogue or indexed content.

Transcription, external-search, and synthesis output are untrusted provider outputs. The browser uploads the in-memory
audio Blob only after format, size, and duration checks; it does not strip identifiers from speech before
`/api/speech/transcribe`. The clinician reviews and may edit the returned transcript, and identifier-shaped text is
blocked before Clinical Ask submission. Synthesis is accepted only after deterministic mode-shape, citation, claim-support, prohibited-outcome, and
Clinician Confirmation gates. Provider confidence is not an evidence-sufficiency or release signal. Raw question,
transcript, Case Context, audio, answer, and extracts are excluded from logs, telemetry, feedback, and public errors.

Rollout uses three independent controls: `CLINICAL_ASK_ENABLED`,
`CLINICAL_ASK_EXTERNAL_SEARCH_ENABLED`, and `CLINICAL_ASK_DISABLED_MODES`. Set the master flag false for full rollback;
set external false to preserve Catalogue/Indexed Ask while stopping web search. A seven-mode launch claim requires an
empty emergency denylist and separate evidence for provider access, approved authorities, hosted migration,
contractual retention/region, synthetic clinical evaluation, protected-staging canary, and physical iPhone
Safari/installed-PWA microphone acceptance.

Provider-backed evaluation requires explicit approval. Run classifier/vision/answer canaries
separately and compare citation validity, unsupported-number rate, source-gap behavior, fallback
rate, p50/p95 latency, output/reasoning tokens, cache reads/writes, and cost per accepted answer.
