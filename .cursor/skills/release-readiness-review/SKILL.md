---
name: release-readiness-review
description: Reviews build validation, linting/type-checking, target database checks, clinical governance preflight approvals, and environment variables. Use before staging or production releases.
---

# Release Readiness Review Skill

Use this skill for explicitly requested staging or production release readiness. For routine development or PR handoff, use [the canonical gate selector](../../../docs/agents/verification-gates.md#gate-selection). Bare PR publication follows the separate publication route in `AGENTS.md` and does not invoke readiness work.

## Repository Review Protocol

Follow `AGENTS.md` review throttling and `docs/codex-review-protocol.md` before starting. Do not review opportunistically or mutate files during pure review. After a completed branch/PR review, use `npm run ledger:append` to create an immutable review record; never edit the frozen `docs/branch-review-ledger.md` table.

## Review Checklist

### 1. Build & Automation Checks

- **Static Analysis:** Run lint or typecheck only when the changed paths can plausibly fail that contract; do not stack them ceremonially.
- **Verification Gates:** Start with the smallest focused proof. Use `npm run verify:pr-local` for PR handoff confidence. `npm run verify:release` is reserved for explicit release confidence and requires user approval because it includes provider-backed checks.
- **Target database checks:** `npm run check:supabase-project` is provider-backed. Run it only with explicit user approval, using the repository-designated environment without printing secrets, to confirm the target is `PsychSift Production` ref `sjrfecxgysukkwxsowpy`.

### 2. Clinical Governance Compliance

- **Preflight Verification:** Complete all checklist items in `.github/pull_request_template.md`.
- **Secret Scan:** Confirm no private configuration files (`.env.local`), local debug logs, or keys are present in the git stage.
- **Production Readiness Check:** Follow [the canonical gate selector](../../../docs/agents/verification-gates.md#gate-selection): routine work uses the smallest relevant offline domain check, with `npm run check:production-readiness:ci` when readiness or configuration structure is in scope. Before production release or activation, run the bare `npm run check:production-readiness` in release mode with all applicable clinical, privacy, legal, security and provider approvals. Pending release approvals block release or activation.
