# PsychSift: task lifecycle and receipt handoff

_Updated 2026-10-08 — corrected documentation guidance; operational evidence retains its original dates._

Owning repository: `BigSimmo/PsychSift`. These rules cover only this project. The [canonical task source](https://app.notion.com/p/ba8c768f8b2c49638772b39900cb7ab9) uses data source `collection://ef3ca511-c488-4aba-ba1f-a5e20767a333` and an exclusive Project value `PsychSift`. The verified [project ledger](https://app.notion.com/p/3ec7889e8a2281e4bab9ca667a2a76df) uses the exclusive Project and Conversation filters; it is a view of the shared canonical source, not a duplicate database. Existing records are evidence and task detail; the receipt is a reconciliation handoff, not another competing task ledger.

Use [the existing issues inbox](outstanding-issues-inbox/README.md) and its issues:add/update/queue/done commands. Feature branches must not edit outstanding-issues.md directly; existing reconciliation locks and clinical controls remain binding.

## Status authority

| Surface                                        | Authority and update route                                                                                                       |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Canonical Notion source, filtered to PsychSift | Task ownership, lifecycle, blocker and next action; update only with applicable authorisation.                                   |
| `docs/outstanding-issues.md`                   | Repository issue history and recommended issue queue; changes go through immutable inbox requests and serialized reconciliation. |
| Local task checkpoint and exported receipt     | Evidence and handoff while canonical reconciliation is unavailable; report unsynced state.                                       |
| Operator runbooks and readiness register       | Operational steps and domain-specific evidence; they do not create another task-status ledger.                                   |

This map supersedes legacy wording in the protected issue ledger introduction
that calls it the universal task ledger or directs table edits. Preserve its
historical records; feature branches must not rewrite even its introductory
text. Use [the issues inbox](outstanding-issues-inbox/README.md) for issue changes.

## Update at lifecycle events

At start, reuse the original objective/task ID. At checkpoint, blocker, resume and completion, update that same record; retries and terminal assistant turns are not new tasks or proof of completion. One project owns each task. Link dependencies as project plus task ID instead of copying them into other project lists. Keep Completed/Cancelled history; open views hide those states.

Status is In progress, Blocked, Needs you, Paused, Completed or Cancelled. Record Task/title, Blocker, Next action, Owner and source/evidence links in the canonical source where authorised. Preserve Last verified unless new evidence actually verifies the state. Completion needs evidence of the task's acceptance; completion, user acceptance, merge, release and deployment remain separate.

When code/config/instructions change, refresh the relevant maintained document and same task receipt as part of the owned diff. Respect file claims; hand conflicting document updates to their owner. Do not regenerate unrelated docs. Changes to these rules need the same reviewed documentation process. Shared master/adapters are maintained separately; do not edit them from this project task.

## Local-only receipt bridge

`python scripts/export-task-receipt.py --input <sanitised-metadata.json> --output-directory <private-task-workspace>` writes a deterministic per-project/per-task JSON file. Python 3 is required; no packages, service, network or API key is used. Output stays local; an authorised parent session must verify its destination and reconcile it. Use one exporter writer per task. Do not place private receipt inputs in tracked Git.

Schema version 1: project, repository, source_identity (`repository:task_id`), observed_head, stale_source and task. Task allowlist: task_id, title, status, lifecycle (start/checkpoint/blocked/complete), blocker, next_action, evidence (locations only), last_verified (timezone-aware ISO timestamp or null), source_reference, source_revision, dependencies (project/task_id pairs), sanitised (true). Stable identity must be searched before creating a canonical row. Source reference is the existing task/checkpoint link, not full chat text.

Prepare the input manually or through an observable supported client event. Explicitly sanitise it: no transcripts, patient details, identifiers, credentials, .env contents or full log capture. The allowlist is not a content redactor. The exporter reads only the supplied bounded JSON and Git identity/revision. It does not open evidence locations. It rejects wrong repositories, unsupported fields/statuses, completion without evidence/time, and refreshing Last verified against unchanged evidence and revision. It flags a missing/mismatched source revision as stale; human review must also assess dirty inputs, dependencies and age. A receipt cannot prove its own factual claims.

Accessible task results are reconciled by the parent's bounded hourly process. Inaccessible desktop, CLI, IDE and other chats have no universal event subscription here: their client must emit the receipt or the owner must hand it over. No real-time coverage or external delivery is claimed. Export success is not reconciliation success.

## Client loading and contributions

Codex and Cursor Agent use the root AGENTS.md. Claude Code uses CLAUDE.md and its @AGENTS.md import. Gemini CLI uses GEMINI.md by default; this adapter directs the session to applicable project safeguards and this procedure. Antigravity supports AGENTS.md/GEMINI.md, but its documented rule-file/aggregate budgets can truncate large project chains; inspect native loaded context before claiming coverage. No Cursor duplicate rule or Antigravity copy is required solely to repeat the same AGENTS guidance.

Use the supported global adapter for shared master preferences; the maintained source is the user's ai-rules/global-rules.md. Propose evidence-backed shared changes to that source's owner; update relevant owned project documentation and the same task receipt locally. Do not copy the master or create another ledger. A source change, a file sync and actual loaded context are separate evidence states.

To activate these branch-only changes without touching active canonical work, select this prepared task worktree as the client's workspace and start a fresh session (or use a supported context reload and verify it). Canonical checkout activation requires its reviewed repository integration workflow. An existing chat can retain older context; file changes do not retroactively enforce instructions. No universal event capture is installed.
