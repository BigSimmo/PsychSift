# Forward-codify retrieval RPCs work-order — retired

The work-order is complete. The live-ahead retrieval RPC bodies were captured read-only and preserved as
migrations `20260713062107`, `20260713062125`, `20260713062132` and `20260713062139`, applied and
drift-verified on 2026-07-13. The guard test `tests/forward-codify-retrieval-targets.test.ts` and the
capture query `scripts/sql/capture-live-retrieval-rpcs.sql` remain in use.

For current drift work read [database-drift-detection.md](database-drift-detection.md). The
[original work-order](archive/forward-codify-retrieval-rpcs-workorder-2026-10-20.md) is kept as history and
grants no database or provider authority.
