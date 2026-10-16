# Smart agent allocation

This is the default whenever agents are requested or otherwise permitted, across
Codex Desktop, CLI and Cloud. No special phrase is needed. It generalises the RAG
and Ingestion programmes' allocation without imposing their full workflow on
unrelated tasks. Explicit task instructions and stricter project review, reasoning,
clinical, privacy, provider and publication requirements take precedence.

## Choose the route for the work

Use the least costly supported route with sufficient capability for the difficulty,
uncertainty and consequences. These are starting points, not quotas or a claim of
current hosted availability:

- Luna (`gpt-5.6-luna`) / Medium: mechanical edits, inventories and straightforward
  static checks. Terra (`gpt-5.6-terra`) / Medium: bounded low-risk analysis or
  mechanical work where it is a better fit.
- Sol (`gpt-5.6-sol`) / Medium: well-defined implementation with settled interfaces.
- Sol / High: complex shared components, debugging across components and independent
  review of substantive changes.
- Astra (`gpt-6-astra`) / High: architecture, ambiguous clinical/privacy/security
  boundaries, concurrency, evidence contracts and difficult integration decisions.
- Astra / Extra High (`xhigh`): demonstrated unresolved reasoning problems or
  required formal review. It is not the default for every task or final check.

Use other supported effort levels when justified. Astra High is the preferred
controller for substantial programmes; preserve the user's selected main-chat
model and effort. Never pin them in the repository configuration. The
[reasoning effort calibration and Cloud guidance](codex-reasoning-effort.md)
remain binding; a lighter starting route cannot lower a required floor.

## Dispatch and coordinate

- Delegate only when useful independent work repays briefing and integration.
  Use available capacity within the live limit without filling slots for appearance
  or reserving idle reviewers. No automatic scouts or recursive delegation.
- Specify each child's model and effort using supported arguments. Give the
  objective, relevant context, exact file/interface ownership, dependencies,
  constraints and acceptance evidence. Include governing instructions in bounded
  context; use a bounded fork when explicit routing does not support full history.
- Keep one writer per file or coupled interface. Parallel writers require separate
  ownership and satisfied dependencies. Overlapping edits, shared integration and
  constrained checks stay serial. Isolate checkouts where needed; databases,
  services and servers may remain shared. The controller owns integration, shared
  state and expensive-check scheduling.
- Reuse suitable implementers for related corrections and adjacent work, refreshing
  the brief and base. Batch related corrections. Diagnose missing context, broken
  environments and contention before escalating capability; elapsed time, phase
  labels and raw retry counts are not reasons alone.
- Keep one existing task ledger for substantial work. Record requested routes and
  actual routes separately: a tool accepting a request is not proof of execution.
  Claim an actual route only when telemetry exposes it. Disclose unavailable
  models or fallbacks and never silently lower a required floor.

## Review and verification

Reviewers must be independent of every change they judge and inspect stable inputs.
Retain required specification, quality and specialist reviews. One designated
check owner supplies shared evidence; reuse unchanged valid checks and reviews,
run missing proof plus mandatory gates, and avoid repeated broad suites or audits
for reassurance. A required complete-scope acceptance review cannot become a
correction-only review. Follow [verification gates](verification-gates.md).

## Cloud delivery and limits

The repository root `AGENTS.md` links this portable policy. A fresh Cloud task needs
the published branch containing both files; an uncommitted desktop copy, local
memory or a Windows path does not deliver it to Cloud. No setup-script change or
credential transfer is needed for the documentation route.

Before the first authorised Cloud dispatch, inspect the tools and supported model,
effort and concurrency controls actually exposed by that session. Use the same
allocation where supported. If model selection is absent, report that the requested
route cannot be enforced; do not invent arguments or claim verified routing. If
agents are absent, continue suitable authorised work in the main task and leave
required independent review explicitly unmet. Do not emulate unavailable agents
through paid APIs, credential copying or permission changes.

Cloud activation is separate from preparing these files. After authorised
publication, verify a fresh task has loaded the policy. At its first useful,
authorised agent task, distinguish requested settings from returned execution
evidence. Do not launch dummy agents solely to claim the policy works, and do not
claim documentation or static checks prove hosted execution.

Official references: [instruction discovery](https://developers.openai.com/codex/guides/agents-md)
and [subagent configuration](https://developers.openai.com/codex/subagents). The
session's actual tools remain the authority for available controls. See the
[Cloud environment contract](../codex-cloud.md) for environment and provider limits.
