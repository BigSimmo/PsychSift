/** Shared coverage inventory contract for Vitest and the post-run LCOV guard. */
export const COVERAGE_INCLUDE_GLOBS = Object.freeze([
  "src/**/*.{ts,tsx,js}",
  "scripts/**/*.{ts,mjs,cjs}",
  "worker/**/*.ts",
  "supabase/functions/**/*.ts",
]);

export const COVERAGE_INVENTORY_ROOTS = Object.freeze(["src/", "scripts/", "worker/", "supabase/functions/"]);

// Budget enforcement is production code even when implemented in JavaScript.
// A root-only LCOV check must not silently omit these monetary control paths.
export const COVERAGE_REQUIRED_SOURCE_FILES = Object.freeze([
  "src/lib/answer-pilot-budget.js",
  "src/lib/answer-pilot-diagnostic.js",
  "src/lib/answer-pilot-ticket.js",
  "src/lib/answer-wire-budget-guard.js",
]);
