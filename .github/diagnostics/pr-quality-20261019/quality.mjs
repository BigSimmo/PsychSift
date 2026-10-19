import { execFileSync, spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
const root = process.cwd();
const { selectedScripts } = await import(pathToFileURL(`${root}/scripts/verify-pr-local.mjs`));
const scope = JSON.parse(
  execFileSync(
    process.execPath,
    ["scripts/ci-change-scope.mjs", "--base", process.env.BASE_SHA, "--head", process.env.SOURCE_SHA, "--json"],
    { encoding: "utf8" },
  ),
);
const changedPaths = execFileSync("git", ["diff", "--name-only", "-z", process.env.BASE_SHA, process.env.SOURCE_SHA], {
  encoding: "utf8",
})
  .split("\0")
  .filter(Boolean);
const actualSupabasePaths = changedPaths.filter((path) => path.startsWith("supabase/"));
if (actualSupabasePaths.length)
  throw Error(`Actual Supabase source changes require a revised replay/parity plan: ${actualSupabasePaths.join(", ")}`);
if (!scope.static_heavy_changed) throw Error("Expected reviewed broad product scope");
// Worker paths legitimately set db_changed for normal PR CI without editing any schema.
// Keep all selected static contracts. This isolated quality runner does not replace Migration replay.
const databaseScope = {
  classifierDbChanged: scope.db_changed,
  actualSupabasePaths,
  normalPrMigrationReplay: scope.db_changed
    ? "pending; required normal PR CI Migration replay not run by this quality-only repair"
    : "not selected by classifier",
  databaseAcceptance: "not established; no local replay, hosted database or live provider call in this repair",
};
console.log("DATABASE_SCOPE", JSON.stringify(databaseScope));
const selected = selectedScripts(scope, false);
for (const required of ["lint", "typecheck", "test"])
  if (!selected.includes(required)) throw Error(`Missing full source gate: ${required}`);
const scripts = selected.filter((s) => s !== "build");
// The unmodified production app Dockerfile runs npm run build once in its independent job.
// Keep full-source tsc: Next does not cover every CLI, worker or test TypeScript owner.
for (const required of ["check:rag:fixtures", "check:production-readiness:ci"])
  if (!scripts.includes(required)) scripts.push(required);
const plan = {
  source: process.env.SOURCE_SHA,
  base: process.env.BASE_SHA,
  scope,
  databaseScope,
  selected,
  delegated: selected.includes("build")
    ? ["build -> existing separate preflight full-app-image job; not rerun by this quality-only repair"]
    : [],
  scripts,
  completed: [],
  failed: [],
};
const save = () => writeFileSync("/tmp/psychsift-pr-quality-proof/quality-plan.json", JSON.stringify(plan, null, 2));
save();
console.log(JSON.stringify(plan, null, 2));
for (const script of scripts) {
  console.log(`::group::npm run ${script}`);
  const result = spawnSync("npm", ["run", script], { stdio: "inherit", env: process.env });
  console.log("::endgroup::");
  if (result.error || result.status !== 0) {
    plan.failed.push({ script, status: result.status, signal: result.signal, error: result.error?.message });
    save();
    continue;
  }
  plan.completed.push(script);
  save();
}

console.log("QUALITY_OUTCOMES", JSON.stringify({ completed: plan.completed, failed: plan.failed }));
process.exit(plan.failed.length ? 1 : 0);
