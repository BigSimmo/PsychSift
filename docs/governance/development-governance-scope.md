# Development governance scope

How to run the governance checks during offline development and draft review without weakening
release checks. This is the operating guide for the
[owner decision of 22 October 2026](../decisions/2026-10-22-development-governance-scope.md). The
release requirements themselves stay in [Clinical Governance](../clinical-governance.md).

## Development and draft review

Offline development and draft review may proceed with recorded privacy gaps. Use the explicit
development profile with a full, locally available base commit SHA for the **whole proposed
change**, rather than selecting a later checkpoint to hide earlier edits:

```sh
npm run check:privacy-readiness:development -- --base <full-base-commit-sha>
npm run check:clinical-hazard-controls:development -- --base <full-base-commit-sha>
npm run docs:maintain:development -- --base <full-base-commit-sha>
```

This local-only profile checks committed changes, the index, working files and untracked paths.
An unrelated expired review becomes a visible warning; editing the expired entry or a covered
path still blocks, including staged register edits whose working copy was restored. Invalid or
unavailable scope falls back to strict checks. Pending/partial privacy requirements are printed
as release blockers without being converted into approvals. No patient data or provider access
is needed. `docs:maintain:development` is read-only; to refresh generated documentation first,
use `npm run docs:maintain -- --development --base <full-base-commit-sha>`.

Default checks remain strict. `--release`, `check:privacy-readiness:release`,
`check:production-readiness` and `governance:release` retain their production requirements;
`--release` wins even if `--development` is also supplied. A development pass is not release,
clinical, legal or provider approval. The [privacy impact assessment](../privacy-impact-assessment.md)
retains the data-field, purpose, store, retention and deletion inventory; this profile changes
none of those data-handling controls. See the [owner decision](../decisions/2026-10-22-development-governance-scope.md).
