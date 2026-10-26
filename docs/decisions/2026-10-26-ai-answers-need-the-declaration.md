# Decision: AI answers need the health professional declaration, checked on the server

- **Status:** decided 2026-10-26
- **Source:** `src/lib/clinical-access.ts`, find "The AI routes also need the"

On 26 Oct 2026 the owner chose "Yes, do both" on a decision card in the regulatory readiness
re-audit thread (finding R2-01). Sign-up is open to anyone, so Answer, the answer stream and
Clinical Ask now also refuse a signed-in account whose record does not hold the current
"I'm a health professional and I accept the Terms" declaration. The server reads the record
from the account, never from the browser's copy. The same card approved rewording three tool
descriptions (finding R-11) so they no longer claim to generate care plans or give actionable
recommendations. The new wording waits for the owner's sign-off before merge.

If this summary and the source ever differ, the source wins.
