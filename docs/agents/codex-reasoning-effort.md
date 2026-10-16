# Codex reasoning effort

<!-- BEGIN:reasoning-effort-calibration -->

The user owns the main-chat model and reasoning picker. Do not set repository-wide `model` or
`model_reasoning_effort` in `.codex/config.toml`, claim to change the running setting, or infer it
from old sessions. Without runtime telemetry, distinguish a user-confirmed setting from verified
execution metadata.

The former Cloud prompt-marker and prompt-resubmission gate was retired on 2026-10-16.
The owner can confirm a picker change in ordinary language; no literal marker or
resubmission is required. Preserve that confirmation instead of asking again.

Use the selected setting. Recommend higher effort only for a concrete unresolved risk, such as
ambiguous security boundaries, concurrency or irreversible changes. Ordinary inspection, policy
editing and implementation do not require an Extra High startup ceremony. A task's phase label or
size alone does not justify changing the user's choice.

Before substantial work, give a short plan proportionate to uncertainty and consequences. Name
files/interfaces and the checks that will establish the result. Do not invent a plan/build effort
split or claim telemetry that the host does not expose.

For authorised subagents, use [current-tool agent allocation](smart-agent-allocation.md). An
explicit specialist programme may retain its own effort/review/evidence contract; keep that
contract scoped to the programme rather than applying it to all Cloud tasks.

<!-- END:reasoning-effort-calibration -->
