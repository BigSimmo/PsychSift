---
name: review
description: Review the current PsychSift diff, branch, or explicitly approved PR target for high-confidence correctness, security, privacy, clinical, and reliability defects. Use for code review, diff review, or readiness feedback.
---

# Review

1. Read `docs/codex-review-protocol.md`, and for a PR check its comments for a `Review record` at the current head and same scope (see [Records](../../../docs/agents/pull-request-workflow.md#records)).
2. Resolve the local target SHA and check whether the same scope was already reviewed.
3. Inspect changed behavior and realistic failure paths; prioritize reproducible P0-P2 findings.
4. Cite exact files and lines, trigger, impact, and the smallest proof or fix.
5. Do not call GitHub or hosted CI without explicit approval.
6. Record a completed PR review as one `Review record` comment on the PR; a branch with no PR gets no record, so report it in the reply.
