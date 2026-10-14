---
name: issues
description: Track and recall all outstanding tasks, recommendations, and issues for this repo as durable cross-session memory. Use when the user types "/issues" (state the open items back), or asks to add/close/update/capture an outstanding task, recommendation, or issue. The memory lives in docs/outstanding-issues.md; a plain "/issues" is read-only.
---

# issues — the outstanding-work memory

`docs/outstanding-issues.md` is the repository outstanding-issues ledger — the single universal,
durable, cross-session register for recommended execution order, open **tasks**, **recommendations**,
**issues**, provider/operator work, and archive history (while `docs/task-receipts.md` governs
canonical task lifecycle and receipt handoff). Chat context resets; `docs/outstanding-issues.md`
does not. This skill reads it back and keeps it current.

**The ledger on the remote `main` branch is the source of truth, not chat memory or a stale
worktree.** Never answer `/issues` from conversation recall or by reading the checkout file
directly. Run `npm run issues:report -- --json`; it reads the locally cached
`origin/main:docs/outstanding-issues.md`, reports the checkout's `behind`/`ahead` counts, and labels
that source `revalidated: false`. Repeat its warning instead of presenting cached state as current.
A current remote read requires an explicitly authorized `git fetch origin main` immediately before
the report; record that fetch separately because the report itself performs no provider access.

## Trigger

- User types `/issues` (optionally with a subcommand or filter below).
- User says **`issues list`**: read the queue back from the current worktree's
  `docs/outstanding-issues.md`. There is no separate artifact to open — see "The canonical
  ledger is the register" below.
- User asks to add / close / update / list / capture an outstanding task, recommendation, or issue.

## Default: `/issues` (read-only)

1. Run `npm run issues:report -- --json` and use that payload, preserving its cached-state warning.
2. State the **Recommended execution queue** back in order, including acuity, timing, and gate.
3. Summarize any open items not represented in that queue, grouped by priority (P1 → P3), each as
   `#ID · type · summary — next action (source)`.
4. End with a one-line open/recommended count.
5. Do **not** mutate the file or commit on a plain read.

If a filter is given, filter the open items before rendering steps 2–3, then show only matching
queued tasks and matching non-queued items: `/issues P1` (by priority), `/issues issues` /
`/issues recs` / `/issues tasks` (by type), `/issues <keyword>` (summary/detail substring match via `npm run issues:report -- --filter <keyword> --json`).

`/issues wins` or `/issues agent-safe` runs
`npm run issues:report -- --agent-safe-wins --json`. The classifier includes only queued work
estimated at no more than four hours whose capability is not Operator and whose timing/outcome names
no provider, live environment, RAG/retrieval/clinical surface, approval, owner decision, or human
decision. Keep report order unchanged and always state A1 priority blockers before these convenience
wins; the filter never changes acuity.

**A row being open is not evidence that nobody is working on it.** Some rows carry a progress marker
in their prose (`IN PROGRESS`, `IMPLEMENTED in PR #1766`), but there is no structured status field and
no atomic claim — a marker is written by whoever did the work, usually after the fact, and nothing
requires or checks one, so its absence means nothing. Two sessions can therefore read the same queued
item and both build it (PR #1766 and the duplicate PR #1767, four hours apart, 2026-08-09). Before _acting_ on a queued
item — not before merely reading the list back — check the open PRs for the route, component, or
surface it touches, since a duplicate PR will rarely quote the ledger id. See the `newtask` skill's
"Before you start", which makes this the same GitHub read it already does for PR bundling. A plain
read-only `/issues` needs no such check. Recorded as `#292`.

## Mutating subcommands

Parse the intent from natural language too — the exact syntax is a convenience, not a requirement.

- **`/issues add <text>`** — queue an immutable `add` request. Infer `Pri`/`Type` from the text
  (ask only if genuinely ambiguous; default `P2`/`task`). `scripts/outstanding-issues.mjs` and the
  serial reconciler allocate ULID-backed 6-character Crockford Base32 `#XXXXXX` IDs; a feature
  branch must never hand-allocate IDs or edit canonical rows directly.
- **`/issues done <id> [outcome]`** — queue an immutable `done` request for the existing canonical
  ID and its one-line outcome. Reconciliation moves the row to **Resolved / archive** and updates
  any recommended-queue references.
- **`/issues update <id> <text>`** — queue an immutable `update` request for an open canonical ID.
- **`/issues queue <id> <field>=<value>`** — queue an immutable `queue` request that corrects this
  item's **Recommended execution queue** row: `--acuity`, `--capability`, `--when`, `--estimate`,
  `--outcome`. Use it whenever a re-grade or a change of timing lands on the Open-items row, because
  the queue is what an operator actually reads to decide what to start, and until ledger `#M6JNR8`
  it could only be pruned on close — so a stale A1 entry could keep sending sessions at closed work.
  Order and the `ID(s)` cell are not editable: Order is renumbered automatically on every close, and
  changing membership is an `add` or a `done`, not an edit.
- **`/issues capture`** — scan the current session for recommendations, follow-ups, deferrals, and
  unfixed problems that surfaced but were not recorded. Propose them as a numbered list and add the
  confirmed ones (dedupe against existing rows first — do not re-add something already tracked).

## Capture discipline (proactive memory)

When a task in _any_ session ends with unresolved follow-ups — a deferred fix, a "revisit when X"
recommendation, a known risk, a TODO you had to leave — offer to record them here before the context
is lost. That is what makes this a memory rather than a static list. Prefer one crisp row over a
paragraph; put the smallest next action in **Detail / next action**.

## Writing rules

**Queue a request, never edit the canonical ledger.** Branch-safe intake is handled by
`scripts/ledger-inbox.mjs`:

```bash
npm run issues:add -- --pri P2 --type issue --summary "…" --detail "…" --source "…"
npm run issues:done -- '#M6JNR8' --outcome "Resolved 2026-07-31 by PR #1494. …"
npm run issues:update -- '#M6JNR8' --detail "…"
npm run issues:queue -- '#M6JNR8' --acuity A3 --when "After the next release"
```

Each command creates one validated UUID JSON file under `docs/outstanding-issues-inbox/`; it does
not edit `docs/outstanding-issues.md`. Requests are immutable and merge independently. Only a
dedicated fresh-base ledger branch may run `npm run issues:reconcile`, which allocates ULID-backed
6-character Crockford Base32 `#XXXXXX` IDs via `scripts/outstanding-issues.mjs`, applies
requests serially, and moves them to `docs/outstanding-issues-inbox/applied/`. Never reconcile as
part of an ordinary product PR.

- Preserve the request file exactly after creation; correct mistakes with a new request rather than
  editing or deleting a queued request.
- Include enough detail for reconciliation to preserve queue order, dependencies, success criteria,
  verification, and stop rules when those fields matter.
- Run `npm run check:outstanding-issues`; the write-discipline gate separately proves that request
  records are immutable and canonical edits came only from reconciliation.
- Respect the repo's RAG/clinical/privacy flagging rules if an item _itself_ touches a protected
  surface — recording it here is fine, but acting on it later still needs the usual gate.

## The canonical ledger is the register

`docs/outstanding-issues.md` is the sole canonical, cross-platform register. Read it directly, or
through `npm run issues:report -- --json`. There is no second artifact to refresh, and no step of
this skill produces one.

The legacy `ISSUES-LIST.html` visual register was **retired on 2026-08-18** by ledger issue `#338`,
precisely because it could only be refreshed from one Windows machine and so drifted silently as
work moved to container and cloud sessions. Do not refresh it, do not report it as stale after a
reconciliation, and do not improvise a substitute renderer — a reconciliation that updates the
canonical Markdown is complete on its own.

## Persist the memory (commit)

When the user explicitly asks for a commit, commit only the newly created request file(s), never
`docs/outstanding-issues.md`. Use explicit paths so unrelated staged files cannot ride along:

```bash
git add -- docs/outstanding-issues-inbox/<uuid>.json
git commit --only docs/outstanding-issues-inbox/<uuid>.json -m "issues: queue <what changed>"
```

Do not stage or commit anything else, and do not push unless the user asks (or you are already in a
handoff/upload flow). A plain read-only `/issues` commits nothing.
