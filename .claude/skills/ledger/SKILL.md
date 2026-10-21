---
name: ledger
description: Sweep the full current session, repo/task context, local task files, and (with approval) connected remote task stores for outstanding actionable work, then record only useful high-confidence items in docs/outstanding-issues.md with priority, context, and next steps. Use when the user types "/ledger" or asks to extract outstanding tasks from this session into the ledger.
---

# ledger — extract outstanding work from this session into the universal task ledger

`/ledger` is a session sweep: it mines everything visible to the current task for outstanding
actionable items and records the high-confidence ones in `docs/outstanding-issues.md` — the same
universal ledger the [`/issues` skill](../issues/SKILL.md) owns. `/ledger` is the _extractor_;
`/issues` remains the _reader/editor_. Follow every writing rule in the issues skill.

**Disambiguation:** this skill targets the outstanding-issues ledger only. It must never read or
write `docs/branch-review-ledger.md`, and the `ledger:lookup` / `ledger:index` npm scripts
belong to that review history — they are not part of this skill.

## 1. Sweep (read-only)

Collect candidates from, in order:

1. **Full chat context** — every request, finding, decision, error, and deferral in this session.
2. **Repo/task context** — current branch, `git status`, uncommitted/unpushed work, recent commits
   on this branch, and TODO/FIXME markers in files touched this session (not a repo-wide grep).
3. **Local task context files** — `docs/outstanding-issues.md` (baseline for dedupe),
   `docs/process-hardening.md` debts, session scratchpad notes, and any plan/handoff notes this
   task produced.
4. **Remote task storage** — GitHub PRs/issues, Todoist or other connected MCP task stores.
   These are provider-backed: read them only with explicit user approval per the AGENTS.md
   provider boundary. If not approved or not connected, skip and say so in the report.

Hunt specifically for: deferred or "later" items; unresolved "need to", "should", "TODO",
"follow up", "please do", "investigate", "fix" statements; explicit blockers and errors left
unfixed; and acceptance criteria stated but not met.

## 2. Report before writing

Present findings in this order, then pause for confirmation on anything ambiguous:

1. **Confirmed outstanding tasks** — high confidence, clearly actionable.
2. **Risky / blocked areas** — items blocked on approvals, providers, or user decisions.
3. **Quick skill suggestions** — up to 3 ideas to improve `/ledger` itself (report only; add to
   the ledger only if the user confirms).

Render each candidate with the full structured record:

```
id: short-slug                      # e.g. ledger-missing-trigger
title: one line
importance: P0 | P1 | P2 | P3
category: bug | follow-up | risk | refactor | infrastructure | hygiene | idea
why: business value / user impact
context: what in this chat triggered it
owner: assistant | user | unknown
next_step: concrete next action
dependencies: ids or #NNN rows, if any
status: pending | done | blocked
confidence: high | medium | low
suggested_improvements: optional related idea (omit if none)
```

## 3. Filter and dedupe

- Record only **useful, high-confidence** items. Drop vague observations, restated repo policy,
  and anything already fixed this session.
- Dedupe against existing open rows by intent, not exact wording. Same intent → do not re-add;
  report it as "duplicate of #NNN". New information on an existing row → `npm run issues:update`
  instead of a new row.
- Medium/low-confidence items: list them in the report, add only the ones the user confirms.

## 4. Write

Queue each retained item as an immutable inbox request; never edit the canonical ledger:

```bash
npm run issues:add -- --pri P2 --type issue --summary "<title>" --detail "<detail>" --source "session YYYY-MM-DD /ledger sweep"
```

Field mapping into the request payload (the reconciler later creates the canonical row):

- `importance` → **Pri**: P0 and P1 → `P1` (note "was P0" in Detail), P2 → `P2`, P3 → `P3`.
- `category` → **Type**: bug/risk → `issue`; follow-up/refactor/infrastructure/hygiene → `task`;
  idea → `rec`.
- **Detail** = `next_step`, then `Why:`, `Context:`, `Owner:`, `Confidence:`, and
  `Depends on:` as short clauses. Escape `|` as `\|`. Keep it one crisp cell, not a paragraph.
- **Source** = `session YYYY-MM-DD /ledger sweep` plus the doc/PR/file:line when one exists.

If **no** new items survive the filter, create no request and do not change the canonical ledger.

After queueing, run `npm run check:outstanding-issues` and paste its decisive line. Do not refresh
the visual register because the canonical ledger is unchanged. If the user explicitly asks for a
commit, commit only the newly created request file(s); never push unless the user asks or a handoff
is already in flight. A dedicated fresh-base branch later runs `npm run issues:reconcile`.

**Fallback (other workspaces):** if `docs/outstanding-issues.md` does not exist, search for
similarly named files (`outstanding*`, `*issues*`, `TODO.md`, `BACKLOG.md`); if none fit, propose
a location and ask before creating. A newly created ledger uses concise structured Markdown
bullets carrying the full record above, appended chronologically, preserving existing entries.

## Boundaries

- No provider-backed or live-service reads/writes without explicit approval.
- Recording an item that touches a protected surface (RAG ranking, clinical, privacy) is fine;
  acting on it later still needs that surface's own gate and flagging rules.
- `/ledger` never deletes or rewrites existing rows — cleanup only on explicit request, via
  `/issues`.
