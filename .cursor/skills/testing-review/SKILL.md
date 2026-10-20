---
name: testing-review
description: Reviews unit/integration/E2E coverage, checks for fragile/flaky tests, asserts clinical safety checks, and reviews verification sequence. Use during test addition or refactoring.
---

# Testing Review Skill

Use this skill when reviewing test coverage, testing harnesses, and test execution paths (Vitest + Playwright).

## Repository Review Protocol

Follow `AGENTS.md` review throttling and `docs/codex-review-protocol.md` before starting. Do not review opportunistically or mutate files during pure review. After a completed PR review, post one `Review record` comment on the PR (see [Records](../../../docs/agents/pull-request-workflow.md#records)); never edit the frozen `docs/branch-review-ledger.md` table.

## Review Checklist

### 1. Test Harness Coverage

- **Unit Tests:** Ensure new or modified utils, helper scripts, and backend libraries have corresponding Vitest unit tests (`*.test.ts`).
- **E2E/UI Tests:** Verify frontend routes and interactive components are covered by Playwright specs (`ui-*.spec.ts`).
- **Clinical Safety Assertions:** Check that tests verify critical safety boundaries, such as correct citation indexing, fallback behavior on weak RAG evidence, and tenant data isolation.

### 2. Flakiness & Mocking

- **Mocking External APIs:** Ensure test flows do not hit live external APIs (like OpenAI) directly. Mock these services with predictable fixtures.
- **Verification Gates:** Use the smallest focused check for localized behavior, `verify:ui` only when shared Chromium coverage is proportionate, and `verify:release` only after explicit user approval for comprehensive release confidence.
