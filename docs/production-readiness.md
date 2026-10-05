# PsychSift Production Readiness & Operational Release Requirements

**Canonical checklist**: [`docs/production-readiness-checklist.md`](production-readiness-checklist.md).
**Privacy authority register**: [`docs/governance/privacy-readiness.v1.json`](governance/privacy-readiness.v1.json).

## Operational Release Gate Mechanics

The production preflight command:

```bash
npm run check:production-readiness
```

is composed of two consecutive verification steps:

1. `npm run check:privacy-readiness:release` — executes `node scripts/check-privacy-readiness.mjs --release` (the script only recognizes `--release`; `--mode=release` is ignored and runs structural mode).
2. `node scripts/run-tsx.mjs scripts/production-readiness.ts` — validates local environment configuration, Supabase target checks, and secret presence.

### Disabled Clinical Ask configuration profile

For explicitly disabled-state validation, run the local validator with
`node scripts/run-tsx.mjs scripts/production-readiness.ts --clinical-ask-profile=disabled`.
For an offline structural check, add `--ci`; the existing
`npm run check:production-readiness:ci` remains the default launch-profile check.

The disabled profile requires both `CLINICAL_ASK_ENABLED` and
`CLINICAL_ASK_EXTERNAL_SEARCH_ENABLED` to be exactly `false` or unset, matching
their runtime defaults. Enabled, empty or malformed flags block this profile even
in CI or offline Cloud. Launch-only model, denylist, migration and hosted acceptance
requirements are reported as not applicable and are not verified by this profile.
Other readiness safeguards retain their existing behavior. A passing disabled
profile is configuration evidence only, never clinical launch or release approval.

The default profile (also available as `--clinical-ask-profile=launch`) preserves
explicit launch configuration and active-launch evidence requirements. Unknown or
repeated profile arguments fail closed. The standard production release command
and its strict privacy gate remain unchanged; this profile neither updates privacy
decisions nor extends an expired recovery approval.

### Fail-Closed Invariant

In release mode (`--release`), `scripts/check-privacy-readiness.mjs` enforces that every requirement in `docs/governance/privacy-readiness.v1.json` has reached either `"verified"` or `"accepted_decision"` status:

```js
if (release && !["verified", "accepted_decision"].includes(item.status)) {
  errors.push(`${label}: release-blocking status ${item.status}`);
}
```

If any requirement remains `pending` or `partial`, the check exits with code 1 (`PRIVACY_READINESS_FAIL mode=release`). **This fail-closed behavior is non-negotiable**: each requirement needs verified evidence or an actual decision by an authorised role, recorded through the existing `accepted_decision` route. An accepted decision is not a claim that the underlying contract or provider entitlement was verified.

---

## Required Operational Actions Before Production Release

The canonical register records six pending/partial items. Use the [role-attestation pack](governance/privacy-role-attestation-pack-2026-09-01.md) for their evidence and decision requirements:

| Requirement                          | Recorded status | Remaining evidence or decision                                                                                                                                                                             |
| ------------------------------------ | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PRIV-PROVIDER-OPENAI-ZDR`           | Pending         | Actual provider retention approval, production-project match and applicable endpoint/cache coverage, or an authorised restricted-use decision. A submitted request and `store:false` do not establish ZDR. |
| `PRIV-LEGAL-OPENAI-DPA`              | Pending         | Applicable agreement, acceptance evidence and production-account scope confirmed by the authorised legal role. A separate countersigned DPA is not universally required.                                   |
| `PRIV-LEGAL-RAILWAY-DPA`             | Pending         | Executed agreement covering the intended processing, or a legally assessed restriction decision. Public standard terms alone do not establish sensitive-health-data coverage.                              |
| `PRIV-LEGAL-APP8-CROSS-BORDER-BASIS` | Pending         | Privacy-adviser determination for the actual processing flow and its restrictions.                                                                                                                         |
| `PRIV-LEGAL-APP1-APP5-NOTICE`        | Pending         | Accountable entity, privacy contact, rights/complaints process and approved notice.                                                                                                                        |
| `PRIV-CLINICAL-PHI-MINIMISATION`     | Partial         | Clinical-owner decision on the intended deployment, residual risk and incident controls.                                                                                                                   |

The register records production `RAG_QUERY_HASH_SECRET` ownership/parity and retention schedules as verified, with dated evidence and expiry. A read-only production check on 2026-09-13 confirmed all four expected retention jobs were unique, active and matched the committed schedules and commands; the obsolete cache job was absent. This closes the missing post-merge configuration read, but does not prove purge execution, refresh staging evidence or renew owner approval. The previous reference here to a pending `DOCUMENT_SIGNED_URL_HMAC_SECRET` rotation was incorrect for the HMAC requirement. Do not rotate another secret to close it; revalidate evidence when it expires or relevant controls change.

A restricted, non-identifying deployment can be considered through the existing decision route. The designated roles must explicitly assess its scope and residual risk, including user-account data; a general request to deploy is not that assessment. Record each covered requirement, actual decision, authorised role, rationale, scope, dates and sanitized evidence reference in `docs/governance/`, then update the register and run the release check. Do not synthesize approvals or change the validator to accept an unresolved item.

---

## Local vs. Hosted Verification Boundary

- **Offline / Local Verification**: Developers should run `npm run check:production-readiness:ci` or standard test suites (`npm test`) during routine development.
- **Release Candidates**: Must run `npm run check:production-readiness` with all provider and legal gates satisfied. Do NOT omit `--release` (or use an unrecognized flag such as `--mode=release`) to bypass release requirements.
