# Cloud instruction activation

Use this guide after changing setup, agent rules or installed guidance, or when a fresh task still
behaves like an older session. Source publication, host installation and loaded chat context are
separate evidence states. A passing repository check proves none of the other two.

## Identify the selected source

Record the repository, checkout, branch and full commit using local Git. Confirm any working-tree
changes before treating the commit as the complete source. Follow the current host's actual tools,
network policy and supported configuration controls. Inspect credential names/readiness only;
never print values, open authentication files or copy credentials to another environment.

Use the current repository's setup only when that environment explicitly selects it. The retained
Codex legacy bootstrap needs its own isolated home/configuration when sharing a machine with
unrelated tasks; see [the Cloud policy](codex-cloud-environment.md). Claude profile installation
must respect its ownership manifest and preserve host modifications; see
[Claude container setup](../claude-cloud.md). A repository revision is not permission to provision
a host or activate a provider integration.

## Verify the three states

| State          | Evidence                                                                                                               | What remains unproved                                               |
| -------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Repository     | Exact checkout/revision and relevant source diff; applicable static and fixture checks                                 | Host installation and loaded prompts                                |
| Installed host | Supported setup result, selected configuration directory, source ownership and managed-artifact status                 | What an already-running chat loaded                                 |
| Active session | Supported context inspection or a fresh session reporting its loaded entry files and relevant continuation/topic rules | Future sessions, other environments and permission to run providers |

When a managed environment stores setup outside Git, inspect its supported configuration view and
record its revision separately. Do not edit a generated policy snapshot or infer that changing a
repository updates every saved environment. If the supported configuration view is unavailable,
report that layer as unverified and continue independent repository work.

## Client loading matrix

Verify only clients actually supported by the selected host. Do this at the next useful task;
dummy agent dispatches and provider requests are not activation tests.

| Client      | Expected source                                                                 | Verification in a fresh session                                                               |
| ----------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Codex       | Applicable AGENTS.md plus required continuation and topic pointers              | Inspect loaded context if supported; identify exact checkout and relevant safeguards          |
| Claude Code | CLAUDE.md importing AGENTS.md; scoped nested files; selected owned user profile | Inspect native context and setup status; check that nested guidance preserves root boundaries |
| Cursor      | Applicable AGENTS.md and selected skills/agents                                 | Inspect actual loaded rules and relevant canonical verification guidance                      |
| Gemini CLI  | GEMINI.md directing it to applicable AGENTS.md                                  | Confirm native import/reference loading and required continuation                             |
| Antigravity | Supported native adapters and their expanded targets                            | Inspect expanded context and aggregate/per-file limits; file existence alone is insufficient  |

After an update, start a fresh session or use a supported reload and inspect the result. Existing
chats can retain previous prompts. Do not overwrite personal memory or delete historical records
to simulate a context refresh. Use the managed installer’s ownership-aware reconciliation for
retired installed files; preserve modified/unowned content for explicit review.

## Completion evidence

Report the source revision, checks run, installation status and session-loading status separately.
State unavailable controls and retained modifications. An old instruction is resolved only at the
layers actually observed; a local edit is never a claim that every environment has been purged.
