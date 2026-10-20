/** Shared coverage inventory contract for Vitest and the post-run LCOV guard. */
export const COVERAGE_INCLUDE_GLOBS = Object.freeze([
  "src/**/*.{ts,tsx}",
  "scripts/**/*.{ts,mjs,cjs}",
  "worker/**/*.ts",
  "supabase/functions/**/*.ts",
]);

export const COVERAGE_INVENTORY_ROOTS = Object.freeze(["src/", "scripts/", "worker/", "supabase/functions/"]);

// Declaration files have no executable output. The generated database schema is
// the sole generated-source exception; executable source needs an LCOV record.
export const COVERAGE_EXCLUDE_GLOBS = Object.freeze(["**/*.d.ts", "src/lib/supabase/database.types.ts"]);
