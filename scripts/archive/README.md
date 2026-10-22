# Legacy operational entrypoints

_Updated 2026-10-21 — clarified supported compatibility paths and verification; Delivery owns._

These scripts retain their existing paths for documented operator commands. The directory name
does not exempt supported TypeScript entrypoints from the standalone offline typecheck
(`tsconfig.typecheck.json`). The app's `tsconfig.json` keeps its archive exclusion. The offline regression suite
for `check-july8-live-batch.ts` is explicitly collected by the standard Vitest configuration.

Some commands read or mutate connected services. Their presence here grants no execution authority;
follow the repository provider, spending and database approval boundaries before using them.
Retire an entrypoint only after checking its callers and operational references. Preserve historical
evidence separately from supported executable commands.
