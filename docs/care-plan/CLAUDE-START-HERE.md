# Care Plan — Claude start here

**Last updated:** 22 August 2026 (Australia/Perth)  
**Implementation status:** Tasks 1–8 complete, reviewed and committed. Task 9 (Patient Plan) is on this branch. Tasks 10–11 not started.  
**Design status:** Approved  
**Working directory:** live state is `origin/claude/ed-care-plans-impl-7f44cd` (PR #2291). Local Windows worktree paths in older notes are historical.  
**Branch:** `claude/ed-care-plans-impl-7f44cd`

## One-minute start

**This file is orientation. The live state of the build lives in two others — read those first:**

1. [`session-handoff-2026-08-21.md`](./session-handoff-2026-08-21.md) — where things stand, the thirteen binding product decisions, the environment hazard, and the prompt to start the next session.
2. [`sdd-ledger.md`](./sdd-ledger.md) — task progress, all 25 controller rulings with what each costs if wrong, the deferred minors, and four systemic lessons.

**Where to work.** Branch `claude/ed-care-plans-impl-7f44cd`. The authoritative copy is `origin/claude/ed-care-plans-impl-7f44cd`. **Do not create or use any worktree under `.claude/worktrees/`** — that location destroyed this work three times on 21 August 2026. Nothing committed was ever lost; commit at the end of every task. Do not treat dated Windows paths in older handovers as the live checkout.

**The product in one line.** A synthetic, memory-only, reset-on-refresh prototype under `/mockups/care-plan` that lets a clinician look up the approved management plan for someone who presents repeatedly to an emergency department in psychiatric crisis. Reading is the primary use; authoring is supporting machinery.

Read these files in order before writing code:

1. [`AGENTS.md`](../../AGENTS.md) — binding repository rules.
2. [`CLAUDE.md`](../../CLAUDE.md) — Claude orientation and repository map.
3. [`claude-build-handover-2026-08-21.md`](./claude-build-handover-2026-08-21.md) — current state, approvals, boundaries, precedents, and exact next action.
4. [`2026-08-20-care-plan-design.md`](../superpowers/specs/2026-08-20-care-plan-design.md) — approved product and visual specification; this is the product authority.
5. [`care-plan-context.md`](../care-plan-context.md) — binding domain language.
6. [`2026-08-20-care-plan-implementation.md`](../superpowers/plans/2026-08-20-care-plan-implementation.md) — executable nine-task, file-by-file, test-first build plan.
7. [`conversation-transcript-2026-08-21.md`](./conversation-transcript-2026-08-21.md) — portable transcript of the complete visible Codex conversation through the handover request.
8. [`verification-log-2026-08-21.md`](./verification-log-2026-08-21.md) — exact planning and handover evidence, plus what has not run.

The visual-direction source files are outside Git and remain available at:

`C:\Users\joshs\.codex\visualizations\2026\08\20\01a01fb2-575f-7c11-a245-332db7a85a25\care-plan\.superpowers\brainstorm\17559-1787239654\content\care-plan-directions.html`

The previous localhost visual server is no longer running. Open the HTML file directly or start a new task-owned visual server if comparison is needed.

## Copy/paste prompt for Claude

```text
Resume the Care Plan build on branch claude/ed-care-plans-impl-7f44cd.

Read, in order: docs/superpowers/specs/2026-08-20-care-plan-design.md (binding),
docs/care-plan-context.md (binding glossary), and the Global Constraints and
Delivery Stages sections of
docs/superpowers/plans/2026-08-20-care-plan-implementation.md.

Then read docs/care-plan/sdd-ledger.md — the SDD ledger. Tasks 1–8 are complete;
Task 9 (Patient Plan) is on this branch. Resume at the first task without a
complete line. The ledger also carries every controller ruling.

Execute with superpowers:subagent-driven-development. Eleven tasks. Stop at the Stage
A checkpoint after Task 5 and report to the user; do not start Task 6 on your own
judgment.

Synthetic, memory-only, provider-free throughout. Local commits are authorised;
nothing else is — no push, PR, merge, rebase, deployment, or provider access.
```

## Current Git checkpoint

Captured on 21 August 2026:

- `HEAD`: `eeea74a160c19553f94347dda5102b2dff2ed591`
- Upstream: `origin/main`
- `origin/main` at the final 00:51 AWST snapshot: `1cc0d298774e4dc2ec8dd04d03ecf4fe789d5564`
- State at that snapshot: branch is four commits behind `origin/main`; no branch movement was performed.
- Working tree: the planning and handover documents are untracked; product code is untouched.
- Commits/pushes/PRs/deployments: none for Care Plan.

## Exact first action

After the read order and Git preflight, begin implementation-plan **Task 1: domain types, deterministic fixtures, selectors, and privacy invariants**. Do not start with page scaffolding.
