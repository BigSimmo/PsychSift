---
name: claude-hook-exec-bit-trap
description: Hook scripts can ship non-executable because Windows core.fileMode=false hides it; pin mode 100755 in the index
metadata:
  node_type: memory
  type: feedback
  originSessionId: 0d5b8fb0-c1b6-4a1d-b4cf-962a819d4620
  modified: 2026-08-18T09:08:45.187Z
---

Verify the current host's Git configuration and the index mode when adding `.claude/hooks/*.sh`.
On a host with `core.fileMode=false`, a local `chmod +x` may leave the index unchanged; use
`git update-index --chmod=+x <path>` when required and confirm the tracked mode. Do not assume
the current host uses Windows, ReFS or a previously recorded project location.

The incident below describes the 2026-08-18 workstation, whose `core.fileMode` was `false`.
Its workstation record (`docs/archive/cloud-session-state-2026-10-16/dev-drive-project-location.md`)
is archived and does not establish current configuration.

**Why:** found on 2026-08-18. `.claude/hooks/session-start.sh` was `100644` while
`issues-surface.sh` and `pr-handoff-stop.sh` were both `100755`. It is also the only hook
registered by **bare path** in `.claude/settings.json` rather than as `bash "..."`, and its entire
body is gated on `CLAUDE_CODE_REMOTE=true` — so the one environment it does any work in is a Linux
web container, exactly where a non-executable checkout cannot run. That script provisions the Node
24 the engine floor requires; its own header names four PRs (#1611, #1697, #1705, #1740) blocked by
`npm ci` EBADENGINE before it existed.

**How to apply:**

1. After adding any hook script, run `git update-index --chmod=+x .claude/hooks/<name>.sh` and
   confirm with `git ls-files -s .claude/hooks/`.
2. Register it in `.claude/settings.json` as `bash "$CLAUDE_PROJECT_DIR/..."`, never a bare path,
   so the mode is never load-bearing.
3. `tests/session-start-hook.test.ts` now contains a `claude hook scripts are checked in runnable`
   block that fails on any hook that is not `100755` or that carries CR bytes. Do not weaken it.

Line endings are a sibling trap but currently clean: `.gitattributes` sets `* text=auto eol=lf`
and all hook blobs measured CR=0. A CR in a shell blob fails on Linux as `/bin/bash^M: bad
interpreter`. The same test pins this.

Resolve repository paths against the verified current checkout root, not this installed memory directory.
