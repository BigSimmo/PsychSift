# Decision: WA-endorsed, not-reviewed-here sources are gated on their own line in the release check

- **Status:** decided 2026-10-22
- **Source:** `scripts/eval-quality.ts`, find "owner decision 2026-10-22"

The 2026-10-22 release pilot measured a top-result review-required rate of 0.93 against a 0.25 gate.
The cause was the owner-approved relabel of 26 Sep 2026 ([#3111](https://github.com/BigSimmo/PsychSift/pull/3111)),
which honestly moved WA documents from an import-stamped "locally reviewed" to "unverified" with the
`wa_document_control_endorsement` basis. The release check counted every one as review-required, so
89 of 96 top results failed it, while overdue sources had fallen to 0.18. On 22 Oct 2026 the owner
chose, on a decision card in the "Content currency plan" project thread, to split the check. The
review-required line keeps counting overdue, unknown, outdated and every other unverified basis.
The WA-endorsed cohort gets its own line, `wa_endorsed_unreviewed_rate`, held to the same 0.25 target,
with an owner-accepted debt ceiling (0.95 at first, inside the existing dated debt acceptance) that is
lowered as the owner reviews the most-surfaced documents. The cohort stays review debt and never counts
as reviewed authority.

If this summary and the source ever differ, the source wins.
