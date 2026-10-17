# Decision: Unsigned therapy and specifier text is not answer evidence or site content

- **Status:** decided 2026-10-18
- **Source:** `src/lib/site-content/adapters/specifiers.ts`, find "docs/decisions/2026-10-18-unsigned-clinical-text-withheld-from-site-content.md"

On 18 Oct 2026 at 00:10 AWST the owner ruled to keep the fail-closed gating added during the sign-off reset
(#3623), together with the count of 515 specifier items awaiting review. Clinical text that has no current
owner signature is not used as Clinical Ask answer evidence and is not published as site content. This
covers a therapy whose status is `needs_review`, and a specifier definition that is unsigned or changed
since review. Such a record is still indexed by name and category (therapies) or by disorder and group
(specifiers), so search can find it, but its clinical prose is withheld until it is signed. When the owner
signs a record through `therapy:review` or `clinical:review`, its text is published again.

If this summary and the source ever differ, the source wins.
