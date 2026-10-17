# Cross-repository Cloud source contracts

The built-in-only checker `scripts/check-cross-repo-cloud-contracts.mjs` catches known
instruction, bootstrap, checkout/preview ownership and legacy migration regressions.
It reads source artifacts; it never runs another repository's scripts, installs dependencies,
starts services, reads application environment files or changes another checkout.

The explicit `repositoryMatrix` in that script is the maintained adapter list. Change an
adapter with its owning repository's reviewed contract, and add a failing fixture before
changing a shared check. Project policies remain in their owning repositories; this tool
does not copy or compare the complete shared master or require identical client adapters.

| Repository                  | Adapter and required surfaces                                                                                                                                                                    |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `BigSimmo/PsychSift`        | npm lockfile, root client entries and continuation, task receipt, current Cloud policy, retained setup/maintenance aliases; explicit legacy profile migration selection and checkout guard       |
| `BigSimmo/Communication`    | pnpm lockfile/workspace policy, root client entries and receipt, local run/guard aliases, existing agent-rule validator/policy surface                                                           |
| `BigSimmo/Medications`      | pnpm lockfile/workspace policy, root client entries, portable workflow and fixture server, checkout/run/guard aliases, preview challenge/PID/root/port checks; Windows dispatch remains distinct |
| `BigSimmo/Ward-Flow`        | npm lockfile, root client entries and receipt, Cloud ownership guidance and fail-closed editing admission, setup/server aliases and database guidance                                            |
| `BigSimmo/Yarn`             | pnpm lockfile/workspace policy, root client entries, portable workflow/server, checkout/run/guard aliases and preview challenge/PID/root/port checks                                             |
| `BigSimmo/caring-contacts`  | npm lockfile, root client entries and receipt, maintained test/browser wrappers, existing synthetic-data and migration-authority boundaries                                                      |
| `BigSimmo/ward-flow-backup` | Inactive historical backup: README points to Ward Flow and disclaims runnable setup; application/agent bootstrap surfaces require explicit adapter review                                        |

Claude's `@AGENTS.md` import and Gemini's local Markdown link are both accepted. Missing,
empty, unreadable or linked-outside-checkout required surfaces fail. These are static
tripwires around known code and wording; paraphrases, dead-code lookalikes and arbitrary
behavior changes can escape them. Focused owning-repository tests remain necessary.

Run the current PsychSift working-tree check without setup:

```sh
node scripts/check-cross-repo-cloud-contracts.mjs --root .
```

Inspect one exact commit from an existing verified clone:

```sh
node scripts/check-cross-repo-cloud-contracts.mjs --repo Yarn --root /path/to/Yarn --revision <full-40-character-sha> --json
```

Audit all seven existing clones under one directory, named as in the table:

```sh
node scripts/check-cross-repo-cloud-contracts.mjs --all --repos-root /path/to/clones
```

`--all` resolves each clone's existing `origin/main` to a full SHA before reading Git blobs;
it does not fetch, change branches or inspect the working copies as main. Fetch freshness
is the caller's responsibility. A missing clone/ref, wrong origin or unavailable commit
is `unverified` and makes the command fail. The single-repository default reads the working
tree and reports its HEAD and dirty state; it does not present that source as immutable.
Use `--list` for the adapter matrix and `--json` for structured evidence. Exit 0 means all
requested static checks passed, 1 means failed/unverified sources, and 2 means invalid CLI
usage. Each result includes the exact revision, source mode and specific failures.

## CI scope and access

`.github/workflows/cloud-contracts.yml` checks this repository on affected main PRs/pushes.
It uses pinned checkout/Node actions, `contents: read`, no persisted credentials and no
dependency install. Ordinary PRs never fetch or execute another repository's code.

A manual run can explicitly select `audit_public_main`, corresponding to:

```sh
node scripts/check-cross-repo-cloud-contracts.mjs --root . --fetch-maintained
```

That option fetches the five other maintained repositories' `main` refs into disposable
temporary Git stores using fixed HTTPS URLs without inherited personal credentials or Git
credential helpers. Each fetched SHA is pinned before source checks. Private, inaccessible
or failed fetches are reported as `unverified` and fail the requested audit; they are never
counted as passes. The inactive backup is excluded from this maintained-source fetch and
remains available through the explicit local all-repository audit. No token, secret or
cross-repository GitHub permission is configured by this workflow.

A passing static check establishes none of native-client instruction loading, effective
host installation, provider access, runtime/server acceptance, migration approval, hosted
CI completion or observed deployment. Record those as separate evidence under each
project's existing safeguards and task receipt.
