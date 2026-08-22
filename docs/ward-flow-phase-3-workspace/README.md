# Ward Flow Phase 3 — subagent-driven-development workspace (durable copy)

This directory is a **committed copy** of the live superpowers workspace at
`.superpowers/sdd/2026-08-19-ward-flow-phase-3-role-screens/`, taken 2026-08-21 at commit
`74a174a44`.

## Why it exists

The live workspace is gitignored — `.superpowers/sdd/.gitignore` is a single `*`. That is the
skill's deliberate design: the workspace is scratch, and the git history is meant to be the
record. But the reports and reviews in it are **not** derivable from the git history. They are
the only place that records what a reviewer actually probed, which mutations were run and what
they killed, which claims turned out to be false, and why each decision went the way it did.
Losing them loses the reasoning behind sixty-eight commits.

So this copy exists to survive a clone, a push, a `git clean -fdx`, or the loss of the machine.
The live copy remains the working one — **a continuing session appends to
`.superpowers/...`, not here**, because the skill's scripts expect it there — and refreshes this
directory at each handover.

## What is here, and what is not

**Here (32 files):** every task brief (1 to 6, 6A, 7 to 12), every implementer report, every task
review and re-review, the Task 6 fix-round findings, the Task 7 controller addendum, and
`progress.md` — the full execution ledger.

**Deliberately not here: the eleven `review-<base>..<head>.diff` files** (366 KB). Unlike the
markdown, those are byte-for-byte derivable from commits that are now pushed, so they carry no
information the repository does not already hold. Regenerate any of them with:

```bash
git log --oneline <base>..<head>
git diff --stat <base>..<head>
git diff -U10 <base>..<head>
```

The ranges are named in `progress.md` and in each file's original name.

## Canonical copies

Two files here have a canonical committed home elsewhere; where they differ, the canonical one
wins:

| File in this directory | Canonical copy                       |
| ---------------------- | ------------------------------------ |
| `progress.md`          | `docs/ward-flow-phase-3-ledger.md`   |
| —                      | `docs/ward-flow-phase-3-handover.md` |

## Reading order

Start with `docs/ward-flow-phase-3-handover.md`, then `docs/ward-flow-phase-3-ledger.md`. Come
here only when you need the detail behind a specific task — what its reviewer checked, what an
implementer reported, or the exact requirements a task was given.

**One caution.** These are agent-authored working documents, captured as written. At least one
report in here asserts a fixture check that was never run and is false — the Task 6A review
caught it, and `progress.md` records the correction. Treat a report as a claim, not as evidence;
the ledger records what was independently verified.
