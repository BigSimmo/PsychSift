---
name: audit
description: Perform a deep evidence-backed PsychSift repository audit and produce severity-ranked, reproducible findings without mutating code unless fixes are requested. Use for repo-wide audits, risk assessments, or exhaustive review requests.
---

# Audit

1. Define scope, read `docs/codex-review-protocol.md`, and check prior reviews with `npm run ledger:lookup -- <ref> --scope "<scope>"` rather than reading the ledger table directly.
2. Inventory architecture, trust boundaries, changed areas, tests, and documented controls.
3. Trace realistic correctness, security, privacy, clinical, data-loss, and reliability failures.
4. Prove findings with exact files, lines, triggers, impact, and focused checks.
5. Rank findings by severity and distinguish confirmed defects from residual risk.
6. Remain read-only unless the user explicitly asks for fixes; keep provider checks approval-gated.
