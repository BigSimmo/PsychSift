# Staging tenancy release evidence

The cross-tenant staging harness is the executable proof that the service-role API
layer preserves private owner boundaries. It is intentionally separate from PR and
local verification because it signs in to a hosted staging app, writes synthetic
fixtures to a dedicated staging Supabase project, and then removes them.

## Safety contract

Run `npm run test:cross-tenant:staging` only against a dedicated staging deployment.
The harness exits before creating clients or writing data when any required value is
missing or placeholder-like, the project ref is the production ref
`sjrfecxgysukkwxsowpy`, or the Supabase URL does not match the declared project ref.
It also refuses the production app host and subdomains, refuses HTTP redirects,
requires a full checkout SHA, and requires `GET /api/health` to report that exact
deployed SHA before it creates a Supabase client or writes a fixture.
It signs both test accounts in before creating the service-role client and refuses to
write fixtures if both credentials resolve to the same user.

The staging app used by this check must:

- target the same dedicated staging Supabase project;
- set `RAG_PROVIDER_MODE=offline` with no OpenAI key, which the harness proves by
  requiring `GET /api/health` to report `checks.openaiConfig: "skipped"` alongside the
  deployed SHA. The source-only answer step then accepts only provider-free fallback codes
  (`provider_offline`, `low_signal`, `coverage_gap`, `no_candidates`, `unsupported`).
  The synthetic fixture cannot support a clinical answer, so an offline app answers it
  through an evidence gate rather than with `provider_offline`;
- use two distinct, non-human test accounts that are not used interactively; and
- avoid running an ingestion worker during the short check, because full reindex is
  exercised last and the harness owns cleanup.

Configure these repository secrets for `.github/workflows/staging-tenancy.yml`:

| Secret                                                       | Purpose                                                     |
| ------------------------------------------------------------ | ----------------------------------------------------------- |
| `CROSS_TENANT_STAGING_APP_URL`                               | HTTPS origin of the offline staging app                     |
| `CROSS_TENANT_SUPABASE_URL`                                  | Dedicated staging Supabase HTTPS origin                     |
| `CROSS_TENANT_PROJECT_REF`                                   | Dedicated staging project ref                               |
| `CROSS_TENANT_PUBLISHABLE_KEY`                               | Staging publishable/anon key                                |
| `CROSS_TENANT_SERVICE_ROLE_KEY`                              | Staging service-role key used only for fixtures and cleanup |
| `CROSS_TENANT_USER_A_EMAIL` / `CROSS_TENANT_USER_A_PASSWORD` | First staging test user                                     |
| `CROSS_TENANT_USER_B_EMAIL` / `CROSS_TENANT_USER_B_PASSWORD` | Second staging test user                                    |

`CROSS_TENANT_DOCUMENT_BUCKET` is an optional repository variable and defaults to
`clinical-documents`. The harness reads only the `CROSS_TENANT_*` namespace; it does
not fall back to production application credentials.
The workflow injects `CROSS_TENANT_CHECKOUT_COMMIT_SHA=${{ github.sha }}`. A local
operator invocation must supply the same full 40-character variable explicitly.

## Proof matrix

Each run creates one private document, page, lexical chunk, and storage object for
each user under a unique run ID. It then proves:

| Surface            | Owner proof                          | Cross-tenant proof                           |
| ------------------ | ------------------------------------ | -------------------------------------------- |
| Document list      | A and B each find their own fixture  | B cannot list A's fixture                    |
| Document detail    | A receives A's document              | B receives 404 for A's document              |
| Signed URL         | A receives a signed URL              | B receives 404                               |
| Labels             | A creates a manual label             | B receives 404                               |
| Mutation           | A renames A's document               | B receives 404                               |
| Universal search   | A finds A's document                 | B gets no A result                           |
| Offline retrieval  | A retrieves A's chunk                | B gets an empty scope and result set         |
| Source-only answer | A gets cited source-only evidence    | B gets unsupported with no sources/citations |
| Reindex            | Not queued in the workerless profile | B receives 404                               |

Cleanup runs in `finally` semantics in reverse dependency order, including run-time
query telemetry for the two dedicated test users, reindex jobs/stages, labels,
chunks, pages, documents, and storage objects. Cleanup failure makes the run fail.
The test never skips a scenario when explicitly invoked.

## Release evidence

The standalone workflow runs nightly and on manual dispatch. It is not included in
`verify:cheap`, `verify:pr-local`, PR-required checks, or local release gates.

Before a release, record a successful workflow run that:

1. completed within the previous seven days;
2. checked out the exact candidate SHA and observed the same full SHA in the
   staging app's `/api/health` response; and
3. retained the `staging-tenancy-evidence-<run-id>` artifact.

The JSON artifact records both checkout and deployed SHAs, workflow URL, staging project identity,
completed scenario checkpoints, final status, and cleanup status without including
credentials. A missing artifact, failed cleanup, stale run, different project, or
non-offline answer is not acceptable release evidence.

The deployment SHA is self-reported release metadata, not cryptographic environment
attestation. Exact equality still prevents a release record from silently combining
one checkout with another deployed candidate.
