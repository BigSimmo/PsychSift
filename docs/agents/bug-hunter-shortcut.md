# Bug-Hunter Shortcut

<!-- BEGIN:bug-hunter-shortcut -->

## Bug-hunter shortcut

When the user types exactly `bug-hunter` as the entire task message, after trimming surrounding whitespace, treat it as a shortcut for targeted defect discovery.

Execution rules:

- Invoke the `audit` skill (`.agents/skills/audit/SKILL.md`) first.
- Prioritize reproducible defects over code style, naming, or formatting feedback.
- Trace realistic failure paths: invalid input, empty states, retries, race/concurrency issues, stale state/cache, network/auth failures, permissions, and boundary values.
- For each finding, include trigger, expected behavior, actual risk, and the smallest proof (or targeted test/check) that would catch it.
- If no high-confidence defect is found, explicitly state that and list the most likely residual risk area.

Scope and safety:

- Keep the hunt scoped to code touched by the user request unless the defect clearly crosses module boundaries.
- Do not make broad refactors while hunting; propose minimal fixes for confirmed issues.
- Run the smallest focused verification for each confirmed defect, then expand only if needed.

<!-- END:bug-hunter-shortcut -->
