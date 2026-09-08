# U03 contract execution review 1

Specification: **FAIL**. Quality: **FAIL**. Two Important blockers; no Critical finding. These verdicts concern the newly authored documentation and execution recipes. They do not reopen accepted U02 product work or assert a product/runtime defect has been reproduced.

## Important findings

### U03-EX-01 — Include the effective attached publication trigger in the selected P05 schema closure

Location: `R/docs/superpowers/rag-upgrade/continuations/rag-source-ingestion-continuation-v1/U03-execution-contract.md:144-146`; corresponding frozen recommendation `U03-schema-contract-recommendation.md:146-148`.

The new contract includes the final policy-event/transition writers and `make_public_source_version_ineligible`, but leaves publication guards among omitted snapshot debt. That is too narrow for the selected writer closure: `make_public_source_version_ineligible` updates `documents.owner_id` and metadata (final hardening migration lines 335-347), which invokes the already attached `documents_require_publication_approval` trigger. The snapshot currently binds that trigger to an earlier `guard_document_publication_transition` body (`R/supabase/schema.sql:8265-8356`). Its UPDATE guard only checks owned-to-public transitions and otherwise returns NEW. The final P05 replacement (`R/supabase/migrations/20260824120000_consolidate_public_source_lifecycle_authority.sql:379-465`) additionally validates the exact lifecycle-exit version when re-owning an Australian public document and refuses changes to its reviewed state while it remains public.

Consequently, the proposed selected-object/body check plus referenced-object existence check can pass while the imported policy writer runs beneath different authority enforcement from the migration chain. For example, an attempted public-to-owned transition without the exact lifecycle-exit binding is accepted by the snapshot's trigger but rejected by effective P05. This is relevant to the policy/owner boundary of the newly selected writer closure, not a request for whole-schema drift repair.

Smallest correction: explicitly add the final `guard_document_publication_transition()` body and its existing trigger binding to the U03 prerequisite list and parity comparison. Include its exact missing column prerequisites: `document_publication_approvals.source_catalogue_key`, `source_policy_version`, `reviewed_index_generation_id`, and their v2 completeness constraint from `20260822123000_govern_australian_source_activation.sql:5-18`; the current snapshot table at `schema.sql:8160-8174` lacks them. Do not import the obsolete bulk-publication function or historical data backfills. The contract already requires a named review of newly identified transitive prerequisites; resolve this now rather than treating this particular trigger as unrelated debt.

Smallest proof: a static effective-object comparison that follows the selected writers' DML trigger dependencies and confirms these exact final bodies/columns/checks. Later, under separate SQL authority, compare the valid exact lifecycle exit and an exit lacking its binding against both the migration chain and selected snapshot. No SQL was executed here.

### U03-EX-02 — Verify the native wrapper's local helpers before importing them

Location: frozen `O/U03-contract-review-1-inputs/U03-edge-native-check.mjs:5-6`, `:19-23`, `:39-54`; recipe `U03-controller-gate-recipes.md:64-66`.

The native wrapper statically imports `scripts/test-run-lock.mjs` and `scripts/test-environment.mjs` before reading any input manifest. Its expected-hash set has no required identity for either helper or the coordinator's local dependencies (`scripts/retryable-fs.mjs`, `scripts/sensitive-text.mjs`). The future manifest is specified around the two Edge roots and Deno configuration; it does not require this Node-side execution closure. Even adding those files to that manifest would validate them only after their top-level code had executed.

A frozen Edge source set and unchanged HEAD can therefore coexist with an unstaged helper change, and this wrapper can execute changed discovery/coordinator/environment code before refusing anything. That is a material gap for this worktree's explicit protected-discovery and provider-free execution boundary. It is not a claim that the currently installed helpers are unsafe: the reviewed current helpers are bounded, and the v3 generator already demonstrates the appropriate pre-import pinning pattern.

Smallest correction: remove the two static imports. Before any local dynamic import, verify the exact reviewed helper bytes and immediate local import closure against fixed reviewed hashes, with canonical-path checks that preserve the known dependency arrangement. Then import, acquire the unchanged coordinator, build the subprocess environment, and recheck those identities before recording success. Record these helper hashes alongside the native source/config evidence. Rebind the wrapper and input-manifest hashes after review; do not relax the coordinator or environment contract.

Smallest proof: source inspection confirms all local imports follow identity validation; a separately authorized focused wrapper check with a changed helper must refuse before that helper's top-level code or any Deno child runs. No wrapper or compiler was executed here.

## What the remaining design establishes at source level

- The chosen durable tuple distinguishes job kind and a fresh attempt from worker ID, reserves Node G1 while retaining G0, and requires the atomic G0-to-G1 Fence handoff. Both queues participate under the document lock. Expiry is checked after locking, heartbeat uses the persisted duration, and legacy processing rows are drained rather than assigned invented authority.
- P05's final event writer uses the exact `public_source:` advisory namespace at hardening lines 95-99. Its lifecycle entry points serialize there; the internal make-ineligible helper's artifact-before-job/NOWAIT sequence is not an uncovered cross-order wait against the proposed source/document-first U03 writers. Runtime interleavings remain unproved.
- Domain RPCs are fixed, bounded and explicitly fenced. Summary labels/owned metadata, deep-memory anchors/stamps/aliases, terminal/batch outcomes and caption-cache writes have named owners. No sibling supersession, no missing-RPC fallback, strict response parsing, and service-only entry/internal-helper grant separation are appropriately explicit.
- Shared persistence signatures remain strict. The three independently callable operator scripts receive early non-successful refusal and import-safe actual-entry tests. The archived caller is explicitly compiled; fake Fence/legacy-call escape routes are prohibited.
- Storage has attempt-unique non-overwriting paths, a separately fenced attachment, truthful late-byte limits, and no destructive cleanup after ambiguous publication. Cancellation is monotonic and must escape optional-error catches. The existing deep-memory lost-response rule is preserved.
- Repair planning has bounded exact input, duplicate rejection, deterministic cross-language encoding, and a service-only append audit with no apply capability. A plan digest is expressly not proof of a current snapshot or performed repair.
- The allowlist and four serial increments are concrete and coherent for one U03 range. Required new modules/tests are listed; the six absent TypeScript inputs are planned inputs, not setup errors discovered by a test or invented product RED.

## Verification recipe review

The v3 Next/TypeScript approach is a credible scoped source-health equivalent, subject to actual execution and the reported limits. I inspected the installed Next 16.3.0 route mapper, file matcher/classifier, manifest/declaration writers and relevant type-generation code, plus TypeScript 6.0.3's native compiler host. In particular:

- `createPagesMapping` receives the leading-separator path shape expected by installed discovery; the exact metadata parser branch is guarded. Non-page metadata is excluded by the installed ambient route manifest, and metadata-only parallel slots fail closed. The two required ambient families are emitted by installed framework writers, with the original source config retained.
- Native TypeScript `getSourceFile` reads through the mutable compiler-host reader (`typescript.js:126783-126797,126839-126854`), so the custom safe reader is actually used without dropping the native language/module-format options. The config stays at its original path, preserving default type discovery; diagnostics run without emit.
- The compiler's tracked/explicit virtual repository, protected path rejection, canonical path checks, dependency-root bounds, required archived caller, required generated declarations and end-of-run input checks materially support its stated scope. The result is not a repository-wide or native Edge verdict.
- All 31 pinned configuration/framework/helper inputs currently match their manifest hashes. These are current identity checks, not generation or compilation results. Generated output must still be created and its three exact files present in the compiler program before a pass can be claimed.
- The generator and compiler preserve old attempt evidence using exclusive creation. Ordinary diagnosis of an unexecuted internal API recipe remains necessary if it fails; syntax-only evidence is not runtime compatibility evidence.
- Both staged wrappers call the unchanged imported pure validators on indexed inputs. The migration wrapper includes immutable history and the exact new migration; the module-index wrapper uses tracked groups and indexed schema/index bytes. `update-docs-inventory.mjs --check` uses only tracked `scripts/` names plus the package/index files. These intentionally scoped equivalents must retain their narrower result labels.
- The native Deno closure manifest remains intentionally absent until product freeze. A nonempty `reviewReference` is not review evidence. The complete two-root source/type/dynamic-static-import/config/map/lock closure, unknown config influences, and any new dependency still require real freezing and independent review before the gate. Existing lock/import-map bytes are environment inputs, not an inherited compile pass. Finding U03-EX-02 additionally closes the Node wrapper's own executable-input gap.
- The environment helper explicitly blanks or neutralizes its listed provider keys and applies offline controls while retaining arbitrary unlisted keys. The v3 documentation accurately states this limited scope. Source safety also depends on the reviewed code path avoiding application/config/handler evaluation, not on claiming a complete environment scrub.

## Range, identity and exact frozen inputs

R = `C:/Users/joshs/.codex/worktrees/rag-local-build-20260822/Database`.

O = `C:/Users/joshs/Codex-Handoffs/Ingestion/Execution/20260907-continuation`.

Branch: `codex/rag-local-build-20260822`.

Complete original planning range: `fd043b262ebd9b20315c2e46bc4838265787fa80..481270d8b4267d479bc78d58815b365439f8a2ec` (one candidate commit). All five changed files were included: both new contracts plus the continuation plan, design and RAG handoff amendments. No correction-only range or unchanged future-unit audit was substituted.

Canonical package: `R/docs/superpowers/rag-upgrade/execution-artifacts/rag-answer-quality-and-repository-coverage-v1/continuation-rag-source-ingestion-v1/U03-PREP/U03-contract-review-1.diff`.

Observed package SHA-256: `1d32c81401e22eeabba54b5b5f02bcdd967a4cc43f2c43bd14a9e0c26cdc4c40`.

Observed complete outside manifest SHA-256: `a4d7610d780c7ae44ba9817fea42043e5147767d5d07f1c48efddacee94ecfbe` for `O/U03-contract-review-1-inputs.json`.

All fourteen named frozen-copy hashes were independently checked and matched:

| Frozen input | SHA-256 |
| --- | --- |
| U03-frozen-task-context.md | f19c9a082edf068d9700e09401badfbcd270694abecb4ef8a0c4a6e62d3cdcea |
| U03-frozen-owner-preparation.md | 74bf1c4d4960feaf87787f187f1de474b9680b98b8e8b7594da324a256e78ec7 |
| U03-schema-contract-recommendation.md | adb0735ae327f04a2206a78f2bc2c7ba8a51ce6bded28d89042cdf6065f2da0c |
| U03-operator-compatibility-followup.md | b22168040664b13fb15d4b30f5e68a5fd53db4d1311798caba12f60ca982215a |
| U03-verification-preparation.md | 21abda3f3606389592fe56a71c456e3d595ffd7dfeca361291de84f37713ac0a |
| U03-verification-recipes-v3.md | 89affd9a450e51521b87ddb98d79e8e96274299fc750d37874c237f0400d26c2 |
| U03-generate-next-ambient.mjs | 5e030753100ff2c7fbc51a5893ba751e806f7b5a0a9b80a505a936a68b78caf4 |
| U03-tracked-typecheck-v3.mjs | 76b7d36588738e7db9edd60c146026e1771455315278ed495b07d97386b72879 |
| U03-reviewed-compile-inputs.json | edd5a7bba598532082fe69049cbcf3d3a09d126258f6ee29713e57a5e4d29643 |
| U03-staged-migration-role.mjs | 08f41c5dd10428d8b55b3c2594b566890af71e485a6e9d4f2aca791651128bae |
| U03-staged-index-coverage.mjs | f4b08f35b5f08c02c054e1364dd8cddb860e579321e9ddd8308e041bf6581041 |
| U03-edge-native-check.mjs | 72a9989a3a36a8f89b64487f68b7a1784ce4d40fee81899a7a4ec7cde3408535 |
| U03-controller-gate-recipes.md | 3c3a9736e65b89966e1b30cffd9cd566fd50981e8248665bca4c4cfbceaac9a0 |
| U03-plan-static-preparation.json | e1224decb77a6e4ffaf706fdecad6eaac62e51277bf59d3f9411a0bfdf894389 |

## Own requested and observed route; independence

Requested: fresh independent `gpt-6-astra` / `xhigh`, execution and SQL contract reviewer, role `supabase-schema-guardian`.

Observed directly from selected fields only, using shared-read access to my exact log:

`C:/Users/joshs/.codex/sessions/2026/09/08/rollout-2026-09-08T21-02-01-01a0811c-7550-7980-926d-fdfe2e62bfa7.jsonl`.

- Line 1, `session_meta`: id `01a0811c-7550-7980-926d-fdfe2e62bfa7`; provider `openai`; originator `Codex Desktop`; parent `01a07b47-4623-7e90-825a-ec25116b8531`; agent path `/root/u03_contract_execution_review`; role `supabase-schema-guardian`; launch cwd `D:\Repos\Database`.
- Line 8, `turn_context`: model `gpt-6-astra`; effort `xhigh`; collaboration settings model `gpt-6-astra`, reasoning effort `xhigh`.

All repository commands explicitly selected R. This is observed local resolved configuration, not backend attestation. No missing telemetry was inferred from launch arguments or another child. This reviewer did not author the contracts/recipes, did not participate in their preparation, and did not read the other independent specialist's verdict. Preparation authors' source recommendations were inputs, not acceptance evidence. No recursive agents or other-task messages were used.

## Checks and residual gates

Performed: read-only Git/source/installed-dependency inspection; exact package/manifest/frozen-copy and 31 pin hash checks; selected own-route metadata inspection. Final HEAD remained `481270d8b4267d479bc78d58815b365439f8a2ec`; `git status --short --untracked-files=no` remained empty before this outside report write. No protected `1/` or unrelated untracked file enumeration/read was used. Root instructions and canonical execution/authority/original Task 3/global constraints were consulted. The missing extracted review-throttling file was resolved to this checkout's embedded root rules.

Not run: tests, arbiter, ledger tooling, generator, compiler, staged validators, SQL, provider/network operations, worker/handler/server/native-document operations, installs, commits or publication. Existing reports supply syntax-only outcomes for the two v3 scripts and three controller wrappers; none establishes executable recipe or product success. Controller owns ledger recording and integration. This report is the only write.

Before U03 source acceptance: correct the two findings and review the full amended original range with updated package/input hashes; execute the approved scoped RED/GREEN and source-compilation/static/parity gates after implementation; obtain the required fresh all-writer/SQL/clinical reviews. The future Deno closure must actually be frozen and reviewed before execution. U03 remains unstarted here.

Separately gated and unproved: disposable SQL replay/roles/privileges/concurrency/rollback schedules, deployed grants, real Storage cancellation/orphan behavior, provider/native egress, real or native synthetic document extraction, clinical adjudication, workers, source acquisition, activation, hosted/provider parity, C07 production readiness, deployment/publication and ordinary Answer acceptance. Source acceptance is not concurrency or deployment proof.

Historical U02 offline evaluation remains exit 1, four failed suites, 45 failed and 586 passed overall; it is not green and is not inherited by U03. The current fd043 checkpoint and its accepted U02 correction remain unchanged.