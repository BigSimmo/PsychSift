# Documentation system

How Documentation keeps project docs accurate, logged, and non-stale across Joshua’s repos. **Process doc — no product DDL.**

_Owned by Documentation. Updated 2026-10-08 — clarified checkpoint, memory and communication authority; Documentation owns._

## Principles

1. **One live source per topic** — archive or stub duplicates.
2. **Stamp what you touch** — live docs carry `_Updated YYYY-MM-DD — <why>; Documentation owns._`
3. **Names only for secrets** — never paste values, JWTs, or dashboard passwords.
4. **Status in one board** — one deferred/status owner per topic; other docs link, don’t fork.
5. **Improve the map while you’re here** — one small discoverability/archive/link fix per pass when cheap.
6. **Recheck triggers** — every live doc class has an event that invalidates it (below). Weekday sweep is backup, not the only freshness mechanism.
7. **Registry claims must be tip-true** — script names, entry filenames, and “generated” claims must match the tip you are editing (`package.json` + tree). Prefer under-claiming over inventing tip-only paths.

## Pipeline (every docs change)

```
Scope → Read tip → Edit (class-aware) → Stamp + ship (auth-gated PR) → Checkpoint/receipt → One map improvement
```

| Step    | Do                                                                                                                                                                                                                              |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scope   | Project + tip path/branch; list files; no drive-by WIP                                                                                                                                                                          |
| Read    | Entry doc + any closeout/board; hunt duplicates                                                                                                                                                                                 |
| Edit    | Prefer short appends; fix relative links; scrub `file://`                                                                                                                                                                       |
| Ship    | Commit locally on the task branch only when commits are authorised. **Open/push a GitHub PR only with explicit user authorization** (or a standing ask for that docs PR); otherwise stop at a local handoff (branch + summary). |
| Log     | Update the existing task checkpoint/receipt. Persistent memory writes require explicit approval; messages to other chats or people require applicable authorisation.                                                            |
| Improve | One Start-here / archive / link / port-env fix if cheap                                                                                                                                                                         |

## Doc classes

| Class                     | Rule                                                    | Recheck when                                      |
| ------------------------- | ------------------------------------------------------- | ------------------------------------------------- |
| Entry (README, first-run) | Short, current, linked from root / docs README          | Tip SHA / boot command / entry path changes       |
| Runbook                   | Imperative; restamp when operator state changes         | Operator dashboard/CLI steps change               |
| Closeout / deferred       | Short; deferred list + status; no secrets               | Teammate reports phase done / deferred item moves |
| Plan / playbook           | Don’t duplicate live status — point at the board        | Plan superseded or board moves                    |
| Historical                | Under an archive/ folder (+ stub if old path is linked) | Never “update” — supersede with a new dated note  |
| Generated                 | Don’t hand-edit                                         | After regenerating indexes/inventories            |

## Freshness

- **Event-driven first:** apply the recheck column when the triggering event happens (handoff from Supabase/Railway, tip move, boot script rename, merge of a docs PR).
- **Weekday sweep (Documentation routine, 08:15 AWST Mon–Fri):** tip identity → entry docs → stamps vs known operator moves → dual ledgers → archive hygiene → link check → open docs PRs vs teammate updates.
- Fix cheap issues in-sweep; queue large rewrites.
- Stay quiet to Joshua unless something changed or a decision is needed.

## Project registry

Verified against `origin/main` on 2026-09-21 unless noted. Tip-only claims are labeled.

| Project                                   | Tip / repo                                                      | Entry docs (on `main` unless noted)                                                                                                         | Doc check on `main`                                                                          | Notes                                                                                                                                                                                         |
| ----------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **PsychSift** (repo `BigSimmo/PsychSift`) | GitHub default `main`; local tips on Josh PC worktrees as named | Root `README.md`, curated `docs/README.md` (hand-maintained Start-here / index — **not** auto-written by `docs:update`), process: this file | `npm run docs:check-links`, `docs:check-scripts`, `docs:check-inventory`, `docs:check-index` | Product name is **PsychSift**. Supabase project label is **PsychSift Production**. Closeout notes landed via [PR #2959](https://github.com/BigSimmo/PsychSift/pull/2959) (merged 2026-09-21). |

### Catalog honesty

- `docs/README.md` is a **curated** map. `npm run docs:update` / repo-awareness snapshot **reads** it to mark paths catalogued vs not; it does **not** regenerate the README.
- New docs need a manual Start-here / README row (or an explicit backlog note) when they are load-bearing.

### Registry accuracy rules

- Script names and filenames in this table must match `package.json` and the tip tree — verify before editing this file.
- If an entry doc cites a tip SHA, that SHA must equal `git rev-parse HEAD` on the locked tip (or the sentence must say “as of &lt;date&gt;” and be updated on the next docs pass).
- This file is the live source for Documentation process in this repo. There are no separate tip skills named **Documentation Operating System** or **Docs Freshness Audit** — do not hunt for them.

## Related

- Process ownership: this file (`docs/DOCS-SYSTEM.md`) and curated `docs/README.md`.
- PsychSift / PsychSift Production closeout notes: [PR #2959](https://github.com/BigSimmo/PsychSift/pull/2959) (merged 2026-09-21).
- Weekday freshness sweep is a Documentation operating habit, not an npm skill.
