# U03 P05 prerequisite completion amendment 1 — review candidate

## Decision proposed

Complete the exact selected P05 schema dependencies and correct the inherited service_role privileges that contradict the already accepted SELECT-only/internal-only contract. Do not weaken the contract or claim the old declarations already enforced it. This is local source/documentation work inside U03; SQL execution, installed privileges and connected acceptance remain separately gated.

Original U03 TASK_BASE stays 8c11f138e6c683a13db3b465332e7f3cbb515c62. Current product is uncommitted and incomplete. This amendment is reviewed before its dependent edits; the writer may continue unrelated already authorised U03 work meanwhile. Prior planning acceptance and failed reviews remain intact.

## Evidence and exact candidate

All files below are under this outside directory, except the original contract at TASK_BASE. Bind their raw SHA256 values in the review result:

- U03-frozen-p05-prerequisite-comparison-1.md: full bounded comparison; four missing/older function bodies, nine missing constraint triggers, additive-grant distinction. Raw hash recorded in the attached input manifest.
- U03-frozen-p05-prerequisite-inventory-1.json: d26029cd84b9bbf9677425b1234aa3adb4043a436c74177035a8fe7fa7332168. Exact immutable final owners, excerpts and signatures.
- U03-p05-acl-dependency-inventory-1.md: 79e89d96f673ea55d731e81c4428c5c63185bdbf1272ee5bc4537bec7644c72c. No identified direct table mutation consumer; one table SELECT; retained eight governed entrypoints and eleven selected internal helpers.
- U03-p05-closure-addition-1.sql.txt: f0a4d9fbf17e62d6d65326f2ec952cd7ee9233fca3317a0647ae9ac98e5a96ee. Exact final owner function/constraint-trigger source extracted from immutable TASK_BASE, plus matching explicit revocations. Snapshot only: migration chain already has these effective bodies/bindings. No historical DML, trigger disable, bulk backfill or unrelated API definition included.
- U03-p05-acl-correction-1.sql.txt: e7783ab81851a9f1c035781fff8609031aeebaee9ba3a6cc7abb6400ae39205d. Exact new corrective declarations for both U03 migration and snapshot, after dependencies exist. Three table ACL resets retaining SELECT; eleven named internal-function EXECUTE revocations from service_role. No global defaults or roles/owners changed.
- U03-execution-contract-prerequisite-candidate-1.md: 877594a62de02ef3391ae0c9ca7594b827e768d8b0603eef3adfba0530dc2939. Complete candidate governing contract, adding one subsection before the existing migration-prefix recheck. The original contract remains unchanged in Git and working tree at dispatch.

The encoded defaults prove inherited table INSERT/UPDATE/DELETE; they do not prove that TRUNCATE/REFERENCES/TRIGGER were inherited. REVOKE ALL then GRANT SELECT defines the intended exact grant state without mislabelling the observed defect. Existing RLS and other principal revocations remain unchanged. Actual ownership/inherited role privileges and other grantors remain unobserved; the source declarations alone cannot prove installed enforcement.

## Compatibility and explicit non-expansion

Retain every existing explicit service-role entrypoint grant: record_public_source_activation_event(jsonb); create_public_source_fetch_manifest(text,text,text,uuid,text,text,text,uuid); stage_public_source_version(jsonb); activate_public_source_version(jsonb); transition_public_source_version(uuid,text,text,text,text,text); record_unchanged_public_source_check(jsonb); tombstone_public_source_version_for_review(uuid,text,text,text,text,text); public_source_serving_authority_stamp(). Do not recreate the dropped seven-argument transition overload.

The source caller inventory distinguishes the RAG cache's read-only serving-authority stamp from the mutating bump helper. Do not revoke or change the stamp or add its absent snapshot definition under this amendment. Retain known SELECT consumers. Preserve function bodies, publication semantics, source rights, approved entrypoint boundaries, kernel default-off, and P08A supersession. Generic publication/generation/webhook/title-word helpers remain outside the ACL set. No app/provider invocation is allowed for verification here.

The three table names and eleven exact internal signatures are the complete ACL allowlist. Internal SQL calls rely on the required privileged definitions; U03's new SECURITY DEFINER owners must be postgres as already required. Existing P05 installed owner/role/ACL correctness remains a pre-operation SQL acceptance prerequisite, not an assumption to turn into a passed result. No identified source compatibility break is narrower than a claim that arbitrary external/manual clients are compatible.

## Ownership and implementation procedure after independent review

The existing sole U03 writer remains responsible. No second product writer or new worktree is introduced. Existing product allowlist already covers supabase/schema.sql, the authored U03 migration, database.types, focused tests and the three runbooks. Add only docs/superpowers/rag-upgrade/continuations/rag-source-ingestion-continuation-v1/U03-execution-contract.md to that writer's explicit scope, solely to adopt the reviewed full candidate after the controller validates its hash. Controller remains scope/evidence/gate/commit owner.

1. Adopt the reviewed governing candidate, retaining original TASK_BASE and the original review/package/history.
2. Replace the old approval guard with its final source and include the three exact constraint-trigger helpers plus nine missing bindings in schema.sql. Preserve the existing approval trigger and final publication guard. Copy only the named declarative ACL statements; no old migration data operation.
3. Add the exact corrective ACL block to the new U03 migration and corresponding final snapshot after selected objects/default grants; do not alter historical migrations. The snapshot's default-privilege declarations precede these selected P05 objects; verify no later object-specific grant restores unwanted access.
4. Align only directly required types/docs and focused existing U03 SQL contracts. Freeze a full original-range candidate after all remaining U03 work, not an isolated acceptance of this appendix.

## Focused proof and review boundaries

Static proof must compare exact final four function bodies, nine trigger bindings and preserved approval/publication bindings; compare all eleven function ACLs and three table ACL end states in both U03 migration and snapshot; retain all eight entrypoint grants in existing migration owners; and show no new direct U03 service-role invocation of an internal helper. The current independent inventory is frozen preparation and must be rebound against final selected objects.

Use the already authorised U03 SQL/source tests and final scoped migration-role/index/compiler/Edge recipes. No new broad suite or operational command is required. Preserve failed outcomes and existing U02 exception (exit 1, four failed suites, 45 failed and 586 passed overall); it is not green or a U03 exception.

Separate SQL acceptance must test expected ownership/role inheritance/effective grants, denied direct table mutations/internal calls, retained SELECT/governed entrypoint behavior, approval-v2 rejection, active document/artifact exact-version rejection and valid exact lifecycle exit. Compare applicable migration-chain and selected-snapshot behavior without claiming omitted unrelated snapshot APIs exist. SQL execution, real sources, native extraction, providers, application/deployment/activation, repair execution and production readiness are unrun.

Request independent Astra/xhigh Specification and Quality review of this complete amendment and exact candidate inputs, including compatibility with the original accepted contract. Identify Critical/Important blockers before any dependent edit. The preparation authors/controller cannot independently accept their own contribution. This amendment review does not replace the final fresh independent product reviews over the full original U03 range.