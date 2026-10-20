---
name: code-quality-review
description: Reviews code quality, naming structures, control flow patterns, abstraction complexity, duplication, and maintainability. Use during general refactoring.
---

# Code Quality Review Skill

Use this skill when auditing source files for maintainability, readability, and structural patterns.

## Repository Review Protocol

Follow `AGENTS.md` review throttling and `docs/codex-review-protocol.md` before starting. Do not review opportunistically or mutate files during pure review. After a completed PR review, post one `Review record` comment on the PR (see [Records](../../../docs/agents/pull-request-workflow.md#records)); never edit the frozen `docs/branch-review-ledger.md` table.

## Review Checklist

### 1. Maintainability & Naming

- **Clean Naming:** Ensure functions, variables, and database keys carry logical, self-describing names.
- **Decomposition:** Look for bloated files/functions that should be decomposed. Keep modules focused on a single responsibility.
- **Duplication (DRY):** Consolidate duplicate helper logic, styles, and configurations.

### 2. Logic & Complexity

- **Control Flow:** Simplify nested conditionals, deeply nested loops, or fragile edge-case handling.
- **Dead Code:** Remove unused functions, comments, or commented-out code blocks left behind.
