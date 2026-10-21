# Codex Cloud operating policy

<!-- BEGIN:codex-cloud-environment -->

## Codex Cloud environment

This is the canonical operating policy for Cloud tasks in this repository. Follow the current
system, developer and user instructions, then the applicable repository rules. Old chats, copied
prompts, archived runbooks and machine names are evidence to verify, not a second source of authority.

### Start or resume the current task

1. Check the repository, branch, commit, worktree, relevant changes and existing task checkpoint.
   Preserve unrelated work. Resume verified same-task edits; a dirty working tree alone is not a
   reason to discard work, demand a new task or restart completed analysis.
2. Inspect the current host's permissions, network policy and callable tools as needed. Host status,
   saved configuration, successful tool execution and loaded instructions are separate evidence.
   An empty capability-summary list does not negate tools that are actually callable.
3. Identify the concrete files and acceptance checks for the request. Continue independent
   authorised work when a particular tool, dependency, provider or approval is unavailable.
4. Use the repository-supported toolchain and lockfiles. Run checks appropriate to the change,
   through the normal wrappers/coordinator. Do not run a server, browser suite, install or broad
   baseline merely to prove that a session started.

### Models, agents and confirmation

Respect the user's main-chat model and effort. Accept ordinary-language confirmation; do not ask
again for a special marker or resubmission. Recommendations do not attest runtime settings.
Use [reasoning guidance](codex-reasoning-effort.md) and
[agent allocation](smart-agent-allocation.md) when relevant. Select only models/arguments exposed
by current tools; old model identifiers and unavailable skills are not prerequisites for ordinary
work. Keep explicitly selected specialist programme review and evidence contracts scoped to that
programme. Do not copy its launch gates into unrelated tasks.

### Tools, providers and credentials

Use actual callable tools rather than assuming a particular account tier, connector name or
historical workstation setup. Repository MCP templates describe configuration, not hosted readiness.
Desktop files, local services, OAuth state and private environment files do not automatically transfer.

Preserve existing task authorisation; do not repeatedly ask for the same authorised action. Paid
calls, provider operations, production/database changes and merges retain their applicable project
boundaries. A broad audit is not authority to change a live service or sign clinical/legal approvals.
Prefer authenticated connectors for authorised provider work where available. Missing shell GitHub
credentials, connector access and network access are distinct capabilities.

Never print, copy, persist or forward credential values, or inspect them to diagnose readiness.
A variable name alone proves neither a leak nor effective access. Use names-only diagnostics and
host metadata. Do not retrieve a token, bypass host/network policy, or alter authentication to turn
a failing check green. Preserve proxy and CA configuration supplied by the host.

Keep the production Supabase MCP template pinned to project `sjrfecxgysukkwxsowpy`, `read_only=true`
and `docs`/`development` metadata, excluding SQL, clinical rows and logs. Broader tooling requires
separate authorised configuration and project safeguards. Keep tracked MCP templates secret-free
and preserve their disabled-by-default settings; do not broaden them to imitate another host.

### Legacy setup: explicit selection only

The older offline/connected bootstrap is an opt-in setup, not a default requirement for every Cloud task.
The [archived legacy runbook](../archive/codex-cloud-legacy-profile-2026-10-16.md) applies only when
the owner or selected environment explicitly adopts it, or a task tests/repairs that bootstrap.
Linux, a `connected` host label, `CODEX_CLOUD=1` or an earlier probe does not select it.
Do not install its shims, force profile variables or rerun maintenance for an unrelated host.
For the retained bootstrap's checkout containment, config-home selection, cache identity and
read-only retirement inventory, use [the current legacy bootstrap notes](../cloud/codex-cloud-legacy-bootstrap.md).

An explicit legacy environment/runtime check retains its fail-closed credential, profile, base,
toolchain and browser contracts. A configured legacy profile selects that validation; an invalid
profile must fail, not silently fall back to static checks. Static source checks do not establish
runtime readiness. Retained legacy scripts are operational tools, not general startup instructions.

### Raw-boundary failure and local policy repair

A failed raw-boundary check does not prohibit an explicitly requested local policy review or repair.
For a selected legacy profile, exit `2` / `FAIL-KNOWN` applies only to inherited `GH_TOKEN` and
`OPENAI_BASE_URL`, alone or together. It permits the documented provider-free profile-and-shim
path; it is still a failed raw boundary. Exit `1` / `FAIL` + `STOP` for any other provider name
blocks application execution, live provider access and full runtime acceptance.

After either failure, explicitly authorised local instruction repair and provider-free offline
checks may proceed through the normal offline wrappers in a scrubbed child using the generated
`~/.clinical-kb-codex-cloud.sh` profile or `~/.local/bin/{node,npm,npx}` shims. Use only the checks
needed for that authorised repair. Do not run checks that call providers indirectly. Bounded
shell/Python document checks that do not load dependencies or secrets remain available too.
Setup, maintenance and package installation remain blocked after either failure; the command-shim
installer permits the known exit `2` only for its documented restricted profile path.

Never invoke OpenAI or GitHub clients from a raw parent carrying those names or bypass the scrub
with another binary. Scrubbing a child does not remove inherited values from the parent, prove the
parent clean, authorise provider access or permit an authentication bypass. Preserve the failed
names-only result; do not unset a name to manufacture a passing raw-parent check.
For other host-managed setups, follow current host boundaries and affected-operation checks;
do not turn a legacy probe result into a universal task stop or a claimed passing result.

Investigate repeated failures using supported host configuration and names-only evidence. Repeating
an identical restart is not a repair. A repository edit cannot remove a variable already inherited
by a running process. Do not claim which component injected a value without evidence.

### Activation and retained context

Use [Cloud instruction activation](cloud-instruction-activation.md) to verify the selected source,
installed host and fresh native session separately across supported clients.

Host settings, repository revisions and active chat context update separately. Changing an
environment does not edit Git files; local edits do not reach other checkouts until published and
integrated. Existing chats retain earlier messages, but those messages do not override newer user
instructions or the verified current policy. Re-read changed guidance instead of following a stale
checkpoint blindly. Use a supported reload or fresh task only when the host actually requires it.

Cloud profiles must not seed old machine state or session coordination boards as current project
memory. Seed only reviewed durable guidance from an explicit source manifest; keep dated state in
the archive. A source cleanup does not authorise deleting or overwriting existing host-written
memories. Resolve conflicts using current instructions and evidence, not an old task list.

Report the selected revision, completed checks and concrete remaining limitation. Distinguish
local source changes, publication, merge and observed activation. Never claim all environments
are updated based on a local check. Container browser evidence is not physical Safari/PWA proof.
Historical records stay out of startup instructions and automatic policy scanning unless requested.

<!-- END:codex-cloud-environment -->
