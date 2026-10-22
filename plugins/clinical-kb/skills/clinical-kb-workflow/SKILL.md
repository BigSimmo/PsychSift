---
name: clinical-kb-workflow
description: Use when working in the verified PsychSift checkout, especially for local run, UI/browser QA, Supabase/OpenAI/RAG changes, clinical governance, dependency/upload shortcuts, or choosing verification.
---

# PsychSift Workflow

Use this skill for the PsychSift Next.js clinical reference RAG app. Establish the actual
checkout root with `git rev-parse --show-toplevel` and verify repository identity and ownership.
Root `AGENTS.md` remains authoritative. If these notes drift, inspect the repo before acting.
Follow the [current Cloud policy](../../../../docs/agents/codex-cloud-environment.md),
[user-controlled reasoning guidance](../../../../docs/agents/codex-reasoning-effort.md) and
[agent allocation policy](../../../../docs/agents/smart-agent-allocation.md); this plugin neither
selects a host profile nor changes the user's main-chat model or effort.

## Repo Basics

- App: Next.js 16, React 19, npm 11, Node 24.
- Package manager: npm with `package-lock.json`.
- Main app routes live under `src/app`; shared RAG, OpenAI, Supabase, safety, and validation logic live under `src/lib`.
- This project targets the live Supabase project `PsychSift Production` with project ref `sjrfecxgysukkwxsowpy`.
- Treat the older Supabase ref `qjgitjyhxrwxsrydablr` as stale.

## Local Server Safety

- For a terse `run` request, run `npm run ensure` and return the printed URL.
- For UI, browser, screenshot, mobile, routing, or styling work, run `npm run ensure` before browser checks.
- Never assume `localhost:3000`, `localhost:3001`, or `localhost:3002`.
- Before attaching to an existing server, rely on the repo's local project identity guard, especially `/api/local-project-id` as used by `npm run ensure`.
- Do not kill another project's server.

## OpenAI And API Cost Safety

- Do not run OpenAI API-backed tasks, live evals, ingestion enrichment, embeddings, image captioning, or provider-backed answer generation unless the user explicitly asks for API usage.
- Prefer repository-supported local/static/mocked or offline test launchers. Inspect their current
  scope before execution; do not alter authentication or unset credentials as an acceptance workaround.
  A sanitized child process does not prove the raw host boundary accepted a selected legacy profile.
- `npm run ensure` verifies local server ownership; it does not by itself prove the selected app
  configuration is provider-free or authorise live requests. Apply current host and task boundaries.
- Broad browser aggregates can be slower or flaky in no-API mode; prefer focused Vitest or focused Chromium specs first.

## Next.js Changes

- This repo explicitly warns that its Next.js version has breaking changes.
- Before changing Next.js routes, server components, middleware, config, or build/runtime conventions, read the relevant guide under `node_modules/next/dist/docs/`.
- Do not rely on older Next.js assumptions when the local docs disagree.

## Verification

- For localized source/config/test changes, start with the smallest focused check. Use `npm run verify:cheap` once only when cross-module or unknown risk warrants a broad offline gate.
- For UI, frontend, browser, routing, styling, reduced-motion, or forced-colors changes, run `npm run ensure` first, prove the affected journey, and use `npm run verify:ui` only when shared UI risk or handoff policy warrants the broad Chromium gate.
- For ordinary handoff confidence, use `npm run verify:pr-local`. Run `npm run verify:release` only when the user explicitly requests release confidence and approves its provider-backed checks.
- Follow the [canonical gate selector](../../../../docs/agents/verification-gates.md#gate-selection). For routine offline clinical ingestion, answer generation, source-governance, privacy or environment changes, run the smallest relevant offline domain check; use `npm run check:production-readiness:ci` when readiness/configuration structure is in scope. Before production release or activation, retain the strict approvals and release-mode `npm run check:production-readiness`; routine development does not establish release readiness.
- After Supabase env/config changes, prepare `npm run check:supabase-project` as an approval gate; do not run it without explicit user approval.
- Start from the smallest failing check and widen only after the focused failure is resolved.

## Git And Worktree Safety

- Preserve unrelated staged, unstaged, and untracked work.
- If starting from `main`, `master`, `develop`, or `release/*`, create a `codex/...` feature branch before editing when safe.
- Do not commit, push, force-push, reset, clean, merge into protected branches, or delete branches unless the user explicitly asks for that workflow.

## Clinical Safety

- This is a clinical reference prototype, not validated clinical decision support.
- Preserve source-backed answers, citations, document access controls, privacy boundaries, and fail-closed behavior on weak or unavailable evidence.
- For PRs touching ingestion, answer generation, search/ranking, source rendering, document access, privacy, production env, or clinical output, complete the clinical governance preflight in `.github/pull_request_template.md`.
