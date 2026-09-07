# U02 audit correction local acceptance

Status: ACCEPTED at the bounded local product/static boundary. Independent ingestion and clinical reviewers both returned Specification PASS and Quality PASS, with no Critical or Important findings. This record does not accept C01 or the whole programme.

The narrow ING-F02 correction makes multi-item source-anchored summaries use the same canonical aggregate whitespace as their validator. It preserves exact projection equality, individual item validation, existing limits, generation/anchor membership, independent model authority, provisional fallback and U02 metadata ownership. The product changes only the shared projector and its actual-producer regression tests.

Immutable corrective range: `ae500cafc661d9a06536d09d73d827726f057ffa..876cb09405d81d9c4a8a4931b3d735fd252934ba`. The range contains one product commit, `876cb09405d81d9c4a8a4931b3d735fd252934ba`. The canonical full-range package is `U02-audit-correction-review-1.diff`, SHA256 `d56e5a23c0c9b4c6c1a16f8f34eb817cff18edef931413353156119c58b2a628`.

## Focused verification

Actual RED and identical GREEN command:

```text
node scripts/run-vitest.mjs run tests/document-enrichment.test.ts -t "round-trips multi-item source-anchored summaries from the real producer"
```

RED exited 1: one failed and 28 skipped tests. The real producer failed with `source_anchored_summary_generation_failed` and underlying `source_anchored_summary_profile_overview_invalid`. Two subsequent GREEN attempts exited 1 before Vitest because the coordinator had no capacity; both remain recorded environment failures. The successful GREEN exited 0: one passed and 32 skipped tests.

Final affected selector:

```text
node scripts/run-vitest.mjs run tests/indexing-v3-agent.test.ts tests/document-enrichment.test.ts tests/worker-shadow-extraction.test.ts tests/check-indexing-contract.test.ts
```

Exit 0: four files passed, **103/103 tests passed**. Coverage includes real provider-shaped response through adapter, projector, validator and persistence mock for one, two and eight items; Unicode boundaries at 600/601 JavaScript UTF-16 string units; and invalid aggregate, item, nested anchor/generation and shape rejection. Product bytes did not change after these successful checks. The final selector was not repeated for review.

Process-local `GATE_RECEIPTS=off` and `GATE_ARBITER=off` prevented protected-untracked bookkeeping and forced actual execution. The arbiter reported RUN/off. Coordinator and the offline test environment remained in force; prior settings were restored. This is fresh focused evidence, not a reused receipt or a full-suite verdict.

## Edge compatibility evidence

The **native Edge type-check equivalent using a reviewed composite of existing locked dependencies** passed with Deno 2.9.4 / TypeScript 6.0.3 under the existing exclusive coordinator:

```text
deno check --frozen --node-modules-dir=false --lock=C:/Users/joshs/Codex-Handoffs/Ingestion/Execution/20260907-continuation/U02-edge-native-composite-v2.deno.lock --import-map=C:/Users/joshs/Codex-Handoffs/Ingestion/Execution/20260907-continuation/U02-edge-native.importmap.json supabase/functions/indexing-v3-agent/index.ts supabase/functions/site-content-sync/index.ts
```

`DENO_NO_PACKAGE_JSON=1` was process-local and restored. Both required function roots were checked; exit 0; the exclusive lease was released; before/after identities matched. The outside map resolves only `entities` and `entities/decode` through native `npm:entities@8.0.0` exports. The composite preserves existing Deno dependency identities and adds only that existing npm-lock version/integrity; its canonical key ordering and omitted automatic root-package discovery metadata were independently reviewed. No new package version, declaration substitution, suppression, unfrozen solver or repository dependency/configuration change was used.

The original frozen-lock attempt failed on app-package discovery; the direct declaration-map attempt failed TS2749; the first native composite failed on lock metadata/order. These remain failed evidence. The literal `npm run check:edge:functions` wrapper was not run or fixed. This passing equivalent does not establish runtime, deployment/bundler or provider parity. No download event was observed; network-free execution is not claimed.

Effective outside lock SHA256: `6e5122daa4915ca299551e5f67251e910f38168a3f3ff02c8b67e693388bb6c6`. Native map: `be863301cacda4921a9bc2bedaba51b4caf907bfe80e8c7c216a6be98a6d6d93`. Repository `deno.lock` remains `b92c0d1c752f6d48da195ef062e473dfaca35f13e5cc692f8f95b92bed3881b9`; `package-lock.json` remains `f969c2ddd1b058437b09eb61bf16b9ecc3bfb6ebb74539ec8e62ccdd7090e063`.

## Finding and programme disposition

- ING-F02: locally corrected and independently accepted at the stated boundary. F14 gains this packet's actual-producer regression proof; the whole acceptance/fidelity finding is not closed.
- Structural validity and source membership do not prove semantic entailment, clinically correct interpretation, extraction fidelity or detailed Answer usefulness. Those adopted requirements remain with U09/U12, source-governance and the separate RAG task owners.
- Original U02 accepted product `6adb834e48b3c1af4579ef22738d942803ab6893` and its earlier acceptance artifacts remain historical and unchanged. Its offline evaluation was **exit 1, four failed suites, 45 failed and 586 passed tests overall**. It is not green and its exception is not inherited by this correction or future units. Omitting that unchanged Answer/search baseline is bounded gate selection, not renewal of the exception.
- C00 remains complete; C01 remains incomplete. U01/U02 historical acceptance and P00–P07 foundations are retained. U03 remains unstarted. P08A stays superseded and the retrieval kernel remains default-off.
- Next local dependency is the shared-contract freeze and reviewed U03 owner/verification brief, including enrichment/deep-memory persistence and attempt fencing. Existing continuation authority permits that preparation and serial successors without another routine permission request.
- No providers, real documents, native extraction, SQL execution, migrations applied, ingestion worker operations, activation, deployment, publication or other-task messaging were performed. SQL concurrency, hosted/provider, native fidelity and clinical/ordinary Answer acceptance remain separate gates. Broad tests and production-readiness were not run under the bounded local authority.

## Durable evidence and routing

The final JSON acceptance record binds the product range, both verdicts, observed local session routes, the launch/dispatch evidence, and each canonical artifact hash. Outside originals remain saved. Committed evidence copies normalize CRLF to LF only; raw outside hashes and canonical copy hashes are separate. Raw logs and immutable review packages are preserved, not reformatted to erase failed attempts or change their identity.

The writer's observed local route is `gpt-6-astra/high`, session `01a07b98-2191-7b60-87a3-237ccc09336f`. Requested settings and selected local session metadata are recorded separately; local resolved configuration is not backend execution attestation. The already accepted planning review used two independent observed `gpt-6-astra/xhigh` reviewers.

Before the evidence commit, verify the exact staged artifact allowlist and staged-blob hashes, preserve the product range and historical artifacts, and append current progress. The scoped `SKIP_DOCS_SYNC_HOOK=1` local commit bridge avoids protected-untracked enumeration and is restored immediately. It grants no publication or test bypass.

Independent reports: [ingestion review](U02-audit-correction-ingestion-review-1.md) and [clinical review](U02-audit-correction-clinical-review-1.md). Machine-readable bindings: [acceptance record](U02-audit-correction-acceptance.json).
