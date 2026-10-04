@AGENTS.md

# PsychSift — orientation for AI assistants

Private, local-first medical guideline RAG knowledge base for a psychiatrist in Perth,
Australia. Clinical reference documents are uploaded to private Supabase Storage, indexed
(text + OCR + image captions) into pgvector, and answered with citations that link back to
the original PDF.

This is a **clinical reference prototype, not validated clinical decision support**. Answers
must be verifiable against linked sources, and failure behaviour must always degrade
conservatively rather than guess.

## How the instruction files divide up

`AGENTS.md` is the single source of truth for **rules** and is imported above, so everything
in it is already in force. This file is the **orientation layer** — what the system is, how
it is laid out, how work flows through it. It deliberately does not restate AGENTS.md policy;
where the two ever disagree, **AGENTS.md wins**.

`AGENTS.md` is a small always-loaded core — the boundaries that prevent irreversible harm, plus
the sections a gate parses by exact text — and an index. Every other rule keeps its heading there
and its full text in a named file under `docs/agents/`. Read that file before acting in its area;
its rules are in force whether or not you have opened it.

| Need                                        | Read                                                                                                         |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Rules, gates, shortcuts, safety boundaries  | `AGENTS.md` (auto-loaded)                                                                                    |
| Architecture, modules, schema, domain flows | `docs/codebase-index.md` — the deep map; start there for any real task                                       |
| Design-system rules before any UI building  | `docs/design-system/README.md` — the system of record: tokens, component contracts, gates, adoption playbook |
| Routes and modes                            | `docs/site-map.md` (generated — `npm run sitemap:update`)                                                    |
| Which gate to run for a change              | `docs/process-hardening.md`, or the `gates` skill                                                            |
| Test execution, focused/live, flake policy  | `docs/testing.md`                                                                                            |
| Every maintained doc, categorised           | `docs/README.md`                                                                                             |
| Outstanding work across sessions            | `docs/outstanding-issues.md` (`/issues`)                                                                     |
| Which area owns a file, and its key docs    | `docs/organisation/README.md` — the organisation map; `npm run check:organisation -- --files <path>`         |

When adding to this file, add **orientation**. Policy belongs in `AGENTS.md`; deep structure
belongs in `docs/codebase-index.md`. Keeping those three non-overlapping is what stops five
AI systems (Claude Code, Codex, Cursor, CodeRabbit, `.agents/`) from drifting apart —
see the AI tooling and documentation ownership map in `docs/agents-guide.md` (§ Tooling and documentation ownership).

## Highest-consequence rules

Full text and rationale in `AGENTS.md`, which now carries these boundaries in its core, ahead of
everything else: the provider confirmation boundary, Supabase project safety (merging a migration
reaches the live clinical database within seconds), RAG ranking protection, Railway project safety
and local server safety. The Next.js warning is the block at the top of `AGENTS.md`. Review-ledger
lookup before reviewing a branch or PR is in
[`docs/agents/codex-review-throttling.md`](docs/agents/codex-review-throttling.md), and the rule
that evidence is never compressed is in
[`docs/agents/external-skill-precedence.md`](docs/agents/external-skill-precedence.md).

Do not restate any of them here. A second copy is how these two files drift.

## Stack and runtime

| Layer     | Choice                                                                                       |
| --------- | -------------------------------------------------------------------------------------------- |
| Runtime   | Node **24.x** / npm **11.x**, `engine-strict` (dev server exits on any other major)          |
| Framework | Next.js 16 (App Router), React 19                                                            |
| Language  | TypeScript 6, strict; Zod 4 for env and request validation                                   |
| Styling   | Tailwind 4 (`@theme` tokens in `src/app/globals.css`), unlayered component CSS by design     |
| Data      | Supabase — Postgres + pgvector (HNSW), Storage, Auth; Edge Functions on Deno 2               |
| AI        | OpenAI (embeddings, image captions, grounded generation)                                     |
| Ingestion | Node worker + Python OCR (PyMuPDF / Tesseract)                                               |
| Tests     | Vitest (unit, `tests/**/*.test.ts`), Playwright (E2E, `tests/ui-*.spec.ts`)                  |
| Deploy    | Railway project `PsychSift` — `PsychSift` (app) + `worker` services, auto-deploy from `main` |

Install with `npm ci --include=dev`. Use `npm install` only when deliberately changing
dependencies. `npm install` also installs the repo's git hooks.

**Demo mode:** with Supabase/OpenAI env absent, dev falls back to the synthetic corpus
(`src/lib/demo-data.ts`, `public/demo-documents/`) via `isDemoMode()` in `src/lib/env.ts`.
Production never silently falls back — missing config fails loudly.

## Repository layout and the two main flows

The `src/` tree, the app modes, and the two flows that matter — answer (read path) and
ingestion (write path) — are mapped in
[`docs/codebase-index.md`](docs/codebase-index.md), under "Orientation summary" and the detailed
sections that follow it. Start there for any real task.

Never commit: `.next/`, `node_modules/`, `coverage/`, `.env*`, `sample-documents/`, logs.

## Development workflow

```bash
npm run ensure     # start/verify THIS project's dev server, prints the URL — never assume a port
npm run worker     # local ingestion worker (second terminal)
npm run dev        # direct dev server on the project-stable port
```

Verification pyramid - run the **smallest gate that covers the change**, then widen. CI selects checks
for the triggering event, draft state and classified change scope. The ordinary PR push guidance in
`docs/agents/verification-gates.md` distinguishes expected CI checks, authorised local deferrals and
completed passing evidence; skipped or pending checks are not passes.

| Gate                                      | What it is                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm run test:focused -- --files <paths>` | Source-only iteration. Fails closed for deleted files and test infrastructure — then run `npm run test`.                                                                                                                                                                                                                                   |
| `npm run verify:cheap`                    | **Ordinary offline gate:** `check:installed-lock-parity` then `check:diff-integrity` + `lint` + `typecheck` + full offline unit suite. Nothing else. Prefer `test:focused` while iterating; run cheap before an ordinary PR push when the diff needs those five checks. CI selects the heavy static set when classified scope requires it. |
| `npm run verify:full`                     | **Broad offline gate:** the 41 static/consistency gates (docs index, ledgers, knip, design tokens, owner-scope…; `npm run check:gate-manifest` lists them), then `lint` + `typecheck` + `test`. Does not invoke the `verify:cheap` script. For cross-module risk or before a release — not routinely.                                      |
| `npm run verify:pr-local`                 | Risk-routed PR mirror: focused docs/workflow contracts for recognised light scope, fail-closed heavy checks for executable or unknown scope. `-- --dry-run --files <paths>` shows selection.                                                                                                                                               |
| `npm run verify:ui`                       | Chromium production journeys. Run `npm run ensure` first.                                                                                                                                                                                                                                                                                  |
| `npm run verify:phone-chrome`             | Phone-chrome changes; selects affected owners/journeys before escalating to `verify:ui`                                                                                                                                                                                                                                                    |
| `npm run verify:release`                  | Full build + all browsers + readiness. **Provider-backed — needs approval.**                                                                                                                                                                                                                                                               |

Neither `verify:cheap` nor `verify:full` runs formatting, which is why changed-file CI and the
installed pre-push hook (`.githooks/pre-push` → `scripts/guard-push.mjs`) block on unformatted files.
It also guards user-owned auto-merge state on every PR branch, drift-manifest staleness, and a
static gate (lint + source typecheck; override `SKIP_STATIC_GUARD=1`). The auto-merge guard has no
automation override; the other guards retain their documented override env vars.

Domain changes (auth, Supabase, ingestion, answer generation, search/ranking, clinical
output, source governance) additionally want the smallest relevant domain check plus
`npm run check:production-readiness`.

CI (`.github/workflows/ci.yml`) is risk-scoped: a `changes` job classifies paths, `static-pr`
always runs a small baseline and conditionally selects docs/workflow or heavy static checks,
and `pr-required` is the single always-reporting required aggregate. Coverage, safety/RAG,
build, Chromium, Supabase migration replay, and Docker builds run only when their file scope
applies; unknown non-document paths fail closed to heavy scope.

## Conventions the gates enforce

These fail builds, so they are worth knowing before you write code. Button wiring, orphan routes,
internal navigation and the mockup exemptions are in
[`docs/agents/wiring-and-bundle-budget.md`](docs/agents/wiring-and-bundle-budget.md); the
one-composer rule is in `AGENTS.md` "Search chrome behaviour"; PR bodies as parsed input are in
[`docs/agents/external-skill-precedence.md`](docs/agents/external-skill-precedence.md). One
convention has no home in the rules layer and stays here:

- **Design tokens, not hex.** `eslint-rules/no-hardcoded-hex.mjs`, plus type-scale,
  icon-scale, z-index-ladder, and lucide-icon-aria rules. Production tap targets are
  `min-h-12` (48 px) — do **not** "fix" them down to `min-h-11` for a generic WCAG rule; that
  reintroduces a known `ui-smoke` flake.

## Repo-specific tooling

Prefer these over improvising — they encode traps this repo has already hit:

- **Claude skills** (`.claude/skills/`): `newtask` (fresh worktree off latest `main`),
  `gates` (pick and prove the right gate), `handoff` (commit → verify → push → PR → ledger),
  `prlanded` (verify a squash-merge actually landed), `issues` (`/issues` cross-session
  memory), `run-pr` (open-PR sweep), `sources` (find, capture, score and index a clinical
  source — see `docs/source-acquisition-protocol.md`), `ledger` (extract this session's outstanding work into
  the task ledger), `prompt`.
- **Review subagents** (`.claude/agents/`): `rag-retrieval-reviewer`,
  `supabase-schema-guardian`, `ingestion-worker-reviewer`, `clinical-governance-reviewer`,
  `frontend-ui-reviewer`, `personal-practice-reviewer`, `verification-router`, `repo-auditor`,
  `pr-ci-fixer`.
- **Skill catalogue** (`.agents/skills/`): `npm run skills` lists the canonical single-word
  skills; `npm run check:skills` validates every repository skill surface. Planners in
  `docs/productivity-workflows.md` run without side effects unless given `-- --run`, and
  never execute `approvalRequired` commands.
- **Session memory:** a `SessionStart` hook surfaces the recommended queue from
  `docs/outstanding-issues.md`. Offer `/issues capture` for loose ends before context is lost.
