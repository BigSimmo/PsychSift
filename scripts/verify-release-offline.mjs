#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { offlineTestEnvironment } from "./test-environment.mjs";

const npmCli = process.env.npm_execpath;
const dryRun = process.argv.includes("--dry-run");
const steps = [
  "check:runtime",
  "lint",
  "typecheck",
  "test",
  "build",
  "test:e2e",
  "check:function-grants",
  "check:owner-scope",
  "check:rag:fixtures",
  "eval:rag:offline",
];
const offlineEnv = offlineTestEnvironment(process.env, {
  // Preserve the staging contract's inert placeholders. The shared sanitizer
  // blanks every provider key before these controlled overrides are applied.
  NEXT_PUBLIC_SUPABASE_URL: "https://offline.invalid",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "offline-placeholder",
  SUPABASE_SERVICE_ROLE_KEY: "offline-placeholder",
  SUPABASE_DB_URL: ["postgresql://offline", "offline@offline.invalid:5432/offline"].join(":"),
  CROSS_TENANT_SUPABASE_URL: "https://offline.invalid",
  CROSS_TENANT_SUPABASE_SERVICE_ROLE_KEY: "offline-placeholder",
});

for (const step of steps) {
  console.log(`[verify:release:offline] npm run ${step}`);
  if (dryRun) continue;
  if (!npmCli) {
    console.error("[verify:release:offline] npm_execpath is unavailable; invoke this through npm run.");
    process.exit(1);
  }
  const result = spawnSync(process.execPath, [npmCli, "run", step], {
    cwd: process.cwd(),
    env: offlineEnv,
    stdio: "inherit",
    shell: false,
  });
  if (result.error) {
    console.error(`[verify:release:offline] Could not run ${step}: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`[verify:release:offline] ${step} failed with exit code ${result.status ?? 1}.`);
    process.exit(result.status ?? 1);
  }
}

console.log(
  dryRun
    ? "[verify:release:offline] Dry run complete; no checks were executed."
    : "[verify:release:offline] All offline release checks passed.",
);
