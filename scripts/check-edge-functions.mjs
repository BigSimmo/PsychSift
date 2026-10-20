import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const root = process.cwd();
const functionsRoot = resolve(root, "supabase/functions");
const entrypoints = readdirSync(functionsRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => join(functionsRoot, entry.name, "index.ts"))
  .filter((entrypoint) => existsSync(entrypoint))
  .map((entrypoint) => relative(root, entrypoint).replaceAll("\\", "/"))
  .sort();

if (entrypoints.length === 0) {
  console.error("[check:edge:functions] No supabase/functions/*/index.ts entrypoints were found.");
  process.exit(1);
}

const args = ["check", "--node-modules-dir=false", "--lock=deno.lock", "--frozen", ...entrypoints];
const deno = spawnSync("deno", ["--version"], { encoding: "utf8" });
const denoVersionLine = deno.stdout?.split("\n")[0]?.trim() ?? "";
const denoVersionMatch = denoVersionLine.match(/^deno\s+(\d+)\./);
const denoMajor = denoVersionMatch ? Number(denoVersionMatch[1]) : null;
const hasDeno = deno.status === 0 && denoMajor !== null && denoMajor >= 2;

if (!hasDeno) {
  const found = deno.status === 0 ? denoVersionLine || "unknown version" : "not installed";
  if (process.env.CI) {
    console.error(
      `[check:edge:functions] Deno v2.x is required in CI (found: ${found}). Install Deno and rerun this check.`,
    );
    process.exit(1);
  }

  console.warn(
    `[check:edge:functions] Deno v2.x is required to run this check locally (found: ${found}); skipping edge function type check. Install Deno v2.x to run this check locally.`,
  );
  process.exit(0);
}

// Edge imports use explicit npm:/jsr: specifiers. Ignore the unrelated Next.js
// package workspace so dependency bumps cannot silently rewrite the edge lock.
const check = spawnSync("deno", args, {
  stdio: "inherit",
  env: { ...process.env, DENO_NO_PACKAGE_JSON: "1" },
});

if (check.error) {
  console.error(`[check:edge:functions] Failed to execute Deno: ${check.error.message}`);
  process.exit(1);
}

process.exit(check.status ?? 1);
