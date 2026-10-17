---
name: dev-drive-project-location
description: "The Database repo lives on the D: Windows Dev Drive (ReFS); C: worktrees belong to other agents and are out of scope"
metadata:
  node_type: memory
  type: project
  originSessionId: 0d5b8fb0-c1b6-4a1d-b4cf-962a819d4620
  modified: 2026-08-21T17:30:00.000Z
---

The canonical location for this project is **`D:\Repos\Database`** on a **Windows Dev Drive**
(`D:`, ReFS, 50 GB). The npm cache is on the same volume at `D:\.npm-cache`. Treat `D:` as the
project drive for every measurement, cleanup proposal, and capacity claim.

**Ignore the C: worktrees.** As of 2026-08-18 the repo had 48 registered worktrees split almost
evenly across volumes — 21-with-`node_modules` on `D:`, 21 on `C:` under
`C:\Users\joshs\.codex\worktrees\` and `C:\Users\joshs\.gemini\antigravity\worktrees\`. The `C:`
ones belong to Codex and Antigravity/Gemini sessions, not to Claude Code. Do not count them,
clean them, or cite them in disk figures. The user's instruction: "mark Dev drive as the project,
forget C drive."

**Why the drive matters, not just as trivia:**

- `core.fileMode=false` here, because Windows has no POSIX permission bits. Git therefore ignores
  filesystem exec bits entirely, and a local `chmod +x` is a silent no-op. The only way to make a
  script executable in the index is `git update-index --chmod=+x <path>`. This blind spot shipped
  `.claude/hooks/session-start.sh` as `100644` while both siblings were `100755` — see
  [[claude-hook-exec-bit-trap]].
- Capacity is a real constraint, not hygiene, and it is now **critical**: on 2026-08-21 `D:` had
  only **6 GB free of 50 GB (88% full)** — up from 51% full on 2026-08-18. 16 D: worktrees each
  hold a **real** (never junctioned/hardlinked) `node_modules` at ~0.89 GB, and worktree `.next`
  build output added another 4.8 GB. `npm run clean:worktree -- --merged --squashed --dry-run
--drive D` listed **14 already-merged worktrees holding 9.34 GB** — that command is the
  first-line remedy and it refuses to touch the current worktree, main, dirty trees, or
  patch-id candidates it could not corroborate. Every new `newtask` worktree costs ~0.9 GB.
  ReFS hardlinks are supported (probed directly), but npm extracts fresh copies rather than
  linking from cache, so there is no dedup in practice.

- Because the cache sits on `D:`, the `C:` worktrees are cross-volume from it and cannot link at
  all — another reason they are the other tools' problem, not this project's.
- `fsutil devdrv query D:` needs elevation and returned `Access denied`, so Dev Drive trusted
  state and whether `D:\.npm-cache` is a registered trusted cache are **unverified**. If it is not
  registered, Defender is scanning every install.

Related: [[local-test-failures-windows]] — `tests/session-start-hook.test.ts` has a pre-existing
Windows path failure (POSIX vs `C:\...` path assertion) unrelated to any current diff.
