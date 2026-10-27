# Decision: Medical Workforce can name roster managers for their own hospital, and a blocked account is told so

- **Status:** decided 2026-10-27
- **Source:** `src/lib/work-roles/people.ts`, find "May this person name or remove roster managers"

On 27 Oct 2026 the owner said "Please go ahead and resolve all these issues for me now as per your recommendations" to the access roles review (`docs/access-roles.md`, known gaps 2 and 5). Medical Workforce can now name and remove roster managers for the teams in their own hospital, from People and roles, as well as the site administrator. Nobody but the administrator changes their own manager role there, and the person must already be a member of the team. It stays behind the same real-staff roster hold as the rest of the team roster. A blocked account trying to sign in is now told the account is blocked instead of a generic failure.

If this summary and the source ever differ, the source wins.
