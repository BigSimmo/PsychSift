## Summary

-

<!-- Areas touched: run `npm run pr:areas` and paste the lines it prints here, replacing this comment. It adds a RAG impact line to fill in when a ranking-protected file changed. -->

## Verification

Paste the decisive line from whatever you ran — exit code 0 alone is not proof.

- [ ] Checks run:

Select checks using [the canonical verification policy](../docs/agents/verification-gates.md).
Use focused proof for the changed behavior and the applicable PR-local gate. Shared UI foundations
or an applicable handoff requirement can require the complete browser gate; routine bounded work
does not automatically require a full unit, browser or release suite.

Nothing in this template blocks a merge. The gates that fail closed are migration history,
required-check forgery, and CI itself.

## Risk and rollout

Worth a line for clinical, data, auth/privacy, migration, dependency, or deployment changes.

- Risk:
- Rollback:
- Provider or production effects: None / describe the explicitly authorized effect

## Clinical Governance Preflight

For ingestion, answers, retrieval/ranking, sources, document access, privacy, production
environment behavior or clinical output, record the applicable evidence here. This metadata
is advisory in `pr-policy`; it does not replace clinical-owner sign-off, provider/spend
approval, live canary requirements or other fail-closed gates. Leave unverified items
unchecked and explain the gap. See [clinical governance](../docs/clinical-governance.md#pull-request-preflight).

- [ ] Source-backed claims still require linked source verification before clinical use
- [ ] No patient-identifiable document workflow was introduced or expanded without explicit governance approval
- [ ] Supabase target remains `PsychSift Production` (`sjrfecxgysukkwxsowpy`)
- [ ] Service-role keys and private document access remain server-only
- [ ] Demo/synthetic content remains clearly separated from real clinical sources
- [ ] Source metadata, review status, and outdated/unknown-source behavior remain conservative
- [ ] Deployment classification/TGA SaMD impact was checked when clinical decision-support behavior changed

Evidence / not applicable / unresolved:

-

<!--
Provider-backed evals are owner-run and never automatic:
  `npm run eval:retrieval:quality` (must stay 36/36) — retrieval, ranking, selection, chunking
  `npm run eval:rag -- --limit 15` + `npm run eval:quality -- --rag-only` — answer generation
For RAG ranking surfaces, a `RAG impact:` line is advisory but still the fastest way to tell a
reviewer whether ordering moved. See docs/rag-behaviour/safeguards.md.

Merging a `supabase/migrations/**` change applies it to the LIVE clinical database within
seconds. There is no separate deploy step to wait for.
-->

## Notes

-
