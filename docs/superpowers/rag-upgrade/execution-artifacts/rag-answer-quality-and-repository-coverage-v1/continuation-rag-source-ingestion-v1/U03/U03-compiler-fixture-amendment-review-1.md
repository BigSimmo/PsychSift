# U03 compiler fixture amendment 1 — independent review

Specification: **PASS**

Quality: **PASS**

No Critical or Important blocker found. Admit only the exact additional test candidate under the existing sole-writer/controller process. This is a bounded scope amendment supplementing original U03 TASK_BASE `8c11f138e6c683a13db3b465332e7f3cbb515c62`, not final product acceptance or a compiler/test pass.

## Exact input binding

All outside files below are under `C:/Users/joshs/Codex-Handoffs/Ingestion/Execution/20260907-continuation`. Their raw SHA256 values were verified on read and again immediately before this report was created.

| Input | SHA256 |
| --- | --- |
| `U03-compiler-fixture-amendment-1.md` | `9b234ad1736799e5e8f849159cc59b0f6998f44807ba03ca97037d7bb8a2f890` |
| `U03-clinical-summary-fixture-candidate-1.ts.txt` | `5bda65ee6ab49b2a2f4b6cb773e77fccd775d88aee4732d63286e605b49841a6` |
| `U03-clinical-summary-fixture-diff-1.patch` | `db89cda88ec649500357fbc5062c58d72e8fbb82ddad66fd3a24d95575456dd6` |
| `U03-compiler-diagnostic-source-baseline-1.json` | `51c151efeeb4621d267b4d5f2c5f68aa20081484eb8d973cb2fb891db1bd0130` |

The source-baseline record's three raw baseline hashes were independently checked against immutable `git show TASK_BASE:<path>` bytes:

- `tests/document-clinical-summary.test.ts`: `edf8aa024045ee258b91421781adb5fbb78dc6802b8a5370f9262cc4c2645320`.
- `src/lib/types.ts`: `bf59aac7d2841ac8902d636c87d08fee18e5f480a91710b5cbdab50457aa958b`.
- `supabase/functions/_shared/source-anchored-summary.ts`: `a2fdb6b4f4dd6e7f3a692c822a2a9c99439d1db2c4a58a664f42cd8f253e97f2`.

Applying the pinned two-hunk diff to the immutable original fixture in memory reproduced the entire candidate exactly after line-ending normalization. No repository patch was applied. The current-source/function comparisons recorded in the baseline artifact remain frozen preparation evidence; moving files were not reread or independently rebound here. This is source comparison, not a baseline compiler run. The amendment's reported compiler failure is retained, not reclassified as passed by this review.

## Review rationale

**Scope and specification.** Amendment lines 3,7,11 add exactly `tests/document-clinical-summary.test.ts` to the existing U03 write scope and retain controller admission, one writer, preserved evidence and final review over the original range. They do not authorize production UI, types, validation or normalizer edits. The candidate contains only the two stated changes, with no import, runtime owner, compiler-root or compiler-option expansion.

**Same malformed input and assertions.** Candidate lines 115–123 keep the exact text/pages-only item, the same empty escalation/action groups and the same other profile defaults. Spreading the unchanged `profile(...)` result and overriding `thresholds_timing` produces the same persisted profile values as the original override passed into `profile(...)`; neither helper has a side effect dependent on that placement. Candidate lines 126–128 preserve all three relevant assertions: one priority, null support and `sourceBacked === false`. Every other test and assertion is unchanged.

**Honest test boundary, without production type weakening.** Candidate lines 37–50 change the test-only raw-document helper parameter to `unknown`. Its pre-existing outer `ClinicalDocument` fixture assertion remains the adapter for deliberately malformed persisted data. The patch removes the incorrect assertion that a text/pages-only object itself satisfies `DocumentSummaryProfileItem`; it does not add `any`, a double cast, a suppression directive or an exclusion. The valid `item(...)` and `profile(...)` builders at lines 5–35 remain typed against the production interfaces.

At immutable TASK_BASE, `src/lib/types.ts:914–941` still declares the validated summary profile, and `supabase/functions/_shared/source-anchored-summary.ts:15–35` still requires source identifiers, evidence type and support on each validated item. None of those requirements is relaxed. The existing consumer's `verifiedSupport` at `src/components/document-viewer/document-clinical-summary.tsx:89–94` returns null for missing supported evidence, which is the behavior the unchanged malformed-fixture assertions protect. The permissive test boundary itself is not claimed to validate JSON; runtime handling remains the subject of the test.

**Focused verification is proportionate.** Amendment line 9 requires the existing provider-free coordinator wrapper, `node scripts/run-vitest.mjs run tests/document-clinical-summary.test.ts`, optionally combined with the smallest affected compiler-correction tests. It retains arbiter consultation, disabled/restored receipts and arbiter environment controls, raw outcomes and frozen hashes. Rerunning the unchanged reviewed tracked compiler once after all corrections with a unique `--attempt=correction-1` is justified by the failed compiler result and changed inputs. No browser/server, production UI gate, broad baseline, provider, SQL or new compiler wrapper is introduced.

## Required follow-up and limits

- After controller admission, the sole implementer must adopt this exact candidate and preserve production type/UI/normalizer boundaries. The controller's final freeze must bind this additional file with the rest of U03 and retain the original TASK_BASE and earlier failed results.
- Run and preserve the focused suite's actual exit/count/log and the reviewed compiler correction attempt. Source reasoning here is not an executed behavioral or compiler result and does not promise that this one correction resolves the other diagnostics.
- Fresh final U03 specialists must assess the complete original product range including this fixture and its result. This amendment supplies no SQL, native-document, hosted/provider, concurrency, deployment or final U03 acceptance. Historical U02 remains exit 1, four failed suites, 45 failed and 586 passed overall; it is not a passed or inherited exception.

This independent review used only the named outside inputs, immutable Git source and selected own route metadata. No moving product source, protected `1/` or unrelated untracked file was read. No tests, compiler, SQL, providers/network, worker/server, gates, ledger or commits ran. No recursive agent was started. This outside report is the sole write; previous reviews remain unchanged.

## Requested and observed own route

Requested: the existing independent Astra/xhigh review route.

Observed selected local model: `gpt-6-astra`; effort: `xhigh`; collaboration settings also select `gpt-6-astra` / `xhigh`; provider: `openai`. This records selected local configuration, not backend attestation.

- Session: `01a0811c-7550-7980-926d-fdfe2e62bfa7`.
- Parent: `01a07b47-4623-7e90-825a-ec25116b8531`.
- Agent path: `/root/u03_contract_execution_review`; role: `supabase-schema-guardian`.
- Exact own log: `C:/Users/joshs/.codex/sessions/2026/09/08/rollout-2026-09-08T21-02-01-01a0811c-7550-7980-926d-fdfe2e62bfa7.jsonl`.
- Selected evidence: `session_meta` line 1 and the current `turn_context` line 373, read using shared read/write access. The route was not inferred from the requested launch settings or another agent. I did not author the fixture amendment or consult another specialist's verdict as proof.
