# Process clean-up proposal (October 2026)

_Drafted 2026-10-18 from `main` at the time of writing. Proposal only: nothing has been retired,
merged or deleted, and no owner decision is recorded here. The owner decides each item later; a
decision then goes in `docs/decisions/` in the change that acts on it._

Three areas have grown faster than they are pruned: the `check:*` scripts, the issues ledger, and
three companion docs that restate ledger status by hand.

## (a) `check:*` scripts

`package.json` has 97 `check:*` scripts. For each one, this review counted references by npm name and
by script file in `.github/` (workflows, Dependabot), `.githooks/`, `scripts/` (recursively), `tests/`
and other `package.json` scripts, and used `git log -S` on `package.json` for the date each was added.
Hosted CI run history was **not** read (it needs GitHub access), so "never fails in practice" below is
inferred from the code, not from run logs.

A script with no automatic caller is not automatically useless: several are deliberate manual or
provider-backed tools. The table separates those from real candidates.

### Candidates to retire

| Script                            | Why it looks retirable                                                                                                                           | Check before retiring                                                     |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| `check:m13-migration`             | Points at `scripts/archive/`. A one-off live check for a July migration that has long been applied. No workflow, hook, test or script calls it.  | Keep the archived script file as history if wanted; drop the npm entry.   |
| `check:july8-live-batch`          | Same: `scripts/archive/`, the July-8 batch is recorded applied and verified (2026-07-13). Only docs mention it.                                  | Update `operator-backlog.md`, which still cites it as the verify command. |
| `check:retrieval-owner-migration` | Added 2026-07-06 for a one-time owner migration. No automatic caller.                                                                            | Confirm the migration it checks is on `main` and live.                    |
| `check:default-acl`               | Added 2026-07-17. No workflow, hook, test or script caller.                                                                                      | Confirm `check:function-grants` covers the same default-privilege risk.   |
| `check:knip:exports`              | Runs with `--no-exit-code`, so it **cannot fail**. It is a report, not a check.                                                                  | Rename to a `report:` script, or drop it.                                 |
| `check:dev-drive-cache`           | Windows Dev Drive workstation check only. No caller. Most sessions now run in Linux containers.                                                  | Keep only if a Windows workstation is still in use.                       |
| `check:codex-cloud`               | Legacy Codex Cloud setup check (`docs/agents/codex-cloud-environment.md` calls that setup optional and legacy). Only tests call the script file. | Keep the tests if the setup stays; otherwise retire both.                 |

### Candidates to merge

| Scripts                                                                                                 | Overlap                                                                                                                                                 | Suggested shape                                                          |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `check:worker-python-lock`, `check:worker-python-cloud-lock`, `check:worker-python-locks:static`        | Three entry points to one script (`scripts/check-worker-python-lock.mjs`). Only the cloud variant is called by name anywhere.                           | One script with flags documented in its help text.                       |
| `check:privacy-readiness` and `:release`; `check:production-readiness` and `:ci`                        | Deliberate pairs (offline and release modes). Not redundant, but four names for two checks.                                                             | Keep; document the pairs together in `docs/process-hardening.md`.        |
| `check:outstanding-issues-snapshot`; `check:design-sync-contract`, `check:design-system-adoption`       | Each is already run inside a parent (`check:outstanding-issues`, `check:design-system-contract`), so running both runs it twice.                        | Keep the child names for focused use, but say so in the gate manifest.   |
| `check:github-shell-access` and `:live`                                                                 | Self-test and provider-backed live variant of one tool.                                                                                                 | Keep; the live one needs approval.                                       |
| `check:drift`, `check:chain-mirror-parity`, `check:drift-manifest-freshness`, `check:migration-history` | Four views of schema drift. They test different things (live schema, chain mirror, manifest staleness, recorded history), so merging would lose signal. | Keep separate; list them together in `docs/database-drift-detection.md`. |

### Self-test-only checks

These run only `--self-test`, so they fail only when the tool itself is broken, never because of
repository content: `check:ci-scope`, `check:verification-plan`, `check:browser-test-plan`,
`check:gitleaks-pinned`, `check:github-shell-access`. That is useful, but the `check:` name suggests
they check the repository. Consider a `selftest:` prefix.

### Not wired anywhere, but should stay

These have no automatic caller and look orphaned, but each is a deliberate tool. The better fix is
wiring, not retirement:

- `check:hazard-register-snapshot` (added 2026-10-14): not in any workflow or hook. If the hazard
  register snapshot matters, add it to the docs or heavy static set.
- `check:source-catalogue`, `check:source-acquisitions`: used by the `sources` skill by hand. Consider
  CI on changes to `src/data/source-acquisitions.json`.
- `check:specifiers-search-index`, `check:forms-review-sheet`, `check:site-content-p03`: generated
  file freshness checks with no CI caller. Either wire them on their input paths or drop them.
- `check:stale-docs`, `check:dependency-drift`, `check:dead-code-candidate`, `check:primary-checkout-lease`,
  `check:ledger-stamp-retention`, `check:base-freshness`, `check:enrichment-health`,
  `check:locality-metadata`, `check:env-parity`, `check:local-presence`: manual or operator tools.
  `check:dead-code-candidate` is required by `docs/agents/dead-code-deletion.md` and must stay.
- Provider-backed checks (`check:supabase-project`, `check:indexing`, `check:drift`,
  `check:migration-history`, `check:production-readiness`): must stay; they need approval to run.

## (b) Trim `docs/outstanding-issues.md`

**Where it stands.** The file is about 650 KB and about 1,000 lines. It holds 105 open rows (16 P1,
51 P2, 38 P3) and about 800 resolved rows. The resolved archive is roughly four fifths of the file,
and many open rows carry several "PRIOR DETAIL" paragraphs, because an update replaces the whole
detail cell and later sessions restore the old text by hand.

**The queue does not match the priorities.** The recommended execution queue holds five rows:
`#018` (P2), `#001` (P3), `#055` (P2), `#057` (P2) and `#100` (P2). It holds **none** of the 16 P1 rows,
so a session that follows the queue never reaches the items marked "do next".

The 16 open P1 rows on 2026-10-18:

| ID        | Summary (shortened)                                                                       |
| --------- | ----------------------------------------------------------------------------------------- |
| `#J8SJQ9` | Antipsychotic metabolic monitoring returns a source-backed stub instead of an answer      |
| `#BS3SN9` | Close remaining privacy provider, legal and clinical approvals                            |
| `#GJHKYC` | Do not re-index until the worker has the extraction fix; then re-index with a canary pair |
| `#HTZPQ8` | Live public catalogue is still the 2026-08-24 epoch-zero freeze                           |
| `#TN512M` | Live monitor, Sentry and CI on main detect failures and report to nobody                  |
| `#HYSWAF` | Railway deploys every main push without waiting for required checks                       |
| `#05WXHX` | Medication and therapy records have zero source links but tell clinicians to check them   |
| `#ZPHK2F` | Owner design decision: first publication versus adoption for the site catalogue           |
| `#MSJT12` | Production deploys stopped landing for 27 hours on 2026-09-21; root cause unknown         |
| `#F9HZEG` | No two-user staging isolation proof for CME and On Call                                   |
| `#ZZ4RAP` | Clinical eval battery misses high-risk scenarios                                          |
| `#JYH1FH` | 1,935 documents show "Locally reviewed" with no recorded reviewer                         |
| `#46VNY9` | Repair the 1,935 "Locally reviewed" labels                                                |
| `#NBJQD8` | Medication interaction lexicon sign-off is out of date                                    |
| `#Z12CBC` | Unwired WA MHA Form 6A/6B print component carries unverified statutory text               |
| `#BDFFYF` | WA MHA Form 6A/6B component: sign-off or removal after 13 Nov 2026                        |

`#Z12CBC` and `#BDFFYF` already have pending `done` requests in the inbox, so after the next
reconciliation 14 P1 rows remain.

**Proposed plan** (each step through the inbox and a dedicated reconciliation branch, never by hand):

1. **Rebuild the queue from the P1 rows.** Use `issues:queue` and `issues:add` requests so the queue
   holds the P1 rows that a session can actually start, with owner-only rows (`#BS3SN9`, `#ZPHK2F`)
   marked as waiting on the owner. Keep `#057` in the queue, since `#F9HZEG` depends on it.
2. **Move the resolved archive out.** Split "Resolved / archive" into a dated
   `docs/outstanding-issues-archive-2026.md` (or by quarter), leaving the main file with open rows and
   the queue. The ledger scripts, `check:outstanding-issues`, the session-start hook and the
   `issues` skill all read this file, so this is a scripted change with tests, not a docs edit.
3. **Fold the "PRIOR DETAIL" chains.** For each open row, keep the current state and next action in
   the detail cell and move the history into the archive file with a link. An `update` that appends
   rather than replaces would stop the chains growing back.
4. **Set a size target** for the live file (for example, under 100 KB) and have
   `check:outstanding-issues` warn above it.

## (c) Stale companion docs

Three docs restate ledger status by hand and had drifted. This change refreshes only the status lines
where the ledger clearly shows the current state:

- [`operator-backlog.md`](operator-backlog.md) (last verified 2026-08-23): marked the Railway webhook
  token row (`#B6JP6F`, resolved 2026-09-26) and the auth connection-cap row (`#011`, resolved
  2026-08-18) done; noted that `#025` (webhook activation) was resolved 2026-08-18; linked the staging
  soak row to `#057`, `#F9HZEG` and the rehearsal plan.
- [`launch-operator-runbook.md`](launch-operator-runbook.md): replaced the 2026-07-14 current-state note
  with a dated one naming the open staging soak (`#057`), data restore (`#QVVS6W`) and approvals
  (`#BS3SN9`).
- [`production-readiness-checklist.md`](production-readiness-checklist.md): added a dated ledger status
  line for the same open items.

**Proposal for later:** these three docs should link to ledger rows instead of copying their status,
so they cannot drift again. That is a structural change for the owner to approve.
