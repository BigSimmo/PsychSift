# OpenAI and RAG operations

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
| Fast clinical synthesis                                                  | `OPENAI_FAST_ANSWER_MODEL`      | `gpt-5.6-terra`                             |
| Strong clinical synthesis                                                | `OPENAI_STRONG_ANSWER_MODEL`    | `gpt-5.6-sol`                               |
| Query classifier                                                         | `OPENAI_QUERY_CLASSIFIER_MODEL` | `gpt-5.6-luna`                              |
| Document summaries                                                       | `OPENAI_SUMMARY_MODEL`          | `gpt-5.6-terra`                             |
| Enrichment/index profiles                                                | `OPENAI_INDEXING_MODEL`         | `gpt-5.6-terra`                             |
| Vision classification/captioning                                         | `OPENAI_VISION_MODEL`           | `gpt-5.6-terra`                             |
| Embeddings                                                               | `OPENAI_EMBEDDING_MODEL`        | `text-embedding-3-small` at 1536 dimensions |
| Optional semantic rerank (off unless `RAG_SEMANTIC_RERANK_ENABLED=true`) | `OPENAI_RERANK_MODEL`           | `gpt-5.6-luna` (code default)               |
| Clinical Ask voice transcription                                         | `OPENAI_TRANSCRIPTION_MODEL`    | `gpt-4o-mini-transcribe` (code default)     |

If a workload-specific variable is omitted, the query classifier follows the fast-answer model,
summaries follow the answer model, and indexing follows the strong-answer model. Existing
deployments with explicit GPT-5.5 variables remain pinned until their environment is changed.

OpenAI recommends the Responses API for current general-purpose multimodal and tool-capable
workflows. See the [Responses migration guide](https://developers.openai.com/api/docs/guides/migrate-to-responses),
[latest-model guide](https://developers.openai.com/api/docs/guides/latest-model), and
[model catalog](https://developers.openai.com/api/docs/models).

## Compatibility and safety controls

- GPT-5.6 requests use `prompt_cache_options.ttl`; they never receive the deprecated
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
