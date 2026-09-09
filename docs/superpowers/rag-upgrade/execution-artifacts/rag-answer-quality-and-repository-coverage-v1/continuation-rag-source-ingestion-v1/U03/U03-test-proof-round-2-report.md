# U03 test-proof correction round 2

U03-WR-01 corrected in exactly two tests: capture `actualOptions?.signal` and use `.toBe(controller.signal)` at the actual caption SDK-options boundary and actual model-index generation-options boundary. No production, mocks, defaults, other assertions or other source changed. The diagnosed issue was structural matching admitting a distinct object; current production was already correct, so no product RED or mutation experiment is claimed.

Original TASK_BASE remains 8c11f138e6c683a13db3b465332e7f3cbb515c62. HEAD remains 57ba6d6fc2505f03a1ee0df82b186bccd0a455c2, branch codex/rag-local-build-20260822. No staging/commit/reset. Freeze7 has all 41 current product hashes; exactly the two allowed test hashes differ from freeze6, and the other 39 match.

- `node node_modules/prettier/bin/prettier.cjs --write tests/openai-cache.test.ts tests/model-index-extraction.test.ts`: exit 0, both unchanged by formatter.
- `node node_modules/prettier/bin/prettier.cjs --check tests/openai-cache.test.ts tests/model-index-extraction.test.ts`: exit 0.
- `npm run arbiter -- test`: exit 0, actual **RUN — GATE_ARBITER is off**.
- `node scripts/run-vitest.mjs run tests/openai-cache.test.ts tests/model-index-extraction.test.ts`: exactly one run; exit 0, **29 passed, 0 failed, 0 skipped, 2 files**.

Input preflight used scoped PowerShell ErrorActionPreference Stop and required every named file, including actual tracked `vitest.config.mts`, before executing tests. All 12 recorded input hashes were rechecked unchanged after the run. Receipts/arbiter were process-local off, restored in finally together with ErrorActionPreference. Coordinator remained enabled. No test/compiler/Edge/SQL-role/inventory/P04/other gate rerun; no providers, native processing or operations.

Exact diff:

```diff
diff --git a/tests/model-index-extraction.test.ts b/tests/model-index-extraction.test.ts
index 6aaf676866..c5c7d1d0b5 100644
--- a/tests/model-index-extraction.test.ts
+++ b/tests/model-index-extraction.test.ts
@@ -134,7 +134,7 @@ describe("review correction: actual model-index cancellation wrapper", () => {
     mocks.generateStructuredTextResponse.mockResolvedValueOnce(empty);
     const controller = new AbortController();
     await generateModelIndexProfile({ ...args, signal: controller.signal });
-    expect(mocks.generateStructuredTextResponse.mock.calls[0]?.[2]).toMatchObject({ signal: controller.signal });
+    expect(mocks.generateStructuredTextResponse.mock.calls[0]?.[2]?.signal).toBe(controller.signal);
   });
   it.each([true, false])("refuses pre-aborted work before model invocation, empty=%s", async (isEmpty) => {
     mocks.generateStructuredTextResponse.mockResolvedValue(empty);
diff --git a/tests/openai-cache.test.ts b/tests/openai-cache.test.ts
index 3404f7357f..ef8381c156 100644
--- a/tests/openai-cache.test.ts
+++ b/tests/openai-cache.test.ts
@@ -812,7 +812,7 @@ describe("review correction: actual caption cancellation wrapper", () => {
     const { classifyAndCaptionImageFromBase64 } = await import("../src/lib/openai");
     const controller = new AbortController();
     await classifyAndCaptionImageFromBase64({ base64: "ZmFrZQ==", mimeType: "image/png", signal: controller.signal });
-    expect(create.mock.calls[0]?.[1]).toMatchObject({ signal: controller.signal });
+    expect(create.mock.calls[0]?.[1]?.signal).toBe(controller.signal);
   });
   it("refuses pre-aborted work before SDK invocation", async () => {
     const create = vi.fn(() => ({ withResponse: async () => success() }));
```

| Changed test | Freeze6 SHA-256 | Freeze7 SHA-256 |
| --- | --- | --- |
| tests/model-index-extraction.test.ts | 448686b87165b8f55cd93b837961322fb22fb084905be635444d0f7823005757 | 93fff787e4e025f8576d13263a3fe2aba1b7fea4e32e47c738c5d6536a196a2a |
| tests/openai-cache.test.ts | 7a81176ac9714585122cc855160b3e7dd2b15767c6984f1d07a5f21ee270ea26 | 24d77864efa8ddfab58d9a7f73400058559313a26371a0142bb340cf1af1cb5b |

| Artifact in O | SHA-256 |
| --- | --- |
| U03-test-proof-round-2.log | 58bdffee9725256c20562076d7b5416e9986ed497b530193af102afcc50e8982 |
| U03-test-proof-round-2-inputs.json | 94b0118f656f0238b6a1a36f53d44b57b893be73ea8d4770f55c3dedb78159f0 |
| U03-test-proof-round-2-result.json | 58ab6b98cd7ab5c34d741ed8e78fc2ad780160ed433516ba7728cf14d6ad054f |
| U03-test-proof-round-2-arbiter.log | 9bc48e30183638e66b923e8551f046ae9ae5729e1766be32440eb2f1b6b63b0b |
| U03-test-proof-round-2-format.log | 0713a8c29bf68ecfb96d81870b657931bd1e326c68daf2468b96b12fac6b020b |
| U03-test-proof-round-2-format-check.log | f20510a9da4717c51c4cffee6d0dd88d6c9a723d0a83711d01216f5b48961283 |
| U03-test-proof-round-2.diff | 9cf5cb870f9689c28f96e734a830946c72227c8472d5f731709d9b6d3a417dfc |
| U03-implementation-freeze-7.json | df84e179232a4c0408b742bbac2822c206679f9d70e364d32a82780894d930c2 |

Own selected current session route: `01a08132-76f2-7161-a28c-07d907a472f4`, `gpt-6-astra`, effort `high`. Only own selected identity/model/effort fields were observed from the existing own session log; this is local configuration, not backend attestation. No child agents. All source is frozen and no writer process/check remains. Controller owns candidate creation, corrected-head independent review and acceptance. Prior failures/reviews/freezes are retained. Historical U02 and SQL/runtime/provider/native/clinical limits remain unchanged; no U03/C01 acceptance claim.
