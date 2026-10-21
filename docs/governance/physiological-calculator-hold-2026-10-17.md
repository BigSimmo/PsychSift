# Physiological calculator containment and review handoff

The renal, QTc and lithium bedside panel is withheld pending dedicated clinical validation.
This is containment of audit finding F07, not clinical validation or a finding that a formula is
medically incorrect. The ordinary psychometric catalogue keeps its separate evidence, rights and
quarantine rules. Its page disclaimer remains in place.

The panel first showed an unavailability notice on desktop and phone. Containment has since been
strengthened: the panel is now not rendered at all, so neither the panel nor the notice appears,
even when an open panel or a particular tab is requested (see
[the decision](../decisions/2026-10-17-clinical-math-panel-hidden-until-clinician-verification.md)).
It exposes no physiological inputs, numerical results, classifications, dose suggestions or
management advice. The original calculation helpers and draft display code are
retained. Engineering arithmetic tests continue to exercise those helpers; passing them cannot
approve a clinical dose tool.

The inspectable [implementation inventory](../../src/lib/calculators/clinical-math/governance.json)
records the formulas implemented, named source leads, unresolved applicability/threshold/advice
questions, and the missing clinical reviewer, review date and approval artifact. These are
implementation attributions, not certification of primary-source correspondence. Exact hashes bind
the math, types, export surface and panel to that inventory. The maintained
`tests/clinical-math-governance.test.ts` fails on drift or unlisted exported calculations; updating a
hash only records a code change and does not validate it.

Before restoring any part of the panel, the accountable clinical owner must supply a dated review
artifact covering the exact implementation and intended population, with source versions and
claim-level correspondence for formulas, units, rounding, cutoffs, exclusions and advice. Lithium
dose adjustment specifically needs the dedicated dose-calculator validation required by
[Clinical Use Rules](../clinical-governance.md#clinical-use-rules). Clinical ownership and any
deployment classification/TGA assessment remain role-bound.

A reviewed restoration must show the permitted primary-source links, calculation and reference
limitations at the tool itself, preserve invalid-input and safety boundaries, and re-establish
focused engineering and UI evidence. Merely changing release metadata is not sufficient evidence.
No clinical reviewer, approval date, remote source check, provider entitlement or deployment is
created by this containment change.
