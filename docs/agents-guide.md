# Agent onboarding and task navigator

Use this page to find the right instructions for the task. The repository's working
rules live in [AGENTS.md](../AGENTS.md) and the named references below, within the
instruction hierarchy. This guide provides navigation; it is not a second copy of
provider permissions, review-bot rules or verification requirements.

## Choose the task first

| Working on                                                  | Start with                                                               | Important distinction                                                                                                        |
| ----------------------------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| PsychSift: clinical knowledge, documents, search or answers | [Repository setup](../README.md) and [codebase index](codebase-index.md) | Provider access and production effects have explicit boundaries. A local/offline result does not establish hosted behaviour. |
| General tooling, documentation or repository maintenance    | [AGENTS.md](../AGENTS.md), then the applicable reference below           | Start with inspection. A documentation task does not require an app server or broad application tests.                       |

A branch name, old handoff or successful command alone does not establish that this
is the intended checkout. Verify identity and ownership before writing. Active plans
and acceptance evidence belong to their current task; historical reports are leads.

## Find the instructions for the job

Whenever agents are used, apply [smart agent allocation](agents/smart-agent-allocation.md)
for model/effort selection, ownership, independent review and Cloud capability limits.

Also see [DOCS-SYSTEM.md](DOCS-SYSTEM.md) for the documentation operating system (pipeline, stamps, recheck triggers, PsychSift registry).

| Task or concern                                              | Authoritative reference                                                                                                                                                                                                             |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Select verification, reuse evidence, choose browser coverage | [Verification gates](../AGENTS.md#process-hardening-phases)                                                                                                                                                                         |
| Start or prepare a Windows Desktop worktree                  | [Desktop worktree setup](agents/codex-desktop-worktree-setup.md)                                                                                                                                                                    |
| Use the dependency shortcut                                  | [Dependency workflow](agents/codex-dependency-shortcut.md)                                                                                                                                                                          |
| Work in Codex Cloud                                          | [Current Cloud policy](agents/codex-cloud-environment.md); [archived legacy setup, when selected](archive/codex-cloud-legacy-profile-2026-10-16.md#scope-and-selection)                                                             |
| Work in Cursor Cloud                                         | [Cursor Cloud](agents/cursor-cloud.md)                                                                                                                                                                                              |
| Apply repository productivity defaults                       | [Productivity defaults](agents/codex-productivity-defaults.md)                                                                                                                                                                      |
| Choose a skill or handle outstanding work                    | [Skills and issue ledger](agents/repository-skills-and-issues.md#repository-productivity-skills), [.agents overview](../.agents/README.md)                                                                                          |
| Review, maintain or publish a pull request                   | [Bare publication](../AGENTS.md#bare-pr-publication-is-not-readiness-work), [Run PR](agents/pull-request-workflow.md#run-pr) and [PR follow-through](agents/pull-request-workflow.md#follow-ci), using the exact requested workflow |
| Resolve review ownership, routing or throttling              | [Review routing](agents/codex-review-throttling.md)                                                                                                                                                                                 |
| Use the upload shortcut                                      | [Upload workflow](agents/upload-shortcut.md#upload-shortcut)                                                                                                                                                                        |
| Investigate a defect                                         | [Bug-hunter shortcut](../AGENTS.md#bug-hunter-shortcut)                                                                                                                                                                             |
| Change routes, controls or bundle-sensitive UI               | [Wiring and bundle budget](../AGENTS.md#page-and-button-wiring)                                                                                                                                                                     |
| Apply external skills or report evidence                     | [Skill precedence and evidence](../AGENTS.md#external-skill-precedence)                                                                                                                                                             |
| Remove apparently unused code                                | [Code deletion safeguards](../AGENTS.md#deleting-code-you-believe-is-dead)                                                                                                                                                          |
| Handle outstanding work                                      | [Issue-ledger ownership](agents/repository-skills-and-issues.md#outstanding-work-memory-issues)                                                                                                                                     |
| Change Claude Code hooks                                     | [Hook contract](../AGENTS.md#claude-code-hook-scripts)                                                                                                                                                                              |
| Select a supported reasoning route                           | [Reasoning calibration](agents/codex-reasoning-effort.md)                                                                                                                                                                           |

Read only the references the task needs. Required specialist guidance still applies;
this navigator does not make every linked procedure a mandatory startup step.

## Start safely and verify proportionately

1. Read the relevant task entry point and applicable instructions; establish
   branch, current changes and ownership. Preserve concurrent and uncommitted work.
2. Use the platform-specific setup contract if dependencies are actually needed.
   Runtime requirements come from the manifests and lockfile. Do not run the Cloud
   provisioner on Windows or reinstall dependencies merely to edit documentation.
3. When the task needs the running app, use `npm run ensure` and its printed URL.
   Follow the project-identity requirement. Do not assume a port or start the worker
   as a generic onboarding step: inspect its provider and data effects first.
   When adding environment variables, update the schema in `src/lib/env.ts` and
   document them in `.env.example`; never commit credentials.
4. Select proof using [verification gates](../AGENTS.md#process-hardening-phases). Do not
   automatically stack `verify:cheap` and `verify:pr-local`, and preserve the separate
   bare-publication route when that is what the user requested.
5. Report what was actually inspected or executed, the exact relevant result and
   any blocked or unrun acceptance. Keep local, hosted and physical-device evidence
   distinct. Commit or publish only within the user's actual authority.

## Tooling and documentation ownership

<!-- Named map retained for CLAUDE.md orientation (“AI tooling map”). -->

**AI tooling map** (system → configuration ownership):

- Root [AGENTS.md](../AGENTS.md) and its references carry repository instructions.
  [CLAUDE.md](../CLAUDE.md) provides platform orientation. Global personal preferences
  belong outside the repository; do not copy private configuration into these docs.
- [.agents/skills/catalog.json](../.agents/skills/catalog.json) defines canonical
  repository skills. `npm run skills` lists them; `npm run check:skills` checks the
  supported surfaces. Aliases are not additional skills.
- Tool availability and authentication depend on the current host and session.
  Repository configuration describes intended integration, not proof that an MCP,
  OAuth session or hosted connector is callable. Use the relevant Cloud/setup and
  provider guidance before accessing services; do not copy token or endpoint tables
  here as another operational authority.
- For authorised read-only inspection, prefer available registered MCPs before
  dashboards, subject to the exceptions below. Keep Supabase MCP read-only and
  never raw-edit retrieval RPCs via `execute_sql`. Keep GitHub Checks/Actions
  inspection within the approved read scope; do not broaden permissions.
- Preserve the Supabase Auth database connection-cap constraint (`#011`): use the
  dashboard for an authorised change, not a raw SQL or MCP workaround. See the
  [connection-cap runbook](auth-connection-cap-runbook.md).
- For peer-library documentation and the existing Context7 setup, see
  [the platform guide](agents/cursor-cloud.md#context7-setup-and-peer-library-documentation).
  Next.js APIs use the bundled version's documentation as required by AGENTS.md.
- Preserve the existing maintenance constraint: do not add another AI system or
  grow the skill count without retiring something. Prefer at most five active MCP
  servers per session; avoid loading redundant tool surfaces. Explicit user
  directions and the governing instruction hierarchy still control.
- Figma Make is exploration; [the design system](design-system/README.md) and
  its gates remain product design authority. Cursor Cloud does not inherit Desktop
  OAuth. Use Chrome DevTools for relevant performance/debugging work without
  leaving redundant browser MCP servers active.
- [The organisation map](organisation/README.md) records which area owns every
  file and each area's canonical docs; `npm run check:organisation -- --files <path>`
  answers "where does this belong and what do I read first". Placing a file never
  grants clinical, ranking, privacy or database approval.
- [The documentation index](README.md) distinguishes maintained instructions,
  generated views and historical evidence. Correct the maintained source and its
  necessary references; do not rewrite historical reports to make old results look
  current. Generated artifacts must follow their documented generator.

## Review comment disposition markers (#JZM7RM)

To prevent dual competing responders from answering the same PR review comment (observed on PR #2249 where both a repo workflow and an app-level watcher generated duplicate competing commits), all review-thread work — interactive sessions and any `Run PR` sweep alike — follows one lifecycle:

- **App-level / Client watchers**: Interactive desktop or client app watchers ("Autofix pull requests") must stand down and not compete on repository pull requests. Do not instruct an interactive agent session to concurrently fix a review comment that another session is already addressing.
- **Interactive human / agent sessions**: When asked to fix comments or running a `Run PR` sweep, always check whether a thread already carries a disposition marker (`<!-- codex-thread-disposition:resolved -->`) before acting on it. Never create competing commits on the same review finding.
- **Review comment lifecycle and disposition markers**:
  - For every fixed or fully dispositioned thread, start the thread reply with `<!-- codex-thread-disposition:resolved -->`.
  - On the next line, include `<!-- codex-thread-result:fixed-head:<40-character commit SHA> -->` for code fixes or `<!-- codex-thread-result:no-change -->` for no-code dispositions.
  - Threads requiring human judgment, architectural decisions, or touching clinical holds must be left open with an explanatory reply instead of using the resolved marker.
