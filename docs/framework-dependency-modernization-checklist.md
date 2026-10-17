# Framework and dependency modernization checklist

This is the implementation checklist for completing the repository's current
framework modernization. It was assembled from parallel build/infra, backend,
and frontend audits of `origin/main` at
`4057677c8b92a5e1d997ec44958764fa91f5d424` on 2026-07-18.

The manifest versions are already modern. The remaining work is to remove old
runtime assumptions that survived the version bumps and to prove the supported
Next.js 16 production path end to end.

## Target and guardrails

The target for this program is:

- Node.js 24.x and npm 11.x in development, CI, Docker, and production.
- Next.js 16.2.x with React and React DOM 19.2.x.
- TypeScript 6.0.x, with runtime-compatible Node 24 type definitions.
- Next.js App Router asynchronous request APIs and generated route types.
- Turbopack as the default development and production bundler after a measured
  dual-lane migration from the current Webpack escape hatch.
- Tailwind CSS 4's existing CSS-first configuration.
- The currently declared major lines for Supabase, OpenAI, Zod, Vitest,
  Playwright, ESLint, and the document-processing packages.

Next.js 17, React 20, and TypeScript 7 are not targets. Do not turn this work
into speculative future-major preparation. Do not bulk-update dependencies,
enable the React Compiler globally, or remove the Webpack fallback until the
checks below prove the replacement behavior.

Registry currency and vulnerability data were not queried during this audit.
`npm outdated`, `npm audit`, clean installs, provider checks, hosted CI, and
deployment remain explicit execution gates; run them only in an authorized
migration task.

## Findings to clear before calling the migration complete

| Priority | Layer             | Finding                                                                                                                                                                                                   | Failure trigger                                                                                                                                                         | Required disposition                                                                                                                                                                     |
| -------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1       | Backend/auth      | Supabase SSR 0.12 response-protection headers are discarded by the one-argument `setAll` adapters in [`src/proxy.ts`](../src/proxy.ts) and [`src/lib/supabase/server.ts`](../src/lib/supabase/server.ts). | Session refresh or PKCE exchange sets auth cookies. A CDN or reverse proxy does not receive the dependency's required `Cache-Control`, `Expires`, and `Pragma` headers. | Manually redesign response ownership so the dependency-supplied headers and cookies are applied to the exact response returned to the client.                                            |
| P1       | Backend/worker    | [`scripts/reindex.ts`](../scripts/reindex.ts) launches `npx tsx worker/index.ts --once` instead of the repository's server-only-aware runner.                                                             | Reindex reaches the worker phase after queue recovery or other mutations. Bare TSX fails on the `server-only` import or `npx` attempts package resolution.              | Launch `process.execPath` with `scripts/run-tsx.mjs`, add an exact spawn-vector test, and prove the worker bootstrap uses the safe runner before reindex performs mutation-capable work. |
| P2       | Build             | Production build and production Playwright force `next build --webpack`; [`next.config.ts`](../next.config.ts) retains a Webpack callback, WasmHash workaround, and one-CPU tuning.                       | Removing only the CLI flag either makes Next reject the custom Webpack config or silently changes build artifacts, CSP behavior, and resource use.                      | Run the dual-lane Turbopack program below. This is not a one-line flag change.                                                                                                           |
| P2       | Deploy            | [`railway.app.json`](../railway.app.json) omits `run-heavy.mjs`, `test-run-lock.mjs`, and `child-process-result.mjs`; [`railway.worker.json`](../railway.worker.json) omits `build-worker.mjs`.           | A build-controller-only change does not match a watch pattern, so Railway can leave the deployed image stale.                                                           | Cover every transitive image-build input, with a regression test for watch-pattern ownership.                                                                                            |
| P2       | Types/CI          | Clean CI runs `tsc --noEmit` without `next typegen`, while `next-env.d.ts` and `.next` types are ignored/generated.                                                                                       | An invalid page, layout, or route signature passes a clean typecheck or a developer sees results from stale generated types.                                            | Generate Next route types in an owned clean path before TypeScript and test the clean-checkout behavior.                                                                                 |
| P2       | Runtime/types     | `@types/node` targets 26.x while every runtime contract targets Node 24.x.                                                                                                                                | Code typechecks against a Node 26 API and fails in Docker or Railway on Node 24.                                                                                        | Pin the compatible Node 24 type line until the runtime moves.                                                                                                                            |
| P2       | Frontend recovery | Fourteen App Router error boundaries present `reset()` as "Try again", although Next 16.2 recommends `unstable_retry()` for re-fetching failed Server Component content.                                  | A transient server/request failure reaches an error boundary. `reset()` re-renders without re-fetching and can repeat the failure.                                      | Plumb `unstable_retry` through the shared boundary and prove a fail-once route recovers.                                                                                                 |
| P3       | Removal readiness | Zod 4 deprecated string UUID/URL methods and one `.passthrough()` remain; a mockup `<Image>` still uses deprecated `priority`.                                                                            | A later Zod or Next removal turns warnings/deprecated behavior into compile failures.                                                                                   | Apply focused mechanical migrations with contract tests.                                                                                                                                 |

No legacy React lifecycle methods, class context/state, `ReactDOM.render`,
`findDOMNode`, `next/router`, legacy Link markup, or synchronous Next request API
access was found. The route `params`, `searchParams`, `cookies()`, and
`headers()` call sites inspected already use the Next 16 asynchronous model.

## Step-by-step migration

### 0. Establish a reproducible baseline

- [ ] Start from a clean feature branch at a recorded `origin/main` SHA. Record
      Node, npm, Docker base-image, Next, React, and TypeScript versions.
- [ ] Confirm no other Database worktree owns the heavyweight test/build lock.
- [ ] With registry access explicitly approved, run a clean `npm ci`,
      `npm ls --all`, `npm outdated --json`, and `npm audit --json`. Save the
      direct-versus-transitive result; do not interpret a missing local install
      as a broken dependency tree.
- [ ] Capture the current Webpack baseline: production build duration and peak
      memory, generated route count, client-bundle secret scan, bundle budget,
      chunk/manifests consumed by tests, and CSP console violations.
- [ ] Run `npm run verify:pr-local` and `npm run verify:ui` on the unchanged
      baseline. Record any clean-main failures before changing dependencies.
- [ ] Define rollback per batch: the previous lockfile, the previous Webpack
      build command, and the previous Railway deployment must remain available
      until the new lane is proven.

### 1. Clear the two P1 defects before broad version work

#### Supabase SSR response ownership — manual rewrite

- [ ] Update the proxy cookie adapter to accept `(cookiesToSet,
responseHeaders)` and copy all supplied headers onto every rebuilt
      `NextResponse` before CSP headers are finalized.
- [ ] Refactor the server-client/auth-callback boundary so cookies and response
      headers produced during `exchangeCodeForSession()` are applied to the
      final success or failure redirect. Do not rely on a helper that cannot
      reach the returned response.
- [ ] Keep the intentionally read-only adapter in
      [`src/lib/supabase/auth.ts`](../src/lib/supabase/auth.ts) separate; a broad
      search-and-replace would change its contract incorrectly.
- [ ] Extend `proxy-session-refresh.test.ts` and `supabase-server.test.ts` to
      assert `Cache-Control`, `Expires`, and `Pragma` survive together with auth
      cookies, CSP headers, and redirects.
- [ ] Prove the unauthenticated/demo path adds no auth cookie headers and that
      same-origin redirect validation remains intact.

#### Reindex child process — mechanical change with mutation-safety proof

- [ ] Replace the bare `npx tsx` child with
      `spawn(process.execPath, ["scripts/run-tsx.mjs", "worker/index.ts",
"--once"], { cwd: process.cwd(), stdio: "inherit", windowsHide: true })`.
- [ ] Add a static contract test covering internal child-process launches, not
      only package scripts.
- [ ] Add a mocked-spawn test for the executable and argument vector.
- [ ] Run a local no-provider import/bootstrap proof. Do not execute the real
      reindex workflow without live-provider approval.

### 2. Align the runtime and clean typecheck contract

- [ ] Move `@types/node` from 26.x to the compatible 24.x line. Search new code
      for APIs whose availability changed between Node 24 and 26.
- [ ] Add the repository-local `next typegen` command before `tsc --noEmit` in
      the canonical typecheck path.
- [ ] Generate route types in an owned clean location and ensure stale
      `.next/dev/types` cannot make CI pass.
- [ ] Add a test fixture with an invalid route signature that fails the clean
      typecheck, then restore the valid signature.
- [ ] Hold TypeScript at 6.0.x while the locked typescript-eslint peer range is
      `<6.1.0`; do not force TypeScript 6.1 through the resolver.
- [ ] Verify the npm lifecycle allow-list with a clean install before enabling
      stricter lifecycle-script enforcement in `.npmrc`.

### 3. Make image rebuild ownership complete

- [ ] Add the app's transitive build controllers to
      `railway.app.json`: `run-heavy.mjs`, `test-run-lock.mjs`, and
      `child-process-result.mjs`.
- [ ] Add `build-worker.mjs` to `railway.worker.json`.
- [ ] Prefer explicit paths if rebuild cost matters; use `/scripts/**` only if
      the team accepts extra deployments for non-image operational scripts.
- [ ] Add a static test that derives or enumerates every script reached from
      Docker `RUN` instructions and package build scripts, then asserts the
      relevant Railway service watches it.
- [ ] Correct the UI E2E action description that says it starts `next dev`; the
      runner builds and starts an isolated production server.

### 4. Modernize backend package contracts in isolated batches

- [ ] Mechanically migrate `z.string().uuid()` to `z.uuid()`,
      `z.string().url()` to `z.url()`, and `z.object({}).passthrough()` to
      `z.looseObject({})`.
- [ ] Re-run request, route-parameter, environment, and response-envelope
      contract tests after each Zod batch. Preserve optional/null/default and
      unknown-key semantics exactly.
- [ ] Replace the `as never` request-body and `unknown` promise bridge in
      [`src/lib/openai.ts`](../src/lib/openai.ts) with exported OpenAI 6 request
      and non-streaming response types. Preserve model-specific
      `prompt_cache_retention`; this is not a blind property rename.
- [ ] Replace JSZip private `_data.uncompressedSize` access in
      [`src/lib/extractors/document.ts`](../src/lib/extractors/document.ts) and
      [`src/lib/upload-structure.ts`](../src/lib/upload-structure.ts) with a
      documented size/accounting strategy before any JSZip major upgrade.
- [ ] Prove ZIP entry-count, per-entry size, aggregate size, nested archive,
      malformed archive, and compression-ratio limits fail closed. Never accept
      a missing private field as size zero.
- [ ] Run Node 24 import probes and focused parser fixtures for PDF, DOCX, XLSX,
      ZIP, and PDF generation after each document-library group.

### 5. Modernize frontend recovery and component contracts

- [ ] Change every App Router `error.tsx`/`global-error.tsx` wrapper to accept
      Next 16.2's `unstable_retry` prop and pass it to the shared surface as an
      explicit `onRetry` callback.
- [ ] Keep `reset()` only where the desired behavior is specifically to clear
      error state without re-fetching; name that action accordingly.
- [ ] Add a route-level test that fails once on server rendering and succeeds
      after the retry action. Static markup alone is not sufficient proof.
- [ ] Replace `<Image priority>` with `preload` in
      `document-search-mockups.tsx` and update the local wrapper prop name.
- [ ] Optionally replace handwritten page/layout prop types with generated
      `PageProps`/`LayoutProps` after `next typegen` is established. Review the
      diff; do not require this rewrite merely for style consistency.
- [ ] Exercise every `next/dynamic({ ssr: false })` dashboard surface under the
      target bundler for navigation, loading UI, hydration, focus restoration,
      and bundle splitting.

### 6. Move production from Webpack to Turbopack using two lanes

- [ ] Keep the existing Webpack command as the rollback lane while introducing
      an explicit `next build --turbopack` probe.
- [ ] Compare the Turbopack result with the Step 0 baseline: output paths,
      manifests, static/dynamic route classification, chunk names, bundle
      budgets, source maps, client-secret scan, Docker image contents, build
      time, and peak memory.
- [ ] Run the isolated production Playwright launcher against the Turbopack
      output. Verify CSP nonces on initial HTML and client chunks and assert zero
      browser CSP violations.
- [ ] Update `check-client-bundle-secrets.mjs`, bundle-budget tooling, and test
      artifact parsers only where the new output contract requires it.
- [ ] Replace `@next/bundle-analyzer` and `build-analyze.mjs` only after the
      repository-local Next analyzer produces equivalent actionable output.
- [ ] Remove the custom Webpack callback and WasmHash hash-function workaround.
      Removing the CLI flag first is unsafe.
- [ ] Re-measure memory and concurrency before changing `experimental.cpus=1`
      or CI's `NEXT_BUILD_CPUS`; do not carry Webpack tuning into Turbopack by
      assumption.
- [ ] Change the canonical build and production Playwright commands to plain
      `next build`, remove Webpack-specific assertions, and update deployment
      documentation only after the new lane is green.
- [ ] Retain the worktree-only development fallback separately until its
      external-`node_modules` condition has its own proof; it is not evidence
      that production requires Webpack.

### 7. Treat React Compiler as a separate architecture project

- [ ] Do not enable `reactCompiler: true` as part of the bundler switch.
- [ ] Start with annotation/opt-in mode on small, pure components and record
      compile-time and render-performance changes.
- [ ] Audit `ClinicalDashboard.tsx` and `DocumentViewer.tsx` manually before
      compiler coverage. They are multi-thousand-line stateful Client Component
      roots with request, navigation, focus, and lifecycle coupling.
- [ ] Keep `use-event-callback.ts` unless behavior proves otherwise;
      `useEffectEvent` is for Effect-only events and is not a mechanical
      replacement for DOM/React event callbacks.
- [ ] Require compiler diagnostics, focused interaction tests, render-count
      evidence, and the full UI/accessibility lane before expanding coverage.

### 8. Upgrade remaining dependencies in coherent groups

- [ ] Framework group: Next, React, React DOM, `@next/env`,
      `eslint-config-next`, and any Next analyzer tooling.
- [ ] Runtime/type group: Node image inputs, `@types/node`, TypeScript, tsx, and
      esbuild. Keep runtime and type targets identical.
- [ ] Lint/test group: ESLint and its plugins, Vitest and coverage, jsdom,
      Testing Library, Playwright, and axe. Respect peer ceilings.
- [ ] Backend SDK group: Supabase SSR/client/realtime, OpenAI, and Zod. Run auth,
      validation, rate-limit, privacy, and public-error contract tests.
- [ ] Document group: pdfjs-dist, PDFKit, Mammoth, ExcelJS, and JSZip.
      Run adversarial resource-budget fixtures before normal happy paths.
- [ ] UI group: Tailwind/PostCSS and lucide-react. Run generated CSS, forced
      colors, reduced motion, icon-scale, and representative browser checks.
- [ ] Update one group at a time. After a failure, rerun the smallest reproducer
      before widening verification. Do not use force, legacy-peer-deps, or a
      forced audit fix.

### 9. Verification and release gates

- [ ] Focused tests for each changed contract pass first.
- [ ] `npm run verify:cheap` passes after source/config/test changes.
- [ ] `npm run verify:pr-local` passes on the final local diff.
- [ ] `npm run verify:ui` passes for the Turbopack, recovery, React, styling, or
      browser-tooling batches.
- [ ] Both Docker images build, the app readiness endpoint passes, and the
      worker bundle boots without contacting providers.
- [ ] `npm run check:deployment-readiness` and the client-bundle secret scan
      pass on production artifacts.
- [ ] Supabase project checks, live auth/session tests, OpenAI tests, provider
      evaluations, hosted CI, staging deploys, and production deploys run only
      with explicit approval and correct project identity.
- [ ] Exact-head hosted CI and every review thread are green/resolved before
      merge. Re-run only a failed or stale lane; do not bypass it.
- [ ] After merge, fetch `origin/main` and prove the reviewed content is present.

## Overrides rationale

`package.json` cannot carry comments, so the reason each `overrides` entry exists is
recorded here (audit L129). Remove an entry when its reason no longer holds; never add
one without a row. `tests/ci-audit-contracts.test.ts` fails when an override is missing
from this list or when a major-scoped override matches nothing in the lock.

| Override                                              | Kind         | Why it exists                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | When it can go                                                                                                                                                 |
| ----------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `postcss` `^8.5.18`                                   | floor        | Transitive audit finding on the Next and ExcelJS paths (`docs/archive/project-alignment-cleanup.md`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | When every dependant declares the fixed floor itself.                                                                                                          |
| `tmp` `^0.2.7`                                        | floor        | Same cleanup: transitive audit finding.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | As above.                                                                                                                                                      |
| `uuid` `^11.1.1`                                      | floor        | Same cleanup; ExcelJS round-trip verified with the override in place.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | As above.                                                                                                                                                      |
| `esbuild` `0.28.2`                                    | exact pin    | The worker image is an esbuild bundle (#638) and tsx/vite each pull their own esbuild, so one exact version keeps every copy in the tree identical to the pinned devDependency and to the `allowScripts` key, which matches by exact `name@version`. Dependabot moves all three.                                                                                                                                                                                                                                                                                                                                                     | If the worker stops bundling with esbuild, or `allowScripts` gains range matching.                                                                             |
| `sharp` `0.35.3`                                      | exact pin    | Bumped 0.34.5 → 0.35.3 in #1053 and frozen exact with the matching `allowScripts` key; no advisory was recorded. It equals Next's own `^0.35.3` floor, so a Next patch that raises the floor conflicts at install time.                                                                                                                                                                                                                                                                                                                                                                                                              | Relax to `^0.35.3` once an image build and `npm run check:npm-ci-dry-run` prove the range.                                                                     |
| `brace-expansion@1` `^1.1.18`                         | floor        | GHSA for brace-expansion 1.x (ReDoS); the lock still resolves 1.1.18 under minimatch 3.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | When no dependant resolves a 1.x brace-expansion.                                                                                                              |
| `brace-expansion@2` `^2.1.4`                          | pre-pin      | The lock currently holds no 2.x copy, so this matches nothing today. It is kept deliberately: `tests/installed-lock-parity.test.ts` pins all three brace-expansion majors to CVE-2026-14257-patched maintenance releases, and dropping the entry would let a future transitive bump reintroduce an unpatched 2.x silently.                                                                                                                                                                                                                                                                                                           | When the CVE-2026-14257 guard in `tests/installed-lock-parity.test.ts` no longer pins the 2.x line.                                                            |
| `brace-expansion@5` `^5.0.9`                          | floor        | Same advisory on the 5.x line used by eslint-config-next, glob and readdir-glob.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | When no dependant resolves a 5.x below the floor.                                                                                                              |
| `fast-uri` `^3.1.7`                                   | floor        | Four advisories against 3.0.0–3.1.5 (host confusion via skipped IDN canonicalization and via percent-encoded scheme normalization; SSRF via malformed IPv6 normalization and via repeated hostname percent-decoding). Both copies come from `ajv` under `ajv-formats` and `schema-utils`, which declare `^3.0.1`, so the floor stays inside the same major. `npm audit --omit=dev --audit-level=high` — the CI safety gate's exact command — was failing on this one before the floor.                                                                                                                                               | When every `ajv` copy in the lock declares a patched floor itself.                                                                                             |
| `@xmldom/xmldom` `^0.8.15`                            | floor        | GHSA-6gmq-8vp8-gcm6 (moderate): XML fragment injection via an invalid `EntityReference.nodeName` during `requireWellFormed` serialization, affecting `<= 0.8.14`. The single copy is `mammoth`'s DOCX parser, which declares `^0.8.6`, so 0.8.15 is a patch inside the declared range rather than the 0.9 major.                                                                                                                                                                                                                                                                                                                     | When `mammoth` declares a patched floor, or moves to the 0.9 line.                                                                                             |
| `exceljs` → `archiver` `^8.0.0`, `unzipper` `^0.12.5` | nested floor | ExcelJS 4.4.0 declares older majors with open advisories; the nested override lifts only ExcelJS's copies and the XLSX round-trip test covers the result.                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | When ExcelJS publishes a release declaring these floors.                                                                                                       |
| `braces` `^3.0.3`                                     | floor        | CVE-2024-4068 (GHSA-grv7-fg5c-xmjg): uncontrolled memory consumption below 3.0.3. The single copy is dev-only, from `micromatch` 4.0.8 under `fast-glob` and `eslint-config-next`, which already declares `^3.0.3`, so the floor stays inside the declared range. It replaced the `npm:brace-expansion` alias from 6a4cf42e, which swapped in a different package with a different API. It does not clear GHSA-vfj7-8cjw-p6xm (stack exhaustion on deeply nested patterns), which has no patched `braces` release and stays in the dev-only `npm audit` output; the production gate (`--omit=dev --audit-level=high`) is unaffected. | When every `micromatch` copy in the lock declares `^3.0.3` or higher, which 4.0.8 already does. Revisit when a patched `braces` ships for GHSA-vfj7-8cjw-p6xm. |
| `argparse` `^2.0.1`                                   | cross-major  | `mammoth` declares `argparse` `~1.0.3`, and argparse 1.x pulls in `sprintf-js` with GHSA-hp3w-g68c-fv3c (moderate DoS via unbounded precision specifiers). The override moves `mammoth`'s copy onto the single 2.0.1 already in the lock for `js-yaml`. `mammoth` only uses `argparse` in its `bin/mammoth` CLI, which the app never invokes. Its library path (`mammoth.convertToHtml` and friends) does not load it, so the API change between majors does not reach the DOCX parser.                                                                                                                                              | When `mammoth` declares `argparse` 2.x, or stops depending on it.                                                                                              |

## Automation boundary

| Safe to automate with review                                                                                                      | Must be handled as a manual rewrite                                                                                      |
| --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Zod method replacements and the Image `priority` to `preload` rename.                                                             | Supabase auth cookie/header propagation and final-response ownership.                                                    |
| Reindex child executable/argument replacement and its static test.                                                                | Turbopack cutover: CSP nonce behavior, bundle artifacts, analyzer/scanner consumers, Docker output, and resource tuning. |
| Railway watch-list additions, Node type-line alignment, command/test wording, and Webpack-specific assertion cleanup after proof. | JSZip archive-size enforcement because the current guard reads a private field and protects against resource exhaustion. |
| Generated `PageProps`/`LayoutProps` adoption where the codemod produces a clean diff.                                             | OpenAI request typing where model capability controls request fields.                                                    |
| Mechanical error-wrapper prop plumbing after the retry behavior is chosen.                                                        | React Compiler adoption in the dashboard/viewer roots and dynamic client-only surfaces.                                  |

A codemod is a source of candidate edits, not proof. Run it in dry/report mode,
review every changed boundary, and reject casts or comments that preserve unsafe
compatibility instead of completing the migration.

## Completion definition

The program is complete only when the P1 and P2 rows are resolved, plain
`next build` uses Turbopack in the production and production-E2E paths, clean
route type generation is part of CI, runtime/type targets match, Railway watches
every image-build input, focused and broad local gates pass, exact-head hosted
CI and review threads are green, and the merged content is verified on
`origin/main`. Version bumps alone do not satisfy this definition.
