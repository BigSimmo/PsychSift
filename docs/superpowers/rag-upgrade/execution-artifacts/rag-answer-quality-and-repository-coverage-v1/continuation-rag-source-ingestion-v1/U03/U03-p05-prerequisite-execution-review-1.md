# U03 P05 prerequisite amendment — independent execution review 1

Specification: **PASS**

Quality: **PASS**

No Critical or Important blocker found in this exact prerequisite amendment. This is independent pre-implementation review of the frozen amendment, not acceptance of the moving U03 product, SQL execution, installed privileges, deployment, or final U03 source. The controller may admit the named dependent edits under the existing sole-writer process; the final original-range product review and gates remain required.

## Identity, scope and independence

- Repository: `C:/Users/joshs/.codex/worktrees/rag-local-build-20260822/Database`.
- Branch: `codex/rag-local-build-20260822`.
- Original U03 TASK_BASE: `8c11f138e6c683a13db3b465332e7f3cbb515c62`; observed HEAD at review entry was this same commit. It is not reset by this amendment. Concurrent tracked U03 edits were visible through `git status --untracked-files=no`; their contents were not reviewed.
- Original contract: `docs/superpowers/rag-upgrade/continuations/rag-source-ingestion-continuation-v1/U03-execution-contract.md`, read through immutable `git show TASK_BASE:<path>`, raw blob SHA256 `9e5d0cabdec45e4b719c63ccc0ffa5831383fb85c03af8c441af0dec5130eca7`.
- Review scope is that original contract plus the seven exact frozen amendment/evidence files below. There is no new product end commit or product diff acceptance. Removing the single named prerequisite subsection from the complete candidate reproduces the original contract exactly after line-ending normalization. Original scope, serial increments, acceptance recipes and prior review history are preserved.
- Reused the applicable planning-review instructions and unchanged inspection context. Independently inspected the candidate SQL, immutable migration owners and source consumers. The preparation comparison and inventory were treated as evidence to check, not an independent acceptance verdict. I did not read the clinical specialist's review as proof. I did not author or integrate this amendment or its product changes. Prior review-1 FAIL and review-2 PASS reports were not changed.

## Frozen input binding

Outside directory: `C:/Users/joshs/Codex-Handoffs/Ingestion/Execution/20260907-continuation`.

Manifest `U03-p05-prerequisite-amendment-inputs-1.json`: SHA256 `9cd5b29e3860f2432b33c0e347f69ff0a83baedbedf65fe83276989c13a8a0dd`.

All seven files were inspected and their raw hashes rechecked immediately before this report was created.

| Input | Raw SHA256 |
| --- | --- |
| `U03-p05-prerequisite-amendment-1.md` | `2b1fb50f4d78cb558148ee6d93fd8a09e4cf6a2aeb057882de3ba06905540943` |
| `U03-frozen-p05-prerequisite-comparison-1.md` | `e070a47a0ff29d2c4a6643c12fdc01f73f8f91f0f694ffc51306717fa7a3bbb0` |
| `U03-frozen-p05-prerequisite-inventory-1.json` | `d26029cd84b9bbf9677425b1234aa3adb4043a436c74177035a8fe7fa7332168` |
| `U03-p05-acl-dependency-inventory-1.md` | `79e89d96f673ea55d731e81c4428c5c63185bdbf1272ee5bc4537bec7644c72c` |
| `U03-p05-closure-addition-1.sql.txt` | `f0a4d9fbf17e62d6d65326f2ec952cd7ee9233fca3317a0647ae9ac98e5a96ee` |
| `U03-p05-acl-correction-1.sql.txt` | `e7783ab81851a9f1c035781fff8609031aeebaee9ba3a6cc7abb6400ae39205d` |
| `U03-execution-contract-prerequisite-candidate-1.md` | `877594a62de02ef3391ae0c9ca7594b827e768d8b0603eef3adfba0530dc2939` |

All 18 immutable migration-source raw hashes listed in the inventory matched bytes obtained directly with `git show TASK_BASE:<path>`. The inventory's frozen pause snapshot is historical preparation, not the current moving snapshot or a final product binding.

## Findings and disposition

### Specification — PASS

The named amendment resolves the additional dependency and ACL distinctions without weakening the original contract. Candidate lines 151–155 specify exactly four final function definitions, nine constraint triggers and the missing explicit revocations. Candidate lines 157–163 and amendment lines 24–45 confine the new effective ACL correction, retain the governed entrypoints, require final rebinding, and keep SQL behavior separate from static source proof. The writer gains only the named governing-document adoption in addition to the existing U03 product scope (amendment line 32). No global defaults, role/owner change, unrelated API import or historical backfill is proposed.

### Quality — PASS

**Exact final dependency closure.** Closure candidate lines 3–51 reproduce the final approval INSERT guard from immutable `20260822123000_govern_australian_source_activation.sql:29–77`, including the document lock, v2 Australian evidence tuple, exact committed generation/source-policy match and current/indexable checks. Lines 53–106 reproduce the final eligibility predicate and two constraint-trigger functions from immutable `20260824123000_harden_public_source_lifecycle_authority.sql:603–646,699–707`. All four complete CREATE statements matched the immutable source exactly after line-ending normalization, not just by name or signature.

All nine bindings at closure lines 108–127 likewise matched their immutable final CREATE statements: the document constraint trigger at consolidation lines 374–377 and the eight artifact constraints at hardening lines 710–724. AFTER INSERT OR UPDATE, per-row, DEFERRABLE INITIALLY IMMEDIATE semantics remain intact. Their document/version/approval relations and owner/generation/approval fields are already in the selected prerequisite closure; this does not require importing the omitted fetch/staging/activation/tombstone/serving APIs. Existing publication and approval trigger bindings must be retained, as explicitly required by amendment lines 35,41 and candidate lines 153,163.

**ACL correction is necessary and bounded.** Immutable `20260719055609_repair_postgres_default_privileges.sql:126–143` confirms that the encoded postgres defaults grant service_role table SELECT/INSERT/UPDATE/DELETE and function EXECUTE. The old P05 additive SELECT grants and revocations from other principals do not remove those service-role privileges. The candidate accurately identifies the established inherited CRUD defect without asserting that TRUNCATE/REFERENCES/TRIGGER were also observed grants.

ACL candidate lines 4–9 reset only the three named P05 tables and restore SELECT. Lines 12–22 revoke only the eleven exact internal-function signatures. The block neither revokes any of the eight existing governed entrypoint signatures nor changes defaults/roles/owners. Closure lines 130–135 restore the named PUBLIC/anon/authenticated declarations independently of the new service-role correction. Retaining the read-only `public_source_serving_authority_stamp()` is deliberate; its grant is at immutable consolidation line 753, and its SECURITY DEFINER SELECT body is at lines 316–326. The other seven effective entrypoint grants are at hardening lines 740–746; the obsolete seven-argument transition remains dropped.

**Retained source-call compatibility.** An independent immutable named-reference search across `src`, `scripts`, `supabase/functions` and `worker` found no selected-table direct mutation or application call of a revoked internal helper. The direct `public_source_versions` call at `scripts/fetch-approved-public-source-versions.ts:198–203` is SELECT and remains allowed. The stamp calls at `src/lib/rag/rag-cache.ts:638,689` remain allowed. Type declarations are not runtime consumers. Privileged SQL entrypoints continue to reach their internal functions under their definition owners; invoker trigger functions are not assumed to be SECURITY DEFINER. Candidate line 159 explicitly forbids new U03 direct service-role helper RPCs and requires postgres-owned U03 SECURITY DEFINER callers. Final U03 source adoption remains to be checked after its freeze. No claim is made about arbitrary external/manual clients or runtime-computed names.

**Execution order and scope.** The four function replacements and nine absent snapshot bindings belong only in the snapshot; the historical chain already contains them. The corrective ACL block belongs in both the new U03 migration and final snapshot after the selected objects exist. Amendment lines 34–37 require that order, preserve existing bindings, prohibit historical-migration changes and backfill/trigger-disable operations, and require checking for later grants that would undo the correction. Thus there is no need for a second writer, a new base, wider schema regeneration, or an extra operational recipe. Exact lifecycle exit re-owns affected rows, so the restored public-owner constraint conditions do not introduce a new source-level lock-order requirement; actual positive/negative SQL schedules remain unproved.

## Required follow-up and residual acceptance gates

1. After controller admission, the sole writer must adopt the hash-bound candidate and only its named changes. Rebind the final selected object bodies/signatures, all nine new constraint bindings, existing approval/publication bindings, eleven internal ACLs and three table ACL end states. Check all eight entrypoint grants remain and no later grant restores unwanted access. Inspect final U03 calls rather than assuming the immutable pre-U03 caller inventory covers them.
2. Complete the original focused U03 source/SQL contracts and the unchanged reviewed compiler, staged migration-role, inventory and native Edge recipes when their governing prerequisites are satisfied. Missing future/native closure inputs remain gates. This review executes none of those recipes and gives no runtime/compiler/test result.
3. Separate authorized SQL acceptance must establish actual object owners, role membership/inheritance, grants from all relevant grantors and effective privileges; denied direct table mutations/internal calls; retained SELECT and governed entrypoint behavior; trigger creation/invocation behavior; v2 approval refusal; document/artifact exact active-version refusal; and valid lifecycle exit versus missing exact exit binding. Compare applicable migration-chain and selected-snapshot behavior. Expected postgres ownership is not an observed installed-owner fact; an owner or inherited privilege can defeat the intended restriction. Existing extension/bootstrap dependencies, including `extensions.digest`, remain environment prerequisites.
4. Freeze and independently review the complete U03 product from the unchanged TASK_BASE through all corrections. This prerequisite amendment is not concurrency proof, full snapshot/API parity, deployment readiness, clinical acceptance, ordinary Answer acceptance, or completion of C01. Provider/hosted access, native/real documents, SQL execution, workers/activation/publication, repair application and production readiness remain separately gated and unrun. The historical U02 eval remains exit 1, four failed suites, 45 failed and 586 passed overall; it is not green or inherited U03 acceptance.

No tests, compiler/generator/gate, SQL, provider/network, worker/server/operator, ledger or commit command ran in this review. Only frozen/local/immutable reads, read-only in-memory comparisons and the creation of this outside report were performed. No protected `1/` or unrelated untracked file was enumerated/read. No moving product content was read.

## Requested and observed reviewer route

Requested: independent Astra / xhigh execution-and-quality review, reusing this review agent.

Observed selected local route: model `gpt-6-astra`, effort `xhigh`; collaboration settings also select `gpt-6-astra` / `xhigh`. Provider is `openai`. This is local route configuration, not backend attestation.

- Exact own session: `01a0811c-7550-7980-926d-fdfe2e62bfa7`.
- Parent session: `01a07b47-4623-7e90-825a-ec25116b8531`.
- Agent path: `/root/u03_contract_execution_review`.
- Agent role: `supabase-schema-guardian`.
- Exact own log: `C:/Users/joshs/.codex/sessions/2026/09/08/rollout-2026-09-08T21-02-01-01a0811c-7550-7980-926d-fdfe2e62bfa7.jsonl`.
- Evidence: selected `session_meta` fields at line 1 and current selected `turn_context` fields at lines 275 and 291, read with shared read/write access. Earlier review route fields at lines 8 and 231 were consistent. No model/effort was inferred from the launch request, another agent, or unavailable telemetry.
