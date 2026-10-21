# Decision: The owner has clinically reviewed all six emergency cards

- **Status:** decided 2026-10-21
- **Source:** `src/lib/emergency-protocols.ts`, find "docs/decisions/2026-10-21-emergency-cards-owner-review.md"

The owner wrote "approve for each card please. I approve" in the Regulatory readiness audit project
thread (21 Oct 2026 05:18 UTC). The owner reviewed the six fixed emergency cards in `src/lib/emergency-protocols.ts` (EMERG-NMS,
EMERG-SEROTONIN-SYNDROME, EMERG-ACUTE-DYSTONIA, EMERG-LITHIUM-TOXICITY, EMERG-CLOZAPINE-MYOCARDITIS,
EMERG-MALIGNANT-CATATONIA) as they stood on branch `claude/project-thread-nsxi3m` on 21 Oct 2026, from
the word-for-word review pack `/mnt/project-files/reviews/2026-10-21-emergency-cards-for-review.md`, and
approved every card. Each card now records `ownerReviewedOn: "2026-10-21"`, so it no longer shows
"Not yet reviewed". Any later change to a card's clinical text needs a fresh owner review and clears its
date. This closes regulatory audit finding R-12.

If this summary and the source ever differ, the source wins.
