---
name: never-print-env-values
description: "Report configuration names/presence without inspecting credential values; retain the lesson from a 2026-08-18 disclosure incident"
metadata:
  node_type: memory
  type: feedback
  originSessionId: e184e33f-a8c2-420c-b8f0-dbb9ddd6fc4d
  modified: 2026-08-18T05:59:12.504Z
---

Use host readiness metadata or **variable names and presence only** when checking configuration.
Never print, inspect, decode, copy or persist credential values to diagnose a problem. Follow the
current credential and host policy (`docs/agents/codex-cloud-environment.md`); a dated
incident note does not authorize secret inspection.

**Why:** on 2026-08-18 an env-inspection script special-cased only `SUPABASE_SERVICE_ROLE_KEY` and printed every other line raw. That dumped a live staging `sb_secret_…` key, the publishable key, and the anon JWT into the transcript, forcing a key rotation. The masking logic was correct for the one variable it anticipated and wrong for the file as a whole — an allowlist fails open on exactly the variable you did not think of. A denylist-by-default is the only safe shape, because you cannot enumerate in advance what a user has put in their env file.

**How to apply:** Report names/presence or supported readiness evidence without reading out values.
Do not decode a JWT or inspect prefixes/lengths as a diagnostic shortcut. Deleting a printed value
afterwards does not undo exposure; use the authorized incident response process if exposure occurs.
Related: archived database coordination (`docs/archive/cloud-session-state-2026-10-16/db-remediation-coordination-state.md`).

Resolve repository paths against the verified current checkout root, not this installed memory directory.
