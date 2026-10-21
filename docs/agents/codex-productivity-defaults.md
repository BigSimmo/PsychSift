# Codex Productivity Defaults

<!-- BEGIN:codex-productivity-defaults -->

## Codex productivity defaults

- Whenever agents are requested or otherwise permitted, use [smart agent allocation](smart-agent-allocation.md): task-appropriate explicit model/effort, bounded briefs, separate ownership, independent review and reuse of valid evidence. Use the same policy in Cloud where supported; missing controls are a reported capability limit, not permission to invent routing or lower review requirements.

- Treat terse prompts as workflow shortcuts when the intent is clear. If the user says `run`, execute `npm run ensure`, verify the project identity through that helper, and return the printed local URL without a long log dump.
- For non-trivial changes, start from concrete repo state: branch, `git status`, relevant package scripts, recent failures, and sanitised local logs when runtime behavior is involved. Use `docs/agents-guide.md` for task navigation and `docs/codebase-index.md` for architecture (routes: `docs/site-map.md`). Do not substitute an old handoff or a successful command for current identity and ownership.
- For UI, browser, styling, routing, accessibility, or screenshot work, run `npm run ensure` before opening the app, then use browser QA and the smallest relevant UI proof before broader gates.
- Select the verification tier in [AGENTS.md](native-startup/process-hardening.md). Read-only work needs no application test command; documentation needs appropriate static proof. For behavioural work, prefer the smallest relevant failing check before widening. Do not automatically stack `npm run verify:cheap`, `npm run verify:ui`, or `npm run verify:release`, and preserve required gates and provider boundaries.
- Use `npm run test:focused -- --files <paths>` only for safe source-only iteration. It fails closed for deleted files and test/configuration infrastructure; follow its instruction to run `npm run test` in those cases.
- When the user says `safely`, preserve unrelated staged, unstaged, and untracked work; stop only temporary processes created by the current task when appropriate. Repository membership alone does not establish ownership of a process. Verify the requested result instead of doing broad cleanup.
- After auth, Supabase, ingestion, answer generation, search/ranking, clinical output, or source-governance changes, use the relevant domain requirements in [AGENTS.md](native-startup/process-hardening.md), including `npm run check:production-readiness` where required. `npm run check:supabase-project` after Supabase env/config changes remains provider-backed and needs the applicable explicit authorisation. Report an unrun required provider check rather than treating the task or this list as approval.
- For handoff, archive-safety, or upload-style requests, inspect branch/upstream/status first and follow the exact requested workflow. Only commit or push when authorised. An explicit bare PR publication uses its dedicated route, and a pause means preserve state and stop rather than add handoff verification.
- For broad chat/worktree reconciliation or cleanup, run `node scripts/reconciliation-preflight.mjs`, use the cheap ownership/PR/ledger/ancestry funnel before patch comparison, and never print raw process command lines.
- For codebase appraisal exports, stage outside the repo, include `EXPORT_MANIFEST.md`, exclude secrets/dependencies/build outputs/local state, and verify the archive can be opened before handoff.
- When a repeated repo-specific workflow is discovered, update its maintained source only within the authorised scope. Persist personal memory only when the user explicitly requests it.

<!-- END:codex-productivity-defaults -->
