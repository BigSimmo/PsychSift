# Decision: Audit check-rule changes, clinical fixes and hazard reseal approved

- **Status:** decided 2026-10-25
- **Source:** the owner, in chat

On 25 Oct 2026 the owner replied "Go ahead with all recommendations" (14:04Z) to the whole-codebase
audit's remaining recommendations. That approves:

- two required-check changes: CI and `verify:pr-local` run the Codex hook dispatcher tests on
  static-heavy scope (#326), and `scripts/ci-change-scope.mjs` refuses a changed path containing a
  control character (#264);
- clinical sign-off of the audit's clinical fixes #188, #70, #159, #160, #198, #144, #162, #201, #263,
  #202, #177, #179, #182 and #223, including relabelling atomoxetine as an NRI with no
  methylphenidate interaction alert (#202).

At 14:14Z the owner replied "Yes go ahead" to "Yes, re-seal the clinical hazard register for #177,
#179, #182 and #223", approving the reseal of `docs/clinical-hazard-controls.json` for those four
changes only.

If this summary and the source ever differ, the source wins.
