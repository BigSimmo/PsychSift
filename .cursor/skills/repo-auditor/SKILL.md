---
name: repo-auditor
description: Reviews module dependencies, broken imports, dead files, and structural cleanup as triage — never an automatic delete list. Use during repo-wide audits or refactoring.
---

# Repo Auditor Skill

Use this skill when auditing the workspace layout, folder structures, imports, and dependencies. Outputs are **triage**, not an automatic delete list — a human decides what actually gets removed (AGENTS.md "Deleting code you believe is dead" and `docs/agents/dead-code-deletion.md`).

## Repository Review Protocol

Follow `AGENTS.md` review throttling and `docs/codex-review-protocol.md` before starting. Do not review opportunistically or mutate files during pure review. After a completed PR review, post one `Review record` comment on the PR (see [Records](../../../docs/agents/pull-request-workflow.md#records)); never edit the frozen `docs/branch-review-ledger.md` table.

## Review Checklist

### 1. Structural Audits

- **Broken Imports:** Scan modified files for broken relative imports, incorrect library names, or obsolete modules.
- **Dead Files:** Identify files that are truly unused — but treat as candidates only. Verify against route mappings, active `scripts/*`, migrations, `worker/**`, test resources, and package scripts before proposing removal.
- **Consolidation:** Flag identical or redundant configuration keys, environment variables, or scripts that could be safely merged.

### 2. Safety before deletion

- Present findings as a ranked candidate list with the evidence for each ("no importer found", "not referenced in any route/script/migration"). Do not delete or move files during a review.
- Anything reachable from a route, a `package.json` script, a migration, the worker, or a test is **not** dead even if statically unimported.
- Any removal that does go ahead later runs `npm run check:dead-code-candidate -- --diff origin/main` first, per `docs/agents/dead-code-deletion.md`.
