# Decision: The Clinical question check holds back bare names and street addresses

- **Status:** decided 2026-10-25
- **Source:** `src/lib/clinical-question-bare-name.ts`, find "The Clinical question check holds both back"

On 25 Oct 2026 the owner approved the audit's recommendation (#309) with "Go ahead and fix and complete
and go ahead with all recommendations". A bare first and last name or a street address in a Clinical
question is now held back before anything is sent to the answer service, using the existing refusal.
Eponyms, drug names, Perth hospitals and ordinary capitalised clinical terms still pass. The check
catches some names, not all.

If this summary and the source ever differ, the source wins.
