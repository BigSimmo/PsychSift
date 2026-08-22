import { vitestCacheDirectory } from "./scripts/test-cache-path.mjs";
import { COVERAGE_INCLUDE_GLOBS } from "./scripts/coverage-contract.mjs";

const liveProviderTests = process.env.ALLOW_PROVIDER_TESTS === "true";

// The caring-contact database suites need a real Postgres, named by CARING_CONTACTS_DATABASE_URL.
// They live in their own project so the default offline `npm run test` never collects them, and
// they are reached through `npm run caring-contacts:db:test`, which fails loudly (naming the
// variable) rather than skipping when no database is configured.
const caringContactsDatabaseUrl = (process.env.CARING_CONTACTS_DATABASE_URL ?? "").trim();
const caringContactsDbTests = caringContactsDatabaseUrl !== "";
const caringContactsDbTestFiles = [
  "tests/caring-contacts-migrations.test.ts",
  "tests/caring-contacts-postgres-repository.test.ts",
];

const config = {
  // Codex worktrees commonly share node_modules through a junction. Keep Vite's
  // transform cache outside that shared dependency tree and unique per worktree.
  cacheDir: vitestCacheDirectory(process.cwd()),
  test: {
    // Route and RAG tests cold-import large Next.js module graphs inside the test
    // body. Give those transforms headroom on slower worktree filesystems while
    // retaining a finite timeout that still catches genuine hangs.
    testTimeout: 30_000,
    // CI runners and dev containers here have 4 cores / ~16 GB; the node suite is
    // CPU-bound (cold-imports large Next module graphs), so 2 workers left cores
    // idle. Scale to the host but cap so a smaller runner cannot oversubscribe,
    // and honour an explicit override for constrained environments.
    maxWorkers: process.env.VITEST_MAX_WORKERS ? Number(process.env.VITEST_MAX_WORKERS) : 4,
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      reportsDirectory: "coverage",
      // Inventory every executable TypeScript surface, including pages/layouts,
      // mockups, scripts, the worker, and Supabase Edge Functions. The existing
      // core threshold remains scoped to its historical files so expanding the
      // inventory cannot weaken that regression floor.
      include: [...COVERAGE_INCLUDE_GLOBS],
      exclude: ["src/lib/supabase/database.types.ts"],
      thresholds: {
        // Whole-repository floors sit below the 2026-08-13 current-main measurement
        // (54.41/51.51/56.37/55.79) but close the previous no-global-floor gap.
        statements: 52,
        branches: 49,
        functions: 54,
        lines: 53,
        // Broad regression floor. Re-ratcheted 2026-07-29: the previous values
        // (48/38/43/50) had drifted 14-17pp below measured coverage
        // (63.99/55.29/57.6/66.19), so a change could delete a large amount of
        // coverage and still pass. Each floor now sits ~2pp under measured — enough
        // headroom for a PR that ships an uncovered surface, not enough to hide a
        // regression. Re-measure with `npm run test:coverage` and raise these when
        // the gap grows past ~5pp again; never lower them to make a red gate green.
        "src/{lib/**/*.ts,app/**/route.ts,components/**/*.{ts,tsx}}": {
          statements: 62,
          branches: 53,
          functions: 55,
          lines: 64,
        },
        // Aggregate behavioral floors ratchet the full post-fixture group rather
        // than making individual large RAG modules brittle. Each value is the
        // greater of the measured whole-group floor or the broad floor + 5pp.
        // Ledger #192 (maturity X6, 2026-08-14): re-measured against
        // `npm run test:coverage` on this exact file set. Group B branches (81)
        // and Group C branches (72) had drifted >5pp below measured — the same
        // re-ratchet trigger documented above for the whole-repo floor — so
        // those two values were raised to sit ~2pp under the fresh measurement.
        // Every other value here already sat within that 5pp band and is
        // unchanged: raising a floor that already tracks its baseline closely
        // would risk a false failure from ordinary day-to-day branch-count
        // variance, not close a real gap.
        "src/lib/{clinical-search,retrieval-selection,answer-ranking,clinical-value-binding,medication-entities,rag/rag-candidate-sources,rag/rag-context-selection,rag/rag-retrieval-variants,rag/rag-routing}.ts":
          {
            // Measured 2026-08-14: 90.32/81.02/92.86/93.88 (stmt/branch/func/line).
            statements: 86,
            branches: 78,
            functions: 88,
            lines: 90,
          },
        "src/lib/{answer-verification,evidence,evidence-relevance,rag/rag-claim-support,rag/rag-evidence-gates,rag/rag-quote-verification,rag/rag-source-segmentation}.ts":
          {
            // Measured 2026-08-14: 93.89/86.04/95.24/96.44. Branches raised
            // 81 -> 84 (gap was 5.04pp, just past the 5pp trigger).
            statements: 92,
            branches: 84,
            functions: 94,
            lines: 94,
          },
        "src/lib/rag/{rag,rag-extractive-answer,rag-comparison,rag-answer-support}.ts": {
          // Measured 2026-08-14: 87.55/78.22/92.57/91.84. Branches raised
          // 72 -> 76 (gap was 6.22pp, the largest in this file).
          statements: 83,
          branches: 76,
          functions: 90,
          lines: 88,
        },
        "src/lib/{clinical-safety,source-governance,source-review,clinical-review-queue,answer-response}.ts": {
          // Measured 2026-08-14: 96.72/85.11/98.73/98.95.
          statements: 94,
          branches: 83,
          functions: 96,
          lines: 97,
        },
      },
    },
    // Two projects run under one `npm run test` invocation. `extends: true` makes
    // each inherit the shared root config above (coverage, timeouts, resolve.alias
    // below), so only the environment/include/setup differ.
    projects: [
      {
        extends: true,
        test: {
          // The long-standing suite: pure logic + route + SSR-string component tests.
          // Node environment, unchanged glob — existing tests behave exactly as before.
          name: "node",
          environment: "node",
          include: liveProviderTests ? ["tests/**/*.live.test.ts"] : ["tests/**/*.test.ts"],
          // The database suites are excluded unconditionally: they are collected only by the
          // `caring-contacts-db` project below, so the offline node suite stays offline.
          exclude: liveProviderTests
            ? [...caringContactsDbTestFiles]
            : ["tests/**/*.live.test.ts", ...caringContactsDbTestFiles],
        },
      },
      ...(!liveProviderTests
        ? [
            {
              extends: true,
              test: {
                // Interactive component tier: @testing-library/react under jsdom. Kept on a
                // distinct `*.dom.test.tsx` glob so it can never collect the node suite's
                // `*.test.ts` files (and vice versa).
                name: "jsdom",
                environment: "jsdom",
                include: ["tests/**/*.dom.test.tsx"],
                setupFiles: ["tests/setup/jsdom.setup.ts"],
              },
            },
          ]
        : []),
      ...(caringContactsDbTests
        ? [
            {
              extends: true,
              test: {
                // Caring-contact schema, row-level security, and the Postgres store driven through
                // the same contract suite as the in-memory one. Present only when a database is
                // configured; `npm run caring-contacts:db:test` refuses to run without one.
                name: "caring-contacts-db",
                environment: "node",
                include: [...caringContactsDbTestFiles],
                // One database, one schema: parallel files would truncate each other's rows.
                fileParallelism: false,
                testTimeout: 60_000,
                hookTimeout: 60_000,
              },
            },
          ]
        : []),
    ],
  },
  resolve: {
    alias: {
      "@": new URL("./src", import.meta.url).pathname,
      "server-only": new URL("./tests/stubs/server-only.ts", import.meta.url).pathname,
    },
  },
};

export default config;
