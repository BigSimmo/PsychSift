# Decision: Implement a source-scoped administrator-only unscanned exception locally

- **Status:** decided 2026-11-01
- **Source:** the owner, in chat

The owner selected a source-scoped administrator-only unscanned exception and authorized local
implementation and tests. The [exception contract](../reindex-unlock-plan.md#administrator-unscanned-exception-contract)
governs its scope, provenance, expiry and refusal behaviour. This continues the scanner deferral
without claiming a clean scan. Ingestion, re-index, paid evaluation, merge and deployment need
separate approval. No real source grant or runtime activation is authorized by this implementation.

If this summary and the source ever differ, the source wins.
