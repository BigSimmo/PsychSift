---
name: design-review
description: Reviews layout density, theme adherence, typography, spacing, search-chrome placement, accessibility modes, and visual consistency. Use during visual layout or CSS adjustments.
---

# Design Review Skill

Use this skill when auditing UI styling, colors, layout structures, spacing rules, and
search-chrome placement. For a full live page sweep (routes, breakpoints, interactive
behaviour), prefer the Cursor agent at `.cursor/agents/design-review.md` — this skill is the
compact checklist; that agent owns the journey protocol.

## Repository Review Protocol

Follow `AGENTS.md` review throttling and `docs/codex-review-protocol.md` before starting. Do not review opportunistically or mutate files during pure review. After a completed PR review, post one `Review record` comment on the PR (see [Records](../../../docs/agents/pull-request-workflow.md#records)); never edit the frozen `docs/branch-review-ledger.md` table.

Read `docs/search-chrome-behaviour.md` and `docs/wiring-conventions.md` before judging search chrome or controls. Run `npm run ensure` before browser work; confirm `/api/local-project-id` matches this project. Do not call OpenAI, Supabase, GitHub/hosted CI, or provider-backed gates without explicit approval.

## Review Checklist

### 1. Style & Spacing Consistency

- **Design System Tokens:** Ensure custom components utilize predefined design variables (colors, borders, shadows, font sizes) rather than ad-hoc inline styles.
- **Layout Spacing:** Check for consistent paddings, margins, grid gaps, and alignment.
- **Density:** Dense, clean clinical layout — not flashy marketing chrome.

### 2. Search chrome & UX flows

- One composer owner per page (shell/dashboard vs hero vs DocumentViewer) — AGENTS.md `# Search chrome behaviour`.
- Phone edge-to-edge dock: flush bottom when visible; hidden chrome → `0rem` content reserve.
- Header/footer hide/reveal symmetry from the same scroll signal where shared.
- No second fixed search bar or second dock-sized content pad below a page-owned composer.

### 3. Clinical Theme & Accessibility

- **Layout Density:** Confirm the visual target is dense, clean, calm, and fast to scan.
- Visible keyboard focus; icon-only controls have accessible names.
- Reduced-motion and forced-colors do not break readability or hide state.
- **Browser QA:** For major UI changes, run `npm run ensure` and capture screenshots at phone (~390) and desktop (~1280).
