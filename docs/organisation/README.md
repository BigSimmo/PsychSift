# Organisation map

_Updated 2026-09-26 — stages 1 to 3; Knowledge owns._

This folder is the map of which **area** of PsychSift every tracked file belongs to. The map is
logical: nothing is moved or renamed to fit it. `npm run check:organisation` keeps it honest. The
design, the audit behind it and the owner's decisions are recorded in the PR that introduced it.

## The areas

| Id                  | Area                       | Owns                                                                                                                                      |
| ------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `answer-engine`     | Answer engine              | Turning a question into a cited answer: retrieval, ranking, answer building, citation checks, the clinical-ask pipeline, the eval harness |
| `source-intake`     | Source intake and indexing | Any source becoming searchable: upload, extraction, OCR, captions, chunking, embeddings, index units, the ingestion worker                |
| `clinical-content`  | Clinical reference content | Facts a clinician reads, and where each came from: the records, their sources, sign-off and publication                                   |
| `personal-practice` | Personal practice          | The clinician's own records and tools: their logic, data and server routes (today On Call, CME/CPD, favourites, calendar)                 |
| `app-experience`    | App experience             | Every page, the shared shell, navigation, search chrome, client-side search and filtering, demo mode and offline behaviour                |
| `data-platform`     | Data platform and access   | Database schema, migrations and drift guards, auth, owner scope, privacy, environment, proxy, security headers, observability             |
| `delivery`          | Delivery and assurance     | Getting a change safely from branch to live: CI, git hooks, gates, budgets, containers, deploy config, test tooling                       |
| `knowledge`         | Knowledge and records      | How people and agents know how to work, and what has been decided or left open: entry docs, agent tooling, ledgers, records               |
| `design-system`     | Design system (workstream) | Tokens, primitives, brand, and the lint rules that enforce them                                                                           |
| `prototypes`        | Prototypes (workstream)    | Admin-only work not yet in the product: Care Plan, the developer hub, design-scratch mock-ups                                             |

Each area's file in `systems/` lists its canonical docs and its path rules.

**Loose around pages and modes (owner decision, 2026-09-26).** Areas describe the job code does, never a page or a mode; any mode named above is only an example of today's layout. Every page sits in App experience whatever mode it serves, so adding, moving, renaming or retiring a page or a mode needs no map edit. One recorded exception: `personal-practice.json` names the Roster and Open shifts page folders (`src/app/(search-app)/roster/**`, `open-shifts/**`) because their longer path wins over the shared `(search-app)/**` rule, so those pages belong to Personal practice.

## Placing new work

Ask: **if this file broke, which part of PsychSift would stop working?**

- A test belongs to the area it tests. A doc about one area belongs to that area. A script that serves one domain belongs to that domain's area; only generic tooling goes to `delivery`.
- A new file inside a folder the map already covers is placed automatically. A new folder, or a loose file in a mixed folder (`src/lib`, `src/components`, `scripts`, `tests`, `docs`), needs a rule: add it to the right `systems/<id>.json`. Prefer a folder or name-pattern rule over naming one file, and never name a single page.
- After moving or renaming things, run `npm run check:organisation -- --fix`. It removes entries left pointing at moved or deleted files, drops not-yet-placed entries a rule now covers and restores alphabetical order. It never places a file and never touches anything outside this folder.
- If a file genuinely does two jobs equally, list it in `shared.json` with a reason. If you honestly cannot tell, list it in `not-yet-placed.json` with a one-line reason that says where it might belong (at most 120 characters; no links, names or long numbers, because this repo is public).
- Ward Flow and Caring Contacts were retired and removed on 2026-09-26, so the map no longer lists them.

**Rule language.** A rule with no `*` names one exact file. `*` matches within one folder; `**` spans folders. Everything else is literal, including `(search-app)` and `[id]`, and matching is case-sensitive. An exact rule beats a pattern; otherwise the rule with the longer fixed part (the text before the first `*`) wins. A wildcard directly inside a mixed folder needs at least three fixed characters, so `tests/rag-*` is allowed and `tests/*.ts` is not.

## Running it and reading the result

```bash
npm run check:organisation              # the working tree
npm run check:organisation -- --staged  # exactly what is staged
npm run check:organisation -- --files src/lib/chunking.ts   # which area owns a file
npm run check:organisation -- --fix     # tidy the map after moving or renaming files
```

| Exit | Meaning                                                                                                                                                                                                         |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0`  | Nothing the run is responsible for is broken. Warnings may be listed: unplaced files, entries pointing at moved or deleted files, superseded not-yet-placed entries, unsorted rules, patterns matching nothing. |
| `1`  | The map contradicts itself or cannot be read: invalid JSON or an unknown key, a bad reason, an over-broad rule, or two areas tying for a file.                                                                  |
| `2`  | The check could not run or could not be trusted: a crash, git missing, the wrong or a sparse checkout, a newer map version, or an unreachable CI base.                                                          |

In CI (`static-pr`), only problems the change itself introduced fail the step, so a PR is never blamed for something already on main and the result never depends on the date. Files that are not placed yet, and entries left behind by a move, are warnings shown on the PR, never failures (owner decisions, 2026-09-26).

Each local run writes a JSON and a Markdown report to the git-ignored `output/organisation/`, selected by `latest.json`. The report also lists key documents whose area changed since they were last read, from the commit pins in `pins.json` (re-read the document against the files that changed in its area, then set its pin to the commit on main you read it against, which the weekly report prints; never a commit only on a PR branch, because PRs are squash-merged), the most-edited files of the last 30 days, and what moved since the last report. `npm run ensure` runs the check once, advisory only, when it starts a new dev server.

## The checks built on the map

Each of these reports; none of them decides policy. `pr-policy`, the registers and CI still do.

- **Safety-list coverage.** When a change renames, copies or moves a file off pr-policy's ranking, clinical-risk or migration lists (judged against the lists as they were before the change), the check prints `SAFETY COVERAGE LOST` loudly on the PR. It never blocks: only a self-contradicting map does. An exact list entry that names no tracked file is also reported.
- **Instruction guards** (`npm run check:instructions`). A rule the owner has dropped goes on `retired-rules.json`, and the check fails when a live instruction file (AGENTS.md, CLAUDE.md, the agent guides, the PR template, skills and agent definitions) states it again. It catches each rule's key phrases only: a paraphrase passes, and so does a line that also carries one of the rule's excuse words such as "no longer". Treat it as a tripwire for copied wording, not a reader of meaning. `instruction-budget.json` caps the size of AGENTS.md and CLAUDE.md. In CI only what the change adds is judged.
- **Agent hooks.** When an agent edits a file on a safety list, a short note is added to its context, and the first edit in an area names that area and its key docs. A session starts with one line of map health, and nothing when all is clean. They never block and never touch permissions.
- **PR helper** (`npm run pr:areas`). Prints the `Areas touched:` line for a PR description, plus a `RAG impact:` placeholder when pr-policy says a ranking file changed. pr-policy warns (it does not block) until a person replaces the placeholder.
- **Routing hint.** `check:organisation -- --files <path>` also names the planner to run before editing.
- **Per-area index.** The section of `docs/codebase-index.md` between its organisation markers is generated from `systems/*.json` by the pre-commit hook; a stale copy is a warning.
- **Weekly report** (`npm run organisation:weekly`, and the `Organisation weekly report` workflow on Mondays). One GitHub issue, updated in place: open issues by area, lapsing governance review dates, stale key docs, map tidiness, proposed homes for unplaced files, code no test imports, and where older classifiers disagree with the map. Proposals only; it never moves or edits a file.
- **Review dates.** In pull-request CI and on pushes to main, an expired review date on the hazard or privacy register is a warning, unless the change edits that expired entry in the register or touches what the entry covers; then it still blocks. Editing other parts of the register no longer makes every lapsed entry block (owner, 2026-09-26: "Yes, block on a lapsed review date only when the change edits that item."). When the check cannot compare the entry, any change to the register still blocks. Local runs, other branches, manual runs and release gates stay strict, and the weekly report raises lapsed dates (owner decisions 2026-09-26).
- **Decisions.** The owner's recorded decisions are indexed in [`../decisions/`](../decisions/README.md) (`npm run check:decisions`); each entry points at where the repository records it.
- **Personal practice reviewer.** `.claude/agents/personal-practice-reviewer.md` reviews the Personal practice area by its job, not by page.

## What it does not guarantee

- It does not prove any code works. It can pass while tests fail, the build is broken or the live site is down.
- Placing a file in an area is never a clinical, ranking, privacy, security, legal or database approval. Those keep their own checks (`pr-policy`, CI, the migration and drift guards) and Josh's sign-off.
- "Prototype" or "ignored" never exempts a file from any other rule.
- It does not check that a document is true, only that it exists and whether its area changed since it was last read.
- A report means "last checked at commit X", never "currently true".
- "Not yet placed" is an honest "don't know yet", not an acceptance.
