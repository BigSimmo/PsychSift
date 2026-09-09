# U03 P05 prerequisite amendment: clinical and governance review 1

Date: 9 September 2026.

Specification PASS.

Quality PASS.

No Critical or Important blocker was found for adopting the exact frozen prerequisite amendment. No correction is requested by this independent specialist review. These verdicts permit the controller to integrate this bounded source/documentation amendment through the existing sole writer; they are not final U03 product acceptance, a runtime privilege verdict, clinical acceptance or permission to execute SQL or a governed operation.

## Review identity and exact frozen inputs

Original U03 TASK_BASE remains `8c11f138e6c683a13db3b465332e7f3cbb515c62` in `C:/Users/joshs/.codex/worktrees/rag-local-build-20260822/Database`. The original contract and migration owner reads used immutable `git show` at that base only. I did not inspect current working product files, current HEAD, the active writer's edits or another specialist's verdict.

Outside directory `O = C:/Users/joshs/Codex-Handoffs/Ingestion/Execution/20260907-continuation`.

The supplied manifest `O/U03-p05-prerequisite-amendment-inputs-1.json` independently hashes to `9cd5b29e3860f2432b33c0e347f69ff0a83baedbedf65fe83276989c13a8a0dd`. Every listed file matched its manifest SHA-256:

| Frozen input under O | Verified SHA-256 |
| --- | --- |
| `U03-p05-prerequisite-amendment-1.md` | `2b1fb50f4d78cb558148ee6d93fd8a09e4cf6a2aeb057882de3ba06905540943` |
| `U03-frozen-p05-prerequisite-comparison-1.md` | `e070a47a0ff29d2c4a6643c12fdc01f73f8f91f0f694ffc51306717fa7a3bbb0` |
| `U03-frozen-p05-prerequisite-inventory-1.json` | `d26029cd84b9bbf9677425b1234aa3adb4043a436c74177035a8fe7fa7332168` |
| `U03-p05-acl-dependency-inventory-1.md` | `79e89d96f673ea55d731e81c4428c5c63185bdbf1272ee5bc4537bec7644c72c` |
| `U03-p05-closure-addition-1.sql.txt` | `f0a4d9fbf17e62d6d65326f2ec952cd7ee9233fca3317a0647ae9ac98e5a96ee` |
| `U03-p05-acl-correction-1.sql.txt` | `e7783ab81851a9f1c035781fff8609031aeebaee9ba3a6cc7abb6400ae39205d` |
| `U03-execution-contract-prerequisite-candidate-1.md` | `877594a62de02ef3391ae0c9ca7594b827e768d8b0603eef3adfba0530dc2939` |

I retained my accepted planning-review context and reviewed the complete amendment, its concrete SQL, the governing-contract candidate and the relevant frozen inventory evidence. The governing candidate is exactly the original 205-line TASK_BASE contract plus its 16-line prerequisite subsection at lines 149-164. Removing only that subsection produces the original contract line-for-line. No unchanged future-unit review or historical audit was restarted. Earlier review reports remain preserved.

## Findings and independent assessment

No blocking findings.

### 1. The restored dependency scope protects the existing source-authority contract

`O/U03-p05-closure-addition-1.sql.txt:3-51` restores the exact final approval-insert guard. It requires the Australian source/policy/generation tuple, checks that tuple against the locked document, and refuses non-indexable, non-current or superseded source metadata. The older snapshot body embedded in the frozen JSON inventory checks only non-null reviewed-state digest. The all-null/all-present column constraint alone cannot replace this source-specific check.

I independently compared the complete proposed function statement with `supabase/migrations/20260822123000_govern_australian_source_activation.sql:29-77` at TASK_BASE; it is exact. The candidate retains the existing approval INSERT trigger and final publication-transition guard instead of substituting one for the other. Publication approval remains policy/publication authority, not semantic verification or a newly appointed clinical reviewer.

`O/U03-p05-closure-addition-1.sql.txt:53-127` restores the exact eligibility predicate, two constraint-trigger helpers and nine bindings. Complete statements matched immutable owners:

- `public_source_document_is_serving_eligible(uuid)`: hardening migration `20260824123000_harden_public_source_lifecycle_authority.sql:603-633`.
- Document helper: the same migration :635-646.
- Artifact helper: the same migration :699-707.
- Document binding: consolidation migration `20260824120000_consolidate_public_source_lifecycle_authority.sql:374-377`.
- Eight artifact bindings: hardening migration :710,712,714,716,718,720,722,724.

These preserve AFTER INSERT OR UPDATE, DEFERRABLE INITIALLY IMMEDIATE, per-row semantics. The predicate binds active version, staging document, approval, policy, generation, owner and publication identity. Its serving-oriented name does not add a new retrieval API: it is the selected DML-trigger dependency. The candidate contains no historical data backfill, trigger-disable sequence, new source activation mechanism or kernel activation.

### 2. The ACL correction is necessary, bounded and distinct from historical parity

The original immutable default-privilege owner at `supabase/migrations/20260719055609_repair_postgres_default_privileges.sql:126-143` grants postgres-created public tables SELECT/INSERT/UPDATE/DELETE and functions EXECUTE to service_role. Therefore additive GRANT SELECT plus revocation only from PUBLIC/anon/authenticated does not itself establish the previously stated SELECT-only/internal-only intent.

`O/U03-p05-acl-correction-1.sql.txt:4-9` resets privileges only on the three named P05 tables and restores SELECT. Lines 12-22 revoke service-role access only to the eleven selected internal signatures. This is explicitly a new corrective ACL change in both the new U03 migration and the final snapshot, not a claim that copying the old P05 declarations already produced that restriction. The amendment accurately limits observed inherited table privileges to INSERT/UPDATE/DELETE; it does not falsely claim inherited TRUNCATE/REFERENCES/TRIGGER.

The block does not alter global default privileges, owner identity, role membership, unrelated tables/functions, generic publication/generation/webhook helpers or source-rights policy. The original U03 contract's required postgres-owned SECURITY DEFINER mutation wrappers remain the allowed path to these internal helpers. A direct service-role helper RPC cannot substitute for that owner boundary.

### 3. Governed entrypoint compatibility is retained without granting operational permission

No one of the eleven revoked signatures is one of the eight retained governed entrypoints. I checked the seven explicit service-role grants at immutable hardening migration :740-746 and the distinct read-only `public_source_serving_authority_stamp()` definition/grant at consolidation :316-326,753. The candidate preserves those grants, including the six-argument transition, and does not restore the dropped seven-argument overload. It does not revoke the read-only stamp when restricting its mutating bump helper.

The hash-bound caller inventory supplies bounded source evidence of one direct SELECT consumer and no identified direct mutation consumer of the selected tables; it also distinguishes SQL/trigger helper consumers from application RPC consumers. I did not promote that inventory into proof about arbitrary external/manual clients, installed grants or the moving U03 product. Final source freeze must still prove that no new U03 direct service-role internal-helper invocation was introduced.

### 4. Migration/snapshot obligations and acceptance limits remain truthful

The closure SQL is snapshot-only because the immutable migration chain already owns these effective function bodies and trigger bindings. The new corrective ACL block belongs to both the authored U03 migration and final snapshot after dependencies exist. Governing-candidate lines 151-163 and amendment lines 34-45 require final object/trigger/ACL ordering comparison and prevent a later grant from restoring unwanted access. Unrelated absent snapshot APIs remain parity debt; they are not silently imported or claimed functional.

This is compatible with the original contract's line-147 requirement to name and independently review further direct dependencies before editing. The governing candidate adds only the bounded prerequisite subsection and names the original TASK_BASE, retained reviews, sole writer and final full-range review. It does not create a separate accepted U03 range or permit the active incomplete implementation to be declared complete.

The reviewed changes preserve conservative source authority, immutable reviewed state, U02 payload/projection ownership, private access, source rights and default-off serving. No patient-identifiable workflow, source acquisition, provider call, clinical adjudicator or deployment/activation authority is introduced by this amendment.

## Required residual evidence

1. After implementation freezes, rebind the selected comparison to final product bytes. Verify all four restored function bodies, nine constraint triggers, preserved approval/publication bindings, three table ACL end states, eleven internal-function ACLs and eight retained entrypoints. This amendment review does not establish that the moving implementation has done so.
2. The final U03 source review must verify no direct service-role call to the restricted P05 helpers and that the new SECURITY DEFINER owners and exact authority predicates satisfy the original contract. Required focused U03 checks, compiler/Edge/migration equivalents and fresh whole-original-range product reviews remain separate.
3. Separately authorised SQL acceptance must establish actual owners, role inheritance, other grantors, effective privileges, trigger behavior, denied direct mutations/internal calls, retained SELECT/governed entrypoints, approval-v2 rejection, exact active-version refusal and valid versus missing-bound lifecycle exit. The SQL owner/bootstrap/extension assumptions recorded in the frozen inventory are not installed-state proof.
4. Native extraction, real sources, providers, hosted roles, deployment, activation, repair execution, production-readiness and clinical acceptance remain unrun or unresolved at their governing boundaries. Nothing in these verdicts authorises those actions.
5. Historical U02 `eval:rag:offline` remains **exit 1, four failed suites, 45 failed and 586 passed overall**. It is not green and supplies no U03 exception.

There is no clinical/governance blocker to the exact prerequisite edits once the controller integrates the required independent amendment review. Final product acceptance still requires fresh independent review over the complete original U03 range.

## Requested and observed own route

Requested: retained independent `gpt-6-astra` / `xhigh`, role `clinical-governance-reviewer`, task `/root/u03_contract_clinical_review`.

Observed from only selected session_meta/turn_context fields in my exact own log using shared read access:

`C:/Users/joshs/.codex/sessions/2026/09/08/rollout-2026-09-08T20-51-03-01a08112-6bd7-7b23-951a-277da5c47a16.jsonl`

- Line 1, `2026-09-08T12:51:03.881Z`: session ID `01a08112-6bd7-7b23-951a-277da5c47a16`; parent `01a07b47-4623-7e90-825a-ec25116b8531`; path `/root/u03_contract_clinical_review`; role `clinical-governance-reviewer`; provider `openai`.
- Current amendment-review turn at line 235, `2026-09-09T00:26:37.887Z`: model `gpt-6-astra`, effort `xhigh`; collaboration settings also record model `gpt-6-astra`, reasoning effort `xhigh`.

This is observed local resolved configuration, not backend attestation or inference from a requested route.

No repository write, ledger operation, test, product gate, SQL execution, provider/native/worker operation, commit, recursive agent or other-task message occurred. Only the listed frozen outside inputs, immutable original contract/migration owners and selected own-session fields were read. This report is the only write; the controller retains integration, ledger and commit ownership.
