# Agents Guide

Short onboarding pointer. The authoritative, always-current rules for agents
working in this repository live in the root [`AGENTS.md`](../AGENTS.md) —
verification gates, provider confirmation boundaries, Supabase project safety,
review routing, and workflow shortcuts. This page only orients you; it does not
duplicate those rules, so it cannot drift from them.

## Read in this order

1. [`AGENTS.md`](../AGENTS.md) — agent rules, verification gates, shortcuts
   (`upload`, `dependency`, `bug-hunter`), and safety boundaries.
2. [`docs/codebase-index.md`](codebase-index.md) — architecture and module map.
3. [`docs/README.md`](README.md) — index of all runbooks, governance docs, and
   plans, with maintained vs historical classification.
4. [`docs/site-map.md`](site-map.md) — generated route map.

## Human quickstart

- Node 24.x / npm 11.x are hard requirements (`engine-strict`); the app is
  Next.js 16 + Supabase + OpenAI.
- Copy `.env.example` to `.env.local` and fill in values (never commit
  secrets). Without Supabase/OpenAI values the app runs in demo mode on a
  synthetic corpus.
- `npm run ensure` starts or verifies the dev server on a stable
  project-specific port (never assume `localhost:3000`).
- `npm run worker` runs the local ingestion worker in a second terminal.
- When adding environment variables, update the schema in `src/lib/env.ts` and
  document them in `.env.example`.
- Before handing off changes: `npm run verify:cheap` first, then
  `npm run verify:pr-local` when the change is PR-ready (see
  [`docs/process-hardening.md`](process-hardening.md) for the full
  verification pyramid).

## AI tooling map

This repo intentionally uses several AI systems; the overlap is by design, not
accident. [`AGENTS.md`](../AGENTS.md) is the single source of truth — every system
below defers to it, so rules live in one place and cannot drift.

| System                    | Owns                                                       | Where it is configured                                                                                                                                     |
| ------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AGENTS.md** (canonical) | All agent rules, gates, safety boundaries                  | `AGENTS.md`; `CLAUDE.md` imports it with `@AGENTS.md` and adds orientation only (stack, layout, flows) — never a second copy of the rules                  |
| **Codex** (OpenAI)        | Primary PR code-review + automatic resolve                 | AGENTS.md "Codex review" sections, `docs/codex-review-protocol.md`, `docs/codex-prompt-playbook.md`, `.github/workflows/codex-autofix-review-comments.yml` |
| **Claude Code**           | Interactive dev; scoped review subagents + workflow skills | `.claude/` (agents, skills, hooks), `.github/workflows/claude.yml`                                                                                         |
| **Cursor**                | Editor skills + project MCP (Supabase, Context7, …)        | `.cursor/` (skills, `mcp.json`)                                                                                                                            |
| **Railway MCP**           | Desktop/CLI template; hosted app is separate               | Root `.mcp.json` / `.codex/config.toml` use `https://mcp.railway.com` with OAuth; hosted ChatGPT/Codex requires a workspace-installed app                  |
| **CodeRabbit**            | Advisory PR review (never blocking)                        | `.coderabbit.yaml` (`commit_status: false`)                                                                                                                |
| **`.agents/`**            | Home-grown skill catalogue                                 | `.agents/skills/catalog.json`; list with `npm run skills`                                                                                                  |

Rule of thumb: change agent behaviour in `AGENTS.md`, then let each system inherit it.
Do not add a new AI system or grow the skill count without retiring something — the
breadth is already a maintenance cost for a single maintainer. Prefer **≤5 active MCP
servers** per session (tool-schema token bloat degrades agents).

## MCP default read path (ops / docs)

Use registered MCPs before opening dashboards when the task is read-only inspection.
Writes, secret rotations, and hosted mutations stay confirmation-gated per `AGENTS.md`.

| Server                      | Config                                                                                                                                                                        | Use for                                                                                                                                                                            | Do not                                                                                                                                           |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Supabase** (read-only)    | `.cursor/mcp.json` — pinned `project_ref=sjrfecxgysukkwxsowpy`, `read_only=true`                                                                                              | `search_docs`, advisors, read SQL, schema inspection                                                                                                                               | Print secret values; raw-edit retrieval RPCs via `execute_sql`; Auth DB connection-cap (`#011`) — **dashboard only**                             |
| **Railway**                 | Desktop/CLI: root `.mcp.json` / `.codex/config.toml` (`railway` + OAuth). Hosted ChatGPT/Codex: workspace-installed app only — repository MCP files are not a read path there | Deploy status, service logs, env **names**/presence (Desktop/CLI MCP or hosted app tools)                                                                                          | Treat root `.mcp.json` as hosted proof; confuse `RAILWAY_API_TOKEN` (personal) with CI `RAILWAY_TOKEN`; mutate without approval                  |
| **Context7**                | `.cursor/mcp.json` → `npx -y @upstash/context7-mcp@3.2.5` (+ Cursor `context7-plugin`)                                                                                        | Versioned docs for **Tailwind 4, Zod 4, Playwright, Vitest, React 19, `@supabase/supabase-js`** (peers; not exhaustive). Local stdio reads `CONTEXT7_API_KEY` from env (see below) | Next.js 16 — always use `node_modules/next/dist/docs/` (AGENTS.md). Do not invent App Router APIs from training data; never commit the API key   |
| **Chrome DevTools**         | `.cursor/mcp.json` → `npx -y chrome-devtools-mcp@1.6.0`                                                                                                                       | CLS/LCP/console/network while implementing redesigns (`#147`, `#162`–`#164`, Therapy Compass)                                                                                      | Don't leave it always-on with Browse + Playwright MCP (token bloat). Use for perf/debug passes                                                   |
| **Figma**                   | Cursor Figma plugin + `.cursor/mcp.json` → `https://mcp.figma.com/mcp` (OAuth); Codex Desktop/CLI template in `.codex/config.toml` stays disabled unless locally opted in     | Desktop Cursor: capture live UI, read/write frames, Make context, Code Connect                                                                                                     | Cursor Cloud Agents do not inherit Desktop OAuth. Treat Make as exploration; product truth is `docs/design-system/` + gates; keep ≤5 active MCPs |
| **GitHub Checks / Actions** | Operator approval pending                                                                                                                                                     | PR check visibility when `gh pr checks` returns empty totals                                                                                                                       | Bot `update-branch`; broaden scopes beyond Checks/Actions read                                                                                   |

### Context7 API key (optional)

1. Create a free key at [context7.com/dashboard](https://context7.com/dashboard) (`ctx7sk…`).
2. **Project MCP (checked-in):** `.cursor/mcp.json` runs pinned local
   `@upstash/context7-mcp@3.2.5` with `env.CONTEXT7_API_KEY: ${env:CONTEXT7_API_KEY}` so the
   stdio child receives the key when Cursor expands it (Cursor filters inherited env for MCP
   children — the explicit `env` pass-through is required). Set the key as a **user/OS env var**
   or in Cursor **Settings → MCP → context7**.
3. **Cursor Cloud Agent Secrets:** inject `CONTEXT7_API_KEY` into the agent shell
   `process.env`. That authenticates **local** Context7 (`npx @upstash/context7-mcp` /
   `npx ctx7`) and project stdio MCP after reload. It does **not** authenticate a separate
   **host-injected** Context7 connector — measured 2026-08-05: host `resolve-library-id`
   still returned monthly quota exceeded while the same key worked for `npx ctx7 library …`.
   If host MCP is quota-blocked, use `npx ctx7 library|docs …` (or the project local MCP
   after reload) — do not invent APIs from training data.
4. **Does not expand project MCP `${env:}`:** `.env.local` alone (Next app / env.ts path).
5. **Reload MCP servers after key changes.** The stdio child captures env at spawn time — setting
   or rotating `CONTEXT7_API_KEY` has no effect until you reload MCP (or restart Cursor).
6. **Keyless / lower rate limits:** when `CONTEXT7_API_KEY` is unset, Cursor expands
   `${env:CONTEXT7_API_KEY}` to an empty string and the server runs anonymously. If MCP logs
   ever show the literal placeholder `${env:CONTEXT7_API_KEY}` as the key value, remove the
   `env` object from the `context7` entry (anonymous) or set a real key, then reload MCP.
7. Prefer `resolve-library-id` → `query-docs` when the authenticated MCP path is available;
   otherwise `npx ctx7`. Avoid raw `curl` with keys in chat logs unless debugging.

Never paste credential values into chat, issues, or commits. Prefer presence/length checks
(`check:local-presence`) over dumping env contents.
