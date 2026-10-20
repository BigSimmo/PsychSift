/** Shared coverage inventory contract for Vitest and the post-run LCOV guard. */
export const COVERAGE_INCLUDE_GLOBS = Object.freeze([
  "src/**/*.{ts,tsx}",
  "scripts/**/*.{ts,mjs,cjs}",
  "worker/**/*.ts",
  "supabase/functions/**/*.ts",
]);

export const COVERAGE_INVENTORY_ROOTS = Object.freeze(["src/", "scripts/", "worker/", "supabase/functions/"]);

// Test/spec modules are verification inputs, including archived fixtures inside
// source roots. Match Vitest's standard test naming explicitly in both the
// reporter and inventory. Declaration files have no executable output; the
// database schema is the sole generated-source exception. Ordinary archived
// executable source remains required in LCOV.
export const COVERAGE_EXCLUDE_GLOBS = Object.freeze([
  "**/*.{test,spec}.?(c|m)[jt]s?(x)",
  "**/*.d.ts",
  "src/lib/supabase/database.types.ts",
]);
