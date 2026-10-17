# Decision: DSM specifiers count as signed off only under a named clinician

- **Status:** decided 2026-10-15; superseded by 2026-10-16-psych-sift-display-name-sign-off.md
- **Source:** `src/lib/admin/rule-sign-off.ts`, find "Signed by a system or role name, not a named clinician"

The 89 DSM specifier records stamped with the product name PsychSift (71 items and 18 universal
specifiers) show as not signed off, and their definitions stay withheld, until the owner re-signs each one in
his own full name with the sign-off tool. A product name is not accepted as a clinician sign-off.

If this summary and the source ever differ, the source wins.
