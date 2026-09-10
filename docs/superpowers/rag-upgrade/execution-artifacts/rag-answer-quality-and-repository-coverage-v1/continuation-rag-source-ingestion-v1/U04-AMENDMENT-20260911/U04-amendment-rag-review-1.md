# U04 amendment RAG/evidence review 1

Spec: **FAIL**
Quality: **FAIL**

**Not ready for a fresh U04 source implementer.** Three Important findings below require a bounded amendment correction. No Critical finding was identified. These verdicts concern the frozen design/source package, not implemented U04 code, SQL runtime, clinical performance, or the independent runner review.

## Important findings

### R1 — Close the unconditional request-context reads before declaring the engine adapter complete

**Evidence:** integrated candidate 1 lines 59–65; evaluation interface 3 lines 36–53; SQL binding 1 line 39. Actual source: `src/lib/rag/rag.ts:1551–1560,2404–2407`; `src/lib/rag/rag-cache.ts:534–550,579–605,618–698`; `src/lib/site-content/site-content-health-authority.ts:110–120`.

Both actual search and answer entrypoints call `resolveRequestRagCacheContext` before their ordinary cache-enable checks. Without an existing snapshot, its resolver reads a global document-index identity and invokes `collectSiteContentHealthInput`, whose default path creates an admin client and reads site runtime authority. Even with a supplied snapshot, lines 595–604 eagerly create `indexingVersionAtRequestStart` through `readDocumentIndexGeneration`; the current `cacheIndexingVersion` reaches the live public-serving stamp and documents. `skipCache:true` does not prevent these calls.

The frozen operation list describes aliases, corpus, correction, retrieval, hydration, provider operations and adjacent/related context, but does not bind or explicitly replace this request-context path. “Bypass ordinary persistent semantic caches and query coalescing” is insufficient for this actual call graph. A local implementation following that instruction can still issue an out-of-wave/site-authority read before reaching any declared guarded reader; source errors may then be converted into unavailable context outside the monotonic evaluation failure collector. Alternatively it must invent an unreviewed context substitution.

**Expected:** actual evaluation entrypoints construct only the declared wave/context and reach no unbound admin client, site/registry authority, or production indexing-version promise. No-context ordinary entrypoints retain their existing resolver and behavior.

**Smallest closed correction:** add the explicit evaluation request-context construction/bypass to the operation/symbol contract within the already approved `rag.ts`, `rag-cache.ts`, `rag-contracts.ts` and session owner. Define the evaluation snapshot/config identity, bound clock/source policy/rollout, explicit excluded site partition, and handling of `cacheContext`/`indexingVersionAtRequestStart`. Do not call the ordinary resolver and then overwrite its result. No new site-content owner or background corpus is needed.

**Smallest later proof:** actual search AND answer with a complete fake evaluation dependency set; exercise absent snapshot, supplied snapshot, and supplied cache context, all with cache bypass. Trap every ordinary admin/site-authority/index-version call and require zero calls. Wrong/conflicting evaluation context must latch incomplete/NO_GO; ordinary no-context fixtures must retain their existing calls/results. This is a proposed focused test, not a test run.

### R2 — The fixed origin-capture RPC cannot receive the selected manual-alias population

**Evidence:** integrated candidate 1 line 31 fixes `capture_shadow_reindex_origin(p_document_ids uuid[], p_source_policy_version text)`; line 39 requires a reviewed UUID list in the execution profile and capture of those exact full alias rows regardless of enabled state. Origin column parity 1 lines 71–73 and column contract 2 lines 2057/2487 distinguish document aliases from the additional manual overlay M. Origin transaction 3 line 91 requires one statement-snapshot capture.

For a permitted manual alias with no selected `metadata.document_id`, W and the source-policy version do not identify its row. The fixed capture signature has neither M nor the profile that contains it, and this read precedes enqueue, so a persisted wave/profile cannot supply the missing input. The implementer must omit the overlay, widen capture to a global alias population, add a separate non-atomic capture, or change the reviewed signature. None implements the frozen contract as written.

**Expected:** one complete captured origin binds the exact authorized W and reviewed M, including disabled aliases and full lineage/owner data. Later guards detect changes/removal, and unlisted aliases never enter evidence.

**Smallest closed correction:** pass the strictly validated execution profile, or explicit bounded manual-alias IDs plus its bound profile identity, into the fixed capture operation. Specify server validation of exact requested ID membership, reviewed lineage and allowed owner/public scope, and bind the profile/M identity into the returned origin envelope. Carry that same identity through baseline evaluation, enqueue and every fixed read. Do not silently reduce v1 to an empty overlay.

**Smallest later proof:** W plus a reviewed manual alias outside W, initially disabled; capture its complete row; require refusal after enabled/content/removal drift; reject generated/unknown-lineage/wrong-owner IDs; exclude an unlisted alias. Assert a single fixed capture operation. No SQL was executed here.

### R3 — The promised closed inventory/measurement contracts are still descriptive placeholders

**Evidence:** integrated candidate 1 lines 27 and 53–55; schema recommendation 1 lines 76–82 and 181; controller decisions 1 line 47; origin transaction 3 lines 41,50–58,160. Actual P04 parser: `src/lib/ingestion-audit.ts:130–175,186–274`.

The integrated amendment claims “existing fixed reference/relationship records” from schema recommendation 1, but that section supplies JSON column names, 18 family names and rules, not the tagged reference variants, relationship record fields, limitation/reason vocabulary or per-family requiredness/capability mapping. The 335-column JSON contract describes existing SQL rows; it does not define those new JSON records. The lower-precedence documents explicitly required the closed records to be frozen before dispatch, and the integrated candidate does not replace that missing definition.

The measurement-consumer direction is sound, but `reviewed-origin-measurements-v1` is likewise described as a list of concepts: no literal witness/reviewer/producer record shape or accepted measurement-policy binding is supplied. The existing P04 parser validates its own counts/booleans/provenance shape; it does not validate an origin-bound witness collection or recognize which new producer/policy is supported. Consequently “reject unsupported policy” and “full per-measurement witnesses” cannot be implemented consistently from the reviewed contract. Accepting any nonempty policy and boolean payload would lose the required evidence check; rejecting every policy would create the expressly prohibited permanent refusal.

**Expected:** a fresh implementer can implement strict validators and capability/requiredness decisions without authoring new governance or completeness policy.

**Smallest closed correction:** add one bounded, hash-bound contract appendix:
- literal discriminated `artifact_ref`, relationship, limitation/reason and source-binding shapes, with family-to-existing-row/validator mappings, C/D/source/attempt constraints and requiredness/evaluation-capability rules;
- the exact reviewed-measurement, expectation and witness shapes, accepted policy/producer binding rule, witness coverage/identity/count consistency rules and real-versus-mocked evidence disposition.

Reuse P04 and U02 field schemas and accepted algorithms by reference where complete; do not create a new native/semantic assessor. A reviewed manual evidence consumer is an acceptable design: no automatic producer is required, and missing operational measurements may remain an explicit not-ready dependency. What is missing is its closed acceptance contract, not a live measurement run.

**Smallest later proof:** a positive authored measurement/inventory record reaching actual P04 parsing/classification and actual candidate reconciliation; reject unknown variants, unsupported policy, omitted/duplicate/conflicting witnesses, wrong origin/source/C/D/attempt, missing required evidence and survivor-derived expected counts. A truthful optional limitation may retain an inert candidate but cannot satisfy a required evaluation capability. No tests were run.

## Assessment of the remaining amendment

| Area | Source/design assessment |
| --- | --- |
| Full engine operation map | Substantially covers correction vocabulary, corpus totals, aliases, text/hybrid/vector, lookup rescue, three table-fact branches, fields/units, hybrid/lexical memory, chunk/document hydration, quality, images/visual counts, related documents and adjacent answer context. R1 is the additional actual closure defect. |
| Atomic logical view and sticky failure | The chosen per-read guard plus evidence under the same statement snapshot is a coherent logical-input contract. It correctly requires unconditional empty-result guards, no volatile factual subcalls, exact original plus sanctioned C/control equality, and a monotonic failure collector after retrieval and answer/verification. It correctly does not claim uninterrupted historical stability or deterministic ANN/provider output. SQL proof remains future. |
| Full fidelity and provenance | Full rows/raw envelope bytes, complete U02 payload, C/D/source arrays, deep-memory receipt/anchors, explicit native limitation, and full available evidence rather than previews are required. Available optional evidence is not permission to discard it. Requiredness/relationship validation still needs R3's closed contract. |
| Metrics and cases | Actual retrieval and quality runners reach the existing engine (`eval-retrieval.ts:974–982`, `eval-quality.ts:1154–1166`). The amendment requires full existing gate metrics, case fingerprints/denominators, equal bound corpus/mode/config/clock and complete actual answer-quality evidence. Direct chunk diagnostics and stored extraction quality cannot substitute. R1 must be closed before those claims can hold through the engine. |
| Baseline before stage | Explicit and correctly bound to enqueue inputs/full baseline report and origin. Candidate completion cannot retroactively manufacture baseline evidence. A partial wave or unavailable candidate capability remains NO_GO. |
| Exact-wave policy | Deliberate and acceptable within the already approved adapter extension. Side-specific generated aliases/vocabulary, frozen manual overlay, public/enabled correction eligibility, title tokenization/multiplicity, effective SQL quirks and fixed clock/settings are identified. This is not full-global-production output parity. R2 is a transport/binding gap, not an objection to that policy. |
| Ordinary defaults | The design preserves ordinary ranking, prompts, models, source policy, caches and effective SQL bodies outside evaluation. Necessary candidate/page/null visibility closures are explicitly scoped. Require positive ordinary-entrypoint parity and actual image-signing/page-loader isolation tests; no general RAG repair is justified. |
| Limits and operational profile | 8 members, 250,000 captured rows, 256 MiB canonical origin/bundle bytes and 2,000 rows/16 MiB per append are concrete enough to implement refusal boundaries locally. They are ceilings, not demonstrated performance. Exact counts/encoded bytes must be checked without truncation; lowered signed-profile limits must remain effective. Server deadline/role configuration, worst-approved-fixture timing and contention are separate connected admission evidence. |
| Candidate preservation | Protection explicitly covers reserved/building/staged/failed/ambiguous C and subordinate D beyond a transaction, including the existing cleanup function and direct reset/commit/delete/page replacement boundaries. No U04 release-of-protection or cleanup executor is introduced. This is the right scope; actual SQL write-boundary coverage remains implementation review and connected proof. |
| Runner/gates | Runner5's independent verification-review PASS is supplied controller evidence; synthetic host proof remains pending. I did not repeat that review or equate it with product gate success. Exact protected-safe input admission is required before its corresponding run, not before future test files exist. |

## Scope, identity and evidence

Review identity: `/root/u04_amendment_rag_review_1`, child session `01a08bf5-0297-7253-935d-ed49f10312db`, parent `01a07b47-4623-7e90-825a-ec25116b8531`. The exact child log `C:/Users/joshs/.codex/sessions/2026/09/10/rollout-2026-09-10T23-34-45-01a08bf5-0297-7253-935d-ed49f10312db.jsonl` was opened with shared read access. Selected matching `session_meta` fields identify this child/path/provider, and its `turn_context` records **gpt-6-astra / xhigh**. This is observed local resolved configuration, not backend attestation. This reviewer did not contribute to the frozen design.

Observed repository: `C:/Users/joshs/.codex/worktrees/rag-local-build-20260822/Database`; branch `codex/rag-local-build-20260822`; HEAD `378c9c3997f91921d89aa6d919b5c9ef05b2152a`; tracked status clean. Applicable root AGENTS, review protocol and canonical `docs/superpowers/rag-upgrade/canonical/sdd-execution.md` were read. This is a specifically commissioned outside amendment review, not a branch/PR review; no repository ledger mutation is due.

Frozen package `U04-amendment-review-package-1.json` SHA-256: `8aba404d967f27b1a37ae2dfa988dfefbfde6d6937d5358977402fca415e8f49`. All 12 bound file hashes matched. Governing integrated candidate SHA-256: `19606f86daf4e967d8791b1c9d6f91b5794fecdd63c0c0d63a19638a58582ebc`. Its precedence was applied; superseded direct-driver, broad-every-write-lock, same-C-reclaim, two-wrapper-only and old projection alternatives were not treated as current requirements.

Read-only verification used `git branch --show-current`, `git rev-parse HEAD`, `git status --short --untracked-files=no`, worktree metadata, `Get-FileHash -Algorithm SHA256` on the exact package/pins, and bounded text reads/searches of named docs/source. One guessed site-health source pathname did not exist; the actual import resolved it to `src/lib/site-content/site-content-health-authority.ts`. No product failure is inferred from that read error.

No tests, config loads, SQL, providers, real/native documents, workers, servers, package changes, untracked-file discovery, implementation, commits, publication or recursive delegation occurred. Only this new outside report was written. Source-only inspection cannot prove SQL snapshots/rollback/concurrency, installed grants/RLS, native/Storage fidelity, real latency, provider semantic support or clinical acceptance. Those remain separately authorized future gates.

P08A remains superseded and the retrieval kernel default-off. Historical U02 offline evidence is **exit 1, four failed suites, 45 failed and 586 passed overall**; it is not green and no exception is inherited.

Disposition: correct R1–R3 in the amendment, freeze the corrected package, and obtain the required independent whole-unit verdicts before fresh local implementation. These are bounded contract corrections within the approved scope; no new shared RAG scope authorization is requested.
