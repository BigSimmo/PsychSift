---
name: plan
description: Plan safe risk-scoped PsychSift work by inspecting the current change, selecting the smallest local verification ladder, and separating provider-backed checks into explicit approval gates. Use before non-trivial changes or when asked what checks are needed.
---

# Plan

1. Confirm the task objective, affected areas, and preserve unrelated work.
2. Select the smallest sufficient local verification gate (`test:focused`, `verify:cheap`, or `verify:core`).
3. Keep genuine safety gates intact: Supabase migrations, diff integrity, secrets, and auth/privacy rules.
4. Keep live database, provider API calls, production readiness, and deployments approval-gated.
5. Proceed autonomously with routine reversible local engineering; do not stall on procedural friction.
6. Present the plan and verification results clearly in chat.
