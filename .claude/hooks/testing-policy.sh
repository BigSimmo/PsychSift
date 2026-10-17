#!/usr/bin/env bash
# SessionStart hook — state the verification-cost policy for cloud sessions.
#
# Give a fresh Cloud session the current scoped-verification guidance. CI coverage
# depends on the selected event, draft state, paths and successful prerequisites;
# advice about expected jobs is never evidence that those jobs passed.
#
# So this hook says, once per session and in the model's own context, which gate
# to reach for first. It is scoped to cloud sessions because that is where the
# ask came from and where the session has no local history to draw on; a
# workstation session already has the docs, the receipts store, and the operator.
#
# Contract: READ-ONLY and unfailable. Emits nothing but `additionalContext` on
# stdout, exits 0 on every path including a malformed payload, and makes no
# decision — a session that ignores it simply runs the wider gate, which is the
# conservative outcome. SessionStart hook stdout is injected into context;
# stderr is not, which is why every line below goes to stdout.
set -uo pipefail

# Cloud sessions only. `session-start.sh` uses the same gate.
[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || exit 0

# Drain stdin so the caller never blocks on an unread pipe.
cat >/dev/null 2>&1 || true

root="${CLAUDE_PROJECT_DIR:-}"
[ -z "$root" ] && root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
[ -z "$root" ] && root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." 2>/dev/null && pwd || true)"
# Without the planner there is no advice to give, and inventing some would be
# worse than silence.
[ -f "$root/scripts/browser-test-plan.mjs" ] || exit 0

read -r -d '' context <<'POLICY' || true
[testing-policy] Verification cost policy for this cloud session.

Use the smallest check that covers the diff's plausible failures. CI selection
depends on event, draft and scope conditions and successful prerequisites. A
selected or deferred check remains pending until successful execution is observed.
Skipped, missing or failed jobs are not passing evidence.

Ask the planner which part of the browser suite the diff can break:

    npm run plan:browser              # dry run: the level, the specs, and why

Before executing browser checks, run `npm run ensure` and use its verified project
URL. Then `npm run plan:browser -- --run` executes the selected plan.

It fails closed: shared foundations, an unattributable UI file, or unknown scope
all escalate to the full suite on their own. You do not have to judge that.

Reporting rules, which the cost saving depends on:
- A narrowed run is NOT the full gate. Report focused browser proof at level <x>
  and name any broader checks still pending — never "verify:ui passed".
- Identify the jobs expected for this event and scope. Do not defer required local
  proof on an assumption that CI will repeat it; verify the job conditions first.
- Paste the decisive line of real output. Exit 0 alone is not proof.

Unchanged by any of this: GitHub remains the authoritative merge gate and runs
its configured scoped checks. Never weaken a required check to save local time.
Follow docs/agents/verification-gates.md for the complete current policy.
POLICY

# The context is a JSON string field, so the only characters that must be escaped
# are backslash and double quote; the heredoc above contains neither, and this
# substitution keeps that true if it ever does. Newlines become \n.
escaped="${context//\\/\\\\}"
escaped="${escaped//\"/\\\"}"
escaped="${escaped//$'\n'/\\n}"

printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"%s"}}\n' "$escaped"
exit 0
