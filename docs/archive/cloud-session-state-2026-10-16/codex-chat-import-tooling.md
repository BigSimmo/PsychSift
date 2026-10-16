---
name: codex-chat-import-tooling
description: Scripts and store layout for importing Codex Desktop chats into Claude Code, incl. the two-store registry/transcript split
metadata:
  type: reference
---

Two durable scripts (written 2026-08-18, outside any repo):

- `~/.claude/scripts/codex-import.mjs` — list/select/convert Codex rollouts into Claude Code
  transcripts. Flags: `--list [--full]`, `--cwd`, `--map-cwd`, `--only`/`--exclude`
  (index, `3-9` range, id prefix, `roots`, `subagents`), `--apply`, `--remove`.
- `~/.claude/scripts/codex-register.mjs` — create/remove the desktop-app session-list entries
  for those transcripts. `--apply`, `--unregister`.

Both idempotent; re-running only picks up what is missing.

**Claude Code Desktop keeps conversations in two separate stores**, and this is the thing that
is not obvious: writing a transcript alone leaves the chat invisible in the app.

1. Transcript — `~/.claude/projects/<cwd-with-non-alphanumerics-replaced-by-dashes>/<cliSessionId>.jsonl`
2. Session registry — `~/AppData/Roaming/Claude/claude-code-sessions/<id>/<id>/local_<uuid>.json`

The sidebar is built from the registry; each entry points at its transcript via `cliSessionId`.
The app caches the registry at startup, so new entries need an app restart. Keys present in
every registry entry: sessionId, cwd, originCwd, lastFocusedAt, createdAt, lastActivityAt,
model, effort, isArchived, title, permissionMode, enabledMcpTools, remoteMcpServersConfig,
alwaysAllowedReasons, sessionPermissionUpdates.

Codex side: transcripts at `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` carry no title;
the sidebar titles live in `~/.codex/session_index.jsonl`, appended on every rename, so the
newest `updated_at` for an id wins. Most rollout files are NOT chats — Codex spawns an
anonymous approval-reviewer thread per tool approval (`thread_source: subagent` with no
`agent_nickname`/`agent_path`); of 141 local files only 27 were real chats.

Cloud-run Codex tasks have no local rollout at all and cannot be imported from disk.

Related: [[local-test-failures-windows]]
