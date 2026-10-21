---
name: frontend-architecture-review
description: Reviews Next/React boundaries, state ownership, duplicated client state, rendering contracts, and component boundaries. Use during frontend architecture refactoring.
---

# Frontend Architecture Review Skill

Use this skill when reviewing Next.js App Router structures, component boundaries, state management, and React performance.

## Repository Review Protocol

Follow `AGENTS.md` review throttling and `docs/codex-review-protocol.md` before starting. Do not review opportunistically or mutate files during pure review. After a completed PR review, post one `Review record` comment on the PR (see [Records](../../../docs/agents/pull-request-workflow.md#records)); never edit the frozen `docs/branch-review-ledger.md` table.

## Review Checklist

### 1. Next.js App Router Boundaries

- **RSC vs. Client Components:** Ensure components are Server Components by default. Keep client-side logic (`use state`, `use effect`, browser APIs) isolated to leaf components marked with `"use client"`.
- **Data Fetching:** Fetch data in Server Components or Server Actions where possible. Avoid calling internal `/api/...` endpoints directly from RSCs.

### 2. State & Rendering

- **State Duplication:** Avoid replicating URL/router state in local React state. Prefer URLSearchParams and next/navigation controls for search/filters.
- **Rendering Waste:** Check for unnecessary context re-renders, un-memoized expensive calculations, or excessive component mount/unmount cycles.
