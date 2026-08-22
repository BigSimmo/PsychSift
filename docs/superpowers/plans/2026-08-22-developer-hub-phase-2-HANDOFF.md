# Developer hub Phase 2 — handoff

Companion to the plan (`2026-08-22-developer-hub-phase-2.md`) and the approved spec
(`docs/superpowers/specs/2026-08-22-developer-hub-phase-2-design.md`). This file exists so a
fresh session can resume without the session that wrote it.

**Read this, then the plan, then the spec. In that order.**

Written 2026-08-23 at Task 5 of 13, a deliberate stopping point: Tasks 1–5 complete the entire
data layer bar its assembly, and nothing is half-built.

---

## 1. Where the work is

|              |                                                                                                                    |
| ------------ | ------------------------------------------------------------------------------------------------------------------ |
| Worktree     | `D:/Worktrees/Database/dev-hub-phase-1` — **not** `.claude/worktrees`, which has been wiped repeatedly             |
| Branch       | `claude/dev-hub-phase-2-plan`, cut from `origin/main` at `83a8ffb37`                                               |
| Remote       | Pushed. `origin/claude/dev-hub-phase-2-plan` tracks it — the work does not live only on this machine               |
| PR           | None yet, by design. Phase 2 is not finished                                                                       |
| Dependencies | Installed. Do **not** run `npm ci`; if a fresh worktree is ever needed use `node scripts/setup-codex-worktree.mjs` |

**Verify the branch before every commit** (`git rev-parse --abbrev-ref HEAD`). Two worktrees were
destroyed mid-session during Phase 1 and git silently resolved to the main checkout on another
branch.

## 2. What is done

| Task | What                                                      | Commits                                                               |
| ---- | --------------------------------------------------------- | --------------------------------------------------------------------- |
| —    | Spec decision + plan                                      | `c1f5259ff`                                                           |
| 1    | Shared freshness helper, labelled stamp, `PanelPageShell` | `3ce47a487`                                                           |
| 2    | Shared types module + routes section                      | `bc340bcf9`                                                           |
| 3    | Documentation section                                     | `643fbae2e`, fix `ec68283b1`, plan `cd7194c21`, docstring `1ed5c2b5e` |
| 4    | Test-health section                                       | `06676a55b`, fix `f986684a0`                                          |
| 5    | Review-state section                                      | `4737541a8`, fix `eb95080ae`, plan `d97f9fd06`                        |

Every task had its own review; Tasks 3, 4 and 5 each needed a fix round, and each fix round had a
scoped re-review. **28 tests pass** in `tests/repo-awareness-generator.test.ts`;
`typecheck:source` is green.

**All three gates are green as of this handoff.** The batched `npm run lint` covering Tasks 4 and 5
finally got a turn on the run coordinator and passed clean — ESLint emitted no findings at all
(`--max-warnings 0`, exit 0). That matters because lint caught this branch's only Critical finding
(an unused constant in Task 3), so it is the gate least safe to infer from green tests.

Nothing is outstanding. Task 6 is a clean start.

## 3. What is next — Tasks 6 to 13

The plan carries the full code. In order:

| Task    | What                                                                                                                                                                                |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 6       | Assemble the snapshot, resolve the captured revision, write `data/repo-awareness-snapshot.json`, wire `snapshot:repo-awareness` into `docs:update` (**not** `prebuild` — ruling R5) |
| 7       | The staleness gate, registered in three places: `verify:cheap:internal`, `scripts/verify-pr-local.mjs`, and `.github/workflows/ci.yml`                                              |
| 8       | The typed reader with its version guard                                                                                                                                             |
| 9 to 12 | The four pages: routes, documentation, test health, review state. Each adds a route, so each must regenerate and commit the snapshot (ruling S1)                                    |
| 13      | Flip the four registry entries to `phase: 1`, rename `work-in-flight` to "Review state" keeping its id, update `docs/codebase-index.md`, run `npm run docs:update`                  |

Then the controller-only acceptance in the plan's final section — `npm run build`, a live render of
all five developer routes, `verify:pr-local`, `verify:phone-chrome`, and a determinism check.

**Regenerate a task brief** (the git-ignored ones will be gone):

```bash
node -e "const fs=require('fs');const L=fs.readFileSync('docs/superpowers/plans/2026-08-22-developer-hub-phase-2.md','utf8').split('\n');const gs=L.indexOf('## Global Constraints');const ge=L.indexOf('---',gs);const n=process.argv[1];const s=L.findIndex(l=>l.startsWith('### Task '+n+':'));let e=L.length;for(let i=s+1;i<L.length;i++){if(L[i].startsWith('### Task ')||L[i].startsWith('## ')){e=i;break}}console.log(L.slice(gs,ge).join('\n')+'\n\n---\n\n'+L.slice(s,e).join('\n'))" 6 > brief-6.md
```

## 4. Decisions already made — do not re-open these

Full reasoning is in the plan's "Rulings" table. The load-bearing ones:

- **R1** The hub shows only facts no green gate already guarantees. This is why the routes panel does not flag orphan routes and the documentation panel does not list broken links — CI already guarantees both are zero.
- **R3** Document age is deliberately absent. It needed a per-row git-preservation mechanism and an 8.7-second `git log` walk on every generate _and_ every gate run, to show a number no staleness policy backs.
- **R5** The generator runs from `docs:update` only, never `prebuild`. `docs/site-map.md` is the precedent. This keeps `tsx` off the Docker build path, which is why git can be a hard requirement of the generator rather than something to degrade around.
- **R9** The registry entry keeps `id: "work-in-flight"` while its name becomes "Review state". The id is Phase 1's extension mechanism.
- **Owner's decision, spec §4.1** The panel shows the repository's own review history, not live pull-request state. The page says so in its own words so nobody infers otherwise.

## 5. Traps this branch has already paid for

**Dispatching implementers.** Every dispatch must carry: an explicit Bash `timeout` of 600000; use
`npm run test`, never `test:focused`; never pipe a gate through `tail`/`head`/`grep`; run
`typecheck:source` too; never force the run-coordinator lock; verify the branch before committing.
Add one more, learned here: **retry the lock inline within your own turn — never hand waiting to a
background job, monitor or scheduled wake-up.** A subagent's background work dies with its turn. One
agent wrote four correct fixes, scheduled the verification, ended its turn, and nothing ran; the task
looked finished and was not.

**Checks that cannot fail.** Eight assertions on this programme have turned out to assert nothing —
two of them on this branch, both originating in the plan's own snippets. Before accepting any test,
name the concrete source edit that turns it red, and where it matters, _watch it fail_. Both fixes
here were mutation-proved: red output pasted, then green.

**Exit codes are not evidence.** My own verification script restored a backup that already contained
the fault it had injected, so a good build looked broken. Reading the actual failure output is what
identified it as my bug, not the implementer's.

**Line endings.** Controller-side edits through Python's text mode silently wrote CRLF; this repo is
`eol=lf`. Use binary-mode writes or the editor tooling. Committed blobs were unaffected because git
normalises on `add`, but the working tree warned on every diff.

**Lock contention is the dominant cost.** Other sessions on this machine hold the exclusive
Playwright/typecheck lease; single gate acquisitions have taken up to 28 minutes. Ruling T3-3: from
Task 4 on, implementers run tests + `typecheck:source` only, and the controller runs `lint` batched
every second or third task.

**An instruction can be wrong.** In Task 5 I specified an assertion that refs never contain a space.
The implementer refused it with evidence — 106 of 454 refs legitimately do, in forms like
`PR #1888 (claude/...)` — and was right. The rejected idea and its reason are recorded in the plan so
it is not retried. Expect and welcome that kind of refusal.

## 6. Known-failing baseline — do not chase

`tests/codex-cloud-setup.test.ts` (2 failures) and `tests/design-sync-contract.test.ts` (1 failure)
fail in this environment for reasons unrelated to this work.

## 7. Working notes

The session ledger, task briefs and reviewer reports live in the git-ignored
`.superpowers/sdd/2026-08-22-developer-hub-phase-2/`, with a copy outside the worktree at
`…/scratchpad/sdd-backup/`. They are working artifacts: everything a resuming session actually needs
is in this file, the plan, and the spec.

## 8. Outstanding for the owner, unrelated to this phase

Point-in-time recovery is still **off** on the live Supabase database (`#1K6T35`). Only the owner can
turn it on, from the Supabase dashboard.
